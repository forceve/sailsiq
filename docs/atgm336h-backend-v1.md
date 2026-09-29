# ATGM336H-6N74 GNSS Backend v1

Software implementation note. The board map and backend are configured, and pre-flash software acceptance passed. No ATGM hardware has yet been connected or tested; hardware validation remains pending. For tester steps, use `hardware-test-handoff-v1.0.md`.

## Architecture and board boundary

GNSS UART ownership remains in `sailball_gnss`. The vendor-neutral interface accepts runtime baud and normalized update-rate targets; the ATGM backend owns module startup, command sequencing, UART transition, verification, NMEA parsing, epoch aggregation, restart and normalized fix publication. `sailball_board` contains only physical facts: UART1, ESP RX GPIO0, ESP TX GPIO1. Recorder, Storage, LDC, Supervisor, SP, Control, UI and System consume vendor-neutral GNSS types. No u-blox/UBX backend was added.

The confirmed board has no GPS PPS output. There is no PPS pin, backend capability, ISR or PPS health requirement in this v1 configuration.

## ATGM startup policy

The manufacturer ATGM336H-6N family manual identifies the 6N-74 UART default as 115200 baud and lists a 10 Hz maximum update rate. The backend starts UART1 at that module default, waits a bounded period for valid NMEA, then configures the target sentence set, 10 Hz update rate and runtime baud. The target runtime configuration is 115200 baud / 10 Hz. It then verifies continuing valid NMEA and distinct normalized epoch cadence before reporting READY.

Configuration retries are bounded. Silence or command/UART failure moves the backend into its bounded recovery/error path; it does not reset the MCU or retry forever. A valid NMEA NO_FIX epoch remains activity and is distinct from silence. Commands are reapplied at startup; the backend does not issue a flash-save command on each boot.

The configured sentence set is RMC, GGA and GSA. The backend uses PCAS configuration commands for sentence selection, update rate and baud. Command write success alone does not mark the backend READY; post-transition NMEA and cadence verification are required.

## Parser and normalized output

The bounded parser recognizes sentence mnemonics by the final three identifier characters, so supported talker variants can be accepted. It parses RMC UTC/date, position, speed and course; GGA fix quality, altitude and satellites; GSA dimension and satellite use; and VTG course/speed enrichment. Sentence storage is limited to 96 bytes. Input is incremental and supports fragmented reads, multiple sentences per read, CRLF, checksum checking, noise, malformed numeric values and bounded overlength recovery. It does not allocate heap memory per sentence.

RMC/GGA sentences with a valid time key are grouped into a bounded epoch. A new time key finalizes the prior epoch; a partial epoch may be emitted after a 250 ms settle window. GSA/VTG enrichment uses a 1.5 s freshness window. Malformed timed input does not publish a phantom NO_FIX epoch. Valid RMC V or GGA quality-zero input does publish NO_FIX. UTC and position validity are independent; absent fresh GSA dimension yields UNKNOWN rather than an inferred 3D fix.

Normalized output includes sequence, monotonic receive time, UTC and validity, signed E7 coordinates and validity, altitude in centimetres, speed in centi-knots, course in centi-degrees, satellites and vendor-neutral fix type.

## Host evidence and hardware limits

Fake-UART tests exercise the production GNSS owner/backend/Recorder path, including startup success, bounded command retries, UART transition failure, post-transition silence, valid NO_FIX activity, and cadence verification. The full 32-executable host suite passes, and all three current profiles freshly link. The locked VALIDATION artifact is recorded in `build-and-test-v1.0.md`; hardware baud transition, physical 10 Hz cadence, electrical timing and RF behavior remain unverified.

The board map is user-confirmed: UART1 RX GPIO0 / TX GPIO1; SD SPI2 GPIO4–7; LED GPIO8; BOOT GPIO9; native USB GPIO18/19. No hardware baud transition, module command response, 10 Hz physical cadence, RF behavior or electrical timing has yet been observed.

### Reference material

- ATGM336H-6N family manual, including 6N-74 default baud and update-rate specifications: <https://m5stack.oss-cn-shenzhen.aliyuncs.com/resource/docs/products/unit/Unit-GPS%20v1.1/ATGM336H-6N.pdf>
- CASIC protocol specification for PCAS command fields: <https://www.espruino.com/files/CASIC_en.pdf>
