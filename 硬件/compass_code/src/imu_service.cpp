#include "imu_service.h"

bool ImuService::begin() {
  return false;
}

bool ImuService::update(uint64_t timestamp_us, bool gps_time_valid) {
  (void)timestamp_us;
  (void)gps_time_valid;
  return false;
}

bool ImuService::isReady() const {
  return false;
}

const ImuSample &ImuService::latestSample() const {
  return latest_sample_;
}
