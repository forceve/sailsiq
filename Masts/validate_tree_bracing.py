"""Independent interference, interface and STEP checks for the tree redesign.

Run the three exporters first. This supplements validate_mast_sections.py;
neither script is a structural analysis or a rope-routing certification.
"""
from dataclasses import asdict
import json
from pathlib import Path
import cadquery as cq
import numpy as np
from OCP.BRepBndLib import BRepBndLib
from OCP.Bnd import Bnd_Box
from validate_mast_sections import load_models
import tree_bracing as tree
from validate_root_blend_v7 import validate_root
from junction_quality import measure_junction, plot_report

ROOT = Path(__file__).resolve().parent


def check_stl(path):
    data = path.read_bytes()
    count = int.from_bytes(data[80:84], "little")
    assert len(data) == 84+50*count, "Unexpected binary STL size"
    dtype = np.dtype([("normal", "<f4", 3), ("vertices", "<f4", (3, 3)), ("attr", "<u2")])
    faces = np.frombuffer(data, dtype=dtype, offset=84, count=count)["vertices"]
    vertices, inverse = np.unique(faces.reshape(-1, 3), axis=0, return_inverse=True)
    triangles = inverse.reshape(-1, 3)
    directed = np.concatenate((triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]))
    edges = np.sort(directed, axis=1)
    _, edge_ids, incidence = np.unique(edges, axis=0, return_inverse=True, return_counts=True)
    assert np.all(incidence == 2), "STL boundary or non-manifold edge"
    balance = np.bincount(edge_ids, weights=np.where(directed[:, 0] < directed[:, 1], 1, -1))
    assert np.all(balance == 0), "STL inconsistent winding"
    return {"triangles": count, "vertices": len(vertices), "watertight_edge_check": "passed",
            "consistent_winding": True}


def check_clear(a, b, label):
    volume = a.intersect(b).Volume(tol=1e-8)
    assert volume < 1e-4, f"{label}: intersection {volume} mm3"
    return {"intersection_mm3": volume, "minimum_distance_mm": a.distance(b)}


def validate(model, baseline):
    p = model.P
    prefix = model.__name__.split("_")[0]
    bracket = model.make_integrated_fixed_panel_bracing(p).val()
    connector = model.make_tree_bracing_connector(p).val()
    mast = model.make_mast(p).val()
    pad = model.make_front_silicone_padding(p).val()
    straps = model.make_back_elastic_straps(p).val()
    lanes = tree.rope_envelope(p).val()
    guides = tree.make_strap_guides(p, model.SECTION).val()
    plate = model.make_mounting_plate(p).val()
    assert bracket.isValid() and len(bracket.Solids()) == 1
    assert connector.isValid() and len(connector.Solids()) == 2
    assert len(lanes.Solids()) == 2
    for part in (mast, pad, straps, guides, plate):
        assert part.isValid()

    result = {"model": prefix, "revision": tree.DESIGN.revision,
              "valid_connected_bracket": True, "connector_solid_count": 2,
              "clearances": {}}
    print(prefix, 'assembly clearances', flush=True)
    for name, part in (("mast", mast), ("silicone", pad), ("straps", straps)):
        result["clearances"]["bracket_"+name] = check_clear(bracket, part, name)
    assert abs(mast.distance(bracket)-3) < 1e-3
    assert pad.distance(bracket) < 1e-5
    assert straps.distance(bracket) >= tree.DESIGN.strap_running_clearance-1e-4
    for name, part in (("bracket", bracket), ("mast", mast), ("silicone", pad), ("straps", straps)):
        result["clearances"]["rope_lanes_"+name] = check_clear(lanes, part, "rope lanes / "+name)
        assert lanes.distance(part) >= tree.DESIGN.rope_clearance-1e-4
    assert lanes.distance(bracket) >= tree.DESIGN.rope_clearance-1e-4
    # Cached render meshes may carry conservative face deflections. Inspect
    # actual trimmed geometry, independent of export/meshing history.
    bounds_exact = Bnd_Box()
    BRepBndLib.AddOptimal_s(bracket.wrapped, bounds_exact, False, False)
    xb0, _, _, xb1, _, _ = bounds_exact.Get()
    assert abs(xb1-xb0-p.plate_w) < 1e-4
    node = tree.panel_with_continuous_branches(model, p)
    terminal_sections = []
    for offset in (-22, -12, -5, -0.5):
        slab = cq.Solid.makeBox(30, .01, 54,
            cq.Vector(p.plate_w/2-30,p.plate_back_y+offset-.005,p.mount_center_z+10))
        section = node.intersect(slab)
        box = section.BoundingBox()
        terminal_sections.append({"y_from_panel_back_mm":offset,
                                  "width_mm":box.xlen,"height_mm":box.zlen,
                                  "area_approx_mm2":section.Volume(tol=1e-8)/.01})
    for first, second in zip(terminal_sections, terminal_sections[1:]):
        assert second["width_mm"] > first["width_mm"]-.05
        assert second["height_mm"] > first["height_mm"]+1
        assert second["area_approx_mm2"] > first["area_approx_mm2"]
    result["continuous_terminal_sections"] = terminal_sections
    edge_jumps = []
    for side in (-1,1):
        for dz in (-58,-10,10,58):
            rear = []
            for offset in (-.001,.001):
                x = side*(p.plate_w/2-.01)
                ray = cq.Edge.makeLine((x,p.plate_back_y-25,p.mount_center_z+dz+offset),
                                      (x,p.plate_back_y+4,p.mount_center_z+dz+offset))
                spans = bracket.intersect(ray).Edges()
                assert spans
                rear.append(min(e.BoundingBox().ymin for e in spans))
            edge_jumps.append(abs(rear[1]-rear[0]))
    assert max(edge_jumps) < .02, "Old fan-end ledge must not remain"
    result["old_fan_end_max_delta_over_002mm"] = max(edge_jumps)
    result["independent_fan_bodies"] = 0
    for side in (-1,1):
        assert not bracket.isInside((side*(p.plate_w/2-1),p.plate_back_y-2,p.mount_center_z))
    result["no_projecting_central_strip"] = True
    v2 = cq.importers.importStep(str(ROOT/f"cadquery_out/tree_v2/{prefix}_tree_bracing_mount.step")).val()
    result["versus_tree_v2"] = {"v2_volume_mm3":v2.Volume(tol=1e-8),"new_volume_mm3":bracket.Volume(tol=1e-8),
                               "volume_change_percent":(bracket.Volume(tol=1e-8)/v2.Volume(tol=1e-8)-1)*100}
    result["flush_panel_edges_mm"] = [-p.plate_w/2, p.plate_w/2]
    v1 = cq.importers.importStep(str(ROOT/f"cadquery_out/tree_v1/{prefix}_tree_bracing_mount.step")).val()
    result["versus_tree_v1"] = {"v1_volume_mm3": v1.Volume(tol=1e-8), "v2_volume_mm3": bracket.Volume(tol=1e-8),
                              "volume_change_percent": (bracket.Volume(tol=1e-8)/v1.Volume(tol=1e-8)-1)*100}
    samples = []
    for y in (4, 6, 12, 18):
        ray = cq.Edge.makeLine((0, y, p.mount_center_z), (100, y, p.mount_center_z))
        shell_x = model.SECTION.right_x_at_y(p.mast_outer_w, p.mast_outer_h, y,
                                            p.silicone_gap+p.front_bracing_side_t)
        samples.append({"y_mm": y, "v1_projection_x_mm": v1.intersect(ray).BoundingBox().xmax-shell_x,
                        "v2_projection_x_mm": bracket.intersect(ray).BoundingBox().xmax-shell_x})
    result["root_projection_samples"] = samples

    # Restore a CONTINUOUS saddle underneath both straps, independent of guides.
    saddle = model.make_front_bracing_shell(p).val()
    x = model.SECTION.right_x_at_y(p.mast_outer_w, p.mast_outer_h, 20,
                                  p.silicone_gap+p.front_bracing_side_t/2)
    for band in (-1, 1):
        for side in (-1, 1):
            assert saddle.isInside((side*x, 20, p.mount_center_z+band*p.strap_spacing/2))
    # Guide strips remain physically fused into the saddle, not floating.
    for guide in guides.Solids():
        assert guide.intersect(saddle).Volume(tol=1e-8) > 1.0

    # Added edge rails must not block the six existing screw clearance axes.
    holes = tree.screw_clearances(model, p).val()
    check_clear(bracket, holes, "screw passages")
    assert not plate.isInside((0, p.plate_back_y+0.7, p.mount_center_z))
    assert plate.isInside((0, p.plate_back_y+0.9, p.mount_center_z))
    assert abs(p.plate_back_y-baseline["plate_back_y_mm"]) < 1e-9

    # Use the real enclosure, and fail visibly if reference loading fell back.
    print(prefix, 'actual device and export checks', flush=True)
    device_parts = model.make_device_reference_parts(p)
    assert any(name == "sailsiq_real_shell_reference" for name, _, _ in device_parts)
    assert not any("placeholder" in name for name, _, _ in device_parts)
    for name, part, _ in device_parts:
        if name in {"sailsiq_real_shell_reference", "sailsiq_real_bonded_panel_reference",
                    "sailsiq_direct_buttons_reference", "sailsiq_lcd_window_reference"}:
            check_clear(bracket, part.val(), name)
            check_clear(lanes, part.val(), "rope lanes / "+name)
            cq.exporters.export(part, str(model.OUT_DIR/f"{prefix}_{name}.step"))

    for suffix, shape in (("tree_bracing_mount", bracket), ("tree_bracing_connector", connector)):
        loaded = cq.importers.importStep(str(model.OUT_DIR/f"{prefix}_{suffix}.step")).val()
        assert loaded.isValid() and len(loaded.Solids()) == len(shape.Solids())
        assert abs(loaded.Volume(tol=1e-8)/shape.Volume(tol=1e-8)-1) < 1e-6
    result["step_roundtrip"] = "passed"
    result["stl"] = check_stl(model.OUT_DIR/f"{prefix}_tree_bracing_mount.stl")
    result["screw_passages"] = "six clear"
    result["actual_device_reference"] = "checked"
    result["continuous_saddle_under_straps"] = True
    result["panel_station_change_mm"] = p.plate_back_y-baseline["plate_back_y_mm"]
    result["panel_remaining_skin_mm"] = p.plate_t-tree.DESIGN.panel_pocket_depth
    bounds = {}
    for name, shape in (("saddle", saddle), ("silicone", pad), ("panel", plate)):
        box = shape.BoundingBox()
        bounds[name] = [box.zmin, box.zmax]
    for name in ("saddle", "silicone"):
        assert all(abs(a-b) < 1e-4 for a,b in zip(bounds[name], bounds["panel"])), name+" must align with panel top/bottom"
    result["aligned_vertical_bounds_mm"] = bounds
    result["saddle_height_mm"] = p.bracket_z_h
    result["silicone_thickness_mm"] = p.silicone_gap
    for name, shape, key in (("bracket", bracket, "bracket_volume_mm3"),
                             ("connector", connector, "connector_volume_mm3")):
        before, after = baseline[key], shape.Volume(tol=1e-8)
        result[name] = {"baseline_volume_mm3": before, "new_volume_mm3": after,
                        "solid_volume_reduction_percent": (1-after/before)*100}
    result['connector']['solid_volume_reduction_percent'] = None
    result['connector']['comparison_note'] = 'Display-only reference has a new trim definition; compare full bracket volumes instead.'
    result["rope_lanes"] = {
        "count": 2, "centres_x_mm": [-(p.outer_rx+tree.DESIGN.rope_lane_from_mast_half_width), p.outer_rx+tree.DESIGN.rope_lane_from_mast_half_width],
        "centre_y_mm": p.plate_back_y-tree.DESIGN.rope_clearance-tree.DESIGN.rope_envelope_depth/2,
        "width_mm": tree.DESIGN.rope_envelope_width, "depth_mm": tree.DESIGN.rope_envelope_depth,
        "basis": "Provisional paired side lanes; J80 qualitative user observation only. No measured route for any boat.",
    }
    print(prefix, 'root perimeter and seams', flush=True)
    result["root_surface_continuity"] = validate_root(model, bracket)
    assert result["root_surface_continuity"]["passed"], "Root contains a sharp join or tight fold"
    print(prefix, 'independent junction sections', flush=True)
    quality = measure_junction(model, bracket, label=tree.DESIGN.revision)
    # A true fork opening is expected after the neck. The old V5 defect was a
    # recovered hollow before Y34, where the shared stem should grow smoothly.
    neck_y = 34.0
    pre_neck_valleys = [v for profile in quality['profiles'] for v in profile['valleys']
                       if v['minimum_y_mm'] <= neck_y]
    assert not pre_neck_valleys, f"Unintended pre-fork hollow: {pre_neck_valleys}"
    result['junction_profiles'] = {
        'pre_neck_valley_count': len(pre_neck_valleys),
        'profile_z_offsets_mm': [row['z_from_centre_mm'] for row in quality['profiles']],
        'measurement_source': 'junction_quality.py',
        'interpretation': 'No recovered hollow before the neck at sampled profiles; fork opening after neck is intentional.'}
    (model.OUT_DIR/'tree_junction_quality.json').write_text(json.dumps(quality, indent=2), encoding='utf-8')
    plot_report(quality, model.OUT_DIR/f'{prefix}_tree_junction_profiles.png')
    result['junction_construction'] = {key: value for key, value in tree.junction_geometry(model, p)['root_report'].items()
                                       if key != 'outer_boundary_samples'}
    result['fork_construction'] = tree.junction_geometry(model, p)['fork_report']
    v5 = cq.importers.importBrep(str(ROOT/f'cadquery_out/tree_v5/{prefix}_tree_bracing_mount.brep')).val()
    result['versus_tree_v5'] = {'old_volume_adaptive_mm3': v5.Volume(tol=1e-8),
                                'new_volume_adaptive_mm3': bracket.Volume(tol=1e-8),
                                'volume_change_percent': (bracket.Volume(tol=1e-8)/v5.Volume(tol=1e-8)-1)*100}
    result["limits"] = "Geometry checks only. Exploratory J80 FEA is reported separately; no load rating, silicone preload, dynamic rope sweep or print mass verification."
    (model.OUT_DIR/"tree_bracing_validation.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


if __name__ == "__main__":
    old = json.loads((ROOT/"tree_bracing_baseline.json").read_text(encoding="utf-8"))
    old = {r["model"]: r for r in old["models"]}
    results = []
    for model in load_models():
        prefix = model.__name__.split("_")[0]
        print("Validating tree", prefix, flush=True)
        r = validate(model, old[prefix])
        results.append(r)
        print(json.dumps({k:r[k] for k in ("model", "bracket", "connector", "step_roundtrip")}), flush=True)
    report = {"design": asdict(tree.DESIGN), "models": results}
    (ROOT/"cadquery_out/tree_bracing_validation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("All tree geometry checks passed", flush=True)
