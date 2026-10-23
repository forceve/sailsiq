#pragma once

// Start-line geometry. Handbook §6.3.1 / §8.1 / §8.2.
//
// Two ways to set Pin and Boat:
//   Bow offset = 0  Single-point. AC stores the current GNSS fix as that end.
//   Bow offset > 0  Precise. Each AC adds one approach: GNSS is pushed to the
//                   bow along Heading, then kept. Two or more headings that
//                   differ enough solve the mark and the leftover offset error.
//
// LINE is the signed perpendicular distance. Negative = pre-start side.
// Positive = course side. ocs_risk once that distance is more than 0.5 m.
//
// TTL is how long the current heading and speed take to hit the pin–boat
// segment, not |LINE| / SOG. burn_sec = countdown_sec - ttl_sec.
//   > 0 early (BURN), < 0 late (LATE by -burn_sec).
//
// Pin is port, Boat is starboard, looking from the pre-start side.
// Course-side normal is pin→boat rotated 90° counter-clockwise.

#include <stddef.h>
#include <stdint.h>

namespace sailsiq {

enum class StartLineEnd {
  Pin = 0,
  Boat = 1,
};

enum class LineQuality {
  None = 0,
  Poor = 1,
  Ok = 2,
  Good = 3,
};

struct StartLinePosition {
  uint8_t fix_type = 0;
  double latitude_deg = 0.0;
  double longitude_deg = 0.0;
};

struct StartLineEndPoint {
  bool valid = false;
  LineQuality quality = LineQuality::None;
  uint8_t approach_count = 0;
  float rms_m = 0.0f;
  float offset_error_m = 0.0f;
  double latitude_deg = 0.0;
  double longitude_deg = 0.0;
};

struct StartLineFix {
  bool line_valid = false;
  float line_dist_m = 0.0f;
  bool abreast = false;
  bool ocs_risk = false;
  bool ttl_valid = false;
  int32_t ttl_sec = -1;
  bool burn_valid = false;
  int32_t burn_sec = 0;
  bool box_burn_valid = false;
  int32_t box_burn_sec = 0;
  float closing_kn = 0.0f;
};

class StartLineService {
 public:
  static constexpr uint8_t kMaxApproaches = 8;
  static constexpr size_t kBlobBytes = 402;

  StartLineFix evaluate(const StartLinePosition &position, float heading_deg,
                        float speed_kn, int32_t countdown_sec,
                        int32_t box_countdown_sec) const;

  bool capture(StartLineEnd end, const StartLinePosition &position,
               float heading_deg);
  void undoLast(StartLineEnd end);
  void clearEnd(StartLineEnd end);
  void clear();

  void setBowOffsetM(float meters);
  float bowOffsetM() const;
  bool preciseMode() const;

  StartLineEndPoint pin() const;
  StartLineEndPoint boat() const;
  uint8_t approachCount(StartLineEnd end) const;
  const char *status() const;

  bool exportBlob(uint8_t *destination, size_t capacity, size_t *written) const;
  bool importBlob(const uint8_t *source, size_t length);

 private:
  struct Approach {
    bool used = false;
    double latitude_deg = 0.0;
    double longitude_deg = 0.0;
    float heading_deg = 0.0f;
    bool heading_valid = false;
  };

  struct EndPoint {
    bool valid = false;
    LineQuality quality = LineQuality::None;
    uint8_t count = 0;
    float rms_m = 0.0f;
    float offset_error_m = 0.0f;
    double latitude_deg = 0.0;
    double longitude_deg = 0.0;
    Approach approaches[kMaxApproaches] = {};
  };

  EndPoint *endPoint(StartLineEnd end);
  const EndPoint *endPoint(StartLineEnd end) const;
  void resolve(EndPoint *end);
  void setSummaryStatus();
  void setCaptureStatus(StartLineEnd end);
  StartLineEndPoint publish(const EndPoint &end) const;
  StartLinePosition bowOf(const StartLinePosition &position,
                          float heading_deg) const;

  EndPoint pin_;
  EndPoint boat_;
  float bow_offset_m_ = 0.0f;
  char status_[24] = "NO LINE";
};

}  // namespace sailsiq
