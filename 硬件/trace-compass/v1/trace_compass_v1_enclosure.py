from __future__ import annotations

from dataclasses import dataclass
from functools import cache
import shutil
import tempfile
from pathlib import Path

import cadquery as cq
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDF import TDF_LabelSequence
from OCP.TDocStd import TDocStd_Document
from OCP.XCAFDoc import XCAFDoc_DocumentTool

from cadquery.occ_impl.shapes import Compound, Shape


ROOT = Path(__file__).resolve().parent
BOARD_STEP = ROOT / "3D_PCB6_2026-08-11.step"
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
    # Measured from 3D_PCB6_2026-08-11.step with empty STEP shapes ignored.
    board: BBox = BBox(-0.037, 90.987, 0.013, 66.987, 0.0, 1.600)
    all_parts: BBox = BBox(-0.037, 90.987, 0.013, 66.987, -1.400, 7.210)
    usb: BBox = BBox(-0.037, 7.543, 46.203, 55.143, 0.700, 4.861)
    sd_card: BBox = BBox(61.140, 77.290, 49.739, 64.939, 1.000, 3.651)
    tft_conn: BBox = BBox(64.200, 67.700, 30.495, 38.505, 1.600, 2.620)

    # Coordinate system: X = landscape width, Y = height, Z = thickness.
    body_w: float = 112.0
    body_h: float = 86.0
    body_t: float = 18.0
    wall: float = 2.8
    floor: float = 2.4
    corner_r: float = 10.0

    panel_edge_gap: float = 3.0
    panel_t: float = 1.6
    panel_recess_extra_depth: float = 0.25
    bond_ledge: float = 5.0
    adhesive_t: float = 0.35

    # Same front vocabulary as the existing compass enclosure: bonded front
    # panel with a visual LCD window, no mechanical button holes in the panel.
    lens_w: float = 88.0
    lens_h: float = 66.0
    visible_w: float = 84.8
    visible_h: float = 63.6
    lcd_module_w: float = 99.7
    lcd_module_h: float = 69.34
    lcd_t: float = 1.96
    lcd_gap_under_panel: float = 0.45

    board_edge_clearance: float = 2.0
    board_bottom_clearance: float = 0.8
    board_support_h: float = 1.25
    board_support_w: float = 3.0
    board_support_l: float = 14.0
    board_retain_rib_h: float = 2.6
    board_retain_rib_w: float = 1.4

    # Top-edge silicone buttons retain the industrial design from 外壳.
    button_offsets_x: tuple[float, ...] = (-25.0, -10.0, 10.0, 25.0)
    button_center_z: float = 9.2
    button_hole_d: float = 4.0
    button_boot_h: float = 7.0
    button_skirt_h: float = 1.2
    button_base_d: float = 7.0
    button_post_d: float = 3.0


P = Params()


def _box(minx: float, maxx: float, miny: float, maxy: float, minz: float, maxz: float) -> cq.Workplane:
    return (
        cq.Workplane("XY")
        .box(maxx - minx, maxy - miny, maxz - minz)
        .translate(((minx + maxx) / 2.0, (miny + maxy) / 2.0, (minz + maxz) / 2.0))
    )


def rounded_box(w: float, h: float, t: float, r: float, z: float = 0.0) -> cq.Workplane:
    r = max(0.1, min(r, w / 2.0 - 0.2, h / 2.0 - 0.2))
    obj = cq.Workplane("XY").rect(w, h).extrude(t).edges("|Z").fillet(r)
    try:
        obj = obj.edges(">Z").fillet(min(0.7, t / 3.0))
    except Exception:
        pass
    try:
        obj = obj.edges("<Z").fillet(min(0.45, t / 4.0))
    except Exception:
        pass
    return obj.translate((0, 0, z))


def rounded_plan_box(w: float, h: float, t: float, r: float, z: float = 0.0) -> cq.Workplane:
    r = max(0.1, min(r, w / 2.0 - 0.2, h / 2.0 - 0.2))
    return cq.Workplane("XY").rect(w, h).extrude(t).edges("|Z").fillet(r).translate((0, 0, z))


def ring(
    outer_w: float,
    outer_h: float,
    inner_w: float,
    inner_h: float,
    t: float,
    outer_r: float,
    inner_r: float,
    z: float = 0.0,
) -> cq.Workplane:
    return rounded_box(outer_w, outer_h, t, outer_r, z).cut(
        rounded_box(inner_w, inner_h, t + 1.0, inner_r, z - 0.5)
    )


def panel_size(p: Params = P) -> tuple[float, float]:
    return p.body_w - 2.0 * p.panel_edge_gap, p.body_h - 2.0 * p.panel_edge_gap


def service_opening_size(p: Params = P) -> tuple[float, float]:
    panel_w, panel_h = panel_size(p)
    return panel_w - 2.0 * p.bond_ledge, panel_h - 2.0 * p.bond_ledge


def panel_z(p: Params = P) -> float:
    return p.body_t - p.panel_t


def top_of_panel(p: Params = P) -> float:
    return panel_z(p) + p.panel_t


def _centered_xy(bb: BBox, p: Params = P) -> BBox:
    cx, cy, _ = p.board.center
    return BBox(bb.xmin - cx, bb.xmax - cx, bb.ymin - cy, bb.ymax - cy, bb.zmin, bb.zmax)


def board_z_offset(p: Params = P) -> float:
    return p.floor + p.board_bottom_clearance - p.all_parts.zmin


def lcd_z(p: Params = P) -> float:
    return panel_z(p) - p.lcd_gap_under_panel - p.lcd_t


def make_unibody_shell(p: Params = P) -> cq.Workplane:
    body = rounded_box(p.body_w, p.body_h, p.body_t, p.corner_r)
    panel_w, panel_h = panel_size(p)
    opening_w, opening_h = service_opening_size(p)
    recess_depth = p.panel_t + p.panel_recess_extra_depth

    body = body.cut(
        rounded_box(
            panel_w + 0.6,
            panel_h + 0.6,
            recess_depth + 0.4,
            p.corner_r - p.panel_edge_gap,
            p.body_t - recess_depth,
        )
    )
    body = body.cut(
        rounded_plan_box(
            opening_w,
            opening_h,
            p.body_t - p.floor + 1.0,
            p.corner_r - p.panel_edge_gap - p.bond_ledge,
            p.floor,
        )
    )
    body = body.union(
        ring(
            opening_w + 2.6,
            opening_h + 2.6,
            opening_w,
            opening_h,
            0.75,
            p.corner_r - p.panel_edge_gap - p.bond_ledge + 1.3,
            p.corner_r - p.panel_edge_gap - p.bond_ledge,
            p.body_t - recess_depth + 0.15,
        )
    )

    body = body.union(make_board_supports(p))

    for x in p.button_offsets_x:
        hole = cq.Workplane("XZ").center(x, p.button_center_z).circle(p.button_hole_d / 2.0).extrude(p.wall + 2.0)
        body = body.cut(hole.translate((0, p.body_h / 2.0 + 1.0, 0)))

    return body


def make_board_supports(p: Params = P) -> cq.Workplane:
    board = _centered_xy(p.board, p)
    z0 = p.floor
    z1 = p.floor + p.board_support_h
    y0 = board.ymin - p.board_edge_clearance
    y1 = board.ymax + p.board_edge_clearance
    x0 = board.xmin + 6.0
    x1 = board.xmax - 6.0

    supports = [
        _box(x0, x0 + p.board_support_l, y0, y0 + p.board_support_w, z0, z1),
        _box(x1 - p.board_support_l, x1, y0, y0 + p.board_support_w, z0, z1),
        _box(x0, x0 + p.board_support_l, y1 - p.board_support_w, y1, z0, z1),
        _box(x1 - p.board_support_l, x1, y1 - p.board_support_w, y1, z0, z1),
    ]

    board_z0 = p.board.zmin + board_z_offset(p)
    rib_z1 = board_z0 + p.board_retain_rib_h
    supports.extend(
        [
            _box(x0 + 20.0, x0 + 38.0, y0, y0 + p.board_retain_rib_w, z1, rib_z1),
            _box(x1 - 38.0, x1 - 20.0, y0, y0 + p.board_retain_rib_w, z1, rib_z1),
            _box(x0 + 20.0, x0 + 38.0, y1 - p.board_retain_rib_w, y1, z1, rib_z1),
            _box(x1 - 38.0, x1 - 20.0, y1 - p.board_retain_rib_w, y1, z1, rib_z1),
        ]
    )

    obj = supports[0]
    for support in supports[1:]:
        obj = obj.union(support)
    try:
        obj = obj.edges("|Z").fillet(0.45)
    except Exception:
        pass
    return obj


def make_panel_adhesive(p: Params = P) -> cq.Workplane:
    panel_w, panel_h = panel_size(p)
    opening_w, opening_h = service_opening_size(p)
    return ring(
        panel_w - 1.1,
        panel_h - 1.1,
        opening_w + 1.0,
        opening_h + 1.0,
        p.adhesive_t,
        p.corner_r - p.panel_edge_gap - 0.5,
        p.corner_r - p.panel_edge_gap - p.bond_ledge + 0.5,
        panel_z(p) - p.adhesive_t,
    )


def make_bonded_face_panel(p: Params = P) -> cq.Workplane:
    panel_w, panel_h = panel_size(p)
    return rounded_box(panel_w, panel_h, p.panel_t, p.corner_r - p.panel_edge_gap, panel_z(p))


def make_lcd_module_reference(p: Params = P) -> cq.Workplane:
    return rounded_box(p.lcd_module_w, p.lcd_module_h, p.lcd_t, 2.5, lcd_z(p))


def make_lcd_clear_window(p: Params = P) -> cq.Workplane:
    return rounded_box(p.lens_w, p.lens_h, 0.18, 4.0, top_of_panel(p) + 0.05)


def make_display_visual(p: Params = P) -> cq.Workplane:
    return rounded_box(p.visible_w, p.visible_h, 0.24, 2.0, top_of_panel(p) + 0.12)


def make_silicone_buttons(p: Params = P) -> cq.Workplane:
    buttons: cq.Workplane | None = None
    inner_y = p.body_h / 2.0 - p.wall
    for x in p.button_offsets_x:
        post = cq.Workplane("XZ").center(x, p.button_center_z).circle(p.button_post_d / 2.0).extrude(p.button_boot_h)
        button = post.translate((0, inner_y + p.button_boot_h, 0))
        skirt = cq.Workplane("XZ").center(x, p.button_center_z).circle(p.button_base_d / 2.0).extrude(p.button_skirt_h)
        button = button.union(skirt.translate((0, inner_y + p.button_skirt_h, 0)))
        buttons = button if buttons is None else buttons.union(button)
    return buttons if buttons is not None else cq.Workplane("XY")


@cache
def make_board_reference(p: Params = P) -> cq.Workplane:
    # OCC's STEP reader is unreliable with non-ASCII paths on some Windows
    # installs, so read through an ASCII temp path while keeping the source
    # STEP in this directory.
    with tempfile.TemporaryDirectory(prefix="trace_compass_v1_") as tmp:
        ascii_step = Path(tmp) / "pcb6.step"
        shutil.copy2(BOARD_STEP, ascii_step)

        doc = TDocStd_Document(TCollection_ExtendedString("trace_compass_v1"))
        reader = STEPCAFControl_Reader()
        reader.SetNameMode(True)
        reader.SetColorMode(True)
        reader.ReadFile(str(ascii_step))
        reader.Transfer(doc)

        shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
        roots = TDF_LabelSequence()
        shape_tool.GetFreeShapes(roots)
        shapes: list[Shape] = []

        def add_leaf_shapes(label) -> None:
            comps = TDF_LabelSequence()
            if shape_tool.GetComponents_s(label, comps, False):
                for idx in range(1, comps.Length() + 1):
                    add_leaf_shapes(comps.Value(idx))
                return

            shape = shape_tool.GetShape_s(label)
            if shape.IsNull():
                return
            try:
                wrapped = Shape.cast(shape)
                wrapped.BoundingBox()
            except Exception:
                return
            shapes.append(wrapped)

        for idx in range(1, roots.Length() + 1):
            add_leaf_shapes(roots.Value(idx))

    cx, cy, _ = p.board.center
    return cq.Workplane(obj=Compound.makeCompound(shapes)).translate((-cx, -cy, board_z_offset(p)))


def make_sd_card_keepout(p: Params = P) -> cq.Workplane:
    sd = _centered_xy(p.sd_card, p)
    zoff = board_z_offset(p)
    return _box(sd.xmin - 1.0, sd.xmax + 2.0, sd.ymin - 0.8, sd.ymax + 2.0, sd.zmin + zoff, sd.zmax + zoff + 1.0)


def add_part(asm: cq.Assembly, obj: cq.Workplane, name: str, rgba: tuple[float, float, float, float]) -> None:
    asm.add(obj, name=name, color=cq.Color(*rgba))


def make_assembly(exploded: bool = False, include_debug_refs: bool = False, p: Params = P) -> cq.Assembly:
    asm = cq.Assembly(name="trace_compass_v1_enclosure")
    front_lift = 14.0 if exploded else 0.0

    add_part(asm, make_unibody_shell(p), "sealed_one_piece_shell", (0.08, 0.09, 0.095, 0.92))
    add_part(asm, make_panel_adhesive(p).translate((0, 0, front_lift)), "continuous_panel_adhesive_seal", (0.01, 0.01, 0.01, 1.0))
    add_part(asm, make_bonded_face_panel(p).translate((0, 0, front_lift)), "bonded_front_panel", (0.02, 0.02, 0.025, 0.72))
    add_part(asm, make_lcd_clear_window(p).translate((0, 0, front_lift)), "clear_lcd_window_area", (0.55, 0.70, 0.78, 0.42))
    add_part(asm, make_display_visual(p).translate((0, 0, front_lift)), "reflective_lcd_visual", (0.88, 0.88, 0.82, 1.0))
    add_part(asm, make_lcd_module_reference(p), "lcd_4p2_reference", (0.10, 0.10, 0.10, 0.40))
    add_part(asm, make_silicone_buttons(p).translate((0, 0, front_lift)), "top_edge_silicone_buttons", (0.015, 0.015, 0.018, 1.0))
    add_part(asm, make_board_reference(p), "trace_compass_v1_pcb_reference", (0.10, 0.38, 0.14, 0.62))

    if include_debug_refs:
        add_part(asm, make_sd_card_keepout(p), "sd_card_internal_keepout", (0.95, 0.55, 0.08, 0.18))
    return asm


def export_all() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cq.exporters.export(make_unibody_shell(), str(OUT_DIR / "trace_compass_v1_one_piece_shell.step"))
    cq.exporters.export(make_panel_adhesive(), str(OUT_DIR / "trace_compass_v1_continuous_panel_adhesive_seal.step"))
    cq.exporters.export(make_bonded_face_panel(), str(OUT_DIR / "trace_compass_v1_bonded_front_panel.step"))
    cq.exporters.export(make_silicone_buttons(), str(OUT_DIR / "trace_compass_v1_top_edge_silicone_buttons.step"))
    cq.exporters.export(make_board_reference(), str(OUT_DIR / "trace_compass_v1_pcb_reference.step"))
    make_assembly(False, include_debug_refs=False).save(str(OUT_DIR / "trace_compass_v1_complete_device_assembly.step"))
    make_assembly(False, include_debug_refs=True).save(str(OUT_DIR / "trace_compass_v1_internal_fit_assembly.step"))
    make_assembly(True, include_debug_refs=False).save(str(OUT_DIR / "trace_compass_v1_panel_bonding_scheme.step"))


if __name__ == "__main__":
    export_all()
    print(f"Exported Trace Compass v1 enclosure STEP files to: {OUT_DIR}")
