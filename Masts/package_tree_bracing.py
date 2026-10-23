"""Package the checked CAD deliverables and their design records."""
from pathlib import Path
import hashlib
import json
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = HERE/"cadquery_out"


def package():
    validation = json.loads((OUT/"tree_bracing_validation.json").read_text(encoding="utf-8"))
    native = json.loads((OUT/"tree_native_reopen_validation.json").read_text(encoding="utf-8"))
    assert len(validation["models"]) == 3 and len(native) == 4
    assert validation["design"]["revision"] == "tree-v7", "V7 documents require matching V7 CAD reports"
    assert all(m["valid_connected_bracket"] and m["stl"]["consistent_winding"] for m in validation["models"])
    assert all(m["root_surface_continuity"]["passed"] for m in validation["models"])
    assert all(m["junction_profiles"]["pre_neck_valley_count"] == 0 for m in validation["models"])
    assert all(m["BOP"] == "passed without additional repair" for m in native)
    assert all(m["revision"] == validation["design"]["revision"] for m in native)
    # A versioned review file avoids reopening an already-loaded V6 document
    # under the unchanged canonical filename in an existing FreeCAD session.
    import shutil
    versioned_review = OUT/"tree_bracing_v7_comparison.FCStd"
    shutil.copy2(OUT/"tree_bracing_comparison.FCStd", versioned_review)
    files = set()
    files.add(versioned_review)
    for name in ("TREE_BRACING_DESIGN.md", "BRACING_DESIGN_REVIEW.md", "README.md", "SPECS.md",
                 "TREE_BRACING_TOPOLOGY.md", "TREE_BRACING_V2_ASSESSMENT.md",
                 "TREE_BRACING_V3_NODES.md", "EDGE_SHAPE_AUDIT.md", "audit_panel_edge.py",
                 "edge_audit_review.FCMacro", "verify_tree_native.py",
                 "compare_tree_fea.py", "summarize_tree_fea.py",
                 "specs.json", "tree_bracing_baseline.json", "tree_bracing.py", "mast_section.py",
                 "root_transition.py", "root_transition_v6.py", "branch_junction.py",
                 "root_blend_v7.py", "validate_root_blend_v7.py", "build_tree_v7.py", "root_v7_preview.FCMacro",
                 "shape_metrics.py", "junction_quality.py", "normalize_cad_edges.py",
                 "validate_root_transition.py", "root_transition_review.FCMacro",
                 "validate_tree_bracing.py", "validate_mast_sections.py", "tree_bracing_review.FCMacro",
                 "bracing_mount_review.FCMacro", "package_tree_bracing.py", "references/profile_traces.json"):
        files.add(HERE/name)
    for name in ("tree_bracing_validation.json", "tree_freecad_validation.json",
                 "tree_native_reopen_validation.json", "tree_bracing_comparison.FCStd", "tree_bracing_comparison.png"):
        files.add(OUT/name)
    files.update(p for p in (OUT/"tree_v1").iterdir() if p.suffix in {".step", ".FCStd", ".png", ".py", ".json", ".md"})
    files.update(p for p in (OUT/"tree_v2").iterdir() if p.suffix in {".step", ".FCStd", ".png", ".py", ".json", ".md"})
    files.update(p for p in (OUT/"tree_v3").iterdir() if p.suffix in {".step", ".FCStd", ".brep", ".py", ".json", ".md"})
    files.update(p for p in (OUT/"tree_v31").iterdir() if p.suffix in {".step", ".FCStd", ".brep", ".py", ".json", ".md"})
    files.update(p for p in (OUT/"tree_v4").iterdir() if p.suffix in {".step", ".FCStd", ".brep", ".py", ".json", ".md"})
    files.update(p for p in (OUT/"tree_v5").iterdir() if p.suffix in {".step", ".FCStd", ".brep", ".py", ".json", ".md"})
    files.update(p for p in (OUT/"tree_v6").iterdir() if p.suffix in {".step", ".FCStd", ".brep", ".py", ".json", ".md"})
    root_review = OUT/"root_transition_v7"
    v6_images = set(root_review.glob("*.png"))
    v6_measurements = set(root_review.glob("*.json"))
    assert v6_images and v6_measurements, "Missing final V7 root views or measurements"
    files.update(v6_images | v6_measurements)
    for label in ("v4", "new"):
        for orientation in ("iso", "right"):
            files.add(OUT/"root_transition"/f"root_{label}_{orientation}.png")
    files.update(p for p in (OUT/"edge_audit").iterdir() if p.suffix in {".png", ".json", ".brep"})
    for name in ("v3_j80.brep", "v3_final.brep", "v3_comparison.json", "v3_edge_round_simplification.json"):
        files.add(OUT/"fea"/name)
    for name in ("v1.brep", "v2.brep", "v2_final.brep", "tree_v2_slim.py", "comparison.json", "compliance_comparison.png"):
        files.add(OUT/"fea"/name)
    for variant in ("v1", "v2", "v2_final", "v3_j80", "v3_final"):
        for h in (4, 3):
            for suffix in (".geo", "_setup.json", "_results.json", "_mesh.log", "_solve.log"):
                files.add(OUT/"fea"/f"{variant}_h{h}{suffix}")
    for folder, prefix in (("Fareast23RBracingMount", "fareast23r"),
                           ("Fareast28RBracingMount", "fareast28r"), ("J80BracingMount", "j80")):
        base = ROOT/"硬件"/folder
        files.add(base/"README.md")
        files.add(base/(f"{prefix}_mast_bracing_mount.py" if prefix == "j80" else f"{prefix}_bracing_mount.py"))
        for pattern in (f"{prefix}_tree*", f"{prefix}_cunningham*", f"{prefix}_front_silicone_padding.step",
                        f"{prefix}_rear_elastic_strap_bands.step", f"{prefix}_strap_locator_rails.step",
                        f"{prefix}_mast_700mm_semi_bracing_mount_assembly.step",
                        "tree_bracing_validation.json", "tree_junction_quality.json", "section_validation.json"):
            files.update(p for p in (base/"cadquery_out").glob(pattern)
                         if p.suffix in {".step", ".stl", ".FCStd", ".png", ".json", ".brep"})
    manifest = {str(p.relative_to(ROOT)).replace("\\", "/"): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted(files)}
    path = OUT/"tree_bracing_design_package.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for p in sorted(files):
            archive.write(p, str(p.relative_to(ROOT)))
        archive.writestr("SHA256.json", json.dumps(manifest, indent=2, ensure_ascii=False))
        archive.writestr("START_HERE.txt", "请先阅读 Masts/TREE_BRACING_DESIGN.md。\n各船型 CAD 位于 硬件/<船型>/cadquery_out。\n橙色绳路是未实测的候选空间；本版为可试制结构方案，尚未完成载荷验证。\n完整模型重生成需在原项目内使用其设备外壳依赖和 CadQuery/FreeCAD 环境。\n")
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None
    print(f"Packaged {len(files)} files: {path} ({path.stat().st_size/1024/1024:.2f} MiB)")


if __name__ == "__main__":
    package()
