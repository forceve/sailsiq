#pragma once

#include <Arduino.h>
#include <SparkFun_u-blox_GNSS_v3.h>

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
  bool tryBeginAtBaud(uint32_t baud_rate);
  bool configureModule(uint32_t detected_baud_rate);
  static void onPvt(UBX_NAV_PVT_data_t *pvt);
  void handlePvt(const UBX_NAV_PVT_data_t &pvt);

  static GnssService *instance_;

  HardwareSerial serial_{1};
  SFE_UBLOX_GNSS_SERIAL gnss_;
  bool ready_ = false;
  bool has_time_ = false;
  uint32_t detected_baud_rate_ = 0;
  GpsUtcTime latest_utc_;
  GnssNavSnapshot latest_nav_;
  uint64_t gps_anchor_us_ = 0;
  uint32_t local_anchor_us_ = 0;
};
