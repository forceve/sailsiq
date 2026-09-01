#include "imu_service.h"

#include <math.h>

#include <Wire.h>

#include "hardware_config.h"
#include "sensor_calibration_config.h"
#include "sensor_rotation_config.h"

namespace {

constexpr float kDegreesToRadians = PI / 180.0f;
constexpr float kMmc5983MidpointCounts = 131072.0f;

void rotateVector(float vector[3],
                  const sensor_rotation::EulerDegrees &rotation) {
  const float roll = rotation.roll * kDegreesToRadians;
  const float pitch = rotation.pitch * kDegreesToRadians;
  const float yaw = rotation.yaw * kDegreesToRadians;

  const float cr = cosf(roll);
  const float sr = sinf(roll);
  const float cp = cosf(pitch);
  const float sp = sinf(pitch);
  const float cy = cosf(yaw);
  const float sy = sinf(yaw);

  float x = vector[0];
  float y = cr * vector[1] - sr * vector[2];
  float z = sr * vector[1] + cr * vector[2];

  const float pitch_x = cp * x + sp * z;
  const float pitch_y = y;
  const float pitch_z = -sp * x + cp * z;

  vector[0] = cy * pitch_x - sy * pitch_y;
  vector[1] = sy * pitch_x + cy * pitch_y;
  vector[2] = pitch_z;
}

void mapVector(float vector[3], const sensor_rotation::AxisMap &map) {
  const float x = vector[0];
  const float y = vector[1];
  const float z = vector[2];

  vector[0] = map.m[0][0] * x + map.m[0][1] * y + map.m[0][2] * z;
  vector[1] = map.m[1][0] * x + map.m[1][1] * y + map.m[1][2] * z;
  vector[2] = map.m[2][0] * x + map.m[2][1] * y + map.m[2][2] * z;
}

void calibrateAccel(const float raw[3], float calibrated[3]) {
  calibrated[0] = (raw[0] - sensor_calibration::ACCEL_BIAS_G.x) *
                  sensor_calibration::ACCEL_SCALE.x;
  calibrated[1] = (raw[1] - sensor_calibration::ACCEL_BIAS_G.y) *
                  sensor_calibration::ACCEL_SCALE.y;
  calibrated[2] = (raw[2] - sensor_calibration::ACCEL_BIAS_G.z) *
                  sensor_calibration::ACCEL_SCALE.z;
}

void calibrateGyro(const float raw[3], float calibrated[3]) {
  calibrated[0] = raw[0] - sensor_calibration::GYRO_BIAS_DPS.x;
  calibrated[1] = raw[1] - sensor_calibration::GYRO_BIAS_DPS.y;
  calibrated[2] = raw[2] - sensor_calibration::GYRO_BIAS_DPS.z;
}

void calibrateMag(const float raw[3], float calibrated[3]) {
  const float centered[3] = {
      raw[0] - sensor_calibration::MAG_BIAS_COUNTS.x,
      raw[1] - sensor_calibration::MAG_BIAS_COUNTS.y,
      raw[2] - sensor_calibration::MAG_BIAS_COUNTS.z,
  };

  for (uint8_t row = 0; row < 3; ++row) {
    calibrated[row] =
        sensor_calibration::MAG_SOFT_IRON.m[row][0] * centered[0] +
        sensor_calibration::MAG_SOFT_IRON.m[row][1] * centered[1] +
        sensor_calibration::MAG_SOFT_IRON.m[row][2] * centered[2];
  }
}

}  // namespace

bool ImuService::begin() {
  Wire.begin(hardware::i2c::SDA, hardware::i2c::SCL);
  Wire.setClock(hardware::i2c::CLOCK_HZ);

  BMI270_7Semi::Config bmi_config;
  bmi_config.bus = BMI270_7Semi::Bus::I2C;
  bmi_config.i2c = &Wire;
  bmi_config.addr = hardware::i2c::BMI270_ADDR;
  bmi_config.sda = hardware::i2c::SDA;
  bmi_config.scl = hardware::i2c::SCL;
  bmi_config.i2cHz = hardware::i2c::CLOCK_HZ;

  if (!bmi270_.begin(bmi_config)) {
    return false;
  }

  bool ok = true;
  ok &= bmi270_.setAccelConfig(BMI2_ACC_ODR_100HZ, BMI2_ACC_RANGE_2G,
                               BMI2_ACC_NORMAL_AVG4,
                               BMI2_PERF_OPT_MODE) == BMI2_OK;
  ok &= bmi270_.setGyroConfig(BMI2_GYR_ODR_100HZ, BMI2_GYR_RANGE_2000,
                              BMI2_GYR_NORMAL_MODE,
                              BMI2_PERF_OPT_MODE) == BMI2_OK;

  ok &= mmc5983ma_.begin(Wire);
  ok &= mmc5983ma_.softReset();
  ok &= mmc5983ma_.setFilterBandwidth(100);
  ok &= mmc5983ma_.setContinuousModeFrequency(100);
  ok &= mmc5983ma_.enableContinuousMode();
  ok &= mmc5983ma_.enableAutomaticSetReset();

  ready_ = ok;
  next_read_us_ = micros();
  return ready_;
}

bool ImuService::update(uint64_t timestamp_us, bool gps_time_valid) {
  if (!ready_) {
    return false;
  }

  const uint32_t now_us = micros();
  if (static_cast<int32_t>(now_us - next_read_us_) < 0) {
    return false;
  }

  next_read_us_ += hardware::imu::READ_INTERVAL_US;
  if (static_cast<int32_t>(now_us - next_read_us_) >= 0) {
    next_read_us_ = now_us + hardware::imu::READ_INTERVAL_US;
  }

  latest_sample_.timestamp_us = timestamp_us;
  latest_sample_.gps_time_valid = gps_time_valid;
  latest_sample_.accel_valid = bmi270_.readAccel(
      latest_sample_.accel_g[0], latest_sample_.accel_g[1],
      latest_sample_.accel_g[2]);
  latest_sample_.gyro_valid = bmi270_.readGyro(
      latest_sample_.gyro_dps[0], latest_sample_.gyro_dps[1],
      latest_sample_.gyro_dps[2]);
  latest_sample_.mag_valid = mmc5983ma_.readFieldsXYZ(
      &latest_sample_.mag_raw[0], &latest_sample_.mag_raw[1],
      &latest_sample_.mag_raw[2]);

  if (latest_sample_.accel_valid) {
    mapVector(latest_sample_.accel_g, sensor_rotation::BMI270_AXIS_MAP);
    calibrateAccel(latest_sample_.accel_g, latest_sample_.accel_cal_g);
  }

  if (latest_sample_.gyro_valid) {
    mapVector(latest_sample_.gyro_dps, sensor_rotation::BMI270_AXIS_MAP);
    calibrateGyro(latest_sample_.gyro_dps, latest_sample_.gyro_cal_dps);
  }

  if (latest_sample_.mag_valid) {
    latest_sample_.mag_counts[0] =
        static_cast<float>(latest_sample_.mag_raw[0]) - kMmc5983MidpointCounts;
    latest_sample_.mag_counts[1] =
        static_cast<float>(latest_sample_.mag_raw[1]) - kMmc5983MidpointCounts;
    latest_sample_.mag_counts[2] =
        static_cast<float>(latest_sample_.mag_raw[2]) - kMmc5983MidpointCounts;
    mapVector(latest_sample_.mag_counts,
              sensor_rotation::MMC5983MA_AXIS_MAP);
    calibrateMag(latest_sample_.mag_counts, latest_sample_.mag_cal_counts);
  }

  return latest_sample_.accel_valid || latest_sample_.gyro_valid ||
         latest_sample_.mag_valid;
}

bool ImuService::isReady() const {
  return ready_;
}

const ImuSample &ImuService::latestSample() const {
  return latest_sample_;
}
