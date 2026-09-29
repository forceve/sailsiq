"""Compile isolated sizing probes with a profile's actual C3 compiler flags.

SDK translation units are included in probes under build/, never edited or
linked into firmware. Numbers are configuration/static ABI measurements,
not runtime allocation traces or a bound on closed controller/driver code.
"""
import argparse
import json
import struct
import subprocess
from pathlib import Path
from elftools.elf.elffile import ELFFile

PROBES = {
    'npl_os_freertos.c': {
        'npl_functions': 'sizeof(struct npl_funcs_t)',
        'npl_context': 'sizeof(ble_freertos_ctx_t)',
        'npl_event_count': 'BLE_TOTAL_EV_COUNT',
        'npl_event_pool': 'OS_MEMPOOL_BYTES(BLE_TOTAL_EV_COUNT, sizeof(struct ble_npl_event_freertos))',
        'npl_embedded_event_backing': 'sizeof(((ble_freertos_ctx_t *)0)->ev_buf)',
        'npl_eventq_pool': 'OS_MEMPOOL_BYTES(BLE_TOTAL_EVQ_COUNT, sizeof(struct ble_npl_eventq_freertos))',
        'npl_callout_pool': 'OS_MEMPOOL_BYTES(BLE_TOTAL_CO_COUNT, sizeof(struct ble_npl_callout_freertos))',
        'npl_sem_mutex_pools': 'OS_MEMPOOL_BYTES(BLE_TOTAL_SEM_COUNT, sizeof(struct ble_npl_sem_freertos)) + OS_MEMPOOL_BYTES(BLE_TOTAL_MUTEX_COUNT, sizeof(struct ble_npl_mutex_freertos))',
        'npl_all_event_queues': 'BLE_TOTAL_EVQ_COUNT * (sizeof(StaticQueue_t) + BLE_TOTAL_EV_COUNT * sizeof(void *))',
        'npl_all_sem_mutexes': '(BLE_TOTAL_SEM_COUNT + BLE_TOTAL_MUTEX_COUNT) * sizeof(StaticQueue_t)',
        'npl_timer_count': 'BLE_TOTAL_CO_COUNT',
        'tcb': 'sizeof(StaticTask_t)',
        'queue': 'sizeof(StaticQueue_t)',
    },
    'transport.c': {
        'hci_events': 'OS_MEMPOOL_BYTES(POOL_EVT_COUNT + POOL_EVT_LO_COUNT, POOL_EVT_SIZE)',
        'hci_commands': 'OS_MEMPOOL_BYTES(POOL_CMD_COUNT, POOL_CMD_SIZE)',
        'hci_acl': 'OS_MEMPOOL_BYTES(POOL_ACL_COUNT, POOL_ACL_SIZE)',
        'hci_context': 'sizeof(ble_trans_ctx_t)',
    },
    'os_msys_init.c': {
        'msys_1': 'SYSINIT_MSYS_1_MEMPOOL_SIZE * sizeof(os_membuf_t)',
        'msys_2': 'SYSINIT_MSYS_2_MEMPOOL_SIZE * sizeof(os_membuf_t)',
        'msys_context': 'sizeof(os_msys_ctx_t)',
    },
    'vfs_fat.c': {
        'fat_fil': 'sizeof(FIL)',
        'fat_context': 'sizeof(vfs_fat_ctx_t)',
        'fat_six_file_mount': 'sizeof(vfs_fat_ctx_t) + 6 * sizeof(FIL) + 6 * sizeof(uint32_t)',
        'fat_six_file_cache_envelope': 'sizeof(vfs_fat_ctx_t) + 6 * sizeof(FIL) + 6 * sizeof(uint32_t) + 7 * FF_MAX_SS',
        'fat_sd_six_file_cache_envelope': 'sizeof(vfs_fat_ctx_t) + 6 * sizeof(FIL) + 6 * sizeof(uint32_t) + 7 * 512',
    },
    'ble_hs.c': {
        'host_context': 'sizeof(*ble_hs_ctx)',
        'host_state': 'sizeof(*ble_hs_state_ctx)',
        'host_hci_events': 'OS_MEMPOOL_BYTES(BLE_HS_HCI_EVT_COUNT, sizeof(struct ble_npl_event))',
    },
    'ble_hs_conn.c': {
        'host_connection_context': 'sizeof(*ble_hs_conn_ctx)',
        'host_connection_pool': 'OS_MEMPOOL_BYTES(MYNEWT_VAL(BLE_MAX_CONNECTIONS), sizeof(struct ble_hs_conn))',
    },
    'ble_l2cap.c': {
        'host_l2cap_context': 'sizeof(*ble_l2cap_ctx)',
        'host_l2cap_pool': 'OS_MEMPOOL_BYTES(MYNEWT_VAL(BLE_L2CAP_MAX_CHANS), sizeof(struct ble_l2cap_chan))',
    },
    'ble_gap.c': {
        'host_gap_context': 'sizeof(ble_gap_vars_t)',
        'host_gap_updates': 'OS_MEMPOOL_BYTES(MYNEWT_VAL(BLE_GAP_MAX_PENDING_CONN_PARAM_UPDATE), sizeof(struct ble_gap_update_entry))',
    },
    'ble_gattc.c': {
        'host_gattc_context': 'sizeof(*ble_gattc_ctx)',
        'host_gattc_pool': 'OS_MEMPOOL_BYTES(MYNEWT_VAL(BLE_GATT_MAX_PROCS), sizeof(struct ble_gattc_proc))',
        'host_gattc_dispatch': '3 * BLE_GATT_OP_CNT * sizeof(void *)',
    },
    'ble_att_svr.c': {
        'host_att_prepared': 'OS_MEMPOOL_BYTES(MYNEWT_VAL(BLE_ATT_SVR_MAX_PREP_ENTRIES), sizeof(struct ble_att_prep_entry))',
        'host_att_context': 'sizeof(*ble_att_svr_ctx)',
        'host_att_entry': 'sizeof(struct ble_att_svr_entry)',
    },
    'ble_gatts.c': {
        'host_gatts_context': 'sizeof(*ble_gatts_static_vars)',
        'host_gatts_service': 'sizeof(struct ble_gatts_svc_entry)',
        'host_gatts_cccd': 'sizeof(struct ble_gatts_clt_cfg)',
    },
    'ble_hs_hci.c': {
        'host_hci_context': 'sizeof(*ble_hs_hci_ctx)',
        'host_hci_fragments': 'BLE_HS_HCI_FRAG_MEMPOOL_SIZE * sizeof(os_membuf_t)',
    },
    'ble_hs_id.c': {'host_identity': 'sizeof(*ble_hs_id_ctx)'},
    'ble_hs_pvcy.c': {'host_privacy': 'sizeof(*ble_hs_pvcy_ctx)'},
    'ble_hs_stop.c': {'host_stop': 'sizeof(*ble_hs_stop_ctx)'},
    'ble_svc_gap.c': {'host_gap_service': 'sizeof(*ble_hs_gap_svc_ctx)'},
    'ble_sm.c': {
        'host_sm_context': 'sizeof(*ble_sm_ctx)',
        'host_sm_pool': 'OS_MEMPOOL_BYTES(MYNEWT_VAL(BLE_SM_MAX_PROCS), sizeof(struct ble_sm_proc))',
        'host_sm_dispatch': 'BLE_SM_PROC_STATE_CNT * sizeof(void *)',
    },
    'bt.c': {
        'controller_osi': 'sizeof(struct osi_funcs_t)',
        'controller_stack': 'ESP_TASK_BT_CONTROLLER_STACK',
    },
    'esp_timer.c': {
        'esp_timer_object': 'sizeof(struct esp_timer)',
        'startup_esp_timer_stack': 'ESP_TASK_TIMER_STACK',
    },
    'app_startup.c': {'startup_main_stack': 'ESP_TASK_MAIN_STACK'},
    'port_common.c': {
        'startup_idle_stack': 'configMINIMAL_STACK_SIZE',
        'startup_freertos_timer_stack': 'configTIMER_TASK_STACK_DEPTH',
    },
    'default_event_loop.c': {'event_task_stack': 'ESP_TASKD_EVENT_STACK'},
    'esp_event.c': {
        'event_loop_context': 'sizeof(esp_event_loop_instance_t)',
        'event_post_slot': 'sizeof(esp_event_post_instance_t)',
    },
    'esp_netif_lwip.c': {
        'netif_context': 'sizeof(struct esp_netif_obj)',
        'netif_lwip_context': 'sizeof(struct netif)',
        'netif_ip_info': 'sizeof(esp_netif_ip_info_t)',
    },
    'sys_arch.c': {
        'tcpip_mailbox_context': 'sizeof(struct sys_mbox_s)',
        'tcpip_task_stack': 'TCPIP_THREAD_STACKSIZE',
    },
}


def measure(build):
    commands = json.loads((build / 'compile_commands.json').read_text())
    out = build / 'h10-sizing'
    out.mkdir(exist_ok=True)
    result = {}
    for source_name, expressions in PROBES.items():
        row = next(r for r in commands if r['file'].replace('\\', '/').endswith('/' + source_name))
        source, obj = out / (source_name + '.probe.c'), out / (source_name + '.probe.o')
        body = '#include "' + Path(row['file']).as_posix() + '"\n'
        body += '\n'.join('const unsigned sb_probe_' + k + ' = ' + v + ';' for k, v in expressions.items())
        source.write_text(body + '\n')
        # Windows Popen passes the original CMake command line without a shell.
        command = row['command'].rsplit(' -o ', 1)[0]
        command += ' -o "' + obj.as_posix() + '" -c "' + source.as_posix() + '"'
        subprocess.run(command, cwd=row['directory'], check=True, capture_output=True)
        with obj.open('rb') as stream:
            elf = ELFFile(stream)
            for sym in elf.get_section_by_name('.symtab').iter_symbols():
                if sym.name.startswith('sb_probe_'):
                    section = elf.get_section(sym['st_shndx'])
                    offset = sym['st_value'] - section['sh_addr']
                    result[sym.name[9:]] = struct.unpack('<I', section.data()[offset:offset + 4])[0]
    (out / 'sdk-sizes.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('build', type=Path)
    measure(parser.parse_args().build.resolve())
