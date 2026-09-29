#!/usr/bin/env python3
"""Small source and ESP-IDF component dependency guard for Sailball v1.0."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COMPONENTS = ROOT / "components"


def component_sources(name: str) -> list[Path]:
    folder = COMPONENTS / name
    return sorted(path for base in (folder / "src", folder / "include")
                  if base.exists() for path in base.rglob("*") if path.suffix in {".c", ".h", ".cpp", ".hpp"})


def dependencies() -> dict[str, set[str]]:
    graph: dict[str, set[str]] = {}
    for cmake in COMPONENTS.glob("*/CMakeLists.txt"):
        source = cmake.parent.name
        text = cmake.read_text(encoding="utf-8")
        deps: set[str] = set()
        for match in re.finditer(r"\b(?:PRIV_)?REQUIRES\s+([^\)\n]+)", text):
            deps.update(token for token in re.split(r"[\s\"]+", match.group(1))
                        if token.startswith("sailball_"))
        graph[source] = deps
    return graph


def check_acyclic(graph: dict[str, set[str]]) -> list[str]:
    failures: list[str] = []
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node: str, trail: list[str]) -> None:
        if node in visiting:
            failures.append("component dependency cycle: " + " -> ".join(trail + [node]))
            return
        if node in visited:
            return
        visiting.add(node)
        for child in sorted(graph.get(node, ())):
            if child in graph:
                visit(child, trail + [node])
        visiting.remove(node)
        visited.add(node)

    for component in sorted(graph):
        visit(component, [])
    return failures


def check_forbidden_includes() -> list[str]:
    forbidden = {
        "sailball_recorder": re.compile(r"#\s*include\s*[<\"](?:sailball/(?:wifi|ble|sp)\.h|(?:esp_wifi|nimble)/|driver/|esp_driver_)", re.I),
        "sailball_transfer": re.compile(r"#\s*include\s*[<\"](?:esp_vfs_fat\.h|fatfs/|sdmmc_cmd\.h|driver/(?:sd|spi)|esp_driver_sd|sailball_storage_private)", re.I),
        "sailball_control": re.compile(r"#\s*include\s*[<\"](?:driver/uart|esp_driver_uart|uart\.h|gnss_driver)", re.I),
        "sailball_ui": re.compile(r"#\s*include\s*[<\"](?:sailball/(?:storage|gnss)\.h|esp_vfs_fat\.h|fatfs/|sdmmc_cmd\.h|driver/uart|esp_driver_uart)", re.I),
    }
    failures: list[str] = []
    for component, pattern in forbidden.items():
        for path in component_sources(component):
            for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if pattern.search(line):
                    failures.append(f"forbidden dependency in {path.relative_to(ROOT)}:{line_number}: {line.strip()}")
    return failures


def check_application_tasks() -> list[str]:
    expected = {"gnss_task", "recorder_task", "storage_task", "supervisor_task",
                "transfer_task", "control_task", "transport_task", "ui_task"}
    found: set[str] = set()
    failures: list[str] = []
    all_sources = [path for component in COMPONENTS.glob("sailball_*")
                   for path in component.rglob("*.c") if "build" not in path.parts]
    for path in all_sources:
        text = path.read_text(encoding="utf-8")
        found.update(re.findall(r"xTaskCreateStatic\s*\(\s*\w+\s*,\s*\"([^\"]+)\"", text))
    if found != expected:
        failures.append(f"application task set differs: expected {sorted(expected)}, found {sorted(found)}")
    for task in ("gnss", "recorder", "storage", "supervisor"):
        path = COMPONENTS / f"sailball_{task}" / "src" / f"{task}.c"
        if not path.exists():
            failures.append(f"critical task source missing: {path.relative_to(ROOT)}")
            continue
        text = path.read_text(encoding="utf-8")
        if "esp_task_wdt_add(NULL)" not in text or "esp_task_wdt_reset()" not in text:
            failures.append(f"critical task lacks Task WDT subscription/heartbeat: {path.relative_to(ROOT)}")
    stack_roles = {
        "gnss": "SB_VALIDATION_TASK_GNSS",
        "recorder": "SB_VALIDATION_TASK_RECORDER",
        "storage": "SB_VALIDATION_TASK_STORAGE",
        "supervisor": "SB_VALIDATION_TASK_SUPERVISOR",
        "control": "SB_VALIDATION_TASK_CONTROL",
        "usb": "SB_VALIDATION_TASK_TRANSPORT",
        "transfer": "SB_VALIDATION_TASK_TRANSFER",
        "ui": "SB_VALIDATION_TASK_UI",
    }
    for component, role in stack_roles.items():
        sources = list((COMPONENTS / f"sailball_{component}").rglob("*.c"))
        if not any(role in path.read_text(encoding="utf-8") for path in sources):
            failures.append(f"task stack watermark instrumentation missing for {role}")
    return failures


def check_transport_service_contract() -> list[str]:
    failures: list[str] = []
    transport = (COMPONENTS / "sailball_usb/src/transport_task.c").read_text(encoding="utf-8")
    wifi = (COMPONENTS / "sailball_wifi/src/wifi.c").read_text(encoding="utf-8")
    ble = (COMPONENTS / "sailball_ble/src/ble.c").read_text(encoding="utf-8")
    start = transport.find("static void transport_task(")
    body = transport[start:] if start >= 0 else ""
    positions = [body.find("send_ready_responses();"), body.find("sb_wifi_transport_poll();"), body.find("service_ble_transport();")]
    if start < 0 or any(position < 0 for position in positions) or positions != sorted(positions):
        failures.append("transport poll must return from bounded USB/TCP work to BLE fragment service every loop")
    if "sb_transport_tx_quantum(s_usb_tx_length-s_usb_tx_offset,USB_TX_QUANTUM)" not in transport:
        failures.append("USB partial TX must use the bounded per-poll quantum helper")
    if "sb_transport_tx_quantum(s_tx_length-s_tx_offset,WIFI_TX_QUANTUM)" not in wifi:
        failures.append("TCP partial TX must use the bounded per-poll quantum helper")
    if "for(unsigned count=0;count<BLE_FRAGMENT_QUEUE_DEPTH;++count)" not in ble:
        failures.append("BLE fragment handoff drain must be bounded by its fixed queue depth")
    if "if(overflow){" not in ble or "xQueueReset(s_fragment_queue)" not in ble or "fragment_error();" not in ble:
        failures.append("BLE handoff overflow must discard fragments and invalidate the partial assembly")
    if "ATT_ERR_INSUFFICIENT_RES" not in ble:
        failures.append("BLE handoff-full callback must explicitly report resource exhaustion")
    if "s_initializing=true" not in wifi or "s_initializing=false" not in wifi or "bool sb_wifi_is_initializing(void)" not in wifi:
        failures.append("synchronous Wi-Fi cold init must expose an internal WIRELESS_INITIALIZING signal")
    return failures


def check_storage_background_quantum() -> list[str]:
    failures: list[str] = []
    storage = (COMPONENTS / "sailball_storage/src/storage.c").read_text(encoding="utf-8")
    ldc = (COMPONENTS / "sailball_ldc/src/ldc.c").read_text(encoding="utf-8")
    if "sb_ldc_metadata_load_step(&io,&s_metadata_loader,STORAGE_METADATA_OPS_PER_SLICE" not in storage:
        failures.append("Storage metadata validation must use the resumable bounded loader")
    if "if(!request->metadata_validated)" not in storage or "if(!complete)return SB_ACCEPTED;" not in storage:
        failures.append("non-active file scans must finish metadata validation over multiple background activations")
    if "sb_ldc_metadata_load_step" not in ldc or "while(!complete)" not in ldc:
        failures.append("synchronous LDC metadata API must be a wrapper over the tested incremental loader")
    if not re.search(r"if\s*\(!service_background\s*&&\s*xQueueReceive\(s_req_q,\s*&request,\s*background_active\?0:pdMS_TO_TICKS\(100\)\)==pdTRUE\)", storage):
        failures.append("Storage critical requests must preempt sliced background work")
    if "sb_storage_policy_service_background(critical_pending,background_pending" not in storage or "STORAGE_CRITICAL_BURST_MAX 4u" not in storage:
        failures.append("Storage sustained critical traffic must leave a bounded background service opportunity")
    if "vTaskDelay(1u);" not in storage:
        failures.append("accepted background work must yield a real scheduler tick between slices")
    return failures


def check_diagnostics_ownership() -> list[str]:
    failures: list[str] = []
    control = (COMPONENTS / "sailball_control/src/control.c").read_text(encoding="utf-8")
    transfer = (COMPONENTS / "sailball_transfer/src/transfer.c").read_text(encoding="utf-8")
    gnss = (COMPONENTS / "sailball_gnss/src/gnss.c").read_text(encoding="utf-8")
    if "sb_diag_increment(SB_DIAG_GNSS" in control or "sb_diag_add(SB_DIAG_GNSS" in control:
        failures.append("Control must request GNSS live-drop accounting through the GNSS owner mailbox")
    if "sb_gnss_note_live_stream_drop()" not in control or "s_pending_live_stream_drops" not in gnss:
        failures.append("GNSS live-drop diagnostic must be applied by GNSS owner from bounded saturating pending state")
    if "sb_diag_increment(SB_DIAG_STORAGE" in transfer or "sb_diag_add(SB_DIAG_STORAGE" in transfer:
        failures.append("Transfer must not mutate Storage-owned diagnostic counters")
    return failures


def check_gnss_backend_boundary() -> list[str]:
    failures: list[str] = []
    upper_components = ("sailball_recorder", "sailball_storage", "sailball_ldc",
                        "sailball_supervisor", "sailball_sp", "sailball_control",
                        "sailball_ui", "sailball_system")
    vendor = re.compile(r"\b(?:ATGM(?:336H)?|NMEA|PCAS\d{2})\b", re.I)
    for component in upper_components:
        for path in component_sources(component):
            for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if vendor.search(line):
                    failures.append(f"vendor-specific GNSS detail leaked above backend: {path.relative_to(ROOT)}:{line_number}: {line.strip()}")
    return failures


def check_no_pps_implementation() -> list[str]:
    failures: list[str] = []
    for component in ("sailball_board", "sailball_gnss"):
        for path in component_sources(component):
            for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if re.search(r"\bPPS\b|1PPS|pps_gpio|pps_isr", line, re.I):
                    failures.append(f"v1 GNSS has no PPS net/state: {path.relative_to(ROOT)}:{line_number}: {line.strip()}")
    return failures


def main() -> int:
    failures = (check_forbidden_includes() + check_acyclic(dependencies()) +
                check_application_tasks() + check_transport_service_contract() +
                check_storage_background_quantum() + check_diagnostics_ownership() +
                check_gnss_backend_boundary() + check_no_pps_implementation())
    for component in ('storage', 'transfer'):
        path = COMPONENTS / f'sailball_{component}' / 'src' / f'{component}.c'
        text = path.read_text(encoding='utf-8')
        if re.search(r'\bxTaskNotify(?:Wait|Give)?\s*\(', text):
            failures.append(f'{component}: unindexed notification can alias RPC completion/control wake')
        if 'sb_rpc_wait_completion()' not in text or 'sb_rpc_complete(' not in text:
            failures.append(f'{component}: reliable RPC completion barrier missing')
    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("PASS forbidden component include checks")
    print("PASS ESP-IDF Sailball component dependency graph is acyclic")
    print("PASS eight application tasks; critical task watchdogs are registered")
    print("PASS internal stack watermark instrumentation covers all eight tasks")
    print("PASS Storage/Transfer use the dedicated RPC completion barrier")
    print("PASS bounded USB/TCP service and BLE handoff recovery contract")
    print("PASS Storage metadata validation is resumable and yields between critical-preemptible slices")
    print("PASS diagnostics mutations follow subsystem owner boundaries")
    print("PASS ATGM/NMEA details remain below the vendor-neutral GNSS boundary; no PPS implementation")
    return 0


if __name__ == "__main__":
    sys.exit(main())
