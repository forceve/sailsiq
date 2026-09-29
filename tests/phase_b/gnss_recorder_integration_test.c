#include <assert.h>
#include <setjmp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "esp_random.h"
#include "esp_task_wdt.h"
#include "sailball/board.h"
#include "sailball/diagnostics.h"
#include "sailball/gnss.h"
#include "sailball/ldc.h"
#include "sailball/recorder.h"
#include "sailball/storage.h"
#include "sailball/validation.h"
#include "../../components/sailball_gnss/src/gnss.c"

typedef struct { StaticQueue_t *identity; uint8_t *data; unsigned depth, size, head, count; } fake_queue_t;
static fake_queue_t s_queues[5];
static size_t s_queue_count;
static void (*s_gnss_task)(void *), (*s_recorder_task)(void *);
static jmp_buf s_stop_task;
static unsigned s_step_limit, s_steps;
static uint64_t s_now_us = UINT64_C(1000000);
static char s_uart[8192];
static size_t s_uart_size, s_uart_offset;
static unsigned s_uart_reads, s_fix_drop, s_recorder_consumed;
static bool s_bytewise_uart,s_all_at_once_uart;
static char s_uart_commands[3][48];
static unsigned s_uart_command_count,s_uart_set_baud_count;
static sb_gnss_fix_t s_published[64];
static size_t s_published_count;
static uint64_t s_sequence_gaps;
static unsigned s_block_count, s_block_ack_count, s_create_count;
static uint64_t s_last_block_end;
static sb_storage_ack_t s_acks[16];
static size_t s_ack_head, s_ack_count;
static void append_sentence(const char *body);

static fake_queue_t *find_queue(QueueHandle_t handle)
{
    for (size_t i=0;i<s_queue_count;++i) if (s_queues[i].identity==handle) return &s_queues[i];
    assert(0); return NULL;
}
QueueHandle_t xQueueCreateStatic(unsigned depth,unsigned size,uint8_t *data,StaticQueue_t *identity)
{
    assert(s_queue_count<sizeof(s_queues)/sizeof(s_queues[0]));
    s_queues[s_queue_count++]=(fake_queue_t){identity,data,depth,size,0u,0u};return identity;
}
int xQueueSend(QueueHandle_t handle,const void *item,TickType_t ticks)
{
    (void)ticks;fake_queue_t *q=find_queue(handle);if(q->count==q->depth)return pdFALSE;
    if(handle==s_fix_queue){assert(s_published_count<64u);s_published[s_published_count++]=*(const sb_gnss_fix_t *)item;}
    memcpy(q->data+(size_t)((q->head+q->count)%q->depth)*q->size,item,q->size);++q->count;return pdTRUE;
}
int xQueueReceive(QueueHandle_t handle,void *out,TickType_t ticks)
{
    (void)ticks;fake_queue_t *q=find_queue(handle);if(!q->count)return pdFALSE;
    memcpy(out,q->data+(size_t)q->head*q->size,q->size);q->head=(q->head+1u)%q->depth;--q->count;return pdTRUE;
}
unsigned uxQueueMessagesWaiting(QueueHandle_t handle){return find_queue(handle)->count;}
TaskHandle_t xTaskCreateStatic(void (*entry)(void*),const char *name,unsigned words,void *arg,
                               unsigned priority,StackType_t *stack,StaticTask_t *state)
{
    (void)words;(void)arg;(void)priority;(void)stack;(void)state;
    if(strcmp(name,"gnss_task")==0)s_gnss_task=entry;
    else if(strcmp(name,"recorder_task")==0)s_recorder_task=entry;
    else assert(0);
    return (TaskHandle_t)(uintptr_t)(s_gnss_task==entry?1u:2u);
}
unsigned uxTaskGetStackHighWaterMark(TaskHandle_t task){(void)task;return 1024u;}
void vTaskDelay(TickType_t ticks){s_now_us+=(uint64_t)ticks*1000u;if(++s_steps>=s_step_limit)longjmp(s_stop_task,1);}
TickType_t xTaskGetTickCount(void){return (TickType_t)(s_now_us/1000u);}
static void run_task(void (*entry)(void *),unsigned iterations)
{s_steps=0u;s_step_limit=iterations;if(setjmp(s_stop_task)==0)entry(NULL);assert(s_steps==iterations);}
static sb_board_info_t s_gnss_board;
static void run_gnss_steps(unsigned iterations)
{for(unsigned i=0;i<iterations;++i){gnss_owner_step(&s_gnss_board);s_now_us+=UINT64_C(10000);}}

esp_err_t esp_task_wdt_add(void *task){(void)task;return ESP_OK;}
esp_err_t esp_task_wdt_reset(void){return ESP_OK;}
esp_err_t uart_driver_install(uart_port_t p,int rx,int tx,int n,void *q,int flags)
{(void)p;(void)rx;(void)tx;(void)n;(void)q;(void)flags;return ESP_OK;}
esp_err_t uart_param_config(uart_port_t p,const uart_config_t *cfg)
{(void)p;assert(cfg->baud_rate==115200);return ESP_OK;}
esp_err_t uart_set_pin(uart_port_t p,int tx,int rx,int rts,int cts)
{assert(p==1);(void)rts;(void)cts;assert(tx==1&&rx==0);return ESP_OK;}
esp_err_t uart_set_baudrate(uart_port_t p,uint32_t baud)
{
    assert(p==1&&baud==115200u);++s_uart_set_baud_count;
    append_sentence("GPRMC,123521.100,V,,,,,,,230394,,,A");
    append_sentence("GPRMC,123521.200,V,,,,,,,230394,,,A");
    append_sentence("GPRMC,123521.300,V,,,,,,,230394,,,A");
    append_sentence("GPRMC,123521.400,V,,,,,,,230394,,,A");
    return ESP_OK;
}
esp_err_t uart_flush_input(uart_port_t p)
{
    assert(p==1);return ESP_OK;
}
int uart_write_bytes(uart_port_t p,const char *data,size_t length)
{
    assert(p==1&&data!=NULL&&length<sizeof(s_uart_commands[0]));
    assert(s_uart_command_count<3u);memcpy(s_uart_commands[s_uart_command_count],data,length);
    s_uart_commands[s_uart_command_count][length]='\0';++s_uart_command_count;return (int)length;
}
esp_err_t uart_driver_delete(uart_port_t p){(void)p;return ESP_OK;}
int uart_read_bytes(uart_port_t p,void *data,uint32_t capacity,uint32_t ticks)
{
    (void)p;(void)ticks;if(s_uart_offset==s_uart_size)return 0;
    static const unsigned chunks[]={1,3,7,13,2,17,29};
    size_t n=s_bytewise_uart?1u:(s_all_at_once_uart?capacity:chunks[s_uart_reads++%7u]);if(n>capacity)n=capacity;
    if(n>s_uart_size-s_uart_offset)n=s_uart_size-s_uart_offset;
    memcpy(data,s_uart+s_uart_offset,n);s_uart_offset+=n;return (int)n;
}
void sb_board_get_info(sb_board_info_t *info)
{memset(info,0,sizeof(*info));info->gnss_configured=true;info->gnss_uart_port=1;info->gnss_tx_gpio=1;info->gnss_rx_gpio=0;info->boot_id=7u;info->device_id=9u;}
uint64_t sb_monotonic_us(void){return s_now_us;}
uint32_t esp_random(void){return UINT32_C(0x12345678);}
void sb_diag_increment(sb_diag_group_t group,unsigned counter)
{if(group==SB_DIAG_GNSS&&counter==6u)++s_fix_drop;if(group==SB_DIAG_RECORDER&&counter==0u)++s_recorder_consumed;}
void sb_diag_add(sb_diag_group_t group,unsigned counter,uint64_t value)
{if(group==SB_DIAG_RECORDER&&counter==5u)s_sequence_gaps+=value;}
void sb_validation_note_stack(sb_validation_task_t task,uint32_t mark){(void)task;(void)mark;}
uint8_t sb_fix_to_ldc(sb_gnss_fix_type_t type){return (uint8_t)type;}

sb_storage_state_t sb_storage_get_state(void){return SB_STORAGE_READY;}
static void add_ack(sb_storage_ack_t ack)
{assert(s_ack_count<16u);s_acks[(s_ack_head+s_ack_count)%16u]=ack;++s_ack_count;}
bool sb_storage_try_ack(sb_storage_ack_t *ack)
{if(!s_ack_count)return false;*ack=s_acks[s_ack_head];s_ack_head=(s_ack_head+1u)%16u;--s_ack_count;return true;}
bool sb_storage_create_recording(uint32_t boot,uint32_t session,uint32_t file,uint64_t device,const uint8_t id[16])
{
    (void)boot;(void)session;(void)device;(void)id;++s_create_count;
    add_ack((sb_storage_ack_t){.op=SB_STORAGE_OP_CREATE,.status=SB_OK,.file_sequence=file});return true;
}
bool sb_storage_submit_block(uint8_t buffer_id,uint32_t sequence,uint8_t *data,size_t length)
{
    assert(sb_ldc_block_validate(data,length,sequence));
    sb_ldc_block_header_t header;assert(sb_ldc_header_decode(data,&header));
    assert(header.start_mono_us>=s_last_block_end);s_last_block_end=header.start_mono_us+header.duration_us;
    ++s_block_count;
    add_ack((sb_storage_ack_t){.op=SB_STORAGE_OP_WRITE_BLOCK,.status=SB_OK,.buffer_id=buffer_id,
                                .committed_block_sequence=sequence});return true;
}
bool sb_storage_close_recording(void)
{add_ack((sb_storage_ack_t){.op=SB_STORAGE_OP_CLOSE,.status=SB_OK});return true;}

static void append_sentence(const char *body)
{
    unsigned sum=0u;for(const char *p=body;*p;++p)sum^=(unsigned char)*p;
    int n=snprintf(s_uart+s_uart_size,sizeof(s_uart)-s_uart_size,"$%s*%02X\r\n",body,sum);
    assert(n>0&&(size_t)n<sizeof(s_uart)-s_uart_size);s_uart_size+=(size_t)n;
}
static sb_gnss_fix_t next_uart_fix(const char *first,const char *second,const char *third,bool bytewise)
{
    size_t before=s_published_count;
    if(first)append_sentence(first);
    if(second)append_sentence(second);
    if(third)append_sentence(third);
    s_bytewise_uart=bytewise;
    run_gnss_steps(bytewise?190u:80u);
    s_bytewise_uart=false;
    assert(s_uart_offset==s_uart_size&&s_published_count==before+1u);
    sb_gnss_fix_t fix=s_published[before];
    assert(fix.sample_seq==before&&fix.mono_us!=0u);
    sb_gnss_fix_t snapshot={0};sb_gnss_get_snapshot(&snapshot,NULL,NULL,NULL);
    assert(snapshot.sample_seq==fix.sample_seq&&snapshot.mono_us==fix.mono_us);
    unsigned consumed=s_recorder_consumed;
    run_task(s_recorder_task,1u);assert(s_recorder_consumed==consumed+1u);
    return fix;
}
int main(void)
{
    append_sentence("GNGSA,A,3,04,05,09,12,24,25,26,27");
    append_sentence("GNRMC,123519.000,A,4807.038,N,01131.000,E,022.4,084.4,230394,,,A");
    append_sentence("GPGGA,123519.000,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,");
    append_sentence("GPRMC,123520.000,V,,,,,,,230394,,,A");
    assert(sb_gnss_start()==ESP_OK&&sb_recorder_start()==ESP_OK);
    assert(s_gnss_task&&s_recorder_task);
    sb_board_get_info(&s_gnss_board);gnss_owner_initialize(&s_gnss_board);
    run_task(s_recorder_task,2u);assert(s_create_count==1u);
    sb_recorder_state_t recorder_state;sb_recorder_get_snapshot(&recorder_state,NULL,NULL,NULL,NULL,NULL,NULL);
    assert(recorder_state==SB_RECORDER_RECORDING);
    run_gnss_steps(110u);assert(s_uart_offset==s_uart_size);
    sb_gnss_fix_t latest={0};sb_gnss_state_t gnss_state;uint64_t last_rx=0,last_fix=0;
    sb_gnss_get_snapshot(&latest,&gnss_state,&last_rx,&last_fix);
    assert(gnss_state==SB_GNSS_RUNNING&&latest.sample_seq==5u&&!latest.position_valid);
    assert(last_rx>=last_fix&&last_fix!=0u&&s_fix_drop==0u);
    assert(s_published_count==6u&&s_uart_command_count==3u&&s_uart_set_baud_count==1u);
    assert(strcmp(s_uart_commands[0],"$PCAS03,1,0,1,0,1,0,0,0*03\r\n")==0);
    assert(strcmp(s_uart_commands[1],"$PCAS02,100*1E\r\n")==0);
    assert(strcmp(s_uart_commands[2],"$PCAS01,5*19\r\n")==0);
    run_task(s_recorder_task,6u);assert(s_recorder_consumed==6u);
    uint64_t last_sample=0;sb_recorder_get_snapshot(NULL,NULL,NULL,NULL,NULL,&last_sample,NULL);
    assert(last_sample==latest.mono_us&&s_block_count>=1u);
    assert(s_published_count==6u);
    assert(s_published[0].position_valid&&s_published[0].utc_valid);
    assert(s_published[0].latitude_e7==481173000&&s_published[0].longitude_e7==115166667);
    assert(s_published[0].altitude_valid&&s_published[0].altitude_cm==54540);
    assert(s_published[0].ground_speed_valid&&s_published[0].ground_speed_centi_kn==2240u);
    assert(s_published[0].course_valid&&s_published[0].course_centi_deg==8440u);
    assert(s_published[0].satellites_valid&&s_published[0].satellites_used==8u);
    assert(s_published[0].fix_type==SB_GNSS_FIX_3D);
    assert(s_published[1].utc_valid&&!s_published[1].position_valid&&s_published[1].fix_type==SB_GNSS_FIX_NONE);
    run_gnss_steps(50u);
    sb_gnss_get_snapshot(NULL,&gnss_state,&last_rx,&last_fix);
    uint64_t settled_rx=last_rx;
    run_gnss_steps(50u);
    sb_gnss_get_snapshot(NULL,&gnss_state,&last_rx,&last_fix);
    assert(gnss_state==SB_GNSS_RUNNING&&last_rx==settled_rx); /* silence is not NO_FIX progress */
    sb_gnss_fix_t matrix_fix=next_uart_fix(
        "GNGSA,A,2,04,05,09,12,24,25,26,27",
        "GNRMC,123521.000,A,4807.038,N,01131.000,E,022.4,084.4,230394,,,A",
        "GPGGA,123521.000,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,",false);
    assert(matrix_fix.fix_type==SB_GNSS_FIX_2D&&matrix_fix.position_valid);
    matrix_fix=next_uart_fix(
        "GPGGA,123522.000,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,",
        "GNGSA,A,3,04,05,09,12,24,25,26,27",
        "GPRMC,123522.000,A,4807.038,N,01131.000,E,022.4,084.4,230394,,,A",false);
    assert(matrix_fix.fix_type==SB_GNSS_FIX_3D&&matrix_fix.utc_valid);
    run_gnss_steps(250u); /* The prior GSA must become stale before a missing-GSA case. */
    matrix_fix=next_uart_fix(
        "GPRMC,123523.000,A,4807.038,N,01131.000,E,,,230394,,,A",
        "GPGGA,123523.000,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,",
        NULL,false);
    assert(matrix_fix.position_valid&&matrix_fix.fix_type==SB_GNSS_FIX_UNKNOWN);
    assert(!matrix_fix.ground_speed_valid&&!matrix_fix.course_valid);
    matrix_fix=next_uart_fix(
        "GPGGA,123524.000,,,,,0,00,99.9,,,,,,",NULL,NULL,false);
    assert(!matrix_fix.position_valid&&!matrix_fix.utc_valid&&matrix_fix.fix_type==SB_GNSS_FIX_NONE);
    matrix_fix=next_uart_fix(
        "GPRMC,123525.000,A,4807.038,N,01131.000,E,,,230394,,,A",
        NULL,NULL,true);
    assert(matrix_fix.position_valid&&matrix_fix.utc_valid&&!matrix_fix.altitude_valid);
    assert(!matrix_fix.ground_speed_valid&&!matrix_fix.course_valid);
    size_t before_bad=s_published_count;
    append_sentence("GPRMC,123526.000,A,4807.038,N,01131.000,E,,,230394,,,A");
    s_uart[s_uart_size-4u]^=1; /* checksum failure */
    run_gnss_steps(80u);assert(s_uart_offset==s_uart_size&&s_published_count==before_bad);
    append_sentence("GPRMC,123526.000,A,48X7.038,N,01131.000,E,,,230394,,,A");
    run_gnss_steps(80u);assert(s_uart_offset==s_uart_size&&s_published_count==before_bad);
    memcpy(s_uart+s_uart_size,"garbage",7u);s_uart_size+=7u;
    matrix_fix=next_uart_fix("GPRMC,123527.000,A,4807.038,N,01131.000,E,,,230394,,,A",
                             NULL,NULL,false);
    assert(matrix_fix.position_valid&&matrix_fix.utc_valid);
    /* Two UTC epochs in one physical recv chunk still publish two fixes. */
    size_t before_burst=s_published_count;unsigned consumed_before_burst=s_recorder_consumed;
    append_sentence("GPRMC,123528.000,A,4807.038,N,01131.000,E,,,230394,,,A");
    append_sentence("GNRMC,123529.000,A,4807.038,N,01131.000,E,,,230394,,,A");
    s_all_at_once_uart=true;run_gnss_steps(80u);s_all_at_once_uart=false;
    assert(s_uart_offset==s_uart_size&&s_published_count==before_burst+2u);
    assert(s_published[before_burst].utc_us<s_published[before_burst+1u].utc_us);
    run_task(s_recorder_task,1u);assert(s_recorder_consumed==consumed_before_burst+2u);
    assert(sb_recorder_request_stop()==SB_ACCEPTED);
    run_task(s_recorder_task,3u);assert(s_block_count>=2u);
    /* Production normalized queue drops newest at depth 32. A later fix
     * exposes the exact sequence gap to the production Recorder owner. */
    unsigned consumed_before_pressure=s_recorder_consumed;
    for(unsigned i=0;i<34u;++i){
        char body[112];
        int n=snprintf(body,sizeof(body),
            "GPRMC,1235%02u.000,A,4807.038,N,01131.000,E,,,230394,,,A",i);
        assert(n>0&&(size_t)n<sizeof(body));append_sentence(body);
    }
    s_all_at_once_uart=true;run_gnss_steps(100u);s_all_at_once_uart=false;
    assert(s_uart_offset==s_uart_size);
    assert(s_fix_drop==2u);
    run_task(s_recorder_task,1u);assert(s_recorder_consumed==consumed_before_pressure+32u);
    append_sentence("GPRMC,123534.000,A,4807.038,N,01131.000,E,,,230394,,,A");
    run_gnss_steps(100u);
    run_task(s_recorder_task,1u);
    assert(s_recorder_consumed==consumed_before_pressure+33u&&s_sequence_gaps==2u);
    puts("PASS production fake UART -> ATGM -> Fix Queue -> Recorder -> LDC: parser matrix, NO_FIX/silence, drop-newest and sequence gap");
    return 0;
}
