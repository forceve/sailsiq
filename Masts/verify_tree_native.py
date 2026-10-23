"""Reopen native review documents, run strict BOP, and batch adaptive volumes.

Run with FreeCAD's Python after tree_bracing_review.FCMacro. No repairs occur
here. Checked native shapes are exported to temporary BREP and measured by the
CadQuery runtime, using the same adaptive 1e-8 integration as source STEP/BREP.
"""
from pathlib import Path
import json
import tempfile
import FreeCAD as App

from shape_metrics import compare_volumes, measure_paths


ROOT = Path(__file__).resolve().parent
MODELS = (("Fareast23RBracingMount", "fareast23r"),
          ("Fareast28RBracingMount", "fareast28r"),
          ("J80BracingMount", "j80"))


def main():
    meta = json.loads((ROOT/"cadquery_out/tree_bracing_validation.json").read_text(encoding="utf-8"))
    revision = meta["design"]["revision"]
    assert revision.startswith("tree-v7"), "Regenerate V7 geometry and validation first"
    by_model = {row["model"]: row for row in meta["models"]}
    folders = {prefix: ROOT.parent/"硬件"/directory/"cadquery_out" for directory, prefix in MODELS}
    paths = [folders[prefix]/f"{prefix}_tree_bracing_mount.FCStd" for _, prefix in MODELS]
    paths.append(ROOT/"cadquery_out/tree_bracing_comparison.FCStd")
    jobs, rows, pending = {}, [], []
    with tempfile.TemporaryDirectory(prefix="tree_reopen_metrics_", dir=str(ROOT/"cadquery_out")) as temporary:
        temporary = Path(temporary).resolve()
        for document_index, path in enumerate(paths):
            doc = App.openDocument(str(path))
            objects = []
            try:
                for obj in doc.Objects:
                    if not hasattr(obj, "Shape"):
                        continue
                    assert obj.Shape.isValid(), (path.name, obj.Name)
                    obj.Shape.check(True)
                    key = f"native:{document_index}:{obj.Name}"
                    exported = temporary/f"shape_{len(jobs):04d}.brep"
                    obj.Shape.exportBrep(str(exported))
                    assert exported.is_file() and exported.stat().st_size > 0
                    jobs[key] = exported
                    record = {"object": obj.Name, "solids": len(obj.Shape.Solids),
                              "maximum_stored_tolerance_mm": obj.Shape.getTolerance(1)}
                    objects.append(record)
                    prefix = kind = None
                    if obj.Name in {"Bracket", "ConnectorReference"}:
                        prefix = path.name.split("_")[0]
                        kind = "bracket" if obj.Name == "Bracket" else "connector"
                    else:
                        for model in by_model:
                            if obj.Name == model+"Bracket":
                                prefix, kind = model, "bracket"
                                break
                    if kind == "bracket":
                        assert len(obj.Shape.Solids) == 1 and obj.DesignRevision == revision
                        assert "V7 rolling blend" in obj.RootTransition
                        assert "actual closed saddle/fork intersections" in obj.RootTransition
                        assert "quartic fork joined at Z +/-20 mm" in obj.RootTransition
                    sources = {}
                    if prefix:
                        suffix = "tree_bracing_mount" if kind == "bracket" else "tree_bracing_connector"
                        for extension in ("brep", "step"):
                            source_key = f"source:{prefix}:{kind}:{extension}"
                            jobs[source_key] = folders[prefix]/f"{prefix}_{suffix}.{extension}"
                            sources[extension] = source_key
                    pending.append((key, record, prefix, kind, sources))
                rows.append({"file": str(path.relative_to(ROOT.parent)), "revision": revision,
                             "checked_objects": len(objects), "BOP": "passed without additional repair",
                             "volume_integration_relative_tolerance": 1e-8, "objects": objects})
            finally:
                App.closeDocument(doc.Name)
            print(path.name, len(objects), "native BOP passed", flush=True)
        metrics = measure_paths(jobs)
        for key, record, prefix, kind, sources in pending:
            native = metrics[key]
            assert native["solids"] == record["solids"]
            record["adaptive_volume_mm3"] = native["volume_mm3"]
            if sources:
                checks = {"validation_report": compare_volumes(
                    native["volume_mm3"], by_model[prefix][kind]["new_volume_mm3"],
                    label=prefix+" "+record["object"]+" metadata")}
                for extension, source_key in sources.items():
                    source = metrics[source_key]
                    assert source["solids"] == native["solids"]
                    checks[extension+"_to_reopened_native"] = compare_volumes(
                        native["volume_mm3"], source["volume_mm3"],
                        label=prefix+" "+record["object"]+" "+extension)
                record["adaptive_volume_checks"] = checks
    (ROOT/"cadquery_out/tree_native_reopen_validation.json").write_text(
        json.dumps(rows, indent=2), encoding="utf-8")
    print("All reopened native shapes, source BREP/STEP and adaptive volumes passed", flush=True)


if __name__ == "__main__":
    main()
