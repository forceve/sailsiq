"""Evidence checks and necessary reachability gates; never certify always-DENY.
Raw ELF spans are optimistic ceilings, NOT observed heap. Passing these
necessary conditions does not prove private SDK allocation maxima.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path
from elftools.elf.elffile import ELFFile
from measure_wireless_sdk import measure
from prepare_phase_a_tests import function

def require(condition, message):
    if not condition:
        raise ValueError(message)
FIELDS = ('future_internal', 'future_dma', 'opaque_internal', 'opaque_dma', 'critical_internal', 'critical_dma', 'margin_internal', 'margin_dma', 'largest_internal_alloc', 'largest_dma_alloc', 'fragment_internal', 'fragment_dma')

def thresholds(b):
    return dict(internal_free=b['future_internal'] + b['opaque_internal'] + b['critical_internal'] + b['margin_internal'], dma_free=b['future_dma'] + b['opaque_dma'] + b['critical_dma'] + b['margin_dma'], internal_largest=b['largest_internal_alloc'] + b['fragment_internal'], dma_largest=b['largest_dma_alloc'] + b['fragment_dma'])

def reachable(t, internal, dma, largest):
    return t['internal_free'] < internal and t['dma_free'] < dma and (t['internal_largest'] < largest) and (t['dma_largest'] < largest)
def stage_reachable(required_internal, raw_internal, already_resident, future_known=0):
    """Necessary optimistic I-heap bound after actual earlier-stage costs."""
    return required_internal < raw_internal - already_resident - future_known

def check(build, config_path, phase_b=False):
    config = dict((l.split('=', 1) for l in config_path.read_text().splitlines() if l.startswith('CONFIG_') and '=' in l))
    require(config.get('CONFIG_LWIP_ESP_LWIP_ASSERT') == 'y', "Allocation model/config/ELF check failed: config.get('CONFIG_LWIP_ESP_LWIP_ASSERT') == 'y'")
    require(config.get('CONFIG_COMPILER_OPTIMIZATION_ASSERTIONS_ENABLE') == 'y', "Allocation model/config/ELF check failed: config.get('CONFIG_COMPILER_OPTIMIZATION_ASSERTIONS_ENABLE') == 'y'")
    require(config.get('CONFIG_BT_NIMBLE_MAX_CONNECTIONS') == '1', "Allocation model/config/ELF check failed: config.get('CONFIG_BT_NIMBLE_MAX_CONNECTIONS') == '1'")
    require(config.get('CONFIG_ESP_WIFI_STATIC_RX_BUFFER_NUM') == '4' and
            config.get('CONFIG_ESP_WIFI_DYNAMIC_RX_BUFFER_NUM') == '4' and
            config.get('CONFIG_ESP_WIFI_DYNAMIC_TX_BUFFER_NUM') == '4' and
            config.get('CONFIG_ESP_WIFI_RX_MGMT_BUF_NUM_DEF') == '2' and
            config.get('CONFIG_ESP_WIFI_RX_BA_WIN') == '4', 'Wi-Fi buffer profile drifted from the reviewed single-STA budget')
    require(config.get('CONFIG_LWIP_TCP_SND_BUF_DEFAULT') == '2880' and
            config.get('CONFIG_LWIP_TCP_WND_DEFAULT') == '2880', 'TCP two-segment memory profile drifted')
    config_text = config_path.read_text()
    require('# CONFIG_ESP_WIFI_SOFTAP_SUPPORT is not set' in config_text and
            '# CONFIG_LWIP_IPV6 is not set' in config_text, 'Unused SoftAP/IPv6 capability must remain disabled')
    require(config.get('CONFIG_BT_NIMBLE_USE_ESP_TIMER') == 'y', "Allocation model/config/ELF check failed: config.get('CONFIG_BT_NIMBLE_USE_ESP_TIMER') == 'y'")
    require(config.get('CONFIG_ESP_SYSTEM_ALLOW_RTC_FAST_MEM_AS_HEAP') == 'y', 'Review RTC/internal ceiling when RTC heap configuration changes')
    sdk = measure(build)
    require(sdk['tcb'] == 112 and sdk['queue'] == 92 and (sdk['esp_timer_object'] == 32), "Allocation model/config/ELF check failed: sdk['tcb'] == 112 and sdk['queue'] == 92 and (sdk['esp_timer_object'] == 32)")
    require(sdk['npl_event_pool'] == sdk['npl_embedded_event_backing'], 'C3 event backing layout changed')
    require(sdk['npl_timer_count'] == 40, "Allocation model/config/ELF check failed: sdk['npl_timer_count'] == 40")
    npl = sum((sdk[k] for k in ('npl_functions', 'npl_context', 'npl_eventq_pool', 'npl_callout_pool', 'npl_sem_mutex_pools', 'npl_all_event_queues', 'npl_all_sem_mutexes'))) + sdk['npl_timer_count'] * sdk['esp_timer_object']
    require(int(config['CONFIG_BT_NIMBLE_TRANSPORT_ACL_FROM_LL_COUNT']) >= 8, "Allocation model/config/ELF check failed: int(config['CONFIG_BT_NIMBLE_TRANSPORT_ACL_FROM_LL_COUNT']) >= 8")
    require(int(config['CONFIG_BT_NIMBLE_MSYS_2_BLOCK_COUNT']) >= 12, "Allocation model/config/ELF check failed: int(config['CONFIG_BT_NIMBLE_MSYS_2_BLOCK_COUNT']) >= 12")
    require(int(config['CONFIG_ESP_WIFI_STATIC_RX_BUFFER_NUM']) >= int(config['CONFIG_ESP_WIFI_RX_BA_WIN']), "Allocation model/config/ELF check failed: int(config['CONFIG_ESP_WIFI_STATIC_RX_BUFFER_NUM']) >= int(config['CONFIG_ESP_WIFI_RX_BA_WIN'])")
    require(npl == 4972 + 52 * sdk['npl_event_count'], 'Re-budget NPL ABI/config')
    require(sdk['npl_event_count'] == 36 + int(config['CONFIG_BT_NIMBLE_TRANSPORT_EVT_COUNT']) + int(config['CONFIG_BT_NIMBLE_TRANSPORT_EVT_DISCARD_COUNT']), "Allocation model/config/ELF check failed: sdk['npl_event_count'] == 36 + int(config['CONFIG_BT_NIMBLE_TRANSPORT_EVT_COUNT']) + int(config['CONFIG_BT_NIMBLE_TRANSPORT_EVT_DISCARD_COUNT'])")
    host = sum((v for k, v in sdk.items() if k.startswith('host_') and k not in ('host_att_entry', 'host_gatts_service', 'host_gatts_cccd')))
    require(host + 40 * sdk['host_att_entry'] + 3 * sdk['host_gatts_service'] + 2 * sdk['host_gatts_cccd'] + 128 <= 4352, 'Host envelope exceeded')
    require(sdk['controller_stack'] == 4096 and sdk['controller_osi'] == 252, "Allocation model/config/ELF check failed: sdk['controller_stack'] == 4096 and sdk['controller_osi'] == 252")
    require(sdk['fat_sd_six_file_cache_envelope'] + 512 + 4096 <= 12288, "Allocation model/config/ELF check failed: sdk['fat_sd_six_file_cache_envelope'] + 512 + 4096 <= 12288")
    require(sdk['tcpip_mailbox_context'] == 92, 'Re-budget mailbox parent, do not duplicate embedded queue')
    require(sdk['event_post_slot'] <= 32 and sdk['event_loop_context'] + 2 * 92 <= 256, "Allocation model/config/ELF check failed: sdk['event_post_slot'] <= 32 and sdk['event_loop_context'] + 2 * 92 <= 256")
    require(sdk['netif_context'] + sdk['netif_lwip_context'] + 2 * sdk['netif_ip_info'] < 4096, "Allocation model/config/ELF check failed: sdk['netif_context'] + sdk['netif_lwip_context'] + 2 * sdk['netif_ip_info'] < 4096")
    root = Path(__file__).resolve().parents[1]
    control_src = (root / 'components/sailball_control/src/control.c').read_text()
    control_hdr = (root / 'components/sailball_control/include/sailball/control_sources.h').read_text()
    require('s_terminal_q_data[SB_CONTROL_ACTIVE_TX_QUEUES]' in control_src and
            's_misc_q_data[SB_CONTROL_ACTIVE_TX_QUEUES]' in control_src and
            'sizeof(misc_response_t)' in control_src,
            'Control terminal/misc response backing must cover active transports and use compact misc items')
    require('source<SB_CONTROL_ACTIVE_TX_QUEUES' in control_src, 'Control must not construct a Cellular response queue')
    require('sb_control_source_has_tx_queue(source)' in control_src and 'SB_SOURCE_CELLULAR == 3' in control_hdr, 'Reserved Cellular source must not accept frames; IDs remain fixed')
    for component, owner, entry in [('ble', 'sb_ble_init', 'nimble_port_init()'), ('wifi', 'wifi_ensure_driver', 'esp_netif_init()'), ('wifi', 'start_wifi_impl', 'esp_wifi_start()')]:
        body = function((root / 'components' / ('sailball_' + component) / 'src' / (component + '.c')).read_text(), owner)
        before = body[:body.index(entry)]
        require('sb_wireless_admit(' in before and 'admission.decision!=SB_ADMISSION_ALLOW' in before, "Allocation model/config/ELF check failed: 'sb_wireless_admit(' in before and 'admission.decision!=SB_ADMISSION_ALLOW' in before")
        denied = before[before.index('admission.decision!=SB_ADMISSION_ALLOW'):]
        require('return ESP_ERR_NO_MEM;' in denied or 'return false;' in denied, 'DENY lacks pre-entry return')
    budgets, symbols = ({}, {})
    with (build / 'sailball.elf').open('rb') as f:
        elf = ELFFile(f)
        for sym in elf.get_section_by_name('.symtab').iter_symbols():
            symbols[sym.name] = sym['st_value']
            if sym.name in ('s_ble_budget', 's_wifi_budget', 's_wifi_start_budget'):
                sec = elf.get_section(sym['st_shndx'])
                offset = sym['st_value'] - sec['sh_addr']
                b = dict(zip(FIELDS, struct.unpack('<12I', sec.data()[offset:offset + 48])))
                require(b['future_internal'] >= b['future_dma'] and b['opaque_internal'] >= b['opaque_dma'], "Allocation model/config/ELF check failed: b['future_internal'] >= b['future_dma'] and b['opaque_internal'] >= b['opaque_dma']")
                require(b['critical_internal'] >= b['critical_dma'] and b['margin_internal'] >= b['margin_dma'], "Allocation model/config/ELF check failed: b['critical_internal'] >= b['critical_dma'] and b['margin_internal'] >= b['margin_dma']")
                require(b['largest_internal_alloc'] <= b['future_internal'] + b['opaque_internal'], "Allocation model/config/ELF check failed: b['largest_internal_alloc'] <= b['future_internal'] + b['opaque_internal']")
                require(b['largest_dma_alloc'] <= b['future_dma'] + b['opaque_dma'], "Allocation model/config/ELF check failed: b['largest_dma_alloc'] <= b['future_dma'] + b['opaque_dma']")
                budgets[sym.name] = dict(model=b, required=thresholds(b))
    require(len(budgets) == 3, 'Allocation model/config/ELF check failed: len(budgets) == 3')
    ble_known = npl + sdk['msys_1'] + sdk['msys_2'] + sdk['msys_context'] + sdk['hci_events'] + sdk['hci_commands'] + sdk['hci_acl'] + sdk['hci_context'] + 4352 + int(config['CONFIG_BT_NIMBLE_HOST_TASK_STACK_SIZE']) + sdk['tcb'] + 4040 + sdk['controller_stack'] + sdk['tcb']
    require(budgets['s_ble_budget']['model']['future_internal'] == ble_known, "Allocation model/config/ELF check failed: budgets['s_ble_budget']['model']['future_internal'] == ble_known")
    require(budgets['s_ble_budget']['model']['future_dma'] == 4040, "Allocation model/config/ELF check failed: budgets['s_ble_budget']['model']['future_dma'] == 4040")
    cold_dma = int(config['CONFIG_ESP_WIFI_STATIC_RX_BUFFER_NUM']) * 1664 + int(config['CONFIG_ESP_WIFI_RX_MGMT_BUF_NUM_DEF']) * 576
    cold_internal = 4096 + sdk['tcpip_task_stack'] + 112 + int(config['CONFIG_LWIP_TCPIP_RECVMBOX_SIZE']) * 4 + 92 + sdk['event_task_stack'] + 112 + int(config['CONFIG_ESP_SYSTEM_EVENT_QUEUE_SIZE']) * 32 + 256 + cold_dma
    rf_dma = (int(config['CONFIG_ESP_WIFI_DYNAMIC_RX_BUFFER_NUM']) + int(config['CONFIG_ESP_WIFI_DYNAMIC_TX_BUFFER_NUM'])) * 1664
    rf_internal = rf_dma + int(config['CONFIG_LWIP_TCP_SND_BUF_DEFAULT']) + int(config['CONFIG_LWIP_TCP_WND_DEFAULT'])
    require(budgets['s_wifi_budget']['model']['future_internal'] == cold_internal, "Allocation model/config/ELF check failed: budgets['s_wifi_budget']['model']['future_internal'] == cold_internal")
    require(budgets['s_wifi_budget']['model']['future_dma'] == cold_dma, "Allocation model/config/ELF check failed: budgets['s_wifi_budget']['model']['future_dma'] == cold_dma")
    require(budgets['s_wifi_start_budget']['model']['future_internal'] == rf_internal, 'Stale/unbudgeted RF working set')
    require(budgets['s_wifi_start_budget']['model']['future_dma'] == rf_dma, "Allocation model/config/ELF check failed: budgets['s_wifi_start_budget']['model']['future_dma'] == rf_dma")
    # Optimistic address ceilings, including startup-reserved DRAM. The ROM
    # layout table reserves more at runtime. These are NOT available heap.
    main_raw = 0x3FCE0000 - symbols['_heap_start']
    rtc_raw = 8192 - (symbols['_rtc_force_slow_end'] - 0x50000000) - (symbols.get('_rtc_reserved_end', 0) - symbols.get('_rtc_reserved_start', 0))
    internal_raw = main_raw + rtc_raw
    initial_largest = max(0, 0x3FCDC710 - symbols['_heap_start'])
    for b in budgets.values():
        b['standalone_optimistic_reachable'] = reachable(b['required'], internal_raw, main_raw, initial_largest)
    # These tasks exist before sb_system_start admission; their dynamic heap
    # allocations are absent from the optimistic free tail after startup.
    require(config.get('CONFIG_FREERTOS_USE_TIMERS') == 'y', 'Review startup baseline when kernel timers change')
    startup_min = sum(sdk[k] for k in ('startup_main_stack', 'startup_esp_timer_stack',
        'startup_idle_stack', 'startup_freertos_timer_stack')) + 4 * sdk['tcb']
    # Only definitely resident objects; omit private controller, host contexts
    # and most kernel objects. Give the coexistence condition every benefit.
    ble_min = sum(sdk[k] for k in (
        'npl_functions', 'npl_context', 'npl_eventq_pool', 'npl_callout_pool',
        'npl_sem_mutex_pools', 'msys_1', 'msys_2', 'msys_context',
        'hci_events', 'hci_commands', 'hci_acl', 'hci_context'))
    ble_min += int(config['CONFIG_BT_NIMBLE_HOST_TASK_STACK_SIZE']) + sdk['tcb']
    ble_min += 4040 + sdk['controller_stack'] + sdk['tcb']
    ble_boot = stage_reachable(budgets['s_ble_budget']['required']['internal_free'], internal_raw, startup_min)
    wifi_coexist = stage_reachable(budgets['s_wifi_budget']['required']['internal_free'], internal_raw, startup_min + ble_min)
    # RF follows BLE and the cold Wi-Fi allocations. This subtracts only the
    # visible configured cold allocations, excluding the cold opaque allowance,
    # so the result remains deliberately optimistic.
    wifi_public_min = sdk['tcpip_task_stack'] + sdk['tcb']
    wifi_public_min += sdk['tcpip_mailbox_context'] + int(config['CONFIG_LWIP_TCPIP_RECVMBOX_SIZE']) * 4
    wifi_public_min += sdk['event_task_stack'] + sdk['tcb']
    wifi_public_min += sdk['event_loop_context'] + 2 * sdk['queue']
    wifi_public_min += int(config['CONFIG_ESP_SYSTEM_EVENT_QUEUE_SIZE']) * sdk['event_post_slot']
    wifi_public_min += sdk['netif_context'] + sdk['netif_lwip_context'] + 2 * sdk['netif_ip_info']
    wifi_cold_known = budgets['s_wifi_budget']['model']['future_internal']
    rf_coexist = stage_reachable(budgets['s_wifi_start_budget']['required']['internal_free'], internal_raw, startup_min + ble_min, wifi_cold_known)
    failures = []
    for name in ('s_ble_budget', 's_wifi_budget'):
        if not budgets[name]['standalone_optimistic_reachable']:
            failures.append(name + ': threshold exceeds optimistic capability ceiling')
    if not ble_boot:
        failures.append('BLE boot admission exceeds the optimistic heap after mandatory SDK startup tasks')
    if not wifi_coexist:
        failures.append('Wi-Fi cold admission unreachable even with optimistic heap after minimum persistent BLE allocations')
    if not rf_coexist:
        failures.append('Wi-Fi RF admission unreachable after minimum persistent BLE and public network infrastructure')
    result = dict(elf_sha256=hashlib.sha256((build / 'sailball.elf').read_bytes()).hexdigest(), sdkconfig_sha256=hashlib.sha256(config_path.read_bytes()).hexdigest(), sdk_sizes=sdk, npl_capacity_envelope=npl, host_probe_sum=host, raw_main_dma_ceiling=main_raw, raw_internal_ceiling=internal_raw, raw_initial_largest=initial_largest, startup_task_minimum_persistent=startup_min, optimistic_pre_ble_boot_internal_ceiling=internal_raw - startup_min, ble_boot_reachable=ble_boot, ble_minimum_persistent=ble_min, optimistic_post_ble_internal_ceiling=internal_raw - startup_min - ble_min, wifi_cold_after_ble_reachable=wifi_coexist, wifi_public_minimum_persistent=wifi_public_min, optimistic_post_ble_wifi_public_internal_ceiling=internal_raw - startup_min - ble_min - wifi_public_min, wifi_cold_known_internal=wifi_cold_known, wifi_rf_after_ble_cold_reachable=rf_coexist, optimistic_post_ble_wifi_cold_internal_ceiling=internal_raw - startup_min - ble_min - wifi_cold_known, budgets=budgets, gate_failures=failures, limitation='ROM-layout reservations, allocator metadata, remaining application startup allocations and runtime heap changes lower raw ceilings. Private SDK allowances are estimates, not certified upper bounds. Hardware measurements pending.')
    (build / 'h10-budget-report.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    if failures and not phase_b:
        require(False, '; '.join(failures))
    if phase_b:
        print('PASS H10-S admission/configuration safety checks; H10-F reachability remains PENDING: ' +
              ('; '.join(failures) if failures else 'no static reachability failure found'))
    else:
        print('PASS necessary H10 capability/reachability gate (not hardware certification)')
if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('build', type=Path)
    p.add_argument('sdkconfig', type=Path)
    p.add_argument('--phase-b', action='store_true',
                   help='enforce H10-S safety/configuration while reporting H10-F reachability as pending')
    a = p.parse_args()
    try:
        check(a.build.resolve(), a.sdkconfig, phase_b=a.phase_b)
    except ValueError as error:
        print('FAIL H10 admission acceptance: ' + str(error))
        raise SystemExit(1)
