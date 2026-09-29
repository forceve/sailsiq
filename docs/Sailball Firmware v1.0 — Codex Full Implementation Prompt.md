# Sailball Firmware v1.0 — Full Implementation Prompt

> **HISTORICAL PLANNING PROMPT.** This file records an earlier implementation brief, not current project status or authority. For current v1.0 status and hardware testing, start at the [documentation index](README.md) and [hardware tester handoff](hardware-test-handoff-v1.0.md).

你现在负责实现 **Sailball Firmware v1.0**。

这是一次完整实现任务，不是架构讨论、代码示例、原型或只生成 skeleton。

你的目标是在现有仓库基础上，把 Sailball ESP32-C3 / ESP-IDF 固件实现到当前环境能够达到的最高完成度，并通过所有无需真实硬件即可完成的自动测试与构建。

不要停在计划阶段。  
不要只创建目录和接口。  
不要在完成一小部分后等待确认。  
不要擅自改变冻结协议、LDC 格式或架构来简化实现。

如果某一项确实依赖当前仓库中不存在的真实硬件信息，例如 GPIO、具体 GNSS 型号或板级电路，请完整实现其抽象层、状态机、测试替身和构建路径，并将该项明确标记为：

`PENDING HARDWARE CONFIG`

继续完成所有与该未知信息无关的工作。

---

# 0. 第一原则：先读规范，再写代码

开始任何代码修改前，递归搜索仓库并定位以下权威文档。

优先使用这些 exact filenames；如果位于其他目录，以实际位置为准：

```text
sailball-protocol-v1.0.md
sailball-client-interface-v1.0.md
LDC_v1_Format_Specification-v1.0.md
firmware-architecture-v1.0.md
runtime-recovery-policy-v1.0.md
test-acceptance-v1.0.md
CONSISTENCY-CHANGELOG-v1.0.md
```

必须完整阅读。

如果仓库内同时存在旧版：

```text
sailball-protocol-v1.md
*-fixed.md
Candidate
旧 architecture 文档
旧 prompt
旧设计记录
```

不得让旧版本覆盖 v1.0 Frozen。

---

# 1. 规范优先级

发生歧义时按以下原则处理。

## 1.1 Wire Protocol

线上 ABI：

```text
sailball-protocol-v1.0.md
```

是唯一权威。

Client Interface 是客户端使用指南，不得反向修改 Protocol ABI。

## 1.2 LDC

磁盘格式：

```text
LDC_v1_Format_Specification-v1.0.md
```

是唯一权威。

Firmware 不得为了方便改变：

- magic；
- offset；
- structure size；
- enum；
- CRC coverage；
- metadata layout；
- commit semantics；
- field registry；
- block encoding。

## 1.3 Firmware

内部实现：

```text
firmware-architecture-v1.0.md
runtime-recovery-policy-v1.0.md
```

为权威。

## 1.4 Testing

```text
test-acceptance-v1.0.md
```

定义验收标准。

如果代码与规范冲突：

**修改代码，不修改规范。**

如果发现规范之间仍存在真正无法同时满足的直接矛盾：

1. 不自行发明第三种规则；
2. 记录到 `docs/implementation-spec-conflicts.md`；
3. 标记具体文件、章节、冲突；
4. 暂停该冲突点；
5. 继续实现所有不受影响部分。

除非存在真正矛盾，否则不要创建这个文件。

---

# 2. 技术栈冻结

目标：

```text
MCU: ESP32-C3
Framework: ESP-IDF
Language: primarily C
RTOS: ESP-IDF FreeRTOS
```

不得迁移到：

```text
Arduino
PlatformIO
Zephyr
其他Framework
```

不得引入：

- C++ exception 依赖；
- RTTI 依赖；
- 大量 STL dynamic container；
- runtime reflection；
- 动态脚本运行环境。

局部第三方组件确实需要 C++ 时必须隔离，不得让 exception / RTTI 模型进入 Critical Path。

---

# 3. 先检查当前环境

不要假设 ESP-IDF 尚未安装，也不要重复安装已有工具。

检查：

```text
Git
Python
CMake
Ninja
ESP-IDF
idf.py
ESP32-C3 toolchain
VS Code project config
现有 sdkconfig
现有代码
现有测试
```

如果环境已经部署成功，直接复用。

必须最终执行：

```text
idf.py --version
idf.py set-target esp32c3
idf.py reconfigure
idf.py build
```

不要进行真实设备 flash，除非当前执行环境明确提供真实板卡并且已有安全授权。

---

# 4. 保留现有工作

先审查仓库。

不要：

- 无理由删除现有代码；
- 覆盖用户已有硬件定义；
- 删除可用脚本；
- 重建整个 Git 仓库；
- 擅自改变 unrelated 文件。

如果已有代码与 Frozen Architecture 明显冲突，应重构，但保留有价值的驱动或算法实现。

---

# 5. 最终 Component Architecture

以 ESP-IDF components 实现以下模块：

```text
sailball_common
sailball_board
sailball_system

sailball_diagnostics
sailball_supervisor

sailball_gnss
sailball_ldc
sailball_recorder
sailball_storage

sailball_sp
sailball_control
sailball_transfer

sailball_usb
sailball_ble
sailball_wifi

sailball_ui
```

`main/app_main.c` 必须非常薄。

理想形式接近：

```c
void app_main(void)
{
    sb_system_start();
}
```

不得把完整 subsystem 初始化和业务逻辑堆在 `app_main.c`。

---

# 6. Public / Private Boundary

每个 Component 根据需要使用：

```text
include/sailball/
private_include/
```

Public header 只能暴露：

- public Service API；
- Snapshot；
- 必要 shared type。

Private header 包含：

- Task internals；
- driver；
- hardware access；
- internal state machine。

不得为了方便将所有 internal header 放到 public include。

统一 public symbol 前缀：

```text
sb_
```

例如：

```text
sb_gnss_get_status()
sb_recorder_request_start()
sb_storage_submit_critical()
sb_sp_frame_decode()
```

文件内 helper 使用 `static`。

---

# 7. Single Owner Rule

必须严格执行唯一所有者。

```text
GNSS UART/parser            → gnss_task
Latest GNSS state           → gnss_task

recording_intent            → recorder_task
Recorder state              → recorder_task
current LDC block           → recorder_task

SD/FatFS/FIL/DIR            → storage_task
free-space cache            → storage_task

critical_path_healthy       → supervisor_task
optional battery ADC        → supervisor_task

SP command dispatch         → control_task
Transport Session / I/O     → transport_task
Transfer state              → transfer_task

UI page / WS2818B           → ui_task
```

禁止跨 Task 直接修改 owner state。

禁止其他模块获取：

```text
FIL *
DIR *
GNSS raw UART handle
```

---

# 8. Application Tasks

实现八个应用 Task。

相对优先级：

```text
gnss_task        P10
recorder_task    P8
storage_task     P7
supervisor_task  P6
control_task     P5
transport_task   P4
transfer_task    P3
ui_task          P2
```

这是 application-relative ordering，不要错误覆盖 ESP-IDF system task 的要求。

Task：

- boot 创建一次；
- 正常 runtime 不 delete/recreate；
- subsystem ERROR 时 Task 仍存在；
- recovery 通过 state machine 完成。

优先使用：

```text
xTaskCreateStatic
xQueueCreateStatic
```

Critical Path 必须静态分配。

大 Buffer 禁止放在 Task stack。

---

# 9. Critical Data Path

唯一 Critical Data Path：

```text
GNSS UART
   ↓
gnss_task
   ↓
GnssFix Queue
   ↓
recorder_task
   ↓
LDC Block Pool
   ↓
Critical Storage Queue
   ↓
storage_task
   ↓
SD
```

以下模块绝不能成为同步依赖：

```text
SP
USB
BLE
Wi-Fi
TCP
Transfer
UI
Logging
Event delivery
```

任何 Network 或 UI 故障不得反压 Critical Path。

---

# 10. GnssFix

实现固定尺寸 normalized structure。

至少能够表达：

```text
sample_seq
mono_us
utc_us
utc_valid

latitude_e7
longitude_e7
position_valid

altitude_cm
ground_speed_centi_kn
course_centi_deg

satellites_used
fix_type
```

`sample_seq`：

- uint32；
- boot-local；
- 每个 normalized sample +1；
- 自然回卷；
- Recorder 用它检测 input gap。

内部 fix enum 必须比 SP enum 丰富，并显式映射：

```text
SB_GNSS_FIX_NONE
SB_GNSS_FIX_DEAD_RECKONING
SB_GNSS_FIX_2D
SB_GNSS_FIX_3D
SB_GNSS_FIX_GNSS_DR
SB_GNSS_FIX_TIME_ONLY
SB_GNSS_FIX_UNKNOWN
```

SP：

```text
NONE             → NO_FIX
FIX_2D           → FIX_2D
FIX_3D           → FIX_3D
TIME_ONLY        → NO_FIX
DEAD_RECKONING   → UNKNOWN
GNSS_DR          → UNKNOWN
UNKNOWN          → UNKNOWN
```

LDC 使用 LDC registry 自己的 enum。

禁止复制 vendor enum 数字。

---

# 11. GnssFix Queue

Baseline：

```text
depth = 32
```

使用 Static FreeRTOS Queue，by value。

Queue full：

```text
short bounded wait
→ retry enqueue
→ still full:
   drop newest incoming fix
   increment GNSS-owned fix_queue_drops
   resume UART servicing
```

不得覆盖已经排队的旧 sample。

不得无限等待。

Recorder 通过 `sample_seq` gap 自己增加自己的 loss counter。

一个 Task 不得修改另一个 subsystem 的 counter。

---

# 12. LDC Block Pool

Baseline：

```text
SB_LDC_BLOCK_CAPACITY = 8192
SB_LDC_BLOCK_POOL_COUNT = 4
```

状态：

```text
FREE
→ FILLING
→ READY
→ WRITING
→ FREE
```

可存在内部 WRITE_FAILED transient。

Buffer ownership 必须可验证。

非法 state transition 属于 Fatal Invariant。

4 个 Buffer 表示：

```text
4-block backlog capacity
```

不要声称固定能抗 45 秒。

实际时间取决于 block duration/data rate。

---

# 13. LDC 必须严格按 v1.0

不要重新设计格式。

关键固定值至少包括：

```text
Magic: LDC1
Metadata Region: 16 KiB
Data Region: 0x4000
BlockHeader: 96 B
StreamDescriptor: 16 B
CommitFooter: 16 B
Max Block Duration: 15,000,000 us
```

全部 multibyte fixed-width 字段显式 Little Endian。

禁止：

```c
fwrite(&native_struct, sizeof(native_struct), 1, ...)
```

作为持久 ABI。

禁止依赖 packed struct 表示 wire format。

实现：

```text
sb_read_le16
sb_read_le32
sb_read_le64

sb_write_le16
sb_write_le32
sb_write_le64
```

或等价 checked API。

---

# 14. LDC Library 必须纯

`sailball_ldc`：

不能拥有：

```text
Task
Queue
FatFS
SD driver
UART
Wi-Fi
```

它只负责：

```text
CRC32C
varint
ZigZag
codec
metadata serialization
metadata validation
block building
block validation
definition handling
time-grid helpers
```

目标是 deterministic：

```text
input → bytes
bytes → validated structure
```

以便 host test / golden vector / fuzz。

---

# 15. LDC Metadata COW

完整实现 Frozen LDC metadata transaction。

不得用“直接覆盖当前 metadata page”替代。

必须实现：

```text
双 Superblock
generation
page map
page CRC
shadow pages
copy-on-write publication
definition versioning
```

新 Definition：

```text
write new metadata pages
→ durable flush
→ publish new valid superblock
→ durable flush
→ only then may block reference it
```

Definition durable 之前不得提交引用它的 Block。

---

# 16. LDC Block Boundary

Block 最大 15 秒，但不是必须 15 秒。

至少在以下情况结束：

```text
15s reached
Block buffer safe capacity reached
UTC invalid→valid
UTC mapping discontinuity
GNSS restart
meaningful GNSS timing discontinuity
sample rate change
Field Definition change
field set / availability change
CONST change
```

未来数据量变大时优先：

```text
shorter Block
```

而不是无边界扩大 RAM。

---

# 17. LDC Field Availability

LDC v1 没有 per-field null bitmap。

Presence Bitmap 表示：

```text
整个 nominal sample slot 是否存在
```

而不是：

```text
某一个 STREAM field 是否有效
```

因此例如 altitude availability 在 Block 中途变化：

```text
cut current Block
→ start new Block with different descriptor set
```

不得：

- 写假 0；
- 给 altitude 私自做 null bitmap；
- 发明新 codec。

---

# 18. Durable Block Commit

必须严格实现两阶段 durability barrier。

Writer order：

```text
finalize Header + header CRC
write Header
write Directory
write Stream payloads
write Presence bitmap
write Footer first 12 bytes
↓
durable flush #1
↓
write final 4-byte LDCM commit magic
↓
durable flush #2
↓
blocks_committed++
advance readable_size
release Block Buffer
```

如果任意：

```text
write
flush #1
commit magic write
flush #2
```

失败：

```text
不得 report block committed
不得继续向这个 uncertain-tail file append下一Block
```

转 Storage failure / Epoch Abort。

不要把：

```text
15 second block
```

解释成绝对的“断电最多损失15秒”。

底层 SD / FAT 仍可能有自己的 power-fail 行为。

---

# 19. Recorder Identity

区分三个层级。

## Firmware/SP logical recording session

```text
recorder_session_id: uint32
```

boot-local。

表示一次 logical recording session。

## File sequence

```text
file_sequence
```

属于 recorder session。

Normal rollover：

```text
recorder_session_id unchanged
file_sequence++
```

## LDC file session ID

每个 `.ldc` 文件自己的：

```text
16-byte opaque nonzero unique session_id
```

每创建一个新的 LDC 都生成新的值。

不得把 SP uint32 session ID 填充/截断成 LDC 16 B session ID。

---

# 20. Normal Rollover

原因包括：

```text
SIZE_LIMIT
METADATA_FULL
```

结果：

```text
same recorder_session_id
file_sequence++
new LDC file session_id
block_sequence = 0
```

不能按日期/午夜固定 rollover。

File size policy 必须根据实际 SD 容量动态决定。

不得假设 SD 至少 1 GiB。

具体比例、reserve、absolute max：

```text
tuning
```

不是格式 ABI。

---

# 21. Storage Epoch Abort

Persistent critical storage failure 后必须显式 abort 当前 Storage Epoch。

至少：

```text
Storage → ERROR

current WRITING block → failed
all READY blocks belonging to failed epoch → failed
pending critical requests → failed
Recorder receives explicit failure Ack

loss accounted
failed buffers returned to pool
```

然后 Recorder 继续消费 GnssFix。

如果：

```text
recording_intent == true
```

但暂时不能写：

```text
consume
discard
count as unrecorded/lost
```

不得让 Fix Queue 塞满并最终拖死 GNSS。

Storage recovery：

```text
remount/reinit
→ new recorder session
→ new LDC
→ resume
```

永不继续 append abandoned file。

---

# 22. Storage Queues

Baseline：

```text
Critical Storage Queue depth ~8
Background Queue depth ~4
```

准确值允许 Kconfig tuning。

Critical：

```text
OPEN_RECORDING
metadata durability
WRITE_BLOCK
CLOSE
```

Background：

```text
TRANSFER READ
LIST
INFO
DELETE
FORMAT
```

优先级：

```text
critical LDC write/commit/close
>
Recorder metadata
>
Transfer read
>
LIST/INFO
```

Background operation 必须 sliced / bounded。

不得一次大型 directory scan 或 file read 占住 storage_task。

---

# 23. FatFS

Firmware v1：

```text
FatFS
FAT16
FAT32
LFN enabled
```

Firmware-generated filenames 使用 ASCII。

不要求 exFAT。

Mount fail：

```text
绝不自动 FORMAT
```

FORMAT：

```text
USB admin only
explicit command only
Recorder STOPPED
no active Transfer
```

---

# 24. Active File Transfer Snapshot

Firmware v1 全局最多：

```text
1 active bulk file transfer
```

`OPEN_READ(active_file)`：

```text
freeze readable_size = N
copy exact 16 KiB LDC Metadata Region into RAM snapshot
```

Transfer lifetime 内：

```text
offset < 0x4000
→ read from frozen Metadata Snapshot RAM

offset >= 0x4000
→ read append-only Data Region from SD

never read >= N
```

这样一次 active download 获得：

```text
consistent metadata snapshot
+
consistent committed data prefix
```

Recorder 后续 metadata COW 不改变当前 transfer 已冻结的 16 KiB。

---

# 25. Sailball Protocol

严格实现：

```text
sailball-protocol-v1.0.md
```

不要重新设计。

关键 Frame：

```text
Header 24 B
Payload N
CRC32C 4 B
```

USB/TCP：

```text
COBS(SP Frame) + 0x00
```

BLE：

```text
6-byte fragment header + SP frame fragments
```

CBOR：

```text
definite-length only
integer keys
no float
no tags
no indefinite item
max depth = 6
top-level Map depth = 1
```

所有 RX memory 必须 bounded。

---

# 26. Protocol Bootstrap

冻结：

```text
SP_V1_BOOTSTRAP_MIN_RX_PAYLOAD = 256
```

HELLO：

```text
max_rx_payload < 256
→ OUT_OF_RANGE
```

`device_id`：

```text
exactly 8-byte Byte String
```

来自 ESP32-C3 base eFuse MAC 派生 u64 的 LE bytes。

`boot_id`：

```text
random nonzero uint32 per boot
```

---

# 27. SP Logical Session Reset

同一个 physical transport 已 ONLINE 时：

合法：

```text
HELLO
sequence = 0
```

表示 logical SP Session reset。

执行：

```text
close old Transfer
cancel old live stream
clear subscriptions
clear old session pending/TX state
reset sequence
start new SP Session
HELLO RESPONSE sequence = 0
```

ONLINE 状态收到：

```text
HELLO sequence != 0
```

返回：

```text
INVALID_STATE
```

这必须支持 USB Controller App 重启但 USB 物理连接没断的情况。

---

# 28. Protocol Error Parsing Order

实现固定 validation order：

```text
Transport framing / local capacity
Magic / exact frame length / CRC
Major version
message type / request_id / flags/channel/reserved
HELLO/session state
Service + Command existence
Transport permission
CBOR structure
required key / field type
field range
subsystem state
resource availability
execute
```

不要随意改变，从而产生不可预测的 error precedence。

---

# 29. Protocol Generic Edge Rules

实现 Frozen v1：

```text
major != 1
→ drop, no response
```

v1：

```text
flags != 0
channel != 0
reserved != 0
```

REQUEST：

```text
UNSUPPORTED
```

非 REQUEST：

```text
drop
```

REQUEST：

```text
request_id = 0
→ drop + invalid counter
```

同一 Session 中重复仍 pending 的 request_id：

```text
不执行第二次
不发第二终结消息
计 diagnostic
```

已经完成的 ID 不保留无限 dedup history，可再次作为新请求使用。

---

# 30. Protocol Counter

公开 Diagnostics Counter：

```text
uint64
boot-local
monotonic
saturating
```

达到：

```text
UINT64_MAX
```

保持最大值，不回卷。

内部可以有更多 Validation metrics。

不要擅自新增 Protocol v1 key。

---

# 31. BLE v1 UUID

使用 Frozen UUID：

```text
Service:
ff26c6cf-0ed6-51c9-810d-b7bcfd0a9573

RX — Controller → Sailball WRITE:
dc7fc9d8-c2cf-51e8-8c75-5aaef0042d68

TX — Sailball → Controller NOTIFY:
0653875c-6670-562b-be88-54c11297fba7
```

Legacy Advertising 至少包含 Service UUID。

Local Name：

```text
Sailball-XXXX
```

XXXX = device ID low16 uppercase hex。

名字不承担 authentication。

---

# 32. BLE Fragment

每 connection、每 direction：

```text
initial frame_id = 0
```

complete frame 后 `+1`，uint16 wrap。

必须拒绝：

```text
empty fragment
wrong offset
gap
overlap
duplicate offset
total_length changed
out-of-range
nonzero-offset fragment without active assembly
```

异常：

```text
drop current assembly
fragment_error++
```

新：

```text
new frame_id + offset=0
```

允许替换 unfinished old assembly，同时计 error。

Assembly timeout bounded，但具体 ms 是 tuning。

不增加 fragment ACK / retransmit / CRC。

---

# 33. BLE Advertising Intent

内部：

```text
advertising_intent
```

Boot：

```text
true
```

实际广播：

```text
advertising_intent
&& !ble_connected
&& !wifi_online
```

`SET_ADVERTISING`：

```text
modify intent
return OK
```

false：

- 不主动断 existing connection；
- Wi-Fi 结束后也不自动恢复 advertising。

Wi-Fi handover 成功：

- 停止 advertising；
- **不要由 Sailball 自动 kick existing BLE connection**；
- Controller 确认 Wi-Fi ONLINE 后通过平台 BLE API 主动断开。

---

# 34. Wi-Fi

STA only。

Boot：

```text
Wi-Fi OFF
BLE advertising ON
```

即使 NVS 有 credentials 也不自动连接。

Flow：

```text
BLE/USB
→ SCAN
→ SET_CONFIG
→ Controller starts TCP listener
→ CONNECT(endpoint, handover_id)
→ STA
→ DHCP
→ outbound TCP
→ TRANSPORT_READY
→ HELLO
→ ONLINE
```

Sailball：

```text
TCP client
```

Controller：

```text
TCP server
```

禁止设备侧：

```text
TCP server
mDNS
UDP discovery
HTTP
WebSocket
```

除非未来 protocol minor 明确新增。

---

# 35. Wi-Fi Recovery

FIN：

```text
normal end
→ no reconnect
→ Wi-Fi OFF
→ advertising according to advertising_intent
```

Abnormal：

```text
RST / timeout / AP loss
→ RECOVERING
→ bounded retry/backoff
→ success ONLINE
or
→ OFF + BLE fallback
```

Retry count/backoff 属于 tuning。

Network failure 不影响 critical_path_healthy。

---

# 36. Live GNSS

Live Stream 不从 Recorder Queue 二次消费。

GNSS owner 维护：

```text
LatestGnssFixSnapshot
```

每 SP Session：

```text
field_mask
min_interval_ms
latest pending sample
```

语义：

```text
latest-value
best-effort
```

慢网络时：

```text
new sample replaces stale pending sample
live_stream_dropped++
```

绝不积累历史 live backlog。

完整数据只由 LDC 承担。

---

# 37. TX Scheduler

优先级：

```text
Response / bootstrap
Important Event
Bulk
Ordinary Event
Live Stream
```

不能使用导致 Bulk 永久 starvation 的无限 strict priority loop。

Response 无法进入 bounded TX：

```text
Session considered broken
terminate/reset that Transport Session
```

不得 block `control_task` 或 Recorder。

---

# 38. Transfer

v1：

```text
one global bulk file transfer
one Transfer per Session
one outstanding READ per Transfer
```

READ success：

```text
exactly one BULK
```

READ failure：

```text
exactly one normal RESPONSE
```

不得：

```text
OK RESPONSE
+
BULK
```

Frozen edge：

```text
length == 0 → OUT_OF_RANGE
offset >= frozen readable_size → OUT_OF_RANGE
```

非 EOF short read：

- storage layer 尽量补齐；
- 无法完整满足 → `IO_ERROR`；
- 不发半截非 EOF BULK。

CLOSE：

```text
no transfer → OK
matching transfer + no outstanding READ → OK
matching transfer + READ outstanding → BUSY
wrong active transfer_id → NOT_FOUND
```

---

# 39. Response Capacity

不得发送超过 receiver HELLO `max_rx_payload` 的 SP Payload。

可分页接口：

```text
LIST_FILES
GET_ERRORS
```

允许减少本批 entry 数满足容量。

单 entry 都放不下：

```text
OUT_OF_RANGE
```

非分页：

```text
GET_STATUS
GET_COUNTERS
GET_SCAN_RESULTS
GET_INFO
```

完整合法 response 放不下：

```text
OUT_OF_RANGE
```

不得偷偷 truncate schema。

---

# 40. Recorder State Machine

按 Frozen 状态行为实现。

START：

```text
STOPPED   → ACCEPTED
STARTING  → ACCEPTED
RECORDING → OK
STOPPING  → BUSY
ERROR     → ACCEPTED, recording_intent=true, recovery/new session
```

STOP：

```text
STOPPED   → OK
STARTING  → ACCEPTED
RECORDING → ACCEPTED
STOPPING  → ACCEPTED
ERROR     → ACCEPTED, recording_intent=false, cleanup → STOPPED
```

STOPPED 表示：

```text
no active Recorder session
no pending Recorder critical operation
```

不表示 abandoned old file 被修复。

---

# 41. Automatic Recording

Boot 默认：

```text
recording_intent = true
```

Storage ready：

```text
auto start
```

不等待：

```text
GNSS fix
UTC
```

RESET：

```text
always new recorder session/file
```

绝不修复后继续 append 旧 active file。

---

# 42. critical_path_healthy

由 `supervisor_task` 独占。

必须 intent-aware。

如果：

```text
recording_intent = true
```

健康要求 GNSS / Recorder / Storage 的有意义 progress。

如果：

```text
recording_intent = false
Recorder = STOPPED
```

这是合法状态，不应仅因为没有 block commit 就判断 unhealthy。

Network/UI faults 不影响该值。

Current health 与 historical errors/counters 分离。

恢复后必须有真实 progress 才重新 healthy。

---

# 43. Progress Watchdog

跟踪：

```text
GNSS last RX / valid message / fix produced
Recorder fix consumed / block completed
Storage block committed
Queue depth / high-water
free block count
```

需要能区分：

```text
GNSS没推进
Recorder没推进
Storage没推进
```

恢复作用于因果故障源。

Task WDT ≠ Progress Watchdog。

---

# 44. Critical Task WDT

Critical：

```text
gnss
recorder
storage
supervisor
```

正常等待全部：

```text
bounded
```

不得让 Critical Task 长时间 `portMAX_DELAY` 后无法 heartbeat。

真正 driver function 卡死不返回，可允许 Task WDT 最终 reset MCU。

UI Task hang 不应该单独导致整机 reset。

---

# 45. Reset Policy

普通外设故障不得 reset MCU。

不 reset：

```text
NO_FIX
GNSS hardware missing
GNSS restart failure
SD missing
SD full
ordinary SD write failure
BLE failure
Wi-Fi failure
TCP loss
UI failure
```

可 reset：

```text
critical task execution deadlock
stack corruption
heap corruption
fatal internal invariant
LDC encoder impossible state
critical ownership/state untrustworthy
```

---

# 46. CORE.REBOOT

USB only。

```text
ACCEPTED
→ TX response
→ bounded graceful shutdown
```

Shutdown：

```text
reject/stop new long background work
stop Transfer
Recorder close current block
perform correct LDC two-stage commit
Storage sync/close
restart
```

Global deadline tuning。

Deadline exceeded：

```text
restart anyway
```

REBOOT 不等同 RECORDER.STOP。

下一 boot 仍执行正常：

```text
recording_intent=true
```

---

# 47. Power

v1：

```text
no Light Sleep policy
no Deep Sleep policy
no automatic low-battery shutdown
```

GNSS 持续运行。

SD 正常 mounted。

Wi-Fi 按需。

BLE 默认 advertising。

WS2818B limited brightness。

没有 Battery ADC 的板：

```text
do not invent battery status
```

如果现有/未来 board 有 ESP32-C3 ADC battery sense：

```text
Supervisor low-rate sample
→ voltage_mv
→ voltage_valid
```

它不能影响 Recorder / critical health。

不要假设存在 GPIO controlled GNSS/SD load switch。

---

# 48. Logging

三 Profile：

```text
DEV
VALIDATION
PRODUCTION
```

Critical Path 禁止 per-sample textual logging。

高频异常：

```text
counter++
```

需要日志时 rate limit。

产品诊断依赖：

```text
Status
Counters
Error Ring
```

不是日志。

USB SP byte stream 必须 binary-clean。

绝不能混入：

```text
ESP_LOG...
```

文本。

---

# 49. Fatal vs Recoverable

External/hardware failure：

```text
explicit error handling / recovery
```

不要用：

```c
ESP_ERROR_CHECK(...)
```

让普通可恢复 I/O 错误直接 panic。

Internal impossible invariant：

```text
fatal
```

Production 仍启用。

实现类似：

```text
SB_FATAL_IF
```

但 fatal path 不尝试：

```text
BLE notify
network
long SD cleanup
long logging
```

---

# 50. Hardware Board Layer

所有硬件映射集中：

```text
sailball_board
```

包括：

```text
GNSS UART number/pins
SD SPI host/pins/CS
BOOT GPIO
WS2818B GPIO
optional battery ADC channel
hardware revision
```

如果当前仓库已经有真实定义：

**复用真实定义。**

如果没有：

**不要猜。**

提供：

```text
Kconfig
board config API
compile-safe unavailable state
fake/sim backend for tests
```

并在最终报告写：

```text
PENDING HARDWARE CONFIG
```

不要声称实机完成。

---

# 51. Concrete GNSS Driver

先检查现有仓库：

- 当前 GNSS module；
- existing UART protocol；
- NMEA / UBX / proprietary parser；
- configuration command；
- baud rate；
- update rate。

有证据就实现具体 adapter。

没有证据：

不要凭聊天外常识猜具体模块和 pin。

实现：

```text
GNSS driver interface
normalized parser boundary
fake GNSS source for tests
```

并将 concrete hardware adapter 标为待配置。

Critical architecture 不能因此停工。

---

# 52. Protocol CBOR Implementation

如果仓库已经有适合 ESP-IDF 的 vetted bounded CBOR library，可评估复用。

否则实现 minimal Sailball-specific CBOR encoder/decoder。

只实现协议允许的 subset。

必须：

```text
bounded input
bounded nesting
checked integer conversion
duplicate key detection
definite-length only
unknown key skip with same limits
no allocation from attacker-declared length
```

不要为了方便引入巨大 generic serialization stack。

---

# 53. Static Memory

优先保持当前 baseline：

```text
GnssFix Queue: 32
LDC Block Pool: 4 × 8 KiB
Bulk buffers: bounded
Transport RX/TX: bounded
BLE reassembly: bounded
```

Critical Path runtime 不使用 malloc/new。

不要过早为省几 KiB RAM 破坏架构。

ESP32-C3 真实内存余量必须在 Validation profile 中测量后再优化。

---

# 54. Task Stack

初始可给相对保守 stack。

但最终必须提供 runtime instrumentation：

```text
uxTaskGetStackHighWaterMark
free heap
minimum free heap
largest free block
```

基于真实测试调整。

不要声称未经测量的 stack size 是最终最优值。

---

# 55. Diagnostics

实现 Protocol v1 public Counters / Error Ring。

同时允许 internal validation-only metrics，例如：

```text
GNSS fix_queue_drops
Recorder input_sequence_gaps
samples_unrecorded_storage_outage

Storage max_write_us
max_sync_us
max_commit_us

queue high-water
block pool minimum free

heap minimum
stack high-water
```

不要擅自把这些 internal metrics 加入 frozen Protocol key。

---

# 56. Error Ring

v1 record：

```text
0 error_id
1 first_mono_us
2 last_mono_us
3 service_id
4 error_code
5 severity
6 occurrence_count
7 utc_us?
```

v1 不 coalesce：

```text
first_mono_us == last_mono_us
occurrence_count = 1
```

每个 significant error 新 `error_id`。

Ring pagination 按 Frozen Protocol 实现。

CLEAR_ERRORS：

```text
clear Ring
do not clear counters
do not reset next error ID
do not recover subsystem
```

---

# 57. UI

Pages：

```text
Overview
GNSS
Storage
USB
BLE
Wi-Fi
Cellular
```

BOOT short press：

```text
cycle pages
```

long press：

**不要发明行为。**

固定 subsystem identity colors 按 Protocol。

LED brightness/timing：

```text
firmware tuning
```

不是 SP ABI。

UI 只读 snapshots。

不得直接访问 GNSS / SD driver。

---

# 58. File Names

不要依赖 UTC。

Filename 可包含：

```text
boot
recorder session
file sequence
optional UTC if valid at creation
```

Active file 后来获得 UTC：

```text
do not rename
```

Create-new only。

禁止 truncate/overwrite existing recording。

Metadata-only empty recording file：

```text
retain
```

不要自动删除。

---

# 59. Build Profiles / sdkconfig

提供可重复的 profile mechanism，例如：

```text
sdkconfig.defaults
sdkconfig.defaults.dev
sdkconfig.defaults.validation
sdkconfig.defaults.production
```

或者与当前 ESP-IDF 版本更合适的等价方式。

Frozen protocol ID/semantics 不进入 menuconfig。

Kconfig 用于：

```text
timeouts
retry counts
queue depths
block pool capacity/count
LED brightness
Wi-Fi retry
BLE timeout
hardware capability
board mapping
```

---

# 60. Tuning 与 Frozen Architecture 分开

以下可以提供合理初始默认值，但必须集中定义并标记 tuning：

```text
GNSS stall timeout
GNSS retry count
storage retry count
storage recovery interval
WDT timeout
shutdown deadline

BLE advertising interval
BLE assembly timeout

Wi-Fi retry/backoff

SD safety reserve
file rollover target

task stack sizes
minimum heap validation threshold

LED brightness/pattern timing

battery ADC calibration
SD SPI frequency
```

不要把这些默认值写成 Protocol ABI。

---

# 61. Host Tests

`sailball_ldc` 和 SP Core 尽可能支持 host-side test。

至少创建并执行：

## LDC

```text
CRC32C:
empty
123456789

UVAR/SVAR
extrema
overflow
overlong

Delta
negative
circular wrap

Presence bitmap

Metadata COW
Superblock selection

96-byte BlockHeader
16-byte Descriptor
16-byte Footer

golden vectors
```

必须包含规范中的 fully specified block example。

生成 bytes 必须一致。

---

# 62. LDC Crash Tests

自动生成合法 LDC，然后模拟：

```text
truncate at every relevant byte
header
payload
footer
before commit magic
inside commit magic
after committed block
metadata transaction stages
```

必须证明：

```text
only committed prefix accepted
```

不得错误接受 partial tail。

---

# 63. SP Tests

至少：

```text
24-byte header layout
CRC
COBS
BLE fragments

request_id
sequence wrap
sequence gap

HELLO min 256
logical session reset

major mismatch
reserved fields
request_id=0

duplicate pending request

CBOR depth
duplicate key
wrong type
missing required
unknown key

permission matrix

response capacity
```

Permission Matrix 必须 data-driven。

以后权限无意变化时 test 要失败。

---

# 64. Recorder Tests

覆盖：

```text
STOPPED → STARTING → RECORDING
RECORDING → STOPPING → STOPPED

idempotent START
idempotent STOP

STOP during STARTING
START during STOPPING
ERROR START
ERROR STOP

normal rollover
metadata rollover
Storage Epoch Abort
recovery new session
```

验证：

```text
recorder_session_id
file_sequence
LDC file session ID
block_sequence
```

关系正确。

---

# 65. Storage Fault Injection

提供 fake/mock storage backend，以无需真实 SD 测：

```text
write fail once
write fail persistent
flush #1 fail
commit magic write fail
flush #2 fail
mount fail
no space
card removed equivalent
```

验证：

- failed Block 不算 committed；
- uncertain-tail file 不再 append；
- Epoch Abort 释放所有 Buffer；
- loss 有 counter/error；
- recovery 新 session/file。

---

# 66. Network Isolation Test

使用 fake Transport / socket abstraction 尽量自动测试：

```text
TX blocked
live flood
Bulk download
protocol flood
```

同时持续 inject GNSS sample。

验证：

```text
Recorder path仍推进
network congestion不占Critical Buffer
```

---

# 67. Memory / Leak Tests

可自动测试的 lifecycle 至少循环：

```text
Session create/reset
Transfer open/close
BLE assembly reset
Wi-Fi session state creation/destruction
```

如果 host 环境无法模拟 ESP-IDF heap，仍必须在 Validation firmware 中提供 instrumentation。

---

# 68. Static Architecture Checks

创建简单脚本或测试检测 forbidden include/dependency。

至少防止：

```text
Recorder includes Wi-Fi/BLE/SP private APIs
Transfer includes FatFS/SD driver
Control includes GNSS driver private API
UI includes Storage/GNSS hardware driver
```

ESP-IDF Component dependency 不得循环。

---

# 69. Build Gate

实现过程中持续运行。

最终必须：

```text
host tests PASS
static architecture checks PASS
idf.py reconfigure PASS
idf.py build PASS
```

修复 warning 中真正有意义的问题。

不要通过：

```text
disable tests
comment out code
-Wno-everything
remove feature
```

让 build 假绿。

---

# 70. Hardware Tests 诚实标记

没有真实硬件时，不得宣称：

```text
SD removal PASS
GNSS outdoor PASS
BLE phone PASS
Wi-Fi physical PASS
power cut PASS
72h soak PASS
```

输出：

```text
PENDING HARDWARE VALIDATION
```

这是正常状态。

自动/模拟测试通过与实机通过必须分开。

---

# 71. Validation Support

为未来真实板验证提供：

```text
diagnostic counters
stack high-water
heap low-water
storage max commit latency
queue high-water
block pool minimum free
reset reason
```

不要为了测试加入远程 Debug Service。

Protocol v1 明确：

```text
no shell
no task list
no memory read
no arbitrary debug command
```

---

# 72. Power-Loss Validation Support

Firmware 设计必须允许后续真实测试：

```text
power cut while FILLING
while writing prefix
after flush #1
while commit magic
before/after flush #2
metadata transaction
```

Boot 不修复后 append 旧 file。

旧 committed prefix 必须由 parser 正确识别。

---

# 73. Documentation Generated During Implementation

不要重写 Frozen spec。

可以新增：

```text
docs/implementation-status-v1.0.md
docs/hardware-validation-checklist-v1.0.md
docs/build-and-test-v1.0.md
```

`implementation-status` 至少包含：

```text
Implemented
Automatically Tested
Build Verified
Pending Hardware Config
Pending Hardware Validation
Known Limitations
```

---

# 74. Windows Developer Experience

用户开发环境为 Windows。

提供可靠 PowerShell 入口，例如：

```text
scripts/build.ps1
scripts/test.ps1
scripts/validate.ps1
```

如果已有等价脚本，扩展已有脚本。

不要依赖 Bash-only workflow 才能完成核心开发。

同时可以保留 `.sh` 方便 CI/Linux，但 Windows 不应成为二等平台。

---

# 75. Git / Repository Quality

保持 clean architecture。

不要生成并提交：

```text
build/
temporary downloads
IDE cache
logs
binary test garbage
```

按需要更新 `.gitignore`。

不要删除用户已有 Git 历史。

---

# 76. 实施顺序

不要等待我确认每阶段。

依次执行：

```text
A. Repo / environment audit
B. Component skeleton + dependency boundaries
C. common / board / diagnostics foundations
D. LDC pure library + host tests
E. GNSS normalized pipeline
F. Recorder + Block Pool
G. Storage + FatFS abstraction + Epoch Abort
H. Supervisor / recovery / health
I. SP Core / CBOR / COBS
J. Control + permission matrix
K. Transfer
L. USB Transport
M. BLE Transport + GATT
N. Wi-Fi outbound TCP + handover
O. UI / WS2818B / BOOT
P. build profiles / instrumentation
Q. fault injection + integration tests
R. final build / audit / docs
```

如果某个硬件 Adapter 无法完成，不要阻断纯逻辑和 fake backend。

---

# 77. 每个阶段都必须做到“可用”

不要先创建大量空接口，再宣称架构完成。

每阶段尽量：

```text
implementation
+
unit/integration test
+
build
```

一起完成。

禁止大量：

```text
TODO implement later
return ESP_OK;
```

式假实现。

只有真正依赖未知硬件的信息可留 Pending。

---

# 78. 不允许的捷径

禁止为了快速完成：

```text
用一个global mutex包住所有模块
Storage直接调用Recorder内部函数
Transfer直接拿FIL*
Control直接操作UART
network callback直接做业务
每个Service建一个Task
每个错误ESP_ERROR_CHECK panic
critical queue runtime malloc
用packed C struct当wire ABI
把所有日志塞USB Protocol stream
下载时暂停Recorder
SD错误自动format
空间不足自动删旧文件
Reset后append旧LDC
```

---

# 79. Completion Audit

在认为任务完成前逐条检查：

## Critical

```text
GNSS → Recorder → Storage independent of Network
static Critical buffers
no silent sample loss
Storage Epoch Abort works
intent-aware health
```

## LDC

```text
96B Header
metadata COW
definition durability
two-stage block commit
new file after uncertain tail
active transfer metadata snapshot
```

## Protocol

```text
all Service IDs exact
all permission rules exact
HELLO 256 minimum
8B device_id
logical Session reset
BLE fixed UUID
bounded CBOR
bounded RX/TX
```

## Recovery

```text
NO_FIX not failure
GNSS recovery local
Storage failure local
network fault noncritical
MCU reset only fatal/deadlock
```

## Tests

```text
host tests
fault injection
permission matrix
LDC vectors
truncation tests
ESP32-C3 build
```

---

# 80. Final Response Required

完成后，不要只回复“implemented”。

给我一个结构化最终报告，至少包括：

```text
1. Repository / environment summary

2. Implemented components

3. Critical Path status

4. LDC implementation status
   - metadata COW
   - block encoding
   - durability
   - recovery
   - tests

5. Sailball Protocol status
   - SP Core
   - CBOR
   - USB
   - BLE
   - Wi-Fi
   - permissions
   - Transfer

6. Recovery / watchdog status

7. Automated test results
   - exact commands
   - passed / failed counts

8. ESP-IDF build result

9. Memory / stack observations available so far

10. PENDING HARDWARE CONFIG
    - exact missing information

11. PENDING HARDWARE VALIDATION
    - exact physical tests still required

12. Changed / added files

13. Known limitations

14. Whether Firmware v1.0 is:
    BUILD READY
    LAB READY
    FIELD READY
    RELEASE READY
```

不得把：

```text
BUILD READY
```

描述成：

```text
FIELD READY
```

除非真实硬件测试确实已经执行。

---

# 81. Completion Definition

这项任务只有在以下条件满足后才可停止：

```text
所有无需真实硬件即可实现的 v1.0 功能已经实现；
所有无需真实硬件即可执行的测试已经运行；
ESP32-C3 project build 成功；
不存在已知的 silent-data-loss 路径；
不存在 Protocol/LDC spec 被代码擅自改变；
所有真正依赖未知硬件的信息已明确隔离到 board/hardware adapter；
所有未执行的实机验证均明确标记 PENDING HARDWARE VALIDATION。
```

不要为了“看起来100%完成”而伪造硬件验证结果。

可靠、可解释、符合 Frozen v1.0，比表面上的完成度更重要。

现在开始执行。
