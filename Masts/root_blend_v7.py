"""Whole-perimeter rolling root blends on the original fair V6 fork.

The ball radius describes the rolling cross sections, not both principal
curvatures of the resulting surface. No geometry is loaded or exported here.
"""
import math
from types import SimpleNamespace

import cadquery as cq
from OCP.BRep import BRep_Tool, BRep_Builder
from OCP.BRepTools import BRepTools
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_Sewing
from OCP.BRepLib import BRepLib
from OCP.GeomLProp import GeomLProp_SLProps
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_REVERSED
from OCP.TopExp import TopExp
from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape
from OCP.TopLoc import TopLoc_Location


def split_parameter_seams(shape):
    """Make existing G1/C0-parameter joins explicit, without changing surfaces."""
    result_faces, changes = [], []
    for index, face in enumerate(shape.Faces(), 1):
        if face.geomType() != 'BSPLINE':
            result_faces.append(face)
            continue
        surface = BRep_Tool.Surface_s(face.wrapped)
        u0, u1, v0, v1 = BRepTools.UVBounds_s(face.wrapped)
        knots = [surface.VKnot(j) for j in range(2, surface.NbVKnots())
                 if surface.VMultiplicity(j) >= surface.VDegree()
                 and v0 < surface.VKnot(j) < v1]
        if not knots:
            result_faces.append(face)
            continue
        if len(face.Wires()) != 1:
            raise ValueError('Cannot split a nonrectangular fillet face')
        for edge in face.Edges():
            pc = BRep_Tool.CurveOnSurface_s(edge.wrapped, face.wrapped, 0., 0.)
            curve = edge._geomAdaptor()
            a, b = curve.FirstParameter(), curve.LastParameter()
            pts = [pc.Value(a+(b-a)*i/8) for i in range(9)]
            if (max(q.X() for q in pts)-min(q.X() for q in pts) > 1e-6
                    and max(q.Y() for q in pts)-min(q.Y() for q in pts) > 1e-6):
                raise ValueError('Fillet subdivision requires an exact rectangular parameter domain')
        cuts = [v0]+knots+[v1]
        pieces, deviation = [], 0.0
        for a, b in zip(cuts, cuts[1:]):
            piece = surface.Copy()
            piece.Segment(u0, u1, a, b)
            pieces.append(piece)
            for i in range(9):
                for j in range(17):
                    u, v = u0+(u1-u0)*i/8, a+(b-a)*j/16
                    deviation = max(deviation, surface.Value(u,v).Distance(piece.Value(u,v)))
            fresh = cq.Face(BRepBuilderAPI_MakeFace(piece, 1e-7).Face())
            if face.wrapped.Orientation() == TopAbs_REVERSED:
                fresh.wrapped.Reverse()
            result_faces.append(fresh)
        angle = 0.0
        for left, right, v in zip(pieces, pieces[1:], knots):
            for i in range(129):
                u = u0+(u1-u0)*i/128
                nl = GeomLProp_SLProps(left,u,v,1,1e-10).Normal()
                nr = GeomLProp_SLProps(right,u,v,1,1e-10).Normal()
                angle = max(angle, math.degrees(nl.Angle(nr)))
        if deviation > 1e-9 or angle > .01:
            raise ValueError('Parameter seam subdivision changed geometry or contains a real sharp join')
        changes.append({'face_index':index, 'split_v_parameters':knots,
                        'pieces':len(pieces), 'maximum_surface_gap_mm':deviation,
                        'maximum_split_normal_angle_deg':angle})
    if not changes:
        return shape, changes
    sew = BRepBuilderAPI_Sewing(1e-6)
    for face in result_faces:
        sew.Add(face.wrapped)
    sew.Perform()
    if sew.NbFreeEdges() or sew.NbMultipleEdges():
        raise ValueError('Exact fillet seam subdivision did not close')
    result = cq.Solid.makeSolid(cq.Shell(sew.SewedShape()))
    BRepLib.OrientClosedSolid_s(result.wrapped)
    if not result.isValid() or len(result.Solids()) != 1:
        raise ValueError('Invalid solid after exact fillet seam subdivision')
    return result, changes


def trim_external_curve_knots(shape):
    """Remove unused C0 curve domains outside actual edges, preserving geometry.

    Some later booleans retain the untrimmed parent of a continuous edge.
    The native continuity checker also inspects that unused parent. Restricting
    its exact BSpline to the existing edge interval changes neither topology
    nor parameter values, and is not an approximation or tolerance repair.
    """
    result=shape.copy(mesh=True)
    builder=BRep_Builder();rows=[]
    for index,edge in enumerate(result.Edges(),1):
        curve=BRep_Tool.Curve_s(edge.wrapped,0.,0.)
        if not hasattr(curve,'NbKnots'):continue
        adaptor=edge._geomAdaptor();a,b=adaptor.FirstParameter(),adaptor.LastParameter()
        knots=[curve.Knot(i) for i in range(2,curve.NbKnots())
               if curve.Multiplicity(i)>=curve.Degree()]
        if not knots or any(a+1e-10<k<b-1e-10 for k in knots):continue
        clipped=curve.Copy();clipped.Segment(a,b)
        deviation=max(curve.Value(a+(b-a)*i/32).Distance(
                      clipped.Value(a+(b-a)*i/32)) for i in range(33))
        if deviation>1e-9:raise ValueError('Exact edge restriction changed curve positions')
        builder.UpdateEdge(edge.wrapped,clipped,TopLoc_Location(),
                           BRep_Tool.Tolerance_s(edge.wrapped))
        rows.append({'edge_index':index,'actual_parameter_range':[a,b],
                     'unused_or_boundary_C0_parameters':knots,
                     'maximum_corresponding_curve_gap_mm':deviation})
    if not result.isValid():raise ValueError('Exact edge domain restriction invalidated shape')
    return result,rows


def _root_edges(model, p, shape):
    adjacency = TopTools_IndexedDataMapOfShapeListOfShape()
    TopExp.MapShapesAndAncestors_s(shape.wrapped, TopAbs_EDGE, TopAbs_FACE, adjacency)
    selected, rows = [], []
    for i in range(1, adjacency.Extent()+1):
        edge = cq.Edge(adjacency.FindKey(i))
        faces = [cq.Face(f) for f in adjacency.FindFromIndex(i)]
        point = edge.positionAt(.5)
        if (len(faces) != 2 or abs(point.x) < 20 or not 0 < point.y < 45
                or abs(point.z-p.mount_center_z) >= 25
                or sorted(f.geomType() for f in faces) != ['BSPLINE','EXTRUSION']):
            continue
        errors = []
        for t in (.1,.5,.9):
            q = edge.positionAt(t)
            x = model.SECTION.right_x_at_y(p.mast_outer_w,p.mast_outer_h,q.y,
                                          p.silicone_gap+p.front_bracing_side_t)
            errors.append(abs(abs(q.x)-x))
        normal_a, normal_b = [f.normalAt(point) for f in faces]
        angle = math.degrees(math.acos(max(-1,min(1,normal_a.dot(normal_b)))))
        if max(errors) < .02 and angle > 2:
            selected.append(edge)
            rows.append({'edge_index':i, 'side':1 if point.x > 0 else -1,
                         'length_mm':edge.Length(), 'maximum_shell_gap_mm':max(errors),
                         'original_angle_deg':angle})
    for side in (-1,1):
        edges = [edge for edge,row in zip(selected,rows) if row['side']==side]
        if not edges or not cq.Wire.assembleEdges(edges).IsClosed():
            raise ValueError(f'Root/shell intersection is not one closed perimeter on side {side}')
    return selected, rows


def build(model, p=None, d=None, *, fork_geometry=None, radius=5.0, symmetric_seed=False):
    """Return ``shell_and_supports`` (CQ Shape), ``report`` and ``fork_report``.

    The returned solid already contains the complete saddle shell and both
    original fair V6 forks. Add the panel and strap guides to this body; do not
    re-add the old annular roots. ``fork_geometry`` optionally accepts a supplied
    branch_junction result or its right-hand combined solid for cached builds.
    Representation-error normalization and final strict BOP belong to export.
    """
    p = p or model.P
    if d is None:
        from tree_bracing import DESIGN
        d = DESIGN
    if radius <= 0:
        raise ValueError('Root rolling radius must be positive')
    if fork_geometry is None:
        from branch_junction import build as build_fork
        context = SimpleNamespace(P=p, SECTION=model.SECTION)
        params = {'join_half_height':d.fork_join_half_height}
        name = getattr(model, '__name__', '')
        if name.startswith(('fareast23r','fareast28r')):
            params.update(central_rear_y=d.root_rear_y_selden,
                          neck_center_offset=d.root_neck_offset_selden)
        if name.startswith('fareast23r'):
            params['central_shear'] = d.root_shear_23r
        fork_geometry = build_fork(context, params,
                                   design=d, include_combined=True, measure=True)
        fork_geometry['report']['root_section_parameters'] = params
    if isinstance(fork_geometry, dict):
        fork = fork_geometry['combined']
        fork_report = fork_geometry.get('report', {})
    else:
        fork, fork_report = fork_geometry, {'source':'caller-provided original fair fork'}
    if isinstance(fork, cq.Workplane):
        fork = fork.val()
    shell = model.make_front_bracing_shell(p).val()
    inside = model.SECTION.envelope_solid(p.mast_outer_w,p.mast_outer_h,
        p.bracket_z_h+10,p.silicone_gap).translate(
        (0,0,p.mount_center_z-p.bracket_z_h/2-5)).val()
    base = shell.fuse(fork, fork.mirror('YZ')).cut(inside).clean()
    if not base.isValid() or len(base.Solids()) != 1:
        raise ValueError('Original fair forks and saddle did not form one solid')
    edges, intersections = _root_edges(model,p,base)
    if symmetric_seed:
        # OCCT's contour walking depends on the seed and its orientation at
        # the C126 profile join. Build one complete closed loop from the
        # stable heel seed, then mirror the exact half for equal left/right
        # geometry. The radius and original saddle surfaces are unchanged.
        seed = max(((edge,row) for edge,row in zip(edges,intersections)
                    if row['side'] == -1), key=lambda item:item[1]['original_angle_deg'])[0]
        half = base.fillet(radius, [seed]).intersect(cq.Solid.makeBox(
            p.plate_w+50, 2*p.mast_outer_h+100, p.bracket_z_h+20,
            (-p.plate_w-50,-p.mast_outer_h-50,p.mount_center_z-p.bracket_z_h/2-10)))
        blended = half.fuse(half.mirror('YZ')).clean()
    else:
        blended = base.fillet(radius, edges)
    if not blended.isValid() or len(blended.Solids()) != 1:
        raise ValueError(f'Whole-perimeter R{radius:g} root blend failed')
    result, subdivisions = split_parameter_seams(blended)
    return {'shell_and_supports':result, 'fork_report':fork_report,
            'report':{'method':'rolling ball over actual closed shell/fork intersection',
                      'rolling_radius_mm':radius, 'closed_root_perimeters':2,
                      'symmetric_single_contour_construction':symmetric_seed,
                      'intersection_edges':intersections,
                      'exact_parameter_seam_subdivisions':subdivisions,
                      'valid':True, 'solids':1,
                      'radius_scope':'rolling cross sections; not a bound on both principal curvatures'}}
