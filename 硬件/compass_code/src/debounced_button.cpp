#include "debounced_button.h"

DebouncedButton::DebouncedButton(uint8_t pin, bool active_low, uint32_t debounce_ms)
    : pin_(pin),
      active_low_(active_low),
      debounce_ms_(debounce_ms),
      stable_state_(false),
      last_raw_state_(false),
      pressed_event_(false),
      released_event_(false),
      last_change_ms_(0) {}

void DebouncedButton::begin() {
  pinMode(pin_, active_low_ ? INPUT_PULLUP : INPUT_PULLDOWN);
  stable_state_ = readPressed();
  last_raw_state_ = stable_state_;
  last_change_ms_ = millis();
}

void DebouncedButton::update(uint32_t now_ms) {
  pressed_event_ = false;
  released_event_ = false;

  const bool raw_state = readPressed();
  if (raw_state != last_raw_state_) {
    last_raw_state_ = raw_state;
    last_change_ms_ = now_ms;
  }

  if (raw_state != stable_state_ && now_ms - last_change_ms_ >= debounce_ms_) {
    stable_state_ = raw_state;
    pressed_event_ = stable_state_;
    released_event_ = !stable_state_;
  }
}

bool DebouncedButton::isPressed() const {
  return stable_state_;
}

bool DebouncedButton::pressed() const {
  return pressed_event_;
}

bool DebouncedButton::released() const {
  return released_event_;
}

bool DebouncedButton::readPressed() const {
  const bool level_high = digitalRead(pin_) == HIGH;
  return active_low_ ? !level_high : level_high;
}
