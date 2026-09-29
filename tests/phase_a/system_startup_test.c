#include <assert.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include "sailball/startup_metrics.h"
static int started, ble_fail, wifi_fail, phases, ui_fail, failures;
static esp_err_t task_start(void){started++;return ESP_OK;}
static esp_err_t sb_board_init(void){return ESP_OK;}
static esp_err_t nvs_flash_init(void){return ESP_OK;}
#define sb_gnss_start task_start
#define sb_storage_start task_start
#define sb_recorder_start task_start
#define sb_supervisor_start task_start
#define sb_transfer_start task_start
#define sb_control_start task_start
#define sb_transport_start task_start
static esp_err_t sb_ui_start(void){if(ui_fail)return ESP_ERR_NO_MEM;return task_start();}
static void sb_control_begin_shutdown(void){}
static void sb_supervisor_request_reboot(void){}
static void ui_status_snapshot(void){}
static void sb_supervisor_set_shutdown_hook(void (*fn)(void)){(void)fn;}
static void sb_control_set_reboot_handler(void (*fn)(void)){(void)fn;}
static void sb_ui_set_status_provider(void (*fn)(void)){(void)fn;}
static esp_err_t sb_ble_init(void){assert(started==(ui_fail?7:8));return ble_fail?ESP_ERR_NO_MEM:ESP_OK;}
static esp_err_t sb_wifi_init(void){assert(started==(ui_fail?7:8));return wifi_fail?ESP_ERR_NO_MEM:ESP_OK;}
void sb_startup_note_failure(uint16_t service,esp_err_t err){assert(service==9);if(err!=ESP_OK)failures++;}
void sb_validation_note_startup(sb_startup_phase_t phase,esp_err_t result)
{assert((int)phase==phases);if(phase==SB_STARTUP_BLE)assert(result==(ble_fail?ESP_ERR_NO_MEM:ESP_OK));
 if(phase==SB_STARTUP_WIFI)assert(result==(wifi_fail?ESP_ERR_NO_MEM:ESP_OK));phases++;}
#include "system_init.inc"
int main(void)
{
    for(ble_fail=0;ble_fail<2;++ble_fail)for(wifi_fail=0;wifi_fail<2;++wifi_fail)for(ui_fail=0;ui_fail<2;++ui_fail){
        started=phases=failures=0;sb_system_start();assert(started==(ui_fail?7:8)&&phases==4&&failures==ui_fail);
    }
    puts("PASS production startup: 8 BLE/Wi-Fi/UI combinations, critical tasks start, no abort");return 0;
}
