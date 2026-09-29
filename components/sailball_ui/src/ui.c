#include "sailball/ui.h"
#include "sailball/board.h"
#include "sailball/diagnostics.h"
#include "sailball/validation.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/portmacro.h"
#include "driver/gpio.h"
#include "driver/rmt_encoder.h"
#include "driver/rmt_tx.h"
#include "esp_err.h"
#include "sdkconfig.h"
#include "soc/soc_caps.h"

#define UI_STACK_WORDS 1536u
#define UI_DEBOUNCE_MS 30u
#define UI_SHORT_PRESS_MAX_MS 1000u
#define UI_LED_RESOLUTION_HZ 10000000u
#define UI_PATTERN_PERIOD_MS 2000u
#define UI_ALTERNATE_MS 400u

typedef struct { uint8_t red,green,blue; } ui_rgb_t;

static StaticTask_t s_task_struct;
static StackType_t s_stack[UI_STACK_WORDS];
static portMUX_TYPE s_mux=portMUX_INITIALIZER_UNLOCKED;
static uint8_t s_page;
static uint8_t s_requested_page;
static bool s_page_request_pending;
static sb_ui_status_t s_status;
static sb_ui_status_provider_t s_status_provider;
static bool s_button_ready,s_led_ready;
static gpio_num_t s_button_gpio=GPIO_NUM_NC;
static rmt_channel_handle_t s_led_channel;
static rmt_encoder_handle_t s_led_encoder;
static rmt_symbol_word_t s_led_symbols[25];
static ui_rgb_t s_last_rgb={.red=255,.green=255,.blue=255};
static bool s_last_rgb_valid;

static const ui_rgb_t s_page_colors[7]={
    {.red=0,.green=64,.blue=0},
    {.red=0,.green=45,.blue=45},
    {.red=55,.green=45,.blue=0},
    {.red=36,.green=36,.blue=36},
    {.red=25,.green=0,.blue=45},
    {.red=0,.green=0,.blue=52},
    {.red=55,.green=13,.blue=0}
};
static const ui_rgb_t s_error_color={.red=48,.green=0,.blue=0};

static uint8_t current_page(void)
{
    portENTER_CRITICAL(&s_mux);uint8_t page=s_page;portEXIT_CRITICAL(&s_mux);return page;
}

/* Page state is owned by ui_task. Other tasks publish a one-entry bounded
 * request; the UI owner applies it and the normal snapshot/event path observes
 * the resulting page. Latest request wins if requests overlap. */
static void apply_page_request(void)
{
    portENTER_CRITICAL(&s_mux);
    if(s_page_request_pending){s_page=s_requested_page;s_page_request_pending=false;}
    portEXIT_CRITICAL(&s_mux);
}

static bool page_available(uint8_t page)
{
    if(page==0)return s_status.critical_path_healthy;
    if(page==1)return s_status.gnss_available;
    if(page==2)return s_status.storage_ready;
    if(page==3)return s_status.usb_connected;
    if(page==4)return s_status.ble_connected;
    if(page==5)return s_status.wifi_online;
    return false;
}

static rmt_symbol_word_t make_symbol(uint16_t high,uint16_t low)
{
    rmt_symbol_word_t symbol={0};symbol.level0=1;symbol.duration0=high;symbol.level1=0;symbol.duration1=low;return symbol;
}

static void init_led(const sb_board_info_t *board)
{
    if(!board->led_configured)return;
    rmt_tx_channel_config_t channel_config={
        .gpio_num=(gpio_num_t)board->led_gpio,
        .clk_src=RMT_CLK_SRC_DEFAULT,
        .resolution_hz=UI_LED_RESOLUTION_HZ,
        .mem_block_symbols=SOC_RMT_MEM_WORDS_PER_CHANNEL,
        .trans_queue_depth=1,
        .flags={.init_level=0}
    };
    if(rmt_new_tx_channel(&channel_config,&s_led_channel)!=ESP_OK)return;
    rmt_copy_encoder_config_t encoder_config;
    if(rmt_new_copy_encoder(&encoder_config,&s_led_encoder)!=ESP_OK)return;
    if(rmt_enable(s_led_channel)!=ESP_OK)return;
    s_led_ready=true;
}

static bool transmit_rgb(ui_rgb_t color)
{
    if(!s_led_ready)return false;
    if(s_last_rgb_valid&&color.red==s_last_rgb.red&&color.green==s_last_rgb.green&&color.blue==s_last_rgb.blue)return true;
    /* WS2812-compatible GRB timing at 10 MHz; board LED timing remains hardware-tuning dependent. */
    uint8_t bytes[3]={color.green,color.red,color.blue};size_t symbol=0;
    for(size_t i=0;i<sizeof(bytes);++i){
        for(uint8_t bit=0;bit<8;++bit){
            bool one=(bytes[i]&(uint8_t)(0x80u>>bit))!=0;
            s_led_symbols[symbol++]=one?make_symbol(9,3):make_symbol(3,9);
        }
    }
    uint16_t reset_ticks=(uint16_t)(UI_LED_RESOLUTION_HZ/1000000u*50u/2u);
    rmt_symbol_word_t reset={0};reset.level0=0;reset.duration0=reset_ticks;reset.level1=0;reset.duration1=reset_ticks;
    s_led_symbols[symbol++]=reset;
    rmt_transmit_config_t tx_config={.loop_count=0};
    if(rmt_transmit(s_led_channel,s_led_encoder,s_led_symbols,symbol*sizeof(s_led_symbols[0]),&tx_config)!=ESP_OK)return false;
    if(rmt_tx_wait_all_done(s_led_channel,pdMS_TO_TICKS(10))!=ESP_OK)return false;
    s_last_rgb=color;s_last_rgb_valid=true;return true;
}

static ui_rgb_t pattern_color(uint8_t page,uint64_t now_ms)
{
    ui_rgb_t off={0};
    if(!page_available(page))return ((now_ms/UI_ALTERNATE_MS)&1u)?s_error_color:s_page_colors[page];
    if(page==0)return now_ms%UI_PATTERN_PERIOD_MS<500u?s_page_colors[page]:off;
    return now_ms%UI_PATTERN_PERIOD_MS<300u?s_page_colors[page]:off;
}

static void init_button(const sb_board_info_t *board)
{
    if(!board->boot_button_configured)return;
    s_button_gpio=(gpio_num_t)board->boot_gpio;
    gpio_config_t config={0};config.pin_bit_mask=UINT64_C(1)<<s_button_gpio;config.mode=GPIO_MODE_INPUT;
    config.pull_up_en=GPIO_PULLUP_ENABLE;config.pull_down_en=GPIO_PULLDOWN_DISABLE;config.intr_type=GPIO_INTR_DISABLE;
    if(gpio_config(&config)==ESP_OK)s_button_ready=true;
}

static void handle_button(void)
{
    if(!s_button_ready)return;
    static int stable_level=1,candidate_level=1;
    static uint64_t candidate_since_ms,pressed_since_ms;
    uint64_t now_ms=(uint64_t)(xTaskGetTickCount()*portTICK_PERIOD_MS);
    int level=gpio_get_level(s_button_gpio);
    if(level!=candidate_level){candidate_level=level;candidate_since_ms=now_ms;return;}
    if(candidate_level==stable_level||now_ms-candidate_since_ms<UI_DEBOUNCE_MS)return;
    int previous=stable_level;stable_level=candidate_level;
    if(previous==1&&stable_level==0)pressed_since_ms=now_ms;
    else if(previous==0&&stable_level==1){
        uint64_t held=now_ms-pressed_since_ms;
        if(held<=UI_SHORT_PRESS_MAX_MS){uint8_t next=(uint8_t)((current_page()+1u)%7u);(void)sb_ui_set_page(next);}
    }
}

static void ui_task(void *arg)
{
    (void)arg;sb_board_info_t board;sb_board_get_info(&board);init_button(&board);init_led(&board);
    for(;;){
        sb_validation_note_stack(SB_VALIDATION_TASK_UI,(uint32_t)uxTaskGetStackHighWaterMark(NULL));
        handle_button();
        apply_page_request();
        sb_ui_status_provider_t provider;portENTER_CRITICAL(&s_mux);provider=s_status_provider;portEXIT_CRITICAL(&s_mux);
        if(provider){sb_ui_status_t snapshot={0};provider(&snapshot);portENTER_CRITICAL(&s_mux);s_status=snapshot;portEXIT_CRITICAL(&s_mux);}
        uint8_t page=current_page();uint64_t now_ms=(uint64_t)(xTaskGetTickCount()*portTICK_PERIOD_MS);
        (void)transmit_rgb(pattern_color(page,now_ms));
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

esp_err_t sb_ui_start(void)
{
    return xTaskCreateStatic(ui_task,"ui_task",UI_STACK_WORDS,NULL,2,s_stack,&s_task_struct)?ESP_OK:ESP_ERR_NO_MEM;
}

uint8_t sb_ui_get_page(void){return current_page();}

bool sb_ui_set_page(uint8_t page)
{
    if(page>6)return false;
    portENTER_CRITICAL(&s_mux);s_requested_page=page;s_page_request_pending=true;portEXIT_CRITICAL(&s_mux);return true;
}

void sb_ui_set_status_provider(sb_ui_status_provider_t provider)
{
    portENTER_CRITICAL(&s_mux);s_status_provider=provider;portEXIT_CRITICAL(&s_mux);
}
