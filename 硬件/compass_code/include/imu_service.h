#pragma once

#include <Arduino.h>
#include <SparkFun_MMC5983MA_Arduino_Library.h>
#include <7Semi_BMI270.h>

struct ImuSample {
  uint64_t timestamp_us = 0;
  bool gps_time_valid = false;
  float accel_g[3] = {0.0f, 0.0f, 0.0f};
  float gyro_dps[3] = {0.0f, 0.0f, 0.0f};
  uint32_t mag_raw[3] = {0, 0, 0};
  float mag_counts[3] = {0.0f, 0.0f, 0.0f};
  float accel_cal_g[3] = {0.0f, 0.0f, 0.0f};
  float gyro_cal_dps[3] = {0.0f, 0.0f, 0.0f};
  float mag_cal_counts[3] = {0.0f, 0.0f, 0.0f};
  bool accel_valid = false;
  bool gyro_valid = false;
  bool mag_valid = false;
};

class ImuService {
 public:
  bool begin();
  bool update(uint64_t timestamp_us, bool gps_time_valid);

  bool isReady() const;
  const ImuSample &latestSample() const;

 private:
  BMI270_7Semi bmi270_;
  SFE_MMC5983MA mmc5983ma_;
  bool ready_ = false;
  uint32_t next_read_us_ = 0;
  ImuSample latest_sample_;
};
