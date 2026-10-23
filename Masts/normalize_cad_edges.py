"""Normalize only diagnosed curve-on-surface edge representation tolerances.

No curves, surfaces, vertex positions, or face tolerances are changed. An
oversized inherited edge/vertex tolerance may be reduced only after checking
all adjacent representations. Every other non-InvalidCurveOnSurface diagnostic
is fatal, except an exactly preserved C0 boundary curve may be split into
individually continuous edges at its existing knots. The CLI additionally requires a
strict FreeCAD BOP pass before publishing its output; the in-process function
returns a report for the caller's subsequent native validation.
"""
from pathlib import Path
import argparse
import json
import os
import subprocess
import tempfile


def _refine_c0_boundaries(shape):
    """Make existing C0 curve knots explicit vertices, preserving geometry."""
    import cadquery as cq
    from OCP.BOPAlgo import BOPAlgo_ArgumentAnalyzer
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.GeomAbs import GeomAbs_C0, GeomAbs_C1
    from OCP.ShapeUpgrade import ShapeUpgrade_ShapeDivideContinuity
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopExp import TopExp
    from OCP.TopTools import TopTools_IndexedMapOfShape

    def issues(value):
        analyzer = BOPAlgo_ArgumentAnalyzer()
        analyzer.SetShape1(value.wrapped)
        analyzer.ContinuityMode = True
        analyzer.Perform()
        return list(analyzer.GetCheckResult())

    faults = issues(shape)
    if not faults:
        return shape, {"modified": False, "edges": []}
    edges = TopTools_IndexedMapOfShape()
    TopExp.MapShapes_s(shape.wrapped, TopAbs_EDGE, edges)
    diagnosed = {}
    for fault in faults:
        if not str(fault.GetCheckStatus()).endswith("BOPAlgo_GeomAbs_C0"):
            raise ValueError(f"Cannot refine continuity diagnostic: {fault.GetCheckStatus()}")
        for item in fault.GetFaultyShapes1():
            if item.ShapeType() != TopAbs_EDGE:
                raise ValueError("Boundary refinement cannot repair a C0 surface")
            diagnosed[edges.FindIndex(item)] = cq.Edge(item)
    divide = ShapeUpgrade_ShapeDivideContinuity(shape.wrapped)
    divide.SetBoundaryCriterion(GeomAbs_C1)
    divide.SetPCurveCriterion(GeomAbs_C1)
    divide.SetSurfaceCriterion(GeomAbs_C0)  # Do not split or approximate surfaces.
    divide.SetEdgeMode(2)
    divide.SetPrecision(1e-7)
    divide.SetMinTolerance(1e-7)
    divide.SetMaxTolerance(0.0003)
    if not divide.Perform():
        raise ValueError("Exact C0 boundary subdivision did not complete")
    refined = cq.Shape.cast(divide.Result())
    rows = []
    for index, edge in diagnosed.items():
        original = BRepAdaptor_Curve(edge.wrapped)
        replacement = cq.Shape.cast(divide.GetContext().Apply(edge.wrapped))
        parts = replacement.Edges()
        if len(parts) < 2:
            raise ValueError(f"C0 edge {index} was not split into continuous edges")
        segments = []
        for part in parts:
            curve = BRepAdaptor_Curve(part.wrapped)
            first, last = curve.FirstParameter(), curve.LastParameter()
            gap = max(curve.Value(first+(last-first)*n/256).Distance(
                      original.Value(first+(last-first)*n/256)) for n in range(257))
            if gap > 1e-9 or curve.Continuity() == GeomAbs_C0:
                raise ValueError(f"Edge {index} subdivision changed geometry or retained C0")
            segments.append({"parameter_range": [first, last],
                             "maximum_corresponding_curve_distance_mm": gap,
                             "verification_samples": 257,
                             "continuity": str(curve.Continuity())})
        rows.append({"original_edge_index": index, "segments": segments})
    if (not refined.isValid() or len(refined.Solids()) != len(shape.Solids())
            or len(refined.Faces()) != len(shape.Faces()) or issues(refined)):
        raise ValueError("Exact boundary subdivision changed faces/solids or left continuity faults")
    return refined, {"modified": True, "edges": rows,
                     "method": "Exact C1 boundary/pcurve subdivision at existing knots; surfaces unchanged; no fitting or fix",
                     "edge_count_before": len(shape.Edges()), "edge_count_after": len(refined.Edges()),
                     "face_count_unchanged": len(shape.Faces())}


def _tighten_inherited_tolerances(shape):
    """Repair false SmallEdge reports only when actual representations permit it."""
    import cadquery as cq
    from OCP.Adaptor3d import Adaptor3d_CurveOnSurface
    from OCP.BOPAlgo import BOPAlgo_ArgumentAnalyzer
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Curve2d, BRepAdaptor_Surface
    from OCP.GeomLib import GeomLib_CheckCurveOnSurface
    from OCP.ShapeFix import ShapeFix_ShapeTolerance
    from OCP.TopAbs import TopAbs_EDGE, TopAbs_VERTEX
    from OCP.TopExp import TopExp
    from OCP.TopTools import TopTools_IndexedMapOfShape

    def small_edges():
        analyzer = BOPAlgo_ArgumentAnalyzer()
        analyzer.SetShape1(shape.wrapped)
        analyzer.SmallEdgeMode = True
        analyzer.Perform()
        return list(analyzer.GetCheckResult())

    issues = small_edges()
    if not issues:
        return {"edges": [], "vertices": [], "small_edge_check": "passed"}
    edges, vertices = TopTools_IndexedMapOfShape(), TopTools_IndexedMapOfShape()
    TopExp.MapShapes_s(shape.wrapped, TopAbs_EDGE, edges)
    TopExp.MapShapes_s(shape.wrapped, TopAbs_VERTEX, vertices)
    diagnosed = set()
    for issue in issues:
        if not str(issue.GetCheckStatus()).endswith("BOPAlgo_TooSmallEdge"):
            raise ValueError(f"Unexpected small-edge diagnostic: {issue.GetCheckStatus()}")
        for faulty in issue.GetFaultyShapes1():
            if faulty.ShapeType() == TopAbs_EDGE:
                diagnosed.add(edges.FindIndex(faulty))
    adjacency = {}
    for face_index, face in enumerate(shape.Faces(), 1):
        for edge in face.Edges():
            adjacency.setdefault(edges.FindIndex(edge.wrapped), []).append((face_index, face))
    measured = {}

    def measure(index):
        if index in measured:
            return measured[index]
        edge = cq.Edge(edges.FindKey(index))
        if not BRep_Tool.SameParameter_s(edge.wrapped) or not BRep_Tool.SameRange_s(edge.wrapped):
            raise ValueError(f"Cannot tighten edge {index} without consistent parameters")
        curve = BRepAdaptor_Curve(edge.wrapped)
        rows = []
        for face_index, face in adjacency.get(index, []):
            pc = BRepAdaptor_Curve2d(edge.wrapped, face.wrapped)
            surface = BRepAdaptor_Surface(face.wrapped, False)
            check = GeomLib_CheckCurveOnSurface(curve, 1e-10)
            check.Perform(Adaptor3d_CurveOnSurface(pc, surface))
            if not check.IsDone():
                raise ValueError(f"Could not bound edge {index} / face {face_index} error")
            gap = check.MaxDistance()
            # Independent sampling guards against a failed extrema search.
            for n in range(257):
                t = curve.FirstParameter()+(curve.LastParameter()-curve.FirstParameter())*n/256
                uv = pc.Value(t)
                gap = max(gap, curve.Value(t).Distance(surface.Value(uv.X(), uv.Y())))
            rows.append({"face_index": face_index, "maximum_curve_surface_gap_mm": gap,
                         "face_tolerance_mm": BRep_Tool.Tolerance_s(face.wrapped)})
        if not rows:
            raise ValueError(f"Cannot tighten free edge {index}")
        measured[index] = rows
        return rows

    setter = ShapeFix_ShapeTolerance()
    edge_rows, affected_vertices = [], {}
    for index in sorted(diagnosed):
        edge = cq.Edge(edges.FindKey(index))
        old = BRep_Tool.Tolerance_s(edge.wrapped)
        rows = measure(index)
        needed = max([1e-7]+[max(r["face_tolerance_mm"],
                      r["maximum_curve_surface_gap_mm"]*1.1+1e-7) for r in rows])
        if needed >= old or needed >= edge.Length()/100:
            raise ValueError(f"Edge {index} is genuinely too small for its required accuracy")
        setter.SetTolerance(edge.wrapped, needed, TopAbs_EDGE)
        edge_rows.append({"edge_index": index, "length_mm": edge.Length(),
                          "before_tolerance_mm": old, "after_tolerance_mm": needed,
                          "adjacent_faces": rows})
        for vertex in edge.Vertices():
            affected_vertices[vertices.FindIndex(vertex.wrapped)] = vertex
    vertex_rows = []
    all_edges = [cq.Edge(edges.FindKey(i)) for i in range(1, edges.Extent()+1)]
    for vi, vertex in affected_vertices.items():
        old, point = BRep_Tool.Tolerance_s(vertex.wrapped), BRep_Tool.Pnt_s(vertex.wrapped)
        needed, incident = 1e-7, []
        for index, edge in enumerate(all_edges, 1):
            if not any(vertex.isSame(v) for v in edge.Vertices()):
                continue
            curve = BRepAdaptor_Curve(edge.wrapped)
            ends = (curve.FirstParameter(), curve.LastParameter())
            gap = min(point.Distance(curve.Value(t)) for t in ends)
            rows = measure(index)
            face_endpoint_gap = 0.0
            for _, face in adjacency[index]:
                pc = BRepAdaptor_Curve2d(edge.wrapped, face.wrapped)
                surface = BRepAdaptor_Surface(face.wrapped, False)
                face_endpoint_gap = max(face_endpoint_gap,
                    min(point.Distance(surface.Value(pc.Value(t).X(), pc.Value(t).Y())) for t in ends))
            required = max(BRep_Tool.Tolerance_s(edge.wrapped), gap*1.1+1e-7,
                           face_endpoint_gap*1.1+1e-7,
                           max(r["face_tolerance_mm"] for r in rows))
            needed = max(needed, required)
            incident.append({"edge_index": index, "endpoint_gap_mm": gap,
                             "surface_endpoint_gap_mm": face_endpoint_gap,
                             "edge_tolerance_mm": BRep_Tool.Tolerance_s(edge.wrapped),
                             "adjacent_faces": rows})
        if needed >= old:
            raise ValueError(f"Vertex {vi} cannot safely reduce inherited tolerance")
        setter.SetTolerance(vertex.wrapped, needed, TopAbs_VERTEX)
        vertex_rows.append({"vertex_index": vi, "position_mm": vertex.toTuple(),
                            "before_tolerance_mm": old, "after_tolerance_mm": needed,
                            "incident_edges": incident})
    if not shape.isValid() or small_edges():
        raise ValueError("Small-edge fault remains after accuracy-based tolerance tightening")
    return {"edges": edge_rows, "vertices": vertex_rows, "small_edge_check": "passed",
            "method": "OCCT curve/surface extrema and independent samples; all incident endpoints checked"}


def normalize_shape(shape, maximum_tolerance=0.0003, *, representation_only=False):
    """Return an independent CQ shape and an auditable selective repair report.

    representation_only skips redundant global BOP diagnostics during export;
    inexpensive boundary-continuity and SmallEdge accuracy prechecks still run
    in both modes.
    The caller must subsequently require a complete native check(True) pass;
    the returned report never treats this restricted pass as native validation.
    """
    import cadquery as cq
    from OCP.BOPAlgo import BOPAlgo_ArgumentAnalyzer
    from OCP.BRep import BRep_Builder, BRep_Tool
    from OCP.BRepBndLib import BRepBndLib
    from OCP.Bnd import Bnd_Box
    from OCP.TopAbs import TopAbs_EDGE, TopAbs_VERTEX
    from OCP.TopExp import TopExp
    from OCP.TopTools import TopTools_IndexedMapOfShape

    if not shape.isValid():
        raise ValueError("Cannot normalize an invalid input shape")
    result = shape.copy(mesh=True)
    before_volume = result.Volume(tol=1e-8)

    def bounds(value):
        box = Bnd_Box()
        # This conservative CAD enclosure is an invariance check, not a tight
        # dimension measurement. Exact extrema of unmeshed high-degree patches
        # can take minutes, while no geometric entity is modified by this tool.
        BRepBndLib.Add_s(value.wrapped, box, False)
        return list(box.Get())

    before_bounds = bounds(result)
    face_tolerances = [BRep_Tool.Tolerance_s(face.wrapped) for face in result.Faces()]
    result, refinement = _refine_c0_boundaries(result)
    tightening = _tighten_inherited_tolerances(result)
    analyzer = BOPAlgo_ArgumentAnalyzer()
    analyzer.SetShape1(result.wrapped)
    analyzer.ArgumentTypeMode = not representation_only
    analyzer.SelfInterMode = not representation_only
    analyzer.SmallEdgeMode = not representation_only
    analyzer.ContinuityMode = not representation_only
    analyzer.CurveOnSurfaceMode = True
    analyzer.Perform()
    edges, vertices = TopTools_IndexedMapOfShape(), TopTools_IndexedMapOfShape()
    TopExp.MapShapes_s(result.wrapped, TopAbs_EDGE, edges)
    TopExp.MapShapes_s(result.wrapped, TopAbs_VERTEX, vertices)
    diagnosed = {}
    for issue in analyzer.GetCheckResult():
        status = str(issue.GetCheckStatus())
        if not status.endswith("BOPAlgo_InvalidCurveOnSurface"):
            raise ValueError(f"Cannot normalize non-representation fault: {status}")
        for faulty in issue.GetFaultyShapes1():
            if faulty.ShapeType() == TopAbs_EDGE:
                index = edges.FindIndex(faulty)
                diagnosed[index] = max(diagnosed.get(index, 0.0), issue.GetMaxDistance1())
    builder = BRep_Builder()
    edge_rows, vertex_rows = [], {}
    for index, distance in sorted(diagnosed.items()):
        edge = cq.Edge(edges.FindKey(index))
        old = BRep_Tool.Tolerance_s(edge.wrapped)
        tolerance = max(old, distance*1.02+1e-7)
        if tolerance > maximum_tolerance:
            raise ValueError(f"Edge {index} requires {tolerance:.9g} mm, above {maximum_tolerance}")
        builder.UpdateEdge(edge.wrapped, tolerance)
        for vertex in edge.Vertices():
            vi = vertices.FindIndex(vertex.wrapped)
            previous = BRep_Tool.Tolerance_s(vertex.wrapped)
            updated = max(previous, tolerance)
            builder.UpdateVertex(vertex.wrapped, updated)
            record = vertex_rows.setdefault(vi, {"vertex_index": vi,
                                                 "before_tolerance_mm": previous})
            record["after_tolerance_mm"] = updated
        edge_rows.append({"edge_index": index, "measured_curve_surface_gap_mm": distance,
                          "before_tolerance_mm": old, "after_tolerance_mm": tolerance})
    if not result.isValid() or len(result.Solids()) != len(shape.Solids()):
        raise ValueError("Selective normalization changed valid solid topology")
    if face_tolerances != [BRep_Tool.Tolerance_s(face.wrapped) for face in result.Faces()]:
        raise AssertionError("Face tolerances must remain unchanged")
    after_volume = result.Volume(tol=1e-8) if edge_rows or tightening["edges"] or refinement["modified"] else before_volume
    after_bounds = bounds(result)
    # Exact subdivision changes the numerical integration partition. Compare
    # its two independently integrated results within their requested accuracy;
    # corresponding curve positions are separately required unchanged above.
    volume_limit = max(1e-7, abs(before_volume)*(2e-8 if refinement["modified"] else 1e-12))
    if abs(after_volume-before_volume) > volume_limit:
        raise AssertionError("Selective normalization changed adaptive volume")
    if max(abs(a-b) for a, b in zip(before_bounds, after_bounds)) > 1e-9:
        raise AssertionError("Selective normalization changed geometric bounds")
    return result, {"method": "Only diagnosed edges and their vertices; gap*1.02+1e-7 mm",
                    "representation_only": representation_only,
                    "exact_boundary_topology_refinement": refinement,
                    "inherited_tolerance_tightening": tightening,
                    "diagnostic_scope": ("Boundary continuity, SmallEdge accuracy precheck and CurveOnSurface; complete native BOP required separately"
                                         if representation_only else
                                         "ArgumentType, SelfInter, SmallEdge, Continuity, CurveOnSurface"),
                    "maximum_allowed_tolerance_mm": maximum_tolerance,
                    "modified_edge_count": len(edge_rows), "modified_vertex_count": len(vertex_rows),
                    "edges": edge_rows, "vertices": list(vertex_rows.values()),
                    "adaptive_volume_before_mm3": before_volume,
                    "adaptive_volume_after_mm3": after_volume,
                    "adaptive_volume_comparison_limit_mm3": volume_limit,
                    "adaptive_volume_partition_changed": refinement["modified"],
                    "geometric_bounds_before_mm": before_bounds,
                    "geometric_bounds_after_mm": after_bounds,
                    "bounds_method": "Conservative BRepBndLib.Add enclosure; not tight physical dimensions",
                    "face_tolerances_unchanged": True, "native_BOP": "pending"}


def verify_native_bop(path, freecad_python=None):
    executable = Path(freecad_python or os.environ.get("SAILSIQ_FREECAD_PYTHON",
                                                      "E:/FreeCAD_1.1/bin/python.exe"))
    code = ("import sys,FreeCAD,Part; s=Part.read(sys.argv[1]); "
            "assert s.isValid(); s.check(True); print('STRICT_NATIVE_BOP_PASSED')")
    process = subprocess.run([str(executable), "-c", code, str(Path(path).resolve())],
                             capture_output=True, text=True, encoding="utf-8", errors="replace",
                             timeout=600, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if process.returncode or "STRICT_NATIVE_BOP_PASSED" not in process.stdout:
        raise RuntimeError("Native BOP failed after selective normalization:\n"
                           +(process.stdout+"\n"+process.stderr)[-16000:])


def main():
    import cadquery as cq
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--freecad-python", type=Path)
    args = parser.parse_args()
    source, output = args.input.resolve(), args.output.resolve()
    if source.suffix.lower() not in {".brep", ".brp"} or output.suffix.lower() not in {".brep", ".brp"}:
        parser.error("Input and output must be native BREP files")
    shape, report = normalize_shape(cq.Shape.importBrep(str(source)))
    # Publish only a candidate that has passed FreeCAD's complete native check.
    with tempfile.TemporaryDirectory(prefix="normalized_cad_", dir=str(output.parent)) as temporary:
        candidate = Path(temporary)/"candidate.brep"
        assert shape.exportBrep(str(candidate))
        verify_native_bop(candidate, args.freecad_python)
        report["native_BOP"] = "passed without additional repair"
        report["source"] = str(source)
        report["output"] = str(output)
        os.replace(candidate, output)
    report_path = args.report or output.with_suffix(".normalization.json")
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(output), "modified_edges": report["modified_edge_count"],
                      "native_BOP": report["native_BOP"]}), flush=True)


if __name__ == "__main__":
    main()
