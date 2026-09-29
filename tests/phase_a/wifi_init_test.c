#include <assert.h>
#include <stdio.h>
#include <stdbool.h>
#include <string.h>
#include "sailball/wifi.h"
#include "sailball/startup_metrics.h"
#include "freertos/FreeRTOS.h"
#include "freertos/portmacro.h"
#include "wireless_model_config.inc"
#include "sailball/wireless_budget_model.h"
#include "../../components/sailball_common/src/wireless_admission.c"
#define WIFI_COMMAND_DEPTH 8
#define WIFI_EVENT_DEPTH 12
#define WIFI_RX_QUEUE_DEPTH 4
#define WIFI_TX_QUEUE_DEPTH 2
#define WIFI_STORAGE_RAM 0
#define WIFI_MODE_STA 0
#define WIFI_EVENT 1
#define IP_EVENT 2
#define ESP_EVENT_ANY_ID -1
#define NVS_READONLY 0
typedef int wifi_command_t;
typedef int wifi_event_item_t;
typedef int wifi_frame_item_t;
typedef struct { uint32_t magic;uint8_t ssid_length,password_length,ssid[32],password[64]; } wifi_profile_t;
typedef int esp_netif_t;
typedef int esp_netif_config_t;
typedef int wifi_init_config_t;
typedef int nvs_handle_t;
#define ESP_NETIF_DEFAULT_WIFI_STA() 0
#define WIFI_INIT_CONFIG_DEFAULT() 0
static QueueHandle_t s_command_queue,s_event_queue,s_rx_queue,s_tx_queue;
static uint8_t s_command_queue_storage[32],s_event_queue_storage[48],s_rx_queue_storage[16],s_tx_queue_storage[8];
static StaticQueue_t s_command_queue_struct,s_event_queue_struct,s_rx_queue_struct,s_tx_queue_struct;
static portMUX_TYPE s_mux;
static bool s_started,s_initializing,expect_initializing;
static bool s_driver_ready,s_driver_init_attempted,s_wifi_started,s_wireless_unavailable,deny_admission;
static sb_wifi_snapshot_t s_snapshot;
static wifi_profile_t s_profile;
static esp_netif_t *s_netif;
static int fail_at,step,errors,driver_cleanup,netif_cleanup,wifi_unregister,ip_unregister;
static unsigned netif_calls,driver_calls,start_calls,resource_errors,admissions;
static bool fail_start;
static bool s_ap_connected,s_user_disconnect,s_scan_active;
static void close_socket(void){}
static void mark_session_ended(void){}
static esp_err_t esp_wifi_disconnect(void){return ESP_OK;}
static esp_err_t esp_wifi_stop(void){return ESP_OK;}
static int result(void){return ++step==fail_at?ESP_ERR_NO_MEM:ESP_OK;}
static QueueHandle_t xQueueCreateStatic(unsigned a,unsigned b,uint8_t *c,StaticQueue_t *d)
{(void)a;(void)b;(void)c;return result()?NULL:d;}
static esp_err_t esp_netif_init(void){if(expect_initializing)assert(s_initializing);netif_calls++;return result();}
static esp_err_t esp_event_loop_create_default(void){return result();}
static esp_netif_t *esp_netif_new(esp_netif_config_t *x){(void)x;static int netif;return result()?NULL:&netif;}
static esp_err_t esp_netif_attach_wifi_station(esp_netif_t *x){(void)x;return result();}
static esp_err_t esp_wifi_set_default_wifi_sta_handlers(void){return result();}
static esp_err_t esp_wifi_init(wifi_init_config_t *x){(void)x;driver_calls++;return result();}
static esp_err_t esp_wifi_start(void){if(expect_initializing)assert(s_initializing);start_calls++;return fail_start?ESP_ERR_NO_MEM:ESP_OK;}
static esp_err_t esp_wifi_set_storage(int x){(void)x;return result();}
static esp_err_t esp_wifi_set_mode(int x){(void)x;return result();}
static void wifi_event_handler(void *a,int b,int c,void *d){(void)a;(void)b;(void)c;(void)d;}
static esp_err_t esp_event_handler_register(int a,int b,void (*fn)(void*,int,int,void*),void *d)
{(void)a;(void)b;(void)fn;(void)d;return result();}
static esp_err_t esp_event_handler_unregister(int a,int b,void (*fn)(void*,int,int,void*))
{(void)b;(void)fn;if(a==WIFI_EVENT)wifi_unregister++;else ip_unregister++;return ESP_OK;}
static esp_err_t esp_wifi_deinit(void){driver_cleanup++;return ESP_OK;}
static esp_err_t esp_wifi_clear_default_wifi_driver_and_handlers(esp_netif_t *x){(void)x;return ESP_OK;}
static void esp_netif_destroy(esp_netif_t *x){assert(x);netif_cleanup++;}
static esp_err_t nvs_open(const char *name,int mode,nvs_handle_t *out){(void)name;(void)mode;(void)out;return ESP_FAIL;}
static esp_err_t nvs_get_blob(nvs_handle_t handle,const char *name,void *data,size_t *length)
{(void)handle;(void)name;(void)data;(void)length;return ESP_FAIL;}
static void nvs_close(nvs_handle_t x){(void)x;}
static void wifi_set_state(sb_wifi_state_t state){s_snapshot.state=state;}
sb_wifi_state_t sb_wifi_get_state(void){return s_snapshot.state;}
void sb_startup_note_failure(uint16_t service,esp_err_t err){assert(service==6&&err!=ESP_OK);errors++;}
sb_wireless_admission_t sb_wireless_admit(sb_wireless_kind_t kind)
{assert(kind==SB_WIRELESS_WIFI||kind==SB_WIRELESS_WIFI_START);admissions++;
 const sb_wireless_budget_t cold=SB_WIFI_COLD_BUDGET_INIT,rf=SB_WIFI_RF_BUDGET_INIT;
 sb_wireless_heap_t heap=deny_admission?(sb_wireless_heap_t){0}:(sb_wireless_heap_t){100000,0,40000,90000,0,30000};
 sb_wireless_admission_t out;sb_wireless_admission_decide(&heap,kind==SB_WIRELESS_WIFI?&cold:&rf,&out);return out;}
sb_wireless_heap_t sb_wireless_measure_heap(void){return (sb_wireless_heap_t){0};}
void sb_validation_note_admission(sb_wireless_kind_t kind,const sb_wireless_admission_t *report)
{assert((kind==SB_WIRELESS_WIFI||kind==SB_WIRELESS_WIFI_START)&&report);}
void sb_validation_note_admission_after(sb_wireless_kind_t kind)
{assert(kind==SB_WIRELESS_WIFI||kind==SB_WIRELESS_WIFI_START);}
void sb_startup_note_resource_failure(sb_wireless_kind_t kind)
{assert(kind==SB_WIRELESS_WIFI||kind==SB_WIRELESS_WIFI_START);resource_errors++;}
#include "wifi_init.inc"
int main(void)
{
    for(fail_at=0;fail_at<=14;++fail_at){
        step=errors=driver_cleanup=netif_cleanup=wifi_unregister=ip_unregister=0;s_started=false;s_initializing=false;s_netif=NULL;
        memset(&s_snapshot,0,sizeof(s_snapshot));s_driver_ready=s_driver_init_attempted=s_wireless_unavailable=false;
        netif_calls=driver_calls=admissions=0;
        esp_err_t r=sb_wifi_init();
        /* Boot always performs zero heavy SDK calls, including success. */
        assert(netif_calls==0&&driver_calls==0&&admissions==0);
        if(fail_at==0||fail_at>4){assert(r==ESP_OK&&s_started&&step==4&&s_snapshot.state==SB_WIFI_OFF);
            r=wifi_ensure_driver();}
        if(!fail_at){assert(r==ESP_OK&&s_driver_ready&&step==14&&!errors);
            int prior=step;assert(wifi_ensure_driver()==ESP_OK&&step==prior&&netif_calls==1&&admissions==1);}
        else{assert(r!=ESP_OK&&s_started==(fail_at>4)&&s_snapshot.state==SB_WIFI_ERROR&&errors==1&&!s_netif);
            assert(driver_cleanup==(fail_at>10));assert(netif_cleanup==(fail_at>7));
            assert(wifi_unregister==(fail_at>13));assert(!ip_unregister);
            int prior=step;assert((fail_at<=4?sb_wifi_init():wifi_ensure_driver())==ESP_ERR_INVALID_STATE&&step==prior);}
    }
    fail_at=0;step=errors=0;s_started=false;s_initializing=false;s_driver_ready=s_driver_init_attempted=s_wireless_unavailable=s_wifi_started=false;
    memset(&s_snapshot,0,sizeof(s_snapshot));s_netif=NULL;deny_admission=true;
    expect_initializing=true;
    netif_calls=driver_calls=start_calls=resource_errors=0;
    assert(sb_wifi_init()==ESP_OK&&s_snapshot.state==SB_WIFI_OFF);
    assert(!start_wifi()&&s_snapshot.state==SB_WIFI_ERROR&&resource_errors==1&&!s_initializing);
    assert(netif_calls==0&&driver_calls==0&&start_calls==0);
    assert(!start_wifi()&&netif_calls==0&&resource_errors==1);
    finish_user_disconnect();assert(s_snapshot.state==SB_WIFI_OFF);
    assert(!start_wifi()&&s_snapshot.state==SB_WIFI_ERROR&&netif_calls==0&&resource_errors==1);
    deny_admission=false;s_driver_init_attempted=s_wireless_unavailable=false;
    assert(start_wifi()&&netif_calls==1&&driver_calls==1&&start_calls==1&&!s_initializing);
    s_wifi_started=false;deny_admission=true;
    assert(!start_wifi()&&start_calls==1&&netif_calls==1&&resource_errors==2);
    assert(!start_wifi()&&start_calls==1&&resource_errors==2);
    deny_admission=false;s_wireless_unavailable=false;fail_start=true;
    assert(!start_wifi()&&s_snapshot.state==SB_WIFI_ERROR&&s_wireless_unavailable&&errors==1&&!s_initializing);
    assert(start_calls==2&&netif_calls==1);
    assert(!start_wifi()&&start_calls==2&&errors==1);
    finish_user_disconnect();assert(s_snapshot.state==SB_WIFI_OFF);
    assert(!start_wifi()&&s_snapshot.state==SB_WIFI_ERROR&&start_calls==2&&errors==1);
    puts("PASS production Wi-Fi init: 14 failure points, ERROR, partial cleanup, no retry storm");
    puts("PASS Wi-Fi admission ALLOW: production helper/current cold and RF budgets, one netif/driver/RF entry");
    puts("PASS Wi-Fi lazy boot, initial DENY (zero netif/driver calls), one-time init, restart DENY (zero RF calls)");
    puts("PASS Wi-Fi RF start returned OOM: ERROR, one diagnostic, no repeated SDK start");return 0;
}
