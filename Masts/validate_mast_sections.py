"""Validate three mast families, mount fit, STEP round trips and source overlays."""
from __future__ import annotations

from dataclasses import replace
from importlib import import_module
import json
from pathlib import Path
import sys

import cadquery as cq

ROOT = Path(__file__).resolve().parent
HARDWARE_DIR = ROOT.parent / "硬件"
SPECS = json.loads((ROOT / "specs.json").read_text(encoding="utf-8"))
MODELS = (
    ("Fareast23RBracingMount", "fareast23r_bracing_mount"),
    ("Fareast28RBracingMount", "fareast28r_bracing_mount"),
    ("J80BracingMount", "j80_mast_bracing_mount"),
)


def load_models():
    result = []
    for folder, module in MODELS:
        sys.path.insert(0, str(HARDWARE_DIR / folder))
        result.append(import_module(module))
    return result


def catalogue_paths(section):
    """Sample raw PDF paths for source overlays, without reading CAD geometry."""
    for path in section.trace["raw_paths"]:
        pts = []
        for cmd in path:
            op = cmd[0]
            if op == "m":
                if pts:
                    yield pts
                pts = [cmd[1]]
            elif op == "l":
                pts.append(cmd[1])
            elif op in ("c", "v", "y"):
                p0 = pts[-1]
                p1, p2, p3 = (cmd[1], cmd[2], cmd[3]) if op == "c" else (
                    (p0, cmd[1], cmd[2]) if op == "v" else (cmd[1], cmd[2], cmd[2]))
                for i in range(1, 25):
                    t = i / 24
                    pts.append(tuple((1-t)**3*p0[j]+3*(1-t)**2*t*p1[j]+3*(1-t)*t*t*p2[j]+t**3*p3[j] for j in (0, 1)))
            elif op == "h":
                pts.append(pts[0])
        if pts:
            yield pts


def validate(model, bracket=None):
    p, family = model.P, model.SECTION
    prefix = model.__name__.split("_")[0]
    spec = SPECS["sections"][prefix]
    assert p.silicone_gap == SPECS["mount_design"]["silicone_thickness_mm"], "Padding differs from mount design"
    for attr, key in (("mast_outer_w","width_mm"), ("mast_outer_h","depth_mm"),
                      ("mast_wall","wall_mm"), ("rail_mouth_w","mouth_mm"),
                      ("rail_chamber_w","chamber_width_mm"), ("rail_chamber_h","chamber_depth_mm")):
        assert abs(getattr(p, attr) - spec[key]) < 1e-9, f"{prefix}: Params differs from specs.json: {key}"
    mast = model.make_mast(p)
    solid = mast.val()
    bounds = solid.BoundingBox()
    assert solid.isValid() and len(solid.Solids()) == 1, "Mast must be one valid solid"
    for actual, expected in zip((bounds.xlen, bounds.ylen, bounds.zlen),
                                (p.mast_outer_w, p.mast_outer_h, p.mast_length)):
        assert abs(actual - expected) < 1e-4, (actual, expected)
    assert len(mast.faces("<Z").val().Wires()) == 2, "Open groove and separate closed main cavity required"
    assert solid.cut(solid.mirror("YZ")).Volume() < 1e-3, "Section is not symmetric"

    floor = p.outer_ry - p.rail_chamber_h
    for z in (0.1, p.mount_center_z, p.mast_length - 0.1):
        assert not solid.isInside((0, 0, z)), "Main cavity blocked"
        assert not solid.isInside((0, p.outer_ry - p.mast_wall / 2, z)), "Mouth blocked"
        assert not solid.isInside((0, floor + 0.5, z)), "Groove blocked"
        assert solid.isInside((0, floor - p.mast_wall / 2, z)), "Track web missing"
        assert solid.isInside((p.rail_chamber_w / 2 + p.mast_wall / 2,
                               p.outer_ry - p.mast_wall - 0.5, z)), "Track side wall missing"
        # Verify both measured lip faces at the narrowest throat.
        for sign in (-1, 1):
            assert not solid.isInside((sign*(p.rail_mouth_w/2-0.05), p.outer_ry-p.mast_wall/2, z))
            assert solid.isInside((sign*(p.rail_mouth_w/2+0.05), p.outer_ry-p.mast_wall/2, z))
    wire = family.envelope_wire(p.mast_outer_w, p.mast_outer_h)
    wall_distance = wire.distance(family.envelope_wire(p.mast_outer_w, p.mast_outer_h, -p.mast_wall))
    assert abs(wall_distance - p.mast_wall) < 2e-4, "Body wall is not a normal offset"

    print(f"{prefix}: checking bracket and straps", flush=True)
    # Optional finished BREP permits an independent export check without
    # rebuilding the same expensive spline junction already checked upstream.
    brace = bracket if bracket is not None else model.make_integrated_fixed_panel_bracing(p)
    padding = model.make_front_silicone_padding(p)
    straps = model.make_back_elastic_straps(p)
    for part, count in ((brace, 1), (padding, 1), (straps, 2)):
        assert part.val().isValid() and len(part.solids().vals()) == count, "Invalid or disconnected mount part"
    for name, part in (("bracket", brace), ("padding", padding), ("straps", straps)):
        assert solid.intersect(part.val()).Volume() < 1e-4, f"Mast collides with {name}"
    assert brace.val().intersect(padding.val()).Volume() < 1e-4, "Padding/bracket overlap"
    assert brace.val().intersect(straps.val()).Volume() < 1e-4, "Strap seat blocked"
    # Measure actual generated surfaces after all trimming and fillets.
    brace_mast_gap = solid.distance(brace.val())
    assert abs(brace_mast_gap - p.silicone_gap) < 1e-3, "Saddle does not match padding thickness"
    assert solid.distance(padding.val()) < 1e-5, "Padding does not contact mast"
    assert brace.val().distance(padding.val()) < 1e-5, "Padding does not contact saddle"
    assert padding.val().intersect(straps.val()).Volume() < 1e-4, "Padding/strap overlap"

    # Held-out C-series stations: not used to construct the spline.
    errors = []
    if family.family == "selden_c":
        raw = family.trace["outer_right"]
        for y in (477.6939, 482.7799, 486.4409, 492.4849, 501.7969, 512.6319,
                  522.3379, 533.1479, 541.2809, 550.0279, 557.1039, 562.4849, 565.5809):
            q = family.source_point(min(raw, key=lambda xy: abs(xy[1]-y)), p.mast_outer_w, p.mast_outer_h)
            errors.append(wire.distance(cq.Vertex.makeVertex(q.x, q.y, 0)))
        assert max(errors) < 0.35, "Contour diverges from held-out catalogue stations"
    # IMS80 uses original outer Bezier control points, so a same-path fit error
    # would be circular evidence. Rely on source overlay and independent specs.

    model.OUT_DIR.mkdir(exist_ok=True)
    step = model.OUT_DIR / f"{prefix}_mast_700mm_from_section.step"
    cq.exporters.export(mast, str(step))
    reimported = cq.importers.importStep(str(step)).val()
    assert reimported.isValid() and len(reimported.Solids()) == 1
    assert abs(reimported.Volume() - solid.Volume()) < solid.Volume() * 1e-7
    section = model.make_mast(replace(p, mast_length=20.0))
    cq.exporters.export(section, str(model.OUT_DIR / f"{prefix}_mast_section_20mm.step"))
    cq.exporters.export(cq.Workplane("XY").add(section.faces("<Z").val().Wires()),
                        str(model.OUT_DIR / f"{prefix}_mast_section.dxf"))
    cq.exporters.export(section, str(model.OUT_DIR / f"{prefix}_mast_section.svg"), opt={
        "projectionDir": (0, 0, 1), "showHidden": False, "showAxes": False,
        "width": 600, "height": 850, "strokeWidth": 0.4,
    })

    area = section.val().Volume() / 20
    inertia = cq.Shape.matrixOfInertia(section.val())
    # Remove the 3D segment's z contribution to obtain 2D centroidal moments.
    ix = (inertia[0][0] / 20 - area*20**2/12) / 1e4
    iy = (inertia[1][1] / 20 - area*20**2/12) / 1e4
    mass = area * 0.0027  # Generic aluminium density assumption: 2700 kg/m3.
    comparisons = {}
    for key, value in (("mass_kg_per_m",mass), ("inertia_strong_cm4",max(ix,iy)), ("inertia_weak_cm4",min(ix,iy))):
        nominal = spec["catalogue_"+key]
        error = (value / nominal - 1)*100
        comparisons[key] = {"model":value, "catalogue":nominal, "difference_percent":error}
        assert abs(error) < 10, f"Catalogue sanity check failed: {key}: {error:.1f}%"
    result = {
        "model": prefix, "family": family.family, "section": spec["section"],
        "dimensions_mm": [p.mast_outer_w, p.mast_outer_h, p.mast_length],
        "wall_mm": p.mast_wall, "mouth_mm": p.rail_mouth_w,
        "groove_depth_mm": p.rail_chamber_h, "section_area_mm2": area,
        "catalogue_cross_checks": comparisons,
        "max_held_out_contour_error_mm": max(errors) if errors else None,
        "held_out_station_count": len(errors), "valid_connected_solid": True,
        "step_roundtrip": "passed", "mount_clearance_checks": "passed",
        "silicone_thickness_mm": p.silicone_gap,
        "measured_mast_to_bracket_gap_mm": brace_mast_gap,
        "estimated_fields": spec["estimated_fields"],
        "dimension_basis": family.trace["basis"] + "; " + spec["boat_assignment"],
        "reference_only": "Catalogue sanity checks are not fabrication tolerances or structural verification.",
    }
    (model.OUT_DIR / "section_validation.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return section, result


def render(models, sections):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "DejaVu Sans"]
    fig, axes = plt.subplots(3, 3, figsize=(14, 18), layout="constrained")
    for model, section, row in zip(models, sections, axes):
        p, family = model.P, model.SECTION
        spec = SPECS["sections"][model.__name__.split("_")[0]]
        for points in catalogue_paths(family):
            xy = np.array([(q.x, q.y) for q in [family.source_point(xy,p.mast_outer_w,p.mast_outer_h) for xy in points]])
            for ax in row[:2]:
                ax.plot(xy[:,0],xy[:,1],color="#48616e",alpha=.55,lw=1.5)
        for wire in section.faces("<Z").val().Wires():
            points, _ = wire.sample(1800)
            xy = np.array([(q.x, q.y) for q in points])
            for ax in row[:2]:
                ax.plot(xy[:,0],xy[:,1],color="#e44c22",lw=.85)
            row[2].plot(xy[:,0],xy[:,1],color="#176779",lw=1.2)
        for ax in row:
            ax.set_aspect("equal")
            ax.grid(alpha=.15)
            ax.set(xlabel="X / mm",ylabel="Y / mm")
        row[0].set(title=f"{model.__name__.split('_')[0].upper()} · {spec['section']}\n原厂目录归一化轮廓 + 橙色 CAD",
                   xlim=(-p.outer_rx-5,p.outer_rx+5),ylim=(-p.outer_ry-5,p.outer_ry+5))
        row[1].set(title="帆槽局部 · 未标注细节为估算",
                   xlim=(-p.rail_chamber_w/2-8,p.rail_chamber_w/2+8),
                   ylim=(p.outer_ry-p.rail_chamber_h-8,p.outer_ry+3))
        row[2].set(title=f"CAD 剖面 · {p.mast_outer_w:g} × {p.mast_outer_h:g} mm\n壁厚 {p.mast_wall:g} mm" + ("（估算）" if family.family=="ims80" else "（目录值）"))
    fig.suptitle("三款桅杆截面 · 原厂资料核对\nC126/C139 使用通用 C 系列示意形状，具体船型对应待 Mast ID 确认；J80 为 IMS-80 版本",fontsize=16)
    out = ROOT / "cadquery_out"
    out.mkdir(parents=True,exist_ok=True)
    fig.savefig(out / "mast_sections_comparison.png",dpi=140)
    plt.close(fig)


if __name__ == "__main__":
    models = load_models()
    sections = []
    for model in models:
        section, result = validate(model)
        sections.append(section)
        print(json.dumps(result,indent=2),flush=True)
    render(models,sections)
