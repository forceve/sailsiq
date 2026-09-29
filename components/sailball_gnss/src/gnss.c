#include "sailball/gnss.h"
#include "sailball/board.h"
#include "sailball/diagnostics.h"
#include "sailball/validation.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "freertos/portmacro.h"
#include "esp_err.h"
#include "esp_task_wdt.h"
#include "sdkconfig.h"
#include "driver/uart.h"
#include "gnss_backend.h"
#include <stdlib.h>
#include <string.h>

#define FIX_QUEUE_DEPTH 32u
#define GNSS_INPUT_QUEUE_DEPTH 8u
#define GNSS_COMMAND_QUEUE_DEPTH 4u
#define GNSS_STACK_WORDS 2048u

typedef enum { GNSS_CMD_RESTART = 1 } gnss_command_t;

static StaticQueue_t s_fix_queue_struct, s_input_queue_struct, s_command_queue_struct;
static uint8_t s_fix_queue_storage[FIX_QUEUE_DEPTH * sizeof(sb_gnss_fix_t)];
static uint8_t s_input_queue_storage[GNSS_INPUT_QUEUE_DEPTH * sizeof(sb_gnss_fix_t)];
static uint8_t s_command_queue_storage[GNSS_COMMAND_QUEUE_DEPTH * sizeof(gnss_command_t)];
static QueueHandle_t s_fix_queue, s_input_queue, s_command_queue;
static StaticTask_t s_task_struct;
static StackType_t s_stack[GNSS_STACK_WORDS];
static portMUX_TYPE s_mux = portMUX_INITIALIZER_UNLOCKED;
static sb_gnss_fix_t s_latest;
static sb_gnss_state_t s_state = SB_GNSS_OFF;
static uint64_t s_last_rx_us, s_last_fix_us;
static uint64_t s_pending_live_stream_drops;
static uint32_t s_next_sample_seq;
static uint32_t s_restart_generation;
static bool s_started;
static bool s_uart_ready;
static const sb_gnss_backend_t *s_backend;
static int s_uart_port=-1;
static sb_gnss_backend_state_t s_backend_state=SB_GNSS_BACKEND_CONFIGURING;
static const sb_gnss_runtime_config_t s_runtime_config={
    .runtime_baud=CONFIG_SAILBALL_GNSS_RUNTIME_BAUD,
    .update_rate_hz=CONFIG_SAILBALL_GNSS_UPDATE_RATE_HZ
};

static bool backend_uart_write(const uint8_t *data,size_t length,void *context)
{
    int port=(int)(intptr_t)context;
    return data!=NULL&&uart_write_bytes((uart_port_t)port,(const char *)data,length)==(int)length;
}

static bool backend_uart_set_baud(uint32_t baud,void *context)
{
    int port=(int)(intptr_t)context;
    return uart_set_baudrate((uart_port_t)port,(uint32_t)baud)==ESP_OK;
}

static void backend_uart_reset_rx(void *context)
{
    int port=(int)(intptr_t)context;
    (void)uart_flush_input((uart_port_t)port);
}

static bool normalized_fix_valid(const sb_gnss_fix_t *fix)
{
    if (fix->fix_type < SB_GNSS_FIX_NONE || fix->fix_type > SB_GNSS_FIX_UNKNOWN) return false;
    if (fix->position_valid && (fix->latitude_e7 < -900000000 || fix->latitude_e7 > 900000000 ||
                                fix->longitude_e7 < -1800000000 || fix->longitude_e7 > 1799999999)) return false;
    if (fix->course_valid && fix->course_centi_deg >= 36000u) return false;
    return true;
}

static void process_normalized_fix(sb_gnss_fix_t *fix)
{
    if (!normalized_fix_valid(fix)) {
        sb_diag_increment(SB_DIAG_GNSS, 3);
        return;
    }
    fix->mono_us = sb_monotonic_us();
    fix->sample_seq = s_next_sample_seq++;
    uint64_t now = fix->mono_us;
    portENTER_CRITICAL(&s_mux);
    s_latest = *fix;
    s_last_rx_us = now;
    if (fix->position_valid) s_last_fix_us = now;
    s_state = s_backend_state==SB_GNSS_BACKEND_READY?SB_GNSS_RUNNING:SB_GNSS_STARTING;
    portEXIT_CRITICAL(&s_mux);
    sb_diag_increment(SB_DIAG_GNSS, 1);
    if (fix->position_valid) sb_diag_increment(SB_DIAG_GNSS, 2);
    if (xQueueSend(s_fix_queue, fix, pdMS_TO_TICKS(5)) != pdTRUE) {
        sb_diag_increment(SB_DIAG_GNSS, 6); /* Internal fix-queue drop metric; public counters remain frozen. */
    }
}

static bool uart_open(const sb_board_info_t *board)
{
    if(!board->gnss_configured||s_backend==NULL||s_backend->initial_baud==NULL)return false;
    uart_port_t port=(uart_port_t)board->gnss_uart_port;
    uint32_t boot_baud=s_backend->initial_baud();
    uart_config_t config={.baud_rate=(int)boot_baud,.data_bits=UART_DATA_8_BITS,
        .parity=UART_PARITY_DISABLE,.stop_bits=UART_STOP_BITS_1,.flow_ctrl=UART_HW_FLOWCTRL_DISABLE,
        .source_clk=UART_SCLK_DEFAULT};
    esp_err_t err=uart_driver_install(port,2048,0,0,NULL,0);
    if(err!=ESP_OK)return false;
    err=uart_param_config(port,&config);
    if(err==ESP_OK)err=uart_set_pin(port,board->gnss_tx_gpio,board->gnss_rx_gpio,
                                    UART_PIN_NO_CHANGE,UART_PIN_NO_CHANGE);
    if(err!=ESP_OK){(void)uart_driver_delete(port);return false;}
    s_uart_port=(int)port;s_uart_ready=true;
    sb_gnss_backend_io_t io={.write=backend_uart_write,.set_baud=backend_uart_set_baud,
        .reset_rx=backend_uart_reset_rx,.context=(void *)(intptr_t)s_uart_port};
    s_backend->start(&s_runtime_config,&io,sb_monotonic_us());
    s_backend_state=SB_GNSS_BACKEND_CONFIGURING;
    return true;
}

static void uart_close(void)
{
    if(s_uart_ready){(void)uart_driver_delete((uart_port_t)s_uart_port);s_uart_ready=false;s_uart_port=-1;}
}

static void process_restart(const sb_board_info_t *board)
{
    portENTER_CRITICAL(&s_mux); s_state = SB_GNSS_RESTARTING; portEXIT_CRITICAL(&s_mux);
    portENTER_CRITICAL(&s_mux); ++s_restart_generation; portEXIT_CRITICAL(&s_mux);
    uart_close();
    bool ready=uart_open(board);
    portENTER_CRITICAL(&s_mux);
    s_state = ready ? SB_GNSS_STARTING : (board->gnss_configured ? SB_GNSS_ERROR : SB_GNSS_OFF);
    portEXIT_CRITICAL(&s_mux);
}

static bool emit_backend_fix(void *context,const sb_gnss_fix_t *input)
{
    (void)context;sb_gnss_fix_t fix=*input;process_normalized_fix(&fix);return true;
}

static void gnss_owner_initialize(const sb_board_info_t *board)
{
    if (esp_task_wdt_add(NULL) != ESP_OK) abort();
    s_backend=sb_gnss_atgm336h_backend();
    bool uart_ok=uart_open(board);
    portENTER_CRITICAL(&s_mux);s_state=uart_ok?SB_GNSS_STARTING:(board->gnss_configured?SB_GNSS_ERROR:SB_GNSS_OFF);portEXIT_CRITICAL(&s_mux);
}

static void gnss_owner_step(const sb_board_info_t *board)
{
        uint64_t live_drops=0;
        portENTER_CRITICAL(&s_mux);live_drops=s_pending_live_stream_drops;s_pending_live_stream_drops=0;portEXIT_CRITICAL(&s_mux);
        if(live_drops)sb_diag_add(SB_DIAG_GNSS,5,live_drops);
        gnss_command_t command;
        while (xQueueReceive(s_command_queue, &command, 0) == pdTRUE) {
            if (command == GNSS_CMD_RESTART) process_restart(board);
        }
        sb_gnss_fix_t fix;
        if (xQueueReceive(s_input_queue,&fix,0)==pdTRUE)process_normalized_fix(&fix);
        if(s_uart_ready&&s_backend!=NULL){
            uint8_t bytes[256];int n=uart_read_bytes((uart_port_t)s_uart_port,bytes,sizeof(bytes),0);
            uint32_t before=s_backend->valid_sentence_count();uint64_t now=sb_monotonic_us();
            if(n>0)s_backend->consume_bytes(bytes,(size_t)n,now,emit_backend_fix,NULL);
            s_backend->tick(sb_monotonic_us(),emit_backend_fix,NULL);
            if(s_backend->valid_sentence_count()!=before){portENTER_CRITICAL(&s_mux);s_last_rx_us=now;portEXIT_CRITICAL(&s_mux);}
            s_backend_state=s_backend->step(sb_monotonic_us());
            if(s_backend_state==SB_GNSS_BACKEND_FAILED){portENTER_CRITICAL(&s_mux);s_state=SB_GNSS_ERROR;portEXIT_CRITICAL(&s_mux);}
            else if(s_backend_state==SB_GNSS_BACKEND_READY&&s_backend->valid_sentence_count()!=0u){
                portENTER_CRITICAL(&s_mux);s_state=SB_GNSS_RUNNING;portEXIT_CRITICAL(&s_mux);
            }
        }
        (void)esp_task_wdt_reset();
        sb_validation_note_stack(SB_VALIDATION_TASK_GNSS,
                                 (uint32_t)uxTaskGetStackHighWaterMark(NULL));
}

static void gnss_task(void *arg)
{
    (void)arg;
    sb_board_info_t board;
    sb_board_get_info(&board);
    gnss_owner_initialize(&board);
    for (;;) {
        gnss_owner_step(&board);
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

esp_err_t sb_gnss_start(void)
{
    if (s_started) return ESP_OK;
    s_fix_queue = xQueueCreateStatic(FIX_QUEUE_DEPTH, sizeof(sb_gnss_fix_t), s_fix_queue_storage, &s_fix_queue_struct);
    s_input_queue = xQueueCreateStatic(GNSS_INPUT_QUEUE_DEPTH, sizeof(sb_gnss_fix_t), s_input_queue_storage, &s_input_queue_struct);
    s_command_queue = xQueueCreateStatic(GNSS_COMMAND_QUEUE_DEPTH, sizeof(gnss_command_t), s_command_queue_storage, &s_command_queue_struct);
    if (s_fix_queue == NULL || s_input_queue == NULL || s_command_queue == NULL) return ESP_ERR_NO_MEM;
    s_backend=sb_gnss_atgm336h_backend();
    if (xTaskCreateStatic(gnss_task, "gnss_task", GNSS_STACK_WORDS, NULL, 10, s_stack, &s_task_struct) == NULL) return ESP_ERR_NO_MEM;
    s_started = true;
    return ESP_OK;
}

bool sb_gnss_receive_normalized(const sb_gnss_fix_t *fix)
{
    if (fix == NULL || s_input_queue == NULL) return false;
    if (xQueueSend(s_input_queue, fix, pdMS_TO_TICKS(5)) == pdTRUE) return true;
    sb_diag_increment(SB_DIAG_GNSS, 6);
    return false;
}

bool sb_gnss_try_receive(sb_gnss_fix_t *fix)
{
    return s_fix_queue != NULL && fix != NULL && xQueueReceive(s_fix_queue, fix, 0) == pdTRUE;
}

void sb_gnss_get_snapshot(sb_gnss_fix_t *fix, sb_gnss_state_t *state, uint64_t *last_rx_us, uint64_t *last_fix_us)
{
    portENTER_CRITICAL(&s_mux);
    if (fix) *fix = s_latest;
    if (state) *state = s_state;
    if (last_rx_us) *last_rx_us = s_last_rx_us;
    if (last_fix_us) *last_fix_us = s_last_fix_us;
    portEXIT_CRITICAL(&s_mux);
}

uint32_t sb_gnss_get_restart_generation(void)
{
    portENTER_CRITICAL(&s_mux); uint32_t generation = s_restart_generation; portEXIT_CRITICAL(&s_mux);
    return generation;
}

void sb_gnss_request_restart(void)
{
    gnss_command_t command = GNSS_CMD_RESTART;
    if (s_command_queue != NULL && xQueueSend(s_command_queue, &command, 0) != pdTRUE)
        sb_diag_increment(SB_DIAG_GNSS, 6);
}

void sb_gnss_note_live_stream_drop(void)
{
    portENTER_CRITICAL(&s_mux);
    s_pending_live_stream_drops=sb_sat_add_u64(s_pending_live_stream_drops,1u);
    portEXIT_CRITICAL(&s_mux);
}
