#pragma once

#include <Arduino.h>

class DebouncedButton {
 public:
  DebouncedButton(uint8_t pin, bool active_low, uint32_t debounce_ms);

  void begin();
  void update(uint32_t now_ms);

  bool isPressed() const;
  bool pressed() const;
  bool released() const;

 private:
  bool readPressed() const;

  uint8_t pin_;
  bool active_low_;
  uint32_t debounce_ms_;
  bool stable_state_;
  bool last_raw_state_;
  bool pressed_event_;
  bool released_event_;
  uint32_t last_change_ms_;
};
