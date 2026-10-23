"""Shared, explicit variable-section tree support for the three mast mounts.

This is an engineering concept, not a numerically topology-optimised or
load-qualified part. Dimensions are millimetres; ellipse dimensions below are
full transverse X/Z diameters, not dimensions normal to a curved centreline.
"""
from dataclasses import dataclass
from functools import lru_cache
import cadquery as cq


@dataclass(frozen=True)
class TreeDesign:
    revision: str = "tree-v7"
    root_y: float = 6.0
    root_blend_radius: float = 5.0
    root_blend_radius_23r: float = 4.0
    root_rear_y_selden: float = 24.0
    root_neck_offset_selden: float = 5.0
    root_shear_23r: float = 0.4
    fork_join_half_height: float = 20.0
    branch_width: float = 10.0
    branch_height: float = 14.0
    edge_inset: float = 6.0
    tip_z: float = 42.0
    terminal_width: float = 17.0
    terminal_height: float = 38.0
    node_blend_radius: float = 2.0
    perimeter_radius: float = 0.6
    screw_reference_setback: float = 4.0  # Reference fastener position only.
    saddle_height: float = 128.0
    panel_crown_clearance: float = 14.2
    strap_running_clearance: float = 0.8
    guide_clearance: float = 1.0
    guide_height: float = 2.4
    guide_projection: float = 2.0
    inner_guide_end_y: float = 12.0
    rope_nominal_diameter: float = 10.0
    rope_lane_from_mast_half_width: float = 14.0
    rope_envelope_width: float = 24.0
    rope_envelope_depth: float = 20.0
    rope_clearance: float = 2.0
    panel_pocket_width: float = 108.0
    panel_pocket_height: float = 82.0
    panel_pocket_depth: float = 0.8


DESIGN = TreeDesign()


def clean_binary_stl(path):
    """Remove only triangles collapsed by STL's float32 coordinate rounding.

    Coincident vertices make these facets exactly zero-area; retaining them
    produces non-manifold edge incidence despite an otherwise closed mesh.
    No nonzero triangle or vertex coordinate is modified.
    """
    from pathlib import Path
    import hashlib
    import json
    import numpy as np
    path = Path(path)
    data = path.read_bytes()
    count = int.from_bytes(data[80:84], "little")
    assert len(data) == 84+50*count
    dtype = np.dtype([("normal", "<f4", 3), ("vertices", "<f4", (3, 3)), ("attr", "<u2")])
    records = np.frombuffer(data, dtype=dtype, offset=84, count=count)
    v = records["vertices"]
    degenerate = ((v[:, 0] == v[:, 1]).all(axis=1) | (v[:, 1] == v[:, 2]).all(axis=1)
                  | (v[:, 2] == v[:, 0]).all(axis=1))
    kept = records[~degenerate]
    path.write_bytes(data[:80]+len(kept).to_bytes(4, "little")+kept.tobytes())
    path.with_suffix(".mesh.json").write_text(json.dumps({
        "zero_area_float32_facets_removed": int(degenerate.sum()),
        "triangles": len(kept), "coordinates_modified": False,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}, indent=2), encoding="utf-8")


def export_print_mesh(shape, path):
    cq.exporters.export(shape, str(path), tolerance=0.06, angularTolerance=0.1)
    clean_binary_stl(path)


def export_native_shape(shape, path):
    """Export diagnosed, locally consistent BREP without moving geometry.

    FreeCAD's subsequent native review is mandatory. STEP and STL still use
    the same unchanged 3D curves/surfaces; this only records local edge accuracy.
    """
    from pathlib import Path
    import json
    from normalize_cad_edges import normalize_shape
    if isinstance(shape, cq.Workplane):
        shape = shape.val()
    from root_blend_v7 import trim_external_curve_knots
    # A BREP round trip makes shared curve handles deterministic before local
    # representation normalization. No surface or curve is refitted here.
    import tempfile
    with tempfile.TemporaryDirectory(prefix='sailsiq-native-') as tmp:
        raw = Path(tmp)/'raw.brep'
        assert shape.exportBrep(str(raw))
        shape = cq.Shape.importBrep(str(raw))
    shape, restrictions = trim_external_curve_knots(shape)
    # Diagnose representation here; the final FreeCAD review and reopen checks
    # still run the complete BOP analysis, including self-intersection.
    normalized, report = normalize_shape(shape, representation_only=True)
    report['exact_parent_curve_domain_restrictions'] = restrictions
    path = Path(path)
    assert normalized.exportBrep(str(path))
    path.with_suffix('.normalization.json').write_text(
        json.dumps(report, indent=2), encoding='utf-8')


def plate_back_y(p, d=DESIGN):
    # Keep the existing panel station. J80's ropes run near the OLD lateral
    # connectors, not at the mast crown. Side clearances are checked in CAD.
    return p.outer_ry + p.silicone_gap + p.front_bracing_side_t + d.panel_crown_clearance


def rope_envelope(p, d=DESIGN):
    yc = p.plate_back_y - d.rope_clearance - d.rope_envelope_depth/2
    lanes = [cq.Workplane("XY").box(d.rope_envelope_width, d.rope_envelope_depth,
             p.bracket_z_h + 80).translate((side*(p.outer_rx+d.rope_lane_from_mast_half_width), yc, p.mount_center_z)).val()
             for side in (-1, 1)]
    return cq.Workplane("XY").add(cq.Compound.makeCompound(lanes))


def rope_reference(p, d=DESIGN):
    yc = p.plate_back_y - d.rope_clearance - d.rope_envelope_depth/2
    ropes = [cq.Workplane("XY").circle(d.rope_nominal_diameter/2).extrude(
        p.bracket_z_h + 70).translate((side*(p.outer_rx+d.rope_lane_from_mast_half_width), yc,
        p.mount_center_z-p.bracket_z_h/2-35)).val() for side in (-1, 1)]
    return cq.Workplane("XY").add(cq.Compound.makeCompound(ropes))


def _loft(stations):
    wires = []
    for x, y, z, width, height in stations:
        plane = cq.Plane(origin=(x, y, z), xDir=(1, 0, 0), normal=(0, 1, 0))
        wires.append(cq.Workplane(plane).ellipse(width/2, height/2).val())
    from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections
    builder = BRepOffsetAPI_ThruSections(True, False, 1e-7)
    builder.SetMaxDegree(3)
    for wire in wires:
        builder.AddWire(wire.wrapped)
    builder.Build()
    return cq.Workplane("XY").add(cq.Shape.cast(builder.Shape()))


@lru_cache(maxsize=12)
def junction_geometry(model, p, d=DESIGN):
    """Whole saddle and fair forks, blended on their two real closed intersections."""
    from root_blend_v7 import build
    radius = d.root_blend_radius_23r if model.__name__.startswith('fareast23r') else d.root_blend_radius
    result = build(model, p, d, radius=radius)
    return {'supports': result['shell_and_supports'],
            'root_report': result['report'], 'fork_report': result['fork_report']}


def make_supports(model, p, d=DESIGN):
    """Two shared roots with integral forks; no intersecting oval arm bases."""
    return cq.Workplane('XY').add(junction_geometry(model, p, d)['supports'])


def make_strap_guides(p, section, d=DESIGN):
    # Rounded-ended guide strips, with a continuous overlap into the saddle.
    # End fillets run parallel to Z; avoid tiny coincident toroidal faces at
    # the curved saddle interface.
    offset = p.silicone_gap+p.front_bracing_side_t-0.5
    outer = section.envelope_wire(p.mast_outer_w, p.mast_outer_h, offset+d.guide_projection+0.5)
    inner = section.envelope_wire(p.mast_outer_w, p.mast_outer_h, offset)
    rail = cq.Workplane("XY").add(cq.Solid.extrudeLinear(outer, [inner], (0, 0, d.guide_height)))
    clip = cq.Workplane("XY").box(p.mast_outer_w+40, 31, d.guide_height+2).translate((0, 20.5, d.guide_height/2))
    raw_rail = rail
    rail = raw_rail.intersect(clip)
    rounded = []
    for solid in rail.solids().vals():
        edges = [e for e in solid.Edges() if e.BoundingBox().zlen > d.guide_height-1e-4
                 and e.BoundingBox().xlen < 1e-4 and e.BoundingBox().ylen < 1e-4]
        rounded.append(solid.fillet(0.6, edges))
    rail = cq.Workplane("XY").add(cq.Compound.makeCompound(rounded))
    # Keep the inner locating tabs behind the root footprint. A full-length
    # tab would cross the smooth root and recreate a sharp transverse seam.
    inner_clip = cq.Workplane('XY').box(p.mast_outer_w+40, d.inner_guide_end_y-5,
                                       d.guide_height+2).translate(
                                       (0,(d.inner_guide_end_y+5)/2,d.guide_height/2))
    inner_rail = raw_rail.intersect(inner_clip)
    inner_solids = []
    for solid in inner_rail.solids().vals():
        end_edges = [e for e in solid.Edges()
                     if e.BoundingBox().zlen > d.guide_height-1e-4
                     and e.BoundingBox().ylen < 1e-5
                     and e.BoundingBox().xlen < 1e-5]
        inner_solids.append(solid.fillet(.6,end_edges))
    inner_rail = cq.Workplane('XY').add(cq.Compound.makeCompound(inner_solids))
    rails = []
    for band in (-1, 1):
        for edge in (-1, 1):
            zc = p.mount_center_z+band*p.strap_spacing/2+edge*(p.strap_z_w/2+d.guide_clearance+d.guide_height/2)
            source = inner_rail if edge == -band else rail
            rails.append(source.translate((0, 0, zc-d.guide_height/2)).val())
    return cq.Workplane("XY").add(cq.Compound.makeCompound(rails))


def screw_clearances(model, p):
    cutters = []
    for x, dz in model.clamp_screw_positions(p):
        cutters.append(model.cyl_y(x, p.plate_back_y-12, p.mount_center_z+dz,
                                  p.panel_screw_clearance_d/2, 20).val())
    return cq.Workplane("XY").add(cq.Compound.makeCompound(cutters))


def panel_blank(model, p):
    # Do not pre-round the rear rim or drill holes: both disrupt node blends.
    panel = (cq.Workplane("XY").rect(p.plate_w, p.plate_h).extrude(p.plate_t)
             .edges("|Z").fillet(5))
    panel = model.place_xy_solid_as_xz(panel, p.plate_back_y, p.mount_center_z)
    return relieve_panel(panel, p).val()


@lru_cache(maxsize=12)
def panel_with_continuous_branches(model, p, d=DESIGN):
    """One terminal loft per arm, blended into the panel before holes/rounding."""
    arms = make_supports(model, p, d).val()
    clip = cq.Solid.makeBox(p.plate_w, 300, p.plate_h,
                           cq.Vector(-p.plate_w/2, -100, p.mount_center_z-p.plate_h/2))
    arms = arms.intersect(clip)
    joint = arms.fuse(panel_blank(model, p)).clean()
    assert joint.isValid() and len(joint.Solids()) == 1
    blend_edges = []
    for e in joint.Edges():
        c = e.Center()
        if (e.geomType() == "BSPLINE" and abs(c.x) > p.plate_w/2-15
                and abs(c.y-p.plate_back_y) < 1e-3
                and 15 < abs(c.z-p.mount_center_z) < p.plate_h/2-3):
            blend_edges.append(e)
    assert len(blend_edges) == 8, "Review four terminal-to-panel intersection chains"
    before = joint.Volume(tol=1e-8)
    joint = joint.fillet(d.node_blend_radius, blend_edges)
    # OCC can report a malformed fillet as valid; also reject volume anomalies.
    assert joint.isValid() and before*.99 < joint.Volume(tol=1e-8) < before*1.1
    edges = []
    for e in joint.Edges():
        c, b = e.Center(), e.BoundingBox()
        on_side = (abs(abs(c.x)-p.plate_w/2) < 1e-5 and b.xlen < 1e-5
                   and b.zlen > 1e-4 and c.y < p.plate_back_y+.01)
        on_corner = (abs(c.y-p.plate_back_y) < 1e-5
                     and abs(c.z-p.mount_center_z) > p.plate_h/2-5
                     and abs(c.x) > p.plate_w/2-6)
        if on_side or on_corner:
            edges.append(e)
    assert len(edges) >= 18, "Review unified outer rim rounding"
    assert {(e.Center().x > 0, e.Center().z > p.mount_center_z) for e in edges} == {(False,False),(False,True),(True,False),(True,True)}
    before = joint.Volume(tol=1e-8)
    joint = joint.fillet(d.perimeter_radius, edges)
    assert joint.isValid() and len(joint.Solids()) == 1
    assert before*.98 < joint.Volume(tol=1e-8) <= before+1e-4
    # Restore the established front rim radius after the rear/terminal union.
    front_edges = [e for e in joint.Edges()
                   if abs(e.BoundingBox().ymin-(p.plate_back_y+p.plate_t)) < 1e-5
                   and abs(e.BoundingBox().ymax-(p.plate_back_y+p.plate_t)) < 1e-5]
    assert len(front_edges) == 8
    before = joint.Volume(tol=1e-8)
    joint = joint.fillet(0.8, front_edges)
    assert joint.isValid() and len(joint.Solids()) == 1
    assert before*.99 < joint.Volume(tol=1e-8) <= before+1e-4
    assert abs(joint.BoundingBox().xlen-p.plate_w) < 1e-4
    return joint


@lru_cache(maxsize=12)
def make_connector(model, p, d=DESIGN):
    # A display-only derived reference, never a manufacturing part. A plane
    # at the panel rear and a 0.02 mm offset outside the nominal saddle avoid
    # coincident-surface subtraction artifacts. The full bracket is unchanged.
    # Keep reference-only booleans from updating shared edge/vertex tolerances
    # of the cached manufacturing solid.
    node = panel_with_continuous_branches(model, p, d).copy(mesh=True)
    saddle_envelope = model.SECTION.envelope_solid(
        p.mast_outer_w,p.mast_outer_h,p.bracket_z_h+20,
        p.silicone_gap+p.front_bracing_side_t+.02).translate(
        (0,0,p.mount_center_z-p.bracket_z_h/2-10)).val()
    rear_halfspace = cq.Solid.makeBox(p.plate_w+100,p.plate_back_y+150,
        p.bracket_z_h+20,(-p.plate_w/2-50,-150,p.mount_center_z-p.bracket_z_h/2-10))
    node = node.intersect(rear_halfspace).cut(saddle_envelope).clean()
    assert node.isValid() and len(node.Solids()) == 2
    return cq.Workplane("XY").add(node).cut(screw_clearances(model, p))


@lru_cache(maxsize=12)
def make_integrated_bracket(model, p, d=DESIGN):
    joint = panel_with_continuous_branches(model, p, d)
    bracket = cq.Workplane("XY").add(joint).union(make_strap_guides(p, model.SECTION, d))
    bracket = bracket.cut(screw_clearances(model, p))
    assert bracket.val().isValid() and len(bracket.val().Solids()) == 1
    return bracket


def relieve_panel(panel, p, d=DESIGN):
    """Shallow rear pocket; retain an uninterrupted 2.2 mm device bearing skin."""
    plane = cq.Plane(origin=(0, p.plate_back_y-0.2, p.mount_center_z),
                     xDir=(1, 0, 0), normal=(0, 1, 0))
    pocket = (cq.Workplane(plane).rect(d.panel_pocket_width, d.panel_pocket_height)
              .extrude(d.panel_pocket_depth+0.2).edges("|Y").fillet(8))
    return panel.cut(pocket)
