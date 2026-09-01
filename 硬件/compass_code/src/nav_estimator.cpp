#include "nav_estimator.h"

#include <math.h>

#include "sensor_calibration_config.h"

namespace {

constexpr float kDegreesToRadians = PI / 180.0f;
constexpr float kRadiansToDegrees = 180.0f / PI;
constexpr float kMinAccelNormG = 0.65f;
constexpr float kMaxAccelNormG = 1.35f;
constexpr float kMinMagNormCounts = 1000.0f;

float normalizeDegrees(float degrees) {
  while (degrees < 0.0f) {
    degrees += 360.0f;
  }
  while (degrees >= 360.0f) {
    degrees -= 360.0f;
  }
  return degrees;
}

float vectorNorm(const float v[3]) {
  return sqrtf(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

NavEstimator::Quaternion normalizeQuat(NavEstimator::Quaternion q) {
  const float norm = sqrtf(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);
  if (norm <= 0.0f || !isfinite(norm)) {
    return {1.0f, 0.0f, 0.0f, 0.0f};
  }
  const float inv_norm = 1.0f / norm;
  q.w *= inv_norm;
  q.x *= inv_norm;
  q.y *= inv_norm;
  q.z *= inv_norm;
  return q;
}

float quatDot(const NavEstimator::Quaternion &a,
              const NavEstimator::Quaternion &b) {
  return a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
}

NavEstimator::Quaternion quatFromEuler(float roll_rad, float pitch_rad,
                                       float yaw_rad) {
  const float cr = cosf(roll_rad * 0.5f);
  const float sr = sinf(roll_rad * 0.5f);
  const float cp = cosf(pitch_rad * 0.5f);
  const float sp = sinf(pitch_rad * 0.5f);
  const float cy = cosf(yaw_rad * 0.5f);
  const float sy = sinf(yaw_rad * 0.5f);

  return normalizeQuat({
      cr * cp * cy + sr * sp * sy,
      sr * cp * cy - cr * sp * sy,
      cr * sp * cy + sr * cp * sy,
      cr * cp * sy - sr * sp * cy,
  });
}

void eulerFromQuat(const NavEstimator::Quaternion &q, float *roll_rad,
                   float *pitch_rad, float *yaw_rad) {
  const float sinr_cosp = 2.0f * (q.w * q.x + q.y * q.z);
  const float cosr_cosp = 1.0f - 2.0f * (q.x * q.x + q.y * q.y);
  *roll_rad = atan2f(sinr_cosp, cosr_cosp);

  const float sinp = 2.0f * (q.w * q.y - q.z * q.x);
  if (fabsf(sinp) >= 1.0f) {
    *pitch_rad = copysignf(PI * 0.5f, sinp);
  } else {
    *pitch_rad = asinf(sinp);
  }

  const float siny_cosp = 2.0f * (q.w * q.z + q.x * q.y);
  const float cosy_cosp = 1.0f - 2.0f * (q.y * q.y + q.z * q.z);
  *yaw_rad = atan2f(siny_cosp, cosy_cosp);
}

NavEstimator::Quaternion blendQuat(NavEstimator::Quaternion current,
                                   NavEstimator::Quaternion measured,
                                   float alpha) {
  if (quatDot(current, measured) < 0.0f) {
    measured.w = -measured.w;
    measured.x = -measured.x;
    measured.y = -measured.y;
    measured.z = -measured.z;
  }

  current.w = current.w * (1.0f - alpha) + measured.w * alpha;
  current.x = current.x * (1.0f - alpha) + measured.x * alpha;
  current.y = current.y * (1.0f - alpha) + measured.y * alpha;
  current.z = current.z * (1.0f - alpha) + measured.z * alpha;
  return normalizeQuat(current);
}

}  // namespace

void NavEstimator::update(const ImuSample &sample) {
  float dt_s = 0.0f;
  if (last_sample_timestamp_us_ != 0 &&
      sample.timestamp_us > last_sample_timestamp_us_) {
    dt_s = static_cast<float>(sample.timestamp_us - last_sample_timestamp_us_) *
           0.000001f;
  }
  last_sample_timestamp_us_ = sample.timestamp_us;

  if (dt_s <= 0.0f || dt_s > 0.25f) {
    updateAttitude(sample, 0.0f);
    return;
  }

  updateAttitude(sample, dt_s);
}

const NavEstimate &NavEstimator::latest() const {
  return latest_;
}

void NavEstimator::updateAttitude(const ImuSample &sample, float dt_s) {
  Quaternion measured = {1.0f, 0.0f, 0.0f, 0.0f};
  bool mag_used = false;
  const bool has_measured = measuredAttitude(sample, &measured, &mag_used);

  if (!attitude_initialized_) {
    if (!has_measured) {
      return;
    }
    attitude_ = measured;
    attitude_initialized_ = true;
    publishAttitude();
    return;
  }

  if (sample.gyro_valid && dt_s > 0.0f) {
    const float gx = sample.gyro_cal_dps[0] * kDegreesToRadians;
    const float gy = sample.gyro_cal_dps[1] * kDegreesToRadians;
    const float gz = 0.0f;

    const Quaternion q = attitude_;
    attitude_.w += 0.5f * (-q.x * gx - q.y * gy - q.z * gz) * dt_s;
    attitude_.x += 0.5f * (q.w * gx + q.y * gz - q.z * gy) * dt_s;
    attitude_.y += 0.5f * (q.w * gy - q.x * gz + q.z * gx) * dt_s;
    attitude_.z += 0.5f * (q.w * gz + q.x * gy - q.y * gx) * dt_s;
    attitude_ = normalizeQuat(attitude_);
  }

  if (has_measured) {
    float roll_rad = 0.0f;
    float pitch_rad = 0.0f;
    float yaw_rad = 0.0f;
    float measured_roll = 0.0f;
    float measured_pitch = 0.0f;
    float measured_yaw = 0.0f;
    eulerFromQuat(attitude_, &roll_rad, &pitch_rad, &yaw_rad);
    eulerFromQuat(measured, &measured_roll, &measured_pitch, &measured_yaw);

    const float gain = mag_used ? sensor_calibration::AHRS_MAG_GAIN
                                : sensor_calibration::AHRS_ACCEL_GAIN;
    attitude_ = blendQuat(attitude_, measured, gain);
    if (mag_used) {
      eulerFromQuat(attitude_, &roll_rad, &pitch_rad, &yaw_rad);
      attitude_ = quatFromEuler(roll_rad, pitch_rad, measured_yaw);
    }
  }

  publishAttitude();
}

bool NavEstimator::measuredAttitude(const ImuSample &sample,
                                    Quaternion *q_measured,
                                    bool *mag_used) const {
  *mag_used = false;
  if (!sample.accel_valid) {
    return false;
  }

  const float accel_norm = vectorNorm(sample.accel_cal_g);
  if (accel_norm < kMinAccelNormG || accel_norm > kMaxAccelNormG) {
    return false;
  }

  const float ax = sample.accel_cal_g[0] / accel_norm;
  const float ay = sample.accel_cal_g[1] / accel_norm;
  const float az = sample.accel_cal_g[2] / accel_norm;
  const float roll_rad = atan2f(ay, az);
  const float pitch_rad = atan2f(-ax, sqrtf(ay * ay + az * az));

  float yaw_rad = 0.0f;
  if (attitude_initialized_) {
    float current_roll = 0.0f;
    float current_pitch = 0.0f;
    eulerFromQuat(attitude_, &current_roll, &current_pitch, &yaw_rad);
  }

  if (sample.mag_valid && vectorNorm(sample.mag_cal_counts) > kMinMagNormCounts) {
    const float mx = sample.mag_cal_counts[0];
    const float my = sample.mag_cal_counts[1];
    const float mz = sample.mag_cal_counts[2];
    const float cr = cosf(roll_rad);
    const float sr = sinf(roll_rad);
    const float cp = cosf(pitch_rad);
    const float sp = sinf(pitch_rad);

    const float mag_x_horizontal = mx * cp + mz * sp;
    const float mag_y_horizontal =
        mx * sr * sp + my * cr - mz * sr * cp;
    yaw_rad = atan2f(mag_y_horizontal, mag_x_horizontal) +
              sensor_calibration::MAG_DECLINATION_DEG * kDegreesToRadians;
    *mag_used = true;
  }

  *q_measured = quatFromEuler(roll_rad, pitch_rad, yaw_rad);
  return true;
}

void NavEstimator::publishAttitude() {
  float roll_rad = 0.0f;
  float pitch_rad = 0.0f;
  float yaw_rad = 0.0f;
  eulerFromQuat(attitude_, &roll_rad, &pitch_rad, &yaw_rad);
  latest_.roll_deg = roll_rad * kRadiansToDegrees;
  latest_.pitch_deg = pitch_rad * kRadiansToDegrees;
  latest_.heading_deg = normalizeDegrees(yaw_rad * kRadiansToDegrees);
  latest_.attitude_valid = attitude_initialized_;
}
