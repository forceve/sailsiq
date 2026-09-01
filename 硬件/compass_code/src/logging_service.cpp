#include "logging_service.h"

#include <stdio.h>
#include <string.h>

#include "gnss_service.h"
#include "hardware_config.h"

namespace {

bool utcUsable(const GpsUtcTime &utc) {
  return utc.year >= 2024 && utc.month >= 1 && utc.month <= 12 &&
         utc.day >= 1 && utc.day <= 31 && utc.hour <= 23 &&
         utc.minute <= 59 && utc.second <= 60;
}

}  // namespace

bool LoggingService::begin() {
  return initializeStorage();
}

bool LoggingService::initializeStorage() {
  pinMode(hardware::spi_sd::CS, OUTPUT);
  digitalWrite(hardware::spi_sd::CS, HIGH);
  pinMode(hardware::spi_sd::MISO, INPUT_PULLUP);
  sd_spi_.begin(hardware::spi_sd::SCLK, hardware::spi_sd::MISO,
                hardware::spi_sd::MOSI, hardware::spi_sd::CS);

  for (uint8_t attempt = 0; attempt < 5; ++attempt) {
    if (sd_.begin(SdSpiConfig(hardware::spi_sd::CS, SHARED_SPI,
                              logging::SD_SPI_HZ, &sd_spi_))) {
      last_flush_ms_ = millis();
      storage_error_code_ = 0;
      storage_error_data_ = 0;
      storage_ready_ = true;
      return true;
    }

    storage_error_code_ = sd_.sdErrorCode();
    storage_error_data_ = sd_.sdErrorData();
    delay(250);
  }

  return false;
}

bool LoggingService::appendImuSample(const ImuSample &sample,
                                     const ButtonStateSnapshot &buttons) {
  if (!files_ready_) {
    return false;
  }

  char line[360];
  const int line_len = snprintf(
      line, sizeof(line),
      "%llu,%u,%u,%u,%u,%u,%u,%u,%u,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,"
      "%.3f,%.3f,%.3f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%.3f,%.3f,%.3f\n",
      static_cast<unsigned long long>(sample.timestamp_us),
      sample.gps_time_valid ? 1U : 0U, sample.accel_valid ? 1U : 0U,
      sample.gyro_valid ? 1U : 0U, sample.mag_valid ? 1U : 0U,
      buttons.sw1_pressed ? 1U : 0U, buttons.sw2_pressed ? 1U : 0U,
      buttons.sw3_pressed ? 1U : 0U, buttons.sw4_pressed ? 1U : 0U,
      sample.accel_g[0], sample.accel_g[1], sample.accel_g[2],
      sample.gyro_dps[0], sample.gyro_dps[1], sample.gyro_dps[2],
      sample.mag_counts[0], sample.mag_counts[1], sample.mag_counts[2],
      sample.accel_cal_g[0], sample.accel_cal_g[1], sample.accel_cal_g[2],
      sample.gyro_cal_dps[0], sample.gyro_cal_dps[1],
      sample.gyro_cal_dps[2], sample.mag_cal_counts[0],
      sample.mag_cal_counts[1], sample.mag_cal_counts[2]);

  if (line_len <= 0 || static_cast<size_t>(line_len) >= sizeof(line)) {
    return false;
  }

  if (imu_buffer_used_ + static_cast<size_t>(line_len) >
      sizeof(imu_buffer_)) {
    return false;
  }

  memcpy(imu_buffer_ + imu_buffer_used_, line, static_cast<size_t>(line_len));
  imu_buffer_used_ += static_cast<size_t>(line_len);
  return true;
}

void LoggingService::flushIfDue(uint32_t now_ms, GnssService &gnss) {
  if (!storage_ready_) {
    return;
  }

  if (!files_ready_ && !ensureSessionFiles(gnss)) {
    return;
  }

  if (!timestamped_names_ && gnss.hasTime()) {
    applyTimestampedNames(gnss.latestUtc());
  }

  if (!files_ready_) {
    return;
  }

  writePendingUbx(gnss);

  const bool sync_due = static_cast<uint32_t>(now_ms - last_flush_ms_) >=
                        logging::FLUSH_INTERVAL_MS;
  if (sync_due || imu_buffer_used_ >= sizeof(imu_buffer_) / 2) {
    writePendingImu();
  }

  if (sync_due) {
    gnss_file_.sync();
    imu_file_.sync();
    last_flush_ms_ = now_ms;
  }
}

bool LoggingService::isReady() const {
  return files_ready_;
}

bool LoggingService::storageReady() const {
  return storage_ready_;
}

bool LoggingService::hasTimestampedNames() const {
  return timestamped_names_;
}

uint8_t LoggingService::storageErrorCode() const {
  return storage_error_code_;
}

uint8_t LoggingService::storageErrorData() const {
  return storage_error_data_;
}

size_t LoggingService::pendingImuBytes() const {
  return imu_buffer_used_;
}

uint32_t LoggingService::lastFlushMs() const {
  return last_flush_ms_;
}

bool LoggingService::ensureSessionFiles(GnssService &gnss) {
  if (files_ready_) {
    return true;
  }

  if (gnss.hasTime() && openSessionFiles(gnss.latestUtc())) {
    timestamped_names_ = true;
    return true;
  }

  return openTemporarySessionFiles();
}

bool LoggingService::openTemporarySessionFiles() {
  if (!storage_ready_) {
    return false;
  }

  for (uint16_t attempt = 0; attempt < 10000; ++attempt) {
    const int gnss_written =
        snprintf(gnss_file_name_, sizeof(gnss_file_name_), "G%04u.UBX",
                 attempt);
    const int imu_written =
        snprintf(imu_file_name_, sizeof(imu_file_name_), "I%04u.CSV",
                 attempt);
    if (gnss_written <= 0 ||
        static_cast<size_t>(gnss_written) >= sizeof(gnss_file_name_) ||
        imu_written <= 0 ||
        static_cast<size_t>(imu_written) >= sizeof(imu_file_name_)) {
      return false;
    }

    if (sd_.exists(gnss_file_name_) || sd_.exists(imu_file_name_)) {
      continue;
    }

    gnss_file_ = sd_.open(gnss_file_name_, O_WRONLY | O_CREAT);
    if (!gnss_file_) {
      return false;
    }

    imu_file_ = sd_.open(imu_file_name_, O_WRONLY | O_CREAT);
    if (!imu_file_) {
      gnss_file_.close();
      return false;
    }

    if (!writeImuHeader()) {
      gnss_file_.close();
      imu_file_.close();
      return false;
    }

    files_ready_ = true;
    timestamped_names_ = false;
    last_flush_ms_ = millis();
    return true;
  }

  return false;
}

bool LoggingService::openSessionFiles(const GpsUtcTime &utc) {
  if (!storage_ready_ || !utcUsable(utc)) {
    return false;
  }

  if (!buildUniqueFileName(gnss_file_name_, sizeof(gnss_file_name_), "GNSS",
                           "UBX", utc) ||
      !buildUniqueFileName(imu_file_name_, sizeof(imu_file_name_), "IMU",
                           "CSV", utc)) {
    return false;
  }

  gnss_file_ = sd_.open(gnss_file_name_, O_WRONLY | O_CREAT);
  if (!gnss_file_) {
    return false;
  }

  imu_file_ = sd_.open(imu_file_name_, O_WRONLY | O_CREAT);
  if (!imu_file_) {
    gnss_file_.close();
    return false;
  }

  if (!writeImuHeader()) {
    gnss_file_.close();
    imu_file_.close();
    return false;
  }

  files_ready_ = true;
  last_flush_ms_ = millis();
  return true;
}

bool LoggingService::applyTimestampedNames(const GpsUtcTime &utc) {
  if (!files_ready_ || timestamped_names_ || !utcUsable(utc)) {
    return false;
  }

  char gnss_final_name[48] = {};
  char imu_final_name[48] = {};
  if (!buildUniqueFileName(gnss_final_name, sizeof(gnss_final_name), "GNSS",
                           "UBX", utc) ||
      !buildUniqueFileName(imu_final_name, sizeof(imu_final_name), "IMU",
                           "CSV", utc)) {
    return false;
  }

  writePendingImu();
  gnss_file_.sync();
  imu_file_.sync();
  gnss_file_.close();
  imu_file_.close();

  const bool gnss_renamed = sd_.rename(gnss_file_name_, gnss_final_name);
  const bool imu_renamed = sd_.rename(imu_file_name_, imu_final_name);
  if (!gnss_renamed || !imu_renamed) {
    const char *gnss_reopen_name = gnss_renamed ? gnss_final_name : gnss_file_name_;
    const char *imu_reopen_name = imu_renamed ? imu_final_name : imu_file_name_;
    gnss_file_ = sd_.open(gnss_reopen_name, O_WRONLY | O_APPEND);
    imu_file_ = sd_.open(imu_reopen_name, O_WRONLY | O_APPEND);
    files_ready_ = static_cast<bool>(gnss_file_) && static_cast<bool>(imu_file_);
    if (gnss_renamed) {
      strncpy(gnss_file_name_, gnss_final_name, sizeof(gnss_file_name_) - 1);
      gnss_file_name_[sizeof(gnss_file_name_) - 1] = '\0';
    }
    if (imu_renamed) {
      strncpy(imu_file_name_, imu_final_name, sizeof(imu_file_name_) - 1);
      imu_file_name_[sizeof(imu_file_name_) - 1] = '\0';
    }
    return false;
  }

  strncpy(gnss_file_name_, gnss_final_name, sizeof(gnss_file_name_) - 1);
  gnss_file_name_[sizeof(gnss_file_name_) - 1] = '\0';
  strncpy(imu_file_name_, imu_final_name, sizeof(imu_file_name_) - 1);
  imu_file_name_[sizeof(imu_file_name_) - 1] = '\0';

  gnss_file_ = sd_.open(gnss_file_name_, O_WRONLY | O_APPEND);
  imu_file_ = sd_.open(imu_file_name_, O_WRONLY | O_APPEND);
  files_ready_ = static_cast<bool>(gnss_file_) && static_cast<bool>(imu_file_);
  timestamped_names_ = files_ready_;
  last_flush_ms_ = millis();
  return files_ready_;
}

bool LoggingService::buildUniqueFileName(char *destination,
                                         size_t destination_len,
                                         const char *prefix,
                                         const char *extension,
                                         const GpsUtcTime &utc) {
  for (uint8_t attempt = 0; attempt < 100; ++attempt) {
    const int written =
        attempt == 0
            ? snprintf(destination, destination_len,
                       "%s_%04u%02u%02u_%02u%02u%02u.%s", prefix, utc.year,
                       utc.month, utc.day, utc.hour, utc.minute, utc.second,
                       extension)
            : snprintf(destination, destination_len,
                       "%s_%04u%02u%02u_%02u%02u%02u_%02u.%s", prefix,
                       utc.year, utc.month, utc.day, utc.hour, utc.minute,
                       utc.second, attempt, extension);

    if (written <= 0 || static_cast<size_t>(written) >= destination_len) {
      return false;
    }

    if (!sd_.exists(destination)) {
      return true;
    }
  }

  return false;
}

bool LoggingService::writeImuHeader() {
  if (!imu_file_.println(
          F("timestamp_us,gps_time_valid,accel_valid,gyro_valid,mag_valid,"
            "sw1_pressed,sw2_pressed,sw3_pressed,sw4_pressed,"
            "accel_x_g,accel_y_g,accel_z_g,gyro_x_dps,gyro_y_dps,gyro_z_dps,"
            "mag_x_counts,mag_y_counts,mag_z_counts,"
            "accel_cal_x_g,accel_cal_y_g,accel_cal_z_g,"
            "gyro_cal_x_dps,gyro_cal_y_dps,gyro_cal_z_dps,"
            "mag_cal_x_counts,mag_cal_y_counts,mag_cal_z_counts"))) {
    return false;
  }

  return imu_file_.sync();
}

void LoggingService::writePendingUbx(GnssService &gnss) {
  while (gnss.loggedBytesAvailable() > 0) {
    const uint16_t available = gnss.loggedBytesAvailable();
    const uint16_t bytes_to_read =
        min<uint16_t>(available, sizeof(gnss_buffer_));
    const uint16_t bytes_read =
        gnss.readLoggedUbx(gnss_buffer_, bytes_to_read);
    if (bytes_read == 0) {
      break;
    }
    gnss_file_.write(gnss_buffer_, bytes_read);
  }
}

void LoggingService::writePendingImu() {
  if (imu_buffer_used_ == 0) {
    return;
  }

  imu_file_.write(imu_buffer_, imu_buffer_used_);
  imu_buffer_used_ = 0;
}
