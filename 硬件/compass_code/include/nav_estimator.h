#pragma once

#include <Arduino.h>

#include "imu_service.h"

struct NavEstimate {
  float heading_deg = NAN;
  float roll_deg = NAN;
  float pitch_deg = NAN;
  bool attitude_valid = false;
};

class NavEstimator {
 public:
  struct Quaternion {
    float w;
    float x;
    float y;
    float z;
  };

  void update(const ImuSample &sample);
  const NavEstimate &latest() const;

 private:
  void updateAttitude(const ImuSample &sample, float dt_s);
  bool measuredAttitude(const ImuSample &sample, Quaternion *q_measured,
                        bool *mag_used) const;
  void publishAttitude();

  NavEstimate latest_;
  Quaternion attitude_{1.0f, 0.0f, 0.0f, 0.0f};
  uint64_t last_sample_timestamp_us_ = 0;
  bool attitude_initialized_ = false;
};
