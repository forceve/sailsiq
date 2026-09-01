# SailSIQ ESP32-S3 Logger and Display

## 涓枃璇存槑

### 椤圭洰姒傝堪

鏈」鐩繍琛屽湪 ESP32-S3 N16R8 涓婏紝鐢ㄤ簬甯嗚埞瀵艰埅鏁版嵁閲囬泦銆佹樉绀哄拰璁板綍銆傜郴缁熻繛鎺?u-blox NEO-F10N GNSS銆丅MI270 IMU銆丮MC5983MA 纾佸姏璁°€丼T7305 鍗曡壊 LCD銆丗AT32 SD 鍗′互鍙?4 涓笂鎷夋寜閽€?
褰撳墠鍥轰欢瀹屾垚浠ヤ笅鍔熻兘锛?
- GNSS 鍒濆鍖栦负 UBX 杈撳嚭锛宍UBX-NAV-PVT` 8 Hz锛宍UBX-NAV-SAT` 鍜?`UBX-NAV-SIG` 1 Hz銆?- IMU 鍜岀鍔涜閫氳繃 I2C 璇诲彇锛屼富寰幆鎸?64 Hz 閲囨牱銆?- MCU 鏃堕棿鎴充紭鍏堜娇鐢?GNSS 瑙ｇ畻鍑虹殑 UTC 鏃堕棿銆?- SD 鍗?FAT32 鍒濆鍖栵紝璁板綍鍘熺敓 UBX 浜岃繘鍒跺拰 IMU CSV銆?- ST7305 鍗曡壊灞忎娇鐢?LVGL 9.3 UI 鏄剧ず瀵艰埅椤甸潰銆?- 鎸夐挳浣跨敤榛樿涓婃媺锛岄珮鐢靛钩绌洪棽锛屼綆鐢靛钩鎸変笅锛屽苟鍋氳蒋浠跺幓鎶栥€?- IMU 鏁版嵁鏀寔瀹夎瑙掗鏃嬭浆銆佷紶鎰熷櫒鏍″噯鍜?AHRS 濮挎€佽瀺鍚堛€?- 涓插彛姣忕杈撳嚭 GPS銆両MU銆丄HRS/Nav 鍜?SD 鐘舵€併€?
### 纭欢杩炴帴

鎵€鏈夌‖浠跺紩鑴氶泦涓畾涔夊湪 [include/hardware_config.h](include/hardware_config.h)銆?
#### GNSS UART

| 淇″彿 | ESP32-S3 GPIO |
| --- | --- |
| UART TX | 17 |
| UART RX | 18 |
| 娉㈢壒鐜?| 115200 |

GNSS 浣跨敤 `HardwareSerial(1)`銆傚綋鍓嶄唬鐮佸皢鎺ユ敹 u-blox UBX 鏁版嵁锛屽苟閰嶇疆鑷姩杈撳嚭锛?
- `UBX-NAV-PVT`: 8 Hz
- `UBX-NAV-SAT`: 1 Hz
- `UBX-NAV-SIG`: 1 Hz

#### SD 鍗?SPI

| 淇″彿 | ESP32-S3 GPIO |
| --- | --- |
| CS / SS | 42 |
| MOSI | 41 |
| SCLK | 40 |
| MISO | 39 |
| SPI 棰戠巼 | 25 MHz |

SD 鍗″繀椤绘牸寮忓寲涓?FAT32銆傚垵濮嬪寲澶辫触鏃?logger 浼氫繚鎸?`ready=0`锛屼覆鍙ｇ姸鎬佷細鏄剧ず SD 鏈氨缁€?
#### LCD SPI

| 淇″彿 | ESP32-S3 GPIO |
| --- | --- |
| SCLK / SCL | 10 |
| MOSI / SDA | 11 |
| RST | 12 |
| DC | 13 |
| CS | 14 |
| TE | 21 |
| SPI 棰戠巼 | 80 MHz |

LCD 涓?ST7305 4.2 鑻卞鍗曡壊灞忋€傚綋鍓嶆樉绀哄垎杈ㄧ巼閫昏緫涓?LVGL UI `400 x 300`锛宖lush 鏃舵棆杞槧灏勫埌闈㈡澘 `300 x 400`銆?
娉ㄦ剰锛歋T7305 鍗曡壊灞忔暣灞忓埛鏂颁細鏈夎倝鐪煎彲瑙侀棯鐑併€傚綋鍓嶄唬鐮侀檺鍒剁墿鐞嗘彁浜ゅ埌鏈€楂?4 Hz锛宍ui_tick()` 涓?1 Hz銆?
#### I2C IMU / Magnetometer

| 璁惧 | 鍦板潃 | SDA | SCL |
| --- | --- | --- | --- |
| BMI270 | `0x68` | 6 | 7 |
| MMC5983MA | `0x30` | 6 | 7 |

I2C 棰戠巼涓?400 kHz銆?
#### 鎸夐挳

| 鎸夐挳 | ESP32-S3 GPIO |
| --- | --- |
| SW1 | 47 |
| SW2 | 48 |
| SW3 | 9 |
| SW4 | 8 |

鎸夐挳榛樿涓婃媺鍒伴珮鐢靛钩锛屾寜涓嬩负浣庣數骞炽€傝蒋浠跺幓鎶栨椂闂翠负 25 ms銆?
### 涓昏婧愮爜缁撴瀯

| 鏂囦欢 | 浣滅敤 |
| --- | --- |
| [src/main.cpp](src/main.cpp) | 涓诲垵濮嬪寲鍜屼富寰幆锛岃皟搴?GNSS銆両MU銆佹棩蹇椼€乁I銆佷覆鍙ｇ姸鎬?|
| [src/gnss_service.cpp](src/gnss_service.cpp) | u-blox GNSS 鍒濆鍖栥€丳VT 鍥炶皟銆乁BX buffer 璇诲彇 |
| [src/imu_service.cpp](src/imu_service.cpp) | BMI270/MMC5983MA 鍒濆鍖栥€?4 Hz 閲囨牱銆侀鏃嬭浆鍜屾牎鍑?|
| [src/nav_estimator.cpp](src/nav_estimator.cpp) | AHRS 濮挎€佽瀺鍚堬紝杈撳嚭 heading/roll/pitch |
| [src/logging_service.cpp](src/logging_service.cpp) | FAT32 SD 鍒濆鍖栥€乁BX 鍜?IMU CSV 鍐欏叆 |
| [src/display_service.cpp](src/display_service.cpp) | ST7305 + LVGL9 鏄剧ず椹卞姩鍜屽埛鏂拌妭娴?|
| [include/hardware_config.h](include/hardware_config.h) | pinmap銆佸湴鍧€銆佹€荤嚎棰戠巼 |
| [include/sensor_rotation_config.h](include/sensor_rotation_config.h) | BMI270/MMC5983MA 瀹夎瑙掗鏃嬭浆 |
| [include/sensor_calibration_config.h](include/sensor_calibration_config.h) | accel/gyro/mag 鏍″噯鍙傛暟鍜?AHRS 澧炵泭 |
| [include/logging_config.h](include/logging_config.h) | flush 鍛ㄦ湡銆乥uffer 澶у皬 |
| [lib/ui](lib/ui) | LVGL UI 搴撳拰 SailSIQ 椤甸潰瀹氫箟 |

### 鏋勫缓鍜岀儳褰?
椤圭洰浣跨敤 PlatformIO Arduino framework銆?
```powershell
pio run
pio run -t upload
pio device monitor -b 115200
```

濡傛灉浣跨敤褰撳墠鐜涓殑 PlatformIO 铏氭嫙鐜锛?
```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run
```

涓昏渚濊禆瀹氫箟鍦?[platformio.ini](platformio.ini)锛?
- `ft-tele/ST7305_MonoTFT_Library`
- `greiman/SdFat`
- `7semi-solutions/7Semi BMI270`
- `sparkfun/SparkFun MMC5983MA Magnetometer Arduino Library`
- `sparkfun/SparkFun u-blox GNSS v3`
- `lvgl/lvgl@9.3.0`

### 鍚姩娴佺▼

`setup()` 涓寜浠ヤ笅椤哄簭鍒濆鍖栵細

1. `Serial.begin(115200)`
2. 4 涓寜閽緭鍏ュ拰鍘绘姈鐘舵€?3. GNSS UART 鍜?u-blox 杈撳嚭閰嶇疆
4. BMI270 / MMC5983MA I2C 鍒濆鍖?5. SD 鍗″拰鏃ュ織鏂囦欢
6. UI model 鍒濆鍖?7. ST7305/LVGL 鏄剧ず
8. UI command handler

`loop()` 涓寔缁墽琛岋細

1. 鏇存柊鎸夐挳鐘舵€佸苟鎶曢€?UI 鎸夐敭浜嬩欢
2. 澶勭悊 GNSS UBX 鍜?PVT callback
3. 鎸?64 Hz 璇诲彇 IMU/mag
4. 灏?IMU 鏍锋湰鍐欏叆鍐呭瓨 buffer
5. 鐢?AHRS 鏇存柊濮挎€佸拰瀵艰埅浼拌
6. 姣?1000 ms flush UBX/IMU 鍒?SD
7. 姣?250 ms 鏇存柊 UI model
8. 姣?1000 ms 杈撳嚭涓插彛鐘舵€?9. 鎵ц LVGL timer 鍜?ST7305 鍒锋柊

### 鏁版嵁璁板綍

SD 鍗¤褰曚袱涓枃浠讹細

| 鏂囦欢 | 鍐呭 |
| --- | --- |
| `GNSS_YYYYMMDD_HHMMSS.UBX` | 鍘熺敓 UBX 浜岃繘鍒舵祦锛屽寘鍚?PVT/SAT/SIG |
| `IMU_YYYYMMDD_HHMMSS.CSV` | IMU銆佺鍔涜銆佹寜閽拰鏍″噯鍚庢暟鎹?|

鏂囦欢鍚嶄娇鐢?GNSS UTC 鏃堕棿銆傚紑鏈哄悗 SD 浼氬厛鍒濆鍖栵紱绛?GNSS 鏃堕棿鏈夋晥鍚庢墠鍒涘缓鏈浼氳瘽鐨勪袱浠芥柊鏂囦欢銆傚鏋滃悓涓€绉掑唴宸叉湁鍚屽悕鏂囦欢锛屼細鑷姩杩藉姞 `_01`銆乣_02` 绛夊悗缂€锛屼笉瑕嗙洊鏃ф枃浠躲€?
鍐欏叆绛栫暐锛?
- UBX 鏁版嵁鍏堣繘鍏?SparkFun GNSS 搴?file buffer锛屽啀姣忕鍐欏叆 SD銆?- IMU CSV 鍏堣繘鍏ュ唴瀛?buffer锛屽啀姣忕鍐欏叆 SD銆?- `flushIfDue()` 姣?1000 ms 鎵ц涓€娆★紝鍚屾椂 `sync()` 鏂囦欢銆?
`IMU_*.CSV` 褰撳墠瀛楁锛?
```text
timestamp_us,gps_time_valid,
accel_valid,gyro_valid,mag_valid,
sw1_pressed,sw2_pressed,sw3_pressed,sw4_pressed,
accel_x_g,accel_y_g,accel_z_g,
gyro_x_dps,gyro_y_dps,gyro_z_dps,
mag_x_counts,mag_y_counts,mag_z_counts,
accel_cal_x_g,accel_cal_y_g,accel_cal_z_g,
gyro_cal_x_dps,gyro_cal_y_dps,gyro_cal_z_dps,
mag_cal_x_counts,mag_cal_y_counts,mag_cal_z_counts
```

姣忔寮€鏈虹敓鎴愭柊鐨?CSV 鏂囦欢骞跺啓鍏ュ綋鍓嶈〃澶淬€?
### 涓插彛鐘舵€佽緭鍑?
涓插彛娉㈢壒鐜囦负 115200锛屾瘡绉掕緭鍑轰竴琛岋細

```text
[12345 ms] GPS ready=1 baud=115200 fix=3 sats=18 gps_nav=1 time=1 2026-05-19 12:34:56 gps_sog=2.31kn gps_cog=123.4 ubx_pending=512 | IMU ready=1 a/g/m=1/1/1 ts=... gps_ts=1 acc=... gyro=... mag=... | AHRS valid=1 hdg_src=IMU hdg=123.4 roll=1.2 pitch=-0.4 drift=+0.0 | SD ready=1 log_ready=1 imu_pending=2048 last_flush_age=345
```

瀛楁璇存槑锛?
- `GPS ready`: GNSS 鍒濆鍖栨槸鍚︽垚鍔熴€?- `fix`: u-blox fix type锛? 琛ㄧず鏃犳湁鏁堝畾浣嶏紝2 琛ㄧず 2D锛? 琛ㄧず 3D銆?- `sats`: 鍗槦鏁般€?- `gps_nav`: GNSS SOG/COG 鏄惁鍙敤浜庢樉绀恒€?- `time`: GNSS UTC 鏄惁鏈夋晥涓?fully resolved銆?- `gps_sog/gps_cog`: GNSS 杈撳嚭鐨勫鍦拌埅閫熷拰瀵瑰湴鑸悜銆?- `ubx_pending`: GNSS file buffer 涓瓑寰呭啓鍏?SD 鐨?UBX 瀛楄妭鏁般€?- `IMU ready`: BMI270 鍜?MMC5983MA 鍒濆鍖栨槸鍚︽垚鍔熴€?- `a/g/m`: accel/gyro/mag 鏈鏁版嵁鏄惁鏈夋晥銆?- `gps_ts`: IMU 鏃堕棿鎴虫槸鍚︽潵鑷?GNSS UTC銆?- `AHRS valid`: 濮挎€佹槸鍚﹀凡缁忓垵濮嬪寲銆?- `hdg/roll/pitch`: AHRS 杈撳嚭鐨勮埅鍚戙€佹í鍊俱€佺旱鍊俱€?- `drift`: `wrap180(gps_cog - hdg)`锛屼綆閫熸椂涓?`nan`/鏄剧ず涓?`--`銆?- `SD ready`: SD 鍗℃槸鍚﹀垵濮嬪寲鎴愬姛銆?- `log_ready`: 鏈寮€鏈哄甫鏃堕棿鎴崇殑 GNSS/IMU 鏃ュ織鏂囦欢鏄惁宸茬粡鍒涘缓銆?- `imu_pending`: IMU CSV 鍐呭瓨 buffer 涓瓑寰呭啓鍏ョ殑瀛楄妭鏁般€?- `last_flush_age`: 璺濈涓婃 SD flush 鐨勬绉掓暟銆?
### IMU 鍧愭爣绯诲拰棰勬棆杞?
绯荤粺鍐呴儴浣跨敤鑸逛綋鍧愭爣绯伙細

- `X`: 鑸瑰ご鏂瑰悜 / forward
- `Y`: 鍙宠埛鏂瑰悜 / starboard
- `Z`: 鍚戜笅 / down

濡傛灉 BMI270 鎴?MMC5983MA 鍦?PCB 涓婄殑鏂瑰悜涓庤埞浣撳潗鏍囩郴涓嶄竴鑷达紝闇€瑕佸湪 [include/sensor_rotation_config.h](include/sensor_rotation_config.h) 閰嶇疆瀹夎瑙掞細

```cpp
constexpr EulerDegrees BMI270_PRE_ROTATION_DEG = {
    0.0f,  // roll about X
    0.0f,  // pitch about Y
    0.0f,  // yaw about Z
};

constexpr EulerDegrees MMC5983MA_PRE_ROTATION_DEG = {
    0.0f,
    0.0f,
    0.0f,
};
```

鏃嬭浆椤哄簭涓猴細

1. roll about X
2. pitch about Y
3. yaw about Z

棰勬棆杞彂鐢熷湪浼犳劅鍣ㄥ師濮嬭鍙栧悗銆佹牎鍑嗗墠銆?
### 浼犳劅鍣ㄦ牎鍑?
鏍″噯鍙傛暟浣嶄簬 [include/sensor_calibration_config.h](include/sensor_calibration_config.h)銆傛牎鍑嗗湪瀹夎瑙掗鏃嬭浆鍚庢墽琛屻€?
#### 鍔犻€熷害璁?
```cpp
constexpr Vector3 ACCEL_BIAS_G = {0.0f, 0.0f, 0.0f};
constexpr Vector3 ACCEL_SCALE = {1.0f, 1.0f, 1.0f};
```

璁＄畻鏂瑰紡锛?
```text
accel_cal = (accel_rotated - ACCEL_BIAS_G) * ACCEL_SCALE
```

#### 闄€铻轰华

```cpp
constexpr Vector3 GYRO_BIAS_DPS = {0.0f, 0.0f, 0.0f};
```

璁＄畻鏂瑰紡锛?
```text
gyro_cal = gyro_rotated - GYRO_BIAS_DPS
```

AHRS 鍐呴儴杩樹細瀵?Z 杞?gyro bias 鍋氬緢灏忕殑鍦ㄧ嚎瀛︿範锛?
```cpp
constexpr float GYRO_Z_BIAS_LEARN_GAIN = 0.0008f;
```

#### 纾佸姏璁?
```cpp
constexpr Vector3 MAG_BIAS_COUNTS = {0.0f, 0.0f, 0.0f};
constexpr Matrix3 MAG_SOFT_IRON = {{
    {1.0f, 0.0f, 0.0f},
    {0.0f, 1.0f, 0.0f},
    {0.0f, 0.0f, 1.0f},
}};
constexpr float MAG_DECLINATION_DEG = 0.0f;
```

璁＄畻鏂瑰紡锛?
```text
mag_centered = mag_rotated - MAG_BIAS_COUNTS
mag_cal = MAG_SOFT_IRON * mag_centered
heading_true = heading_magnetic + MAG_DECLINATION_DEG
```

瀹為檯浣跨敤鍓嶏紝搴旈€氳繃缁曚笁杞存棆杞噰闆嗘暟鎹嫙鍚?hard-iron bias 鍜?soft-iron 鐭╅樀銆傛病鏈夌鏍″噯鏃讹紝heading 鍙兘鐢ㄤ簬鑱旇皟锛屼笉搴斾綔涓烘瘮璧涘鑸緷鎹€?
### AHRS 鍜屽鑸樉绀?
AHRS 瀹炵幇鍦?[src/nav_estimator.cpp](src/nav_estimator.cpp)锛屼娇鐢ㄥ洓鍏冩暟鐘舵€併€?
褰撳墠铻嶅悎绛栫暐锛?
- 鐢?gyro 绉垎鐭椂濮挎€佸彉鍖栥€?- 鐢?accel 浼拌 roll/pitch锛屽苟闄愬埗鍔犻€熷害妯￠暱鍦?`0.65 g` 鍒?`1.35 g` 鍐呮墠鍙備笌淇銆?- 鐢?mag 鍋氬€炬枩琛ュ伩 heading銆?- 灏?accel/mag 璁＄畻鍑虹殑娴嬮噺濮挎€佷笌 gyro 绉垎濮挎€佸仛浜掕ˉ铻嶅悎銆?- 灏?AHRS 濮挎€佽緭鍑轰负 `heading_deg`銆乣roll_deg`銆乣pitch_deg`銆?- SOG 浣跨敤 GNSS `gSpeed`銆?- COG 浣跨敤 GNSS `headMot`銆?- Drift 浣跨敤 `wrap180(GNSS COG - AHRS heading)`锛屼綆閫熸椂鏄剧ず `--`銆?
澧炵泭閰嶇疆锛?
```cpp
constexpr float AHRS_ACCEL_GAIN = 0.025f;
constexpr float AHRS_MAG_GAIN = 0.035f;
```

闄愬埗锛?
- GNSS COG 鍦ㄤ綆閫熸椂涓嶇ǔ瀹氾紝鍥犳 drift 鍙湪 SOG 澶т簬闃堝€兼椂鏄剧ず銆?- 娌℃湁纾佹牎鍑嗘椂锛宧eading 浼氬彈鑸逛綋纭搧/杞搧褰卞搷銆?- 濡傛灉瀹夎瑙掗厤缃敊璇紝roll/pitch/heading 閮戒細鏄庢樉涓嶆纭€?
### 鏄剧ず绯荤粺

鏄剧ず鏈嶅姟浣嶄簬 [src/display_service.cpp](src/display_service.cpp)銆?
褰撳墠閰嶇疆锛?
- LVGL 鐗堟湰锛?.3.0
- LVGL logical resolution锛歚400 x 300`
- LVGL color format锛歚RGB888`
- ST7305 panel buffer锛氱敱 ST7305 搴撶淮鎶?- 鍒锋柊锛歀VGL partial flush 鍐欏叆 ST7305 buffer锛屾渶鍚庤妭娴佽皟鐢?`panel_.display()`
- 鐗╃悊鍒锋柊闂撮殧锛歚250 ms`
- `ui_tick()` 闂撮殧锛歚1000 ms`

ST7305 鏄崟鑹插弽灏勫睆锛屾暣灞?`display()` 浼氭湁鍙鍒锋柊銆傛彁楂?SPI 棰戠巼鍙兘缂╃煭浼犺緭鏃堕棿锛屼笉鑳藉交搴曟秷闄ら潰鏉垮埛鏂伴棯鐑併€?
### 甯歌闂

#### SD ready=0

妫€鏌ワ細

- SD 鍗℃槸鍚?FAT32銆?- SD CS/MOSI/MISO/SCLK 鏄惁鎺ュ銆?- SD 鍗′緵鐢垫槸鍚︾ǔ瀹氥€?- `include/logging_config.h` 涓?`SD_SPI_HZ` 鏄惁杩囬珮銆?
#### log_ready=0

SD 宸插垵濮嬪寲浣嗘棩蹇楁枃浠惰繕娌″垱寤恒€傞€氬父鏄?GNSS UTC 杩樻病 valid/fully resolved锛涙嬁鍒版椂闂村悗鍥轰欢浼氬垱寤哄甫鏃堕棿鎴崇殑鏂版枃浠躲€?
#### GPS ready=0

妫€鏌ワ細

- GNSS TX/RX 鏄惁浜ゅ弶杩炴帴銆?- GNSS 褰撳墠娉㈢壒鐜囨槸鍚︿负 `115200`銆?- GNSS 鏄惁杈撳嚭 UBX锛屾垨鏄惁闇€瑕佸厛鐢?u-center 鎭㈠榛樿閰嶇疆銆?
#### IMU ready=0

妫€鏌ワ細

- I2C SDA/SCL 鏄惁鎺ュ弽銆?- BMI270 鍦板潃鏄惁涓?`0x68` 鎴栭渶瑕佹敼鎴?`0x69`銆?- MMC5983MA 鏄惁鍦?`0x30`銆?
#### heading 涓嶇ǔ瀹氭垨鍋忓樊澶?
浼樺厛妫€鏌ワ細

- `sensor_rotation_config.h` 瀹夎瑙掋€?- 纾佸姏璁?hard-iron / soft-iron 鏍″噯銆?- 纾佸姏璁℃槸鍚﹁繙绂诲ぇ鐢垫祦瀵肩嚎銆佺閾併€佸枃鍙€侀搧浠躲€?- `MAG_DECLINATION_DEG` 鏄惁璁剧疆涓哄綋鍦扮鍋忚銆?
#### 灞忓箷浠嶇劧闂儊

ST7305 鏁村睆鍒锋柊瀛樺湪澶╃劧鍙闂儊銆傚彲浠ラ檷浣?UI 鏁版嵁鏇存柊棰戠巼鎴栧皢 `kPanelSubmitIntervalMs` 浠?`250` 澧炲ぇ鍒?`500`銆?
---

## English Documentation

### Project Overview

This firmware runs on an ESP32-S3 N16R8 board and provides marine navigation data acquisition, display, and logging. The system connects to a u-blox NEO-F10N GNSS receiver, BMI270 IMU, MMC5983MA magnetometer, ST7305 monochrome LCD, FAT32 SD card, and four pull-up buttons.

Implemented features:

- GNSS UBX configuration: `UBX-NAV-PVT` at 8 Hz, `UBX-NAV-SAT` and `UBX-NAV-SIG` at 1 Hz.
- I2C IMU/magnetometer sampling at 64 Hz.
- MCU timestamps use GNSS-resolved UTC whenever available.
- FAT32 SD logging for raw UBX binary and timestamped IMU CSV.
- ST7305 monochrome LCD driven by LVGL 9.3.
- Active-low buttons with internal/external pull-up behavior and software debounce.
- IMU installation pre-rotation, sensor calibration, and AHRS attitude fusion.
- Serial status output for GPS, IMU, AHRS/Nav, and SD once per second.

### Hardware Connections

All pins are defined in [include/hardware_config.h](include/hardware_config.h).

#### GNSS UART

| Signal | ESP32-S3 GPIO |
| --- | --- |
| UART TX | 17 |
| UART RX | 18 |
| Baud rate | 115200 |

GNSS uses `HardwareSerial(1)`. The firmware configures and receives UBX messages:

- `UBX-NAV-PVT`: 8 Hz
- `UBX-NAV-SAT`: 1 Hz
- `UBX-NAV-SIG`: 1 Hz

#### SD Card SPI

| Signal | ESP32-S3 GPIO |
| --- | --- |
| CS / SS | 42 |
| MOSI | 41 |
| SCLK | 40 |
| MISO | 39 |
| SPI clock | 25 MHz |

The SD card must be formatted as FAT32. If initialization fails, the logger remains `ready=0`.

#### LCD SPI

| Signal | ESP32-S3 GPIO |
| --- | --- |
| SCLK / SCL | 10 |
| MOSI / SDA | 11 |
| RST | 12 |
| DC | 13 |
| CS | 14 |
| TE | 21 |
| SPI clock | 80 MHz |

The LCD is a 4.2-inch ST7305 monochrome panel. The LVGL logical resolution is `400 x 300`; the flush callback rotates it to the physical `300 x 400` panel.

ST7305 full refreshes are visibly noticeable. The firmware throttles physical panel submits to 4 Hz and runs `ui_tick()` at 1 Hz.

#### I2C IMU / Magnetometer

| Device | Address | SDA | SCL |
| --- | --- | --- | --- |
| BMI270 | `0x68` | 6 | 7 |
| MMC5983MA | `0x30` | 6 | 7 |

I2C runs at 400 kHz.

#### Buttons

| Button | ESP32-S3 GPIO |
| --- | --- |
| SW1 | 47 |
| SW2 | 48 |
| SW3 | 9 |
| SW4 | 8 |

Buttons are idle high and active low. The debounce time is 25 ms.

### Source Layout

| File | Purpose |
| --- | --- |
| [src/main.cpp](src/main.cpp) | Main setup/loop and service scheduling |
| [src/gnss_service.cpp](src/gnss_service.cpp) | u-blox configuration, PVT callback, UBX buffer extraction |
| [src/imu_service.cpp](src/imu_service.cpp) | BMI270/MMC5983MA init, 64 Hz sampling, rotation, calibration |
| [src/nav_estimator.cpp](src/nav_estimator.cpp) | AHRS fusion for heading/roll/pitch |
| [src/logging_service.cpp](src/logging_service.cpp) | FAT32 SD setup, UBX and IMU CSV logging |
| [src/display_service.cpp](src/display_service.cpp) | ST7305 + LVGL9 display backend and refresh throttling |
| [include/hardware_config.h](include/hardware_config.h) | Pins, addresses, bus speeds |
| [include/sensor_rotation_config.h](include/sensor_rotation_config.h) | BMI270/MMC5983MA installation pre-rotation |
| [include/sensor_calibration_config.h](include/sensor_calibration_config.h) | Accel/gyro/mag calibration and AHRS gains |
| [include/logging_config.h](include/logging_config.h) | Flush interval and buffer sizes |
| [lib/ui](lib/ui) | LVGL UI library and SailSIQ page definitions |

### Build and Upload

The project uses PlatformIO with the Arduino framework.

```powershell
pio run
pio run -t upload
pio device monitor -b 115200
```

In the current local PlatformIO virtual environment:

```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run
```

Main dependencies are defined in [platformio.ini](platformio.ini):

- `ft-tele/ST7305_MonoTFT_Library`
- `greiman/SdFat`
- `7semi-solutions/7Semi BMI270`
- `sparkfun/SparkFun MMC5983MA Magnetometer Arduino Library`
- `sparkfun/SparkFun u-blox GNSS v3`
- `lvgl/lvgl@9.3.0`

### Runtime Flow

`setup()` initializes:

1. Serial at 115200
2. Four debounced buttons
3. GNSS UART and u-blox UBX output
4. BMI270 / MMC5983MA over I2C
5. SD card and log files
6. UI model
7. ST7305/LVGL display
8. UI command handler

`loop()` continuously:

1. Updates button states and sends UI button events.
2. Processes GNSS UBX data and callbacks.
3. Samples IMU/magnetometer at 64 Hz.
4. Appends IMU samples to the CSV memory buffer.
5. Updates AHRS and navigation estimates.
6. Flushes UBX/IMU logs to SD every 1000 ms.
7. Updates the UI model every 250 ms.
8. Prints serial status every 1000 ms.
9. Runs LVGL timers and throttled ST7305 refresh.

### Data Logging

The SD card stores two files:

| File | Contents |
| --- | --- |
| `GNSS_YYYYMMDD_HHMMSS.UBX` | Raw UBX binary stream containing PVT/SAT/SIG |
| `IMU_YYYYMMDD_HHMMSS.CSV` | Timestamped IMU, magnetometer, button, and calibrated sensor data |

File names use GNSS UTC. The SD card is initialized at boot; the two session files are created after valid GNSS time is available. If a file with the same timestamp already exists, `_01`, `_02`, and so on are appended without overwriting old logs.

Write strategy:

- UBX data is buffered by the SparkFun GNSS file buffer and written once per second.
- IMU CSV lines are buffered in RAM and written once per second.
- `flushIfDue()` runs every 1000 ms and calls `sync()` on both files.

Current `IMU_*.CSV` fields:

```text
timestamp_us,gps_time_valid,
accel_valid,gyro_valid,mag_valid,
sw1_pressed,sw2_pressed,sw3_pressed,sw4_pressed,
accel_x_g,accel_y_g,accel_z_g,
gyro_x_dps,gyro_y_dps,gyro_z_dps,
mag_x_counts,mag_y_counts,mag_z_counts,
accel_cal_x_g,accel_cal_y_g,accel_cal_z_g,
gyro_cal_x_dps,gyro_cal_y_dps,gyro_cal_z_dps,
mag_cal_x_counts,mag_cal_y_counts,mag_cal_z_counts
```

Each boot creates a new CSV file and writes the current header.

### Serial Status Output

The serial port is `115200`. One status line is printed every second:

```text
[12345 ms] GPS ready=1 baud=115200 fix=3 sats=18 gps_nav=1 time=1 2026-05-19 12:34:56 gps_sog=2.31kn gps_cog=123.4 ubx_pending=512 | IMU ready=1 a/g/m=1/1/1 ts=... gps_ts=1 acc=... gyro=... mag=... | AHRS valid=1 hdg_src=IMU hdg=123.4 roll=1.2 pitch=-0.4 drift=+0.0 | SD ready=1 log_ready=1 imu_pending=2048 last_flush_age=345
```

Key fields:

- `GPS ready`: GNSS initialization status.
- `fix`: u-blox fix type, where 0 means no valid fix, 2 means 2D, and 3 means 3D.
- `sats`: Number of satellites.
- `gps_nav`: Whether GNSS SOG/COG are usable for display.
- `time`: Whether GNSS UTC is valid and fully resolved.
- `gps_sog/gps_cog`: GNSS speed over ground and course over ground.
- `ubx_pending`: UBX bytes waiting in the GNSS file buffer.
- `IMU ready`: BMI270 and MMC5983MA initialization status.
- `a/g/m`: Whether accel/gyro/mag samples are valid.
- `gps_ts`: Whether the IMU timestamp is based on GNSS UTC.
- `AHRS valid`: Whether attitude has initialized.
- `hdg/roll/pitch`: AHRS heading, roll, and pitch.
- `drift`: `wrap180(gps_cog - hdg)`, or hidden/`nan` at low speed.
- `SD ready`: SD card initialization status.
- `log_ready`: Whether the timestamped GNSS/IMU session files have been created.
- `imu_pending`: Bytes waiting in the IMU CSV RAM buffer.
- `last_flush_age`: Milliseconds since the last SD flush.

### IMU Frame and Pre-Rotation

The internal vessel body frame is:

- `X`: forward
- `Y`: starboard
- `Z`: down

If BMI270 or MMC5983MA mounting does not match this frame, configure installation angles in [include/sensor_rotation_config.h](include/sensor_rotation_config.h):

```cpp
constexpr EulerDegrees BMI270_PRE_ROTATION_DEG = {
    0.0f,  // roll about X
    0.0f,  // pitch about Y
    0.0f,  // yaw about Z
};

constexpr EulerDegrees MMC5983MA_PRE_ROTATION_DEG = {
    0.0f,
    0.0f,
    0.0f,
};
```

Rotation order:

1. roll about X
2. pitch about Y
3. yaw about Z

Pre-rotation is applied after raw sensor reads and before calibration.

### Sensor Calibration

Calibration constants live in [include/sensor_calibration_config.h](include/sensor_calibration_config.h). Calibration is applied after installation pre-rotation.

#### Accelerometer

```cpp
constexpr Vector3 ACCEL_BIAS_G = {0.0f, 0.0f, 0.0f};
constexpr Vector3 ACCEL_SCALE = {1.0f, 1.0f, 1.0f};
```

Formula:

```text
accel_cal = (accel_rotated - ACCEL_BIAS_G) * ACCEL_SCALE
```

#### Gyroscope

```cpp
constexpr Vector3 GYRO_BIAS_DPS = {0.0f, 0.0f, 0.0f};
```

Formula:

```text
gyro_cal = gyro_rotated - GYRO_BIAS_DPS
```

The AHRS also applies a very small online Z-axis gyro bias adaptation:

```cpp
constexpr float GYRO_Z_BIAS_LEARN_GAIN = 0.0008f;
```

#### Magnetometer

```cpp
constexpr Vector3 MAG_BIAS_COUNTS = {0.0f, 0.0f, 0.0f};
constexpr Matrix3 MAG_SOFT_IRON = {{
    {1.0f, 0.0f, 0.0f},
    {0.0f, 1.0f, 0.0f},
    {0.0f, 0.0f, 1.0f},
}};
constexpr float MAG_DECLINATION_DEG = 0.0f;
```

Formula:

```text
mag_centered = mag_rotated - MAG_BIAS_COUNTS
mag_cal = MAG_SOFT_IRON * mag_centered
heading_true = heading_magnetic + MAG_DECLINATION_DEG
```

For real use, collect full 3D rotation data and fit hard-iron bias plus a soft-iron correction matrix. Without magnetometer calibration, heading is suitable for integration testing only.

### AHRS and Navigation Estimation

The AHRS is implemented in [src/nav_estimator.cpp](src/nav_estimator.cpp) and uses a quaternion state.

Current fusion behavior:

- Gyro integrates short-term attitude changes.
- Accel estimates roll/pitch, but only when acceleration norm is between `0.65 g` and `1.35 g`.
- Mag provides tilt-compensated heading.
- The accel/mag measured attitude is blended with the gyro-integrated attitude.
- Output attitude is `heading_deg`, `roll_deg`, and `pitch_deg`.

Gain configuration:

```cpp
constexpr float AHRS_ACCEL_GAIN = 0.025f;
constexpr float AHRS_MAG_GAIN = 0.035f;
```

Navigation display:

- SOG uses GNSS `gSpeed`.
- COG uses GNSS `headMot`.
- Drift uses `wrap180(GNSS COG - AHRS heading)` and is hidden at low speed.

Limitations:

- GNSS COG is unstable at low speed, so drift is hidden below the SOG threshold.
- Heading is strongly affected by hard/soft iron unless magnetometer calibration is performed.
- Incorrect installation pre-rotation will make roll, pitch, and heading wrong.

### Display System

Display code is in [src/display_service.cpp](src/display_service.cpp).

Current configuration:

- LVGL version: 9.3.0
- LVGL logical resolution: `400 x 300`
- LVGL color format: `RGB888`
- ST7305 panel buffer: maintained by the ST7305 library
- Refresh: LVGL partial flush writes into the ST7305 buffer, then a throttled `panel_.display()` submits it
- Physical refresh interval: `250 ms`
- `ui_tick()` interval: `1000 ms`

The ST7305 is a monochrome reflective display. Full panel submits are visibly noticeable. Higher SPI clock shortens transfer time but cannot fully remove the panel refresh flash.

### Troubleshooting

#### `SD ready=0`

Check:

- The SD card is FAT32.
- SD CS/MOSI/MISO/SCLK wiring.
- SD card power stability.
- `SD_SPI_HZ` in [include/logging_config.h](include/logging_config.h).

#### `log_ready=0`

The SD card is initialized but session files have not been created yet. This usually means GNSS UTC is not valid/fully resolved; once time is available, the firmware creates new timestamped files.

#### `GPS ready=0`

Check:

- GNSS TX/RX are crossed correctly.
- GNSS baud rate is `115200`.
- GNSS is configured for UBX output, or restore defaults with u-center first.

#### `IMU ready=0`

Check:

- I2C SDA/SCL wiring.
- BMI270 address is `0x68`, or change to `0x69` if needed.
- MMC5983MA is present at `0x30`.

#### Heading is unstable or offset

Check:

- Installation angles in [include/sensor_rotation_config.h](include/sensor_rotation_config.h).
- Magnetometer hard-iron and soft-iron calibration.
- Magnetic interference from high-current wires, magnets, speakers, or steel parts.
- Local magnetic declination in `MAG_DECLINATION_DEG`.

#### Display still flashes

The ST7305 has visible full-refresh behavior. Reduce dynamic UI update frequency or increase `kPanelSubmitIntervalMs` from `250` to `500`.
