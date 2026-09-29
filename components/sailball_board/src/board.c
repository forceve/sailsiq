#include "sailball/board.h"
#include "sailball/common.h"
#include "esp_mac.h"
#include "esp_system.h"
#include "esp_random.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "driver/uart.h"
#include "sdkconfig.h"
#include <string.h>

static sb_board_info_t s_info;

esp_err_t sb_board_init(void)
{
    uint8_t mac[6] = {0};
    esp_err_t err = esp_read_mac(mac, ESP_MAC_EFUSE_FACTORY);
    if (err != ESP_OK) return err;
    s_info.device_id = ((uint64_t)mac[0] << 40) | ((uint64_t)mac[1] << 32) |
                       ((uint64_t)mac[2] << 24) | ((uint64_t)mac[3] << 16) |
                       ((uint64_t)mac[4] << 8) | mac[5];
    do { s_info.boot_id = esp_random(); } while (s_info.boot_id == 0);
#if CONFIG_SAILBALL_GNSS_UART1
    s_info.gnss_configured = true;
    s_info.gnss_uart_port = UART_NUM_1;
    s_info.gnss_rx_gpio = CONFIG_SAILBALL_GNSS_RX_GPIO;
    s_info.gnss_tx_gpio = CONFIG_SAILBALL_GNSS_TX_GPIO;
#endif
#if CONFIG_SAILBALL_SD_SPI2_HOST
    s_info.sd_configured = true;
    s_info.sd_spi_host = SPI2_HOST;
    s_info.sd_mosi_gpio = CONFIG_SAILBALL_SD_MOSI_GPIO;
    s_info.sd_miso_gpio = CONFIG_SAILBALL_SD_MISO_GPIO;
    s_info.sd_sclk_gpio = CONFIG_SAILBALL_SD_SCLK_GPIO;
    s_info.sd_cs_gpio = CONFIG_SAILBALL_SD_CS_GPIO;
#endif
    s_info.boot_button_configured = true;
    s_info.boot_gpio = CONFIG_SAILBALL_BOOT_GPIO;
    s_info.led_configured = true;
    s_info.led_gpio = CONFIG_SAILBALL_LED_GPIO;
    s_info.usb_native = true;
    s_info.usb_dminus_gpio = GPIO_NUM_18;
    s_info.usb_dplus_gpio = GPIO_NUM_19;
    s_info.hardware_revision = CONFIG_SAILBALL_BOARD_REVISION;
    return ESP_OK;
}

void sb_board_get_info(sb_board_info_t *out)
{
    if (out != NULL) memcpy(out, &s_info, sizeof(*out));
}
