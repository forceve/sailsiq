# LDC v1
## Log Data Container Format Specification

Sailball • Frozen specification 1.0 • 26 September 2026 • Consistency revision

A compact, self-describing, append-only container for embedded time-series logs.

LDC separates stable field identity from versioned decoding definitions. Every committed block contains its own time basis, field directory and initial state, allowing readers to decode a selected block without replaying earlier data blocks.

### Specification at a glance
| Property | LDC v1.0 |
| --- | --- |
| File extension / magic | .ldc / ASCII LDC1 |
| Metadata region | 16 KiB, including two 512-byte superblocks |
| Data region | Starts at file offset 0x4000; append-only |
| Block duration | At most 15,000,000 microseconds |
| Binary structures | 96-byte block header; 16-byte descriptor; 16-byte footer |
| Field definitions | Immutable 32-byte records, versioned per local field |
| Value modes | STREAM, CHANGE, CONST |
| Default compression | Delta + ZigZag + base-128 varint |
| Time | Monotonic microseconds and optional Unix UTC microseconds |
| Integrity | CRC32C, duplicate length/sequence, final commit marker |

### Reading guide
Sections 1–4 define the model and metadata transaction system. Sections 5–8 define time, block layout and encodings. Sections 9–11 define integrity, recovery and compatibility. Sections 12–13 provide examples and implementation acceptance criteria.

The binary layouts and requirements in this candidate are normative for candidate-version interoperability. The recommended Sailball GNSS profile is optional for general LDC files. BLE, Wi-Fi and USB message framing belongs to the separate Sailball Protocol specification.



# 1. Scope, goals and conventions

### 1.1 Design goals
LDC MUST preserve stored integer values losslessly, permit optional and custom fields, and allow field definitions to evolve without changing the interpretation of historical blocks. It SHOULD keep embedded recording work bounded and move indexing, rich labels and export processing to readers.

Blocks MUST be independently decodable given the file's committed metadata. This does not mean that a detached block contains its own field definitions. A reader still needs the referenced local_field_id and definition_version records.

The format detects incomplete writes and corruption. It does not make an SD card or filesystem power-fail atomic. A 15-second block bounds the recording interval of one unfinished block; it does not guarantee a 15-second upper bound on loss when the storage stack has additional unflushed data.

Sailball Firmware v1 performs the section 9.3 two-barrier commit for every block to minimize the uncommitted window, but implementations and user documentation MUST still avoid promising that sudden power loss can never lose more than exactly 15 seconds; the storage medium and filesystem remain part of the failure model.

### 1.2 Requirement language and integers
MUST and MUST NOT are mandatory for conformance. SHOULD indicates a recommendation with a documented reason required for deviation. MAY indicates an optional behavior. All offsets and sizes are in bytes. KiB means 1,024 bytes. Ranges written [a,b) include a and exclude b.

Fixed-width multibyte integers MUST be little-endian. Signed fixed-width values use two's complement. u8/u16/u32/u64 and i8/i64 identify width and signedness. ASCII magic values are literal byte sequences. Writers MUST serialize fields explicitly; dumping a compiler-native struct is not a portable encoding.

Unless specified otherwise, reserved bytes and reserved flag bits MUST be zero. File offsets use u64 where stored; block-relative offsets use u32. Metadata references are logical offsets resolved through the selected superblock's page map. Readers MUST validate lengths and integer arithmetic before allocation or seeking.

### 1.3 Identity and definition are separate
| Identifier | Meaning and lifetime |
| --- | --- |
| local_field_id | Nonzero u16 identity within one file; never reused for a different quantity or source identity |
| semantic_id | u16 official meaning; zero means custom/unstandardized; interpreted with format major version |
| definition_version | Nonzero u16 version scoped to one local_field_id; increments for a changed definition |
| block_sequence | u32, starts at zero; increments once per block; no wrap within a file |
| generation | u64 metadata publication counter; starts at one; no wrap |

Two local fields MAY share a semantic_id, for example two sensors measuring the same quantity. Applications MUST retain local identity and MUST NOT merge them solely because their semantic IDs match. A custom name does not change official meaning.

### 1.4 Stable boundaries
A block uses one nominal sample grid and at most one descriptor per local field. Rate, field-set, definition, CONST value and time-basis changes take effect at a new block boundary. No schema update record is interleaved into the data region. Every descriptor selects its definition explicitly; no reader may substitute the newest definition.



# 2. File organization and superblocks

### 2.1 Fixed 16 KiB metadata region
| Logical range | Size | Purpose |
| --- | --- | --- |
| 0x0000–0x01FF | 512 B | Superblock A, physical address fixed |
| 0x0200–0x03FF | 512 B | Superblock B, physical address fixed |
| 0x0400–0x0BFF | 2 KiB | Field Catalog: 64 × 32-byte records |
| 0x0C00–0x2BFF | 8 KiB | Definition Bank: 256 × 32-byte records |
| 0x2C00–0x33FF | 2 KiB | Unit/String/Auxiliary pool |
| 0x3400–0x3FFF | 3 KiB | Six shadow pages for copy-on-write |
| 0x4000 onward | Variable | Committed data blocks followed by optional incomplete tail |

The table gives initial logical placement. After a metadata update, the 24 logical table pages may reside in any of the 30 physical 512-byte pages in [0x0400,0x4000). The six extra pages remain transaction capacity, not additional field capacity. Data always starts at physical 0x4000.

### 2.2 Superblock layout (512 bytes)
| Offset | Size | Field / requirement |
| --- | --- | --- |
| 0x000 | 4 | magic = ASCII LDC1 |
| 0x004 | 2 + 2 | format_major = 1; format_minor = 0 |
| 0x008 | 8 | generation |
| 0x010 | 4 + 4 | metadata_size = 16384; data_offset = 16384 |
| 0x018 | 16 | session_id: opaque, nonzero, unique per recording file; Firmware documents may call this `ldc_file_session_id` to distinguish it from the SP Recorder uint32 logical session ID |
| 0x028 | 8 | device_id: opaque u64; zero if unavailable |
| 0x030 | 8 | created_mono_us: u64 |
| 0x038 | 8 | created_utc_us: i64; zero unless flag bit 0 set |
| 0x040 | 8 | first_valid_utc_us: i64; zero unless flag bit 1 set |
| 0x048 | 4 | flags: bit 0 CREATED_UTC_VALID; bit 1 FIRST_UTC_VALID |
| 0x04C | 2 + 2 | field_count ≤64; definition_count ≤256 |
| 0x050 | 2 + 2 | auxiliary_bytes_used ≤2048; page_count = 24 |
| 0x054 | 4 | required_features = 0 for v1.0 |
| 0x058 | 4 | optional_features = 0 for v1.0 |
| 0x05C | 48 | page_map[24]: u16 physical page indices, each 0…29 |
| 0x08C | 96 | page_crc32c[24]: u32 CRC of each full logical page |
| 0x0EC | 272 | reserved, zero |
| 0x1FC | 4 | superblock_crc32c over bytes [0x000,0x1FC) |

No two logical pages may map to the same physical page. For logical offset L ≥0x400: p=floor((L−0x400)/512), r=(L−0x400) mod 512; physical address = 0x400 + 512×page_map[p] + r. Split reads at page boundaries. Initial page_map[p]=p.



# 3. Field catalog and definition bank

### 3.1 Field Catalog record (32 bytes)
| Offset | Size | Field |
| --- | --- | --- |
| 0x00 | 2 | local_field_id, nonzero |
| 0x02 | 2 | semantic_id; zero for custom fields |
| 0x04 | 4 | name_offset: logical pool offset; zero if absent |
| 0x08 | 2 | name_length: UTF-8 byte length; zero if absent |
| 0x0A | 2 | flags = 0 |
| 0x0C | 16 | reserved = 0 |
| 0x1C | 4 | record_crc32c over bytes [0,28) |

Catalog records occupy a dense prefix of field_count entries. IDs MUST be unique. The catalog establishes identity only; mode, unit and scale belong to definitions. Published catalog records are immutable. A custom field SHOULD have a nonempty name; official names need not be repeated in the file.

### 3.2 FieldDefinition record (32 bytes)
| Offset | Size | Field |
| --- | --- | --- |
| 0x00 | 2 | local_field_id; MUST exist in catalog |
| 0x02 | 2 | definition_version, begins at 1 |
| 0x04 | 2 | semantic_id; MUST equal catalog value |
| 0x06 | 1 | mode: 0 STREAM, 1 CHANGE, 2 CONST |
| 0x07 | 1 | value_type: 0 UINT, 1 SINT, 2 BOOL, 3 ENUM, 4 BYTES |
| 0x08 | 2 | unit_id |
| 0x0A | 1 | scale: signed i8 decimal exponent |
| 0x0B | 1 | default_codec: recommendation; descriptor selects actual codec |
| 0x0C | 2 | flags: bit 0 CIRCULAR; all other bits zero |
| 0x0E | 2 | enum_table_id: 0 none; 1 GNSS_FIX_TYPE; 0xFFFF local |
| 0x10 | 4 | name_offset: optional definition-specific display name |
| 0x14 | 2 | name_length: UTF-8 byte length |
| 0x16 | 2 | aux_length: total bytes of auxiliary TLVs |
| 0x18 | 4 | aux_offset: logical pool offset; zero when aux_length=0 |
| 0x1C | 4 | record_crc32c over bytes [0,28) |

Definitions occupy a dense prefix of definition_count entries; their physical slot number is not a stream identifier. The pair (local_field_id, definition_version) MUST be unique. Each new version is a complete definition, never a patch. Older records remain available. If capacity or an ID/version limit is reached, finish the file and create a new one.

UINT and ENUM range from 0 to 2^64−1; SINT from −2^63 to 2^63−1; BOOL is exactly 0 or 1. ENUM and BOOL MUST use scale=0. BYTES has scale=0, unit_id=0 and no circular flag. Floating-point encodings are not defined in v1.0.



# 4. Units, auxiliary data and publication

### 4.1 Unit and scale rules
Physical value = stored_integer × 10^scale, expressed in unit_id. Scale describes quantization, not measurement accuracy. Defaults at definition creation are SI and scale −2 for ordinary physical quantities. Writers MUST still serialize the resolved unit and scale; readers MUST NOT infer precision from a name.

| ID | Unit | ID | Unit |
| --- | --- | --- | --- |
| 0x0000 | SI_DEFAULT / unspecified dimension | 0x0006 | count |
| 0x0001 | degree | 0x0007 | volt |
| 0x0002 | metre | 0x0008 | ampere |
| 0x0003 | second | 0x0009 | degree Celsius |
| 0x0004 | metre per second | 0x000A | hertz |
| 0x0005 | knot | 0xFFFF | custom unit |

SI_DEFAULT does not identify a dimension by itself. For an unknown custom quantity, a generic reader can decode raw numbers but MUST NOT invent a unit. Writers SHOULD use an explicit built-in unit. A numeric SI_DEFAULT definition MUST provide a canonical SI unit expression in auxiliary type 2. For BOOL/ENUM, unit 0 means no physical unit; count is appropriate for satellite counts. A custom unit MUST provide type 2, but automatic conversion is not implied. One knot equals 1852/3600 metres per second.

### 4.2 Pool and auxiliary TLVs
All names and auxiliary ranges MUST lie wholly inside [0x2C00,0x2C00+auxiliary_bytes_used). Names are valid UTF-8, without a terminator or embedded NUL. Missing ranges use offset=length=0. Published bytes are immutable; unused space is zero. An auxiliary bundle is a packed sequence of u16 type, u16 payload_length, then exactly payload_length bytes, with no padding.

| Type | Payload and interpretation |
| --- | --- |
| 1 | u64 circular_modulus in stored-integer units, >0 and ≤2^63−1 |
| 2 | UTF-8 unit expression or custom unit label |
| 3 | Local enum table: u16 count, then count entries of u64 value, u16 label_length, UTF-8 label; no duplicate values |

Known TLV types occur at most once. Unknown TLVs may be skipped and MUST NOT redefine decoding. CIRCULAR requires type 1 and numeric UINT/SINT. enum_table_id=0xFFFF requires type 3; built-in table 1 is defined in section 5. New decoding-critical TLVs require a compatible version/feature declaration, not silent introduction.

### 4.3 Copy-on-write metadata transaction
First close the current block. Keep all pages referenced by the active superblock untouched. Invalidate the inactive superblock by writing zero magic and durably flushing it before reusing any pages referenced only by that inactive copy. Copy each changed logical page into a free physical page, preserving every published byte in that logical page. At most six logical pages may change in one transaction.

Flush the new pages, verify their CRCs, then write and flush the inactive superblock with generation+1, new counts, map and page CRCs. The new superblock becomes active only after the write is durable and validates. Only then may a block reference the new definitions. Larger changes are split into independently valid transactions. Unchanged pages remain shared; no published record is overwritten logically. Both superblocks may initially contain identical generation-1 snapshots.



# 5. Official registry and Sailball GNSS profile

### 5.1 Parser-maintained official registry
Parsers maintain official names, descriptions and recommendations keyed by (format_major, semantic_id). The file retains all structural decoding information: type, mode, unit, scale, actual codec and auxiliary parameters. Registry recommendations MUST NOT override the definition stored in a file.

Within major version 1, published semantic IDs MUST NOT change meaning, be deleted or be reused. Minor releases may add IDs and deprecate existing entries. Corrections to labels and descriptions must preserve meaning. A new major version MAY reorganize IDs and field organization; readers MUST select the registry by major version. Registry growth alone does not require a binary-format change.

There are no category namespaces or vendor ranges in v1. New official IDs are allocated from the unassigned pool as needed. Custom fields use semantic_id=0, with their own local IDs and optional names. Unknown nonzero IDs remain unknown official semantics: readers SHOULD show the ID and decoded values when the encoding is supported.

### 5.2 Recommended profile: SAILBALL_GNSS_BASIC
| semantic_id | Recommended name | Mode / type | Unit / scale |
| --- | --- | --- | --- |
| 0x0001 | latitude | STREAM / SINT | degree / −7 |
| 0x0002 | longitude | STREAM / SINT | degree / −7 |
| 0x0003 | altitude_msl | STREAM / SINT | metre / −2 |
| 0x0004 | ground_speed | STREAM / UINT | knot / −2 |
| 0x0005 | course_over_ground | STREAM / UINT | degree / −2 |
| 0x0006 | satellites_used | CHANGE / UINT | count / 0 |
| 0x0007 | fix_type | CHANGE / ENUM | unit 0 / 0 |

Latitude is north-positive, within [−90,+90] degrees; longitude is east-positive, within [−180,+180) degrees, using WGS84 coordinates. altitude_msl is height relative to mean sea level, not ellipsoid height; the producing system is responsible for its height reference. Negative altitude is valid. ground_speed is nonnegative. course_over_ground is direction of motion clockwise from true north, in [0,360), not vessel bow heading. It SHOULD use CIRCULAR with modulus 36000 at scale −2.

satellites_used counts satellites used in the navigation solution, not all visible satellites. fix_type uses built-in enum table 1: 0 NONE; 1 DEAD_RECKONING; 2 FIX_2D; 3 FIX_3D; 4 GNSS_DR; 5 TIME_ONLY. Higher values are unassigned; readers preserve unfamiliar values numerically. Drivers MUST map source states explicitly and MUST NOT copy incompatible vendor enum numbers blindly.

For Sailball Firmware v1, Superblock `device_id` SHOULD be the stable u64 derived from the ESP32-C3 base eFuse MAC, with the 48-bit MAC value placed in the low 48 bits and the upper 16 bits zero. The u64 is serialized little-endian in this file. Sailball Protocol exposes the same u64 as a fixed 8-byte little-endian Byte String. This is an application profile convention; generic LDC readers still treat the field as opaque.

Sailball Firmware may use a richer internal normalized fix enum and map it separately to LDC and SP. The frozen SP mapping is: LDC/Internal NONE→SP NO_FIX; FIX_2D→SP FIX_2D; FIX_3D→SP FIX_3D; TIME_ONLY→SP NO_FIX; DEAD_RECKONING, GNSS_DR and unknown internal states→SP UNKNOWN. The distinct on-disk LDC enum values remain unchanged.

All seven fields are part of the recommended recording configuration, but a descriptor is emitted only when its values can be represented honestly. Absent or invalid altitude/COG MUST NOT be fabricated as zero. **The presence bitmap is common to whole sample slots and is not a per-field validity mask.** Therefore a Sailball writer that observes a per-field availability change during a block MUST close the current block and begin a new block whose field set honestly reflects that availability, rather than encoding an independent null for one field. A whole field may be omitted for a block. An optional custom validity field is possible. Position validity and UTC validity are independent. Quality/DOP fields and a separate position_valid field are not part of this default profile.



# 6. Time model and block boundaries

### 6.1 Two independent clocks
start_mono_us is an always-valid u64 monotonic time coordinate. Timeouts, ordering and recording continuity use monotonic time. start_utc_us is an optional i64 Unix-epoch UTC microsecond coordinate. Files do not store local time zones or daylight-saving offsets. UTC corrections MUST NOT modify monotonic time or historical blocks.

A file covers one monotonic **file session**. Reset or deep-sleep wake that resets the monotonic clock MUST create a new file and a new 16-byte LDC `session_id`. Capacity-driven file rotation also creates a new LDC `session_id`, even when higher-level Sailball firmware keeps the same logical Recorder session across multiple files. The SP Recorder uint32 `session_id` is therefore a different identity layer and MUST NOT be truncated, expanded, or compared directly with this 16-byte field. Recording MAY begin before UTC is available. created_utc_us may remain invalid; first_valid_utc_us can later be published through a metadata transaction without rewriting earlier data.

### 6.2 Rational sample grid
sample_rate_num and sample_rate_den are nonzero u16 values in lowest terms; rate=num/den Hz. Slots are numbered 0…nominal_slots−1. For slot i:

```text
offset_us(i) = floor(i * sample_rate_den * 1,000,000 / sample_rate_num)
mono(i)      = start_mono_us + offset_us(i)
utc(i)       = start_utc_us  + offset_us(i), only if UTC_VALID
```

Compute each offset from i; never repeatedly add a rounded period. Use checked wide arithmetic. These are nominal grid coordinates, not a claim that measurement or reception occurred at an exact microsecond. A future/custom sample_time_offset STREAM (second, scale −6) may preserve measurement deviations; it is not a default field and has no official v1.0 semantic ID.

duration_us MUST be in 1…15,000,000. nominal_slots MUST equal ceil(duration_us×num/(1,000,000×den)) and fit u16; every included slot begins before the exclusive block end. A partial final slot is allowed when closing early. The next block's start_mono_us MUST be at least the previous start plus duration_us. A normal 10 Hz, 15-second block contains 150 slots; a 4 Hz block contains 60. A gap between blocks is allowed and MUST NOT be filled silently.

### 6.3 UTC state
time_source: 0 NONE, 1 GNSS_UTC, 2 GNSS_GPS_CONVERTED, 3 NTP, 4 RTC, 5 HOST. time_flags: bit 0 UTC_VALID; bit 1 UTC_ESTIMATED; bits 2 PPS_SYNCED and 3 LEAP_SECOND reserved in v1.0 and zero. time_accuracy_us is a u32 uncertainty estimate, or 0xFFFFFFFF when unknown; zero is not the unknown sentinel.

UTC_ESTIMATED requires UTC_VALID. When UTC_VALID=0, start_utc_us=0, source=NONE and accuracy=0xFFFFFFFF. Source must be nonzero when UTC_VALID=1. Driver conversion from GPS time must have valid conversion parameters; otherwise UTC stays invalid. Unix time does not uniquely encode an inserted leap second: during an unrepresentable leap interval, v1.0 writers MUST clear UTC_VALID and split blocks instead of claiming an unambiguous UTC mapping.

### 6.4 Transitions
Close the block on rate/definition/field-set/CONST changes or a change of UTC validity, source or mapping. A discontinuity sets TIME_DISCONTINUITY on the new block. At startup, an invalid-to-valid UTC transition starts a new block. Readers may estimate earlier UTC from a later anchor within the same session, but MUST label estimates and retain original validity; extrapolation across a discontinuity is not automatic.



# 7. Block header and stream directory

### 7.1 BlockHeader v1 (96 bytes)
| Offset | Size | Field |
| --- | --- | --- |
| 0x00 | 4 | magic = ASCII LDBK |
| 0x04 | 2 | header_version = 1 (96-byte layout) |
| 0x06 | 2 | flags: bit 0 HAS_PRESENCE; bit 1 TIME_DISCONTINUITY |
| 0x08 | 4 | block_sequence |
| 0x0C | 4 | block_length: includes header through footer |
| 0x10 | 8 | start_mono_us: u64 |
| 0x18 | 8 | start_utc_us: i64 |
| 0x20 | 2 + 2 | sample_rate_num; sample_rate_den |
| 0x24 | 2 + 2 | nominal_slots; valid_slots |
| 0x28 | 2 + 2 | stream_count; directory_length |
| 0x2C | 4 | directory_offset = 96 |
| 0x30 | 4 | payload_offset |
| 0x34 | 4 | payload_length |
| 0x38 | 4 | presence_bitmap_offset, or zero |
| 0x3C | 2 | presence_bitmap_length, or zero |
| 0x3E | 1 + 1 | time_source; time_flags |
| 0x40 | 4 | time_accuracy_us |
| 0x44 | 4 | header_crc32c; see section 9 |
| 0x48 | 4 | duration_us: exclusive recording interval length |
| 0x4C | 20 | reserved = 0 |

All offsets above are block-relative. stream_count≤64. directory_length=16×stream_count; payload_offset=96+directory_length. The block is packed: header, directory, stream payloads, optional bitmap, footer. There is no alignment padding between blocks or components.

### 7.2 StreamDescriptor (16 bytes)
| Offset | Size | Field |
| --- | --- | --- |
| 0x00 | 2 + 2 | local_field_id; definition_version |
| 0x04 | 1 + 1 | codec; flags=0 |
| 0x06 | 2 | value_count (meaning depends on mode) |
| 0x08 | 4 | payload_offset: relative to start of this block |
| 0x0C | 4 | payload_length for this stream |

Descriptors MUST be sorted by local_field_id, without duplicates. Stream byte ranges are packed in descriptor order, without gaps or overlap; their lengths sum to header.payload_length. An empty stream has length zero and points to the current packed cursor. An omitted field has no descriptor, not a disabled bit or numeric sentinel. Unknown codecs can be skipped using their validated byte ranges, without losing the other columns.



# 8. Presence and scalar encodings

### 8.1 Presence bitmap
The bitmap is common to all STREAM fields and marks recorded sample slots, not GNSS fix validity. When HAS_PRESENCE=0, valid_slots=nominal_slots and bitmap offset/length are zero. Otherwise bitmap length=ceil(nominal_slots/8), offset=payload_offset+payload_length, and bit (i mod 8) in byte floor(i/8) indicates slot i; least-significant bit first. Unused high bits in the last byte MUST be zero. Population count MUST equal valid_slots.

STREAM values are ordered by increasing set-bit slot index. Missing slots do not consume values or reset the delta base. CHANGE event positions use nominal slot numbers, never compacted valid-value indices, and may occur at a missing STREAM slot. This records a state observation without claiming a complete stream sample. An all-missing block is allowed: STREAM payloads and counts are zero; known CHANGE/CONST state may still be recorded.

### 8.2 Base-128 unsigned varint and ZigZag
A UVAR stores seven low-order bits per byte, least-significant group first. Bit 7 is one when another byte follows. The encoding MUST be shortest-form and terminate within ten bytes. A tenth byte, if present, can only be 0x01; overflow, truncation and overlong representations are errors.

```text
ZigZag(x) = 2*x       if x >= 0
            -2*x - 1 if x < 0
SVAR(x)   = UVAR(ZigZag(x))
```

The formula is mathematical; implementations MUST avoid signed-shift and overflow errors. Decode z as z/2 when even and −(z+1)/2 when odd, using safe arithmetic. Absolute SINT values use SVAR; UINT, BOOL and ENUM use UVAR. Deltas always use SVAR, even when the absolute type is unsigned. The encodings use the base-128 and ZigZag primitives described in the Protocol Buffers encoding guide [R1]; the surrounding container is LDC-specific.

### 8.3 Codec/mode compatibility and counts
| Codec | Mode | value_count |
| --- | --- | --- |
| 0x00 RAW | STREAM or CONST | valid_slots for STREAM; exactly 1 for CONST |
| 0x01 DELTA_VARINT | STREAM, numeric types | valid_slots |
| 0x02 CHANGE_VARINT | CHANGE, numeric types | 1 + number of change events |
| 0x03 CONST_VARINT | CONST, numeric types | exactly 1 |

Other codec IDs are unassigned in v1.0. BYTES only supports RAW. Default codecs SHOULD follow the table. Descriptors select actual encoding, so a block may use RAW to avoid an unrepresentable delta without changing the definition. All decoded values MUST fit the logical value type. A decoder MUST consume exactly the declared payload length; unexplained trailing bytes are invalid.



# 8. Encodings (continued)

### 8.4 DELTA_VARINT
For nonempty streams, encode one absolute value according to value_type, then one signed difference from the previous stored value for every remaining value. The first value corresponds to the first present slot, which need not be slot zero. No base or delta is inherited from another block. A stream with count zero has no payload bytes.

For ordinary fields, delta=current−previous. If this mathematical difference cannot fit i64, writers MUST use RAW for that stream or start a new block. Decoders MUST reject overflow when reconstructing a value; machine wraparound is not permitted.

For CIRCULAR fields, all values are normalized to [0,M), where M is circular_modulus. Compute r=(current−previous) mod M in [0,M); delta=r if 2r<M, otherwise r−M. Thus an exactly half-turn tie takes the negative direction. Decode current=(previous+delta) mod M, using nonnegative modulo. The delta MUST be the canonical shortest result. A course change 35999→1 at modulus 36000 is +2. Circular rules apply only to delta encoding; absolute RAW, CONST and CHANGE values remain normalized.

### 8.5 CHANGE_VARINT
Encode initial_value, then zero or more pairs (slot_delta, new_absolute_value). Initial state applies from nominal slot 0. The first event's slot_delta is its absolute slot index; later deltas are relative to the preceding event. slot_delta uses UVAR and MUST be positive; all event slots lie in 1…nominal_slots−1. New values use the type's absolute encoding, not differences. Events are strictly increasing and SHOULD exclude no-op changes.

The descriptor count is one plus event count. A state unchanged throughout the block has count=1 and just its initial value. If initial state is unknown, do not fabricate it: omit the field for that block or split when state becomes known. No preceding block is consulted for initial state.

### 8.6 CONST_VARINT
Encode exactly one absolute value. It applies to the whole block. Repeat that value in every block that includes the field, even if unchanged since the previous block. Changing the value closes the current block.

### 8.7 RAW
For numeric types, a nonempty payload begins with one u8 width in {1,2,4,8}, followed by value_count fixed-width little-endian values. SINT uses signed two's-complement values of that width; UINT/ENUM are unsigned. BOOL requires width 1. Select a width that represents all values exactly. An empty STREAM has zero payload bytes, with no width prefix.

For BYTES, each value is UVAR byte_length followed by that many uninterpreted bytes; there is no width prefix. Empty byte strings are allowed. Counts still follow STREAM or CONST mode. Payload bounds constrain lengths; readers MUST NOT allocate an unchecked length. RAW CHANGE is not defined in v1.0.

### 8.8 Capacity and rates
The common sample grid serves all STREAMs in a block. Independent multirate grids, per-field missing-value maps, floating point, delta-of-delta, RLE and bit packing are outside v1.0. Applications may close blocks, omit fields or use additional files rather than silently inventing unsupported wire layouts.



# 9. CRC32C and durable commit

### 9.1 CRC parameters
CRC32C uses the Castagnoli polynomial: normal 0x1EDC6F41, reflected 0x82F63B78, initial register 0xFFFFFFFF, reflected input/output, final XOR 0xFFFFFFFF. The check value for ASCII “123456789” is 0xE3069283; the CRC of an empty sequence is zero. Store the resulting u32 little-endian. Castagnoli background is given in [R2]; LDC coverage and byte order are defined here.

| Protected object | Exact CRC input |
| --- | --- |
| Superblock | First 508 bytes; CRC field excluded |
| Logical metadata page | Full 512 bytes; result stored in superblock |
| Catalog / definition record | First 28 bytes; CRC field excluded |
| Block header | All 96 bytes with bytes [0x44,0x48) treated as zero |
| Committed block | All bytes [0,block_length−16), including stored header CRC |

### 9.2 CommitFooter (16 bytes)
| Offset | Size | Field |
| --- | --- | --- |
| 0x00 | 4 | block_crc32c over the block prefix defined above |
| 0x04 | 4 | block_length, exact duplicate of header |
| 0x08 | 4 | block_sequence, exact duplicate of header |
| 0x0C | 4 | commit_magic = ASCII LDCM (4C 44 43 4D) |

The first field protects the header, directory, all stream bytes and bitmap, not just the stream payloads. Header CRC protects length navigation before allocating or skipping. Footer copies and the commit marker are not included in block_crc32c; they are validated by equality and exact byte comparison.

block_length=96+directory_length+payload_length+presence_bitmap_length+16. Minimum is 112 bytes. The footer begins exactly at block_length−16, whether or not a bitmap is present. A file has no required global footer, end marker, in-file index or finalized block count.

### 9.3 Required writer order
Prepare final lengths and header CRC before writing the block. Ensure every referenced definition has already been durably published. Append header, directory, stream payloads, bitmap, then the first 12 footer bytes. Flush that prefix to durable storage. Append the four commit-marker bytes last, then flush again. Only after successful completion may the writer report the block as persisted.

A Sailball firmware implementation therefore requires **two durability barriers per committed block**: one after the complete prefix through the first 12 footer bytes, and one after writing `commit_magic`. It MUST NOT advance protocol/storage `readable_size`, increment a durable commit counter, or release the corresponding recording buffer until the second barrier succeeds.

The format requires the storage implementation to supply the ordering/durability barrier. A successful buffered write alone is not such a barrier. If a write or flush fails, the writer MUST NOT report success or append subsequent blocks after an uncertain tail; terminate that file and create another recording file if recording continues.

### 9.4 Integrity is not authenticity
CRC success detects many accidental errors but is not an authenticity check. Readers MUST still check bounds, counts, definitions and supported features. Do not treat a matching magic string or a lone commit marker as proof of a valid block. Application-specific security, signing and transport permissions are outside this format.



# 10. Reading, random access and recovery

### 10.1 Select metadata
Read both physical superblocks independently. Check magic, supported versions/features, superblock CRC, sizes, limits, unique page mappings and CRCs for every referenced logical page. Validate record CRCs, unique field/version pairs, catalog-definition agreement and all auxiliary ranges. A snapshot is usable only if its required metadata is valid.

Choose the valid snapshot with greatest generation. Equal-generation copies MUST be byte-identical; otherwise report ambiguous metadata. If a newer snapshot is damaged, use the older valid snapshot and report fallback. Newly appended blocks may reference definitions unavailable in that older snapshot; keep those bytes recoverable, but do not substitute definitions. If neither snapshot validates, normal decoding fails. Forensic recovery is a separate, explicitly reported mode.

### 10.2 Scan and validate blocks
Start at physical 0x4000. Require a complete 96-byte header, correct header version and CRC, sane counts/rate/duration and an in-file block range. Validate packed region relationships, descriptor uniqueness, bitmap count and footer marker/duplicates/CRC. Resolve exact definitions and decode selected streams with type and count checks.

Strict reading stops at the first structurally invalid or incomplete block and exposes the preceding valid prefix. A block with verified framing and CRC but an unknown codec can be skipped or partially decoded; its integrity and decoding support are separate states. A missing definition is reported as undecodable metadata dependency, never interpreted using another version.

### 10.3 Random-read considerations
Build an in-memory index of file offset, length, sequence, start_mono_us, duration and UTC validity while scanning headers. A header-only scan gives a provisional index; a block becomes integrity-verified only after its full CRC passes. No on-disk block index is required. One hour at 15-second blocks has 240 headers; early closures increase the count.

Use the directory to seek directly to a chosen field's byte range. Delta decoding must start from that stream's base within the block, but no other stream needs decoding. A full integrity check still reads all bytes covered by the block CRC. Sort and seek primarily by monotonic time; UTC can jump and cannot safely support a single globally sorted index without accounting for discontinuities.

For Sailball Protocol v1 active-file transfer, the transport implementation freezes `readable_size` and copies the entire 16 KiB Metadata Region into a RAM snapshot at OPEN_READ. Reads below 0x4000 come from that snapshot; reads at or above 0x4000 come from the file's committed append-only prefix. This is a transfer consistency rule and does not change the LDC byte format.

### 10.4 Error recovery policy
An incomplete final header, stream, CRC or commit marker is an uncommitted tail and MUST NOT be returned as recorded samples. Device startup SHOULD leave the old file unchanged and begin a new session file. Repair/export tools MAY create a new file containing the verified prefix; they SHOULD preserve the original.

Optional salvage scanning searches byte-by-byte for LDBK after corruption, because blocks are not padded. Every candidate requires full header, bounds, footer and block CRC validation. Reject overlaps; require increasing sequence and monotonic position relative to accepted blocks. Report skipped byte ranges and sequence gaps. CRC matching alone is not a guarantee against maliciously fabricated candidates. Never silently join recovered intervals into a gap-free track.

Metadata page copy-on-write protects against overwriting active logical pages during an update. Media faults affecting shared pages or filesystem structures can still damage both snapshots. Readers must report this limitation rather than claiming that all historical data is guaranteed recoverable.



# 11. Versioning and compatibility

### 11.1 Independent version axes
| Axis | Update rule |
| --- | --- |
| format_major | Selects incompatible container/semantic interpretation; v1 magic is LDC1 |
| format_minor | Additive compatible capabilities within the major; v1.0 writes zero |
| header_version | Selects block-header wire layout; version 1 is exactly 96 bytes |
| definition_version | Complete immutable decoding definition for one local field |
| registry release | Adds names/official semantics within a major; not a stored decoder override |
| generation | Publishes a metadata snapshot; does not select a stream's definition |

A parser version number is not a file format version. A parser supporting multiple major versions MUST keep their registries separate. Migrating a v1 file to a future major requires deliberate ID and semantic mapping into a new file; merely changing the magic/version is invalid.

### 11.2 Compatible extension rules
The existing meaning of unit IDs, codec IDs, value types, modes and flags MUST NOT be repurposed within major version 1. Minor revisions may allocate unused values. New official semantic IDs can be added without changing the binary format when existing types and codecs suffice.

Unknown required_features bits cause rejection of normal decoding. Unknown optional_features bits may be ignored only because optional features are forbidden from altering required interpretation. In v1.0 both masks are zero. A future minor version may be read using the v1.0 core only when the header version is supported, no unknown required feature is set, and all used structural extensions can be safely skipped.

Reserved structural bytes cannot acquire new mandatory meaning silently. A change in core header size, offset interpretation, CRC coverage or decoding-critical semantics requires an explicit supported version/feature mechanism, and a major version when compatibility cannot be maintained. An unsupported header_version cannot be navigated using assumed v1 offsets beyond the validated common contract; strict readers stop.

### 11.3 Reader behavior for unknown data
| Condition | Required behavior |
| --- | --- |
| Unknown semantic_id | Preserve ID; decode using file definition if supported |
| Unknown unit_id | Preserve raw values, scale and unit number; do not guess conversion |
| Unknown enum value | Preserve number and mark label unknown |
| Unknown codec/type/mode | Skip validated stream range; mark unsupported |
| Missing definition | Mark dependency unresolved; never use latest definition |
| Unknown required feature | Reject normal decoding of the file |
| CRC failure / bad ranges | Reject block or metadata snapshot as applicable |

Partial decoding MUST identify omitted/unsupported fields and MUST NOT be labeled full conformance validation. A metadata snapshot can be structurally verified while a field remains semantically unknown. A writer MUST emit only features it declares and only encoding combinations defined by its claimed format version.

### 11.4 File rotation
Rotate before catalog, definition, auxiliary or generation/version/sequence capacity is exhausted. The new file repeats all definitions it requires, receives a new 16-byte LDC file `session_id` and begins `block_sequence` zero. A continuous underlying monotonic clock may continue across capacity-driven file rotation; higher-level Sailball firmware may keep the same logical Recorder session across such normal rotation, but every LDC file remains independently identified and self-contained at the metadata level.



# 12. Worked examples

### 12.1 Unit and definition evolution
stored=1234, unit=knot, scale=−2 represents 12.34 kn. Latitude stored=301234567 at degree/−7 represents 30.1234567 degrees. A finer latitude definition at scale=−9 uses a new definition_version with the same local_field_id and semantic_id. Old blocks continue referencing the old version. Increasing scale resolution does not create additional sensor accuracy.

### 12.2 Encoding vectors (hexadecimal bytes)
| Case | Logical values | Encoded bytes |
| --- | --- | --- |
| UVAR | 0; 127; 128; 300 | 00; 7F; 80 01; AC 02 |
| SVAR | −1; 0; +1; −2; +2 | 01; 00; 02; 03; 04 |
| SINT DELTA | 100, 103, 102 | C8 01 06 01 |
| UINT circular DELTA | 35999, 1; M=36000 | 9F 99 02 04 |
| CHANGE | initial 18; slot 37→19; slot 82→17 | 12 25 13 2D 11 |
| CONST UINT | 2 | 02 |
| RAW SINT width 2 | −2, 300 | 02 FE FF 2C 01 |
| RAW BYTES | two values: empty, ASCII A | 00 01 41 |

CHANGE in this example has value_count=3. Its second event delta is 82−37=45 (0x2D), not 82. For nominal_slots=10 with only slots 0,2,9 present, the bitmap is 05 02 and valid_slots=3. A STREAM with values 100,103,102 then maps to those three nominal slots, retaining the missing intervals.

### 12.3 Fully specified block construction
Assume committed metadata defines local field 1, definition 1 as SINT STREAM, semantic latitude, degree/−7. Construct sequence 0 at start_mono_us=1,000,000; UTC invalid; rate 10/1; duration 300,000; nominal_slots=valid_slots=3; one descriptor; no bitmap. time_source=0, time_flags=0, accuracy=0xFFFFFFFF; all other flags/reserved bytes zero.

| Region | Offset / length | Contents |
| --- | --- | --- |
| Header | 0 / 96 | LDBK, version 1; directory_length=16; block_length=132 |
| Directory | 96 / 16 | field=1, definition=1, codec=1, count=3, offset=112, length=4 |
| Stream payload | 112 / 4 | C8 01 06 01 (stored integers 100,103,102) |
| Footer | 116 / 16 | CRC32C of bytes [0,116), length 132, sequence 0, LDCM |

The header payload_offset=112 and payload_length=4. Header CRC is 0x2ED3DDD6; footer block CRC is 0x02B9EF0D, computed with the stored header CRC included. Both are stored little-endian. The next block starts at file offset 0x4000+132. Slot times are 1,000,000; 1,100,000; 1,200,000 monotonic microseconds. These small integer values are encoding examples, not a realistic sailing trajectory.

### 12.4 Metadata update interrupted by power loss
Generation 8 remains active while new definition pages are written. If power fails before generation 9 validates, readers select generation 8. No data block may reference the newly added definition before its publication is durable. Metadata generation and field definition_version are independent counters. If generation 9 is valid, readers retain all earlier definitions. A torn data-block footer leaves a tail that readers ignore.



# 13. Implementation acceptance criteria

### 13.1 Writer and reader checks
An interoperable implementation SHOULD verify the following cases before production use. These checks are acceptance requirements for implementation work, not evidence that a particular firmware has already passed them.

| Area | Required acceptance cases |
| --- | --- |
| Layout | Exact 512/32/96/16-byte sizes; little-endian serialization; range arithmetic at limits |
| CRC | Empty input and 123456789 checks; header-zeroing rule; complete block coverage |
| Varints | Signed extrema, unsigned maximum, tenth-byte overflow, truncation and overlong rejection |
| Delta | Signed/unsigned absolute values; negative delta; overflow fallback; circular wrap and half-turn tie |
| Presence | No bitmap, missing first slot, middle gaps, all missing, tail-bit and popcount rejection |
| State modes | Initial CHANGE state repeated in every block; nominal event slots; CONST boundary |
| Time | 3 Hz rational grid without drift; UTC absent/acquired/jumped; partial final slot; session reset |
| Definitions | Scale change; old version still decodes; duplicate ID/version rejection; capacity rotation |
| Metadata COW | Failure before/after page flush, superblock write and inactive-copy invalidation |
| Data commit | Truncate at every header/payload/footer byte; no false persisted block |
| Recovery | Corruption in middle; older metadata fallback; unresolved definitions; explicit salvage gaps |
| Compatibility | Unknown semantic, unit, enum and codec; unsupported required feature and major |

### 13.2 Suggested reference implementation boundary
Keep five responsibilities distinct: metadata snapshot management, scalar codecs, block construction/validation, append/flush storage, and parser registry/export. Runtime GNSS structs and hardware driver enums are converted at the recorder boundary. They are not the on-disk format.

Track generated blocks separately from durably committed blocks. Build reader indexes from validated headers, attach integrity state to each indexed entry, and preserve raw values alongside display-unit conversion. Export tools SHOULD retain missing-slot gaps, unknown-field identifiers and UTC validity or estimation status.

### 13.3 Informative references
[R1] Protocol Buffers, “Encoding,” base-128 varints and signed ZigZag mapping. https://protobuf.dev/programming-guides/encoding/

[R2] IETF RFC 3720, “Internet Small Computer Systems Interface (iSCSI),” CRC32C / Castagnoli background. LDC does not adopt iSCSI packet layouts or checksum placement. https://www.rfc-editor.org/rfc/rfc3720

The LDC layouts, metadata mapping, field identities and Sailball profile are defined by this specification. External references explain encoding primitives; they do not define the LDC container.
