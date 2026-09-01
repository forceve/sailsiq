#pragma once

#include <Arduino.h>
#include <SPI.h>
#include <SdFat.h>

#include "imu_service.h"
#include "logging_config.h"

class GnssService;
struct GpsUtcTime;

struct ButtonStateSnapshot {
  bool sw1_pressed = false;
  bool sw2_pressed = false;
  bool sw3_pressed = false;
  bool sw4_pressed = false;
};

class LoggingService {
 public:
  bool begin();
  bool appendImuSample(const ImuSample &sample,
                       const ButtonStateSnapshot &buttons);
  void flushIfDue(uint32_t now_ms, GnssService &gnss);

  bool isReady() const;
  bool storageReady() const;
  bool hasTimestampedNames() const;
  uint8_t storageErrorCode() const;
  uint8_t storageErrorData() const;
  size_t pendingImuBytes() const;
  uint32_t lastFlushMs() const;

 private:
  bool initializeStorage();
  bool ensureSessionFiles(GnssService &gnss);
  bool openTemporarySessionFiles();
  bool openSessionFiles(const GpsUtcTime &utc);
  bool applyTimestampedNames(const GpsUtcTime &utc);
  bool buildUniqueFileName(char *destination, size_t destination_len,
                           const char *prefix, const char *extension,
                           const GpsUtcTime &utc);
  void writePendingUbx(GnssService &gnss);
  void writePendingImu();
  bool writeImuHeader();

  SPIClass sd_spi_{HSPI};
  SdFs sd_;
  FsFile gnss_file_;
  FsFile imu_file_;
  char gnss_file_name_[48] = {};
  char imu_file_name_[48] = {};
  uint32_t last_flush_ms_ = 0;
  size_t imu_buffer_used_ = 0;
  char imu_buffer_[logging::IMU_BUFFER_BYTES] = {};
  uint8_t gnss_buffer_[logging::GNSS_WRITE_CHUNK_BYTES] = {};
  bool storage_ready_ = false;
  bool files_ready_ = false;
  bool timestamped_names_ = false;
  uint8_t storage_error_code_ = 0;
  uint8_t storage_error_data_ = 0;
};
