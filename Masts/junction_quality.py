"""Independent BREP measurements of the saddle/root/branch junction.

Profiles measure the OUTERMOST right-hand X surface at fixed Y/Z, relative
to the actual saddle offset curve. Unlike the perimeter G1 check, this can
reveal a bulge followed by a hollow before the outgoing branches. A genuine
fork opening also changes a profile: reported valleys are observations, not
automatic design failures. Section counts similarly describe topology only.

Example::
    python Masts/junction_quality.py --model j80 --brep model.brep \
        --out quality.json --plot quality.png
"""
from __future__ import annotations

from functools import lru_cache
import json
from math import ceil
from pathlib import Path

import cadquery as cq
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector
from OCP.gp import gp_Dir, gp_Lin, gp_Pnt


def _stations(lo, hi, step):
    count = max(1, ceil((hi-lo)/step))
    return [lo+(hi-lo)*i/count for i in range(count+1)]


def _valleys(rows, tolerance=0.02, min_depth=0.1):
    """Find a descending run followed by recovery, retaining physical units."""
    peaks, valleys = [], []
    for i in range(1, len(rows)-1):
        a, b, c = (rows[j]["height_x_mm"] for j in (i-1, i, i+1))
        if b is None or a is None or c is None:
            continue
        if b >= a-tolerance and b > c+tolerance:
            # A descending shoulder can contain many samples. Start only
            # at the last local high point before the actual descent.
            if not peaks or rows[peaks[-1]]["height_x_mm"] < b:
                peaks.append(i)
        if not peaks:
            continue
        if b < a-tolerance and b <= c+tolerance:
            j = i
            while j+1 < len(rows) and rows[j+1]["height_x_mm"] is not None:
                if rows[j+1]["height_x_mm"] < rows[j]["height_x_mm"]-tolerance:
                    break
                j += 1
            peak_i = peaks[-1]
            before = rows[peak_i]["height_x_mm"]
            recovery = rows[j]["height_x_mm"]
            depth = min(before-b, recovery-b)
            if depth >= min_depth:
                valleys.append({
                    "peak_y_mm": rows[peak_i]["y_mm"],
                    "peak_height_x_mm": before,
                    "minimum_y_mm": rows[i]["y_mm"],
                    "minimum_height_x_mm": b,
                    "recovery_y_mm": rows[j]["y_mm"],
                    "recovery_height_x_mm": recovery,
                    "drop_from_preceding_peak_mm": before-b,
                    "recovered_depth_mm": depth,
                    "near_saddle_surface": b < 0.1,
                    "separate_outward_interval_at_minimum": rows[i][
                        "right_hand_material_interval_count"] > 1,
                    "interpretation": "Inspect with section topology; a fork opening can be intentional.",
                })
            peaks.clear()
    return valleys


def measure_junction(model, bracket, *, y_min=0.0, y_max=55.0,
                     profile_step=1.0, section_step=2.0,
                     z_offsets=(-8.0, -4.0, 0.0, 4.0, 8.0),
                     section_half_height=50.0, label=None):
    """Return JSON-safe measurements; never label the shape mechanically safe.

    Section areas cover one complete right-hand root/branch pair in the given
    Z window. The shell and known strap guides are subtracted for a second
    section series. Those reference geometries are generated from the model's
    actual dimensional parameters; no root/branch construction is used.
    """
    from tree_bracing import make_strap_guides

    p = model.P
    if isinstance(bracket, cq.Workplane):
        bracket = bracket.val()
    if not bracket.isValid() or len(bracket.Solids()) != 1:
        raise ValueError("Measurement requires one valid finished bracket solid")
    wire = model.SECTION.envelope_wire(
        p.mast_outer_w, p.mast_outer_h,
        p.silicone_gap+p.front_bracing_side_t)
    curves = []
    for edge in wire.Edges():
        box = edge.BoundingBox()
        if box.xmax > 0 and box.ymax >= y_min and box.ymin <= y_max:
            curve = BRepAdaptor_Curve(edge.wrapped)
            lo, hi = curve.FirstParameter(), curve.LastParameter()
            a, b = curve.Value(lo).Y(), curve.Value(hi).Y()
            if a < b and curve.Value((lo+hi)/2).X() > 0:
                curves.append((a, b, curve, lo, hi))
    curves.sort(key=lambda row: row[0])

    @lru_cache(maxsize=1024)
    def baseline_x(y):
        candidate = [row for row in curves if row[0]-1e-7 <= y <= row[1]+1e-7]
        if not candidate:
            raise ValueError(f"No actual right-hand saddle curve at Y={y}")
        _, _, curve, lo, hi = candidate[0]
        for _ in range(48):
            mid = (lo+hi)/2
            if curve.Value(mid).Y() < y:
                lo = mid
            else:
                hi = mid
        return curve.Value((lo+hi)/2).X()

    intersector = IntCurvesFace_ShapeIntersector()
    intersector.Load(bracket.wrapped, 1e-7)
    x_limit = bracket.BoundingBox().xmax+10.0

    def profile_at(y, dz):
        x0 = baseline_x(y)
        intersector.Perform(gp_Lin(gp_Pnt(0.0, y, p.mount_center_z+dz),
                                 gp_Dir(1.0, 0.0, 0.0)), 0.0, x_limit)
        if not intersector.IsDone():
            raise RuntimeError(f"Ray intersection failed at Y={y}, Z={dz}")
        hits = []
        for index in range(1, intersector.NbPnt()+1):
            hit = intersector.WParameter(index)
            if hit <= 1e-7:
                continue
            face = cq.Face(intersector.Face(index))
            normal, _ = face.normalAt(intersector.UParameter(index),
                                      intersector.VParameter(index))
            hits.append((hit, normal.x))
        hits.sort()
        unique = []
        for hit, dot in hits:
            if not unique or hit-unique[-1][0] > 2e-5:
                unique.append([hit, dot])
            elif abs(dot) > abs(unique[-1][1]):
                unique[-1][1] = dot
        intervals = []
        start = None
        for hit, dot in unique:
            if abs(dot) < 1e-7:
                continue  # Tangency is not an entry/exit through material.
            if dot < 0:
                start = hit
            elif start is not None:
                intervals.append([start, hit])
                start = None
            elif not intervals and bracket.isInside(
                    (hit/2, y, p.mount_center_z+dz), 1e-7):
                intervals.append([0.0, hit])
        outer = intervals[-1][1] if intervals else None
        return {"y_mm": y, "z_from_centre_mm": dz, "saddle_x_mm": x0,
                "outer_x_mm": outer,
                "height_x_mm": None if outer is None else outer-x0,
                "right_hand_material_interval_count": len(intervals),
                "right_hand_material_intervals_x_mm": intervals}

    profiles = []
    for dz in z_offsets:
        samples = [profile_at(y, float(dz))
                   for y in _stations(y_min, y_max, profile_step)]
        valleys = _valleys(samples)
        profiles.append({"z_from_centre_mm": float(dz), "samples": samples,
                         "valleys": valleys,
                         "maximum_recovered_valley_depth_mm": max(
                             (v["recovered_depth_mm"] for v in valleys), default=0.0)})

    # Subtract the finished reference shell and guides once; no use of the
    # candidate support construction or its control points is made here.
    reference = model.make_front_bracing_shell(p).val().fuse(
        make_strap_guides(p, model.SECTION).val()).clean()
    sections = []
    for y in _stations(y_min+0.01, y_max, section_step):
        plane = cq.Plane(origin=(x_limit/2, y, p.mount_center_z),
                         xDir=(1, 0, 0), normal=(0, -1, 0))
        boundary = cq.Workplane(plane).rect(x_limit, 2*section_half_height).val()
        face = cq.Face.makeFromWires(boundary)
        row = {"y_mm": y}
        whole = bracket.intersect(face).clean()
        # Subtract planar reference sections, avoiding a fragile 3D Boolean
        # between two exactly tangent shell skins merely to measure an area.
        extension = whole.cut(reference.intersect(face)).clean()
        for name, cut in (("whole", whole), ("support_extension", extension)):
            faces = [f for f in cut.Faces() if f.Area() > 1e-5]
            # Faces split only by BREP seams have been merged by clean(). Each
            # remaining face describes one planar material region (with holes).
            row[name+"_area_mm2"] = sum(f.Area() for f in faces)
            row[name+"_region_count"] = len(faces)
            row[name+"_regions"] = [
                {"area_mm2": f.Area(), "z_min_from_centre_mm": f.BoundingBox().zmin-p.mount_center_z,
                 "z_max_from_centre_mm": f.BoundingBox().zmax-p.mount_center_z,
                 "x_min_mm": f.BoundingBox().xmin, "x_max_mm": f.BoundingBox().xmax}
                for f in faces]
        sections.append(row)

    changes = []
    for previous, row in zip(sections, sections[1:]):
        before, after = (r["support_extension_region_count"] for r in (previous, row))
        if before != after:
            changes.append({"y_interval_mm": [previous["y_mm"], row["y_mm"]],
                            "regions_before": before, "regions_after": after})
    return {
        "model": model.__name__.split("_")[0], "label": label,
        "valid_solid_count": len(bracket.Solids()), "volume_mm3": bracket.Volume(tol=1e-8),
        "measurement": "Final BREP; fixed-Y/Z right-hand outermost X envelope minus actual saddle X",
        "height_direction": "Global X, not shell-normal thickness",
        "limits": ["Sampling locates shape defects; it does not prove their absence between samples.",
                   "A valley at a true fork opening is not automatically a defect.",
                   "Sections are planar geometric area, not load-normal effective structural area.",
                   "Region counts describe topology; intended splitting into two branches is expected.",
                   "Known reference shell and guides are excluded from support_extension sections."],
        "scan_y_mm": [y_min, y_max], "profile_step_mm": profile_step,
        "section_step_max_mm": section_step,
        "section_z_window_from_centre_mm": [-section_half_height, section_half_height],
        "profiles": profiles, "sections": sections,
        "support_extension_region_count_changes": changes,
    }


def plot_report(report, path):
    """Create a deterministic, headless scientific figure (no GUI dependency)."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(3, 1, figsize=(10, 10), sharex=True,
                             gridspec_kw={"height_ratios": [2, 1, 1]})
    for profile in report["profiles"]:
        rows = profile["samples"]
        axes[0].plot([r["y_mm"] for r in rows], [r["height_x_mm"] for r in rows],
                     label=f"Z offset {profile['z_from_centre_mm']:g} mm", linewidth=1.5)
        for valley in profile["valleys"]:
            axes[0].scatter(valley["minimum_y_mm"], valley["minimum_height_x_mm"], s=20)
    rows = report["sections"]
    ys = [r["y_mm"] for r in rows]
    axes[0].set_ylabel("Outermost X height above saddle [mm]")
    axes[0].legend(ncol=3, fontsize=9)
    axes[1].plot(ys, [r["support_extension_area_mm2"] for r in rows], color="#255a8b")
    axes[1].set_ylabel("Support extension\nsection area [mm2]")
    axes[2].step(ys, [r["support_extension_region_count"] for r in rows], where="mid", color="#965621")
    axes[2].set_ylabel("Support section\nregion count")
    axes[2].set_xlabel("Y [mm] - root toward outgoing branches")
    axes[2].set_ylim(bottom=-0.1)
    for axis in axes:
        axis.grid(alpha=0.25)
    fig.suptitle(f"{report['model'].upper()} junction profile: {report.get('label') or 'candidate'}")
    fig.text(.5, .015, "Valleys and region changes require topology review; these are geometry measurements, not strength results.",
             ha="center", fontsize=9)
    fig.tight_layout(rect=(0, .035, 1, .97))
    fig.savefig(str(path), dpi=180)
    plt.close(fig)


def main():
    import argparse
    from validate_mast_sections import load_models
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=("fareast23r", "fareast28r", "j80"), required=True)
    parser.add_argument("--brep", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--plot", type=Path)
    parser.add_argument("--label")
    parser.add_argument("--y-min", type=float, default=0.0)
    parser.add_argument("--y-max", type=float, default=55.0)
    parser.add_argument("--profile-step", type=float, default=1.0)
    parser.add_argument("--section-step", type=float, default=2.0)
    args = parser.parse_args()
    model = next(m for m in load_models() if m.__name__.split("_")[0] == args.model)
    report = measure_junction(model, cq.importers.importBrep(str(args.brep)).val(),
        y_min=args.y_min, y_max=args.y_max, profile_step=args.profile_step,
        section_step=args.section_step, label=args.label)
    report["source_brep"] = str(args.brep.resolve())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    if args.plot:
        args.plot.parent.mkdir(parents=True, exist_ok=True)
        plot_report(report, args.plot)
    print(json.dumps({"model": report["model"], "label": report["label"],
        "volume_mm3": report["volume_mm3"],
        "profiles": [{k: v for k, v in p.items() if k != "samples"} for p in report["profiles"]],
        "support_extension_region_count_changes": report["support_extension_region_count_changes"]}, indent=2))


if __name__ == "__main__":
    main()
