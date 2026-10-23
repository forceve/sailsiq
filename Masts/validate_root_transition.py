"""Measure the finished root/saddle surface, independently of its height formula.

The baseline is the actual offset mast curve used by the saddle. Rays follow
its outward normal and stop at the FIRST exit of the shell-connected material;
a separate branch farther along a ray is deliberately not treated as root
height. Final BREP face normals, including both faces at a seam, are measured.

Example: python Masts/validate_root_transition.py --model j80 --brep FILE
"""
from functools import lru_cache
from math import acos, ceil, cos, degrees, pi, sin

import cadquery as cq
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE
from OCP.TopExp import TopExp
from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape
from OCP.gp import gp_Dir, gp_Lin, gp_Pnt, gp_Vec


class RootValidationError(AssertionError):
    def __init__(self, report):
        self.report = report
        super().__init__("; ".join(report["failures"]))


def _stations(lo, hi, step):
    count = max(1, ceil((hi-lo)/step))
    return [lo+(hi-lo)*i/count for i in range(count+1)]


def validate_root(model, bracket, *, boundary_samples, y0=0.0, y1=30.0, hz=15.0,
                  boundary_step=2.0):
    """Require sampled full-perimeter G1 and monotonic radial tail convergence.

    A numerical sampling check complements, rather than proves, analytic G1.
    Heights here are true shell-normal ray distances, not X displacement.
    """
    p = model.P
    if isinstance(bracket, cq.Workplane):
        bracket = bracket.val()
    assert bracket.isValid() and len(bracket.Solids()) == 1
    wire = model.SECTION.envelope_wire(
        p.mast_outer_w, p.mast_outer_h,
        p.silicone_gap+p.front_bracing_side_t)
    curves = []
    for edge in wire.Edges():
        box = edge.BoundingBox()
        if box.xmin > 0 and box.ymax >= y0-1 and box.ymin <= 58:
            curve = BRepAdaptor_Curve(edge.wrapped)
            u0, u1 = curve.FirstParameter(), curve.LastParameter()
            a, b = curve.Value(u0).Y(), curve.Value(u1).Y()
            if a >= b:
                continue  # Closing/rail segments are not the outer right flank.
            curves.append((a, b, curve, u0, u1))
    curves.sort(key=lambda row: row[0])

    @lru_cache(maxsize=4096)
    def baseline(y):
        candidates = [row for row in curves if row[0]-1e-8 <= y <= row[1]+1e-8]
        assert candidates, f"No actual saddle curve at Y={y}"
        _, _, curve, lo, hi = candidates[0]
        for _ in range(48):
            mid = (lo+hi)/2
            if curve.Value(mid).Y() < y:
                lo = mid
            else:
                hi = mid
        point, tangent = gp_Pnt(), gp_Vec()
        curve.D1((lo+hi)/2, point, tangent)
        normal = cq.Vector(tangent.Y(), -tangent.X(), 0).normalized()
        return point.X(), point.Y(), normal.x, normal.y

    intersector = IntCurvesFace_ShapeIntersector()
    intersector.Load(bracket.wrapped, 1e-7)
    inset = 0.05

    def measure(side, y, dz):
        x, actual_y, nx, ny = baseline(float(y))
        normal = cq.Vector(side*nx, ny, 0)
        base = cq.Vector(side*x, actual_y, p.mount_center_z+dz)
        start = base-normal*inset
        intersector.Perform(gp_Lin(start.toPnt(), gp_Dir(*normal.toTuple())),
                            0.0, 40.0)
        assert intersector.IsDone() and intersector.NbPnt(), (
            f"No shell-connected surface: side={side}, Y={y}, Z={dz}")
        hits = sorted((intersector.WParameter(i), i)
                      for i in range(1, intersector.NbPnt()+1)
                      if intersector.WParameter(i) >= -1e-8)
        assert hits, "Normal ray has no forward surface hit"
        distance = hits[0][0]
        # A ray on a common edge may hit two adjacent faces. Test both normals.
        angles = []
        for hit_distance, index in hits:
            if hit_distance-distance > 2e-6:
                break
            face = cq.Face(intersector.Face(index))
            measured_normal, _ = face.normalAt(intersector.UParameter(index),
                                               intersector.VParameter(index))
            dot = max(-1.0, min(1.0, measured_normal.dot(normal)))
            # On a valid closed solid, a transverse FIRST hit with positive
            # outward-normal dot ray direction is an exit, proving that the
            # ray starts in material rather than hitting a remote branch.
            assert dot > 1e-5, (
                f"First ray hit is not a transverse material exit: {side}, {y}, {dz}")
            angles.append(degrees(acos(dot)))
        return {"normal_height_mm": distance-inset,
                "normal_angle_deg": max(angles),
                "coincident_faces_checked": len(angles)}

    # Read the actual curved footprint. Do not substitute its bounding rectangle
    # or assume that the exactly shell-conforming curve is a perfect ellipse.
    assert len(boundary_samples) >= 100
    perimeter = {(row['point_mm'][1], row['point_mm'][2]-p.mount_center_z)
                 for row in boundary_samples}
    boundary = []
    for side in (-1, 1):
        for y, dz in sorted(perimeter):
            row = {"side": side, "y_mm": y, "z_from_centre_mm": dz}
            row.update(measure(side, y, dz))
            boundary.append(row)

    fractions = (0.8, 0.9, 0.95, 0.98, 0.99, 0.995, 1.0, 1.01, 1.03)
    centre = (y0+y1)/2
    radial = []
    for side in (-1, 1):
        # Choose distributed points from the actual boundary, then approach
        # each point along its straight YZ radius from the footprint centre.
        for y, z in sorted(perimeter)[::max(1, len(perimeter)//72)]:
            samples = [measure(side, centre+r*(y-centre), r*z)
                       for r in fractions]
            radial.append({"side": side, "boundary_yz_mm": [y,z],
                           "normal_heights_mm": [s["normal_height_mm"] for s in samples],
                           "normal_angles_deg": [s["normal_angle_deg"] for s in samples]})

    # Also inspect the public seam chains inside the footprint. This catches a
    # sharp arm/patch intersection that a perfect outer perimeter would miss.
    adjacency = TopTools_IndexedDataMapOfShapeListOfShape()
    TopExp.MapShapesAndAncestors_s(bracket.wrapped, TopAbs_EDGE, TopAbs_FACE,
                                  adjacency)
    seams = []
    from tree_bracing import make_strap_guides
    guide_skin = cq.Compound.makeCompound(make_strap_guides(p, model.SECTION).val().Faces())
    for index in range(1, adjacency.Extent()+1):
        edge = cq.Edge(adjacency.FindKey(index))
        box = edge.BoundingBox()
        if (box.ymax < y0-1e-7 or box.ymin > 58
                or box.zmax < p.mount_center_z-20.001
                or box.zmin > p.mount_center_z+20.001):
            continue
        faces = [cq.Face(face) for face in adjacency.FindFromIndex(index)]
        if len(faces) != 2:
            continue
        samples = []
        for fraction in (.05, .25, .5, .75, .95):
            point = edge.positionAt(fraction)
            z_limit = hz+1e-7 if point.y <= y1 else 20.001
            if not (y0-1e-7 <= point.y <= 58
                    and abs(point.z-p.mount_center_z) <= z_limit):
                continue
            shell_x = baseline(float(max(y0, point.y)))[0]
            if abs(point.x) < shell_x-.01:
                continue  # Inner shell and cap edges are outside this audit.
            if (abs(point.z-p.mount_center_z) > hz+1e-7
                    and cq.Vertex.makeVertex(*point.toTuple()).distance(guide_skin) < 1e-5):
                continue  # Functional strap-guide rims are intentionally sharp.
            normals = [face.normalAt(point) for face in faces]
            dot = max(-1.0, min(1.0, normals[0].dot(normals[1])))
            samples.append({"edge_fraction": fraction,
                            "point_mm": point.toTuple(),
                            "normal_angle_deg": degrees(acos(dot))})
        if samples:
            seams.append({"edge_index_in_this_brep": index,
                          "length_mm": edge.Length(),
                          "adjacent_surface_types": [face.geomType() for face in faces],
                          "maximum_normal_angle_deg": max(
                              row["normal_angle_deg"] for row in samples),
                          "samples": samples})
    assert seams, "No public root surface seams were inspected"

    maximum_gap = max(abs(row["normal_height_mm"]) for row in boundary)
    maximum_angle = max(row["normal_angle_deg"] for row in boundary)
    # The forward neck overhangs the saddle. At inner radial positions a ray
    # exits the shared stem, then switches to the feathered underside near the
    # rim. Retain that whole trace, but test taper on the boundary neighborhood
    # itself; treating the outgoing stem as a scalar shell-height field is wrong.
    maximum_increase = max(b-a for row in radial
                           for a, b in zip(row["normal_heights_mm"][3:],
                                           row["normal_heights_mm"][4:]))
    minimum_height = min(min(row["normal_heights_mm"]) for row in radial)
    maximum_outside_height = max(abs(h) for row in radial
                                 for h in row["normal_heights_mm"][6:])
    maximum_seam_angle = max(row["maximum_normal_angle_deg"] for row in seams)
    failures = []
    if maximum_gap >= 0.01:
        failures.append(f"Root perimeter gap {maximum_gap:.9g} mm >= 0.01 mm")
    if maximum_angle >= 0.5:
        failures.append(f"Root perimeter normal angle {maximum_angle:.9g} deg >= 0.5 deg")
    if maximum_increase > 0.0002:
        failures.append(f"Root radial tail increases by {maximum_increase:.9g} mm")
    if minimum_height < -0.0002:
        failures.append(f"Root radial tail enters the nominal shell by {-minimum_height:.9g} mm")
    if maximum_outside_height >= 0.01:
        failures.append(f"Root radial exterior height {maximum_outside_height:.9g} mm >= 0.01 mm")
    if maximum_seam_angle >= 0.5:
        failures.append(f"Public root surface seam angle {maximum_seam_angle:.9g} deg >= 0.5 deg")
    report = {
        "model": model.__name__.split("_")[0], "passed": not failures,
        "measurement": "First exit from shell-connected final solid along true saddle normal",
        "limits": "Sampled geometry continuity, not a strength or all-points proof",
        "footprint_y_mm": [y0, y1], "footprint_z_from_centre_mm": [-hz, hz],
        "boundary_sample_count": len(boundary), "radial_direction_count": len(radial),
        "radial_fractions_of_actual_boundary": list(fractions),
        "monotonic_tail_test_fractions": list(fractions[3:]),
        "inner_radial_trace_note": "At 0.8..0.95 the shell-normal first exit can be the projecting shared stem. These values are retained but are not the local feathered-rim height field.",
        "maximum_boundary_gap_mm": maximum_gap,
        "maximum_boundary_normal_angle_deg": maximum_angle,
        "maximum_radial_tail_increase_mm": maximum_increase,
        "minimum_radial_normal_height_mm": minimum_height,
        "maximum_radial_boundary_and_exterior_height_mm": maximum_outside_height,
        "public_root_seam_count": len(seams),
        "maximum_public_root_seam_angle_deg": maximum_seam_angle,
        "boundary_samples": boundary, "radial_samples": radial,
        "public_root_seams": seams, "failures": failures,
    }
    if failures:
        raise RootValidationError(report)
    return report


def main():
    import argparse
    import json
    from pathlib import Path
    from validate_mast_sections import load_models
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=("fareast23r", "fareast28r", "j80"), required=True)
    parser.add_argument("--brep", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    model = next(m for m in load_models() if m.__name__.split("_")[0] == args.model)
    try:
        from tree_bracing import junction_geometry
        geometry = junction_geometry(model, model.P)
        report = validate_root(model, cq.importers.importBrep(str(args.brep)).val(),
                               boundary_samples=geometry['root_report']['outer_boundary_samples'])
    except RootValidationError as error:
        report = error.report
    if args.out:
        args.out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items()
                      if key not in {"boundary_samples", "radial_samples", "public_root_seams"}}, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
