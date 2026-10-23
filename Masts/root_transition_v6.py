"""V6 shell-to-common-node transition using exact boundaries and G1 constraints.

No CAD exports or file-system reads occur here. The caller supplies the final
Z-node solid and receives the root, joined node, footprint cutter, and sampled
outer-boundary coordinates/normals for independent verification. This is a
geometric construction, not a structural strength certification.
"""
from math import comb
import math
import numpy as np
from numpy.polynomial import Polynomial, Polynomial as Poly
import cadquery as cq
from OCP.BRep import BRep_Tool, BRep_Builder
from OCP.Geom import Geom_BezierSurface
from OCP.GeomConvert import GeomConvert
from OCP.Geom2d import Geom2d_BezierCurve
from OCP.TColgp import TColgp_Array2OfPnt, TColgp_Array1OfPnt2d
from OCP.TColStd import TColStd_Array2OfReal
from OCP.gp import gp_Pnt, gp_Pnt2d
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace,BRepBuilderAPI_MakeEdge,BRepBuilderAPI_Sewing
from OCP.BRepLib import BRepLib
from OCP.TopAbs import TopAbs_EDGE,TopAbs_FACE
from OCP.TopExp import TopExp
from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape


def _power(poles):
    n = len(poles) - 1
    t = Polynomial([0, 1])
    s = Polynomial([1, -1])
    result = Polynomial([0])
    for k, value in enumerate(poles):
        result += value * comb(n, k) * t ** k * s ** (n - k)
    return result

def _bernstein(poly, degree):
    return [sum((poly.coef[j] * comb(k, j) / comb(degree, j) for j in range(min(k, len(poly.coef) - 1) + 1))) for k in range(degree + 1)]

def _parameter_y(curve, y):
    lo, hi = (curve.FirstParameter(), curve.LastParameter())
    for _ in range(55):
        mid = (lo + hi) / 2
        if curve.Value(mid).Y() < y:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2

def hermite(a, b, da, db):
    return Poly([a, da, 3 * (b - a) - 2 * da - db, 2 * (a - b) + da + db])

def patch_from_homogeneous(rows, weights, foot_positive_allowance_mm=0.0):
    """Rows are radial control points, each containing XYZ polynomials."""
    degree = max((len(poly.coef) - 1 for row in rows for poly in row))
    assert degree <= 25, degree
    wp = _bernstein(weights, degree)
    coords = [[_bernstein(poly, degree) for poly in row] for row in rows]
    poles = TColgp_Array2OfPnt(1, degree + 1, 1, len(rows))
    warray = TColStd_Array2OfReal(1, degree + 1, 1, len(rows))
    for i in range(degree + 1):
        for j in range(len(rows)):
            poles.SetValue(i + 1, j + 1, gp_Pnt(*(coords[j][k][i] / wp[i] for k in range(3))))
            warray.SetValue(i + 1, j + 1, wp[i])
    surface = Geom_BezierSurface(poles, warray)
    if foot_positive_allowance_mm > 0:
        # The compact C2 correction is confined to radial v <= 0.2. Its
        # support basis is N_2,5 = 10*t^2*(1-t)^3, t=v/0.2. Adding a single
        # control coefficient leaves the entire v>=0.2 surface unchanged.
        # The maximum basis value is 10*(2/5)^2*(3/5)^3 = 0.3456.
        assert len(rows) == 4
        surface = GeomConvert.SurfaceToBSplineSurface_s(surface)
        surface.IncreaseDegree(surface.UDegree(), 5)
        surface.InsertVKnot(0.2, 3, 1e-12)
        assert surface.NbVPoles() == 9
        offset = foot_positive_allowance_mm / 0.3456
        for ui in range(1, surface.NbUPoles() + 1):
            pole = surface.Pole(ui, 3)
            surface.SetPole(ui, 3,
                            gp_Pnt(pole.X() + offset, pole.Y(), pole.Z()))
    return (cq.Face(BRepBuilderAPI_MakeFace(surface, 1e-07).Face()), surface)

def build(model, node_shape, *, y_neck=34.0, footprint_y_max=30.0,
          footprint_z_half_height=15.0, derivative_length=9.0,
          preserve_node_pcurves=False, source_joint_blend_width=0.0,
          foot_positive_allowance_mm=0.0):
    """Build the right-hand root from the final node's actual closed section.

    ``raw_root`` and ``root_node`` contain an inward foundation, which the
    caller must trim with the existing silicone-contact envelope. Cut
    ``footprint_prism`` from the original saddle before attaching either
    skin; blind union would refill the intended smooth boundary. Mirror all
    three shapes in YZ to construct the left-hand support.

    ``preserve_node_pcurves`` composes the node's original surface parameter
    curve with exactly the same quadratic parameter map as the 3D neck edge.
    This avoids an additional numerical projection during sewing. It is used
    for the 23R interface, whose native plane intersection is less accurate.

    A positive ``source_joint_blend_width`` prevents a reference-shell
    curvature jump from propagating into the root. At each internal shell
    curve join the initial Y departure and its derivative vanish, while the
    Z departure retains the exact shell tangent plane. The footprint remains
    unchanged. The width is in millimetres; the 23R uses 2 mm.

    ``foot_positive_allowance_mm`` is the maximum outward X correction in
    the first 20 percent of each radial curve. It is zero with zero first
    derivative at the foot, and joins the unaltered surface with C2 continuity
    at v=0.2. The 23R uses 0.0013824 mm to keep the feathered rim nonnegative;
    the interface-side 80 percent and all neck derivatives stay unchanged.
    """
    if (not 0 < footprint_y_max < y_neck or derivative_length <= 0
            or footprint_z_half_height <= 0 or source_joint_blend_width < 0
            or foot_positive_allowance_mm < 0):
        raise ValueError('The footprint must end before the node neck; its derivative length must be positive')
    m = model
    p = m.P
    source = node_shape
    if isinstance(source, cq.Workplane):
        source = source.val()
    node = source.intersect(cq.Solid.makeBox(200, 200, 100, (-30, y_neck, p.mount_center_z - 50)))
    cap = next((f for f in node.Faces() if f.BoundingBox().ylen < 1e-05 and abs(f.Center().y - y_neck) < 1e-05))
    assert len(cap.Edges()) == 1
    edge = cap.Edges()[0]
    nface = next((f for f in node.Faces() if f.geomType() == 'BSPLINE'))
    neck = BRep_Tool.Curve_s(edge.wrapped, 0.0, 0.0).Copy()
    pc = BRep_Tool.CurveOnSurface_s(edge.wrapped, nface.wrapped, 0.0, 0.0).Copy()
    u0, u1 = (neck.FirstParameter(), neck.LastParameter())
    span = u1 - u0
    ps = [neck.Value(u0 + span * i / 128) for i in range(128)]
    area = sum((a.X() * b.Z() - b.X() * a.Z() for a, b in zip(ps, ps[1:] + ps[:1])))
    if area < 0:
        neck.Reverse()
        pc.Reverse()
    q = neck.Value(u0)
    bb = cap.BoundingBox()
    phase = math.atan2((q.Z() - p.mount_center_z) / (bb.zlen / 2), (q.X() - (bb.xmin + bb.xmax) / 2) / (bb.xlen / 2))
    v0 = neck.DN(u0, 1).Magnitude()
    v1 = neck.DN(u1, 1).Magnitude()
    first_speed = 2 * span * v1 / (v0 + v1)
    up = Poly([u0, first_speed, span - first_speed])

    def ua(angle):
        return up((angle - phase) / (2 * math.pi))

    def au(u):
        lo, hi = (0.0, 1.0)
        for _ in range(52):
            mid = (lo + hi) / 2
            if up(mid) < u:
                lo = mid
            else:
                hi = mid
        return phase + 2 * math.pi * (lo + hi) / 2

    def nnormal(u):
        uv = pc.Value(max(u0, min(u1, u)))
        normal, _ = nface.normalAt(uv.X(), uv.Y())
        return normal

    def direction(u):
        t = neck.DN(max(u0, min(u1, u)), 1)
        tangent = cq.Vector(t.X(), t.Y(), t.Z())
        result = nnormal(u).cross(tangent).normalized() * derivative_length
        if result.y < 0:
            result = -result
        return np.array(result.toTuple())

    def direction_derivative(u):
        eps = 1e-06 * span
        a = max(u0, u - eps)
        b = min(u1, u + eps)
        return (direction(b) - direction(a)) / (b - a)
    raw = []
    centre = footprint_y_max / 2
    bw = m.SECTION.envelope_wire(p.mast_outer_w, p.mast_outer_h, p.silicone_gap + p.front_bracing_side_t)
    for e in bw.Edges():
        b = e.BoundingBox()
        if b.xmin < 20 or b.ymax <= 0 or b.ymin >= footprint_y_max:
            continue
        c = BRep_Tool.Curve_s(e.wrapped, 0.0, 0.0).Copy()
        if c.Value(c.FirstParameter()).Y() > c.Value(c.LastParameter()).Y():
            c.Reverse()
        raw.append((max(0, c.Value(c.FirstParameter()).Y()), min(footprint_y_max, c.Value(c.LastParameter()).Y()), c))
    raw.sort(key=lambda r: r[0])
    source_curve_joints = [end for _, end, _ in raw[:-1]]
    cuts = {au(neck.Knot(i)) for i in range(1, neck.NbKnots() + 1)}
    for angle in np.linspace(-4 * math.pi, 6 * math.pi, 161):
        if phase < angle < phase + 2 * math.pi:
            cuts.add(float(angle))
    for _, y, _ in raw[:-1]:
        theta = math.acos(1 - y / centre)
        for k in range(-3, 4):
            for angle in (theta + 2 * k * math.pi, -theta + 2 * k * math.pi):
                if phase < angle < phase + 2 * math.pi:
                    cuts.add(angle)
    cuts = sorted(cuts)
    cuts = [a for i, a in enumerate(cuts) if i == 0 or a - cuts[i - 1] > 1e-10]

    def fit_neck_direction(a, b):
        na, nb = (ua(a), ua(b))
        ga, gb = ((a - phase) / (2 * math.pi), (b - phase) / (2 * math.pi))
        d0, d1 = (direction(na), direction(nb))
        dd0 = direction_derivative(na) * up.deriv()(ga) * (gb - ga)
        dd1 = direction_derivative(nb) * up.deriv()(gb) * (gb - ga)
        ds = [hermite(d0[k], d1[k], dd0[k], dd1[k]) for k in range(3)]
        error = 0.0
        for t in (0.1, 0.25, 0.5, 0.75, 0.9):
            u = up(ga + t * (gb - ga))
            v = neck.DN(u, 1)
            ct = cq.Vector(v.X(), v.Y(), v.Z())
            d = cq.Vector(*(float(poly(t)) for poly in ds))
            normal = ct.cross(d).normalized()
            # Separate Hermite interpolation error from the native section
            # curve's small derivative representation error. The final
            # root-to-node normal discrepancy is still limited to 0.5 deg.
            expected = ct.cross(cq.Vector(*direction(u))).normalized()
            error = max(error, math.degrees(math.acos(min(1, abs(normal.dot(expected))))))
        return (ds, error)
    for _ in range(8):
        extra = [(a + b) / 2 for a, b in zip(cuts, cuts[1:]) if fit_neck_direction(a, b)[1] > 0.05]
        if not extra:
            break
        cuts = sorted(cuts + extra)
    else:
        unresolved=[(a,b,fit_neck_direction(a,b)[1])
                    for a,b in zip(cuts,cuts[1:]) if fit_neck_direction(a,b)[1]>.05]
        raise RuntimeError(f'Neck tangent fit did not converge: {unresolved}')
    faces = []
    base_edges = []
    neck_edges = []
    maximum_neck_angle = 0.0
    maximum_source_tangent_error = 0.0
    boundary_samples = []
    for a, b in zip(cuts, cuts[1:]):
        ya, yb = (centre * (1 - math.cos(a)), centre * (1 - math.cos(b)))
        mid = (a + b) / 2
        ym = centre * (1 - math.cos(mid))
        c = next((c for lo, hi, c in raw if lo - 1e-07 <= ym <= hi + 1e-07)).Copy()
        c.Segment(_parameter_y(c, min(ya, yb)), _parameter_y(c, max(ya, yb)))
        if ya > yb:
            c.Reverse()
        xp = _power([c.Pole(i).X() for i in range(1, c.NbPoles() + 1)])
        yp = _power([c.Pole(i).Y() for i in range(1, c.NbPoles() + 1)])
        omega = 2 * math.sin((b - a) / 2)
        st = hermite(0, 1, centre * math.sin(a) * omega / yp.deriv()(0), centre * math.sin(b) * omega / yp.deriv()(1))
        xx, yy = (xp(st), yp(st))
        dx, dy = (xp.deriv()(st), yp.deriv()(st))

        def lam(t):
            value = 0.5 * (centre - yy(t)) / dy(t)
            derivative = 0.5 * (-yy.deriv()(t) * dy(t)
                                - (centre - yy(t)) * dy.deriv()(t)) / dy(t) ** 2
            if source_joint_blend_width <= 0:
                return value, derivative
            width2 = source_joint_blend_width ** 2
            exponents = [math.exp(-(yy(t) - joint) ** 2 / width2)
                         for joint in source_curve_joints]
            factors = [1.0 - exponent for exponent in exponents]
            weight = math.prod(factors)
            weight_dy = sum(
                math.prod(factors[:i] + factors[i + 1:])
                * 2 * (yy(t) - joint) / width2 * exponents[i]
                for i, joint in enumerate(source_curve_joints))
            return (value * weight,
                    derivative * weight + value * weight_dy * yy.deriv()(t))
        l0, ld0 = lam(0)
        l1, ld1 = lam(1)
        ll = hermite(l0, l1, ld0, ld1)
        w = _power([1, math.cos((b - a) / 2), 1])
        sn = _power([math.sin(a), math.sin(mid), math.sin(b)])
        p0 = [w * xx, w * yy, w * p.mount_center_z + footprint_z_half_height * sn]
        p1 = [w * (xx + ll * dx / 3), w * (yy + ll * dy / 3), w * p.mount_center_z + footprint_z_half_height * sn * (1 - 0.5 / 3)]
        na, nb = (ua(a), ua(b))
        nc = neck.Copy()
        nc.Segment(na, nb)
        assert nc.NbKnots() == 2 and (not nc.IsRational())
        ga, gb = ((a - phase) / (2 * math.pi), (b - phase) / (2 * math.pi))
        local_u = (up(Poly([ga, gb - ga])) - na) / (nb - na)
        p3 = [w * _power([getattr(nc.Pole(i), coord)() for i in range(1, nc.NbPoles() + 1)])(local_u) for coord in ('X', 'Y', 'Z')]
        ds, _ = fit_neck_direction(a, b)
        p2 = [p3[k] - w * ds[k] / 3 for k in range(3)]
        face, surface = patch_from_homogeneous(
            [p0, p1, p2, p3], w, foot_positive_allowance_mm)
        faces.append(face)
        neck_edge = cq.Edge(BRepBuilderAPI_MakeEdge(surface.VIso(1.0)).Edge())
        if preserve_node_pcurves:
            node_pc = pc.Copy()
            node_pc.Segment(na, nb)
            assert node_pc.NbKnots() == 2 and not node_pc.IsRational()
            uv_polynomials = [
                _power([getattr(node_pc.Pole(i), coordinate)()
                        for i in range(1, node_pc.NbPoles() + 1)])(local_u)
                for coordinate in ('X', 'Y')]
            pc_degree = max(len(poly.coef) - 1 for poly in uv_polynomials)
            uv_poles = [_bernstein(poly, pc_degree) for poly in uv_polynomials]
            points = TColgp_Array1OfPnt2d(1, pc_degree + 1)
            for index in range(pc_degree + 1):
                points.SetValue(index + 1,
                                gp_Pnt2d(uv_poles[0][index], uv_poles[1][index]))
            BRep_Builder().UpdateEdge(
                neck_edge.wrapped, Geom2d_BezierCurve(points), nface.wrapped, 1e-7)
        neck_edges.append(neck_edge)
        inside = [Poly([0]), p0[1], p0[2]]
        wall, ws = patch_from_homogeneous([p0, inside], w)
        faces.append(wall)
        base_edges.append(cq.Edge(BRepBuilderAPI_MakeEdge(ws.VIso(1.0)).Edge()))
        for t in (0.1, 0.3, 0.5, 0.7, 0.9):
            nr, _ = face.normalAt(t, 1.0)
            nn = nnormal(up(ga + t * (gb - ga)))
            angle = math.degrees(math.acos(min(1, abs(nr.dot(nn)))))
            maximum_neck_angle = max(angle, maximum_neck_angle)
            ct=neck.DN(up(ga+t*(gb-ga)),1)
            tangent=cq.Vector(ct.X(),ct.Y(),ct.Z()).normalized()
            maximum_source_tangent_error=max(maximum_source_tangent_error,
                math.degrees(math.asin(min(1,abs(tangent.dot(nn))))))
            q = surface.Value(t, 0.0)
            normal = cq.Vector(1, -dx(t) / dy(t), 0).normalized()
            boundary_samples.append({'point_mm': (q.X(), q.Y(), q.Z()), 'outward_shell_normal': normal.toTuple(), 'patch_index': len(base_edges) - 1, 'patch_parameter': t})
    faces.extend([cq.Face.makeFromWires(cq.Wire.assembleEdges(base_edges)), cq.Face.makeFromWires(cq.Wire.assembleEdges(neck_edges))])
    sew = BRepBuilderAPI_Sewing(2e-06)
    for f in faces:
        sew.Add(f.wrapped)
    sew.Perform()
    root = cq.Solid.makeSolid(cq.Shell(sew.SewedShape()))
    BRepLib.OrientClosedSolid_s(root.wrapped)
    exposed = [f for s in (root, node) for f in s.Faces() if not (f.BoundingBox().ylen < 1e-05 and abs(f.Center().y - y_neck) < 1e-05)]
    sew = BRepBuilderAPI_Sewing(2e-06)
    for f in exposed:
        sew.Add(f.wrapped)
    sew.Perform()
    full = cq.Solid.makeSolid(cq.Shell(sew.SewedShape()))
    BRepLib.OrientClosedSolid_s(full.wrapped)
    report = {'valid': full.isValid(), 'volume_mm3': full.Volume(tol=1e-08), 'patches': len(cuts) - 1, 'maximum_neck_normal_angle_deg': maximum_neck_angle, 'derivative_length_mm': derivative_length, 'original_neck_endpoint_parameter_speeds': [v0, v1], 'neck_parameter_warp_power_coefficients': list(up.coef), 'outer_boundary_samples': boundary_samples, 'node_source': 'provided node_shape'}
    report['maximum_source_intersection_tangent_error_deg']=maximum_source_tangent_error
    report['preserve_node_pcurves'] = preserve_node_pcurves
    report['source_joint_blend_width_mm'] = source_joint_blend_width
    report['source_curve_joint_y_mm'] = source_curve_joints
    report['foot_positive_allowance_mm'] = foot_positive_allowance_mm
    report['foot_positive_allowance_radial_end'] = 0.2
    projection = next((f for f in root.Faces() if f.BoundingBox().xlen < 1e-05 and f.BoundingBox().xmax < 1e-05))
    prism = cq.Solid.extrudeLinear(projection.outerWire(), [], (p.plate_w, 0, 0))
    assert root.isValid() and full.isValid() and (len(full.Solids()) == 1)
    assert maximum_neck_angle < .5, 'Actual root/node interface exceeds 0.5 degrees'
    report['raw_root_volume_mm3'] = root.Volume(tol=1e-08)
    report['footprint_y_mm'] = [0.0, footprint_y_max]
    report['footprint_z_from_centre_mm'] = [-footprint_z_half_height, footprint_z_half_height]
    report['neck_y_mm'] = y_neck
    report['geometry'] = 'Exact shell boundary; actual node section; closed-curve speed matching; adaptive Hermite tangent fit'
    return {'raw_root': root, 'root_node': full, 'footprint_prism': prism, 'clipped_node': node, 'report': report}

def cut_saddle_footprints(model, prisms):
    """Remove exact projected footprints before the root skin is attached."""
    shell = model.make_front_bracing_shell(model.P).val()
    for prism in prisms:
        if isinstance(prism, cq.Workplane):
            prism = prism.val()
        shell = shell.cut(prism)
    result = shell.clean()
    assert result.isValid()
    return result

def check_root_seams(model, shape, neck_y=34.0, footprint_y_max=30.0,
                     footprint_z_half_height=15.0):
    """Sample root seams on a finished saddle, including the actual neck seam.

    Call after footprint subtraction, inner trimming and saddle attachment.
    Raw roots still have temporary inward walls that meet the skin at sharp
    edges; those walls are absent from the completed solid.
    """
    p = model.P
    adjacency = TopTools_IndexedDataMapOfShapeListOfShape()
    TopExp.MapShapesAndAncestors_s(shape.wrapped, TopAbs_EDGE, TopAbs_FACE, adjacency)
    rows = []
    for index in range(1, adjacency.Extent() + 1):
        edge = cq.Edge(adjacency.FindKey(index))
        box = edge.BoundingBox()
        if box.ymax < -0.001 or box.ymin > max(footprint_y_max, neck_y) + 0.001 or box.xmax < 20:
            continue
        faces = [cq.Face(f) for f in adjacency.FindFromIndex(index)]
        if len(faces) != 2:
            continue
        samples = []
        for f in (0.1, 0.3, 0.5, 0.7, 0.9):
            q = edge.positionAt(f)
            if (not -1e-05 <= q.y <= max(footprint_y_max, neck_y) + 1e-05
                    or abs(q.z - p.mount_center_z) > footprint_z_half_height + 0.0001):
                continue
            x = model.SECTION.right_x_at_y(p.mast_outer_w, p.mast_outer_h, max(0, q.y), p.silicone_gap + p.front_bracing_side_t)
            if q.x < x - 0.001:
                continue
            n1, n2 = [face.normalAt(q) for face in faces]
            angle = math.degrees(math.acos(max(-1, min(1, n1.dot(n2)))))
            samples.append({'point_mm': q.toTuple(), 'angle_deg': angle})
        if samples:
            rows.append({'edge_index': index, 'maximum_angle_deg': max((s['angle_deg'] for s in samples)), 'surface_types': [f.geomType() for f in faces], 'samples': samples})
    return {'maximum_join_normal_angle_deg': max((r['maximum_angle_deg'] for r in rows)), 'sampled_outer_seams': rows}
