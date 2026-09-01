from __future__ import annotations

import argparse
from dataclasses import dataclass
from functools import cache
import json
import math
import os
from pathlib import Path
import sys
import time
import types


ROOT = Path(__file__).resolve().parent
BOARD_STEP = ROOT / "esp32_c3_main_board.step"
OUT_DIR = ROOT / "cadquery_out"
EZDXF_CACHE_ROOT = ROOT / ".ezdxf_cache"


def _prepare_ezdxf_font_cache() -> None:
    os.environ.setdefault("XDG_CACHE_HOME", str(EZDXF_CACHE_ROOT))
    cache_file = Path(os.environ["XDG_CACHE_HOME"]).expanduser() / "ezdxf" / "font_manager_cache.json"
    if cache_file.exists():
        return

    font_candidates = [
        Path(os.environ.get("SystemRoot", "C:/Windows")) / "Fonts" / "arial.ttf",
        Path(os.environ.get("SystemRoot", "C:/Windows")) / "Fonts" / "calibri.ttf",
        Path(os.environ.get("SystemRoot", "C:/Windows")) / "Fonts" / "segoeui.ttf",
    ]
    font_entries = [
        [str(path), path.stem, "Regular", 400, 5]
        for path in font_candidates
        if path.exists()
    ]
    if not font_entries:
        font_entries = [["C:/Windows/Fonts/arial.ttf", "Arial", "Regular", 400, 5]]

    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(
        json.dumps({"version": 2, "font-faces": font_entries}, indent=2),
        encoding="utf8",
    )


_prepare_ezdxf_font_cache()


def _install_ezdxf_stub_for_step_export() -> None:
    def unavailable(*_args, **_kwargs):
        raise RuntimeError("DXF import/export is disabled in this STEP export script.")

    ezdxf = types.ModuleType("ezdxf")
    units = types.ModuleType("ezdxf.units")
    zoom = types.ModuleType("ezdxf.zoom")
    entities = types.ModuleType("ezdxf.entities")
    factory = types.ModuleType("ezdxf.entities.factory")

    units.MM = 4
    zoom.extents = unavailable
    factory.new = unavailable
    ezdxf.new = unavailable
    ezdxf.readfile = unavailable
    ezdxf.units = units
    ezdxf.zoom = zoom
    ezdxf.entities = entities
    ezdxf.math = types.SimpleNamespace(BSpline=unavailable)
    entities.factory = factory

    sys.modules.setdefault("ezdxf", ezdxf)
    sys.modules.setdefault("ezdxf.units", units)
    sys.modules.setdefault("ezdxf.zoom", zoom)
    sys.modules.setdefault("ezdxf.entities", entities)
    sys.modules.setdefault("ezdxf.entities.factory", factory)


_install_ezdxf_stub_for_step_export()

import cadquery as cq
from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections
from OCP.Message import Message_ProgressRange
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_LabelSequence
from OCP.TDocStd import TDocStd_Document
from OCP.XCAFDoc import XCAFDoc_DocumentTool

from cadquery.occ_impl.shapes import Compound, Shape


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
    # V3 board: 18650 battery sits entirely above the PCB (z=0.1..23.3),
    # the SD card slot is on the UPPER side, and there are no through-hole
    # pin headers (SW1/SW2 tactile switches replace them).
    board: BBox = BBox(0.0127, 84.9875, 0.0127, 24.9874, 0.0, 1.6001)
    all_parts: BBox = BBox(0.0127, 100.0522, 0.0127, 25.0450, -1.9500, 23.3000)
    battery: BBox = BBox(1.250, 76.750, 2.000, 23.000, 0.100, 23.300)
    usb: BBox = BBox(80.152, 100.052, 6.400, 18.600, -1.600, 4.300)
    sd_slot: BBox = BBox(56.364, 72.914, 10.045, 25.045, 1.000, 3.551)
    pin_headers: tuple[BBox, ...] = ()
    pin_header_names: tuple[str, ...] = ()

    wall: float = 2.2
    side_clearance: float = 2.25
    battery_top_extra_clearance: float = 0.0
    internal_z_offset: float = 0.0
    battery_top_extra_x_margin: float = 1.5
    battery_top_extra_front_sleeve_gap: float = 0.25
    z_clearance: float = 2.35
    back_clearance: float = 5.5
    front_wall: float = 2.6
    corner_r: float = 6.0
    internal_corner_r: float = 3.5

    rail_h: float = 1.0
    rail_w: float = 2.05
    rail_top_gap: float = 0.35
    sd_side_rail_drop: float = 0.5
    rail_front_stop_x: float = 77.5
    # No H1 pin header on the lower side in V3, so the lower rail keepout
    # is effectively disabled: the first segment runs rear→front_stop and
    # the second is a tiny harmless overlap.
    lower_rail_keepout_x0: float = 77.5
    lower_rail_keepout_x1: float = 77.4
    # Upper-side rail gap covers both the battery-holder clips and the SD
    # card slot (now on the upper side in V3) so the card can be inserted.
    upper_rail_gap_x0: float = 52.0
    upper_rail_gap_x1: float = 74.0
    usb_exposed_l: float = 12.8

    usb_clearance_y: float = 0.35
    usb_clearance_z: float = 0.35
    usb_lip_depth: float = 0.9
    rear_plate_t: float = 2.2
    rear_plate_corner_r: float = 6.0
    rear_internal_fillet_r: float = 0.65
    rear_tongue_l: float = 7.8
    rear_tongue_frame_t: float = 1.6
    rear_pcb_top_clamp_l: float = 8.2
    rear_pcb_top_clamp_gap: float = 0.15
    rear_pcb_top_clamp_w: float = 1.05
    rear_pcb_top_clamp_h: float = 0.8
    rear_pcb_top_clamp_edge_inset: float = 0.35
    rear_pcb_top_clamp_anchor_overlap: float = 0.18
    rear_pcb_top_clamp_x_rib_overlap: float = 0.45
    rear_pcb_top_clamp_spur_rear_extra: float = 0.45
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
    sd_side: str = "upper"

    usb_cap_flange_t: float = 2.0
    usb_cap_plug_l: float = 5.0
    usb_cap_clearance: float = 0.35
    usb_cap_overlap_l: float = 10.0
    usb_cap_sleeve_t: float = 1.0
    usb_cap_shell_clearance: float = 0.18
    usb_cap_grip_l: float = 8.5
    usb_cap_grip_t: float = 0.55
    usb_cap_grip_clearance: float = 0.08
    usb_cap_grip_side_w: float = 2.0
    usb_cap_grip_top_w: float = 2.8
    usb_cap_grip_end_gap: float = 0.6
    insertion_fit_expand: float = 0.2
    square_outer_profile: bool = False

    # O-ring fixation for dust cap and rear insert.
    oring_cross_section: float = 1.0
    oring_groove_depth: float = 0.7
    oring_groove_width: float = 1.45
    oring_groove_fillet_r: float = 0.0
    oring_fit_clearance: float = 0.15
    oring_reinforcement_t: float = 0.6
    oring_reinforcement_shoulder_overlap: float = 1.2

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


def _rounded_rect_wire_x(x: float, y0: float, y1: float, z0: float, z1: float, radius: float) -> cq.Wire:
    r = min(radius, (y1 - y0) / 2.0 - 0.01, (z1 - z0) / 2.0 - 0.01)
    s = math.sqrt(0.5)

    def v(y: float, z: float) -> cq.Vector:
        return cq.Vector(x, y, z)

    a = v(y0 + r, z1)
    b = v(y1 - r, z1)
    c = v(y1, z1 - r)
    d = v(y1, z0 + r)
    e = v(y1 - r, z0)
    f = v(y0 + r, z0)
    g = v(y0, z0 + r)
    h = v(y0, z1 - r)
    edges = [
        cq.Edge.makeLine(a, b),
        cq.Edge.makeThreePointArc(b, v(y1 - r + r * s, z1 - r + r * s), c),
        cq.Edge.makeLine(c, d),
        cq.Edge.makeThreePointArc(d, v(y1 - r + r * s, z0 + r - r * s), e),
        cq.Edge.makeLine(e, f),
        cq.Edge.makeThreePointArc(f, v(y0 + r - r * s, z0 + r - r * s), g),
        cq.Edge.makeLine(g, h),
        cq.Edge.makeThreePointArc(h, v(y0 + r - r * s, z1 - r + r * s), a),
    ]
    return cq.Wire.assembleEdges(edges)


def _thru_sections_solid_x(wires: list[cq.Wire]) -> cq.Workplane:
    loft = BRepOffsetAPI_ThruSections(True, False, 1.0e-6)
    loft.CheckCompatibility(True)
    for wire in wires:
        loft.AddWire(wire.wrapped)
    loft.Build(Message_ProgressRange())
    loft.Check()
    return cq.Workplane(obj=Shape.cast(loft.Shape()))


def _oring_rounded_rect_x(
    x: float,
    y0: float,
    y1: float,
    z0: float,
    z1: float,
    radius: float,
    cross_section: float,
) -> cq.Workplane:
    path_wire = _rounded_rect_wire_x(x, y0, y1, z0, z1, radius)
    profile_origin = (x, y0 + radius, z1)
    return (
        cq.Workplane("XZ", origin=profile_origin)
        .circle(cross_section / 2.0)
        .sweep(cq.Workplane(obj=path_wire), isFrenet=True)
    )


def _fillet_oring_groove_edges(obj: cq.Workplane, x0: float, x1: float, radius: float) -> cq.Workplane:
    if radius <= 0.01:
        return obj
    groove_region = cq.selectors.BoxSelector(
        (x0 - 0.05, -1.0e6, -1.0e6),
        (x1 + 0.05, 1.0e6, 1.0e6),
    )
    try:
        obj = obj.edges("|Y").edges(groove_region).fillet(radius)
    except Exception:
        pass
    try:
        obj = obj.edges("|Z").edges(groove_region).fillet(radius)
    except Exception:
        pass
    return obj


def _rear_tongue_outer_r(p: Params = P) -> float:
    return max(0.8, p.internal_corner_r - p.oring_fit_clearance)


def _front_oring_reinforcement(x0: float, x1: float, p: Params = P) -> cq.Workplane:
    e = extents(p)
    shoulder_x = e["ox1"] - p.usb_cap_overlap_l
    slope_x0 = shoulder_x - p.oring_reinforcement_shoulder_overlap
    slope_x1 = e["ox1"]
    t = p.oring_reinforcement_t
    outer = _rounded_box(slope_x0, slope_x1, e["iy0"], e["iy1"], e["iz0"], e["iz1"], p.internal_corner_r)
    inner_start = _rounded_rect_wire_x(
        slope_x0 - 0.2,
        e["iy0"] + 0.02,
        e["iy1"] - 0.02,
        e["iz0"] + 0.02,
        e["iz1"] - 0.02,
        p.internal_corner_r - 0.02,
    )
    inner_end = _rounded_rect_wire_x(
        slope_x1 + 0.2,
        e["iy0"] + t,
        e["iy1"] - t,
        e["iz0"] + t,
        e["iz1"] - t,
        p.internal_corner_r - t,
    )
    reinforcement = outer.cut(_thru_sections_solid_x([inner_start, inner_end]))

    return reinforcement


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
    front_recess_inset = p.usb_cap_sleeve_t - p.usb_cap_shell_clearance + p.oring_fit_clearance
    front_recess = _rounded_box(
        shoulder_x,
        e["ox1"],
        e["oy0"] + front_recess_inset,
        e["oy1"] - front_recess_inset,
        e["oz0"] + front_recess_inset,
        e["oz1"] - front_recess_inset,
        max(0.6, p.corner_r - front_recess_inset),
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


def _rail_segment(x0: float, x1: float, y0: float, y1: float, z0: float, z1: float) -> cq.Workplane:
    return _box(x0, x1, y0, y1, z0, z1)


def make_shell(p: Params = P) -> cq.Workplane:
    e = extents(p)
    shell = _case_outer(p)
    shell = shell.cut(_main_cavity_cut(p))

    # O-ring groove on the shell front recess (dust cap O-ring lives on the shell).
    shoulder_x = e["ox1"] - p.usb_cap_overlap_l
    groove_cx = (shoulder_x + e["ox1"]) / 2.0
    gx0 = groove_cx - p.oring_groove_width / 2.0
    gx1 = groove_cx + p.oring_groove_width / 2.0
    fr_inset = p.usb_cap_sleeve_t - p.usb_cap_shell_clearance + p.oring_fit_clearance
    front_recess_r = max(0.6, p.corner_r - fr_inset)
    shell = shell.union(
        _front_oring_reinforcement(
            gx0,
            gx1,
            p,
        )
    )
    shell = shell.cut(
        _rounded_frame_x(
            gx0, gx1,
            e["oy0"] + fr_inset, e["oy1"] - fr_inset,
            e["oz0"] + fr_inset, e["oz1"] - fr_inset,
            p.oring_groove_depth,
            front_recess_r,
        )
    )
    shell = _fillet_oring_groove_edges(shell, gx0, gx1, p.oring_groove_fillet_r)
    shell = shell.cut(_usb_aperture_cut(p))

    rail_z0 = _iz(p.board.zmin, p) - p.rail_h
    rail_z1 = _iz(p.board.zmin, p) - 0.08
    side_z0 = _iz(p.board.zmin, p) - 0.4
    side_z1 = _iz(p.board.zmax, p) + p.rail_top_gap
    lower_side_z1 = side_z1 - p.sd_side_rail_drop if p.sd_side == "lower" else side_z1
    upper_side_z1 = side_z1 - p.sd_side_rail_drop if p.sd_side == "upper" else side_z1
    rear_x0 = e["ox0"] + p.rear_tongue_l + 0.8
    front_x1 = p.rail_front_stop_x
    gap_x0 = p.upper_rail_gap_x0
    gap_x1 = p.upper_rail_gap_x1

    # Bottom ledges carry the PCB edge while the vertical ribs keep the slide centered.
    shell = shell.union(_rail_segment(rear_x0, front_x1, e["iy0"], p.board.ymin + 0.8, rail_z0, rail_z1))
    shell = shell.union(_rail_segment(rear_x0, front_x1, p.board.ymax - 0.8, e["iy1"], rail_z0, rail_z1))
    shell = shell.union(_rail_segment(rear_x0, front_x1, e["iy0"], p.board.ymin - 0.18, side_z0, lower_side_z1))
    shell = shell.union(_rail_segment(rear_x0, front_x1, p.board.ymax + 0.18, e["iy1"], side_z0, upper_side_z1))

    # Small front stop pads bear on PCB material before the USB connector.
    stop_x0 = p.board.xmax + 0.15
    stop_x1 = min(e["ix1"] - 0.15, stop_x0 + 0.9)
    if stop_x1 > stop_x0:
        shell = shell.union(_box(stop_x0, stop_x1, e["iy0"], p.board.ymin - 0.08, rail_z0, _iz(p.board.zmax, p) + 0.35))
        shell = shell.union(_box(stop_x0, stop_x1, p.board.ymax + 0.08, e["iy1"], rail_z0, _iz(p.board.zmax, p) + 0.35))

    return shell


def make_front_oring(p: Params = P) -> cq.Workplane:
    e = extents(p)
    shoulder_x = e["ox1"] - p.usb_cap_overlap_l
    groove_x = (shoulder_x + e["ox1"]) / 2.0
    fr_inset = p.usb_cap_sleeve_t - p.usb_cap_shell_clearance + p.oring_fit_clearance
    center_inset = p.oring_groove_depth - p.oring_cross_section / 2.0
    return _oring_rounded_rect_x(
        groove_x,
        e["oy0"] + fr_inset + center_inset,
        e["oy1"] - fr_inset - center_inset,
        e["oz0"] + fr_inset + center_inset,
        e["oz1"] - fr_inset - center_inset,
        max(0.6, p.corner_r - fr_inset) - center_inset,
        p.oring_cross_section,
    )


def make_rear_locking_insert(p: Params = P) -> cq.Workplane:
    e = extents(p)
    x0 = e["ox0"] - p.rear_plate_t
    x1 = e["ox0"]
    plate = _rounded_box(x0, x1, e["oy0"] + 0.15, e["oy1"] - 0.15, e["oz0"] + 0.15, e["oz1"] - 0.15, p.rear_plate_corner_r)

    cl = p.oring_fit_clearance
    y0 = e["iy0"] + cl
    y1 = e["iy1"] - cl
    z0 = e["iz0"] + cl
    z1 = e["iz1"] - cl
    tongue_x1 = e["ox0"] + p.rear_tongue_l
    plate = plate.union(
        _rounded_frame_x(
            e["ox0"] - 0.05,
            tongue_x1,
            y0,
            y1,
            z0,
            z1,
            p.rear_tongue_frame_t,
            _rear_tongue_outer_r(p),
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

    # O-ring groove on the tongue outer surface.
    groove_cx = e["ox0"] + p.rear_tongue_l / 2.0
    gx0 = groove_cx - p.oring_groove_width / 2.0
    gx1 = groove_cx + p.oring_groove_width / 2.0
    tongue_r = _rear_tongue_outer_r(p)
    plate = plate.cut(
        _rounded_frame_x(
            gx0, gx1,
            y0, y1,
            z0, z1,
            p.oring_groove_depth,
            tongue_r,
        )
    )
    plate = _fillet_oring_groove_edges(plate, gx0, gx1, p.oring_groove_fillet_r)

    cy = (e["oy0"] + e["oy1"]) / 2.0
    cz = (e["oz0"] + e["oz1"]) / 2.0
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
    tongue_inner_lower_y = y0 + p.rear_tongue_frame_t
    tongue_inner_upper_y = y1 - p.rear_tongue_frame_t
    lower_anchor_y0 = min(lower_y0, tongue_inner_lower_y - p.rear_pcb_top_clamp_anchor_overlap)
    upper_anchor_y1 = max(upper_y1, tongue_inner_upper_y + p.rear_pcb_top_clamp_anchor_overlap)
    plate = plate.union(_box(clamp_x0, clamp_x1, lower_anchor_y0, lower_y1, clamp_z0, clamp_z1))
    plate = plate.union(_box(clamp_x0, clamp_x1, upper_y0, upper_anchor_y1, clamp_z0, clamp_z1))

    x_rib_low_z = cz - rib_span_z / 2.0
    x_rib_high_z = cz + rib_span_z / 2.0
    x_rib_low_y = cy - rib_span_y / 2.0
    x_rib_high_y = cy + rib_span_y / 2.0
    z_ratio = min(1.0, max(0.0, ((clamp_z0 + clamp_z1) / 2.0 - x_rib_low_z) / (x_rib_high_z - x_rib_low_z)))
    lower_x_rib_y = x_rib_low_y + z_ratio * rib_span_y
    upper_x_rib_y = x_rib_high_y - z_ratio * rib_span_y
    spur_x0 = rib_x0
    spur_x1 = min(rib_x1 + p.rear_pcb_top_clamp_spur_rear_extra, p.board.xmin - 0.15, clamp_x1)
    if spur_x1 > spur_x0 + 0.2:
        lower_spur_y0 = lower_y1 - p.rear_pcb_top_clamp_anchor_overlap
        lower_spur_y1 = lower_x_rib_y + p.rear_pcb_top_clamp_x_rib_overlap
        upper_spur_y0 = upper_x_rib_y - p.rear_pcb_top_clamp_x_rib_overlap
        upper_spur_y1 = upper_y0 + p.rear_pcb_top_clamp_anchor_overlap
        if lower_spur_y1 > lower_spur_y0 + 0.2:
            plate = plate.union(_box(spur_x0, spur_x1, lower_spur_y0, lower_spur_y1, clamp_z0, clamp_z1))
        if upper_spur_y1 > upper_spur_y0 + 0.2:
            plate = plate.union(_box(spur_x0, spur_x1, upper_spur_y0, upper_spur_y1, clamp_z0, clamp_z1))
    try:
        plate = plate.edges("|X").fillet(p.rear_internal_fillet_r)
    except Exception:
        pass
    return plate


def make_rear_oring(p: Params = P) -> cq.Workplane:
    e = extents(p)
    cl = p.oring_fit_clearance
    center_inset = p.oring_groove_depth - p.oring_cross_section / 2.0
    return _oring_rounded_rect_x(
        e["ox0"] + p.rear_tongue_l / 2.0,
        e["iy0"] + cl + center_inset,
        e["iy1"] - cl - center_inset,
        e["iz0"] + cl + center_inset,
        e["iz1"] - cl - center_inset,
        _rear_tongue_outer_r(p) - center_inset,
        p.oring_cross_section,
    )


def _usb_cap_grip_fins_parallel(p: Params = P) -> cq.Workplane:
    e = extents(p)
    grip_x0 = e["ox1"] + p.usb_cap_grip_end_gap
    grip_x1 = min(p.usb.xmax - p.usb_cap_grip_end_gap, grip_x0 + p.usb_cap_grip_l)
    c = p.usb_cap_grip_clearance
    t = p.usb_cap_grip_t
    cy = (p.usb.ymin + p.usb.ymax) / 2.0
    cz = (_iz(p.usb.zmin, p) + _iz(p.usb.zmax, p)) / 2.0
    side_y0 = p.usb.ymin - c - t
    side_y1 = p.usb.ymin - c
    side_y2 = p.usb.ymax + c
    side_y3 = p.usb.ymax + c + t
    side_z0 = cz - p.usb_cap_grip_side_w / 2.0
    side_z1 = cz + p.usb_cap_grip_side_w / 2.0
    lower_z0 = _iz(p.usb.zmin, p) - c - t
    lower_z1 = _iz(p.usb.zmin, p) - c
    upper_z0 = _iz(p.usb.zmax, p) + c
    upper_z1 = _iz(p.usb.zmax, p) + c + t
    top_half_gap = 0.7
    lower_y0 = p.usb.ymin + 0.45
    lower_y1 = min(cy - top_half_gap, lower_y0 + p.usb_cap_grip_top_w)
    upper_y1 = p.usb.ymax - 0.45
    upper_y0 = max(cy + top_half_gap, upper_y1 - p.usb_cap_grip_top_w)
    fins = [
        _box(grip_x0, grip_x1, side_y0, side_y1, side_z0, side_z1),
        _box(grip_x0, grip_x1, side_y2, side_y3, side_z0, side_z1),
        _box(grip_x0, grip_x1, lower_y0, lower_y1, lower_z0, lower_z1),
        _box(grip_x0, grip_x1, upper_y0, upper_y1, lower_z0, lower_z1),
        _box(grip_x0, grip_x1, lower_y0, lower_y1, upper_z0, upper_z1),
        _box(grip_x0, grip_x1, upper_y0, upper_y1, upper_z0, upper_z1),
    ]
    obj = fins[0]
    for fin in fins[1:]:
        obj = obj.union(fin)
    try:
        obj = obj.edges("|X").fillet(0.12)
    except Exception:
        pass
    return obj


def _usb_cap_grip_fins_perpendicular(p: Params = P) -> cq.Workplane:
    e = extents(p)
    c = p.usb_cap_grip_clearance
    t = p.usb_cap_grip_t
    fin_x1 = min(p.usb.xmax - p.usb_cap_grip_end_gap, e["ox1"] + p.usb_cap_grip_end_gap + p.usb_cap_grip_l)
    fin_x0 = fin_x1 - t
    cy = (p.usb.ymin + p.usb.ymax) / 2.0
    cz = (_iz(p.usb.zmin, p) + _iz(p.usb.zmax, p)) / 2.0
    side_z0 = cz - p.usb_cap_grip_side_w / 2.0
    side_z1 = cz + p.usb_cap_grip_side_w / 2.0
    lower_z0 = _iz(p.usb.zmin, p) - c - t
    lower_z1 = _iz(p.usb.zmin, p) - c
    upper_z0 = _iz(p.usb.zmax, p) + c
    upper_z1 = _iz(p.usb.zmax, p) + c + t
    top_half_gap = 0.7
    lower_y0 = p.usb.ymin + 0.45
    lower_y1 = min(cy - top_half_gap, lower_y0 + p.usb_cap_grip_top_w)
    upper_y1 = p.usb.ymax - 0.45
    upper_y0 = max(cy + top_half_gap, upper_y1 - p.usb_cap_grip_top_w)
    fins = [
        _box(fin_x0, fin_x1, p.usb.ymin - c - t, p.usb.ymin - c, side_z0, side_z1),
        _box(fin_x0, fin_x1, p.usb.ymax + c, p.usb.ymax + c + t, side_z0, side_z1),
        _box(fin_x0, fin_x1, lower_y0, lower_y1, lower_z0, lower_z1),
        _box(fin_x0, fin_x1, upper_y0, upper_y1, lower_z0, lower_z1),
        _box(fin_x0, fin_x1, lower_y0, lower_y1, upper_z0, upper_z1),
        _box(fin_x0, fin_x1, upper_y0, upper_y1, upper_z0, upper_z1),
    ]
    obj = fins[0]
    for fin in fins[1:]:
        obj = obj.union(fin)
    try:
        obj = obj.edges("|X").fillet(0.12)
    except Exception:
        pass
    return obj


def make_usb_dust_cap(p: Params = P, grip_style: str = "parallel") -> cq.Workplane:
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
    if grip_style == "parallel":
        cap = cap.union(_usb_cap_grip_fins_parallel(p))
    elif grip_style == "perpendicular":
        cap = cap.union(_usb_cap_grip_fins_perpendicular(p))
    elif grip_style != "none":
        raise ValueError(f"unsupported USB cap grip style: {grip_style}")

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
def make_board_reference(p: Params = P) -> cq.Workplane:
    """Load every shape from the board STEP file.

    V3 has no through-hole pin headers (SW1/SW2 tactile switches replace
    them), so nothing is skipped and no simplified short-square pins are
    injected. The STEP geometry is used as-is.
    """
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
    add_part(asm, make_front_oring(p), "front_usb_cap_o_ring_1mm", (0.9, 0.08, 0.04, 1.0))
    add_part(asm, make_rear_oring(p).translate((rear_shift, 0, 0)), "rear_insert_o_ring_1mm", (0.9, 0.08, 0.04, 1.0))
    add_part(asm, make_board_reference(), "esp32_c3_main_board_reference", (0.12, 0.45, 0.18, 0.55))

    if include_debug_refs:
        # Transparent keepout markers for checking openings in CAD viewers.
        add_part(asm, _usb_aperture_cut(p), "usb_clearance_volume", (0.2, 0.55, 0.9, 0.18))
        add_part(asm, _sd_internal_blind_relief_cut(p), "sd_card_internal_blind_relief_no_external_opening", (0.95, 0.55, 0.08, 0.16))
        add_part(asm, _box(e["ix0"], e["ix1"], e["iy0"], e["iy1"], e["iz0"], e["iz1"]), "internal_cavity_reference", (0.8, 0.8, 0.8, 0.08))
    return asm


def _run_export_step(name: str, action) -> None:
    started = time.perf_counter()
    print(f"[export] {name} ...", flush=True)
    action()
    elapsed = time.perf_counter() - started
    print(f"[export] {name} done in {elapsed:.1f}s", flush=True)


def export_printable_parts() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    _run_export_step(
        "slide shell",
        lambda: cq.exporters.export(make_shell(), str(OUT_DIR / "esp32_c3_slide_shell.step")),
    )
    _run_export_step(
        "rear locking insert",
        lambda: cq.exporters.export(
            make_rear_locking_insert(),
            str(OUT_DIR / "esp32_c3_rear_locking_insert.step"),
        ),
    )
    _run_export_step(
        "usb dust cap (default parallel grip fins)",
        lambda: cq.exporters.export(make_usb_dust_cap(), str(OUT_DIR / "esp32_c3_usb_dust_cap.step")),
    )
    _run_export_step(
        "usb dust cap (parallel grip fins)",
        lambda: cq.exporters.export(
            make_usb_dust_cap(grip_style="parallel"),
            str(OUT_DIR / "esp32_c3_usb_dust_cap_parallel_grip.step"),
        ),
    )
    _run_export_step(
        "usb dust cap (perpendicular grip fins)",
        lambda: cq.exporters.export(
            make_usb_dust_cap(grip_style="perpendicular"),
            str(OUT_DIR / "esp32_c3_usb_dust_cap_perpendicular_grip.step"),
        ),
    )
    _run_export_step(
        "usb dust cap (no grip fins)",
        lambda: cq.exporters.export(
            make_usb_dust_cap(grip_style="none"),
            str(OUT_DIR / "esp32_c3_usb_dust_cap_no_grip.step"),
        ),
    )


def export_board_reference() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    _run_export_step(
        "main board reference",
        lambda: cq.exporters.export(
            make_board_reference(),
            str(OUT_DIR / "esp32_c3_main_board_reference.step"),
        ),
    )


def export_assemblies() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    _run_export_step(
        "assembled enclosure",
        lambda: make_assembly(False, include_debug_refs=False).save(
            str(OUT_DIR / "esp32_c3_enclosure_assembled.step")
        ),
    )
    _run_export_step(
        "fit assembly",
        lambda: make_assembly(False, include_debug_refs=False).save(
            str(OUT_DIR / "esp32_c3_enclosure_fit_assembly.step")
        ),
    )
    _run_export_step(
        "fit debug assembly",
        lambda: make_assembly(False, include_debug_refs=True).save(
            str(OUT_DIR / "esp32_c3_enclosure_fit_debug_assembly.step")
        ),
    )
    _run_export_step(
        "exploded assembly",
        lambda: make_assembly(True, include_debug_refs=False).save(
            str(OUT_DIR / "esp32_c3_enclosure_exploded_assembly.step")
        ),
    )


def export_all() -> None:
    export_printable_parts()
    export_board_reference()
    export_assemblies()


def main() -> None:
    parser = argparse.ArgumentParser(description="Export ESP32-C3 slide enclosure STEP files.")
    parser.add_argument(
        "--scope",
        choices=("parts", "board", "assemblies", "all"),
        default="parts",
        help="Export scope. Default exports only the three printable enclosure parts.",
    )
    args = parser.parse_args()

    if args.scope == "parts":
        export_printable_parts()
    elif args.scope == "board":
        export_board_reference()
    elif args.scope == "assemblies":
        export_assemblies()
    else:
        export_all()


if __name__ == "__main__":
    main()
    print(f"Exported ESP32-C3 slide enclosure STEP files to: {OUT_DIR}")
