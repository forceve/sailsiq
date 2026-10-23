"""Native, symmetric Y junction with a single fair quartic cross-Z surface.

The distal arms retain the established V4/V5 geometry.  Only their Z=+/-20 mm
sections are fitted to a common periodic cubic representation.  The central
section and the two distal position/tangent conditions determine one even
quartic XY(z) patch, with no intermediate Z knots or overlapping branch solids.

This module does not establish structural strength or a measured rope envelope.
The annular root must use the actual node section, not an assumed elliptical neck.
"""
from dataclasses import dataclass
from math import acos, comb, degrees, sqrt

import cadquery as cq
from OCP.BRep import BRep_Tool
from OCP.BRepAlgoAPI import BRepAlgoAPI_Section
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections
from OCP.Geom import Geom_BSplineSurface
from OCP.TColgp import TColgp_Array2OfPnt
from OCP.TColStd import TColStd_Array1OfInteger, TColStd_Array1OfReal
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE
from OCP.TopExp import TopExp
from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape
from OCP.gp import gp_Dir, gp_Pln, gp_Pnt


@dataclass(frozen=True)
class JunctionParameters:
    join_half_height: float = 20.0
    profile_samples: int = 384
    profile_fit_limit: float = 0.0001
    tangent_epsilon: float = 0.01
    join_fuzzy_tolerance: float = 0.0001
    central_rear_y: float = 14.0
    central_front_y: float = 40.0
    neck_y: float = 34.0
    neck_center_offset: float = 7.0
    neck_half_width: float = 5.0
    central_shear: float = 0.7


def _design(design):
    if design is None:
        # Lazy import permits tree_bracing to call this module during integration.
        from tree_bracing import DESIGN
        return DESIGN
    return design


def _ellipse_loft(stations):
    builder = BRepOffsetAPI_ThruSections(True, False, 1e-7)
    builder.SetMaxDegree(3)
    for x, y, z, width, height in stations:
        plane = cq.Plane(origin=(x, y, z), xDir=(1, 0, 0), normal=(0, 1, 0))
        builder.AddWire(cq.Workplane(plane).ellipse(width/2, height/2).val().wrapped)
    builder.Build()
    if not builder.IsDone():
        raise RuntimeError("Reference distal-arm loft failed")
    return cq.Shape.cast(builder.Shape())


def reference_upper(model, design=None):
    """Retain each boat's established distal arm and panel-edge terminal."""
    p, d = model.P, _design(design)
    zc = p.mount_center_z
    outer = lambda y: model.SECTION.right_x_at_y(
        p.mast_outer_w, p.mast_outer_h, y, p.silicone_gap+p.front_bracing_side_t)
    end_x = max(p.plate_w/2-d.edge_inset,
                p.outer_rx+d.rope_lane_from_mast_half_width+d.rope_envelope_width/2
                +d.rope_clearance+d.terminal_width/2)
    return _ellipse_loft([
        (outer(24)+0.3, 24, zc+2, 5, 12),
        (outer(28)+5, 34, zc+5, 10, 16),
        (outer(d.root_y)+14, 44, zc+13, 10, 16),
        (end_x-5, 53, zc+25, d.branch_width, d.branch_height),
        (end_x, p.plate_back_y-22, zc+38, 10, 14),
        (end_x, p.plate_back_y-12, zc+d.tip_z-2, 11, 19),
        (end_x, p.plate_back_y-5, zc+d.tip_z, 13, 27),
        (end_x, p.plate_back_y-0.5, zc+d.tip_z, 16, 36),
        (end_x, p.plate_back_y+1.5, zc+d.tip_z, d.terminal_width, d.terminal_height),
    ])


def _horizontal_section(shape, z):
    section = BRepAlgoAPI_Section(
        shape.wrapped, gp_Pln(gp_Pnt(0, 0, z), gp_Dir(0, 0, 1)), False)
    # Otherwise OCCT returns a degree-one polygon, unsuitable for tangent fitting.
    section.Approximation(True)
    section.Build()
    edges = cq.Shape.cast(section.Shape()).Edges()
    if len(edges) != 1:
        raise ValueError(f"Expected one closed distal section edge, got {len(edges)}")
    wire = cq.Wire.assembleEdges(edges)
    if not wire.IsClosed():
        raise ValueError("Distal section is not closed")
    return wire


def _common_profile(wire, q, measure=True):
    """Fit the same periodic cubic basis; report a sampled geometric error."""
    edge = wire.Edges()[0]
    n = q.profile_samples
    points = edge.positions([i/n for i in range(n)])
    signed_area = sum(p.x*r.y-r.x*p.y for p, r in zip(points, points[1:]+points[:1]))
    if signed_area < 0:
        points = [points[0]]+points[:0:-1]
    fitted = cq.Edge.makeSpline(points, periodic=True,
                               parameters=[i/n for i in range(n+1)], tol=1e-8)
    error = None
    if measure:
        # Interstitial samples avoid falsely proving accuracy at interpolation nodes.
        fractions = [(i+0.5)/(4*n) for i in range(4*n)]
        error = max(fitted.distance(cq.Vertex.makeVertex(*point.toTuple()))
                    for point in edge.positions(fractions))
        if error >= q.profile_fit_limit:
            raise ValueError(f"Section fit error {error:.9g} >= {q.profile_fit_limit} mm")
    return cq.Wire.assembleEdges([fitted]), error


def _curve(wire):
    return BRep_Tool.Curve_s(wire.Edges()[0].wrapped, 0, 0)


def _quartic_node(mid_wire, end_wire, derivatives, zc, half_height):
    mid, end = _curve(mid_wire), _curve(end_wire)
    if mid.NbPoles() != end.NbPoles():
        raise ValueError("Central and distal profiles have incompatible bases")
    poles = TColgp_Array2OfPnt(1, mid.NbPoles(), 1, 5)
    length = half_height
    for i in range(1, mid.NbPoles()+1):
        p0, p1 = mid.Pole(i), end.Pole(i)
        xy = []
        for c0, cend, dend in zip((p0.X(), p0.Y()), (p1.X(), p1.Y()), derivatives[i-1]):
            delta = cend-c0
            c2 = (4*delta-length*dend)/(2*length**2)
            c4 = (length*dend-2*delta)/(2*length**4)
            # p(z)=c0+c2*z^2+c4*z^4; map z=length*(2*t-1) to Bernstein.
            a, b = c2*length**2, c4*length**4
            power = (c0+a+b, -4*a-8*b, 4*a+24*b, -32*b, 16*b)
            xy.append([sum(power[j]*comb(k, j)/comb(4, j) for j in range(k+1))
                       for k in range(5)])
        for k in range(5):
            poles.SetValue(i, k+1, gp_Pnt(xy[0][k], xy[1][k], zc-length+length*k/2))
    vk, vm = TColStd_Array1OfReal(1, 2), TColStd_Array1OfInteger(1, 2)
    vk.SetValue(1, 0); vk.SetValue(2, 1)
    vm.SetValue(1, 5); vm.SetValue(2, 5)
    surface = Geom_BSplineSurface(poles, mid.Knots(), vk, mid.Multiplicities(), vm,
                                 mid.Degree(), 4, mid.IsPeriodic(), False)
    side = cq.Face(BRepBuilderAPI_MakeFace(surface, 1e-7).Face())
    caps = [cq.Face.makeFromWires(end_wire),
            cq.Face.makeFromWires(end_wire.mirror("XY", (0, 0, zc)))]
    return cq.Solid.makeSolid(cq.Shell.makeShell([side]+caps))


def build(model, params=None, *, design=None, include_combined=True, measure=True):
    """Return reference_upper/node/outer/combined/report without file side effects.

    ``params`` accepts JunctionParameters or a mapping of its fields.  Set
    include_combined=False when only the node and reference upper arm are needed.
    Every reported volume uses adaptive integration; default CAD Volume is not
    accurate enough for this large trimmed spline surface.
    """
    q = params if isinstance(params, JunctionParameters) else JunctionParameters(**(params or {}))
    if q.profile_samples < 32 or q.join_half_height <= 0 or q.tangent_epsilon <= 0:
        raise ValueError("Invalid junction sampling or dimensions")
    if not q.central_rear_y < q.neck_y < q.central_front_y:
        raise ValueError("Neck plane must cross the central ellipse")
    p, zc = model.P, model.P.mount_center_z
    upper = reference_upper(model, design)
    anchor = model.SECTION.right_x_at_y(p.mast_outer_w, p.mast_outer_h, 28,
                                        p.silicone_gap+p.front_bracing_side_t)
    cy = (q.central_rear_y+q.central_front_y)/2
    ry = (q.central_front_y-q.central_rear_y)/2
    rx = q.neck_half_width*ry/sqrt((q.neck_y-q.central_rear_y)*(q.central_front_y-q.neck_y))
    cx = anchor+q.neck_center_offset-q.central_shear*(q.neck_y-cy)
    mid = cq.Workplane("XY").ellipse(rx, ry).val().transformGeometry(cq.Matrix([
        [1, q.central_shear, 0, cx], [0, 1, 0, cy], [0, 0, 1, zc], [0, 0, 0, 1]]))
    mid, mid_error = _common_profile(mid, q, measure)
    end, end_error = _common_profile(_horizontal_section(upper, zc+q.join_half_height), q, measure)
    eps = q.tangent_epsilon
    neighbors = [_curve(_common_profile(_horizontal_section(
        upper, zc+q.join_half_height+dz), q, False)[0]) for dz in (-eps, eps)]
    derivatives = []
    for i in range(1, neighbors[0].NbPoles()+1):
        a, b = [curve.Pole(i) for curve in neighbors]
        derivatives.append(((b.X()-a.X())/(2*eps), (b.Y()-a.Y())/(2*eps)))
    node = _quartic_node(mid, end, derivatives, zc, q.join_half_height)
    if not node.isValid() or len(node.Solids()) != 1:
        raise ValueError("Quartic node is not a valid single solid")
    outer = combined = None
    if include_combined:
        outer = upper.intersect(cq.Solid.makeBox(300, 300, 200,
                                cq.Vector(-100, -100, zc+q.join_half_height)))
        combined = node.fuse(outer, outer.mirror("XY", (0, 0, zc)),
                             tol=q.join_fuzzy_tolerance).clean()
        if not combined.isValid() or len(combined.Solids()) != 1:
            raise ValueError("Node and distal branches did not form one valid solid")
    report = {
        "construction": "single symmetric quartic XY(z), periodic cubic U, no internal V knots",
        "join_half_height_mm": q.join_half_height,
        "profile_samples": q.profile_samples,
        "sampled_profile_error_mm": {"central": mid_error, "distal": end_error},
        "tangent_difference_step_mm": eps,
        "join_fuzzy_tolerance_mm": q.join_fuzzy_tolerance,
        "central_section": {"center_x": cx, "center_y": cy, "radius_x": rx,
                            "radius_y": ry, "xy_shear": q.central_shear},
        "volume_adaptive_1e_8_mm3": {"node": node.Volume(tol=1e-8)},
    }
    if combined is not None:
        report["volume_adaptive_1e_8_mm3"]["combined"] = combined.Volume(tol=1e-8)
    return {"reference_upper": upper, "node": node, "outer": outer,
            "combined": combined, "report": report}


def validate_distal_seams(shape, center_z, half_height=20.0, samples=199):
    """Measure actual adjacent face normals around both assembled distal seams."""
    adjacency = TopTools_IndexedDataMapOfShapeListOfShape()
    TopExp.MapShapesAndAncestors_s(shape.wrapped, TopAbs_EDGE, TopAbs_FACE, adjacency)
    seams = []
    for index in range(1, adjacency.Extent()+1):
        edge = cq.Edge(adjacency.FindKey(index))
        faces = [cq.Face(face) for face in adjacency.FindFromIndex(index)]
        bb = edge.BoundingBox()
        if (len(faces) != 2 or bb.zlen > 0.01
                or abs(abs(bb.zmin-center_z)-half_height) > 0.01):
            continue
        angles = []
        for i in range(1, samples+1):
            point = edge.positionAt(i/(samples+1))
            a, b = [face.normalAt(point) for face in faces]
            angles.append(degrees(acos(max(-1.0, min(1.0, a.dot(b))))))
        seams.append({"edge_index": index, "z": (bb.zmin+bb.zmax)/2,
                      "length_mm": edge.Length(), "samples": samples,
                      "maximum_normal_angle_deg": max(angles)})
    if len(seams) != 2:
        raise ValueError(f"Expected two complete distal seams, found {len(seams)}")
    maximum = max(row["maximum_normal_angle_deg"] for row in seams)
    return {"pass": maximum < 0.5, "threshold_deg": 0.5,
            "maximum_normal_angle_deg": maximum, "seams": seams}
