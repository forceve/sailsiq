#!/usr/bin/env python3
"""Convert u-blox UBX logs into GPX 1.1 tracks."""

from __future__ import annotations

import argparse
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from struct import unpack_from
from typing import Iterator, Sequence

GPX_NS = "http://www.topografix.com/GPX/1/1"
UBX_EXT_NS = "https://sailsiq.local/ns/ubx"
SYNC_BYTES = b"\xb5\x62"
NAV_CLASS = 0x01
NAV_PVT_ID = 0x07
NAV_PVT_LEN = 92


@dataclass(frozen=True)
class NavPvtPoint:
    time_utc: datetime
    lat: float
    lon: float
    ele_m: float
    fix_type: int
    gnss_fix_ok: bool
    num_sv: int
    speed_mps: float
    course_deg: float
    horizontal_accuracy_m: float
    vertical_accuracy_m: float
    speed_accuracy_mps: float
    heading_accuracy_deg: float
    pdop: float


@dataclass(frozen=True)
class TrackData:
    source: Path
    points: list[NavPvtPoint]
    packet_count: int
    skipped_no_fix: int


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert u-blox .ubx logs into GPX 1.1 track files.",
    )
    parser.add_argument(
        "inputs",
        nargs="+",
        help="One or more .ubx files or directories containing .ubx files.",
    )
    parser.add_argument(
        "-o",
        "--output",
        help=(
            "Output file or directory. For a single input file this can be a .gpx file. "
            "For directories, multiple files, or --merge, this should be a directory "
            "or the merged output .gpx path."
        ),
    )
    parser.add_argument(
        "--merge",
        action="store_true",
        help="Write all inputs into a single GPX file instead of one GPX per source file.",
    )
    parser.add_argument(
        "--min-fix-type",
        type=int,
        default=2,
        choices=range(0, 6),
        metavar="0-5",
        help="Minimum UBX fixType to keep. Default: 2.",
    )
    parser.add_argument(
        "--require-fix-ok",
        action="store_true",
        help="Keep only NAV-PVT points where the gnssFixOK flag is set.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing GPX output files.",
    )
    return parser.parse_args(argv)


def checksum_ok(frame: bytes) -> bool:
    ck_a = 0
    ck_b = 0
    for byte in frame[2:-2]:
        ck_a = (ck_a + byte) & 0xFF
        ck_b = (ck_b + ck_a) & 0xFF
    return frame[-2] == ck_a and frame[-1] == ck_b


def iter_ubx_payloads(data: bytes) -> Iterator[tuple[int, int, bytes]]:
    offset = 0
    data_len = len(data)
    while True:
        start = data.find(SYNC_BYTES, offset)
        if start < 0 or start + 6 > data_len:
            return

        payload_len = int.from_bytes(data[start + 4 : start + 6], "little")
        frame_end = start + 6 + payload_len + 2
        if frame_end > data_len:
            return

        frame = data[start:frame_end]
        if checksum_ok(frame):
            yield frame[2], frame[3], frame[6:-2]
            offset = frame_end
        else:
            offset = start + 2


def parse_ubx_datetime(
    year: int,
    month: int,
    day: int,
    hour: int,
    minute: int,
    second: int,
    nano: int,
) -> datetime | None:
    try:
        base = datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)
    except ValueError:
        return None

    whole_seconds, remainder_nanos = divmod(nano, 1_000_000_000)
    return base + timedelta(
        seconds=whole_seconds,
        microseconds=round(remainder_nanos / 1000),
    )


def parse_nav_pvt(payload: bytes) -> NavPvtPoint | None:
    if len(payload) != NAV_PVT_LEN:
        return None

    year = unpack_from("<H", payload, 4)[0]
    month = payload[6]
    day = payload[7]
    hour = payload[8]
    minute = payload[9]
    second = payload[10]
    nano = unpack_from("<i", payload, 16)[0]

    time_utc = parse_ubx_datetime(year, month, day, hour, minute, second, nano)
    if time_utc is None:
        return None

    fix_type = payload[20]
    flags = payload[21]
    num_sv = payload[23]
    lon = unpack_from("<i", payload, 24)[0] / 1e7
    lat = unpack_from("<i", payload, 28)[0] / 1e7
    ele_m = unpack_from("<i", payload, 36)[0] / 1000.0
    horizontal_accuracy_m = unpack_from("<I", payload, 40)[0] / 1000.0
    vertical_accuracy_m = unpack_from("<I", payload, 44)[0] / 1000.0
    speed_mps = unpack_from("<i", payload, 60)[0] / 1000.0
    course_deg = unpack_from("<i", payload, 64)[0] / 1e5
    speed_accuracy_mps = unpack_from("<I", payload, 68)[0] / 1000.0
    heading_accuracy_deg = unpack_from("<I", payload, 72)[0] / 1e5
    pdop = unpack_from("<H", payload, 76)[0] / 100.0

    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return None

    return NavPvtPoint(
        time_utc=time_utc,
        lat=lat,
        lon=lon,
        ele_m=ele_m,
        fix_type=fix_type,
        gnss_fix_ok=bool(flags & 0x01),
        num_sv=num_sv,
        speed_mps=max(0.0, speed_mps),
        course_deg=course_deg % 360.0,
        horizontal_accuracy_m=horizontal_accuracy_m,
        vertical_accuracy_m=vertical_accuracy_m,
        speed_accuracy_mps=speed_accuracy_mps,
        heading_accuracy_deg=heading_accuracy_deg,
        pdop=pdop,
    )


def should_keep_point(
    point: NavPvtPoint,
    *,
    min_fix_type: int,
    require_fix_ok: bool,
) -> bool:
    if point.fix_type < min_fix_type:
        return False
    if require_fix_ok and not point.gnss_fix_ok:
        return False
    return True


def parse_ubx_file(
    path: Path,
    *,
    min_fix_type: int,
    require_fix_ok: bool,
) -> TrackData:
    packet_count = 0
    skipped_no_fix = 0
    points: list[NavPvtPoint] = []

    data = path.read_bytes()
    for msg_class, msg_id, payload in iter_ubx_payloads(data):
        if msg_class != NAV_CLASS or msg_id != NAV_PVT_ID:
            continue
        packet_count += 1
        point = parse_nav_pvt(payload)
        if point is None:
            continue
        if should_keep_point(
            point,
            min_fix_type=min_fix_type,
            require_fix_ok=require_fix_ok,
        ):
            points.append(point)
        else:
            skipped_no_fix += 1

    return TrackData(
        source=path,
        points=points,
        packet_count=packet_count,
        skipped_no_fix=skipped_no_fix,
    )


def resolve_inputs(inputs: Sequence[str]) -> list[Path]:
    resolved: list[Path] = []
    seen: set[Path] = set()

    for raw in inputs:
        path = Path(raw).expanduser()
        if not path.exists():
            raise FileNotFoundError(f"Input does not exist: {path}")
        if path.is_dir():
            for candidate in sorted(path.glob("*.ubx")):
                candidate = candidate.resolve()
                if candidate not in seen:
                    resolved.append(candidate)
                    seen.add(candidate)
            continue
        if path.suffix.lower() != ".ubx":
            raise ValueError(f"Only .ubx inputs are supported: {path}")
        path = path.resolve()
        if path not in seen:
            resolved.append(path)
            seen.add(path)

    return resolved


def gpx_time_string(value: datetime) -> str:
    text = value.astimezone(timezone.utc).isoformat(timespec="microseconds")
    return text.replace("+00:00", "Z")


def format_decimal(value: float, digits: int) -> str:
    return f"{value:.{digits}f}"


def fix_label(fix_type: int) -> str | None:
    if fix_type == 2:
        return "2d"
    if fix_type >= 3:
        return "3d"
    return None


def build_gpx_tree(tracks: Sequence[TrackData], creator: str) -> ET.ElementTree:
    ET.register_namespace("", GPX_NS)
    ET.register_namespace("ubx", UBX_EXT_NS)

    gpx = ET.Element(
        ET.QName(GPX_NS, "gpx"),
        attrib={
            "version": "1.1",
            "creator": creator,
        },
    )

    metadata = ET.SubElement(gpx, ET.QName(GPX_NS, "metadata"))
    created_at = min(point.time_utc for track in tracks for point in track.points)
    ET.SubElement(metadata, ET.QName(GPX_NS, "time")).text = gpx_time_string(created_at)

    for track in tracks:
        trk = ET.SubElement(gpx, ET.QName(GPX_NS, "trk"))
        ET.SubElement(trk, ET.QName(GPX_NS, "name")).text = track.source.stem
        trkseg = ET.SubElement(trk, ET.QName(GPX_NS, "trkseg"))
        for point in track.points:
            trkpt = ET.SubElement(
                trkseg,
                ET.QName(GPX_NS, "trkpt"),
                attrib={
                    "lat": format_decimal(point.lat, 7),
                    "lon": format_decimal(point.lon, 7),
                },
            )
            ET.SubElement(trkpt, ET.QName(GPX_NS, "ele")).text = format_decimal(point.ele_m, 3)
            ET.SubElement(trkpt, ET.QName(GPX_NS, "time")).text = gpx_time_string(point.time_utc)

            fix = fix_label(point.fix_type)
            if fix:
                ET.SubElement(trkpt, ET.QName(GPX_NS, "fix")).text = fix
            if point.num_sv > 0:
                ET.SubElement(trkpt, ET.QName(GPX_NS, "sat")).text = str(point.num_sv)
            if point.pdop > 0:
                ET.SubElement(trkpt, ET.QName(GPX_NS, "pdop")).text = format_decimal(point.pdop, 2)

            extensions = ET.SubElement(trkpt, ET.QName(GPX_NS, "extensions"))
            ET.SubElement(
                extensions,
                ET.QName(UBX_EXT_NS, "fixType"),
            ).text = str(point.fix_type)
            ET.SubElement(
                extensions,
                ET.QName(UBX_EXT_NS, "gnssFixOk"),
            ).text = str(point.gnss_fix_ok).lower()
            ET.SubElement(
                extensions,
                ET.QName(UBX_EXT_NS, "speedMps"),
            ).text = format_decimal(point.speed_mps, 3)
            ET.SubElement(
                extensions,
                ET.QName(UBX_EXT_NS, "courseDeg"),
            ).text = format_decimal(point.course_deg, 5)
            ET.SubElement(
                extensions,
                ET.QName(UBX_EXT_NS, "horizontalAccuracyM"),
            ).text = format_decimal(point.horizontal_accuracy_m, 3)
            ET.SubElement(
                extensions,
                ET.QName(UBX_EXT_NS, "verticalAccuracyM"),
            ).text = format_decimal(point.vertical_accuracy_m, 3)
            ET.SubElement(
                extensions,
                ET.QName(UBX_EXT_NS, "speedAccuracyMps"),
            ).text = format_decimal(point.speed_accuracy_mps, 3)
            ET.SubElement(
                extensions,
                ET.QName(UBX_EXT_NS, "headingAccuracyDeg"),
            ).text = format_decimal(point.heading_accuracy_deg, 5)

    tree = ET.ElementTree(gpx)
    ET.indent(tree, space="  ")
    return tree


def write_gpx(path: Path, tracks: Sequence[TrackData], creator: str, overwrite: bool) -> None:
    if path.exists() and not overwrite:
        raise FileExistsError(f"Output already exists: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    tree = build_gpx_tree(tracks, creator)
    tree.write(path, encoding="utf-8", xml_declaration=True)


def default_merge_output(inputs: Sequence[Path]) -> Path:
    if len(inputs) == 1:
        return inputs[0].with_suffix(".gpx")
    return inputs[0].parent / "merged_ubx.gpx"


def output_path_for_single(input_path: Path, output_arg: str | None) -> Path:
    if output_arg is None:
        return input_path.with_suffix(".gpx")
    output = Path(output_arg).expanduser()
    if output.exists() and output.is_dir():
        return output / f"{input_path.stem}.gpx"
    if output.suffix.lower() == ".gpx":
        return output
    return output / f"{input_path.stem}.gpx"


def output_path_for_many(output_arg: str | None, inputs: Sequence[Path], merge: bool) -> Path | None:
    if merge:
        if output_arg is None:
            return default_merge_output(inputs)
        output = Path(output_arg).expanduser()
        if output.exists() and output.is_dir():
            return output / "merged_ubx.gpx"
        if output.suffix.lower() != ".gpx":
            raise ValueError("Merged output must be a .gpx file or an existing directory.")
        return output

    if output_arg is None:
        return None

    output = Path(output_arg).expanduser()
    if output.exists() and not output.is_dir():
        raise ValueError("When converting multiple files without --merge, --output must be a directory.")
    if output.suffix.lower() == ".gpx":
        raise ValueError("When converting multiple files without --merge, --output must be a directory.")
    return output


def summarize_track(track: TrackData) -> str:
    if not track.points:
        return f"{track.source.name}: no usable fixes ({track.packet_count} NAV-PVT packets)"
    start = track.points[0].time_utc.isoformat(timespec="seconds").replace("+00:00", "Z")
    end = track.points[-1].time_utc.isoformat(timespec="seconds").replace("+00:00", "Z")
    return (
        f"{track.source.name}: {len(track.points)} points, "
        f"{track.skipped_no_fix} filtered, {start} -> {end}"
    )


def load_tracks(
    inputs: Sequence[Path],
    *,
    min_fix_type: int,
    require_fix_ok: bool,
) -> list[TrackData]:
    tracks: list[TrackData] = []
    for path in inputs:
        track = parse_ubx_file(
            path,
            min_fix_type=min_fix_type,
            require_fix_ok=require_fix_ok,
        )
        tracks.append(track)
    return tracks


def warn(message: str) -> None:
    print(message, file=sys.stderr)


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)

    try:
        inputs = resolve_inputs(args.inputs)
        if not inputs:
            raise ValueError("No .ubx files were found in the provided inputs.")

        tracks = load_tracks(
            inputs,
            min_fix_type=args.min_fix_type,
            require_fix_ok=args.require_fix_ok,
        )

        usable_tracks = [track for track in tracks if track.points]
        for track in tracks:
            if track.points:
                print(summarize_track(track))
            else:
                warn(f"skip: {summarize_track(track)}")

        if not usable_tracks:
            raise ValueError("No usable NAV-PVT fixes were found in the provided inputs.")

        creator = "SailSIQ ubx_to_gpx.py"
        if args.merge:
            multi_output = output_path_for_many(args.output, inputs, True)
            assert multi_output is not None
            write_gpx(multi_output, usable_tracks, creator, overwrite=args.overwrite)
            print(f"wrote: {multi_output}")
            return 0

        if len(inputs) == 1:
            output_path = output_path_for_single(inputs[0], args.output)
            write_gpx(output_path, usable_tracks[:1], creator, overwrite=args.overwrite)
            print(f"wrote: {output_path}")
            return 0

        multi_output = output_path_for_many(args.output, inputs, False)
        output_dir = multi_output
        for track in usable_tracks:
            output_path = (
                track.source.with_suffix(".gpx")
                if output_dir is None
                else output_dir / f"{track.source.stem}.gpx"
            )
            write_gpx(output_path, [track], creator, overwrite=args.overwrite)
            print(f"wrote: {output_path}")
        return 0

    except (FileExistsError, FileNotFoundError, ValueError) as exc:
        warn(f"error: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
