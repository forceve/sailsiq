from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import cadquery as cq

from sailsiq_boards_reconstructed import (
    BUTTON_BOARD,
    IMU_BOARD,
    MCU_BOARD,
    POWER_BOARD,
    make_lcd_4p2_reference,
    make_pcb,
)


@dataclass(frozen=True)
class Params:
    # Coordinate system: X = landscape width, Y = height, Z = thickness.
    body_w: float = 140.0
    body_h: float = 106.0
    body_t: float = 22.0
    wall: float = 3.0
    floor: float = 3.0
    corner_r: float = 12.0

    # One-piece shell with a bonded front panel. The panel sits in a shallow
    # top recess; the central service opening is closed only by the bonded panel.
    panel_edge_gap: float = 4.0
    panel_t: float = 1.6
    panel_recess_extra_depth: float = 0.25
    bond_ledge: float = 6.0
    adhesive_t: float = 0.35

    # 4.2 inch mono TFT from 屏幕.PNG.jpg, installed landscape.
    screen_center_y: float = 0.0
    lens_w: float = 88.0
    lens_h: float = 66.0
    visible_w: float = 84.8
    visible_h: float = 63.6
    lcd_module_w: float = 99.7
    lcd_module_h: float = 69.34
    lcd_t: float = 1.96
    lcd_gap_under_panel: float = 0.45

    # Top-edge buttons. The front resin panel remains continuous for reliable
    # bonding; button waterproofing will be redesigned later.
    # Centers are derived from the reconstructed button-board SW1-SW4 bboxes:
    # 4.873, 19.873, 39.873, 54.873 mm on a 60 mm board.
    button_offsets_x: tuple[float, ...] = (-25.127, -10.127, 9.873, 24.873)
    button_hole_d: float = 4.0
    button_boot_h: float = 8.0
    button_skirt_h: float = 1.3
    button_base_d: float = 7.0
    button_post_d: float = 3.0
    button_switch_actuator_d: float = 3.5
    top_button_board_z: float = 11.5
    top_button_board_y: float = 42.5
    button_mount_hole_min_d: float = 2.0
    button_mount_boss_d: float = 6.2
    button_heat_set_insert_pocket_d: float = 3.45
    button_heat_set_insert_depth: float = 3.8
    button_heat_set_insert_d: float = 3.2
    button_heat_set_insert_hole_d: float = 1.65
    button_screw_d: float = 2.0
    button_screw_head_d: float = 4.0
    button_screw_head_h: float = 1.2

    # Internal references inferred from the pictures.
    mcu_x: float = 2.0
    mcu_y: float = 20.0
    mcu_z: float = 5.0
    mcu_w: float = 64.0
    mcu_h: float = 40.0
    power_x: float = -48.0
    power_y: float = 20.0
    power_z: float = 5.0
    imu_x: float = 50.0
    imu_y: float = -4.0
    imu_z: float = 5.2
    battery_w: float = 76.0
    battery_h: float = 40.0
    battery_t: float = 7.0
    battery_x: float = 0.0
    battery_y: float = -29.0
    battery_z: float = 4.2

    post_r: float = 1.65
    snap_r: float = 1.35
    standoff_r: float = 2.5
    standoff_h: float = 5.2


P = Params()
OUT_DIR = Path(__file__).resolve().parent / "cadquery_out"


def _safe_fillet(obj: cq.Workplane, selector: str, radius: float) -> cq.Workplane:
    try:
        return obj.edges(selector).fillet(radius)
    except Exception:
        return obj


def rounded_box(w: float, h: float, t: float, r: float, z: float = 0.0) -> cq.Workplane:
    r = max(0.1, min(r, w / 2.0 - 0.2, h / 2.0 - 0.2))
    obj = cq.Workplane("XY").rect(w, h).extrude(t).edges("|Z").fillet(r)
    obj = _safe_fillet(obj, ">Z", min(0.8, t / 3.0))
    obj = _safe_fillet(obj, "<Z", min(0.5, t / 4.0))
    return obj.translate((0, 0, z))


def rounded_plan_box(w: float, h: float, t: float, r: float, z: float = 0.0) -> cq.Workplane:
    r = max(0.1, min(r, w / 2.0 - 0.2, h / 2.0 - 0.2))
    return cq.Workplane("XY").rect(w, h).extrude(t).edges("|Z").fillet(r).translate((0, 0, z))


def cyl(r: float, h: float, z: float = 0.0) -> cq.Workplane:
    return cq.Workplane("XY").circle(r).extrude(h).translate((0, 0, z))


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


def internal_cavity_size(p: Params = P) -> tuple[float, float]:
    return p.body_w - 2.0 * p.wall, p.body_h - 2.0 * p.wall


def internal_cavity_top_z(p: Params = P) -> float:
    return panel_z(p) - p.wall


def panel_z(p: Params = P) -> float:
    return p.body_t - p.panel_t


def top_of_panel(p: Params = P) -> float:
    return panel_z(p) + p.panel_t


def translate_all(objs: Iterable[cq.Workplane], dz: float) -> list[cq.Workplane]:
    return [obj.translate((0, 0, dz)) for obj in objs]


def button_positions(p: Params = P) -> list[tuple[float, float]]:
    return [(x, p.top_button_board_z) for x in p.button_offsets_x]


def button_mount_positions(p: Params = P) -> list[tuple[float, float, float]]:
    # Use only the two existing large button-board holes as M2 screw mounts.
    return [
        (x - BUTTON_BOARD.width / 2.0, p.top_button_board_z + BUTTON_BOARD.height / 2.0 - y, d)
        for x, y, d in BUTTON_BOARD.holes
        if d >= p.button_mount_hole_min_d
    ]


def button_switch_face_y(p: Params = P) -> float:
    switch_zmax = max(c.zmax for c in BUTTON_BOARD.components if c.name.startswith("SW"))
    return p.top_button_board_y + switch_zmax


def button_shell_inner_y(p: Params = P) -> float:
    return p.body_h / 2.0 - p.wall


def button_board_inner_face_y(p: Params = P) -> float:
    return p.top_button_board_y


def button_board_outer_face_y(p: Params = P) -> float:
    return p.top_button_board_y + BUTTON_BOARD.thickness


def button_exterior_y(p: Params = P) -> float:
    return p.body_h / 2.0


def button_external_projection(p: Params = P) -> float:
    return p.button_boot_h - (button_exterior_y(p) - button_switch_face_y(p))


def place_centered(obj: cq.Workplane, w: float, h: float, x: float, y: float, z: float, angle: float = 0.0) -> cq.Workplane:
    placed = obj.translate((-w / 2.0, -h / 2.0, 0))
    if angle:
        placed = placed.rotate((0, 0, 0), (0, 0, 1), angle)
    return placed.translate((x, y, z))


def place_board(spec, x: float, y: float, z: float, angle: float = 0.0) -> cq.Workplane:
    return place_centered(make_pcb(spec), spec.width, spec.height, x, y, z, angle)


def lcd_z(p: Params = P) -> float:
    return panel_z(p) - p.lcd_gap_under_panel - p.lcd_t


def place_top_button_board(p: Params = P) -> cq.Workplane:
    # Keep the reconstructed switches/connectors in this assembly so the
    # silicone button geometry can be checked against the real component stack.
    board = make_pcb(BUTTON_BOARD).translate((-BUTTON_BOARD.width / 2.0, -BUTTON_BOARD.height / 2.0, 0))
    board = board.rotate((0, 0, 0), (1, 0, 0), -90)
    return board.translate((0, p.top_button_board_y, p.top_button_board_z))


def _button_mount_cylinder(d: float, length: float, y_end: float, x: float, z: float) -> cq.Workplane:
    return cq.Workplane("XZ").center(x, z).circle(d / 2.0).extrude(length).translate((0, y_end, 0))


def make_button_mount_bosses(p: Params = P) -> cq.Workplane | None:
    bosses: cq.Workplane | None = None
    boss_l = button_shell_inner_y(p) - button_board_outer_face_y(p)
    if boss_l <= 0:
        return None
    for x, z, _d in button_mount_positions(p):
        boss = _button_mount_cylinder(p.button_mount_boss_d, boss_l, button_shell_inner_y(p), x, z)
        bosses = boss if bosses is None else bosses.union(boss)
    return bosses


def make_button_heat_set_inserts(p: Params = P) -> cq.Workplane | None:
    inserts: cq.Workplane | None = None
    insert_l = min(p.button_heat_set_insert_depth, button_shell_inner_y(p) - button_board_outer_face_y(p) - 0.4)
    if insert_l <= 0:
        return None
    y_end = button_board_outer_face_y(p) + insert_l
    for x, z, _d in button_mount_positions(p):
        outer = _button_mount_cylinder(p.button_heat_set_insert_d, insert_l, y_end, x, z)
        inner = _button_mount_cylinder(p.button_heat_set_insert_hole_d, insert_l + 0.4, y_end + 0.2, x, z)
        insert = outer.cut(inner)
        inserts = insert if inserts is None else inserts.union(insert)
    return inserts


def make_button_mount_screws(p: Params = P) -> cq.Workplane | None:
    screws: cq.Workplane | None = None
    insert_l = min(p.button_heat_set_insert_depth, button_shell_inner_y(p) - button_board_outer_face_y(p) - 0.4)
    if insert_l <= 0:
        return None
    shaft_start_y = button_board_inner_face_y(p) - p.button_screw_head_h
    shaft_end_y = button_board_outer_face_y(p) + insert_l - 0.35
    shaft_l = shaft_end_y - shaft_start_y
    if shaft_l <= 0:
        return None
    for x, z, _d in button_mount_positions(p):
        shaft = _button_mount_cylinder(p.button_screw_d, shaft_l, shaft_end_y, x, z)
        head = _button_mount_cylinder(p.button_screw_head_d, p.button_screw_head_h, button_board_inner_face_y(p), x, z)
        screw = shaft.union(head)
        screws = screw if screws is None else screws.union(screw)
    return screws


def make_button_mount_hardware_reference(p: Params = P) -> cq.Workplane:
    hardware: cq.Workplane | None = None
    for obj in (make_button_heat_set_inserts(p), make_button_mount_screws(p)):
        if obj is None:
            continue
        hardware = obj if hardware is None else hardware.union(obj)
    return hardware if hardware is not None else cq.Workplane("XY")


def make_unibody_shell(p: Params = P) -> cq.Workplane:
    body = rounded_box(p.body_w, p.body_h, p.body_t, p.corner_r)

    panel_w, panel_h = panel_size(p)
    opening_w, opening_h = service_opening_size(p)

    # Shallow recess locates the bonded panel, but the panel top is flush with
    # the case face so there is no raised perimeter step on the exterior.
    recess_depth = p.panel_t + p.panel_recess_extra_depth
    panel_recess = rounded_box(
        panel_w + 0.7,
        panel_h + 0.7,
        recess_depth + 0.4,
        p.corner_r - p.panel_edge_gap,
        p.body_t - recess_depth,
    )
    body = body.cut(panel_recess)

    # Through service opening for loading LCD, PCB, battery and sensors from the front.
    service_opening = rounded_plan_box(
        opening_w,
        opening_h,
        p.body_t - p.floor + 2.0,
        p.corner_r - p.panel_edge_gap - p.bond_ledge,
        p.floor,
    )
    body = body.cut(service_opening)

    # Hollow the composite body below the bonding shelf. This leaves only the
    # 3 mm shell wall and floor in the deep volume, while the front bonding
    # ledge keeps its full width for a reliable sealed panel joint.
    cavity_w, cavity_h = internal_cavity_size(p)
    cavity_top = internal_cavity_top_z(p)
    internal_cavity = rounded_plan_box(
        cavity_w,
        cavity_h,
        cavity_top - p.floor + 0.2,
        p.corner_r - p.wall,
        p.floor,
    )
    body = body.cut(internal_cavity)

    # Raised inner adhesive dam improves glue-line control and water shedding.
    adhesive_dam = ring(
        opening_w + 3.0,
        opening_h + 3.0,
        opening_w,
        opening_h,
        0.8,
        p.corner_r - p.panel_edge_gap - p.bond_ledge + 1.5,
        p.corner_r - p.panel_edge_gap - p.bond_ledge,
        p.body_t - recess_depth + 0.2,
    )
    body = body.union(adhesive_dam)

    # Top-edge button holes. The bonded front panel has no button openings.
    for x, z in button_positions(p):
        hole = cq.Workplane("XZ").center(x, z).circle(p.button_hole_d / 2.0).extrude(p.wall + 2.0)
        body = body.cut(hole.translate((0, p.body_h / 2.0 + 1.0, 0)))

    # Button-board heat-set nut bosses. The board screws into these blind
    # inserts and clamps the silicone button skirts against the shell wall.
    button_bosses = make_button_mount_bosses(p)
    if button_bosses is not None:
        body = body.union(button_bosses)
        insert_l = min(p.button_heat_set_insert_depth, button_shell_inner_y(p) - button_board_outer_face_y(p) - 0.4)
        if insert_l > 0:
            y_end = button_board_outer_face_y(p) + insert_l + 0.1
            for x, z, _d in button_mount_positions(p):
                pocket = _button_mount_cylinder(p.button_heat_set_insert_pocket_d, insert_l + 0.2, y_end, x, z)
                body = body.cut(pocket)

    # Internal heat-stake posts for MCU board. No through-holes or case screws.
    mcu_standoff_h = max(0.8, p.mcu_z - p.floor)
    for x in (p.mcu_x - p.mcu_w / 2.0 + 4.0, p.mcu_x + p.mcu_w / 2.0 - 4.0):
        for y in (p.mcu_y - p.mcu_h / 2.0 + 4.0, p.mcu_y + p.mcu_h / 2.0 - 4.0):
            body = body.union(cyl(p.standoff_r, mcu_standoff_h, p.floor).translate((x, y, 0)))
            body = body.union(cyl(p.post_r, mcu_standoff_h + 2.6, p.floor).translate((x, y, 0)))

    # IMU/magnetometer board plastic snap posts. Keep this zone metal-free.
    for x, y in ((p.imu_x - 13.0, p.imu_y - 3.0), (p.imu_x + 13.0, p.imu_y - 3.0)):
        body = body.union(cyl(p.snap_r, 5.0, p.floor).translate((x, y, 0)))

    # Battery tray and retention ribs for a flat 1S pouch cell.
    tray = ring(80.0, 48.0, 76.0, 42.0, 1.4, 5.0, 3.5, p.floor)
    body = body.union(tray.translate((p.battery_x, p.battery_y, 0)))
    body = body.union(rounded_box(3.0, 42.0, 5.0, 1.0, p.floor).translate((p.battery_x - 38.5, p.battery_y, 0)))
    body = body.union(rounded_box(3.0, 42.0, 5.0, 1.0, p.floor).translate((p.battery_x + 38.5, p.battery_y, 0)))

    return body


def make_panel_adhesive(p: Params = P) -> cq.Workplane:
    panel_w, panel_h = panel_size(p)
    opening_w, opening_h = service_opening_size(p)
    return ring(
        panel_w - 1.2,
        panel_h - 1.2,
        opening_w + 1.0,
        opening_h + 1.0,
        p.adhesive_t,
        p.corner_r - p.panel_edge_gap - 0.6,
        p.corner_r - p.panel_edge_gap - p.bond_ledge + 0.5,
        panel_z(p) - p.adhesive_t,
    )


def make_bonded_face_panel(p: Params = P) -> cq.Workplane:
    panel_w, panel_h = panel_size(p)
    return rounded_box(panel_w, panel_h, p.panel_t, p.corner_r - p.panel_edge_gap, panel_z(p))


def make_lcd_clear_window(p: Params = P) -> cq.Workplane:
    return rounded_box(p.lens_w, p.lens_h, 0.18, 4.0, top_of_panel(p) + 0.05).translate(
        (0, p.screen_center_y, 0)
    )


def make_display_visual(p: Params = P) -> cq.Workplane:
    return rounded_box(p.visible_w, p.visible_h, 0.28, 2.0, top_of_panel(p) + 0.12).translate(
        (0, p.screen_center_y, 0)
    )


def make_direct_buttons(p: Params = P) -> cq.Workplane:
    buttons: cq.Workplane | None = None
    switch_face_y = button_switch_face_y(p)
    skirt_h = min(p.button_skirt_h, max(0.0, p.button_boot_h))
    for x, z in button_positions(p):
        post = cq.Workplane("XZ").center(x, z).circle(p.button_post_d / 2.0).extrude(p.button_boot_h)
        button = post.translate((0, switch_face_y + p.button_boot_h, 0))
        if skirt_h > 0:
            skirt = cq.Workplane("XZ").center(x, z).circle(p.button_base_d / 2.0).extrude(skirt_h)
            # The sealing flange sits on the inside of the wall. Its outer face
            # is flush with the inner wall so it can be pressed outward.
            button = button.union(skirt.translate((0, switch_face_y + skirt_h, 0)))
        buttons = button if buttons is None else buttons.union(button)
    if buttons is None:
        return cq.Workplane("XY")
    return buttons


def make_button_board_reference(p: Params = P) -> cq.Workplane:
    return place_top_button_board(p)


def make_display_text(p: Params = P) -> list[cq.Workplane]:
    objects: list[cq.Workplane] = []
    try:
        objects.append(cq.Workplane("XY").text("114", 32, 0.45, cut=False).translate((-31.0, p.screen_center_y - 11.0, top_of_panel(p) + 0.42)))
        objects.append(cq.Workplane("XY").text("HDG", 7.5, 0.35, cut=False).translate((-39.0, p.screen_center_y + 24.0, top_of_panel(p) + 0.42)))
        objects.append(cq.Workplane("XY").text("SOG 6.2", 8.5, 0.35, cut=False).translate((-37.0, p.screen_center_y - 29.0, top_of_panel(p) + 0.42)))
    except Exception:
        pass
    return objects


def make_button_labels(p: Params = P) -> list[cq.Workplane]:
    labels = ["PG", "AC", "-", "+"]
    objects: list[cq.Workplane] = []
    for (x, z), label in zip(button_positions(p), labels):
        try:
            text = cq.Workplane("XY").text(label, 4.2, 0.22, cut=False)
            text = text.rotate((0, 0, 0), (1, 0, 0), 75).translate((x - 3.8, p.body_h / 2.0 + 4.2, z - 1.5))
            objects.append(text)
        except Exception:
            pass
    return objects


def make_internal_refs(p: Params = P) -> dict[str, cq.Workplane]:
    refs = {
        "lcd_4p2_real_size_landscape": make_lcd_4p2_reference().translate((0, p.screen_center_y, lcd_z(p))),
        "battery_1s_pouch_ref": rounded_box(p.battery_w, p.battery_h, p.battery_t, 4.0, p.battery_z).translate((p.battery_x, p.battery_y, 0)),
        "mcu_board_reconstructed": place_board(MCU_BOARD, p.mcu_x, p.mcu_y, p.mcu_z),
        "power_board_reconstructed": place_board(POWER_BOARD, p.power_x, p.power_y, p.power_z),
        "imu_board_reconstructed": place_board(IMU_BOARD, p.imu_x, p.imu_y, p.imu_z),
        "button_board_reconstructed_top_edge": make_button_board_reference(p),
        "mag_keepout_r20": cyl(20.0, 9.0, p.floor + 2.0).translate((p.imu_x, p.imu_y, 0)),
    }
    return refs


def add_part(
    asm: cq.Assembly,
    obj: cq.Workplane,
    name: str,
    color: tuple[float, float, float, float],
) -> None:
    asm.add(obj, name=name, color=cq.Color(*color))


def make_assembly(exploded: bool = False, p: Params = P) -> cq.Assembly:
    asm = cq.Assembly(name="SailSIQ_compass_unibody_enclosure")
    lift = 18.0 if exploded else 0.0

    add_part(asm, make_unibody_shell(p), "one_piece_shell", (0.08, 0.09, 0.09, 1.0))
    add_part(asm, make_panel_adhesive(p).translate((0, 0, lift)), "continuous_panel_adhesive_seal", (0.01, 0.01, 0.01, 1.0))
    add_part(asm, make_bonded_face_panel(p).translate((0, 0, lift)), "bonded_front_panel", (0.02, 0.02, 0.025, 0.72))
    add_part(asm, make_lcd_clear_window(p).translate((0, 0, lift)), "clear_lcd_window_area", (0.55, 0.70, 0.78, 0.42))
    add_part(asm, make_display_visual(p).translate((0, 0, lift)), "reflective_lcd_visual", (0.88, 0.88, 0.82, 1.0))
    add_part(asm, make_direct_buttons(p).translate((0, 0, lift)), "direct_protruding_buttons", (0.02, 0.02, 0.02, 1.0))
    button_inserts = make_button_heat_set_inserts(p)
    if button_inserts is not None:
        add_part(asm, button_inserts, "button_board_heat_set_inserts", (0.78, 0.52, 0.16, 1.0))
    button_screws = make_button_mount_screws(p)
    if button_screws is not None:
        add_part(asm, button_screws, "button_board_m2_screws", (0.62, 0.62, 0.58, 1.0))

    for idx, label in enumerate(make_button_labels(p), start=1):
        add_part(asm, label.translate((0, 0, lift)), f"button_label_{idx}", (0.9, 0.9, 0.9, 1.0))

    for idx, text in enumerate(make_display_text(p), start=1):
        add_part(asm, text.translate((0, 0, lift)), f"lcd_text_{idx}", (0.03, 0.03, 0.03, 1.0))

    for name, obj in make_internal_refs(p).items():
        if name == "mag_keepout_r20":
            add_part(asm, obj, name, (0.8, 0.15, 0.10, 0.18))
        elif "battery" in name:
            add_part(asm, obj, name, (0.18, 0.18, 0.20, 0.75))
        elif "lcd" in name:
            add_part(asm, obj, name, (0.10, 0.10, 0.10, 0.55))
        else:
            add_part(asm, obj, name, (0.05, 0.32, 0.12, 0.75))

    return asm


def make_internal_layout_assembly(p: Params = P) -> cq.Assembly:
    asm = cq.Assembly(name="SailSIQ_unibody_internal_layout_reference")
    add_part(asm, make_unibody_shell(p), "one_piece_shell_with_internal_features", (0.08, 0.09, 0.09, 0.45))
    add_part(asm, make_panel_adhesive(p), "continuous_panel_adhesive_seal", (0.01, 0.01, 0.01, 1.0))
    button_inserts = make_button_heat_set_inserts(p)
    if button_inserts is not None:
        add_part(asm, button_inserts, "button_board_heat_set_inserts", (0.78, 0.52, 0.16, 1.0))
    button_screws = make_button_mount_screws(p)
    if button_screws is not None:
        add_part(asm, button_screws, "button_board_m2_screws", (0.62, 0.62, 0.58, 1.0))
    for name, obj in make_internal_refs(p).items():
        if name == "mag_keepout_r20":
            add_part(asm, obj, name, (0.8, 0.15, 0.10, 0.25))
        elif "battery" in name:
            add_part(asm, obj, name, (0.18, 0.18, 0.20, 0.9))
        elif "lcd" in name:
            add_part(asm, obj, name, (0.10, 0.10, 0.10, 0.65))
        else:
            add_part(asm, obj, name, (0.05, 0.32, 0.12, 0.85))
    return asm


def export_all() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    cq.exporters.export(make_unibody_shell(), str(OUT_DIR / "sailsiq_one_piece_shell.step"))
    cq.exporters.export(make_panel_adhesive(), str(OUT_DIR / "sailsiq_continuous_panel_adhesive_seal.step"))
    cq.exporters.export(make_bonded_face_panel(), str(OUT_DIR / "sailsiq_bonded_front_panel.step"))
    cq.exporters.export(make_direct_buttons(), str(OUT_DIR / "sailsiq_direct_protruding_buttons.step"))
    cq.exporters.export(make_direct_buttons(), str(OUT_DIR / "sailsiq_silicone_button_boots.step"))
    cq.exporters.export(make_button_board_reference(), str(OUT_DIR / "sailsiq_button_board_reference.step"))
    cq.exporters.export(make_button_mount_hardware_reference(), str(OUT_DIR / "sailsiq_button_board_mount_hardware.step"))

    make_assembly(exploded=False).save(str(OUT_DIR / "sailsiq_compass_unibody_appearance_assembly.step"))
    make_assembly(exploded=True).save(str(OUT_DIR / "sailsiq_compass_unibody_panel_bonding_scheme.step"))
    make_internal_layout_assembly().save(str(OUT_DIR / "sailsiq_unibody_internal_layout_reference.step"))
    make_assembly(exploded=False).save(str(OUT_DIR / "sailsiq_complete_device_assembly.step"))
    make_internal_layout_assembly().save(str(OUT_DIR / "sailsiq_internal_fit_assembly.step"))


if __name__ == "__main__":
    export_all()
    print(f"Exported SailSIQ one-piece enclosure STEP files to: {OUT_DIR}")
