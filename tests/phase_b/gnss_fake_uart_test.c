#include <assert.h>
#include <setjmp.h>
#include <stdio.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "esp_task_wdt.h"
#include "sailball/board.h"
#include "sailball/diagnostics.h"
#include "sailball/gnss.h"
#include "sailball/validation.h"

#include "../../components/sailball_gnss/src/gnss.c"

typedef struct {
    StaticQueue_t *identity;
    uint8_t *storage;
    unsigned depth, item_size, head, count;
} fake_queue_t;

static fake_queue_t s_queues[4];
static size_t s_queue_count;
static void (*s_task_entry)(void *);
static uint64_t s_now_us=UINT64_C(1000000);
static unsigned s_delay_count, s_diag_gnss_errors;
static uint64_t s_diag_live_drops;
static char s_uart_stream[2048];
static size_t s_uart_length, s_uart_offset;
static char s_uart_commands[3][48];
static unsigned s_uart_command_count,s_uart_set_baud_count;
static unsigned s_uart_chunk_index;
static jmp_buf s_task_return;
static size_t append_sentence(size_t offset,const char *body);

QueueHandle_t xQueueCreateStatic(unsigned depth, unsigned item_size, uint8_t *storage,
                                 StaticQueue_t *identity)
{
    assert(s_queue_count < sizeof(s_queues) / sizeof(s_queues[0]));
    fake_queue_t *queue = &s_queues[s_queue_count++];
    *queue = (fake_queue_t){identity, storage, depth, item_size, 0u, 0u};
    return identity;
}

static fake_queue_t *find_queue(QueueHandle_t handle)
{
    for (size_t i = 0; i < s_queue_count; ++i)
        if (s_queues[i].identity == handle) return &s_queues[i];
    return NULL;
}

int xQueueSend(QueueHandle_t handle, const void *item, TickType_t ticks)
{
    (void)ticks;
    fake_queue_t *queue = find_queue(handle);
    assert(queue != NULL && item != NULL);
    if (queue->count == queue->depth) return pdFALSE;
    unsigned tail = (queue->head + queue->count) % queue->depth;
    memcpy(queue->storage + (size_t)tail * queue->item_size, item, queue->item_size);
    ++queue->count;
    return pdTRUE;
}

int xQueueReceive(QueueHandle_t handle, void *out, TickType_t ticks)
{
    (void)ticks;
    fake_queue_t *queue = find_queue(handle);
    assert(queue != NULL && out != NULL);
    if (queue->count == 0u) return pdFALSE;
    memcpy(out, queue->storage + (size_t)queue->head * queue->item_size, queue->item_size);
    queue->head = (queue->head + 1u) % queue->depth;
    --queue->count;
    return pdTRUE;
}

TaskHandle_t xTaskCreateStatic(void (*entry)(void *), const char *name, unsigned stack_words,
                              void *arg, unsigned priority, StackType_t *stack, StaticTask_t *state)
{
    (void)name; (void)stack_words; (void)arg; (void)priority; (void)stack; (void)state;
    s_task_entry = entry;
    return (TaskHandle_t)(uintptr_t)1u;
}

unsigned uxTaskGetStackHighWaterMark(TaskHandle_t task) { (void)task; return 1024u; }

void vTaskDelay(TickType_t ticks)
{
    s_now_us += (uint64_t)ticks * UINT64_C(1000);
    if (++s_delay_count == 180u) longjmp(s_task_return, 1);
}

esp_err_t esp_task_wdt_add(void *task_handle) { (void)task_handle; return ESP_OK; }
esp_err_t esp_task_wdt_reset(void) { return ESP_OK; }

esp_err_t uart_driver_install(uart_port_t port, int rx_size, int tx_size, int queue_size,
                              void *queue, int flags)
{
    (void)port; (void)rx_size; (void)tx_size; (void)queue_size; (void)queue; (void)flags;
    return ESP_OK;
}
esp_err_t uart_param_config(uart_port_t port, const uart_config_t *config)
{ (void)port; assert(config != NULL && config->baud_rate == 115200); return ESP_OK; }
esp_err_t uart_set_pin(uart_port_t port, int tx, int rx, int rts, int cts)
{ assert(port==1); (void)rts; (void)cts; assert(tx == 1 && rx == 0); return ESP_OK; }
esp_err_t uart_set_baudrate(uart_port_t port,uint32_t baud)
{
    assert(port==1&&baud==115200u);++s_uart_set_baud_count;
    size_t at=s_uart_length;
    at=append_sentence(at,"GPRMC,123521.100,V,,,,,,,230394,,,A");
    at=append_sentence(at,"GPRMC,123521.200,V,,,,,,,230394,,,A");
    at=append_sentence(at,"GPRMC,123521.300,V,,,,,,,230394,,,A");
    at=append_sentence(at,"GPRMC,123521.400,V,,,,,,,230394,,,A");
    s_uart_length=at;return ESP_OK;
}
esp_err_t uart_flush_input(uart_port_t port)
{
    assert(port==1);return ESP_OK;
}
esp_err_t uart_driver_delete(uart_port_t port) { (void)port; return ESP_OK; }
int uart_write_bytes(uart_port_t port,const char *data,size_t length)
{
    assert(port==1&&data!=NULL&&length<sizeof(s_uart_commands[0]));
    assert(s_uart_command_count<3u);memcpy(s_uart_commands[s_uart_command_count],data,length);
    s_uart_commands[s_uart_command_count][length]='\0';++s_uart_command_count;return (int)length;
}

int uart_read_bytes(uart_port_t port, void *buffer, uint32_t capacity, uint32_t ticks)
{
    (void)port; (void)ticks;
    if (s_uart_offset == s_uart_length) return 0;
    static const size_t chunks[] = {1u, 7u, 13u, 3u, 29u, 2u, 11u};
    size_t amount = chunks[s_uart_chunk_index++ % (sizeof(chunks) / sizeof(chunks[0]))];
    if (amount > capacity) amount = capacity;
    if (amount > s_uart_length - s_uart_offset) amount = s_uart_length - s_uart_offset;
    memcpy(buffer, s_uart_stream + s_uart_offset, amount);
    s_uart_offset += amount;
    return (int)amount;
}

void sb_board_get_info(sb_board_info_t *out)
{
    memset(out, 0, sizeof(*out));
    out->gnss_configured = true;
    out->gnss_uart_port=1;out->gnss_tx_gpio=1;out->gnss_rx_gpio=0;
}

uint64_t sb_monotonic_us(void) { return s_now_us; }
void sb_diag_increment(sb_diag_group_t group, unsigned counter)
{ if (group == SB_DIAG_GNSS && counter == 3u) ++s_diag_gnss_errors; }
void sb_diag_add(sb_diag_group_t group,unsigned counter,uint64_t amount)
{if(group==SB_DIAG_GNSS&&counter==5u)s_diag_live_drops+=amount;}
void sb_validation_note_stack(sb_validation_task_t task, uint32_t bytes)
{ (void)task; (void)bytes; }

static size_t append_sentence(size_t offset, const char *body)
{
    unsigned checksum = 0u;
    for (const char *p = body; *p != '\0'; ++p) checksum ^= (unsigned char)*p;
    int written = snprintf(s_uart_stream + offset, sizeof(s_uart_stream) - offset,
                           "$%s*%02X\r\n", body, checksum);
    assert(written > 0);
    return offset + (size_t)written;
}

int main(void)
{
    size_t length = 0u;
    length = append_sentence(length, "GNGSA,A,3,04,05,09,12,24,25,26,27");
    length = append_sentence(length, "GNRMC,123519.000,A,4807.038,N,01131.000,E,022.4,084.4,230394,,,A");
    length = append_sentence(length, "GPGGA,123519.000,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,");
    length = append_sentence(length, "GNVTG,084.4,T,,M,022.4,N,041.5,K,A");
    length = append_sentence(length, "GPRMC,123520.000,V,,,,,,,230394,,,A");
    s_uart_length = length;

    assert(sb_gnss_start() == ESP_OK);
    assert(s_task_entry != NULL);
    if (setjmp(s_task_return) == 0) s_task_entry(NULL);

    sb_gnss_fix_t snapshot = {0};
    sb_gnss_state_t state = SB_GNSS_OFF;
    uint64_t last_rx = 0u, last_fix = 0u;
    sb_gnss_get_snapshot(&snapshot, &state, &last_rx, &last_fix);
    assert(state == SB_GNSS_RUNNING);
    assert(s_uart_command_count==3u&&s_uart_set_baud_count==1u);
    assert(strcmp(s_uart_commands[0],"$PCAS03,1,0,1,0,1,0,0,0*03\r\n")==0);
    assert(strcmp(s_uart_commands[1],"$PCAS02,100*1E\r\n")==0);
    assert(strcmp(s_uart_commands[2],"$PCAS01,5*19\r\n")==0);
    assert(snapshot.sample_seq == 5u); /* startup NO_FIX cadence samples crossed the production queue */
    assert(!snapshot.position_valid && snapshot.fix_type == SB_GNSS_FIX_NONE);
    assert(snapshot.utc_valid);
    assert(last_fix != 0u && last_rx >= last_fix);
    assert(s_now_us - last_rx >= UINT64_C(500000)); /* no new bytes during this interval */
    assert(s_diag_gnss_errors == 0u); /* NO_FIX and silence are not subsystem failure */

    sb_gnss_fix_t valid = {0}, no_fix = {0};
    assert(sb_gnss_try_receive(&valid));
    assert(valid.sample_seq == 0u && valid.position_valid && valid.utc_valid);
    assert(valid.latitude_e7 == 481173000 && valid.longitude_e7 == 115166667);
    assert(valid.altitude_valid && valid.altitude_cm == 54540);
    assert(valid.ground_speed_valid && valid.ground_speed_centi_kn == 2240u);
    assert(valid.course_valid && valid.course_centi_deg == 8440u);
    assert(valid.satellites_valid && valid.satellites_used == 8u);
    assert(sb_gnss_try_receive(&no_fix));
    assert(no_fix.sample_seq == 1u && !no_fix.position_valid && no_fix.utc_valid);
    assert(no_fix.fix_type == SB_GNSS_FIX_NONE);
    for(uint32_t sequence=2u;sequence<=5u;++sequence){
        assert(sb_gnss_try_receive(&no_fix));
        assert(no_fix.sample_seq==sequence&&!no_fix.position_valid&&no_fix.utc_valid);
    }
    assert(!sb_gnss_try_receive(&valid));
    sb_gnss_note_live_stream_drop();sb_gnss_note_live_stream_drop();
    assert(s_pending_live_stream_drops==2u&&s_diag_live_drops==0u);
    sb_board_info_t board={.gnss_configured=true};gnss_owner_step(&board);
    assert(s_pending_live_stream_drops==0u&&s_diag_live_drops==2u);
    puts("PASS production GNSS task + fake UART + ATGM backend: split byte stream, normalized queue/snapshot, NO_FIX, and silence");
    return 0;
}
