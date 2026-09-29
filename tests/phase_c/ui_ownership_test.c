#include <assert.h>
#include <stdio.h>
#include "../../components/sailball_ui/src/ui.c"

int gpio_config(const gpio_config_t *config){(void)config;return 0;}
int gpio_get_level(gpio_num_t pin){(void)pin;return 1;}
int rmt_new_copy_encoder(const rmt_copy_encoder_config_t *config,rmt_encoder_handle_t *encoder){(void)config;(void)encoder;return -1;}
int rmt_new_tx_channel(const rmt_tx_channel_config_t *config,rmt_channel_handle_t *channel){(void)config;(void)channel;return -1;}
int rmt_enable(rmt_channel_handle_t channel){(void)channel;return -1;}
int rmt_transmit(rmt_channel_handle_t channel,rmt_encoder_handle_t encoder,const void *data,size_t size,const rmt_transmit_config_t *config){(void)channel;(void)encoder;(void)data;(void)size;(void)config;return -1;}
int rmt_tx_wait_all_done(rmt_channel_handle_t channel,uint32_t timeout){(void)channel;(void)timeout;return -1;}
uint64_t sb_monotonic_us(void){return 0;}
void sb_board_get_info(sb_board_info_t *out){*out=(sb_board_info_t){0};}
TaskHandle_t xTaskCreateStatic(void (*entry)(void *),const char *name,unsigned stack,void *arg,unsigned priority,StackType_t *storage,StaticTask_t *state){(void)entry;(void)name;(void)stack;(void)arg;(void)priority;(void)storage;(void)state;return (TaskHandle_t)1;}
TaskHandle_t xTaskGetCurrentTaskHandle(void){return (TaskHandle_t)1;}
unsigned uxTaskGetStackHighWaterMark(TaskHandle_t task){(void)task;return 1;}
TickType_t xTaskGetTickCount(void){return 0;}
void vTaskDelay(TickType_t ticks){(void)ticks;}
void sb_validation_note_stack(sb_validation_task_t task,uint32_t bytes){(void)task;(void)bytes;}

int main(void)
{
    assert(sb_ui_get_page()==0u);
    assert(sb_ui_set_page(4u));
    assert(sb_ui_get_page()==0u); /* non-owner may only publish a request */
    assert(sb_ui_set_page(2u));   /* bounded mailbox: newest request wins */
    apply_page_request();
    assert(sb_ui_get_page()==2u);
    assert(!sb_ui_set_page(7u));
    assert(sb_ui_get_page()==2u);
    puts("PASS production UI page ownership: request mailbox, owner apply, latest-wins and range check");
    return 0;
}
