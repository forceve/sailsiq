"""Batch adaptive solid metrics, callable from FreeCAD's separate Python runtime.

FreeCAD Part.Shape.Volume and CadQuery's default Volume() use non-adaptive
integration and can be inaccurate for large trimmed spline faces.  This helper
loads an exported BREP/STEP in the CadQuery runtime and explicitly requests
adaptive integration with relative tolerance 1e-8.

CLI: python shape_metrics.py --batch request.json --out metrics.json
Request: {"items": [{"id": "bracket", "path": "absolute/path.brep"}]}
Override runtime discovery with SAILSIQ_CADQUERY_PYTHON when called by FreeCAD.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import os
import subprocess
import sys
import tempfile


RELATIVE_INTEGRATION_TOLERANCE = 1e-8


def _cadquery_python(explicit=None):
    configured = explicit or os.environ.get("SAILSIQ_CADQUERY_PYTHON")
    if configured:
        path = Path(configured).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"CadQuery Python does not exist: {path}")
        return path
    if importlib.util.find_spec("cadquery") is not None:
        return Path(sys.executable).resolve()
    local = os.environ.get("LOCALAPPDATA")
    if local:
        path = Path(local)/"Programs/Python/Python312/python.exe"
        if path.is_file():
            return path
    raise RuntimeError("Set SAILSIQ_CADQUERY_PYTHON to the Python executable with CadQuery/OCP")


def measure_paths(paths, *, python_executable=None, timeout=300):
    """Measure a mapping of IDs to paths using one worker process for the batch."""
    paths = {str(key): str(Path(path).resolve()) for key, path in paths.items()}
    if not paths:
        return {}
    executable = _cadquery_python(python_executable)
    with tempfile.TemporaryDirectory(prefix="sailsiq_shape_metrics_") as temporary:
        folder = Path(temporary).resolve()
        request, response = folder/"request.json", folder/"response.json"
        request.write_text(json.dumps({"items": [{"id": key, "path": path}
                                                 for key, path in paths.items()]}), encoding="utf-8")
        process = subprocess.run([str(executable), str(Path(__file__).resolve()),
                                  "--batch", str(request), "--out", str(response)],
                                 capture_output=True, text=True, encoding="utf-8", errors="replace",
                                 timeout=timeout, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if process.returncode or not response.is_file():
            details = (process.stdout+"\n"+process.stderr)[-12000:]
            raise RuntimeError(f"Adaptive shape metrics failed ({process.returncode}):\n{details}")
        result = json.loads(response.read_text(encoding="utf-8"))
    if set(result["items"]) != set(paths):
        raise RuntimeError("Adaptive shape metrics returned an incomplete batch")
    return result["items"]


def compare_volumes(actual, expected, *, label="shape", relative=1e-6, absolute=1e-5):
    """Assert the requested agreement and return auditable difference values."""
    delta = abs(actual-expected)
    limit = max(absolute, abs(expected)*relative)
    if delta > limit:
        raise AssertionError(f"{label}: adaptive volumes differ by {delta:.9g} mm3 "
                             f"(limit {limit:.9g}; {actual:.12g} vs {expected:.12g})")
    return {"actual_mm3": actual, "expected_mm3": expected, "absolute_delta_mm3": delta,
            "relative_delta": delta/abs(expected) if expected else None,
            "allowed_delta_mm3": limit}


def _measure_batch(request):
    # Keep imports here so FreeCAD can import the process launcher without OCP.
    import cadquery as cq
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    output, cache = {}, {}
    for item in request["items"]:
        key, path = str(item["id"]), Path(item["path"]).resolve()
        if key in output:
            raise ValueError(f"Duplicate metric ID: {key}")
        if path not in cache:
            if path.suffix.lower() in {".brep", ".brp"}:
                shape = cq.Shape.importBrep(str(path))
            elif path.suffix.lower() in {".step", ".stp"}:
                shapes = cq.importers.importStep(str(path)).vals()
                shape = shapes[0] if len(shapes) == 1 else cq.Compound.makeCompound(shapes)
            else:
                raise ValueError(f"Unsupported shape format: {path}")
            if shape.isNull() or not shape.isValid():
                raise ValueError(f"Invalid shape while measuring: {path}")
            properties = GProp_GProps()
            estimated_error = BRepGProp.VolumeProperties_s(
                shape.wrapped, properties, RELATIVE_INTEGRATION_TOLERANCE)
            cache[path] = {"volume_mm3": properties.Mass(), "solids": len(shape.Solids()),
                           "valid": True, "faces": len(shape.Faces()),
                           "relative_integration_tolerance": RELATIVE_INTEGRATION_TOLERANCE,
                           "estimated_relative_integration_error": estimated_error}
        output[key] = dict(cache[path], path=str(path))
    return {"method": "OCP adaptive BRepGProp.VolumeProperties (equivalent to CQ Volume(tol=1e-8))",
            "items": output}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = _measure_batch(json.loads(args.batch.read_text(encoding="utf-8")))
    args.out.write_text(json.dumps(result, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
