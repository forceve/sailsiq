#include "sailball/usb.h"
#include "driver/usb_serial_jtag.h"
#include "freertos/FreeRTOS.h"
#include "esp_err.h"
#include "sdkconfig.h"
#if defined(CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG) || defined(CONFIG_ESP_CONSOLE_SECONDARY_USB_SERIAL_JTAG)
#error "Sailball USB SP must not share Serial/JTAG with an IDF console"
#endif
#include <stdbool.h>
#include <string.h>
static bool s_installed;
esp_err_t sb_usb_init(void)
{
    if(s_installed)return ESP_OK;
    usb_serial_jtag_driver_config_t config=USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
    esp_err_t err=usb_serial_jtag_driver_install(&config);
    if(err==ESP_OK)s_installed=true;
    return err;
}
bool sb_usb_is_connected(void)
{
    return s_installed && usb_serial_jtag_is_connected();
}
int sb_usb_read(uint8_t *buffer,size_t capacity,uint32_t timeout_ms)
{
    if(!s_installed||buffer==NULL)return -1;
    return usb_serial_jtag_read_bytes(buffer,capacity,pdMS_TO_TICKS(timeout_ms));
}
int sb_usb_write(const uint8_t *buffer,size_t length,uint32_t timeout_ms)
{
    if(!s_installed||buffer==NULL)return -1;
    return usb_serial_jtag_write_bytes(buffer,length,pdMS_TO_TICKS(timeout_ms));
}
