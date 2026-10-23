#pragma once

#include <Arduino.h>
#include <TinyGPS++.h>

struct GpsUtcTime {
  uint16_t year = 0;
  uint8_t month = 0;
  uint8_t day = 0;
  uint8_t hour = 0;
  uint8_t minute = 0;
  uint8_t second = 0;
  int32_t nanosecond = 0;
  uint32_t accuracy_ns = 0;
};

struct GnssNavSnapshot {
  uint8_t fix_type = 0;
  uint8_t satellites = 0;
  float sog_kn = NAN;
  float cog_deg = NAN;
  double latitude_deg = NAN;
  double longitude_deg = NAN;
};

class GnssService {
 public:
  bool begin();
  void update();

  bool isReady() const;
  uint32_t detectedBaudRate() const;
  bool hasTime() const;
  GpsUtcTime latestUtc() const;
  GnssNavSnapshot latestNav() const;
  uint64_t gpsTimeMicros() const;
  uint16_t loggedBytesAvailable();
  uint16_t maxLoggedBytesAvailable();
  void clearMaxLoggedBytesAvailable();
  uint16_t readLoggedUbx(uint8_t *destination, uint16_t max_bytes);

 private:
  static constexpr uint16_t kLogCapacity = 8192;
  static constexpr uint32_t kFreshMs = 1500;

  bool probeBaud(uint32_t baud_rate);
  void openPort(uint32_t baud_rate);
  void configureModule(uint32_t detected_baud_rate);
  void publish();
  void noteTime(uint16_t year, uint8_t month, uint8_t day, uint8_t hour,
                uint8_t minute, uint8_t second, uint8_t centisecond);
  void pushLog(uint8_t byte);
  void clearLog();

  HardwareSerial serial_{1};
  TinyGPSPlus gps_;
  bool ready_ = false;
  bool has_time_ = false;
  uint32_t detected_baud_rate_ = 0;
  GpsUtcTime latest_utc_;
  GnssNavSnapshot latest_nav_;
  uint64_t gps_anchor_us_ = 0;
  uint32_t local_anchor_us_ = 0;
  uint8_t log_buffer_[kLogCapacity] = {};
  uint16_t log_head_ = 0;
  uint16_t log_tail_ = 0;
  uint16_t log_count_ = 0;
  uint16_t log_max_ = 0;
};
