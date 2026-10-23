#include "gnss_service.h"

#include "hardware_config.h"

namespace {

int64_t daysFromCivil(int32_t year, uint32_t month, uint32_t day) {
  year -= month <= 2;
  const int32_t era = (year >= 0 ? year : year - 399) / 400;
  const uint32_t year_of_era = static_cast<uint32_t>(year - era * 400);
  const uint32_t day_of_year =
      (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1;
  const uint32_t day_of_era =
      year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
  return static_cast<int64_t>(era) * 146097 +
         static_cast<int64_t>(day_of_era) - 719468;
}

uint64_t utcToMicros(uint16_t year, uint8_t month, uint8_t day, uint8_t hour,
                     uint8_t minute, uint8_t second, uint8_t centisecond) {
  const int64_t days = daysFromCivil(year, month, day);
  const int64_t seconds = days * 86400 + static_cast<int64_t>(hour) * 3600 +
                          static_cast<int64_t>(minute) * 60 + second;
  int64_t micros =
      seconds * 1000000LL + static_cast<int64_t>(centisecond) * 10000LL;
  if (micros < 0) {
    micros = 0;
  }
  return static_cast<uint64_t>(micros);
}

}  // namespace

bool GnssService::begin() {
  for (uint32_t baud_rate : hardware::uart_gnss::BAUD_CANDIDATES) {
    if (!probeBaud(baud_rate)) {
      continue;
    }

    detected_baud_rate_ = baud_rate;
    configureModule(baud_rate);
    clearLog();
    ready_ = true;
    return true;
  }

  ready_ = false;
  return false;
}

bool GnssService::probeBaud(uint32_t baud_rate) {
  openPort(baud_rate);

  TinyGPSPlus probe;
  const uint32_t started_ms = millis();
  while (static_cast<uint32_t>(millis() - started_ms) < 1300) {
    while (serial_.available() > 0) {
      probe.encode(static_cast<char>(serial_.read()));
    }
    if (probe.passedChecksum() > 0) {
      return true;
    }
    delay(10);
  }

  return false;
}

void GnssService::openPort(uint32_t baud_rate) {
  serial_.end();
  delay(20);
  serial_.setRxBufferSize(hardware::uart_gnss::RX_BUFFER_BYTES);
  serial_.begin(baud_rate, SERIAL_8N1, hardware::uart_gnss::RX,
                hardware::uart_gnss::TX);
  delay(80);
  while (serial_.available() > 0) {
    serial_.read();
  }
}

void GnssService::configureModule(uint32_t detected_baud_rate) {
  if (detected_baud_rate != hardware::uart_gnss::BAUD_RATE) {
    serial_.print("$PCAS01,5*19\r\n");
    serial_.flush();
    delay(100);
    openPort(hardware::uart_gnss::BAUD_RATE);
    detected_baud_rate_ = hardware::uart_gnss::BAUD_RATE;
    delay(150);
  }

  // F8N documents 1/2/4/5/10 Hz. 10 Hz is the closest step to the old 8 Hz PVT.
  serial_.print("$PCAS02,100*1E\r\n");
  serial_.flush();
  delay(40);
  // GGA + RMC only. Those are the sentences TinyGPSPlus parses.
  serial_.print("$PCAS03,1,0,0,0,1,0,0,0,0,0,,,0,0*02\r\n");
  serial_.flush();
  delay(40);
}

void GnssService::update() {
  if (!ready_) {
    return;
  }

  while (serial_.available() > 0) {
    const uint8_t byte = static_cast<uint8_t>(serial_.read());
    pushLog(byte);
    gps_.encode(static_cast<char>(byte));
  }
  publish();
}

void GnssService::publish() {
  const bool fix_fresh =
      gps_.location.isValid() && gps_.location.age() < kFreshMs;
  if (!fix_fresh) {
    latest_nav_.fix_type = 0;
    latest_nav_.sog_kn = NAN;
    latest_nav_.cog_deg = NAN;
    latest_nav_.latitude_deg = NAN;
    latest_nav_.longitude_deg = NAN;
  } else {
    const TinyGPSLocation::Quality quality = gps_.location.FixQuality();
    latest_nav_.fix_type =
        quality == TinyGPSLocation::Invalid ||
                quality == TinyGPSLocation::Estimated
            ? 0
            : 3;
    latest_nav_.sog_kn = gps_.speed.isValid() && gps_.speed.age() < kFreshMs
                             ? static_cast<float>(gps_.speed.knots())
                             : NAN;
    latest_nav_.cog_deg = gps_.course.isValid() && gps_.course.age() < kFreshMs
                              ? static_cast<float>(gps_.course.deg())
                              : NAN;
    latest_nav_.latitude_deg = gps_.location.lat();
    latest_nav_.longitude_deg = gps_.location.lng();
  }

  if (gps_.satellites.isValid() && gps_.satellites.age() < kFreshMs) {
    const uint32_t satellites = gps_.satellites.value();
    latest_nav_.satellites =
        static_cast<uint8_t>(satellites > 255U ? 255U : satellites);
  } else {
    latest_nav_.satellites = 0;
  }

  if (gps_.date.isValid() && gps_.time.isValid() && gps_.time.isUpdated()) {
    noteTime(gps_.date.year(), gps_.date.month(), gps_.date.day(),
             gps_.time.hour(), gps_.time.minute(), gps_.time.second(),
             gps_.time.centisecond());
  }
}

void GnssService::noteTime(uint16_t year, uint8_t month, uint8_t day,
                           uint8_t hour, uint8_t minute, uint8_t second,
                           uint8_t centisecond) {
  if (year < 2020 || month < 1 || month > 12 || day < 1 || day > 31 ||
      hour > 23 || minute > 59 || second > 59) {
    return;
  }

  latest_utc_.year = year;
  latest_utc_.month = month;
  latest_utc_.day = day;
  latest_utc_.hour = hour;
  latest_utc_.minute = minute;
  latest_utc_.second = second;
  latest_utc_.nanosecond = static_cast<int32_t>(centisecond) * 10000000;
  latest_utc_.accuracy_ns = 10000000;
  gps_anchor_us_ =
      utcToMicros(year, month, day, hour, minute, second, centisecond);
  local_anchor_us_ = micros();
  has_time_ = true;
}

bool GnssService::isReady() const {
  return ready_;
}

uint32_t GnssService::detectedBaudRate() const {
  return detected_baud_rate_;
}

bool GnssService::hasTime() const {
  return has_time_;
}

GpsUtcTime GnssService::latestUtc() const {
  return latest_utc_;
}

GnssNavSnapshot GnssService::latestNav() const {
  return latest_nav_;
}

uint64_t GnssService::gpsTimeMicros() const {
  if (!has_time_) {
    return 0;
  }

  return gps_anchor_us_ +
         static_cast<uint32_t>(micros() - local_anchor_us_);
}

uint16_t GnssService::loggedBytesAvailable() {
  return log_count_;
}

uint16_t GnssService::maxLoggedBytesAvailable() {
  return log_max_;
}

void GnssService::clearMaxLoggedBytesAvailable() {
  log_max_ = log_count_;
}

uint16_t GnssService::readLoggedUbx(uint8_t *destination, uint16_t max_bytes) {
  uint16_t count = 0;
  while (count < max_bytes && log_count_ > 0) {
    destination[count++] = log_buffer_[log_tail_];
    log_tail_ = static_cast<uint16_t>((log_tail_ + 1) % kLogCapacity);
    --log_count_;
  }
  return count;
}

void GnssService::pushLog(uint8_t byte) {
  if (log_count_ == kLogCapacity) {
    log_tail_ = static_cast<uint16_t>((log_tail_ + 1) % kLogCapacity);
    --log_count_;
  }

  log_buffer_[log_head_] = byte;
  log_head_ = static_cast<uint16_t>((log_head_ + 1) % kLogCapacity);
  ++log_count_;
  if (log_count_ > log_max_) {
    log_max_ = log_count_;
  }
}

void GnssService::clearLog() {
  log_head_ = 0;
  log_tail_ = 0;
  log_count_ = 0;
  log_max_ = 0;
}
