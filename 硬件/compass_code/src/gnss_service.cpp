#include "gnss_service.h"

#include "hardware_config.h"
#include "logging_config.h"

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

uint64_t utcToMicros(const UBX_NAV_PVT_data_t &pvt) {
  const int64_t days = daysFromCivil(pvt.year, pvt.month, pvt.day);
  const int64_t seconds =
      days * 86400 + static_cast<int64_t>(pvt.hour) * 3600 +
      static_cast<int64_t>(pvt.min) * 60 + pvt.sec;
  int64_t micros = seconds * 1000000LL + pvt.nano / 1000;
  if (micros < 0) {
    micros = 0;
  }
  return static_cast<uint64_t>(micros);
}

}  // namespace

GnssService *GnssService::instance_ = nullptr;

bool GnssService::begin() {
  instance_ = this;

  gnss_.setPacketCfgPayloadSize(UBX_NAV_SAT_MAX_LEN);
  gnss_.setFileBufferSize(logging::GNSS_FILE_BUFFER_SIZE);

  for (uint32_t baud_rate : hardware::uart_gnss::BAUD_CANDIDATES) {
    if (!tryBeginAtBaud(baud_rate)) {
      continue;
    }

    detected_baud_rate_ = baud_rate;
    ready_ = configureModule(baud_rate);
    return ready_;
  }

  ready_ = false;
  return false;
}

bool GnssService::tryBeginAtBaud(uint32_t baud_rate) {
  serial_.end();
  delay(30);
  serial_.setRxBufferSize(hardware::uart_gnss::RX_BUFFER_BYTES);
  serial_.begin(baud_rate, SERIAL_8N1, hardware::uart_gnss::RX,
                hardware::uart_gnss::TX);
  delay(100);

  while (serial_.available() > 0) {
    serial_.read();
  }

  return gnss_.begin(serial_, 1200);
}

bool GnssService::configureModule(uint32_t detected_baud_rate) {
  bool ok = true;
  ok &= gnss_.setUART1Input(COM_TYPE_UBX | COM_TYPE_NMEA);
  ok &= gnss_.setUART1Output(COM_TYPE_UBX);

  if (detected_baud_rate != hardware::uart_gnss::BAUD_RATE) {
    ok &= gnss_.setSerialRate(hardware::uart_gnss::BAUD_RATE);
    serial_.flush();
    delay(100);
    serial_.end();
    delay(30);
    serial_.setRxBufferSize(hardware::uart_gnss::RX_BUFFER_BYTES);
    serial_.begin(hardware::uart_gnss::BAUD_RATE, SERIAL_8N1,
                  hardware::uart_gnss::RX, hardware::uart_gnss::TX);
    delay(150);
    ok &= gnss_.begin(serial_, 1200);
    detected_baud_rate_ = hardware::uart_gnss::BAUD_RATE;
    ok &= gnss_.setUART1Input(COM_TYPE_UBX | COM_TYPE_NMEA);
    ok &= gnss_.setUART1Output(COM_TYPE_UBX);
  }

  ok &= gnss_.setNavigationFrequency(hardware::uart_gnss::NAV_RATE_HZ);
  ok &= gnss_.setAutoPVTcallbackPtr(&GnssService::onPvt);
  ok &= gnss_.setAutoNAVSATrate(hardware::uart_gnss::NAV_SAT_RATE_DIVISOR,
                                false);
  ok &= gnss_.setAutoNAVSIGrate(hardware::uart_gnss::NAV_SIG_RATE_DIVISOR,
                                false);
  gnss_.logNAVPVT();
  gnss_.logNAVSAT();
  gnss_.logNAVSIG();

  return ok;
}

void GnssService::update() {
  if (!ready_) {
    return;
  }

  gnss_.checkUblox();
  gnss_.checkCallbacks();
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
  return gnss_.fileBufferAvailable();
}

uint16_t GnssService::maxLoggedBytesAvailable() {
  return gnss_.getMaxFileBufferAvail();
}

void GnssService::clearMaxLoggedBytesAvailable() {
  gnss_.clearMaxFileBufferAvail();
}

uint16_t GnssService::readLoggedUbx(uint8_t *destination, uint16_t max_bytes) {
  return gnss_.extractFileBufferData(destination, max_bytes);
}

void GnssService::onPvt(UBX_NAV_PVT_data_t *pvt) {
  if (instance_ != nullptr && pvt != nullptr) {
    instance_->handlePvt(*pvt);
  }
}

void GnssService::handlePvt(const UBX_NAV_PVT_data_t &pvt) {
  latest_nav_.fix_type = pvt.flags.bits.gnssFixOK ? pvt.fixType : 0;
  latest_nav_.satellites = pvt.numSV;
  latest_nav_.sog_kn = static_cast<float>(pvt.gSpeed) * 0.00194384449f;
  latest_nav_.cog_deg = static_cast<float>(pvt.headMot) * 0.00001f;

  if (!pvt.valid.bits.validDate || !pvt.valid.bits.validTime ||
      !pvt.valid.bits.fullyResolved) {
    return;
  }

  latest_utc_.year = pvt.year;
  latest_utc_.month = pvt.month;
  latest_utc_.day = pvt.day;
  latest_utc_.hour = pvt.hour;
  latest_utc_.minute = pvt.min;
  latest_utc_.second = pvt.sec;
  latest_utc_.nanosecond = pvt.nano;
  latest_utc_.accuracy_ns = pvt.tAcc;

  gps_anchor_us_ = utcToMicros(pvt);
  local_anchor_us_ = micros();
  has_time_ = true;
}
