#include <assert.h>
#include <stdio.h>
#include <stdbool.h>
#include "sailball/board.h"
#include "sailball/common.h"
#include "sailball/startup_metrics.h"
#include "freertos/FreeRTOS.h"
#include "freertos/portmacro.h"
#include "wireless_model_config.inc"
#include "sailball/wireless_budget_model.h"
#include "../../components/sailball_common/src/wireless_admission.c"
#define BLE_RX_QUEUE_DEPTH 4
#define BLE_TX_QUEUE_DEPTH 2
#define BLE_FRAGMENT_QUEUE_DEPTH 4
#define CONFIG_BT_NIMBLE_PINNED_TO_CORE 0
#define configMAX_PRIORITIES 25
typedef int ble_frame_item_t;
typedef struct { uint32_t generation; uint64_t received_us; uint16_t length; uint8_t value[514]; } ble_fragment_item_t;
static QueueHandle_t s_rx_queue,s_tx_queue,s_fragment_queue;
static uint8_t s_rx_queue_storage[16],s_tx_queue_storage[16],s_fragment_queue_storage[4*sizeof(ble_fragment_item_t)],s_device_name[32];
static StaticQueue_t s_rx_queue_struct,s_tx_queue_struct,s_fragment_queue_struct;
static bool s_started;
static sb_ble_state_t s_state;
static portMUX_TYPE s_mux;
static int s_services[1], fail_at, step, cleanup, errors;
static bool deny_admission;
static unsigned nimble_calls, resource_errors;
static struct { void (*reset_cb)(int); void (*sync_cb)(void); } ble_hs_cfg;
static void on_reset(int x){(void)x;}
static void on_sync(void){}
static void host_task(void *x){(void)x;}
static int result(void){return ++step==fail_at?ESP_ERR_NO_MEM:ESP_OK;}
static QueueHandle_t xQueueCreateStatic(unsigned a,unsigned b,uint8_t *c,StaticQueue_t *d)
{(void)a;(void)b;(void)c;return result()?NULL:d;}
static esp_err_t nimble_port_init(void){nimble_calls++;return result();}
static esp_err_t nimble_port_deinit(void){cleanup++;return ESP_OK;}
static void ble_svc_gap_init(void){}
static void ble_svc_gatt_init(void){}
static int ble_gatts_count_cfg(void *x){(void)x;return result();}
static int ble_gatts_add_svcs(void *x){(void)x;return result();}
static int ble_svc_gap_device_name_set(const char *x){(void)x;return result();}
static int xTaskCreatePinnedToCore(void (*fn)(void*),const char *name,unsigned size,void *arg,int priority,TaskHandle_t *task,int core)
{(void)fn;(void)name;(void)size;(void)arg;(void)priority;(void)task;(void)core;return result()?pdFALSE:pdPASS;}
void sb_board_get_info(sb_board_info_t *out){out->device_id=123;}
sb_ble_state_t sb_ble_get_state(void){return s_state;}
void sb_startup_note_failure(uint16_t service,esp_err_t error){assert(service==7&&error!=ESP_OK);errors++;}
sb_wireless_admission_t sb_wireless_admit(sb_wireless_kind_t kind)
{assert(kind==SB_WIRELESS_BLE);const sb_wireless_budget_t budget=SB_BLE_BUDGET_INIT;
 sb_wireless_heap_t heap=deny_admission?(sb_wireless_heap_t){0}:(sb_wireless_heap_t){100000,0,40000,90000,0,30000};
 sb_wireless_admission_t out;sb_wireless_admission_decide(&heap,&budget,&out);return out;}
sb_wireless_heap_t sb_wireless_measure_heap(void){return (sb_wireless_heap_t){0};}
void sb_validation_note_admission(sb_wireless_kind_t kind,const sb_wireless_admission_t *report)
{assert(kind==SB_WIRELESS_BLE&&report);}
void sb_validation_note_admission_after(sb_wireless_kind_t kind){assert(kind==SB_WIRELESS_BLE);}
void sb_startup_note_resource_failure(sb_wireless_kind_t kind){assert(kind==SB_WIRELESS_BLE);resource_errors++;}
#include "ble_init.inc"
int main(void)
{
    for(fail_at=0;fail_at<=8;++fail_at){
        step=cleanup=errors=0;nimble_calls=0;s_started=false;s_state=SB_BLE_OFF;
        esp_err_t r=sb_ble_init();
        if(!fail_at){assert(r==ESP_OK&&s_started&&step==8&&!errors&&nimble_calls==1);}
        else{assert(r!=ESP_OK&&!s_started&&s_state==SB_BLE_ERROR&&errors==1);
            assert(cleanup==(fail_at>=5));int prior=step;assert(sb_ble_init()==ESP_ERR_INVALID_STATE&&step==prior);}
    }
    deny_admission=true;s_started=false;s_state=SB_BLE_OFF;fail_at=0;step=nimble_calls=resource_errors=0;
    assert(sb_ble_init()==ESP_ERR_NO_MEM&&s_state==SB_BLE_ERROR&&!s_started);
    assert(nimble_calls==0&&resource_errors==1);
    assert(sb_ble_init()==ESP_ERR_INVALID_STATE&&nimble_calls==0&&resource_errors==1);
    puts("PASS production BLE init: 8 failure points, ERROR, cleanup, no retry storm");
    puts("PASS BLE admission ALLOW: production helper/current budget, one NimBLE entry, successful startup");
    puts("PASS BLE admission DENY: zero NimBLE entry calls, ERROR, one diagnostic, no retry");return 0;
}
