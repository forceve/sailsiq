#pragma once

namespace sensor_calibration {

struct Vector3 {
  float x;
  float y;
  float z;
};

struct Matrix3 {
  float m[3][3];
};

// Calibration is applied after the installation pre-rotation, in the vessel
// body frame: X forward, Y starboard, Z down.
constexpr Vector3 ACCEL_BIAS_G = {0.0f, 0.0f, 0.0f};
constexpr Vector3 ACCEL_SCALE = {1.0f, 1.0f, 1.0f};

constexpr Vector3 GYRO_BIAS_DPS = {0.0f, 0.0f, 0.0f};

// Hard-iron bias in rotated MMC5983MA counts.
constexpr Vector3 MAG_BIAS_COUNTS = {0.0f, 0.0f, 0.0f};

// Soft-iron correction matrix. Start with identity, replace after calibration.
constexpr Matrix3 MAG_SOFT_IRON = {{
    {1.0f, 0.0f, 0.0f},
    {0.0f, 1.0f, 0.0f},
    {0.0f, 0.0f, 1.0f},
}};

constexpr float MAG_DECLINATION_DEG = 0.0f;

// Complementary AHRS correction gains. Higher values pull attitude harder
// toward accel/mag; lower values trust gyro more.
constexpr float AHRS_ACCEL_GAIN = 0.025f;
constexpr float AHRS_MAG_GAIN = 0.035f;

// Very small Z gyro bias adaptation when yaw is being corrected by magnetometer.
constexpr float GYRO_Z_BIAS_LEARN_GAIN = 0.0008f;

}  // namespace sensor_calibration
