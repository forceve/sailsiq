# Sailball Protocol v1 — 协议规范

> **HISTORICAL SNAPSHOT — NOT CURRENT ACCEPTANCE STATE.** This earlier unversioned consolidation predates the final v1.0 baseline. Use [Sailball Protocol v1.0 Frozen](sailball-protocol-v1.0.md) and the current [documentation index](README.md).

**Sailball Protocol v1 Frozen Baseline**

整理日期：2026-09-26 · 协议版本：1.0 · 适用项目：Sailball

本文是当前冻结基线的权威整理。最新总表审查及其获准修订优先于更早的草案；未确认或相互冲突的细节保留于文末 **Open Issues**，不通过本文擅自补齐。配套文档：[客户端接口指南](sailball-client-interface-v1.md)、[项目文档索引](README.md)、[LDC v1](../output/LDC_v1_Format_Specification.md)。

## 1. 目标、边界与规范用语

Sailball Protocol（SP）用于设备控制、状态查询、GNSS 实时数据和 LDC 文件传输。它不承担 OTA、远程调试、Shell、日志读取、堆栈、内存读取、Task List 或任务调试功能。

最高优先级 Critical Data Path 为：

```text
GNSS → Recorder → Storage critical write / commit → SD
```

网络、协议处理、文件列表和下载均不得向该链路传播反压或成为其同步依赖。资源不足时，Transfer 让路、返回 `BUSY` 或降低吞吐；live stream 和普通 Event 可以丢弃。不得为提高下载速度自动停止或暂停 Recorder。

“必须 / 不得”表示冻结要求；“建议”表示已有推荐或客户端实现建议；“未决”不是可自由分配的协议扩展空间。文中 `{0: value, 1: optional?}` 为 CBOR 逻辑表示，不是 JSON，也不是完整编码后的字节流；`?` 表示可省略。无参数 REQUEST 仍发送 CBOR 空 Map `{}`。

### 1.1 Session 与身份

每条 Transport connection 是独立 SP Session。BLE connection、TCP connection 和 USB protocol session 各自维护握手、订阅、request 关联、sequence、live stream 和 Transfer。Transport handover 建立新 Session，不迁移旧 Session。

`device_id` 是设备身份 Byte String；`boot_id` 为 uint32 启动标识；它们与 SP `request_id`、BLE `frame_id`、Transfer `transfer_id`、Recorder `session_id` 不是同一概念。`handover_id` 只用于匹配连接尝试，不是认证凭证。

v1 不提供应用层认证，不强制 BLE pairing/bonding；TCP 不使用 TLS、HTTP 或 WebSocket。权限依据实际接收请求的 Transport source，不能由 Payload 自报。

## 2. SP Frame v1

### 2.1 固定布局

```text
Header (24 B) | Payload (N B) | CRC32C (4 B)
decoded_frame_length = 24 + payload_length + 4
```

所有多字节 Header 字段和末尾 CRC32C 均为 Little Endian。CBOR 内部编码遵循 CBOR 本身的整数编码，不能因 SP Header 为 LE 而改变 CBOR 字节顺序。

| Offset | Size | 字段 | v1 定义 |
| --- | --- | --- | --- |
| 0x00 | 2 | magic | ASCII `SP`，字节 `53 50` |
| 0x02 | 1 | major | `1` |
| 0x03 | 1 | minor | `0` |
| 0x04 | 1 | message_type | 见下表 |
| 0x05 | 1 | flags | `0` |
| 0x06 | 1 | channel | `0` |
| 0x07 | 1 | reserved | `0` |
| 0x08 | 2 | service_id | uint16 |
| 0x0A | 2 | message_id | uint16；含义由 Type + Service 确定 |
| 0x0C | 4 | request_id | uint32 |
| 0x10 | 4 | sequence | uint32 |
| 0x14 | 4 | payload_length | uint32，仅 Payload 字节数 |

| Type | 值 | Payload | request_id |
| --- | --- | --- | --- |
| REQUEST | 0x01 | 一个 CBOR Map | 非零 |
| RESPONSE | 0x02 | 统一 CBOR Response Map | 复制对应 REQUEST |
| EVENT | 0x03 | 一个服务专属 CBOR Map | 0 |
| STREAM | 0x04 | 一个流专属 CBOR Map | 0 |
| BULK | 0x05 | 固定 metadata + raw bytes | 复制对应 READ |

`0x00` 和 `0x06…0xFF` Type 保留。Command、Event、Stream、Bulk ID 可以相同，因为它们由 Type 区分。RESPONSE 复用原 REQUEST 的 `service_id`、`message_id`、`request_id`，不分配单独的 response command ID。

### 2.2 Request ID 与 Sequence

`request_id=0` 保留给非请求关联消息。客户端可从 1 递增至 `0xFFFFFFFF`，回卷时跳过 0。客户端应避免同一 Session 内未完成请求的 ID 冲突。普通并发 RPC 不代表允许并发 Transfer READ；后者另有限制。

Sequence 在每个 Transport Session、每个发送方向独立维护，从 0 开始，按 uint32 自然回卷。所有 SP Frame 共用该方向的序列，不按 Service 或 Type 另起序列。新 Session 重置为 0。检查须理解回卷；sequence gap **只计数，不拒绝 Frame**，不触发协议级重传或 ACK。

缺 RESPONSE 由客户端超时处理；文件块通过新的 READ 重取；live sample 丢失可接受；Event 丢失后通过状态或错误历史查询恢复观察。

### 2.3 CRC32C

| 参数 | 值 |
| --- | --- |
| 算法 | CRC-32C / Castagnoli |
| Polynomial | 0x1EDC6F41 |
| Reflected polynomial | 0x82F63B78 |
| Init / XorOut | 0xFFFFFFFF / 0xFFFFFFFF |
| RefIn / RefOut | true / true |
| 覆盖范围 | 完整 24 B Header + 完整 Payload |
| 存放方式 | 尾部 uint32 LE；CRC 不覆盖自己 |

用半开区间表示，CRC 输入是 `frame[0 : 24 + payload_length]`。先构造并校验完整 SP Frame，再做 COBS 或 BLE 分片。`payload_length` 不含 Header、CRC、COBS 开销或 BLE fragment header。

### 2.4 校验与错误处理

接收端必须先执行当前 Transport 的长度限制，不能因对端声明巨大长度直接分配内存。解码后的 Frame 必须恰好为 `28 + payload_length` 字节。

| 情况 | 处理 |
| --- | --- |
| COBS 解码失败 | 丢弃、计 transport decode error，不回应 |
| Magic 错误 | 丢弃、计 magic error |
| Frame 长度不匹配 | 丢弃、计 length error |
| CRC 错误 | 丢弃、计 CRC error |
| Sequence gap | 计数，继续接受其他方面合法的 Frame |
| 未知 Type | 丢弃 |
| 合法 REQUEST 的 Service / Command 未知 | RESPONSE `UNSUPPORTED` |
| 合法 REQUEST 内 CBOR / 参数非法 | RESPONSE `INVALID_REQUEST` |
| RESPONSE / EVENT / STREAM 内 CBOR 非法 | 丢弃 |

v1 发送端必须将 Flags、Channel、Reserved 写零。原基线对非零 Reserved REQUEST 允许返回 `UNSUPPORTED`，对非请求消息直接丢弃；Flags/Channel 的完整接收策略见 OI-12。不得把保留位解释为 ACK、压缩、加密或多通道。

### 2.5 版本兼容

Major 变更允许不兼容的 Frame 语义、编码或 ID 重组。Minor 只允许增加 Service、Command、Event、可选 CBOR key 或状态码，不能改写旧定义。未来使用保留能力需要明确的双方能力确认；v1.0 不定义这类扩展操作。具体不兼容 Major 的响应行为见 OI-12。

## 3. CBOR Payload v1

允许 Unsigned/Signed Integer、Boolean、Byte String、合法 UTF-8 Text String、Array、Map；Null 仅在具体字段明确允许时可用。不得使用 float、tag、undefined、indefinite-length Array/Map/String。

所有 Map key 使用整数；v1 定义的 key 范围为 unsigned 0…255。发送端建议按 key 升序编码；接收端不能依赖 Map 顺序。测量值使用 scaled integer；枚举使用整数；Boolean 使用 CBOR true/false，不用 0/1 代替。SSID、password、IP、device ID 等二进制数据使用 Byte String。

REQUEST / RESPONSE / EVENT / STREAM Payload 必须恰好包含一个 Map。BULK 不再套 CBOR Byte String。Response 外壳固定为：

```text
{0: status, 1: data?}
```

v1 不增加文本错误消息。未知可选 key 忽略；必填 key 缺失、已知字段类型错误或重复 key 的 REQUEST 返回 `INVALID_REQUEST`。不得把字符串端口转换成整数，也不得选择“重复 key 第一个/最后一个胜出”。省略字段与 Null 不同，未知 UTC 等情况用省略表达。

最大 nesting depth 为 **6**。解码器同时受 SP `payload_length`、本地 Transport 接收上限、命令专属数量/长度限制约束；跳过未知 key 时也不能绕过长度或深度限制。深度计数起点尚未明确，见 OI-07。

### 3.1 通用状态码与异步语义

| 值 | 名称 | 含义 |
| --- | --- | --- |
| 0x00 | OK | 操作已完成 |
| 0x01 | ACCEPTED | 校验通过并已提交异步操作，不代表最终成功 |
| 0x02 | INVALID_REQUEST | 请求结构或参数非法 |
| 0x03 | UNSUPPORTED | 不支持的请求/能力 |
| 0x04 | PERMISSION_DENIED | Transport 无权限 |
| 0x05 | BUSY | 暂时无法处理，可稍后重试 |
| 0x06 | NOT_FOUND | 对象不存在 |
| 0x07 | INVALID_STATE | 当前状态不允许操作 |
| 0x08 | IO_ERROR | I/O 失败 |
| 0x09 | TIMEOUT | 操作超时 |
| 0x0A | OUT_OF_RANGE | 超出允许范围 |
| 0x0B | INTERNAL_ERROR | 内部错误 |

`ACCEPTED` 表示权限和参数校验通过，且已成功提交给对应 subsystem。客户端通过普通 Event 提醒后查询状态，或直接 `CORE.GET_STATUS` 观察最终结果。不得把 `ACCEPTED` 展示为“已经连接/已经停止/已经格式化”。重启不要求“重启完成”Event。

## 4. Service 与消息总表

| Service ID | Service | Command IDs |
| --- | --- | --- |
| 0x0001 | CORE | 0001 HELLO；0002 GET_INFO；0003 GET_STATUS；0004 SUBSCRIBE_EVENTS；0005 REBOOT |
| 0x0002 | GNSS | 0001 START_STREAM；0002 STOP_STREAM；0003 RESTART |
| 0x0003 | RECORDER | 0001 START；0002 STOP |
| 0x0004 | STORAGE | 0001 LIST_FILES；0002 GET_FILE_INFO；0003 DELETE_FILE；0004 FORMAT |
| 0x0005 | TRANSFER | 0001 OPEN_READ；0002 READ；0003 CLOSE |
| 0x0006 | WIFI | 0001 SCAN；0002 GET_SCAN_RESULTS；0003 SET_CONFIG；0004 CONNECT；0005 DISCONNECT；0006 FORGET |
| 0x0007 | BLE | 0001 SET_ADVERTISING；0002 DISCONNECT |
| 0x0008 | DIAGNOSTICS | 0001 GET_COUNTERS；0002 GET_ERRORS；0003 CLEAR_ERRORS |
| 0x0009 | UI | 0001 SET_PAGE |
| 0x000A | CELLULAR | Reserved；无 Command |

本表 Command IDs 均为十六进制。USB 和 SYSTEM 不是 Service；USB 是 Transport 与 Status 类别。

| Type | Service | Message ID | 名称 |
| --- | --- | --- | --- |
| EVENT | CORE | 0x0001 | TRANSPORT_READY |
| EVENT | RECORDER | 0x0001 | STATE_CHANGED |
| EVENT | STORAGE | 0x0001 | STATE_CHANGED |
| EVENT | WIFI | 0x0001 | STATE_CHANGED |
| EVENT | WIFI | 0x0002 | SCAN_COMPLETE |
| EVENT | BLE | 0x0001 | STATE_CHANGED |
| EVENT | DIAGNOSTICS | 0x0001 | ERROR_RAISED |
| EVENT | UI | 0x0001 | PAGE_CHANGED |
| STREAM | GNSS | 0x0001 | SAMPLE |
| BULK | TRANSFER | 0x0001 | DATA |

未提供的接口保持不存在：`CORE.GET_CAPABILITIES`，GNSS/RECORDER 的 GET_CONFIG/SET_CONFIG，各 Service 的 GET_STATUS，RECORDER.PAUSE/RESUME，TRANSFER.CANCEL，WIFI.GET_CONFIG，USB Service，UI.SET_COLOR/SET_PATTERN/SET_BRIGHTNESS。

## 5. CORE — 0x0001

### 5.1 HELLO — Command 0x0001

REQUEST：`{0: max_rx_payload, 1: client_name?}`。

| Key | 类型 | 含义 |
| --- | --- | --- |
| 0 | uint32 | Controller 能接收的最大 SP Payload 字节数 |
| 1 | Text String，可选 | 客户端名称，不承担认证 |

成功 RESPONSE 为 `{0: OK, 1: data}`，data：

| Key | 类型 | 字段 |
| --- | --- | --- |
| 0 | Byte String | device_id |
| 1 | uint32 | boot_id |
| 2 | uint | protocol_major |
| 3 | uint | protocol_minor |
| 4 | uint enum | transport：0 USB、1 BLE、2 WIFI、3 CELLULAR |
| 5 | uint32 | max_rx_payload：Sailball 的接收上限 |
| 6 | uint32 | recommended_bulk_chunk：建议的 raw 文件数据块字节数 |
| 7 | Array<uint16> | services：当前固件支持的 Service IDs |

双方分别声明自己的接收能力，**发送者必须遵守接收者公布的 `max_rx_payload`**。不合并成一个统一 negotiated max。文件 BULK 的 16 B metadata 也计入 SP Payload 上限，raw chunk 不包含这 16 B。

HELLO 成功前不执行普通业务 Command。BLE/USB 由 Controller 先 HELLO；Outbound TCP 先由 Sailball 发 TRANSPORT_READY，再由 Controller HELLO。断线后须重新握手。重复 HELLO、bootstrap 最小接收能力等未决项见 OI-06。

### 5.2 TRANSPORT_READY — Event 0x0001

Outbound TCP 建立后的第一条 SP 消息；`request_id=0`，不受订阅控制。Payload：

```text
{0: device_id, 1: boot_id, 2: transport,
 3: protocol_major, 4: protocol_minor, 5: handover_id?}
```

device_id 为 Byte String，boot_id/handover_id 为 uint32，其余为整数。由 WIFI.CONNECT 发起的 handover 必须携带原 handover_id。客户端核对身份与尝试关联后再 HELLO。BLE 不使用该 bootstrap Event。

### 5.3 GET_INFO — Command 0x0002

REQUEST `{}`；成功 data：`{0: device_name, 1: hardware_model, 2: hardware_revision, 3: firmware_version, 4: firmware_build?}`，均为 Text String。这里只返回静态信息。

### 5.4 GET_STATUS — Command 0x0003

REQUEST 必须为 `{0: mask}`，mask 为非零 unsigned integer。缺 mask、错误类型或 mask=0 返回 `INVALID_REQUEST`。未知 mask bit 忽略，通过 `returned_mask` 告知实际返回范围。

| Mask bit | 类别 | 成功 data key |
| --- | --- | --- |
| 0 | SYSTEM | 1 |
| 1 | GNSS | 2 |
| 2 | RECORDER | 3 |
| 3 | STORAGE | 4 |
| 4 | USB | 5 |
| 5 | BLE | 6 |
| 6 | WIFI | 7 |
| 7 | CELLULAR | 8 |
| 8 | UI | 9 |

成功 data：`{0: returned_mask, 1: system?, 2: gnss?, 3: recorder?, 4: storage?, 5: usb?, 6: ble?, 7: wifi?, 8: cellular?, 9: ui?}`。只返回请求且支持的组。

**所有 Status provider 必须只读取 RAM snapshot**。不得为响应状态主动访问 GNSS UART、扫描 SD/查询 FatFS 空间、启动 Wi-Fi RF 扫描或查询 RF、访问 4G modem/发送 AT 命令。时间 age 可由已缓存单调时刻计算；状态查询不触发外设刷新。

### 5.5 SUBSCRIBE_EVENTS — Command 0x0004

REQUEST `{0: [service_id, ...]}`；RESPONSE `{0: OK}`。指定本 Session 接收普通 Event 的 Service 集合；空数组取消全部订阅。订阅不保存 NVS，断开时清除。数组重复项及未支持 Service 的细化处理见 OI-12。

### 5.6 REBOOT — Command 0x0005

USB only；REQUEST `{}`。校验通过返回 `{0: ACCEPTED}`，响应进入 TX 后安排重启。其他 Transport 返回 `PERMISSION_DENIED`。Recorder 活跃期间是否先完成安全收尾，原基线未确定，见 OI-11。

## 6. 当前状态结构

以下 Map 均位于 GET_STATUS 的相应 data key 内。除 `?` 字段外按原定义提供；unknown/不可用值不以虚构的零值代替。

| 类别 | RAM snapshot Map |
| --- | --- |
| SYSTEM | `{0: uptime_ms, 1: critical_path_healthy, 2: reset_reason}` |
| GNSS | `{0: state, 1: fix_type, 2: satellites_used, 3: position_valid, 4: utc_valid, 5: last_rx_age_ms, 6: last_fix_age_ms?, 7: source_rate_num, 8: source_rate_den}` |
| RECORDER | `{0: state, 1: session_id?, 2: start_mono_us?, 3: start_utc_us?, 4: current_block_sequence?, 5: last_commit_age_ms?, 6: current_file_name?}` |
| STORAGE | `{0: state, 1: total_bytes?, 2: free_bytes?}` |
| USB | `{0: state}` |
| BLE | `state` 的 key 0 已确定；其余字段存在两个未统一版本，见 OI-05 |
| WIFI | `{0: state, 1: configured, 2: ssid?, 3: rssi?, 4: ipv4?, 5: scan_generation, 6: last_error?}` |
| CELLULAR | 当前不支持时省略，returned_mask 不设置对应 bit |
| UI | `{0: current_page}` |

类型：uptime_ms / monotonic time / 文件尺寸为 uint64；UTC 为 int64；布尔字段为 Boolean；RSSI 为 signed integer；SSID 为 Byte String；IPv4 为 4 B Byte String；文件名为 Text String。Recorder session_id、block_sequence、last_commit_age_ms、scan_generation 为 uint32。其余未明确数值位宽的字段不在本文擅自收窄，见 OI-07。

`critical_path_healthy` 只反映 GNSS→Recorder→SD，不由 Wi-Fi/BLE/USB/4G 连接状态决定。reset_reason：0 UNKNOWN、1 POWER_ON、2 SOFTWARE、3 WATCHDOG、4 BROWNOUT、5 DEEP_SLEEP、6 EXTERNAL。

GNSS `last_rx_age_ms` 为距最近合法 GNSS 数据的时间；`last_fix_age_ms` 仅在本次启动曾有有效 fix 时提供。source_rate_num/den 是缓存的当前预期输出节奏，不通过 UART 现场查询。

Recorder `session_id` 在本 boot 内唯一，与 boot_id 联合识别一次记录；STOPPED 通常仅返回 state。`last_commit_age_ms` 从最近成功 commit 计算，不访问 SD。

| 类别 | state 枚举 |
| --- | --- |
| GNSS | 0 OFF；1 STARTING；2 RUNNING；3 RESTARTING；4 ERROR |
| RECORDER | 0 STOPPED；1 STARTING；2 RECORDING；3 STOPPING；4 ERROR |
| STORAGE | 0 UNAVAILABLE；1 MOUNTING；2 READY；3 ERROR；4 FORMATTING |
| USB | 0 DISCONNECTED；1 CONNECTED；2 ONLINE |
| BLE | 0 OFF；1 IDLE；2 ADVERTISING；3 CONNECTED；4 DISCONNECTING；5 ERROR |
| WIFI | 0 OFF；1 SCANNING；2 AP_CONNECTING；3 IP_READY；4 TCP_CONNECTING；5 SP_HANDSHAKE；6 ONLINE；7 RECOVERING；8 ERROR |

USB ONLINE 表示 HELLO 完成，CONNECTED 表示可用链路存在但尚未 HELLO。BLE CONNECTED 不能单独证明 SP HELLO 已完成。GNSS RUNNING 不等于已定位；position_valid、utc_valid 相互独立。

## 7. GNSS — 0x0002

仅提供 START_STREAM、STOP_STREAM、RESTART；不提供 GET_CONFIG / SET_CONFIG / GET_STATUS。GNSS UART 仅由 GNSS subsystem 访问，命令 handler 不绕过该所有权。

### 7.1 START_STREAM — Command 0x0001

REQUEST `{0: field_mask, 1: min_interval_ms?}`。field_mask 必填且非零；min_interval_ms 默认 0，表示有新 sample 时尽可能发送。它只限制 live 发送频率，不修改 GNSS 模块输出频率，也不承诺精确流采样频率。

| bit | 字段 |
| --- | --- |
| 0 | UTC_TIME |
| 1 | POSITION：latitude 与 longitude 一组 |
| 2 | ALTITUDE_MSL |
| 3 | GROUND_SPEED |
| 4 | COURSE_OVER_GROUND |
| 5 | SATELLITES_USED |
| 6 | FIX_TYPE |

mono_us 永远发送，不需要 mask。成功 data 为 `{0: effective_field_mask, 1: min_interval_ms}`；不支持的字段不进入 effective mask，若结果为 0 则 `UNSUPPORTED`。

每 SP Session 最多一个 live stream，不设 stream_id；再次 START_STREAM 原子替换当前配置。BLE 和 TCP 两个 Session 的流彼此独立。

### 7.2 SAMPLE — Stream 0x0001

`Type=STREAM, Service=GNSS, Message=0x0001, request_id=0`。

| Key | 字段 | 编码 |
| --- | --- | --- |
| 0 | mono_us | uint64；必有 |
| 1 | utc_us | int64 Unix epoch microseconds；可选 |
| 2 | latitude_e7 | signed integer，degree × 10^-7；可选 |
| 3 | longitude_e7 | signed integer，degree × 10^-7；可选 |
| 4 | altitude_cm | signed integer，MSL metre × 0.01；可选 |
| 5 | ground_speed_centi_kn | unsigned integer，knot × 0.01；可选 |
| 6 | course_centi_deg | unsigned integer，COG degree × 0.01；可选 |
| 7 | satellites_used | unsigned integer；可选 |
| 8 | fix_type | integer enum；可选 |

只发送已选择且当前有效的可选数据。position 无效时同时省略经纬度；UTC 无效时省略 key 1。零坐标、零速度不是“未知”。这里 `fix_type` 冻结为 **0 NO_FIX、1 FIX_2D、2 FIX_3D、255 UNKNOWN**；与现有 LDC 表不一致，见 OI-01，不得直接复制数字。

Live stream 允许丢帧。建议保留 latest snapshot，新值覆盖未发送旧值并增加 live_stream_dropped；不得积压全部 sample。Recorder 使用独立数据路径，不受订阅、断线或网络拥塞影响。

### 7.3 STOP_STREAM / RESTART

STOP_STREAM（0x0002）：REQUEST `{}`；返回 OK；本来无流也 OK，只停止本 Session 的 live stream。

RESTART（0x0003）：USB only；REQUEST `{}`；返回 ACCEPTED。由 GNSS subsystem 异步重新初始化，状态经 RESTARTING/STARTING 返回 RUNNING，失败可为 ERROR。不会强制 STOP Recorder；其间无 live sample，时间跳变交给既有记录时间逻辑处理。

## 8. RECORDER — 0x0003

START（0x0001）和 STOP（0x0002）均 USB only，REQUEST 均为 `{}`。不接受外部 filename、sample_rate、字段集合、LDC options 或 GNSS config；不提供 PAUSE / RESUME / GET_CONFIG / SET_CONFIG。

```text
STOPPED --START--> STARTING --> RECORDING --STOP--> STOPPING --> STOPPED
                       \           |                 /
                        +----------+----------------+--> ERROR
```

### 8.1 START

STOPPED 下接受请求，返回 ACCEPTED，检查存储/缓冲条件并创建新的 LDC recording session/file；写好 metadata、准备记录后进入 RECORDING。不得覆盖、恢复或继续 append 上次旧文件。开机自动记录策略不由本协议规定。

| 当前状态 / 请求 | 已确定行为 |
| --- | --- |
| RECORDING + START | OK，不新建第二个文件 |
| STARTING + START | ACCEPTED，沿用正在执行的启动 |
| STOPPED + STOP | OK |
| STOPPING + STOP | ACCEPTED，不重复 close |
| STARTING + STOP | 接受停止；取消或完成必要初始化，已创建文件则安全关闭 |

STOPPING 下 START、ERROR 状态恢复等未决转移见 OI-11。

### 8.2 STOP

正常返回 ACCEPTED。提前结束当前未满 15 s 的 block，编码、写 CRC32C 和 Commit Footer，经 Storage 确认安全 commit/close 后才进入 STOPPED。无需等待 block 自然满 15 s。把 block 放进队列不等于停止完成。

STATE_CHANGED（Event 0x0001）Payload：`{0: state, 1: session_id?, 2: reason?}`。reason：0 UNKNOWN、1 STORAGE_UNAVAILABLE、2 STORAGE_WRITE_ERROR、3 BUFFER_EXHAUSTED、4 INTERNAL_ERROR。普通 Event best effort，状态以 CORE.GET_STATUS 为准。

Recording 永远优先于 Transfer，不存在“下载时自动暂停”。协议 Recorder 的 boot-local uint32 session_id 与现有 LDC 16 B session_id 的关联未冻结，见 OI-02。

## 9. STORAGE — 0x0004

### 9.1 文件命名空间与 readable_size

仅暴露 LDC recording namespace。参数是 `file_name`，不是任意 path。文件名 UTF-8 长度最多 63 B，禁止 `/`、`\` 和 `..`。不提供目录漫游、任意 SD 文件访问或无线写文件。

`readable_size` 为安全可读大小，文件尺寸/偏移使用 uint64。Active 文件只暴露 metadata 加已完整 commit 的 blocks，不暴露正在写的尾部。正常关闭且完整的 LDC，readable_size 为完整文件大小；异常关闭带未提交尾部的文件如何裁定，见 OI-03。

LIST_FILES / GET_FILE_INFO 是显式后台存储操作，可以访问 SD；它们不同于 RAM-only GET_STATUS。调度上必须低于记录写入/commit。

### 9.2 Command schemas

| ID / Command | REQUEST | 成功 RESPONSE data / 行为 |
| --- | --- | --- |
| 0x0001 LIST_FILES | `{0: offset, 1: limit}` | `{0: entries, 1: next_offset, 2: complete}` |
| 0x0002 GET_FILE_INFO | `{0: file_name}` | `{0: file_name, 1: readable_size, 2: active}` |
| 0x0003 DELETE_FILE | `{0: file_name}` | USB only；OK，无 data |
| 0x0004 FORMAT | `{0: true}` | USB only；ACCEPTED，无 data |

LIST offset 为 uint32，limit 范围 1…32；entry 为 `{0: file_name, 1: readable_size, 2: active}`，active/complete 为 Boolean。列表变化时 offset 分页不保证强一致；客户端可从 offset=0 重新枚举。没有服务器目录快照 cursor。

GET_FILE_INFO 不返回整文件 CRC、FAT 创建/修改时间；需要 LDC 信息时读取文件 metadata。

DELETE_FILE：active 文件返回 INVALID_STATE；文件被打开的 Transfer 占用时返回 BUSY。不得暗中 STOP Recorder 或 CLOSE Transfer。

FORMAT：确认 key 0 必须为 Boolean true；必须 Recorder=STOPPED 且无 active Transfer，否则 INVALID_STATE。不得自动停止记录或关闭 Transfer。异步状态为 FORMATTING，完成 READY，失败 ERROR。

STATE_CHANGED（Event 0x0001）：`{0: state}`；详细离散错误由 DIAGNOSTICS 提供。

## 10. TRANSFER — 0x0005

Pull 模型，仅 OPEN_READ / READ / CLOSE。每 Session 最多一个 Transfer，每 Transfer 最多一个 outstanding READ。不提供 CANCEL、Push、上传或跨 Session handle 迁移。

### 10.1 OPEN_READ — Command 0x0001

REQUEST `{0: file_name}`；成功 data `{0: transfer_id, 1: readable_size, 2: active}`。transfer_id 为当前 Session 内的 uint32，readable_size 为 uint64。已有 Transfer 时返回 BUSY。

OPEN_READ 冻结本 Transfer 的 readable_size=N，只能读取 `[0,N)`；即使记录继续增长，本次结束边界不变。获取新增数据须 CLOSE 后重新 OPEN_READ。**冻结长度不自动等于冻结可改写的 LDC metadata 内容**；一致性冲突见 OI-03。

### 10.2 READ — Command 0x0002

REQUEST `{0: transfer_id, 1: offset, 2: length}`；类型分别为 uint32 / uint64 / uint32。

在 Session 保持可用并处理该请求的情况下，每个 READ **恰好一个终结消息**：

- 成功：一个 `BULK DATA`，request_id 为原 READ ID。
- 失败：一个普通 RESPONSE，Service/Message/request_id 复制 READ。
- 不得先发送 OK RESPONSE 再发送 BULK，也不以 ACCEPTED 后续追加 BULK。

连接断开或传输失败仍可能令客户端收不到终结消息；这不改变正常处理的二选一规则。上一 READ 未完成时，新 READ 返回 BUSY，不排无限请求队列。

### 10.3 DATA — Bulk 0x0001

`Type=BULK, Service=TRANSFER, Message=0x0001`。Payload 固定布局：

| Payload offset | Size | 字段 |
| --- | --- | --- |
| 0x00 | 4 | transfer_id，uint32 LE |
| 0x04 | 8 | offset，uint64 LE |
| 0x0C | 4 | data_length，uint32 LE |
| 0x10 | data_length | raw LDC file bytes |

SP `payload_length = 16 + data_length`。不再包 CBOR，不另设 EOF/LAST/MORE flag；完整 SP CRC32C 覆盖 metadata 和 raw bytes。

客户端按 HELLO.recommended_bulk_chunk 选择 raw chunk，必须满足接收者 Controller 的 `max_rx_payload`：`16 + data_length <= controller_max_rx_payload`，并遵守当前 Transport 实现的发送能力。最后剩余数据不足 length 时返回剩余字节，`data_length <= requested_length`。请求超出可支持 Payload 大小返回 OUT_OF_RANGE。

| 失败情况 | RESPONSE status |
| --- | --- |
| transfer_id 不存在 | NOT_FOUND |
| offset 超界 / 长度超上限 | OUT_OF_RANGE |
| Critical storage write 忙 / 上一 READ 未完成 | BUSY |
| SD 读取失败 | IO_ERROR |

客户端 `offset += data_length`，达到 frozen readable_size 即完成。length=0、offset 恰等于 EOF、非 EOF 短读及 CLOSE/READ 竞态见 OI-10。

### 10.4 CLOSE — Command 0x0003

REQUEST `{0: transfer_id}`；成功 OK；当前没有 Transfer 也 OK。仍有另一 ID 的 Transfer 时如何处理错误 ID 见 OI-10。Session 断开自动关闭 Transfer；长时间空闲可自动关闭，具体超时为 firmware tuning。超时后 READ 得到 NOT_FOUND 时客户端重新 OPEN_READ。

### 10.5 调度与反压

冻结优先级顺序：LDC critical write/commit/close → Recorder metadata 操作 → Transfer READ → LIST_FILES / GET_FILE_INFO。后台操作须分步让出；不得一次大量预读并挤占记录内存。网络 TX 使用有界队列，拥塞只影响网络/Transfer/live 输出。下载中的文件和记录中的文件按已确定占用限制处理。

## 11. WIFI — 0x0006

STA only；Sailball 是 Outbound TCP Client，Controller App 是 TCP Server。Sailball 不提供 TCP Server、mDNS、UDP discovery 或监听端口。启动默认 BLE advertising ON、Wi-Fi OFF；即使 NVS 有 profile，也不自动连接旧 endpoint。

### 11.1 SCAN — Command 0x0001

REQUEST `{}`；正常从 OFF 接受，返回 ACCEPTED，状态 OFF→SCANNING→OFF，结果缓存于 RAM。暂时处理其他 Wi-Fi 操作可 BUSY，已 ONLINE 等不允许状态可 INVALID_STATE。Wi-Fi source 不允许发起 SCAN。

当前建议最多缓存 16 个 AP，按 RSSI 从强到弱。SCAN_COMPLETE（Event 0x0002）：`{0: generation, 1: result_count}`；generation 为 uint32，每次完成扫描递增。普通 Event 可丢，客户端通过 WIFI status 的 scan_generation 与结果查询确认。

### 11.2 GET_SCAN_RESULTS — Command 0x0002

REQUEST `{}`；成功 data `{0: generation, 1: results}`。从未成功扫描时 results 为空数组。仅读取 RAM cache，不触发扫描，因此 **Wi-Fi source 也允许**。

每个 result：`{0: ssid, 1: rssi, 2: security, 3: channel, 4: bssid}`。SSID 为 Byte String；RSSI 为 signed integer；security/channel 为整数；BSSID 为 6 B Byte String。

security：0 OPEN、1 WPA、2 WPA2、3 WPA3、4 WPA_WPA2、5 WPA2_WPA3、255 UNKNOWN；不直接暴露驱动枚举。

### 11.3 SET_CONFIG — Command 0x0003

REQUEST `{0: ssid, 1: password}`，两者均 Byte String，SSID 最多 32 B；password 按实际安全模式校验，开放网络用空 Byte String。只允许 Wi-Fi OFF；其他状态 INVALID_STATE。成功 OK 表示唯一 profile 已保存 NVS，不隐式断开或重连。

password write-only；不存在 GET_CONFIG / GET_PASSWORD。SSID/password 是唯一持久 Wi-Fi profile；Controller IP/port/handover_id 不存 NVS。

### 11.4 CONNECT — Command 0x0004

REQUEST `{0: address_type, 1: address, 2: port, 3: handover_id}`。

| 字段 | 类型 / 语义 |
| --- | --- |
| address_type | 0 IPv4；1 IPv6、2 HOSTNAME 为未来项 |
| address | v1 IPv4 为 4 B Byte String，按地址字节顺序 |
| port | uint16 |
| handover_id | 非零 uint32，由 Controller 生成 |

CONNECT 使用已保存 profile，不再携带 SSID/password。返回 ACCEPTED，异步经历 AP_CONNECTING→IP_READY→TCP_CONNECTING→SP_HANDSHAKE→ONLINE。endpoint 与 handover_id 仅保留于当前网络连接尝试/恢复生命周期，不持久化。

失败原因 reason：0 UNKNOWN、1 AP_NOT_FOUND、2 AUTH_FAILED、3 DHCP_FAILED、4 TCP_CONNECT_FAILED、5 SP_HANDSHAKE_FAILED、6 CONNECTION_LOST。

STATE_CHANGED（Event 0x0001）：`{0: state, 1: reason?}`。GET_STATUS 中 `last_error` 的确切编码尚未确认，见 OI-07。

### 11.5 DISCONNECT / FORGET

DISCONNECT（0x0005）：REQUEST `{}`；关闭 TCP、断开 STA、关闭 Wi-Fi、进入 OFF，保留 profile；已经 OFF 时 OK。异步结束的一般语义适用，非 OFF 时的确切返回值见 OI-11。Wi-Fi source 无权限；其正常结束方式是 TCP FIN。

FORGET（0x0006）：REQUEST `{}`；必须 OFF，否则 INVALID_STATE。成功 OK，删除 NVS profile，configured=false。不得附带自动 DISCONNECT。

### 11.6 Handover 与断线

```text
BLE Notify subscription → BLE HELLO
→ 可选 SCAN / GET_SCAN_RESULTS / SET_CONFIG
→ Controller 先启动可达的 TCP Server
→ WIFI.CONNECT(endpoint, handover_id) → ACCEPTED
→ Sailball 建立 STA / IP / outbound TCP
→ TRANSPORT_READY → Controller 核对关联 → TCP CORE.HELLO
→ Wi-Fi ONLINE → Controller 再主动断 BLE
```

短时间 BLE 与 Wi-Fi 同时存在是正常状态。Sailball 不在 TCP HELLO 成功后强制踢掉 BLE。BLE 断开时若无 Wi-Fi ONLINE，恢复 advertising；若已有 Wi-Fi ONLINE，不立即 advertising。

Controller 正常关闭 TCP，FIN 表示结束网络会话：关闭 TCP→Wi-Fi OFF→恢复 BLE advertising，**不重连**。RST、超时、AP 丢失等异常可进入 RECOVERING，进行有限次数退避重连；不得永久高频重试。最终失败关闭 Wi-Fi 并恢复 BLE advertising。具体退避和次数不写死为协议常量。

## 12. BLE Transport v1

Sailball 为 Peripheral/GATT Server；Controller 为 Central/GATT Client。一个自定义 GATT Service、两个 Characteristic：RX 为 Controller→Sailball 的 **WRITE**，TX 为 Sailball→Controller 的 **NOTIFY**。当前不要求 WRITE_WITHOUT_RESPONSE 或 INDICATE。

BLE 是完整 SP Transport，可查询状态、GNSS live、文件下载与 Wi-Fi provisioning；不是仅供配网的通道。最多一个 BLE connection；不要求 pairing/bonding。

### 12.1 建链与 discovery

建议 Legacy Advertising，至少广播 Sailball Service UUID；名称可为 `Sailball-XXXX`。广播不承载 GNSS/recording/storage 等状态，完整身份由 HELLO 提供。UUID 的具体值尚未分配于已读基线，见 OI-08。

Controller 必须依次 connect、discover Service/RX/TX、成功订阅 TX Notify，之后才发送 HELLO。GATT WRITE 的响应不是 SP 命令成功响应；仍需等待对应 SP RESPONSE。

### 12.2 Fragment header

先生成含 CRC32C 的完整 SP Frame，再分片；BLE 不套 COBS。

| GATT value offset | Size | 字段 |
| --- | --- | --- |
| 0x00 | 2 | frame_id，uint16 LE |
| 0x02 | 2 | offset，uint16 LE |
| 0x04 | 2 | total_length，uint16 LE，完整 SP Frame 长度 |
| 0x06 | N | fragment data |

`offset=0` 表示起始；`offset + fragment_data_length = total_length` 表示结束。不加 START/END flags，不加 fragment CRC。完整重组后按 SP Frame 长度与 CRC 校验。

ATT MTU 不写死：普通 WRITE/NOTIFY 的 GATT value 容量为 `negotiated_MTU−3`，扣除 fragment header 后 SP fragment data 最多 `MTU−9`。例如 MTU=256 时为 247 B。

### 12.3 重组与容量

每方向独立维护 uint16 frame_id，每完整 SP Frame 递增并自然回卷。它不是 request_id 或 SP sequence。每方向最多一个正在组装的 SP Frame，不做乱序缓存。

接收 offset 必须匹配 expected_offset；缺片、错序等情况丢弃当前组装帧并计 fragment error。旧帧未完成而新 frame_id 的 offset=0 到来时，丢弃旧帧、开始新帧并计错误。其余边界/超时策略见 OI-08。

当前建议 BLE max SP Payload 为 **2048 B**，完整 Frame 最多 **2076 B**；recommended_bulk_chunk 为 **1024 B raw data**。它们是当前推荐，客户端仍使用当前 Session HELLO 能力，不能写死下载块大小。

### 12.4 TX 反压

BLE TX queue 有界；既有建议优先级为 RESPONSE → 重要 EVENT → BULK → live STREAM。普通 Event 可丢；live 可用新样本覆盖旧样本。BULK 等待不能阻塞记录链或形成无限后台预读。不会增加 fragment ACK/重传协议。

## 13. BLE Service — 0x0007

BLE Transport 管 GATT、MTU、fragment、Notify；BLE Service 管 advertising 和连接控制。状态通过 CORE.GET_STATUS(BLE)。

SET_ADVERTISING（0x0001）：REQUEST `{0: enabled}`，enabled 必须 Boolean。true 启动/保持 advertising，false 停止 advertising；false 不断开已存在 BLE connection。BLE source 不能调用。返回值及其与自动 fallback policy 的优先关系见 OI-05/OI-11。

DISCONNECT（0x0002）：REQUEST `{}`；无 BLE connection 时 OK；存在连接时 ACCEPTED，异步断开。BLE source 无权限；可由 USB/Wi-Fi/未来 4G 控制。断开后是否 advertising 受 BLE policy 管理。

STATE_CHANGED（Event 0x0001）：`{0: state, 1: reason?}`。不得自行给未冻结的 reason 分配编号；旧说明中的 DISCONNECTED 与当前 state enum 不一致，见 OI-05。

## 14. DIAGNOSTICS — 0x0008

Diagnostics 是运行健康证据接口，不提供 LOG_READ、TASK_LIST、MEMORY_READ、HEAP_DUMP、STACK_TRACE 或 DEBUG_COMMAND。

### 14.1 GET_COUNTERS — Command 0x0001

REQUEST `{0: mask}`，mask 必填且非零；否则 INVALID_REQUEST。未知 bit 忽略。成功 data：`{0: returned_mask, 1: gnss?, 2: recorder?, 3: storage?, 4: transfer?, 5: transport?, 6: protocol?}`。

| Mask bit | Group | Map key → Counter |
| --- | --- | --- |
| 0 | GNSS | 0 rx_bytes；1 rx_messages；2 valid_fixes；3 parse_errors；4 uart_overruns；5 live_stream_dropped |
| 1 | RECORDER | 0 samples_received；1 samples_recorded；2 samples_dropped；3 blocks_completed；4 buffer_exhaustions |
| 2 | STORAGE | 0 blocks_received；1 blocks_committed；2 bytes_written；3 write_errors；4 bytes_read；5 read_errors；6 critical_queue_high_water；7 background_queue_high_water |
| 3 | TRANSFER | 0 opens；1 read_requests；2 bytes_served；3 busy_responses；4 read_errors |
| 4 | TRANSPORT | 以 Transport enum 0/1/2/3 为 key，每个子 Map：0 rx_frames；1 tx_frames；2 tx_dropped；3 connections；4 disconnects |
| 5 | PROTOCOL | 0 rx_frames；1 crc_errors；2 length_errors；3 magic_errors；4 transport_decode_errors；5 sequence_gaps；6 invalid_requests；7 unsupported_requests |

Counters boot-local，启动从 0 开始，只增不减，只读，不持久化，不允许清零；queue high-water 是启动以来最高值。客户端以 HELLO.boot_id 区分启动周期。Counter 位宽/溢出规则见 OI-07，不能直接沿用 SP sequence 的自然回卷规则。

live_stream_dropped / transport tx_dropped 不代表 SD 记录丢样。Recorder samples_dropped、Storage blocks_committed 等才反映各自链路。不要把 in-flight 短暂差值当成永久丢失。

### 14.2 Error Ring 与 GET_ERRORS — Command 0x0002

固定容量 RAM Ring，容量属于实现参数。高频统计性问题只增加 Counter；值得保留的离散重要错误**每次创建新 error_id，不合并**。这条最终审查修订覆盖早期的 occurrence_count 合并方案。

REQUEST `{0: after_id?, 1: limit?}`；after_id 表示仅获取 ID 大于该值的条目。limit 默认 16、最大 32；省略 after_id 时返回最近一批。排序、最小 limit、空 Ring 和 ID 耗尽规则见 OI-04。

最终成功 data 为：

```text
{0: entries, 1: oldest_error_id, 2: newest_error_id}
```

这覆盖早期 key 1 为 newest_error_id 的结构。oldest/newest 表示当前可用 Ring 历史边界，客户端可检测覆盖导致的 history gap。分页未读完时，客户端不得直接把 newest_error_id 当作“已读到”的 cursor。

Error Record 中已明确的字段：key 0 error_id（uint32，本 boot 内唯一）、key 3 service_id、key 4 error_code、key 5 severity、key 7 utc_us（可选）。早期 key 1 first_mono_us、key 2 last_mono_us、key 6 occurrence_count 在取消合并后的最终形状未确认；完整旧布局与冲突见 OI-04，本文不删除或重编号这些 key。

severity：0 WARNING、1 ERROR、2 CRITICAL；CRITICAL 表示影响关键记录链或无法正常继续记录。`service_id + error_code` 决定错误含义，不暴露底层 errno 文本或源码行号。

| Service | 已给出的 error_code |
| --- | --- |
| GNSS | 1 NO_DATA；2 UART_ERROR；3 PARSER_FAILURE |
| RECORDER | 1 SAMPLE_DROPPED；2 BUFFER_EXHAUSTED；3 BLOCK_BUILD_FAILED |
| STORAGE | 1 MOUNT_FAILED；2 WRITE_FAILED；3 READ_FAILED；4 COMMIT_FAILED；5 CARD_REMOVED |

其他 Service 的 error_code 未分配，不以通用 RESPONSE status 代替。高频 parse error、TRANSFER BUSY 通常只计数；SD write failure、记录丢样等重要离散事件进入 Ring。错误记录和通知不得阻塞 Critical Data Path。

### 14.3 CLEAR_ERRORS / ERROR_RAISED

CLEAR_ERRORS（Command 0x0003）：USB only，REQUEST `{}`，成功 OK。只清空历史 Ring，不清 Counters、不改变当前 ERROR 状态、不修复/重启任何 subsystem；不能把清历史当成恢复健康。

ERROR_RAISED（Event 0x0001）：`{0: error_id, 1: service_id, 2: error_code, 3: severity}`。仅是 best-effort 提醒；完整历史由 GET_ERRORS 查询。

## 15. UI — 0x0009

SET_PAGE（Command 0x0001）：REQUEST `{0: page}`；成功 OK，非法 page 返回 OUT_OF_RANGE；所有 Transport 允许。PAGE_CHANGED（Event 0x0001）：`{0: page}`。UI status：`{0: current_page}`。

| Page ID | 页面 | 固定身份颜色 |
| --- | --- | --- |
| 0 | OVERVIEW | Green 绿色 |
| 1 | GNSS | Cyan 青色 |
| 2 | STORAGE | Yellow 黄色 |
| 3 | USB | White 白色 |
| 4 | BLE | Purple 紫色 |
| 5 | WIFI | Blue 蓝色 |
| 6 | CELLULAR | Orange 橙色 |

本地 BOOT 短按依次循环上述页面，与远程 SET_PAGE 使用同一 UI 状态/API。SET_PAGE 只改变显示，不启动 Wi-Fi、不改变 GNSS、不启动或停止 Recorder。CELLULAR 页可以显示未启用，不意味着提供 Cellular Service 能力。

Overview：critical_path_healthy=true 为 green slow blink；false 为 red/green alternating。网络离线本身不令 Overview 不健康。

各 subsystem 使用固定身份颜色，以 pattern 表达状态；上表颜色来自更早的已确认 UI 设计。模块不可用/未连接时用该主色与红色交替，不使用持续熄灭表示页面状态；红色为状态修饰色，不成为另一模块的身份色。Overview 曾建议健康时500 ms亮/1500 ms灭，异常时500 ms绿/500 ms红；数值节奏的冻结程度见 OI-09。协议不增加 SET_COLOR/SET_PATTERN/SET_BRIGHTNESS。UI task 低优先级，LED/按键异常和 UI Event 拥塞不得影响记录链。

## 16. CELLULAR — 0x000A Reserved

当前仅保留 Service ID，不定义 APN、CONNECT、DISCONNECT 等 Command，也不定义 Cellular Status schema。未支持时，GET_STATUS returned_mask 不包含 CELLULAR bit。

未来复用 Wi-Fi 的 Outbound TCP Transport 模型：网络后端不同，SP Frame / CBOR / CORE / TRANSFER 的业务边界保持。未来 4G 的权限列是预留来源策略，不代表当前固件已实现 4G，也不定义 endpoint 的未来持久化策略。

## 17. 完整权限矩阵

USB = Physical Admin。无线不得 START/STOP Recorder，不得删除、修改或格式化 SD。当前 Transport 不得通过对应 Service 命令改变/破坏自身连接生命周期；Controller 在 Transport 层正常关闭 BLE/TCP 连接不等于调用被禁的 Service 命令。

“允许”只表示来源权限，仍需满足 HELLO、参数、状态、容量和资源约束。4G 列为未来来源规则。

| Service.Command | USB | BLE | Wi-Fi | 4G（预留） |
| --- | --- | --- | --- | --- |
| CORE.HELLO | 允许 | 允许 | 允许 | 允许 |
| CORE.GET_INFO | 允许 | 允许 | 允许 | 允许 |
| CORE.GET_STATUS | 允许 | 允许 | 允许 | 允许 |
| CORE.SUBSCRIBE_EVENTS | 允许 | 允许 | 允许 | 允许 |
| CORE.REBOOT | 允许 | 禁止 | 禁止 | 禁止 |
| GNSS.START_STREAM | 允许 | 允许 | 允许 | 允许 |
| GNSS.STOP_STREAM | 允许 | 允许 | 允许 | 允许 |
| GNSS.RESTART | 允许 | 禁止 | 禁止 | 禁止 |
| RECORDER.START | 允许 | 禁止 | 禁止 | 禁止 |
| RECORDER.STOP | 允许 | 禁止 | 禁止 | 禁止 |
| STORAGE.LIST_FILES | 允许 | 允许 | 允许 | 允许 |
| STORAGE.GET_FILE_INFO | 允许 | 允许 | 允许 | 允许 |
| STORAGE.DELETE_FILE | 允许 | 禁止 | 禁止 | 禁止 |
| STORAGE.FORMAT | 允许 | 禁止 | 禁止 | 禁止 |
| TRANSFER.OPEN_READ | 允许 | 允许 | 允许 | 允许 |
| TRANSFER.READ | 允许 | 允许 | 允许 | 允许 |
| TRANSFER.CLOSE | 允许 | 允许 | 允许 | 允许 |
| WIFI.SCAN | 允许 | 允许 | 禁止 | 允许 |
| WIFI.GET_SCAN_RESULTS | 允许 | 允许 | 允许 | 允许 |
| WIFI.SET_CONFIG | 允许 | 允许 | 禁止 | 允许 |
| WIFI.CONNECT | 允许 | 允许 | 禁止 | 允许 |
| WIFI.DISCONNECT | 允许 | 允许 | 禁止 | 允许 |
| WIFI.FORGET | 允许 | 允许 | 禁止 | 允许 |
| BLE.SET_ADVERTISING | 允许 | 禁止 | 允许 | 允许 |
| BLE.DISCONNECT | 允许 | 禁止 | 允许 | 允许 |
| DIAGNOSTICS.GET_COUNTERS | 允许 | 允许 | 允许 | 允许 |
| DIAGNOSTICS.GET_ERRORS | 允许 | 允许 | 允许 | 允许 |
| DIAGNOSTICS.CLEAR_ERRORS | 允许 | 禁止 | 禁止 | 禁止 |
| UI.SET_PAGE | 允许 | 允许 | 允许 | 允许 |

CORE.GET_STATUS 的所有已实现组适用同一读权限，包括 SYSTEM/GNSS/RECORDER/STORAGE/USB/BLE/WIFI/UI；文件读取和诊断读取也不因来自 Wi-Fi 而禁止。WRITE/FORMAT/DELETE 不因“物理文件未活跃”变成无线可用。

## 18. Event 规则

普通 STATE_CHANGED、SCAN_COMPLETE、ERROR_RAISED、PAGE_CHANGED 都是 best-effort notification，允许因队列满、拥塞或断线丢失。Event 丢失不影响设备权威状态，不能用“未收到 Event”证明没有状态变化。

当前状态以 CORE.GET_STATUS 为准；错误历史以 DIAGNOSTICS.GET_ERRORS 为准；Counter 为启动以来统计证据。Event 是重新查询的提示，不是持久事件日志、命令最终成功凭证或可靠投递通道。

CORE.TRANSPORT_READY 是 Outbound TCP bootstrap 特例，在 HELLO 和订阅前发送，不受订阅控制。bootstrap 未完成不得进入普通业务 ONLINE 状态；具体超时属于未完全规定的连接策略。

## 19. USB / TCP Transport 与公共容量规则

### 19.1 USB / TCP 字节流

线上编码为 `COBS(SP Frame) + 0x00`。接收端按 0x00 分隔 COBS packet，解码后校验 SP 长度与 CRC。TCP read/write 调用边界不是 Frame 边界；必须处理半帧、多个粘连 Frame 和 partial send。缓冲区须有界，不能因一直没有分隔符无限增长。

当前硬件已确定使用 ESP32-C3 原生 USB 串口，SP 作为 USB 字节流承载。具体发现标识、Host 接口约定和 Session reset 判定未冻结，见 OI-08。USB 不是可远程重置的业务 Service。

### 19.2 Controller TCP Server

Controller 必须先建立 listener 再发 WIFI.CONNECT；可以动态端口。传给 Sailball 的 address 是设备实际可达的 IPv4，不是 `0.0.0.0`，后者只可用于本地 listen bind。一个 Sailball 同时最多一个 active TCP Session；Controller 可接受多个设备，以 TRANSPORT_READY 的 device_id / boot_id / handover_id 区分。

每次新 TCP connection 都执行 TRANSPORT_READY→HELLO，不复用旧 request/sequence/transfer/subscription。正常 FIN 与异常断线的策略见 11.6。

### 19.3 Payload 与 chunk

`max_rx_payload` 只计 SP Payload；`recommended_bulk_chunk` 只计 raw 文件数据，BULK 另加 16 B；Frame 另加 28 B，Transport 再加 COBS 或每片 6 B 开销。

| Transport | 既有推荐 | 最终使用依据 |
| --- | --- | --- |
| BLE | Payload 2048 B；raw chunk 1024 B | 当前 Session HELLO + 本地接收/发送能力 + 协商 MTU |
| Wi-Fi TCP | 曾给出 Payload 8192 B、raw chunk 4096 B 的示例 | 当前 Session HELLO；示例不是固定 ABI 常量 |
| USB | raw chunk 4096 B 的示例；未冻结固定接收上限 | 当前 Session HELLO + 本地接口能力 |
| Cellular | 无当前实现值 | 保留，不能据 Wi-Fi 示例声称已支持 |

方向示例：Controller 宣布 max_rx_payload=8192，Sailball 宣布=4096，则 Controller→Sailball 不超过4096，Sailball→Controller 不超过8192，同时仍受各自实际 Transport 能力约束。READ 请求本身的 CBOR 长度遵守设备接收上限；对应 BULK 遵守 Controller 接收上限，不能把这两个方向混淆。

## 20. 基线来源与最终修订

来源为项目对话《迁移到ESP IDF》中 Frame/CBOR/CORE/GNSS/RECORDER/STORAGE+TRANSFER/WIFI/BLE/DIAGNOSTICS/UI 设计，以及总表审查后明确接受的修订；参见 [项目对话](chatgpt-conversation://6ab71d21-5e1c-83e8-84a9-cb0ea4ab0820)。本次用户给出的冻结清单优先。

已落实的后续修订：Wi-Fi source 允许 GET_SCAN_RESULTS；HELLO 双向 max_rx_payload；READ 只回 BULK 或失败 RESPONSE；Error Ring 不合并；GET_ERRORS data keys 1/2 分别为 oldest/newest；request_id=0 保留；sequence 从0开始自然回卷且 gap 不拒帧；普通 Event best effort；ACCEPTED 表示已提交而非完成。

本文未从早期非最终示例引入 stream_id、旧 HELLO 命名、旧 Wi-Fi 枚举编号、Error 合并行为或被删除的命令。

## 21. Open Issues

以下内容均**没有在本次整理中作决定**。冻结标记适用于已确认基线，不表示这些细节已形成唯一可互操作的字节 ABI。

### OI-01 — SP 与 LDC 的 fix_type 编码不同

SP：0 NO_FIX、1 FIX_2D、2 FIX_3D、255 UNKNOWN。现有 LDC：0 NONE、1 DEAD_RECKONING、2 FIX_2D、3 FIX_3D、4 GNSS_DR、5 TIME_ONLY。两者不能复用数值。尚需确认映射表、LDC 更丰富状态向 SP 的映射和 UNKNOWN 策略；本文保留各自原值，不更改冻结协议。

### OI-02 — Recorder session_id 与 LDC session_id

SP Recorder session_id 是 boot-local uint32；现有 LDC 文件 session_id 为16 B opaque ID。尚未规定关联方式或是否需要对外暴露映射。不得把其中一者截断后宣称等同另一者。

### OI-03 — Active LDC 下载只冻结长度，未冻结 metadata 内容

LDC Data Region append-only，但 Metadata Region 可按 COW 更新。OPEN_READ 仅冻结 readable_size，若客户端下载 metadata 期间发生 superblock/page 轮换，不保证读到同一 generation 的一致字节。尚需确认 active transfer 的 metadata 一致性方案；不擅自增加 snapshot token、metadata pinning、锁或新命令。异常关闭文件可能有未 commit 尾部，“关闭文件=完整大小”的早期描述也须与 readable_size 安全边界统一。

### OI-04 — 取消 Error 合并后的 record schema 与分页边界

早期完整 entry 为 `{0: error_id, 1: first_mono_us, 2: last_mono_us, 3: service_id, 4: error_code, 5: severity, 6: occurrence_count, 7: utc_us?}`。最终仅明确取消合并和更新 Response 的 oldest/newest，没有确定 key 1/2/6 是否保留、固定取值或删减；不自行改为新的 mono_us key。还需确定 entry 顺序、无 after_id 的“最近一批”顺序、limit 下界、空 Ring oldest/newest 表示、after_id 过旧处理和 uint32 error_id 耗尽规则。CLEAR_ERRORS 后 ID 不能因清历史而破坏 boot-local 唯一性，但具体游标边界表达未确认。

### OI-05 — BLE Status 两种 schema 与 Event state

早期给出 `{0: state, 1: advertising, 2: connected, 3: mtu?, 4: peer_present?}`，随后提出可压缩为 `{0: state, 1: mtu?}`，未明确选定。key 1 存在 Boolean / MTU 类型冲突。BLE Event 示例曾用 DISCONNECTED，但已列 enum 没有该值；不能私自新增编号。reason enum 未定义。

### OI-06 — HELLO/bootstrap 与重复握手边界

TRANSPORT_READY 先于 HELLO，发送时尚不知道 Controller max_rx_payload；HELLO 自身的最小接收能力/超小上限处理未定。device_id 的 Byte String 固定长度、USB Session reset 条件、同 Session 重复 HELLO 的资源与序列处理、握手超时值也未形成统一 ABI。不得自行引入认证握手或新 capability key。

### OI-07 — 数值、深度与少数字段编码仍不完整

CBOR depth=6 的根层计数方法未明确；Counters 的位宽和耗尽行为未定，不能在“只增不减”要求下自行回卷。部分 mask、GNSS raw integer、age 值的确切范围，以及 Wi-Fi last_error 类型、从未收过 GNSS 时 age 表达、SSID 下界/password 各安全模式长度未完整列出。需要在不改已有 key 语义的前提下确认。

### OI-08 — BLE/USB 标识与分片异常边界

GATT Service/RX/TX UUID、USB 接口发现/封装端点标识未给出最终值。BLE frame_id 初始值、组装超时、total_length 中途变化、空片/重复片/越界片的完整处理表未冻结。2048/1024 为当前建议，不替代正式能力声明。本文不生成随机 UUID 或新增 fragment 协议。

### OI-09 — UI 节奏的数值参数

完整固定身份颜色已从更早的项目对话核实，列于第15节，不再视为缺失。Overview 的500/1500 ms与500/500 ms出现在“建议固定节奏”中，未得到单独的数值确认；是否将其作为固件UI强制参数仍待明确。具体RGB/亮度和其他pattern参数不属于当前SP线上控制能力，本文不猜测常量、不增加配置命令。

### OI-10 — Transfer READ/CLOSE 的边界条件

length=0、offset==readable_size、非 EOF 短读、READ 中 CLOSE、活动 Transfer 的错误 CLOSE ID、断线后本地部分文件续传的内容一致性均未完整规定。READ timeout 后旧 READ 可能仍 outstanding；不能把无响应当作“设备已结束请求”。本文不新增 CANCEL、pipeline 或跨 Session transfer_id。

### OI-11 — 状态竞态、REBOOT 收尾及管理策略

RECORDER 在 ERROR/STOPPING 下 START 等未列转移、WIFI.CONNECT 重复/冲突调用、非 OFF WIFI.DISCONNECT 的确切返回码、BLE.SET_ADVERTISING 成功返回时机、手动关闭 advertising 与 Wi-Fi fallback 自动恢复的优先级尚未完整定义。CORE.REBOOT 在 recording 活跃时的安全收尾语义也未确认；不擅自等同 RECORDER.STOP。

### OI-12 — 通用异常响应与响应容量

非零 Flags/Channel 的完整接收策略、错误 Major、request_id=0 的非法 REQUEST、重复请求去重策略、SUBSCRIBE_EVENTS 对重复/未知 Service 的处理，以及多个错误同时出现时的优先级未完全固定。若 GET_STATUS/GET_ERRORS/GET_SCAN_RESULTS/LIST_FILES 合法结果超过接收者 max_rx_payload，分批/截断/错误策略亦未明确；不得自行增加分页字段或突破上限。BLE Error Ring/Counter 的深层结构必须与最终 depth 计数口径一致。
