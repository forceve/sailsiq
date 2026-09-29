#ifndef SB_CONGESTION_ADAPTERS_H
#define SB_CONGESTION_ADAPTERS_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
void sb_test_ble_adapter_init(void);
void sb_test_ble_notify_mode(unsigned mode);
unsigned sb_test_ble_notify_calls(void);
unsigned sb_test_ble_notify_successes(void);
unsigned sb_test_ble_notify_failures(void);
unsigned sb_test_ble_terminal_sent(void);
uint32_t sb_test_ble_last_terminal_generation(void);
uint32_t sb_test_ble_last_terminal_request(void);
uint32_t sb_test_ble_last_terminal_sequence(void);
bool sb_test_ble_session_ended(void);
bool sb_test_ble_connected(void);
uint32_t sb_test_ble_session_generation(void);
void sb_test_ble_reconnect(void);
void sb_test_ble_notify_enabled(bool enabled);
void sb_test_ble_mbuf_available(bool available);
bool sb_test_ble_active(void);
void sb_test_ble_disconnect(void);
void sb_test_wifi_adapter_init(void);
void sb_test_wifi_send_mode(unsigned mode);
unsigned sb_test_wifi_send_calls(void);
unsigned sb_test_wifi_wouldblock_calls(void);
unsigned sb_test_wifi_zero_calls(void);
unsigned sb_test_wifi_partial_calls(void);
size_t sb_test_wifi_sent_length(void);
unsigned sb_test_wifi_terminal_sent(void);
uint32_t sb_test_wifi_last_terminal_generation(void);
uint32_t sb_test_wifi_last_terminal_request(void);
uint32_t sb_test_wifi_last_terminal_sequence(void);
unsigned sb_test_wifi_bulk_sent(void);
bool sb_test_wifi_active(void);
void sb_test_wifi_disconnect(void);
void sb_test_wifi_reconnect(void);
void sb_test_abort_storage_epoch_on_physical_send(void);
void sb_test_storage_abort_at_physical_send(void);
bool sb_test_wifi_connected(void);
#endif
