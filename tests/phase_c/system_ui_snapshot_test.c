#include <assert.h>
#include <stdio.h>
#include "../../components/sailball_system/src/system.c"

static bool s_health,s_usb,s_wifi;
static sb_gnss_state_t s_gnss;
static sb_storage_state_t s_storage;
static sb_ble_state_t s_ble;
void sb_gnss_get_snapshot(sb_gnss_fix_t *fix,sb_gnss_state_t *state,uint64_t *rx,uint64_t *last_fix)
{if(fix)*fix=(sb_gnss_fix_t){0};if(state)*state=s_gnss;if(rx)*rx=0;if(last_fix)*last_fix=0;}
bool sb_supervisor_critical_healthy(void){return s_health;}
sb_storage_state_t sb_storage_get_state(void){return s_storage;}
bool sb_control_get_usb_connected(void){return s_usb;}
sb_ble_state_t sb_ble_get_state(void){return s_ble;}
bool sb_wifi_is_online(void){return s_wifi;}
esp_err_t sb_board_init(void){return ESP_OK;}
void sb_board_get_info(sb_board_info_t *out){*out=(sb_board_info_t){0};}
esp_err_t nvs_flash_init(void){return ESP_OK;}
void sb_validation_note_startup(sb_startup_phase_t phase,esp_err_t result){(void)phase;(void)result;}
esp_err_t sb_gnss_start(void){return ESP_OK;}
esp_err_t sb_storage_start(void){return ESP_OK;}
esp_err_t sb_recorder_start(void){return ESP_OK;}
esp_err_t sb_supervisor_start(void){return ESP_OK;}
esp_err_t sb_transfer_start(void){return ESP_OK;}
esp_err_t sb_control_start(void){return ESP_OK;}
void sb_supervisor_set_shutdown_hook(sb_supervisor_shutdown_hook_t hook){(void)hook;}
void sb_supervisor_request_reboot(void){}
void sb_control_set_reboot_handler(sb_control_reboot_handler_t handler){(void)handler;}
void sb_control_begin_shutdown(void){}
esp_err_t sb_transport_start(void){return ESP_OK;}
void sb_ui_set_status_provider(sb_ui_status_provider_t provider){(void)provider;}
esp_err_t sb_ui_start(void){return ESP_OK;}
void sb_startup_note_failure(uint16_t service,esp_err_t result){(void)service;(void)result;}
esp_err_t sb_ble_init(void){return ESP_OK;}
esp_err_t sb_wifi_init(void){return ESP_OK;}

int main(void)
{
    sb_ui_status_t snapshot;
    s_health=true;s_gnss=SB_GNSS_RUNNING;s_storage=SB_STORAGE_READY;s_usb=true;s_ble=SB_BLE_CONNECTED;s_wifi=true;
    ui_status_snapshot(&snapshot);
    assert(snapshot.critical_path_healthy&&snapshot.gnss_available&&snapshot.storage_ready&&
           snapshot.usb_connected&&snapshot.ble_connected&&snapshot.wifi_online);
    s_health=false;s_gnss=SB_GNSS_ERROR;s_storage=SB_STORAGE_ERROR;s_usb=false;s_ble=SB_BLE_IDLE;s_wifi=false;
    ui_status_snapshot(&snapshot);
    assert(!snapshot.critical_path_healthy&&!snapshot.gnss_available&&!snapshot.storage_ready&&
           !snapshot.usb_connected&&!snapshot.ble_connected&&!snapshot.wifi_online);
    puts("PASS production System->UI cached snapshot composition reads owner snapshots only");
    return 0;
}
