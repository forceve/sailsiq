from __future__ import annotations

from dataclasses import dataclass
from functools import cache
import math
from pathlib import Path

import cadquery as cq
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_LabelSequence
from OCP.TDocStd import TDocStd_Document
from OCP.XCAFDoc import XCAFDoc_DocumentTool

from cadquery.occ_impl.shapes import Compound, Shape


ROOT = Path(__file__).resolve().parent
BOARD_STEP = ROOT / "esp32_c3_main_board.step"
OUT_DIR = ROOT / "cadquery_out"


@dataclass(frozen=True)
class BBox:
    xmin: float
    xmax: float
    ymin: float
    ymax: float
    zmin: float
    zmax: float

    @property
    def xlen(self) -> float:
        return self.xmax - self.xmin

    @property
    def ylen(self) -> float:
        return self.ymax - self.ymin

    @property
    def zlen(self) -> float:
        return self.zmax - self.zmin

    @property
    def center(self) -> tuple[float, float, float]:
        return (
            (self.xmin + self.xmax) / 2.0,
            (self.ymin + self.ymax) / 2.0,
            (self.zmin + self.zmax) / 2.0,
        )


@dataclass(frozen=True)
class Params:
    # Measured from esp32_c3_main_board.step assembly names.
    board: BBox = BBox(0.0127, 84.9875, 0.0127, 24.9874, 0.0, 1.6001)
    all_parts: BBox = BBox(0.0127, 99.7472, 0.0127, 24.9874, -3.4003, 20.2123)
    battery: BBox = BBox(1.1118, 76.6124, 1.4067, 23.2313, -3.4003, 20.2123)
    usb: BBox = BBox(78.9972, 99.7472, 6.1545, 18.8456, -0.9000, 3.6001)
    sd_slot: BBox = BBox(13.6896, 28.6906, 0.4835, 17.0345, 0.9995, 3.5506)
    pin_headers: tuple[BBox, ...] = (
        BBox(48.7561, 63.7562, 0.5280, 3.0281, -1.4000, 10.2001),  # H1
        BBox(2.0320, 12.2021, 16.9580, 19.6181, -1.4000, 10.1401),  # H3
    )
    pin_header_names: tuple[str, ...] = ("H1", "H3")

    wall: float = 2.2
    side_clearance: float = 1.05
    battery_top_extra_clearance: float = 0.0
    internal_z_offset: float = -1.5
    battery_top_extra_x_margin: float = 1.5
    battery_top_extra_front_sleeve_gap: float = 0.25
    z_clearance: float = 1.35
    back_clearance: float = 5.5
    front_wall: float = 2.6
    corner_r: float = 6.0
    internal_corner_r: float = 3.5

    rail_h: float = 1.0
    rail_w: float = 2.05
    rail_top_gap: float = 0.35
    sd_side_rail_drop: float = 0.5
    rail_front_stop_x: float = 77.5
    lower_rail_keepout_x0: float = 41.8
    lower_rail_keepout_x1: float = 48.6
    usb_exposed_l: float = 12.8

    usb_clearance_y: float = 0.35
    usb_clearance_z: float = 0.35
    usb_lip_depth: float = 0.9
    rear_plate_t: float = 2.2
    rear_plate_corner_r: float = 6.0
    rear_internal_fillet_r: float = 0.65
    rear_tongue_l: float = 7.8
    rear_tongue_margin: float = 0.65
    rear_tongue_frame_t: float = 0.95
    rear_pcb_top_clamp_l: float = 8.2
    rear_pcb_top_clamp_gap: float = 0.08
    rear_pcb_top_clamp_w: float = 1.05
    rear_pcb_top_clamp_h: float = 0.8
    rear_pcb_top_clamp_edge_inset: float = 0.35
    m4_insert_od: float = 5.0
    m4_insert_depth: float = 3.0
    m4_insert_boss_d: float = 8.2
    m4_insert_boss_h: float = 3.4
    m4_insert_bottom_t: float = 0.45
    rear_x_rib_h: float = m4_insert_boss_h
    rear_x_rib_w: float = 1.25
    rear_x_rib_margin_y: float = 4.2
    rear_x_rib_margin_z: float = 4.2
    sd_internal_relief_x_clearance: float = 1.0
    sd_internal_relief_z_clearance: float = 0.8
    sd_internal_relief_outer_skin: float = 1.0
    sd_side: str = "lower"

    usb_cap_flange_t: float = 2.0
    usb_cap_plug_l: float = 5.0
    usb_cap_clearance: float = 0.35
    usb_cap_overlap_l: float = 10.0
    usb_cap_sleeve_t: float = 1.0
    usb_cap_shell_clearance: float = 0.18
    insertion_fit_expand: float = 0.2
    square_outer_profile: bool = True

    short_pin_side: float = 1.15
    short_pin_zmin: float = -1.0
    short_pin_zmax: float = 4.2


P = Params()


def _box(minx: float, maxx: float, miny: float, maxy: float, minz: float, maxz: float) -> cq.Workplane:
    return (
        cq.Workplane("XY")
        .box(maxx - minx, maxy - miny, maxz - minz)
        .translate(((minx + maxx) / 2.0, (miny + maxy) / 2.0, (minz + maxz) / 2.0))
    )


def _rounded_box(
    minx: float,
    maxx: float,
    miny: float,
    maxy: float,
    minz: float,
    maxz: float,
    radius: float,
) -> cq.Workplane:
    obj = _box(minx, maxx, miny, maxy, minz, maxz)
    if radius > 0.05:
        try:
            obj = obj.edges("|X").fillet(min(radius, (maxy - miny) / 3.0, (maxz - minz) / 3.0))
        except Exception:
            pass
    return obj


def _xy_rounded_box(
    minx: float,
    maxx: float,
    miny: float,
    maxy: float,
    minz: float,
    maxz: float,
    radius: float,
) -> cq.Workplane:
    w = maxx - minx
    h = maxy - miny
    t = maxz - minz
    r = max(0.1, min(radius, w / 2.0 - 0.2, h / 2.0 - 0.2))
    obj = (
        cq.Workplane("XY")
        .rect(w, h)
        .extrude(t)
        .translate(((minx + maxx) / 2.0, (miny + maxy) / 2.0, minz))
    )
    try:
        obj = obj.edges("|Z").fillet(r)
    except Exception:
        pass
    return obj


def _cyl_x(x0: float, x1: float, y: float, z: float, r: float) -> cq.Workplane:
    return cq.Workplane("YZ").center(y, z).circle(r).extrude(x1 - x0).translate((x0, 0, 0))


def _iz(z: float, p: Params = P) -> float:
    return z + p.internal_z_offset


def _rib_x(x0: float, x1: float, cy: float, cz: float, length: float, width: float, angle_deg: float) -> cq.Workplane:
    rib = cq.Workplane("YZ").center(cy, cz).rect(length, width).extrude(x1 - x0).translate((x0, 0, 0))
    return rib.rotate((x0, cy, cz), (x1, cy, cz), angle_deg)


def _rounded_frame_x(
    x0: float,
    x1: float,
    y0: float,
    y1: float,
    z0: float,
    z1: float,
    frame_t: float,
    radius: float,
) -> cq.Workplane:
    outer = _rounded_box(x0, x1, y0, y1, z0, z1, radius)
    inner_r = max(0.25, radius - frame_t)
    inner = _rounded_box(x0 - 0.2, x1 + 0.2, y0 + frame_t, y1 - frame_t, z0 + frame_t, z1 - frame_t, inner_r)
    return outer.cut(inner)


def extents(p: Params = P) -> dict[str, float]:
    inner_x_min = p.all_parts.xmin - p.back_clearance
    # The USB-A connector is a male plug. The shell stops near the PCB/front
    # shoulder and the plug protrudes out through the front opening.
    inner_x_max = p.usb.xmax - p.front_wall - p.usb_exposed_l
    inner_y_min = p.board.ymin - p.side_clearance
    inner_y_max = p.all_parts.ymax + p.side_clearance
    base_inner_z_min = p.all_parts.zmin - p.z_clearance
    base_inner_z_max = p.all_parts.zmax + p.z_clearance
    inner_z_min = base_inner_z_min + p.internal_z_offset
    inner_z_max = base_inner_z_max + p.internal_z_offset
    outer_y_min = inner_y_min - p.wall
    outer_y_max = inner_y_max + p.wall
    outer_z_min = inner_z_min - p.wall
    outer_z_max = inner_z_max + p.wall
    if p.square_outer_profile:
        outer_z_max = outer_z_min + (outer_y_max - outer_y_min)
    return {
        "ix0": inner_x_min,
        "ix1": inner_x_max,
        "iy0": inner_y_min,
        "iy1": inner_y_max,
        "iz0": inner_z_min,
        "iz1": inner_z_max,
        "ox0": inner_x_min - p.wall,
        "ox1": inner_x_max + p.front_wall,
        "oy0": outer_y_min,
        "oy1": outer_y_max,
        "oz0": outer_z_min,
        "oz1": outer_z_max,
    }


def _case_outer(p: Params = P) -> cq.Workplane:
    e = extents(p)
    shoulder_x = e["ox1"] - p.usb_cap_overlap_l
    main = _rounded_box(e["ox0"], shoulder_x, e["oy0"], e["oy1"], e["oz0"], e["oz1"], p.corner_r)
    front_recess = _rounded_box(
        shoulder_x,
        e["ox1"],
        e["oy0"] + p.usb_cap_sleeve_t - p.insertion_fit_expand,
        e["oy1"] - p.usb_cap_sleeve_t + p.insertion_fit_expand,
        e["oz0"] + p.usb_cap_sleeve_t - p.insertion_fit_expand,
        e["oz1"] - p.usb_cap_sleeve_t + p.insertion_fit_expand,
        max(0.6, p.corner_r - p.usb_cap_sleeve_t + p.insertion_fit_expand),
    )
    return main.union(front_recess)


def _battery_top_outer_bulge(p: Params = P) -> cq.Workplane:
    e = extents(p)
    sleeve_start_x = e["ox1"] - p.usb_cap_overlap_l
    x0 = max(e["ox0"], p.battery.xmin - p.battery_top_extra_x_margin)
    x1 = min(sleeve_start_x - p.battery_top_extra_front_sleeve_gap, p.battery.xmax + p.battery_top_extra_x_margin)
    # Rounded in plan view so the local battery clearance reads as a smooth
    # rounded-square shoulder instead of a rectangular tab.
    return _xy_rounded_box(
        x0,
        x1,
        e["oy1"] - p.wall,
        e["oy1"] + p.battery_top_extra_clearance,
        e["oz0"],
        e["oz1"],
        min(p.corner_r, 7.0),
    )


def _battery_top_extra_cavity_cut(p: Params = P) -> cq.Workplane:
    e = extents(p)
    sleeve_start_x = e["ox1"] - p.usb_cap_overlap_l
    x0 = max(e["ox0"] - 0.2, p.battery.xmin - p.battery_top_extra_x_margin)
    x1 = min(sleeve_start_x - p.battery_top_extra_front_sleeve_gap, p.battery.xmax + p.battery_top_extra_x_margin)
    return _xy_rounded_box(
        x0,
        x1,
        e["iy1"] + 0.05,
        e["iy1"] + p.battery_top_extra_clearance,
        e["iz0"],
        e["iz1"],
        min(p.internal_corner_r + 1.0, 5.0),
    )


def _main_cavity_cut(p: Params = P) -> cq.Workplane:
    e = extents(p)
    # Starts before the rear end, leaving that end open for slide-in assembly.
    return _rounded_box(
        e["ox0"] - 1.0,
        max(e["ix1"], p.board.xmax + 0.25),
        e["iy0"],
        e["iy1"],
        e["iz0"],
        e["iz1"],
        p.internal_corner_r,
    )


def _usb_aperture_cut(p: Params = P) -> cq.Workplane:
    e = extents(p)
    return _rounded_box(
        e["ix1"] - 0.5,
        e["ox1"] + 1.0,
        p.usb.ymin - p.usb_clearance_y,
        p.usb.ymax + p.usb_clearance_y,
        _iz(p.usb.zmin, p) - p.usb_clearance_z,
        _iz(p.usb.zmax, p) + p.usb_clearance_z,
        0.55,
    )


def _usb_cap_recess_cut(p: Params = P) -> cq.Workplane:
    e = extents(p)
    return _rounded_box(
        e["ox1"] - p.usb_lip_depth,
        e["ox1"] + 0.2,
        p.usb.ymin - p.usb_clearance_y - 1.0,
        p.usb.ymax + p.usb_clearance_y + 1.0,
        _iz(p.usb.zmin, p) - p.usb_clearance_z - 1.0,
        _iz(p.usb.zmax, p) + p.usb_clearance_z + 1.0,
        0.85,
    )


def _sd_internal_blind_relief_cut(p: Params = P) -> cq.Workplane:
    e = extents(p)
    sd_side_rail_top_z = p.board.zmax + p.rail_top_gap - p.sd_side_rail_drop
    if p.sd_side == "lower":
        y0 = e["oy0"] + p.sd_internal_relief_outer_skin
        y1 = p.sd_slot.ymin + 0.2
    else:
        y0 = p.sd_slot.ymax - 0.2
        y1 = e["oy1"] - p.sd_internal_relief_outer_skin
    return _rounded_box(
        e["ox0"] - 1.0,
        p.sd_slot.xmax + p.sd_internal_relief_x_clearance,
        y0,
        y1,
        _iz(sd_side_rail_top_z, p),
        _iz(p.sd_slot.zmax, p) + p.sd_internal_relief_z_clearance,
        0.45,
    )


def _rear_insert_slots_cut(p: Params = P) -> cq.Workplane:
    e = extents(p)
    x0 = e["ox0"] - 0.2
    x1 = e["ox0"] + p.rear_tongue_l + 0.3
    y0 = e["iy0"] + p.rear_tongue_margin
    y1 = e["iy1"] - p.rear_tongue_margin
    z0 = e["iz0"] + p.rear_tongue_margin
    z1 = e["iz1"] - p.rear_tongue_margin
    return _rounded_frame_x(
        x0,
        x1,
        y0,
        y1,
        z0,
        z1,
        p.rear_tongue_frame_t + 0.18,
        max(0.8, p.internal_corner_r - p.rear_tongue_margin),
    )


def _rail_segment(x0: float, x1: float, y0: float, y1: float, z0: float, z1: float) -> cq.Workplane:
    return _box(x0, x1, y0, y1, z0, z1)


def make_shell(p: Params = P) -> cq.Workplane:
    e = extents(p)
    shell = _case_outer(p)
    shell = shell.cut(_main_cavity_cut(p))
    shell = shell.cut(_usb_aperture_cut(p))
    shell = shell.cut(_sd_internal_blind_relief_cut(p))
    shell = shell.cut(_rear_insert_slots_cut(p))

    rail_z0 = _iz(p.board.zmin, p) - p.rail_h
    rail_z1 = _iz(p.board.zmin, p) - 0.08
    side_z0 = _iz(p.board.zmin, p) - 0.4
    side_z1 = _iz(p.board.zmax, p) + p.rail_top_gap
    lower_side_z1 = side_z1 - p.sd_side_rail_drop if p.sd_side == "lower" else side_z1
    upper_side_z1 = side_z1 - p.sd_side_rail_drop if p.sd_side == "upper" else side_z1
    rear_x0 = e["ox0"] + p.rear_tongue_l + 0.8
    front_x1 = p.rail_front_stop_x

    # Bottom ledges carry the PCB edge while the vertical ribs keep the slide centered.
    shell = shell.union(_rail_segment(rear_x0, p.lower_rail_keepout_x0, e["iy0"], p.board.ymin + 0.8, rail_z0, rail_z1))
    shell = shell.union(_rail_segment(p.lower_rail_keepout_x1, front_x1, e["iy0"], p.board.ymin + 0.8, rail_z0, rail_z1))
    shell = shell.union(_rail_segment(rear_x0, 52.0, p.board.ymax - 0.8, e["iy1"], rail_z0, rail_z1))
    shell = shell.union(_rail_segment(73.5, front_x1, p.board.ymax - 0.8, e["iy1"], rail_z0, rail_z1))
    shell = shell.union(_rail_segment(rear_x0, front_x1, e["iy0"], p.board.ymin - 0.18, side_z0, lower_side_z1))
    shell = shell.union(_rail_segment(rear_x0, 52.0, p.board.ymax + 0.18, e["iy1"], side_z0, upper_side_z1))
    shell = shell.union(_rail_segment(73.5, front_x1, p.board.ymax + 0.18, e["iy1"], side_z0, upper_side_z1))

    # Small front stop pads bear on PCB material before the USB connector.
    stop_x0 = p.board.xmax + 0.15
    stop_x1 = min(e["ix1"] - 0.15, stop_x0 + 0.9)
    if stop_x1 > stop_x0:
        shell = shell.union(_box(stop_x0, stop_x1, e["iy0"], p.board.ymin - 0.08, rail_z0, _iz(p.board.zmax, p) + 0.35))
        shell = shell.union(_box(stop_x0, stop_x1, p.board.ymax + 0.08, e["iy1"], rail_z0, _iz(p.board.zmax, p) + 0.35))

    return shell


def make_rear_locking_insert(p: Params = P) -> cq.Workplane:
    e = extents(p)
    x0 = e["ox0"] - p.rear_plate_t
    x1 = e["ox0"]
    plate = _rounded_box(x0, x1, e["oy0"] + 0.15, e["oy1"] - 0.15, e["oz0"] + 0.15, e["oz1"] - 0.15, p.rear_plate_corner_r)

    y0 = e["iy0"] + p.rear_tongue_margin + 0.12 - p.insertion_fit_expand
    y1 = e["iy1"] - p.rear_tongue_margin - 0.12 + p.insertion_fit_expand
    z0 = e["iz0"] + p.rear_tongue_margin + 0.12 - p.insertion_fit_expand
    z1 = e["iz1"] - p.rear_tongue_margin - 0.12 + p.insertion_fit_expand
    tongue_x1 = e["ox0"] + p.rear_tongue_l
    side_lo0 = e["iy0"] + 0.22
    side_lo1 = p.board.ymin - 0.18
    side_hi0 = p.board.ymax + 0.18
    side_hi1 = e["iy1"] - 0.22
    plate = plate.union(
        _rounded_frame_x(
            e["ox0"] - 0.05,
            tongue_x1,
            y0,
            y1,
            z0,
            z1,
            p.rear_tongue_frame_t,
            max(0.8, p.internal_corner_r - p.rear_tongue_margin),
        )
    )
    plate = plate.cut(
        _box(
            e["ox0"] - 0.2,
            tongue_x1 + 0.25,
            p.board.ymin - p.rear_pcb_top_clamp_gap,
            p.board.ymax + p.rear_pcb_top_clamp_gap,
            _iz(p.board.zmin, p) - 0.12,
            _iz(p.board.zmax, p) + 0.12,
        )
    )

    cz = (e["oz0"] + e["oz1"]) / 2.0
    for y in ((side_lo0 + side_lo1) / 2.0, (side_hi0 + side_hi1) / 2.0):
        plate = plate.union(_box(e["ox0"] + 3.5, e["ox0"] + 5.4, y - 0.45, y + 0.45, cz - 3.8, cz + 3.8))

    cy = (e["oy0"] + e["oy1"]) / 2.0
    rib_x0 = e["ox0"]
    rib_x1 = e["ox0"] + p.rear_x_rib_h
    rib_span_y = (e["oy1"] - e["oy0"]) - 2.0 * p.rear_x_rib_margin_y
    rib_span_z = (e["oz1"] - e["oz0"]) - 2.0 * p.rear_x_rib_margin_z
    rib_len = math.hypot(rib_span_y, rib_span_z)
    rib_angle = math.degrees(math.atan2(rib_span_z, rib_span_y))
    plate = plate.union(_rib_x(rib_x0, rib_x1, cy, cz, rib_len, p.rear_x_rib_w, rib_angle))
    plate = plate.union(_rib_x(rib_x0, rib_x1, cy, cz, rib_len, p.rear_x_rib_w, -rib_angle))

    boss_x0 = e["ox0"]
    boss_x1 = e["ox0"] + p.m4_insert_boss_h
    plate = plate.union(_cyl_x(boss_x0, boss_x1, cy, cz, p.m4_insert_boss_d / 2.0))
    outer_face_x = e["ox0"] - p.rear_plate_t
    pocket_x0 = outer_face_x - 0.15
    pocket_x1 = outer_face_x + p.m4_insert_depth
    plate = plate.cut(_cyl_x(pocket_x0, pocket_x1, cy, cz, p.m4_insert_od / 2.0))

    # Two printable top-side PCB clamps. They sit above the PCB top surface,
    # run back to the rear/M4 base, and keep the board from lifting at the
    # tail without occupying the shell side-rail corridors.
    clamp_x0 = e["ox0"]
    clamp_x1 = min(e["ox0"] + p.rear_pcb_top_clamp_l, e["ox0"] + p.rear_tongue_l + 0.6)
    clamp_z0 = _iz(p.board.zmax, p) + p.rear_pcb_top_clamp_gap
    clamp_z1 = clamp_z0 + p.rear_pcb_top_clamp_h
    lower_y0 = p.board.ymin + p.rear_pcb_top_clamp_edge_inset
    lower_y1 = lower_y0 + p.rear_pcb_top_clamp_w
    upper_y1 = p.board.ymax - p.rear_pcb_top_clamp_edge_inset
    upper_y0 = upper_y1 - p.rear_pcb_top_clamp_w
    plate = plate.union(_box(clamp_x0, clamp_x1, lower_y0, lower_y1, clamp_z0, clamp_z1))
    plate = plate.union(_box(clamp_x0, clamp_x1, upper_y0, upper_y1, clamp_z0, clamp_z1))
    try:
        plate = plate.edges("|X").fillet(p.rear_internal_fillet_r)
    except Exception:
        pass
    return plate


def make_usb_dust_cap(p: Params = P) -> cq.Workplane:
    e = extents(p)
    cover_l = max(16.0, p.usb.xmax - e["ox1"] + 4.0)
    cap_x0 = e["ox1"] - p.usb_cap_overlap_l
    cap_x1 = e["ox1"] + cover_l
    cap = _rounded_box(cap_x0, cap_x1, e["oy0"], e["oy1"], e["oz0"], e["oz1"], p.corner_r)

    # Only the rear overlap sleeve is 1 mm thick. The front cap stays solid
    # except for the USB-plug clearance pocket.
    sleeve_wall = p.usb_cap_sleeve_t
    sleeve_x0 = cap_x0 - 0.5
    sleeve_x1 = e["ox1"] + 0.2
    cap = cap.cut(
        _rounded_box(
            sleeve_x0,
            sleeve_x1,
            e["oy0"] + sleeve_wall - p.usb_cap_shell_clearance,
            e["oy1"] - sleeve_wall + p.usb_cap_shell_clearance,
            e["oz0"] + sleeve_wall - p.usb_cap_shell_clearance,
            e["oz1"] - sleeve_wall + p.usb_cap_shell_clearance,
            max(0.6, p.corner_r - sleeve_wall + p.usb_cap_shell_clearance),
        )
    )

    # This inner step clears the shell front face while leaving a thick front
    # cap around the USB plug.
    front_wall = 2.2
    cap = cap.cut(
        _rounded_box(
            e["ox1"] - 0.2,
            cap_x1 - front_wall,
            p.usb.ymin - p.usb_clearance_y - 1.8,
            p.usb.ymax + p.usb_clearance_y + 1.8,
            _iz(p.usb.zmin, p) - p.usb_clearance_z - 1.8,
            _iz(p.usb.zmax, p) + p.usb_clearance_z + 1.8,
            1.1,
        )
    )

    # A slightly enlarged USB pocket keeps the closed nose from touching the
    # metal plug tip even if the cap bottoms out.
    cap = cap.cut(
        _rounded_box(
            cap_x0 - 0.5,
            cap_x1 - 0.9,
            p.usb.ymin - p.usb_clearance_y - 0.6,
            p.usb.ymax + p.usb_clearance_y + 0.6,
            _iz(p.usb.zmin, p) - p.usb_clearance_z - 0.6,
            _iz(p.usb.zmax, p) + p.usb_clearance_z + 0.6,
            0.6,
        )
    )

    return cap


def _pin_center_positions(header: BBox) -> list[tuple[float, float]]:
    pitch = 2.54
    if header.xlen >= header.ylen:
        count = max(1, round(header.xlen / pitch))
        start = (header.xmin + header.xmax) / 2.0 - (count - 1) * pitch / 2.0
        return [
            (start + idx * pitch, (header.ymin + header.ymax) / 2.0)
            for idx in range(count)
        ]
    count = max(1, round(header.ylen / pitch))
    start = (header.ymin + header.ymax) / 2.0 - (count - 1) * pitch / 2.0
    return [
        ((header.xmin + header.xmax) / 2.0, start + idx * pitch)
        for idx in range(count)
    ]


def _square_short_pin(x: float, y: float, p: Params = P) -> cq.Workplane:
    side = p.short_pin_side
    return _box(
        x - side / 2.0,
        x + side / 2.0,
        y - side / 2.0,
        y + side / 2.0,
        p.short_pin_zmin,
        p.short_pin_zmax,
    )


@cache
def make_short_square_pin_board_reference(p: Params = P) -> cq.Workplane:
    doc = TDocStd_Document(TCollection_ExtendedString("esp32_c3"))
    reader = STEPCAFControl_Reader()
    reader.SetNameMode(True)
    reader.SetColorMode(True)
    reader.ReadFile(str(BOARD_STEP))
    reader.Transfer(doc)

    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    shapes: list[Shape] = []

    skip = set(p.pin_header_names)
    roots = TDF_LabelSequence()
    shape_tool.GetFreeShapes(roots)

    def label_name(label) -> str:
        attr = TDataStd_Name()
        if label.FindAttribute(TDataStd_Name.GetID_s(), attr):
            raw = attr.Get().ToExtString()
            if raw.startswith("=>"):
                return ""
            return raw
        return ""

    def add_leaf_shapes(label) -> None:
        comps = TDF_LabelSequence()
        if shape_tool.GetComponents_s(label, comps, False):
            for idx in range(1, comps.Length() + 1):
                add_leaf_shapes(comps.Value(idx))
            return

        name = label_name(label)
        if name in skip:
            return
        shape = shape_tool.GetShape_s(label)
        if not shape.IsNull():
            shapes.append(Shape.cast(shape))

    for idx in range(1, roots.Length() + 1):
        add_leaf_shapes(roots.Value(idx))

    for header in p.pin_headers:
        for x, y in _pin_center_positions(header):
            shapes.append(_square_short_pin(x, y, p).val())
    return cq.Workplane(obj=Compound.makeCompound(shapes)).translate((0, 0, p.internal_z_offset))


def make_board_reference() -> cq.Workplane:
    return make_short_square_pin_board_reference()


def add_part(asm: cq.Assembly, obj: cq.Workplane, name: str, rgba: tuple[float, float, float, float]) -> None:
    asm.add(obj, name=name, color=cq.Color(*rgba))


def make_assembly(exploded: bool = False, include_debug_refs: bool = False, p: Params = P) -> cq.Assembly:
    e = extents(p)
    asm = cq.Assembly(name="esp32_c3_slide_enclosure")
    rear_shift = -16.0 if exploded else 0.0
    cap_shift = 12.0 if exploded else 0.0

    add_part(asm, make_shell(p), "slide_in_shell_with_usb_and_sd_openings", (0.08, 0.09, 0.095, 0.88))
    add_part(asm, make_rear_locking_insert(p).translate((rear_shift, 0, 0)), "rear_locking_insert_plate", (0.02, 0.025, 0.03, 1.0))
    add_part(asm, make_usb_dust_cap(p).translate((cap_shift, 0, 0)), "usb_dust_cap", (0.015, 0.015, 0.018, 1.0))
    add_part(asm, make_board_reference(), "esp32_c3_main_board_reference", (0.12, 0.45, 0.18, 0.55))

    if include_debug_refs:
        # Transparent keepout markers for checking openings in CAD viewers.
        add_part(asm, _usb_aperture_cut(p), "usb_clearance_volume", (0.2, 0.55, 0.9, 0.18))
        add_part(asm, _sd_internal_blind_relief_cut(p), "sd_card_internal_blind_relief_no_external_opening", (0.95, 0.55, 0.08, 0.16))
        add_part(asm, _box(e["ix0"], e["ix1"], e["iy0"], e["iy1"], e["iz0"], e["iz1"]), "internal_cavity_reference", (0.8, 0.8, 0.8, 0.08))
    return asm


def export_all() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cq.exporters.export(make_short_square_pin_board_reference(), str(OUT_DIR / "esp32_c3_main_board_short_square_pins.step"))
    cq.exporters.export(make_shell(), str(OUT_DIR / "esp32_c3_slide_shell.step"))
    cq.exporters.export(make_rear_locking_insert(), str(OUT_DIR / "esp32_c3_rear_locking_insert.step"))
    cq.exporters.export(make_usb_dust_cap(), str(OUT_DIR / "esp32_c3_usb_dust_cap.step"))
    make_assembly(False, include_debug_refs=False).save(str(OUT_DIR / "esp32_c3_enclosure_assembled.step"))
    make_assembly(False, include_debug_refs=False).save(str(OUT_DIR / "esp32_c3_enclosure_fit_assembly.step"))
    make_assembly(False, include_debug_refs=True).save(str(OUT_DIR / "esp32_c3_enclosure_fit_debug_assembly.step"))
    make_assembly(True, include_debug_refs=False).save(str(OUT_DIR / "esp32_c3_enclosure_exploded_assembly.step"))


if __name__ == "__main__":
    export_all()
    print(f"Exported ESP32-C3 slide enclosure STEP files to: {OUT_DIR}")
