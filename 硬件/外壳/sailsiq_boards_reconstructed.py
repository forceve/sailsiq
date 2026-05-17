from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cadquery as cq


OUT_DIR = Path(__file__).resolve().parent / "cadquery_out"


@dataclass(frozen=True)
class ComponentBox:
    name: str
    xmin: float
    ymin: float
    zmin: float
    xmax: float
    ymax: float
    zmax: float
    kind: str = "component"


@dataclass(frozen=True)
class BoardSpec:
    name: str
    width: float
    height: float
    thickness: float
    holes: tuple[tuple[float, float, float], ...]
    components: tuple[ComponentBox, ...]


def _box_at_bbox(c: ComponentBox, radius: float = 0.08) -> cq.Workplane:
    w = c.xmax - c.xmin
    h = c.ymax - c.ymin
    t = c.zmax - c.zmin
    x = (c.xmin + c.xmax) / 2.0
    y = (c.ymin + c.ymax) / 2.0
    obj = cq.Workplane("XY").rect(w, h).extrude(t).translate((x, y, c.zmin))
    if radius > 0 and min(w, h) > radius * 3:
        try:
            obj = obj.edges("|Z").fillet(radius)
        except Exception:
            pass
    return obj


def _hole(d: float, t: float, x: float, y: float, z: float = -0.2) -> cq.Workplane:
    return cq.Workplane("XY").circle(d / 2.0).extrude(t).translate((x, y, z))


def make_board(spec: BoardSpec) -> cq.Workplane:
    board = (
        cq.Workplane("XY")
        .rect(spec.width, spec.height)
        .extrude(spec.thickness)
        .translate((spec.width / 2.0, spec.height / 2.0, 0))
    )
    try:
        board = board.edges("|Z").fillet(0.35)
    except Exception:
        pass
    for x, y, d in spec.holes:
        board = board.cut(_hole(d, spec.thickness + 0.4, x, y))
    return board


def make_components(spec: BoardSpec) -> cq.Workplane:
    comp: cq.Workplane | None = None
    for c in spec.components:
        radius = 0.25 if c.kind in {"connector", "switch", "module"} else 0.08
        obj = _box_at_bbox(c, radius)
        comp = obj if comp is None else comp.union(obj)
    return comp if comp is not None else cq.Workplane("XY")


def make_pcb(spec: BoardSpec, include_components: bool = True) -> cq.Workplane:
    pcb = make_board(spec)
    if include_components:
        pcb = pcb.union(make_components(spec))
    return pcb


def _color_for(kind: str) -> cq.Color:
    if kind == "board":
        return cq.Color(0.60, 0.04, 0.04, 1.0)
    if kind in {"connector", "switch"}:
        return cq.Color(0.03, 0.03, 0.03, 1.0)
    if kind == "module":
        return cq.Color(0.10, 0.12, 0.13, 1.0)
    if kind == "ic":
        return cq.Color(0.02, 0.02, 0.025, 1.0)
    if kind == "passive":
        return cq.Color(0.78, 0.70, 0.55, 1.0)
    return cq.Color(0.18, 0.18, 0.18, 1.0)


def make_pcb_assembly(spec: BoardSpec) -> cq.Assembly:
    asm = cq.Assembly(name=spec.name)
    asm.add(make_board(spec), name=f"{spec.name}_board", color=_color_for("board"))
    for c in spec.components:
        asm.add(_box_at_bbox(c, 0.25 if c.kind in {"connector", "switch", "module"} else 0.08), name=c.name, color=_color_for(c.kind))
    return asm


POWER_BOARD = BoardSpec(
    name="power_board",
    width=30.0,
    height=30.0,
    thickness=1.6,
    holes=(
        (2.0, 8.0, 1.016), (2.082, 25.146, 0.7), (3.332, 25.146, 0.7),
        (4.582, 25.146, 0.7), (5.832, 25.146, 0.7), (6.6, 3.0, 0.914),
        (6.6, 5.0, 0.914), (7.082, 25.146, 0.7), (8.332, 25.146, 0.7),
        (12.0, 28.0, 1.016), (23.4, 3.0, 0.914), (23.4, 5.0, 0.914),
        (28.0, 8.0, 1.016), (28.0, 28.0, 1.016),
    ),
    components=(
        ComponentBox("J1_2p_conn", 0.298, 0.950, -1.900, 6.848, 7.050, 6.200, "connector"),
        ComponentBox("J3_2p_conn", 23.152, 0.950, -1.900, 29.702, 7.050, 6.200, "connector"),
        ComponentBox("J2_6p_conn", 0.502, 24.896, -0.600, 9.912, 29.496, 4.850, "connector"),
        ComponentBox("U1_smb", 8.131, 0.779, 1.600, 11.681, 6.079, 3.900, "ic"),
        ComponentBox("U2_wqfn24", 12.711, 6.422, 1.600, 16.731, 10.442, 2.410, "ic"),
        ComponentBox("U3_tps63070", 16.310, 22.004, 1.620, 19.310, 24.504, 2.500, "ic"),
        ComponentBox("C0805_1", 25.161, 18.525, 1.600, 26.461, 20.525, 2.900, "passive"),
        ComponentBox("C0805_2", 12.153, 18.748, 1.600, 13.453, 20.748, 2.900, "passive"),
        ComponentBox("C0805_3", 10.006, 18.748, 1.600, 11.306, 20.748, 2.900, "passive"),
        ComponentBox("C0805_4", 7.890, 7.478, 1.600, 9.890, 8.778, 2.900, "passive"),
        ComponentBox("C0805_5", 7.859, 18.748, 1.600, 9.159, 20.748, 2.900, "passive"),
        ComponentBox("C0805_6", 23.007, 18.525, 1.600, 24.307, 20.525, 2.900, "passive"),
        ComponentBox("C0603_1", 10.503, 11.538, 1.600, 12.103, 12.338, 2.400, "passive"),
        ComponentBox("C0603_2", 14.440, 11.919, 1.600, 16.040, 12.719, 2.400, "passive"),
        ComponentBox("C0603_3", 16.091, 1.632, 1.600, 17.691, 2.432, 2.400, "passive"),
        ComponentBox("C0603_4", 19.520, 20.174, 1.600, 21.120, 20.974, 2.400, "passive"),
        ComponentBox("C0603_5", 17.488, 25.762, 1.600, 19.088, 26.562, 2.400, "passive"),
        ComponentBox("C0603_6", 24.728, 7.945, 1.600, 25.528, 9.545, 2.400, "passive"),
        ComponentBox("C0603_7", 14.724, 20.174, 1.600, 16.324, 20.974, 2.400, "passive"),
        ComponentBox("C0603_8", 22.986, 7.945, 1.600, 23.786, 9.545, 2.400, "passive"),
        ComponentBox("C0603_9", 20.174, 3.391, 1.600, 20.974, 4.991, 2.400, "passive"),
        ComponentBox("R0603_1", 20.363, 23.359, 1.610, 21.173, 24.959, 2.040, "passive"),
        ComponentBox("R0603_2", 3.041, 21.425, 1.610, 3.851, 23.025, 2.040, "passive"),
        ComponentBox("R0603_3", 1.500, 21.425, 1.610, 2.310, 23.025, 2.040, "passive"),
        ComponentBox("R0603_4", 13.454, 23.795, 1.610, 15.054, 24.605, 2.040, "passive"),
        ComponentBox("R0603_5", 13.454, 25.397, 1.610, 15.054, 26.207, 2.040, "passive"),
        ComponentBox("R0603_6", 14.200, 3.391, 1.610, 15.010, 4.991, 2.040, "passive"),
        ComponentBox("R0603_7", 15.724, 3.391, 1.610, 16.534, 4.991, 2.040, "passive"),
        ComponentBox("R0603_8", 17.248, 3.391, 1.610, 18.058, 4.991, 2.040, "passive"),
    ),
)


IMU_BOARD = BoardSpec(
    name="imu_board",
    width=30.0,
    height=10.0,
    thickness=1.6,
    holes=(
        (2.0, 2.0, 1.016), (2.0, 8.0, 1.016), (7.0, 2.0, 1.016),
        (24.0, 2.0, 1.016), (24.0, 8.0, 1.016), (25.527, 1.828, 0.7),
        (25.527, 3.078, 0.7), (25.527, 4.328, 0.7), (25.527, 5.578, 0.7),
        (25.527, 6.828, 0.7), (25.527, 8.078, 0.7),
    ),
    components=(
        ComponentBox("J1_6p_conn", 25.277, 0.248, -0.600, 29.877, 9.658, 4.850, "connector"),
        ComponentBox("U2_lga16", 5.500, 5.500, 1.620, 8.500, 8.500, 2.521, "ic"),
        ComponentBox("U1_lga14_body", 13.750, 5.500, 1.810, 16.250, 8.500, 2.470, "ic"),
        ComponentBox("U1_lga14_base", 13.750, 5.500, 1.600, 16.250, 8.500, 1.810, "ic"),
        ComponentBox("C1", 12.662, 3.918, 1.600, 14.262, 4.718, 2.400, "passive"),
        ComponentBox("C2", 12.238, 5.993, 1.600, 13.038, 7.593, 2.400, "passive"),
        ComponentBox("C3", 9.506, 7.074, 1.600, 10.306, 8.674, 2.400, "passive"),
        ComponentBox("C4", 3.664, 5.550, 1.600, 4.464, 7.150, 2.400, "passive"),
        ComponentBox("R1", 19.153, 6.693, 1.610, 19.963, 8.293, 2.040, "passive"),
        ComponentBox("R2", 17.629, 6.693, 1.610, 18.439, 8.293, 2.040, "passive"),
    ),
)


BUTTON_BOARD = BoardSpec(
    name="button_board",
    width=60.0,
    height=10.0,
    thickness=1.6,
    holes=(
        (1.623, 2.75, 1.2), (1.623, 7.25, 1.2), (8.123, 2.75, 1.2),
        (8.123, 7.25, 1.2), (12.373, 5.0, 2.2), (16.623, 2.75, 1.2),
        (16.623, 7.25, 1.2), (23.123, 2.75, 1.2), (23.123, 7.25, 1.2),
        (26.748, 5.08, 0.7), (27.998, 5.08, 0.7), (29.248, 5.08, 0.7),
        (30.498, 5.08, 0.7), (31.748, 5.08, 0.7), (32.998, 5.08, 0.7),
        (36.623, 2.75, 1.2), (36.623, 7.25, 1.2), (43.123, 2.75, 1.2),
        (43.123, 7.25, 1.2), (47.373, 5.0, 2.2), (51.623, 2.75, 1.2),
        (51.623, 7.25, 1.2), (58.123, 2.75, 1.2), (58.123, 7.25, 1.2),
    ),
    components=(
        ComponentBox("SW1", 0.767, 2.000, -1.900, 8.979, 8.000, 6.500, "switch"),
        ComponentBox("SW2", 15.767, 2.000, -1.900, 23.979, 8.000, 6.500, "switch"),
        ComponentBox("SW3", 35.767, 2.000, -1.900, 43.979, 8.000, 6.500, "switch"),
        ComponentBox("SW4", 50.767, 2.000, -1.900, 58.979, 8.000, 6.500, "switch"),
        ComponentBox("U1_6p_conn", 25.168, 4.830, -0.600, 34.578, 9.430, 4.850, "connector"),
        ComponentBox("R1", 28.551, 0.851, 1.610, 29.361, 2.451, 2.040, "passive"),
        ComponentBox("R2", 29.821, 0.851, 1.610, 30.631, 2.451, 2.040, "passive"),
        ComponentBox("R3", 31.218, 0.851, 1.610, 32.028, 2.451, 2.040, "passive"),
        ComponentBox("R4", 32.615, 0.851, 1.610, 33.425, 2.451, 2.040, "passive"),
    ),
)


MCU_BOARD = BoardSpec(
    name="mcu_board",
    width=64.0,
    height=40.0,
    thickness=1.6,
    holes=(
        (4.0, 4.0, 3.2), (4.0, 36.0, 3.2), (5.969, 9.809, 0.7),
        (5.969, 11.059, 0.7), (5.969, 12.309, 0.7), (5.969, 13.559, 0.7),
        (5.969, 17.429, 0.7), (5.969, 18.679, 0.7), (5.969, 19.929, 0.7),
        (5.969, 21.179, 0.7), (5.969, 25.069, 0.7), (5.969, 26.319, 0.7),
        (5.969, 27.569, 0.7), (5.969, 28.819, 0.7), (5.969, 30.069, 0.7),
        (5.969, 31.319, 0.7), (10.444, 28.956, 0.7), (11.694, 28.956, 0.7),
        (12.944, 28.956, 0.7), (13.893, 5.461, 0.7), (14.194, 28.956, 0.7),
        (15.143, 5.461, 0.7), (16.393, 5.461, 0.7), (17.643, 5.461, 0.7),
        (18.893, 5.461, 0.7), (20.143, 5.461, 0.7), (23.946, 5.715, 0.7),
        (25.196, 5.715, 0.7), (26.446, 5.715, 0.7), (27.696, 5.715, 0.7),
        (28.946, 5.715, 0.7), (30.196, 5.715, 0.7), (31.446, 5.715, 0.7),
        (32.696, 5.715, 0.7), (38.15, 5.588, 0.7), (39.4, 5.588, 0.7),
        (40.65, 5.588, 0.7), (41.9, 5.588, 0.7), (43.15, 5.588, 0.7),
        (44.4, 5.588, 0.7), (59.309, 25.577, 0.7), (59.309, 26.827, 0.7),
        (59.309, 28.077, 0.7), (59.309, 29.327, 0.7), (59.309, 30.577, 0.7),
        (59.309, 31.827, 0.7), (59.675, 10.163, 1.2), (59.675, 18.163, 1.2),
        (60.0, 4.0, 3.2), (60.0, 36.0, 3.2),
    ),
    components=(
        ComponentBox("U3_esp32_s3_wroom", 23.003, 13.887, 1.600, 41.005, 39.388, 4.710, "module"),
        ComponentBox("CARD1_tf_socket_body", 49.169, 7.888, 1.000, 63.669, 22.338, 3.500, "connector"),
        ComponentBox("TFT_SPI_8p_conn", 22.366, 1.365, -0.600, 34.276, 5.965, 4.850, "connector"),
        ComponentBox("IMU_IIC_6p_conn", 12.313, 1.111, -0.600, 21.723, 5.711, 4.850, "connector"),
        ComponentBox("POWER_6p_conn", 36.570, 1.238, -0.600, 45.980, 5.838, 4.850, "connector"),
        ComponentBox("SW_6p_conn", 1.619, 23.489, -0.600, 6.219, 32.899, 4.850, "connector"),
        ComponentBox("UART0_6p_conn", 59.059, 23.997, -0.600, 63.659, 33.407, 4.850, "connector"),
        ComponentBox("UART1_4p_conn", 1.741, 8.229, -0.500, 6.341, 15.139, 4.950, "connector"),
        ComponentBox("UART2_4p_conn", 1.741, 15.849, -0.500, 6.341, 22.759, 4.950, "connector"),
        ComponentBox("USB_4p_conn", 8.864, 28.584, -0.500, 15.774, 33.184, 4.950, "connector"),
        ComponentBox("CARD1_tf_socket_shell", 49.169, 7.038, 1.600, 63.669, 23.188, 3.651, "connector"),
        ComponentBox("U8_sot223", 11.431, 8.307, -1.749, 14.931, 14.807, -0.149, "ic"),
        ComponentBox("U8_tab", 14.931, 10.057, -1.099, 16.736, 13.057, 0.000, "ic"),
        ComponentBox("C8", 20.809, 30.442, 1.600, 21.609, 32.042, 2.400, "passive"),
        ComponentBox("C9", 18.854, 30.442, 1.600, 19.654, 32.042, 2.400, "passive"),
        ComponentBox("C10", 51.771, 4.299, 1.600, 53.371, 5.099, 2.400, "passive"),
        ComponentBox("C11", 39.091, 7.461, 1.600, 40.691, 8.261, 2.400, "passive"),
        ComponentBox("C12", 51.771, 6.091, 1.600, 53.371, 6.891, 2.400, "passive"),
        ComponentBox("R7", 39.091, 9.107, 1.610, 40.691, 9.917, 2.040, "passive"),
        ComponentBox("R8", 16.994, 30.442, 1.610, 17.804, 32.042, 2.040, "passive"),
    ),
)


BOARD_SPECS = {
    "mcu": MCU_BOARD,
    "imu": IMU_BOARD,
    "button": BUTTON_BOARD,
    "power": POWER_BOARD,
}


def make_lcd_4p2_reference(landscape: bool = True) -> cq.Workplane:
    # From 屏幕.PNG.jpg: PCB 69.34 x 99.7, LCD CF 67.6 x 88, AA 63.6 x 84.8.
    pcb_w = 69.34
    pcb_h = 99.7
    pcb_t = 1.2
    cf_w = 67.6
    cf_h = 88.0
    aa_w = 63.6
    aa_h = 84.8

    pcb = cq.Workplane("XY").rect(pcb_w, pcb_h).extrude(pcb_t)
    cf = cq.Workplane("XY").rect(cf_w, cf_h).extrude(0.45).translate((0, -1.1, pcb_t))
    aa = cq.Workplane("XY").rect(aa_w, aa_h).extrude(0.10).translate((0, -1.1, pcb_t + 0.48))

    header: cq.Workplane | None = None
    y = pcb_h / 2.0 - 11.0
    for i in range(8):
        x = (i - 3.5) * 2.54
        pad = cq.Workplane("XY").circle(0.5).extrude(0.16).translate((x, y, pcb_t + 0.6))
        header = pad if header is None else header.union(pad)

    part = pcb.union(cf).union(aa)
    if header is not None:
        part = part.union(header)
    if landscape:
        part = part.rotate((0, 0, 0), (0, 0, 1), 90)
    return part


def make_all_reference_assembly() -> cq.Assembly:
    asm = cq.Assembly(name="sailsiq_reconstructed_boards")
    x = 0.0
    for key in ("mcu", "power", "imu", "button"):
        spec = BOARD_SPECS[key]
        asm.add(make_pcb(spec), name=spec.name, loc=cq.Location(cq.Vector(x, 0, 0)), color=_color_for("board"))
        x += spec.width + 18.0
    asm.add(make_lcd_4p2_reference(), name="lcd_4p2_reference_landscape", loc=cq.Location(cq.Vector(0, 70, 0)), color=cq.Color(0.12, 0.12, 0.12, 0.65))
    return asm


def export_all() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for key, spec in BOARD_SPECS.items():
        make_pcb_assembly(spec).save(str(OUT_DIR / f"{spec.name}_reconstructed.step"))
    cq.exporters.export(make_lcd_4p2_reference(), str(OUT_DIR / "lcd_4p2_reference_reconstructed.step"))
    make_all_reference_assembly().save(str(OUT_DIR / "sailsiq_boards_reconstructed_assembly.step"))


if __name__ == "__main__":
    export_all()
    print(f"Exported reconstructed SailSIQ board references to: {OUT_DIR}")
