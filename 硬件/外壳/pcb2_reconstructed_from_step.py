from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cadquery as cq


OUT_DIR = Path(__file__).resolve().parent / "cadquery_out"


@dataclass(frozen=True)
class Pcb2Params:
    # Rebuilt from 3D_PCB2_2026-05-12.step exported by EasyEDA Pro.
    # Coordinates follow the STEP file: lower-left of the board is about (0, 0).
    board_w: float = 30.0
    board_h: float = 10.0
    board_t: float = 1.6
    board_x: float = 15.0
    board_y: float = 5.0

    large_hole_d: float = 1.016
    small_hole_d: float = 0.700
    copper_t: float = 0.035

    # Connector J1, CONN-TH_6P-P1.25_ZX-MX1.25-6PWZ-1.
    j1_x: float = 27.577
    j1_y: float = 4.953
    j1_w: float = 4.60
    j1_h: float = 9.41
    j1_body_t: float = 3.25
    j1_below_t: float = 0.60

    # IC packages from STEP product names.
    u2_x: float = 7.0
    u2_y: float = 7.0
    u2_w: float = 3.0
    u2_h: float = 3.0
    u2_t: float = 0.90

    u1_x: float = 15.0
    u1_y: float = 7.0
    u1_w: float = 2.5
    u1_h: float = 3.0
    u1_t: float = 0.87


P = Pcb2Params()

LARGE_HOLES = [
    (2.0, 2.0),
    (2.0, 8.0),
    (7.0, 2.0),
    (24.0, 8.0),
    (24.0, 2.0),
]

J1_PINS = [
    (25.527, 1.828),
    (25.527, 3.078),
    (25.527, 4.328),
    (25.527, 5.578),
    (25.527, 6.828),
    (25.527, 8.078),
]

# Passive bodies inferred from per-solid bounding boxes.
PASSIVES_0603 = [
    ("C1", 13.462, 4.318, 1.6, 0.8, 0.8),
    ("C2", 12.638, 6.793, 0.8, 1.6, 0.8),
    ("C3", 4.064, 6.350, 0.8, 1.6, 0.8),
    ("C4", 9.906, 7.874, 0.8, 1.6, 0.8),
]

RESISTORS = [
    ("R1", 18.034, 7.493, 0.81, 1.60, 0.43),
    ("R2", 19.558, 7.493, 0.81, 1.60, 0.43),
]


def box(w: float, h: float, t: float, x: float, y: float, z: float, r: float = 0.0) -> cq.Workplane:
    obj = cq.Workplane("XY").rect(w, h).extrude(t).translate((x, y, z))
    if r > 0:
        try:
            obj = obj.edges("|Z").fillet(r)
        except Exception:
            pass
    return obj


def cylinder(d: float, t: float, x: float, y: float, z: float) -> cq.Workplane:
    return cq.Workplane("XY").circle(d / 2.0).extrude(t).translate((x, y, z))


def annular_pad(od: float, id_: float, x: float, y: float, z: float, t: float = P.copper_t) -> cq.Workplane:
    return cylinder(od, t, x, y, z).cut(cylinder(id_, t + 0.02, x, y, z - 0.01))


def make_board(p: Pcb2Params = P) -> cq.Workplane:
    board = box(p.board_w, p.board_h, p.board_t, p.board_x, p.board_y, 0.0, 0.4)
    for x, y in LARGE_HOLES:
        board = board.cut(cylinder(p.large_hole_d, p.board_t + 0.4, x, y, -0.2))
    for x, y in J1_PINS:
        board = board.cut(cylinder(p.small_hole_d, p.board_t + 0.4, x, y, -0.2))
    return board


def make_top_copper(p: Pcb2Params = P) -> cq.Workplane:
    copper: cq.Workplane | None = None

    def add(obj: cq.Workplane) -> None:
        nonlocal copper
        copper = obj if copper is None else copper.union(obj)

    for x, y in LARGE_HOLES:
        add(annular_pad(1.8, p.large_hole_d, x, y, p.board_t))
    for x, y in J1_PINS:
        add(annular_pad(1.1, p.small_hole_d, x, y, p.board_t))

    # Approximate SMD pads around U2 from the small copper solids in the STEP.
    u2_pad_z = p.board_t
    for x in (6.25, 6.75, 7.25, 7.75):
        add(box(0.25, 0.325, p.copper_t, x, 5.738, u2_pad_z))
        add(box(0.25, 0.325, p.copper_t, x, 8.263, u2_pad_z))
    for y in (6.25, 6.75, 7.25, 7.75):
        add(box(0.325, 0.25, p.copper_t, 5.738, y, u2_pad_z))
        add(box(0.325, 0.25, p.copper_t, 8.263, y, u2_pad_z))

    for _, x, y, w, h, _ in PASSIVES_0603 + RESISTORS:
        if w > h:
            add(box(0.45, h + 0.25, p.copper_t, x - w / 2.0 + 0.25, y, p.board_t))
            add(box(0.45, h + 0.25, p.copper_t, x + w / 2.0 - 0.25, y, p.board_t))
        else:
            add(box(w + 0.25, 0.45, p.copper_t, x, y - h / 2.0 + 0.25, p.board_t))
            add(box(w + 0.25, 0.45, p.copper_t, x, y + h / 2.0 - 0.25, p.board_t))

    if copper is None:
        return cq.Workplane("XY")
    return copper


def make_j1_connector(p: Pcb2Params = P) -> cq.Workplane:
    body = box(p.j1_w, p.j1_h, p.j1_body_t, p.j1_x, p.j1_y, p.board_t, 0.45)
    shroud = box(3.7, p.j1_h - 1.2, 1.0, p.j1_x + 0.35, p.j1_y, p.board_t + p.j1_body_t - 1.0, 0.35)
    bottom = box(p.j1_w - 0.8, p.j1_h - 1.0, p.j1_below_t, p.j1_x, p.j1_y, -p.j1_below_t, 0.25)

    pins: cq.Workplane | None = None
    for x, y in J1_PINS:
        pin = cylinder(0.42, p.board_t + p.j1_body_t + p.j1_below_t, x, y, -p.j1_below_t)
        pins = pin if pins is None else pins.union(pin)
    return body.union(shroud).union(bottom).union(pins)


def make_u2(p: Pcb2Params = P) -> cq.Workplane:
    body = box(p.u2_w, p.u2_h, p.u2_t, p.u2_x, p.u2_y, p.board_t + 0.02, 0.20)
    pin1 = cylinder(0.18, 0.02, p.u2_x + 1.27, p.u2_y - 1.27, p.board_t + p.u2_t + 0.04)
    return body.union(pin1)


def make_u1(p: Pcb2Params = P) -> cq.Workplane:
    return box(p.u1_w, p.u1_h, p.u1_t, p.u1_x, p.u1_y, p.board_t, 0.18)


def make_passives() -> dict[str, cq.Workplane]:
    parts: dict[str, cq.Workplane] = {}
    for name, x, y, w, h, t in PASSIVES_0603:
        ceramic = box(w, h, t, x, y, P.board_t, 0.10)
        parts[name] = ceramic
    for name, x, y, w, h, t in RESISTORS:
        parts[name] = box(w, h, t, x, y, P.board_t + 0.01, 0.08)
    return parts


def make_assembly() -> cq.Assembly:
    asm = cq.Assembly(name="pcb2_reconstructed_from_step")
    asm.add(make_board(), name="board_30x10x1p6", color=cq.Color(0.62, 0.05, 0.04, 1.0))
    asm.add(make_top_copper(), name="top_copper_pads", color=cq.Color(0.95, 0.62, 0.08, 1.0))
    asm.add(make_j1_connector(), name="J1_6p_th_connector", color=cq.Color(0.04, 0.04, 0.04, 1.0))
    asm.add(make_u2(), name="U2_LGA16_3x3", color=cq.Color(0.02, 0.02, 0.02, 1.0))
    asm.add(make_u1(), name="U1_LGA14_2p5x3", color=cq.Color(0.02, 0.02, 0.02, 1.0))
    for name, obj in make_passives().items():
        asm.add(obj, name=name, color=cq.Color(0.82, 0.72, 0.55, 1.0))
    return asm


def export_all() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    make_assembly().save(str(OUT_DIR / "pcb2_reconstructed_from_step.step"))


if __name__ == "__main__":
    export_all()
    print(f"Exported reconstructed PCB2 STEP to: {OUT_DIR}")
