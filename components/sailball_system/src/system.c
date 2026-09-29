#include "sailball/system.h"
#include "sailball/board.h"
#include "sailball/gnss.h"
#include "sailball/storage.h"
#include "sailball/recorder.h"
#include "sailball/supervisor.h"
#include "sailball/transfer.h"
#include "sailball/control.h"
#include "sailball/usb.h"
#include "sailball/ble.h"
#include "sailball/wifi.h"
#include "sailball/ui.h"
#include "sailball/startup_metrics.h"
#include "esp_err.h"
#include "nvs_flash.h"
#include <stdlib.h>

static void require_started(esp_err_t err)
{
    if(err!=ESP_OK) abort();
}

static void ui_status_snapshot(sb_ui_status_t *out)
{
    if(!out)return;
    sb_gnss_state_t gnss_state;sb_gnss_get_snapshot(NULL,&gnss_state,NULL,NULL);
    out->critical_path_healthy=sb_supervisor_critical_healthy();
    out->gnss_available=gnss_state==SB_GNSS_RUNNING;
    out->storage_ready=sb_storage_get_state()==SB_STORAGE_READY;
    out->usb_connected=sb_control_get_usb_connected();
    out->ble_connected=sb_ble_get_state()==SB_BLE_CONNECTED;
    out->wifi_online=sb_wifi_is_online();
}

void sb_system_start(void)
{
    require_started(sb_board_init());
    /* NVS problems disable saved network settings but do not stop recording boot. */
    (void)nvs_flash_init();
    sb_validation_note_startup(SB_STARTUP_CORE,ESP_OK);
    require_started(sb_gnss_start());
    require_started(sb_storage_start());
    require_started(sb_recorder_start());
    require_started(sb_supervisor_start());
    require_started(sb_transfer_start());
    require_started(sb_control_start());
    sb_supervisor_set_shutdown_hook(sb_control_begin_shutdown);
    sb_control_set_reboot_handler(sb_supervisor_request_reboot);
    require_started(sb_transport_start());
    sb_ui_set_status_provider(ui_status_snapshot);
    esp_err_t ui_result=sb_ui_start();
    sb_startup_note_failure(9,ui_result);
    sb_validation_note_startup(SB_STARTUP_TASKS,ui_result);
    /* All recording owners are alive before optional radio allocations. */
    esp_err_t ble_result=sb_ble_init();
    sb_validation_note_startup(SB_STARTUP_BLE,ble_result);
    /* Logical OFF setup only. Transport admits netif/lwIP/driver resources
     * on the first SCAN/CONNECT; saved credentials never start RF at boot. */
    esp_err_t wifi_result=sb_wifi_init();
    sb_validation_note_startup(SB_STARTUP_WIFI,wifi_result);
}
