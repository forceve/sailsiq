from __future__ import annotations

from dataclasses import dataclass
from importlib import import_module
from math import cos, pi, sin, sqrt
from pathlib import Path
import sys

import cadquery as cq
import ezdxf


OUT_DIR = Path(__file__).resolve().parent / "cadquery_out"
ENCLOSURE_DIR = Path(__file__).resolve().parents[1] / "澶栧３"


@dataclass(frozen=True)
class Params:
    # Coordinate system:
    # X = port/starboard width of the section, Y = fore/aft depth,
    # Z = mast length. The guide rail / luff groove is on +Y.
    # Reference C139 section from the 2006 C-section chart.
    # The chart lists fore/aft depth first, then side width: 139 / 85.
    mast_length: float = 700.0
    mast_outer_w: float = 85.0
    mast_outer_h: float = 139.0
    mast_wall: float = 2.7

    # Luff groove / guide rail proportions inferred from the drawing top feature.
    rail_chamber_w: float = 26.4
    rail_chamber_h: float = 22.4
    rail_mouth_w: float = 12.0
    rail_chamber_drop_from_top: float = 4.8

    # Assembly station: mounted 100 mm down from the top of a 700 mm mast.
    mount_from_top: float = 100.0

    # Semi-bracing mount concept.
    silicone_gap: float = 5.0
    front_bracing_side_t: float = 3.6
    front_bracing_apex_t: float = 1.8
    bracing_tail_angle: float = 0.28
    bracing_tail_extension_len: float = 3.0
    bracing_tail_tip_t: float = 1.0
    strap_t: float = 3.0
    strap_z_w: float = 30.0
    strap_spacing: float = 68.0
    strap_slot_clearance: float = 0.7
    strap_slot_y_len: float = 40.0
    strap_radius_reduction: float = 2.0
    strap_front_clear_fraction: float = 1.0 / 3.0
    strap_cut_clearance: float = 0.35

    # Device side plate and clamp cover.
    plate_w: float = 166.0
    plate_h: float = 128.0
    plate_t: float = 3.0
    plate_standoff_y: float = 16.0
    connector_plate_t: float = 3.0
    connector_bracing_overlap_y: float = 1.2
    connector_panel_overlap_y: float = 2.0
    connector_corner_pad_x: float = 8.0
    connector_corner_pad_y: float = 12.0
    bracing_root_fairing_y: float = 38.0
    panel_fairing_y: float = 30.0

    # SailSIQ device placeholder envelope, oriented on the mast front.
    device_w: float = 140.0
    device_h: float = 106.0
    device_t: float = 22.0
    device_gap_to_plate: float = 0.0

    # Acrylic front cover clamps the device against the fixed panel.
    # Its lower edge stays aligned with the backing panel, while the top edge
    # stops near the device top so the top-edge buttons remain accessible.
    cover_w: float = 166.0
    cover_t: float = 3.0
    cover_window_w: float = 102.0
    cover_window_h: float = 78.0
    cover_window_z_offset: float = 0.0
    clamp_screw_edge_inset: float = 7.0
    cover_screw_clearance_d: float = 3.4
    panel_screw_clearance_d: float = 3.4
    screw_head_d: float = 7.0
    screw_head_recess: float = 1.1

    @property
    def outer_rx(self) -> float:
        return self.mast_outer_w / 2.0

    @property
    def outer_ry(self) -> float:
        return self.mast_outer_h / 2.0

    @property
    def mount_center_z(self) -> float:
        return self.mast_length - self.mount_from_top

    @property
    def bracket_z_h(self) -> float:
        return self.plate_h

    @property
    def front_bracing_inner_rx(self) -> float:
        return self.outer_rx + self.silicone_gap

    @property
    def front_bracing_inner_ry(self) -> float:
        return self.outer_ry + self.silicone_gap

    @property
    def front_bracing_outer_ry(self) -> float:
        return self.front_bracing_inner_ry + self.front_bracing_apex_t

    @property
    def plate_back_y(self) -> float:
        return self.front_bracing_outer_ry + self.plate_standoff_y

    @property
    def device_back_y(self) -> float:
        return self.plate_back_y + self.plate_t + self.device_gap_to_plate

    @property
    def device_front_y(self) -> float:
        return self.device_back_y + self.device_t

    @property
    def cover_back_y(self) -> float:
        return self.device_front_y

    @property
    def cover_front_y(self) -> float:
        return self.cover_back_y + self.cover_t

    @property
    def cover_h(self) -> float:
        return (self.plate_h + self.device_h) / 2.0

    @property
    def cover_center_z(self) -> float:
        return self.mount_center_z + (self.device_h - self.plate_h) / 4.0

    @property
    def cover_bottom_dz(self) -> float:
        return self.cover_center_z - self.mount_center_z - self.cover_h / 2.0

    @property
    def cover_top_dz(self) -> float:
        return self.cover_center_z - self.mount_center_z + self.cover_h / 2.0


P = Params()


def _safe_fillet(obj: cq.Workplane, selector: str, radius: float) -> cq.Workplane:
    try:
        return obj.edges(selector).fillet(radius)
    except Exception:
        return obj


def rounded_box_xy(w: float, h: float, t: float, r: float) -> cq.Workplane:
    r = max(0.1, min(r, w / 2.0 - 0.1, h / 2.0 - 0.1))
    obj = cq.Workplane("XY").rect(w, h).extrude(t).edges("|Z").fillet(r)
    obj = _safe_fillet(obj, ">Z", min(0.8, t / 3.0))
    obj = _safe_fillet(obj, "<Z", min(0.4, t / 4.0))
    return obj


def box_at(x: float, y: float, z: float, sx: float, sy: float, sz: float) -> cq.Workplane:
    return cq.Workplane("XY").box(sx, sy, sz).translate((x, y, z))


def cyl_y(x: float, y: float, z: float, r: float, h: float) -> cq.Workplane:
    return cq.Workplane("XY").circle(r).extrude(h).rotate((0, 0, 0), (1, 0, 0), -90).translate((x, y, z))


def place_xy_solid_as_xz(obj: cq.Workplane, back_y: float, center_z: float) -> cq.Workplane:
    # XY outline becomes an XZ-facing part; original extrusion thickness runs to +Y.
    return obj.rotate((0, 0, 0), (1, 0, 0), -90).translate((0, back_y, center_z))


def place_device_reference(obj: cq.Workplane, p: Params = P) -> cq.Workplane:
    return (
        obj.rotate((0, 0, 0), (1, 0, 0), -90)
        .rotate((0, 0, 0), (0, 1, 0), 180)
        .translate((0, p.device_back_y, p.mount_center_z))
    )


def load_device_enclosure_module():
    enclosure_path = str(ENCLOSURE_DIR)
    if enclosure_path not in sys.path:
        sys.path.insert(0, enclosure_path)
    return import_module("sailsiq_compass_enclosure")


def load_j80_bracing_module():
    j80_path = str(Path(__file__).resolve().parents[1] / "J80桅杆支架")
    if j80_path not in sys.path:
        sys.path.insert(0, j80_path)
    return import_module("j80_mast_bracing_mount")


def bezier_points(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
    samples: int,
) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for i in range(samples + 1):
        t = i / samples
        u = 1.0 - t
        x = u**3 * p0[0] + 3.0 * u * u * t * p1[0] + 3.0 * u * t * t * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3.0 * u * u * t * p1[1] + 3.0 * u * t * t * p2[1] + t**3 * p3[1]
        points.append((x, y))
    return points


def _append_curve(
    points: list[tuple[float, float]],
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
    samples: int,
) -> None:
    curve = bezier_points(p0, p1, p2, p3, samples)
    points.extend(curve if not points else curve[1:])


def c_section_outline_points(rx: float, ry: float) -> list[tuple[float, float]]:
    # Normalized Bezier trace of the reference picture, clockwise from the
    # right top lip around the body to the left top lip.
    right_top = (rx * 0.15, ry * 1.0)
    right: list[tuple[float, float]] = [right_top]

    # Very flat top, tight corner
    _append_curve(right, right[-1], (rx * 0.40, ry * 0.98), (rx * 0.60, ry * 0.95), (rx * 0.75, ry * 0.85), 10)

    # Straight-ish upper side
    _append_curve(right, right[-1], (rx * 0.85, ry * 0.75), (rx * 0.95, ry * 0.50), (rx * 0.98, ry * 0.20), 14)

    # Max width area (almost flat vertically)
    _append_curve(right, right[-1], (rx * 1.00, ry * 0.0), (rx * 1.00, ry * -0.20), (rx * 0.98, ry * -0.40), 10)

    # Lower curve tapering
    _append_curve(right, right[-1], (rx * 0.95, ry * -0.60), (rx * 0.85, ry * -0.80), (rx * 0.65, ry * -0.92), 14)

    # Bottom rounding
    _append_curve(right, right[-1], (rx * 0.45, ry * -0.98), (rx * 0.25, ry * -1.00), (0.0, ry * -1.000), 14)

    left = [(-x, y) for x, y in reversed(right[:-1])]
    return right + left


def c_section_right_x_at_y(rx: float, ry: float, y: float) -> float:
    points = c_section_outline_points(rx, ry)
    right = points[: (len(points) + 1) // 2]
    if y >= right[0][1]:
        return right[0][0]
    if y <= right[-1][1]:
        return right[-1][0]

    for p0, p1 in zip(right, right[1:]):
        y0 = p0[1]
        y1 = p1[1]
        if y0 >= y >= y1:
            span = y1 - y0
            t = 0.0 if abs(span) < 1e-9 else (y - y0) / span
            return p0[0] + (p1[0] - p0[0]) * t
    return right[-1][0]


def c_section_profile_solid(rx: float, ry: float, z_h: float) -> cq.Workplane:
    return cq.Workplane("XY").polyline(c_section_outline_points(rx, ry)).close().extrude(z_h)


def c_section_ring(rx: float, ry: float, t: float, z_h: float, z_center: float) -> cq.Workplane:
    outer = c_section_profile_solid(rx + t, ry + t, z_h)
    inner = c_section_profile_solid(rx, ry, z_h + 2.0).translate((0, 0, -1.0))
    return outer.cut(inner).translate((0, 0, z_center - z_h / 2.0))


def ellipse_ring(rx: float, ry: float, t: float, z_h: float, z_center: float) -> cq.Workplane:
    return c_section_ring(rx, ry, t, z_h, z_center)


def clip_y_band(
    obj: cq.Workplane,
    y_min: float,
    y_max: float,
    z_center: float,
    z_h: float,
    x_span: float = 240.0,
) -> cq.Workplane:
    clip = cq.Workplane("XY").box(x_span, y_max - y_min, z_h + 4.0).translate(
        (0, (y_min + y_max) / 2.0, z_center)
    )
    return obj.intersect(clip)


def front_bracing_outer_point_at_angle(p: Params, angle: float) -> tuple[float, float]:
    rx = p.front_bracing_inner_rx
    ry = p.front_bracing_inner_ry
    x = rx * cos(angle)
    y = ry * sin(angle)
    nx = x / (rx * rx)
    ny = y / (ry * ry)
    normal_len = sqrt(nx * nx + ny * ny)
    nx /= normal_len
    ny /= normal_len

    side_blend = abs(cos(angle)) ** 0.7
    thickness = p.front_bracing_apex_t + (p.front_bracing_side_t - p.front_bracing_apex_t) * side_blend
    return x + nx * thickness, y + ny * thickness


def strap_inner_radii(p: Params = P) -> tuple[float, float]:
    return (
        p.front_bracing_inner_rx + p.front_bracing_side_t + 0.7 - p.strap_radius_reduction,
        p.front_bracing_outer_ry + 0.7 - p.strap_radius_reduction,
    )


def strap_forward_y_offset(p: Params = P) -> float:
    clear_half_angle = pi * p.strap_front_clear_fraction
    boundary_angle = max(0.0, pi / 2.0 - clear_half_angle)
    strap_rx, strap_ry = strap_inner_radii(p)
    brace_x, brace_y = front_bracing_outer_point_at_angle(p, boundary_angle)
    if abs(brace_x) >= strap_rx:
        return 0.0
    return max(0.0, brace_y - strap_ry * sqrt(1.0 - (brace_x / strap_rx) ** 2))


def front_bracing_outer_point(p: Params, angle: float, tail_angle: float) -> tuple[float, float]:
    if 0.0 <= angle <= pi:
        return front_bracing_outer_point_at_angle(p, angle)

    if tail_angle <= 0.0:
        edge_angle = 0.0 if angle < 0.0 else pi
        return front_bracing_outer_point_at_angle(p, edge_angle)

    if angle < 0.0:
        u = max(0.0, min(1.0, (angle + tail_angle) / tail_angle))
        thickness = p.bracing_tail_tip_t + (p.front_bracing_side_t - p.bracing_tail_tip_t) * u
    else:
        u = max(0.0, min(1.0, (angle - pi) / tail_angle))
        thickness = p.front_bracing_side_t + (p.bracing_tail_tip_t - p.front_bracing_side_t) * u

    return offset_ellipse_point(p.front_bracing_inner_rx, p.front_bracing_inner_ry, angle, thickness)


def front_bracing_profile_points(p: Params = P, samples: int = 64) -> list[tuple[float, float]]:
    inner: list[tuple[float, float]] = []
    outer: list[tuple[float, float]] = []
    rx = p.front_bracing_inner_rx
    ry = p.front_bracing_inner_ry

    tail_angle = bracing_tail_extended_angle(p)
    tail_samples = max(6, int(samples * tail_angle / pi)) if tail_angle > 0.0 else 0
    angles: list[float] = []
    if tail_samples:
        angles.extend(-tail_angle + tail_angle * i / tail_samples for i in range(tail_samples))
    angles.extend(pi * i / samples for i in range(samples + 1))
    if tail_samples:
        angles.extend(pi + tail_angle * i / tail_samples for i in range(1, tail_samples + 1))

    for a in angles:
        x = rx * cos(a)
        y = ry * sin(a)
        inner.append((x, y))
        outer.append(front_bracing_outer_point(p, a, tail_angle))
    return inner + list(reversed(outer))


def offset_ellipse_point(rx: float, ry: float, angle: float, offset: float) -> tuple[float, float]:
    x = rx * cos(angle)
    y = ry * sin(angle)
    nx = x / (rx * rx)
    ny = y / (ry * ry)
    normal_len = sqrt(nx * nx + ny * ny)
    nx /= normal_len
    ny /= normal_len
    return x + nx * offset, y + ny * offset


def extrude_xy_profile(
    points: list[tuple[float, float]],
    z_h: float,
    z_center: float,
    fillet_r: float = 0.0,
) -> cq.Workplane:
    obj = (
        cq.Workplane("XY")
        .polyline(points)
        .close()
        .extrude(z_h)
        .translate((0, 0, z_center - z_h / 2.0))
    )
    if fillet_r > 0.0:
        obj = _safe_fillet(obj, "|Z", fillet_r)
    return obj


def ellipse_arc_length(rx: float, ry: float, start_angle: float, end_angle: float, samples: int = 24) -> float:
    lo = min(start_angle, end_angle)
    hi = max(start_angle, end_angle)
    if hi <= lo:
        return 0.0
    step = (hi - lo) / samples
    total = 0.0
    for i in range(samples):
        angle = lo + (i + 0.5) * step
        total += sqrt((rx * sin(angle)) ** 2 + (ry * cos(angle)) ** 2) * step
    return total


def bracing_tail_extended_angle(p: Params = P) -> float:
    if p.bracing_tail_extension_len <= 0.0:
        return p.bracing_tail_angle

    rx = p.front_bracing_inner_rx
    ry = p.front_bracing_inner_ry
    lo = p.bracing_tail_angle
    hi = lo + max(p.bracing_tail_extension_len / min(rx, ry), 0.01)
    while ellipse_arc_length(rx, ry, lo, hi) < p.bracing_tail_extension_len:
        hi += max((hi - lo), 0.01)

    for _ in range(18):
        mid = (lo + hi) / 2.0
        if ellipse_arc_length(rx, ry, p.bracing_tail_angle, mid) < p.bracing_tail_extension_len:
            lo = mid
        else:
            hi = mid
    return hi


def cubic_bezier_points(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
    steps: int = 16,
    include_start: bool = False,
) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    start = 0 if include_start else 1
    for i in range(start, steps + 1):
        t = i / steps
        mt = 1.0 - t
        x = mt**3 * p0[0] + 3.0 * mt * mt * t * p1[0] + 3.0 * mt * t * t * p2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3.0 * mt * mt * t * p1[1] + 3.0 * mt * t * t * p2[1] + t**3 * p3[1]
        points.append((x, y))
    return points


def mirror_profile_x(points: list[tuple[float, float]], sign: float) -> list[tuple[float, float]]:
    if sign > 0:
        return points
    return [(-x, y) for x, y in points]


def smooth_closed_profile(
    points: list[tuple[float, float]],
    iterations: int = 3,
    corner_cut: float = 0.28,
) -> list[tuple[float, float]]:
    smoothed = points[:]
    for _ in range(iterations):
        nxt: list[tuple[float, float]] = []
        for idx, p0 in enumerate(smoothed):
            p1 = smoothed[(idx + 1) % len(smoothed)]
            q = (
                (1.0 - corner_cut) * p0[0] + corner_cut * p1[0],
                (1.0 - corner_cut) * p0[1] + corner_cut * p1[1],
            )
            r = (
                corner_cut * p0[0] + (1.0 - corner_cut) * p1[0],
                corner_cut * p0[1] + (1.0 - corner_cut) * p1[1],
            )
            nxt.extend((q, r))
        smoothed = nxt
    return smoothed


def make_strap_slot_cutters(p: Params = P) -> cq.Workplane:
    cutters: cq.Workplane | None = None
    slot_x_w = p.connector_corner_pad_x + 2.0 * p.strap_slot_clearance + 2.0
    slot_z_h = p.strap_z_w + 2.0 * p.strap_slot_clearance
    strap_rx, _ = strap_inner_radii(p)
    slot_x = strap_rx + p.strap_t / 2.0
    slot_y = strap_forward_y_offset(p) + p.strap_slot_y_len / 2.0 - p.connector_bracing_overlap_y
    for dz in (-p.strap_spacing / 2.0, p.strap_spacing / 2.0):
        z = p.mount_center_z + dz
        for sign in (-1.0, 1.0):
            cutter = box_at(sign * slot_x, slot_y, z, slot_x_w, p.strap_slot_y_len, slot_z_h)
            cutters = cutter if cutters is None else cutters.union(cutter)
    return cutters if cutters is not None else cq.Workplane("XY")


def make_mast(p: Params = P) -> cq.Workplane:
    outer = c_section_profile_solid(p.outer_rx, p.outer_ry, p.mast_length)
    inner = c_section_profile_solid(
        p.outer_rx - p.mast_wall,
        p.outer_ry - p.mast_wall,
        p.mast_length + 2.0,
    ).translate((0, 0, -1.0))
    mast = outer.cut(inner)

    # Cut mouth
    mouth_bottom_y = p.outer_ry - p.rail_chamber_drop_from_top
    mouth_h = p.outer_ry - mouth_bottom_y + 2.0
    mouth = (
        cq.Workplane("XY")
        .rect(p.rail_mouth_w, mouth_h)
        .extrude(p.mast_length + 2.0)
        .translate((0, mouth_bottom_y + mouth_h / 2.0, -1.0))
    )
    mast = mast.cut(mouth)

    # Add rounded lips
    lip_r = p.mast_wall / 2.0
    lip_x = p.rail_mouth_w / 2.0 + lip_r
    lip_y = p.outer_ry - lip_r
    for sign in (-1.0, 1.0):
        lip = (
            cq.Workplane("XY")
            .circle(lip_r)
            .extrude(p.mast_length)
            .translate((sign * lip_x, lip_y, 0))
        )
        mast = mast.union(lip)

    # Add track walls (U-shape)
    y_top = p.outer_ry + 2.0
    y_bot_in = p.outer_ry - p.rail_chamber_drop_from_top - p.rail_chamber_h
    y_bot_out = y_bot_in - p.mast_wall
    x_in = p.rail_chamber_w / 2.0
    x_out = x_in + p.mast_wall
    flange_x = x_out + 2.5

    track_pts = [
        (x_out, y_top),
        (x_out, y_bot_in),
        (flange_x, y_bot_in),
        (flange_x, y_bot_out),
        (-flange_x, y_bot_out),
        (-flange_x, y_bot_in),
        (-x_out, y_bot_in),
        (-x_out, y_top),
        (-x_in, y_top),
        (-x_in, y_bot_in),
        (x_in, y_bot_in),
        (x_in, y_top)
    ]

    track = cq.Workplane("XY").polyline(track_pts).close().extrude(p.mast_length)
    track = _safe_fillet(track, "|Z", 1.0)

    # Union track with mast, then cut inner again to trim track top flush with inner shell
    mast = mast.union(track)
    mast = mast.cut(inner)

    return mast


def make_front_silicone_padding(p: Params = P) -> cq.Workplane:
    pad = ellipse_ring(p.outer_rx, p.outer_ry, p.silicone_gap, p.bracket_z_h, p.mount_center_z)
    return clip_y_band(pad, 0.0, p.outer_ry + p.silicone_gap + 2.0, p.mount_center_z, p.bracket_z_h)


def make_back_silicone_padding(p: Params = P) -> cq.Workplane:
    pads: cq.Workplane | None = None
    for dz in (-p.strap_spacing / 2.0, p.strap_spacing / 2.0):
        z = p.mount_center_z + dz
        pad = ellipse_ring(p.outer_rx, p.outer_ry, p.silicone_gap, p.strap_z_w, z)
        pad = clip_y_band(pad, -(p.outer_ry + p.silicone_gap + 2.0), 0.0, z, p.strap_z_w)
        pads = pad if pads is None else pads.union(pad)
    return pads if pads is not None else cq.Workplane("XY")


def make_elastic_strap_loops(
    p: Params = P,
    radial_clearance: float = 0.0,
    z_clearance: float = 0.0,
) -> cq.Workplane:
    straps: cq.Workplane | None = None
    strap_inner_rx, strap_inner_ry = strap_inner_radii(p)
    strap_inner_rx = max(0.1, strap_inner_rx - radial_clearance)
    strap_inner_ry = max(0.1, strap_inner_ry - radial_clearance)
    strap_t = p.strap_t + 2.0 * radial_clearance
    strap_z_w = p.strap_z_w + 2.0 * z_clearance
    strap_y = strap_forward_y_offset(p)
    for dz in (-p.strap_spacing / 2.0, p.strap_spacing / 2.0):
        z = p.mount_center_z + dz
        strap = ellipse_ring(strap_inner_rx, strap_inner_ry, strap_t, strap_z_w, z)
        strap = strap.translate((0, strap_y, 0))
        straps = strap if straps is None else straps.union(strap)
    return straps if straps is not None else cq.Workplane("XY")


def make_strap_material_cutters(p: Params = P) -> cq.Workplane:
    return make_elastic_strap_loops(p, p.strap_cut_clearance, p.strap_slot_clearance)


def make_front_bracing_shell(p: Params = P) -> cq.Workplane:
    y_min = -p.front_bracing_inner_ry * 0.18
    brace = c_section_ring(
        p.front_bracing_inner_rx,
        p.front_bracing_inner_ry,
        p.front_bracing_side_t,
        p.bracket_z_h,
        p.mount_center_z,
    )
    brace = clip_y_band(
        brace,
        y_min,
        p.front_bracing_inner_ry + p.front_bracing_side_t + 3.0,
        p.mount_center_z,
        p.bracket_z_h,
        x_span=(p.front_bracing_inner_rx + p.front_bracing_side_t + 6.0) * 2.0,
    )
    brace = brace.union(make_front_bracing_tail_extensions(p, y_min))
    brace = brace.cut(make_strap_material_cutters(p))
    brace = _safe_fillet(brace, "|Z", 0.25)
    return brace


def make_front_bracing_tail_extensions(p: Params = P, y_start: float | None = None) -> cq.Workplane:
    y0 = -p.front_bracing_inner_ry * 0.18 if y_start is None else y_start
    tail_drop = p.front_bracing_inner_ry * p.bracing_tail_angle + p.bracing_tail_extension_len
    y1 = max(-p.front_bracing_inner_ry * 0.72, y0 - tail_drop)
    samples = 14
    tails: cq.Workplane | None = None

    for sign in (-1.0, 1.0):
        inner: list[tuple[float, float]] = []
        outer: list[tuple[float, float]] = []
        for i in range(samples + 1):
            t = i / samples
            y = y0 + (y1 - y0) * t
            x_inner = c_section_right_x_at_y(p.front_bracing_inner_rx, p.front_bracing_inner_ry, y)
            thickness = p.front_bracing_side_t + (p.bracing_tail_tip_t - p.front_bracing_side_t) * t
            inner.append((sign * x_inner, y))
            outer.append((sign * (x_inner + thickness), y))

        profile = inner + list(reversed(outer))
        tail = (
            cq.Workplane("XY")
            .polyline(profile)
            .close()
            .extrude(p.bracket_z_h)
            .translate((0, 0, p.mount_center_z - p.bracket_z_h / 2.0))
        )
        tails = tail if tails is None else tails.union(tail)

    return tails if tails is not None else cq.Workplane("XY")


def make_back_elastic_straps(p: Params = P) -> cq.Workplane:
    return make_elastic_strap_loops(p)


def make_velcro_overlap_pads(p: Params = P) -> cq.Workplane:
    pads: cq.Workplane | None = None
    _, strap_inner_ry = strap_inner_radii(p)
    y = strap_forward_y_offset(p) - (strap_inner_ry + p.strap_t + 0.4)
    for dz in (-p.strap_spacing / 2.0, p.strap_spacing / 2.0):
        pad = box_at(0, y, p.mount_center_z + dz, 36.0, 1.4, p.strap_z_w + 1.2)
        pads = pad if pads is None else pads.union(pad)
    return pads if pads is not None else cq.Workplane("XY")


def make_bracing_to_panel_connector_plates(p: Params = P) -> cq.Workplane:
    y0 = -p.connector_bracing_overlap_y
    y1 = p.plate_back_y + p.connector_panel_overlap_y
    depth = y1 - y0
    center_y = (y0 + y1) / 2.0
    x_center = p.front_bracing_inner_rx + p.front_bracing_side_t + p.connector_plate_t / 2.0 - 1.6

    plates: cq.Workplane | None = None
    for sign in (-1.0, 1.0):
        plate = box_at(
            sign * x_center,
            center_y,
            p.mount_center_z,
            p.connector_plate_t,
            depth,
            p.bracket_z_h,
        )
        plates = plate if plates is None else plates.union(plate)

    connector = plates if plates is not None else cq.Workplane("XY")
    connector = connector.cut(make_strap_slot_cutters(p))
    connector = connector.cut(make_strap_material_cutters(p))
    connector = _safe_fillet(connector, "|Z", 0.35)
    return connector


def make_bracing_panel_transition_nodes(p: Params = P) -> cq.Workplane:
    return make_bracing_to_panel_connector_plates(p)


def make_bracing_panel_transition_blocks(p: Params = P) -> cq.Workplane:
    nodes: cq.Workplane | None = None
    x_center = p.front_bracing_inner_rx + p.front_bracing_side_t + p.connector_plate_t / 2.0 - 1.6
    for sign in (-1.0, 1.0):
        bracing_node = box_at(
            sign * x_center,
            p.connector_corner_pad_y / 2.0 - p.connector_bracing_overlap_y,
            p.mount_center_z,
            p.connector_corner_pad_x,
            p.connector_corner_pad_y,
            p.bracket_z_h,
        )
        panel_node = box_at(
            sign * x_center,
            p.plate_back_y - p.connector_corner_pad_y / 2.0 + p.plate_t,
            p.mount_center_z,
            p.connector_corner_pad_x,
            p.connector_corner_pad_y,
            p.bracket_z_h,
        )
        nodes = bracing_node if nodes is None else nodes.union(bracing_node)
        nodes = nodes.union(panel_node)
    result = nodes if nodes is not None else cq.Workplane("XY")
    result = result.cut(make_strap_slot_cutters(p))
    result = result.cut(make_strap_material_cutters(p))
    result = _safe_fillet(result, "|Z", 0.5)
    return result


def make_rail_side_bracing_spine(p: Params = P) -> cq.Workplane:
    return make_bracing_to_panel_connector_plates(p)


def clamp_screw_positions(p: Params = P) -> tuple[tuple[float, float], ...]:
    side_x = p.cover_w / 2.0 - p.clamp_screw_edge_inset
    bottom_z = p.cover_bottom_dz + p.clamp_screw_edge_inset
    long_edge_x = p.cover_w / 6.0
    side_lower_z = p.cover_bottom_dz + p.cover_h / 3.0
    side_upper_z = p.cover_bottom_dz + 2.0 * p.cover_h / 3.0
    return (
        (-long_edge_x, bottom_z),
        (long_edge_x, bottom_z),
        (-side_x, side_lower_z),
        (-side_x, side_upper_z),
        (side_x, side_lower_z),
        (side_x, side_upper_z),
    )


def make_mounting_plate(p: Params = P) -> cq.Workplane:
    plate = rounded_box_xy(p.plate_w, p.plate_h, p.plate_t, 5.0)
    plate = place_xy_solid_as_xz(plate, p.plate_back_y, p.mount_center_z)

    for x, dz in clamp_screw_positions(p):
        cutter = cyl_y(
            x,
            p.plate_back_y - 1.0,
            p.mount_center_z + dz,
            p.panel_screw_clearance_d / 2.0,
            p.plate_t + 2.0,
        )
        plate = plate.cut(cutter)
    return plate


def make_acrylic_cover_plate(
    p: Params = P,
    *,
    include_screen_window: bool = True,
    include_screw_head_recess: bool = True,
) -> cq.Workplane:
    cover = rounded_box_xy(p.cover_w, p.cover_h, p.cover_t, 6.0)
    cover = place_xy_solid_as_xz(cover, p.cover_back_y, p.cover_center_z)

    if include_screen_window:
        window = rounded_box_xy(p.cover_window_w, p.cover_window_h, p.cover_t + 2.0, 5.0)
        window = place_xy_solid_as_xz(
            window,
            p.cover_back_y - 1.0,
            p.mount_center_z + p.cover_window_z_offset,
        )
        cover = cover.cut(window)

    for x, dz in clamp_screw_positions(p):
        through_hole = cyl_y(
            x,
            p.cover_back_y - 1.0,
            p.mount_center_z + dz,
            p.cover_screw_clearance_d / 2.0,
            p.cover_t + 2.0,
        )
        cover = cover.cut(through_hole)
        if include_screw_head_recess:
            head_recess = cyl_y(
                x,
                p.cover_front_y - p.screw_head_recess,
                p.mount_center_z + dz,
                p.screw_head_d / 2.0,
                p.screw_head_recess + 0.8,
            )
            cover = cover.cut(head_recess)

    return cover


def make_acrylic_cover_plate_without_screen_window(p: Params = P) -> cq.Workplane:
    return make_acrylic_cover_plate(
        p,
        include_screen_window=False,
        include_screw_head_recess=False,
    )


def export_acrylic_cover_plate_without_screen_window_top_dxf(p: Params = P) -> None:
    path = OUT_DIR / "fareast28r_clear_acrylic_clamp_cover_plate_no_screen_window_top.dxf"
    doc = ezdxf.new("R2010")
    doc.units = ezdxf.units.MM
    msp = doc.modelspace()
    outline_layer = "CUT_OUTLINE"
    hole_layer = "THROUGH_HOLES"
    doc.layers.add(outline_layer, color=7)
    doc.layers.add(hole_layer, color=1)

    w = p.cover_w
    h = p.cover_h
    r = 6.0
    left = -w / 2.0
    right = w / 2.0
    bottom = -h / 2.0
    top = h / 2.0

    msp.add_line((left + r, bottom), (right - r, bottom), dxfattribs={"layer": outline_layer})
    msp.add_arc((right - r, bottom + r), r, -90, 0, dxfattribs={"layer": outline_layer})
    msp.add_line((right, bottom + r), (right, top - r), dxfattribs={"layer": outline_layer})
    msp.add_arc((right - r, top - r), r, 0, 90, dxfattribs={"layer": outline_layer})
    msp.add_line((right - r, top), (left + r, top), dxfattribs={"layer": outline_layer})
    msp.add_arc((left + r, top - r), r, 90, 180, dxfattribs={"layer": outline_layer})
    msp.add_line((left, top - r), (left, bottom + r), dxfattribs={"layer": outline_layer})
    msp.add_arc((left + r, bottom + r), r, 180, 270, dxfattribs={"layer": outline_layer})

    z_to_local = p.mount_center_z - p.cover_center_z
    for x, dz in clamp_screw_positions(p):
        msp.add_circle(
            (x, dz + z_to_local),
            p.cover_screw_clearance_d / 2.0,
            dxfattribs={"layer": hole_layer},
        )

    doc.saveas(path)


def make_integrated_fixed_panel_bracing(p: Params = P) -> cq.Workplane:
    bracket = make_front_bracing_shell(p)
    bracket = bracket.union(make_rail_side_bracing_spine(p))
    bracket = bracket.union(make_mounting_plate(p))
    return bracket


def make_clamp_screw_references(p: Params = P) -> cq.Workplane:
    screws: cq.Workplane | None = None
    shaft_y = p.plate_back_y - 0.3
    shaft_h = p.cover_front_y - shaft_y + 0.3
    for x, dz in clamp_screw_positions(p):
        z = p.mount_center_z + dz
        shaft = cyl_y(x, shaft_y, z, p.panel_screw_clearance_d / 2.0, shaft_h)
        head = cyl_y(x, p.cover_front_y - 1.0, z, p.screw_head_d / 2.0, 1.4)
        screw = shaft.union(head)
        screws = screw if screws is None else screws.union(screw)
    return screws if screws is not None else cq.Workplane("XY")


def make_device_body(p: Params = P) -> cq.Workplane:
    body = rounded_box_xy(p.device_w, p.device_h, p.device_t, 12.0)
    return place_xy_solid_as_xz(body, p.device_back_y, p.mount_center_z)


def make_device_screen(p: Params = P) -> cq.Workplane:
    screen = rounded_box_xy(88.0, 66.0, 0.8, 3.0)
    return place_xy_solid_as_xz(screen, p.device_front_y + 0.15, p.mount_center_z + 1.0)


def make_device_buttons(p: Params = P) -> cq.Workplane:
    buttons: cq.Workplane | None = None
    z = p.mount_center_z + p.device_h / 2.0 - 14.0
    for x in (-30.0, -10.0, 10.0, 30.0):
        button = cyl_y(x, p.device_front_y + 0.4, z, 3.0, 2.8)
        buttons = button if buttons is None else buttons.union(button)
    return buttons if buttons is not None else cq.Workplane("XY")


def make_device_reference_parts(p: Params = P) -> list[tuple[str, cq.Workplane, tuple[float, float, float, float]]]:
    try:
        device = load_device_enclosure_module()
        parts: list[tuple[str, cq.Workplane, tuple[float, float, float, float]]] = [
            ("sailsiq_real_shell_reference", place_device_reference(device.make_unibody_shell(), p), (0.13, 0.15, 0.16, 0.78)),
            ("sailsiq_real_bonded_panel_reference", place_device_reference(device.make_bonded_face_panel(), p), (0.02, 0.02, 0.025, 0.72)),
            ("sailsiq_lcd_window_reference", place_device_reference(device.make_lcd_clear_window(), p), (0.42, 0.63, 0.70, 0.48)),
            ("sailsiq_display_visual_reference", place_device_reference(device.make_display_visual(), p), (0.88, 0.88, 0.82, 1.0)),
            ("sailsiq_direct_buttons_reference", place_device_reference(device.make_direct_buttons(), p), (0.02, 0.02, 0.02, 1.0)),
        ]
        for idx, text in enumerate(device.make_display_text(), start=1):
            parts.append((f"sailsiq_display_text_reference_{idx}", place_device_reference(text, p), (0.03, 0.03, 0.03, 1.0)))
        if hasattr(device, "make_button_labels"):
            for idx, label in enumerate(device.make_button_labels(), start=1):
                parts.append((f"sailsiq_button_label_reference_{idx}", place_device_reference(label, p), (0.88, 0.88, 0.88, 1.0)))
        return parts
    except Exception:
        return [
            ("sailsiq_device_placeholder", make_device_body(p), (0.13, 0.15, 0.16, 0.82)),
            ("device_screen_reference", make_device_screen(p), (0.42, 0.63, 0.70, 0.62)),
            ("device_button_reference", make_device_buttons(p), (0.02, 0.02, 0.02, 1.0)),
        ]


def make_mount_station_reference(p: Params = P) -> cq.Workplane:
    # Thin red reference tick at the 100 mm-from-top station used by the assembly.
    tick_z = p.mount_center_z
    x = p.outer_rx + 24.0
    ref = box_at(x, 0, p.mast_length - p.mount_from_top / 2.0, 2.0, 2.0, p.mount_from_top)
    ref = ref.union(box_at(x, 0, p.mast_length, 18.0, 2.0, 2.0))
    ref = ref.union(box_at(x, 0, tick_z, 18.0, 2.0, 2.0))
    return ref


def add_part(
    asm: cq.Assembly,
    obj: cq.Workplane,
    name: str,
    color: tuple[float, float, float, float],
) -> None:
    asm.add(obj, name=name, color=cq.Color(*color))


def make_assembly(p: Params = P) -> cq.Assembly:
    asm = cq.Assembly(name="Fareast28R_mast_semi_bracing_mount_assembly")
    add_part(asm, make_mast(p), "fareast28r_mast_700mm_with_guide_rail", (0.58, 0.60, 0.62, 0.50))
    add_part(asm, make_front_silicone_padding(p), "front_5mm_silicone_padding", (0.94, 0.70, 0.33, 0.58))
    add_part(asm, make_integrated_fixed_panel_bracing(p), "integrated_fixed_panel_and_tapered_bracing", (0.05, 0.07, 0.08, 1.0))
    add_part(asm, make_back_elastic_straps(p), "complete_elastic_strap_loops", (0.08, 0.42, 1.0, 0.45))
    add_part(asm, make_velcro_overlap_pads(p), "velcro_overlap_reference_pads", (0.12, 0.12, 0.12, 1.0))
    for name, obj, color in make_device_reference_parts(p):
        add_part(asm, obj, name, color)
    add_part(asm, make_acrylic_cover_plate(p), "clear_acrylic_clamp_cover_plate", (0.55, 0.78, 0.88, 0.38))
    add_part(asm, make_clamp_screw_references(p), "six_m3_clamp_screw_references", (0.72, 0.72, 0.70, 1.0))
    add_part(asm, make_mount_station_reference(p), "mount_station_100mm_from_top_reference", (0.9, 0.05, 0.03, 1.0))
    return asm


def make_j80_bracing_on_current_mast_assembly(p: Params = P) -> cq.Assembly:
    j80 = load_j80_bracing_module()
    jp = j80.P
    asm = cq.Assembly(name="Fareast28R_C139_mast_with_J80_bracing_reference")
    add_part(asm, make_mast(p), "fareast28r_c139_mast_reference", (0.58, 0.60, 0.62, 0.45))
    add_part(asm, j80.make_mast(jp), "j80_original_mast_translucent_reference", (0.92, 0.42, 0.22, 0.18))
    add_part(asm, j80.make_front_silicone_padding(jp), "j80_front_5mm_silicone_padding", (0.94, 0.70, 0.33, 0.52))
    add_part(asm, j80.make_integrated_fixed_panel_bracing(jp), "j80_integrated_fixed_panel_and_tapered_bracing", (0.05, 0.07, 0.08, 1.0))
    add_part(asm, j80.make_back_elastic_straps(jp), "j80_complete_elastic_strap_loops", (0.08, 0.42, 1.0, 0.42))
    add_part(asm, j80.make_velcro_overlap_pads(jp), "j80_velcro_overlap_reference_pads", (0.12, 0.12, 0.12, 1.0))
    for name, obj, color in j80.make_device_reference_parts(jp):
        add_part(asm, obj, f"j80_{name}", color)
    add_part(asm, j80.make_acrylic_cover_plate(jp), "j80_clear_acrylic_clamp_cover_plate", (0.55, 0.78, 0.88, 0.38))
    add_part(asm, j80.make_clamp_screw_references(jp), "j80_six_m3_clamp_screw_references", (0.72, 0.72, 0.70, 1.0))
    add_part(asm, make_mount_station_reference(p), "mount_station_100mm_from_top_reference", (0.9, 0.05, 0.03, 1.0))
    return asm


def export_all(p: Params = P) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stale_transition_nodes = OUT_DIR / "fareast28r_bracing_panel_transition_nodes.step"
    if stale_transition_nodes.exists():
        stale_transition_nodes.unlink()
    stale_tail_extensions = OUT_DIR / "fareast28r_bracing_inner_curved_tapered_tail_extensions.step"
    if stale_tail_extensions.exists():
        stale_tail_extensions.unlink()

    cq.exporters.export(make_mast(p), str(OUT_DIR / "fareast28r_mast_700mm_from_section.step"))
    cq.exporters.export(make_front_bracing_shell(p), str(OUT_DIR / "fareast28r_rail_side_semi_bracing_saddle.step"))
    cq.exporters.export(make_back_elastic_straps(p), str(OUT_DIR / "fareast28r_rear_elastic_strap_bands.step"))
    cq.exporters.export(make_bracing_to_panel_connector_plates(p), str(OUT_DIR / "fareast28r_bracing_to_panel_3mm_connector_plates.step"))
    cq.exporters.export(make_bracing_to_panel_connector_plates(p), str(OUT_DIR / "fareast28r_fixed_panel_to_bracing_transition_web.step"))
    cq.exporters.export(make_mounting_plate(p), str(OUT_DIR / "fareast28r_device_mounting_plate.step"))
    cq.exporters.export(make_acrylic_cover_plate(p), str(OUT_DIR / "fareast28r_clear_acrylic_clamp_cover_plate.step"))
    cq.exporters.export(
        make_acrylic_cover_plate_without_screen_window(p),
        str(OUT_DIR / "fareast28r_clear_acrylic_clamp_cover_plate_no_screen_window.step"),
    )
    export_acrylic_cover_plate_without_screen_window_top_dxf(p)
    cq.exporters.export(make_clamp_screw_references(p), str(OUT_DIR / "fareast28r_six_m3_clamp_screw_references.step"))
    cq.exporters.export(make_integrated_fixed_panel_bracing(p), str(OUT_DIR / "fareast28r_integrated_fixed_panel_and_tapered_bracing.step"))
    make_assembly(p).save(str(OUT_DIR / "fareast28r_mast_700mm_semi_bracing_mount_assembly.step"))
    make_j80_bracing_on_current_mast_assembly(p).save(
        str(OUT_DIR / "fareast28r_c139_mast_with_j80_bracing_reference_assembly.step")
    )


if __name__ == "__main__":
    export_all()
    print(f"Exported Fareast28R C139 mast semi-bracing mount STEP files to: {OUT_DIR}")
