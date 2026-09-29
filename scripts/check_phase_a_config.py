"""Check the generated config, not merely profile defaults."""
import sys
from pathlib import Path

def check(path):
    config = dict(line.split('=', 1) for line in Path(path).read_text().splitlines()
                  if line.startswith('CONFIG_') and '=' in line)
    required = dict(ESP_CONSOLE_NONE='y', ESP_CONSOLE_SECONDARY_NONE='y',
                    ESP_SYSTEM_PANIC_SILENT_REBOOT='y', BOOTLOADER_LOG_LEVEL='0',
                    ESPTOOLPY_FLASHSIZE_4MB='y',
                    BT_NIMBLE_MAX_CONNECTIONS='1', FREERTOS_TASK_NOTIFICATION_ARRAY_ENTRIES='2',
                    SAILBALL_GNSS_UART1='y', SAILBALL_SD_SPI2_HOST='y',
                    SAILBALL_GNSS_RUNTIME_BAUD='115200', SAILBALL_GNSS_UPDATE_RATE_HZ='10',
                    SAILBALL_GNSS_SAMPLE_RATE_NUM='10', SAILBALL_GNSS_SAMPLE_RATE_DEN='1',
                    SAILBALL_GNSS_RX_GPIO='0', SAILBALL_GNSS_TX_GPIO='1',
                    SAILBALL_SD_CS_GPIO='4', SAILBALL_SD_MOSI_GPIO='5',
                    SAILBALL_SD_SCLK_GPIO='6', SAILBALL_SD_MISO_GPIO='7',
                    SAILBALL_LED_GPIO='8', SAILBALL_BOOT_GPIO='9')
    failures = [key for key, value in required.items() if config.get('CONFIG_' + key) != value]
    for key in ['ESP_CONSOLE_USB_SERIAL_JTAG', 'ESP_CONSOLE_SECONDARY_USB_SERIAL_JTAG']:
        if config.get('CONFIG_' + key) == 'y':
            failures.append(key)
    if 'validation' in Path(path).name and config.get('CONFIG_SAILBALL_VALIDATION_METRICS') != 'y':
        failures.append('VALIDATION_METRICS')
    if failures:
        print('FAIL Phase A config: ' + ', '.join(failures))
        return 1
    if any('PPS' in key for key in config):
        print('FAIL Phase A config: v1 board must not configure a GNSS PPS net')
        return 1
    print('PASS generated config: fixed C3 board map, GNSS 115200/10 Hz target, binary-clean USB and profile safety')
    return 0

if __name__ == '__main__':
    raise SystemExit(check(sys.argv[1]))
