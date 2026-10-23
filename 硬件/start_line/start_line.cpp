#include "start_line.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

namespace sailsiq {
namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kMetersPerDegLat = 111132.954;
constexpr double kKnToMps = 1852.0 / 3600.0;
constexpr double kMinLineLengthM = 8.0;
constexpr double kMinClosingMps = 0.05;
constexpr double kOnLineM = 0.5;
constexpr double kEndToleranceM = 1.0;
constexpr float kTtlMinSpeedKn = 1.0f;
constexpr float kQualityGoodM = 4.0f;
constexpr float kQualityOkM = 10.0f;
constexpr float kMinHeadingSpanDeg = 40.0f;
constexpr float kMaxBowOffsetM = 12.0f;
constexpr float kMaxOffsetErrorM = 6.0f;
constexpr int32_t kMaxTtlSec = 3600;
constexpr uint32_t kBlobMagic = 0x324E4C53u;  // 'SLN2'
constexpr uint16_t kBlobVersion = 2;

#pragma pack(push, 1)
struct ApproachRec {
  double lat;
  double lon;
  float heading;
  uint8_t heading_valid;
  uint8_t pad[3];
};

struct Blob {
  uint32_t magic;
  uint16_t version;
  uint16_t size;
  float bow_offset_m;
  uint8_t pin_count;
  uint8_t boat_count;
  ApproachRec pin[StartLineService::kMaxApproaches];
  ApproachRec boat[StartLineService::kMaxApproaches];
  uint32_t crc32;
};
#pragma pack(pop)

static_assert(sizeof(ApproachRec) == 24, "approach record");
static_assert(sizeof(Blob) == StartLineService::kBlobBytes, "start line blob");

uint32_t crc32Bytes(const uint8_t *data, size_t length) {
  uint32_t crc = 0xFFFFFFFFu;
  for (size_t i = 0; i < length; ++i) {
    crc ^= data[i];
    for (uint8_t bit = 0; bit < 8; ++bit) {
      uint32_t mask = 0u - (crc & 1u);
      crc = (crc >> 1) ^ (0xEDB88320u & mask);
    }
  }
  return ~crc;
}

bool finiteNumber(double value) {
  return isfinite(value);
}

bool positionUsable(const StartLinePosition &position) {
  return position.fix_type >= 2 && finiteNumber(position.latitude_deg) &&
         finiteNumber(position.longitude_deg) &&
         position.latitude_deg >= -90.0 && position.latitude_deg <= 90.0 &&
         position.longitude_deg >= -180.0 && position.longitude_deg <= 180.0;
}

void copyStatus(char *destination, size_t length, const char *text) {
  snprintf(destination, length, "%s", text);
}

const char *endName(StartLineEnd end) {
  return end == StartLineEnd::Boat ? "BOAT" : "PIN";
}

void project(double latitude_deg, double longitude_deg, double origin_lat_deg,
             double origin_lon_deg, double *east_m, double *north_m) {
  double lat0_rad = origin_lat_deg * kPi / 180.0;
  double meters_per_deg_lon = kMetersPerDegLat * cos(lat0_rad);
  if (fabs(meters_per_deg_lon) < 1.0) {
    meters_per_deg_lon = 1.0;
  }
  *east_m = (longitude_deg - origin_lon_deg) * meters_per_deg_lon;
  *north_m = (latitude_deg - origin_lat_deg) * kMetersPerDegLat;
}

void unproject(double east_m, double north_m, double origin_lat_deg,
               double origin_lon_deg, double *latitude_deg,
               double *longitude_deg) {
  double lat0_rad = origin_lat_deg * kPi / 180.0;
  double meters_per_deg_lon = kMetersPerDegLat * cos(lat0_rad);
  if (fabs(meters_per_deg_lon) < 1.0) {
    meters_per_deg_lon = 1.0;
  }
  *latitude_deg = origin_lat_deg + north_m / kMetersPerDegLat;
  *longitude_deg = origin_lon_deg + east_m / meters_per_deg_lon;
}

float wrap180(float deg) {
  while (deg > 180.0f) {
    deg -= 360.0f;
  }
  while (deg <= -180.0f) {
    deg += 360.0f;
  }
  return deg;
}

int32_t secondsFrom(double seconds) {
  if (seconds >= 0.0) {
    return static_cast<int32_t>(seconds + 0.5);
  }
  return static_cast<int32_t>(seconds - 0.5);
}

LineQuality qualityFromRms(float rms_m) {
  if (rms_m <= kQualityGoodM) {
    return LineQuality::Good;
  }
  if (rms_m <= kQualityOkM) {
    return LineQuality::Ok;
  }
  return LineQuality::Poor;
}

void headingUnit(float heading_deg, double *east, double *north) {
  double heading_rad = static_cast<double>(heading_deg) * kPi / 180.0;
  *east = sin(heading_rad);
  *north = cos(heading_rad);
}

bool solve3x3(double A[3][3], const double b[3], double x[3]) {
  double M[3][4];
  for (int r = 0; r < 3; ++r) {
    M[r][0] = A[r][0];
    M[r][1] = A[r][1];
    M[r][2] = A[r][2];
    M[r][3] = b[r];
  }

  for (int col = 0; col < 3; ++col) {
    int pivot = col;
    for (int r = col + 1; r < 3; ++r) {
      if (fabs(M[r][col]) > fabs(M[pivot][col])) {
        pivot = r;
      }
    }
    if (fabs(M[pivot][col]) < 1e-8) {
      return false;
    }
    if (pivot != col) {
      for (int c = 0; c < 4; ++c) {
        double tmp = M[col][c];
        M[col][c] = M[pivot][c];
        M[pivot][c] = tmp;
      }
    }
    double div = M[col][col];
    for (int c = col; c < 4; ++c) {
      M[col][c] /= div;
    }
    for (int r = 0; r < 3; ++r) {
      if (r == col) {
        continue;
      }
      double factor = M[r][col];
      for (int c = col; c < 4; ++c) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }

  x[0] = M[0][3];
  x[1] = M[1][3];
  x[2] = M[2][3];
  return finiteNumber(x[0]) && finiteNumber(x[1]) && finiteNumber(x[2]);
}

float maxHeadingSpan(const float *heading, const bool *heading_valid,
                     uint8_t count) {
  float best = 0.0f;
  for (uint8_t i = 0; i < count; ++i) {
    if (!heading_valid[i]) {
      continue;
    }
    for (uint8_t j = static_cast<uint8_t>(i + 1); j < count; ++j) {
      if (!heading_valid[j]) {
        continue;
      }
      float delta = fabsf(wrap180(heading[i] - heading[j]));
      if (delta > best) {
        best = delta;
      }
    }
  }
  return best;
}

}  // namespace

StartLineService::EndPoint *StartLineService::endPoint(StartLineEnd end) {
  return end == StartLineEnd::Boat ? &boat_ : &pin_;
}

const StartLineService::EndPoint *StartLineService::endPoint(
    StartLineEnd end) const {
  return end == StartLineEnd::Boat ? &boat_ : &pin_;
}

StartLinePosition StartLineService::bowOf(const StartLinePosition &position,
                                          float heading_deg) const {
  StartLinePosition bow = position;
  if (bow_offset_m_ <= 0.01f || !isfinite(heading_deg)) {
    return bow;
  }
  double east = 0.0;
  double north = 0.0;
  headingUnit(heading_deg, &east, &north);
  unproject(east * static_cast<double>(bow_offset_m_),
            north * static_cast<double>(bow_offset_m_), position.latitude_deg,
            position.longitude_deg, &bow.latitude_deg, &bow.longitude_deg);
  return bow;
}

void StartLineService::resolve(EndPoint *end) {
  if (end == nullptr) {
    return;
  }

  uint8_t count = 0;
  double lat[kMaxApproaches] = {};
  double lon[kMaxApproaches] = {};
  float heading[kMaxApproaches] = {};
  bool heading_ok[kMaxApproaches] = {};
  for (uint8_t i = 0; i < kMaxApproaches; ++i) {
    if (!end->approaches[i].used) {
      continue;
    }
    StartLinePosition gnss;
    gnss.fix_type = 3;
    gnss.latitude_deg = end->approaches[i].latitude_deg;
    gnss.longitude_deg = end->approaches[i].longitude_deg;
    float hdg = end->approaches[i].heading_deg;
    bool have_hdg = end->approaches[i].heading_valid;
    StartLinePosition bow = have_hdg ? bowOf(gnss, hdg) : gnss;
    lat[count] = bow.latitude_deg;
    lon[count] = bow.longitude_deg;
    heading[count] = hdg;
    heading_ok[count] = have_hdg;
    ++count;
  }
  end->count = count;
  end->offset_error_m = 0.0f;
  end->rms_m = 0.0f;
  if (count == 0) {
    end->valid = false;
    end->quality = LineQuality::None;
    return;
  }

  double origin_lat = 0.0;
  double origin_lon = 0.0;
  for (uint8_t i = 0; i < count; ++i) {
    origin_lat += lat[i];
    origin_lon += lon[i];
  }
  origin_lat /= static_cast<double>(count);
  origin_lon /= static_cast<double>(count);

  double east[kMaxApproaches] = {};
  double north[kMaxApproaches] = {};
  for (uint8_t i = 0; i < count; ++i) {
    project(lat[i], lon[i], origin_lat, origin_lon, &east[i], &north[i]);
  }

  uint8_t headed = 0;
  for (uint8_t i = 0; i < count; ++i) {
    if (heading_ok[i]) {
      ++headed;
    }
  }
  float span = maxHeadingSpan(heading, heading_ok, count);

  double mark_e = 0.0;
  double mark_n = 0.0;
  double delta = 0.0;
  bool solved = false;
  if (headed >= 2 && span >= kMinHeadingSpanDeg) {
    double ATA[3][3] = {};
    double ATb[3] = {};
    for (uint8_t i = 0; i < count; ++i) {
      if (!heading_ok[i]) {
        continue;
      }
      double ue = 0.0;
      double un = 0.0;
      headingUnit(heading[i], &ue, &un);
      double a0[3] = {1.0, 0.0, -ue};
      double a1[3] = {0.0, 1.0, -un};
      for (int r = 0; r < 3; ++r) {
        ATb[r] += a0[r] * east[i] + a1[r] * north[i];
        for (int c = 0; c < 3; ++c) {
          ATA[r][c] += a0[r] * a0[c] + a1[r] * a1[c];
        }
      }
    }
    double x[3] = {};
    if (solve3x3(ATA, ATb, x) && fabs(x[2]) <= kMaxOffsetErrorM) {
      mark_e = x[0];
      mark_n = x[1];
      delta = x[2];
      solved = true;
    }
  }

  if (!solved) {
    for (uint8_t i = 0; i < count; ++i) {
      mark_e += east[i];
      mark_n += north[i];
    }
    mark_e /= static_cast<double>(count);
    mark_n /= static_cast<double>(count);
  }

  double sum_sq = 0.0;
  for (uint8_t i = 0; i < count; ++i) {
    double de = east[i] - mark_e;
    double dn = north[i] - mark_n;
    if (solved && heading_ok[i]) {
      double ue = 0.0;
      double un = 0.0;
      headingUnit(heading[i], &ue, &un);
      de = (east[i] + delta * ue) - mark_e;
      dn = (north[i] + delta * un) - mark_n;
    }
    sum_sq += de * de + dn * dn;
  }

  unproject(mark_e, mark_n, origin_lat, origin_lon, &end->latitude_deg,
            &end->longitude_deg);
  end->valid = true;
  end->offset_error_m = solved ? static_cast<float>(delta) : 0.0f;
  end->rms_m = static_cast<float>(sqrt(sum_sq / static_cast<double>(count)));
  if (count == 1) {
    end->quality = LineQuality::Good;
    end->rms_m = 0.0f;
  } else if (solved) {
    end->quality = qualityFromRms(end->rms_m);
  } else {
    end->quality = LineQuality::Poor;
  }
}

StartLineFix StartLineService::evaluate(const StartLinePosition &position,
                                        float heading_deg, float speed_kn,
                                        int32_t countdown_sec,
                                        int32_t box_countdown_sec) const {
  StartLineFix fix;
  if (!pin_.valid || !boat_.valid || !positionUsable(position)) {
    return fix;
  }

  StartLinePosition bow = bowOf(position, heading_deg);
  if (!positionUsable(bow)) {
    return fix;
  }

  double origin_lat = (pin_.latitude_deg + boat_.latitude_deg) * 0.5;
  double origin_lon = (pin_.longitude_deg + boat_.longitude_deg) * 0.5;
  double pin_e = 0.0;
  double pin_n = 0.0;
  double boat_e = 0.0;
  double boat_n = 0.0;
  double pos_e = 0.0;
  double pos_n = 0.0;
  project(pin_.latitude_deg, pin_.longitude_deg, origin_lat, origin_lon, &pin_e,
          &pin_n);
  project(boat_.latitude_deg, boat_.longitude_deg, origin_lat, origin_lon,
          &boat_e, &boat_n);
  project(bow.latitude_deg, bow.longitude_deg, origin_lat, origin_lon, &pos_e,
          &pos_n);

  double line_e = boat_e - pin_e;
  double line_n = boat_n - pin_n;
  double line_length = hypot(line_e, line_n);
  if (line_length < kMinLineLengthM) {
    return fix;
  }

  double normal_e = -line_n / line_length;
  double normal_n = line_e / line_length;
  double rel_e = pos_e - pin_e;
  double rel_n = pos_n - pin_n;
  double signed_dist = rel_e * normal_e + rel_n * normal_n;
  double along_m =
      rel_e * (line_e / line_length) + rel_n * (line_n / line_length);

  fix.line_valid = true;
  fix.line_dist_m = static_cast<float>(signed_dist);
  fix.abreast =
      along_m >= -kEndToleranceM && along_m <= line_length + kEndToleranceM;
  fix.ocs_risk = signed_dist > kOnLineM;

  bool heading_ok = isfinite(heading_deg);
  bool speed_ok = isfinite(speed_kn) && speed_kn >= 0.0f;
  if (heading_ok && speed_ok) {
    double heading_e = 0.0;
    double heading_n = 0.0;
    headingUnit(heading_deg, &heading_e, &heading_n);
    double closing_mps = static_cast<double>(speed_kn) * kKnToMps *
                         (heading_e * normal_e + heading_n * normal_n);
    fix.closing_kn = static_cast<float>(closing_mps / kKnToMps);
  }

  bool on_segment = fabs(signed_dist) <= kOnLineM &&
                    along_m >= -kEndToleranceM &&
                    along_m <= line_length + kEndToleranceM;
  if (on_segment) {
    fix.ttl_valid = true;
    fix.ttl_sec = 0;
  } else if (heading_ok && speed_ok && speed_kn > kTtlMinSpeedKn) {
    double heading_e = 0.0;
    double heading_n = 0.0;
    headingUnit(heading_deg, &heading_e, &heading_n);
    double rhs_e = pin_e - pos_e;
    double rhs_n = pin_n - pos_n;
    double det = line_e * heading_n - line_n * heading_e;
    if (fabs(det) >= 1e-4) {
      double distance_m = (line_e * rhs_n - line_n * rhs_e) / det;
      double along_hit_m =
          ((heading_e * rhs_n - heading_n * rhs_e) / det) * line_length;
      bool hits_segment = along_hit_m >= -kEndToleranceM &&
                          along_hit_m <= line_length + kEndToleranceM;
      double speed_mps = static_cast<double>(speed_kn) * kKnToMps;
      if (distance_m >= 0.0 && hits_segment && speed_mps >= kMinClosingMps) {
        double seconds = distance_m / speed_mps;
        if (seconds <= static_cast<double>(kMaxTtlSec)) {
          fix.ttl_valid = true;
          fix.ttl_sec = secondsFrom(seconds);
        }
      }
    }
  }

  if (fix.ttl_valid && countdown_sec >= 0) {
    fix.burn_valid = true;
    fix.burn_sec = countdown_sec - fix.ttl_sec;
  }
  if (fix.ttl_valid && box_countdown_sec >= 0) {
    fix.box_burn_valid = true;
    fix.box_burn_sec = box_countdown_sec - fix.ttl_sec;
  }
  return fix;
}

bool StartLineService::capture(StartLineEnd end,
                               const StartLinePosition &position,
                               float heading_deg) {
  if (!positionUsable(position)) {
    copyStatus(status_, sizeof(status_), "NO FIX");
    return false;
  }

  bool precise = preciseMode();
  bool heading_valid = isfinite(heading_deg);
  if (precise && !heading_valid) {
    copyStatus(status_, sizeof(status_), "NEED HDG");
    return false;
  }

  EndPoint *target = endPoint(end);
  if (!precise) {
    target->count = 0;
    for (uint8_t i = 0; i < kMaxApproaches; ++i) {
      target->approaches[i] = Approach();
    }
  }

  uint8_t slot = kMaxApproaches;
  for (uint8_t i = 0; i < kMaxApproaches; ++i) {
    if (!target->approaches[i].used) {
      slot = i;
      break;
    }
  }
  if (slot >= kMaxApproaches) {
    snprintf(status_, sizeof(status_), "%s FULL", endName(end));
    return false;
  }

  target->approaches[slot].used = true;
  target->approaches[slot].latitude_deg = position.latitude_deg;
  target->approaches[slot].longitude_deg = position.longitude_deg;
  target->approaches[slot].heading_deg = heading_deg;
  target->approaches[slot].heading_valid = precise && heading_valid;
  resolve(target);
  setCaptureStatus(end);
  return true;
}

void StartLineService::undoLast(StartLineEnd end) {
  EndPoint *target = endPoint(end);
  for (int i = static_cast<int>(kMaxApproaches) - 1; i >= 0; --i) {
    if (target->approaches[i].used) {
      target->approaches[i] = Approach();
      resolve(target);
      setCaptureStatus(end);
      return;
    }
  }
  setSummaryStatus();
}

void StartLineService::clearEnd(StartLineEnd end) {
  *endPoint(end) = EndPoint();
  setSummaryStatus();
}

void StartLineService::clear() {
  pin_ = EndPoint();
  boat_ = EndPoint();
  setSummaryStatus();
}

void StartLineService::setBowOffsetM(float meters) {
  if (!isfinite(meters)) {
    meters = 0.0f;
  }
  if (meters < 0.0f) {
    meters = 0.0f;
  }
  if (meters > kMaxBowOffsetM) {
    meters = kMaxBowOffsetM;
  }
  bow_offset_m_ = meters;
  resolve(&pin_);
  resolve(&boat_);
  setSummaryStatus();
}

float StartLineService::bowOffsetM() const {
  return bow_offset_m_;
}

bool StartLineService::preciseMode() const {
  return bow_offset_m_ > 0.01f;
}

StartLineEndPoint StartLineService::publish(const EndPoint &end) const {
  StartLineEndPoint out;
  out.valid = end.valid;
  out.quality = end.quality;
  out.approach_count = end.count;
  out.rms_m = end.rms_m;
  out.offset_error_m = end.offset_error_m;
  out.latitude_deg = end.latitude_deg;
  out.longitude_deg = end.longitude_deg;
  return out;
}

StartLineEndPoint StartLineService::pin() const {
  return publish(pin_);
}

StartLineEndPoint StartLineService::boat() const {
  return publish(boat_);
}

uint8_t StartLineService::approachCount(StartLineEnd end) const {
  return endPoint(end)->count;
}

const char *StartLineService::status() const {
  return status_;
}

void StartLineService::setCaptureStatus(StartLineEnd end) {
  const EndPoint *target = endPoint(end);
  if (!target->valid) {
    snprintf(status_, sizeof(status_), "%s --", endName(end));
    return;
  }
  if (preciseMode() && target->count == 1) {
    snprintf(status_, sizeof(status_), "%s 1 MORE", endName(end));
    return;
  }
  if (preciseMode() && target->quality == LineQuality::Poor) {
    snprintf(status_, sizeof(status_), "%s TURN", endName(end));
    return;
  }
  if (preciseMode() && fabsf(target->offset_error_m) >= 0.3f) {
    snprintf(status_, sizeof(status_), "%s %+0.1fm", endName(end),
             static_cast<double>(target->offset_error_m));
    return;
  }
  snprintf(status_, sizeof(status_), "%s OK", endName(end));
}

void StartLineService::setSummaryStatus() {
  if (pin_.valid && boat_.valid) {
    copyStatus(status_, sizeof(status_), "LINE OK");
  } else if (pin_.valid) {
    copyStatus(status_, sizeof(status_), "NEED BOAT");
  } else if (boat_.valid) {
    copyStatus(status_, sizeof(status_), "NEED PIN");
  } else {
    copyStatus(status_, sizeof(status_), "NO LINE");
  }
}

bool StartLineService::exportBlob(uint8_t *destination, size_t capacity,
                                  size_t *written) const {
  if (destination == nullptr || capacity < sizeof(Blob)) {
    return false;
  }

  Blob blob = {};
  blob.magic = kBlobMagic;
  blob.version = kBlobVersion;
  blob.size = sizeof(Blob);
  blob.bow_offset_m = bow_offset_m_;
  blob.pin_count = pin_.count;
  blob.boat_count = boat_.count;

  const EndPoint *ends[2] = {&pin_, &boat_};
  ApproachRec *recs[2] = {blob.pin, blob.boat};
  for (uint8_t e = 0; e < 2; ++e) {
    uint8_t slot = 0;
    for (uint8_t i = 0; i < kMaxApproaches && slot < kMaxApproaches; ++i) {
      if (!ends[e]->approaches[i].used) {
        continue;
      }
      recs[e][slot].lat = ends[e]->approaches[i].latitude_deg;
      recs[e][slot].lon = ends[e]->approaches[i].longitude_deg;
      recs[e][slot].heading = ends[e]->approaches[i].heading_deg;
      recs[e][slot].heading_valid = ends[e]->approaches[i].heading_valid ? 1 : 0;
      ++slot;
    }
  }

  blob.crc32 = crc32Bytes(reinterpret_cast<const uint8_t *>(&blob),
                          offsetof(Blob, crc32));
  memcpy(destination, &blob, sizeof(blob));
  if (written != nullptr) {
    *written = sizeof(blob);
  }
  return true;
}

bool StartLineService::importBlob(const uint8_t *source, size_t length) {
  if (source == nullptr || length < sizeof(Blob)) {
    return false;
  }

  Blob blob;
  memcpy(&blob, source, sizeof(blob));
  if (blob.magic != kBlobMagic || blob.version != kBlobVersion ||
      blob.size != sizeof(Blob)) {
    return false;
  }
  uint32_t expect = crc32Bytes(reinterpret_cast<const uint8_t *>(&blob),
                               offsetof(Blob, crc32));
  if (expect != blob.crc32) {
    return false;
  }
  if (!isfinite(blob.bow_offset_m) || blob.bow_offset_m < 0.0f ||
      blob.bow_offset_m > kMaxBowOffsetM ||
      blob.pin_count > kMaxApproaches || blob.boat_count > kMaxApproaches) {
    return false;
  }

  EndPoint pin;
  EndPoint boat;
  EndPoint *ends[2] = {&pin, &boat};
  const ApproachRec *recs[2] = {blob.pin, blob.boat};
  const uint8_t counts[2] = {blob.pin_count, blob.boat_count};
  for (uint8_t e = 0; e < 2; ++e) {
    for (uint8_t i = 0; i < counts[e]; ++i) {
      StartLinePosition probe;
      probe.fix_type = 3;
      probe.latitude_deg = recs[e][i].lat;
      probe.longitude_deg = recs[e][i].lon;
      if (!positionUsable(probe)) {
        return false;
      }
      ends[e]->approaches[i].used = true;
      ends[e]->approaches[i].latitude_deg = recs[e][i].lat;
      ends[e]->approaches[i].longitude_deg = recs[e][i].lon;
      ends[e]->approaches[i].heading_deg = recs[e][i].heading;
      ends[e]->approaches[i].heading_valid = recs[e][i].heading_valid != 0 &&
                                             isfinite(recs[e][i].heading);
    }
  }

  bow_offset_m_ = blob.bow_offset_m;
  pin_ = pin;
  boat_ = boat;
  resolve(&pin_);
  resolve(&boat_);
  setSummaryStatus();
  return true;
}

}  // namespace sailsiq
