"""Extract current production functions verbatim for physical-dependency tests.

These are function-level fault-injection tests, not full radio integration.
Transfer test directly includes the entire production Transfer translation unit.
"""
import importlib.util
import hashlib
import json
import re
from elftools.elf.elffile import ELFFile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'build' / 'phase_a_tests'
EXTRACTIONS = {}

def emit(name, source_path, names):
    original = source_path.read_text()
    extracted = ''.join(function(original, item) for item in names)
    target = OUT / name
    target.write_bytes(extracted.encode())
    expected = extracted.encode()
    if target.read_bytes() != expected:
        raise RuntimeError('Extracted production body changed on write: ' + name)
    EXTRACTIONS[name] = {
        'production_source': str(source_path.relative_to(ROOT)).replace('\\', '/'),
        'production_sha256': hashlib.sha256(source_path.read_bytes()).hexdigest(),
        'functions': list(names),
        'extracted_sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
    }

def function(text, name):
    import re
    # Match a definition, never a forward declaration followed by another body.
    match = re.search(r'(?m)^(?:static )?(?:void|esp_err_t|bool|int) ' + name + r'\([^;{}]*\)\s*\{', text)
    if not match:
        raise RuntimeError('Production function missing: ' + name)
    start = match.start()
    opening = text.index('{', start)
    depth = 1
    end = opening + 1
    while depth:
        depth += (text[end] == '{') - (text[end] == '}')
        end += 1
    return text[start:end] + '\n'

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    # Use current production Kconfig values in the same budget macros as
    # firmware. No synthetic replacement of the budget itself.
    model = (ROOT / 'components/sailball_common/include/sailball/wireless_budget_model.h').read_text()
    needed = set(re.findall(r'CONFIG_[A-Z_0-9]+', model))
    config = dict(line.split('=', 1) for line in (ROOT / 'sdkconfig.production').read_text().splitlines()
                  if line.startswith('CONFIG_') and '=' in line)
    with (ROOT / 'build/production/sailball.elf').open('rb') as stream:
        elf = ELFFile(stream)
        symbols = {s.name:s['st_value'] for s in elf.get_section_by_name('.symtab').iter_symbols()}
    main_raw = 0x3FCE0000 - symbols['_heap_start']
    rtc_raw = 8192 - (symbols['_rtc_force_slow_end'] - 0x50000000) - (symbols['_rtc_reserved_end'] - symbols['_rtc_reserved_start'])
    ceiling_defines = f'\n#define SB_TEST_MAIN_RAW_CEILING {main_raw}\n#define SB_TEST_INTERNAL_RAW_CEILING {main_raw + rtc_raw}\n#define SB_TEST_INITIAL_RAW_LARGEST {0x3FCDC710 - symbols["_heap_start"]}\n'
    (OUT / 'wireless_model_config.inc').write_text('\n'.join('#define ' + key + ' ' +
        ('1' if config[key] == 'y' else config[key])
        for key in sorted(needed) if key in config) + ceiling_defines)
    for component, names in [('ble', ['ble_started', 'ble_init_failed', 'sb_ble_init']),
                             ('wifi', ['wifi_started', 'wifi_ensure_driver', 'sb_wifi_init', 'start_wifi_impl', 'start_wifi', 'stop_wifi', 'finish_user_disconnect']),
                             ('system', ['require_started', 'sb_system_start']),
                             ('control', ['put_key', 'encode_storage_list', 'encode_counters', 'encode_error_entry', 'encode_errors'])]:
        emit(component + '_init.inc', ROOT / 'components' / ('sailball_' + component) / 'src' / (component + '.c'), names)
    wifi_path = ROOT / 'components/sailball_wifi/src/wifi.c'
    emit('wifi_tcp_adapter.inc', wifi_path,
         ('send_transport_ready', 'send_queued_tcp', 'queue_tcp_frame', 'receive_tcp',
          'sb_wifi_finish_peer_fin_if_drained', 'sb_wifi_receive_frame_for_generation'))
    emit('wifi_tx_adapter.inc', wifi_path, ('send_queued_tcp',))
    emit('wifi_congestion_adapter.inc', wifi_path,
         ('sb_wifi_can_queue_tx', 'sb_wifi_queue_tx', 'sb_wifi_take_tx_completion',
          'send_queued_tcp', 'sb_wifi_finish_peer_fin_if_drained', 'sb_wifi_set_session_generation'))
    ble_path = ROOT / 'components/sailball_ble/src/ble.c'
    emit('ble_congestion_adapter.inc', ble_path,
         ('sb_ble_can_queue_tx', 'sb_ble_queue_tx', 'sb_ble_take_tx_completion',
          'end_logical_session', 'process_control_tx', 'sb_ble_set_session_generation',
          'sb_ble_take_session_end', 'sb_ble_set_session_invalidator'))
    emit('ble_owner_adapter.inc', ble_path,
         ('fragment_error', 'queue_complete_frame', 'process_fragment_handoff', 'rx_access',
          'sb_ble_transport_poll', 'gap_event'))
    emit('usb_tx_adapter.inc', ROOT / 'components/sailball_usb/src/transport_task.c',
         ('send_ready_responses',))
    emit('wifi_rx_transport.inc', ROOT / 'components/sailball_usb/src/transport_task.c',
         ('drain_wifi_rx',))
    (OUT / 'extraction_manifest.json').write_text(json.dumps(EXTRACTIONS, indent=2, sort_keys=True) + '\n')
    spec = importlib.util.spec_from_file_location('stack_gate', ROOT / 'scripts' / 'check_stack_usage.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    names = module.reachable({'control_task': {'dispatch'}, 'dispatch': {'bad_frame'}}, 'control_task')
    assert module.violations({'bad_frame': 8384}, names, 4096) == [('bad_frame', 8384)]
    assert module.violations({'bad_frame': 512}, names, 4096) == []
    print('PASS stack gate negative fixture: 8384-byte frame rejected against 4096-byte task')

if __name__ == '__main__':
    main()
