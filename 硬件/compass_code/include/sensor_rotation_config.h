#pragma once

namespace sensor_rotation {

struct EulerDegrees {
  float roll;
  float pitch;
  float yaw;
};

struct AxisMap {
  float m[3][3];
};

// Rotation order for later application: roll(X), pitch(Y), yaw(Z), in degrees.
constexpr EulerDegrees BMI270_PRE_ROTATION_DEG = {
    90.0f,
    90.0f,
    0.0f,
};

constexpr EulerDegrees MMC5983MA_PRE_ROTATION_DEG = {
    0.0f,
    0.0f,
    0.0f,
};

// Direct sensor-frame to vessel body-frame maps.
// Body frame: X forward, Y starboard, Z down.
// Matrix rows output body X/Y/Z; columns input sensor X/Y/Z.
//
// BMI270 mounting from user:
// sensor X+ = sky     = body Z-
// sensor Y+ = bow     = body X+
// sensor Z+ = port    = body Y-
constexpr AxisMap BMI270_AXIS_MAP = {{
    {0.0f, 1.0f, 0.0f},
    {0.0f, 0.0f, -1.0f},
    {-1.0f, 0.0f, 0.0f},
}};

// MMC5983MA mounting from user:
// sensor X+ = bow       = body X+
// sensor Y+ = ground    = body Z+
// sensor Z+ = starboard = body Y+
//
// This is not representable as a pure right-handed Euler rotation, so the
// matrix map is used directly.
constexpr AxisMap MMC5983MA_AXIS_MAP = {{
    {1.0f, 0.0f, 0.0f},
    {0.0f, 0.0f, 1.0f},
    {0.0f, 1.0f, 0.0f},
}};

}  // namespace sensor_rotation
