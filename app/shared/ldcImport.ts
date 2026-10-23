/** Sailball LDC v1.0 reader for track import. Spec: LDC_v1_Format_Specification-v1.0.md */

const METADATA_SIZE = 16384;
const DATA_OFFSET = 0x4000;
const SUPERBLOCK_SIZE = 512;
const PAGE_SIZE = 512;
const LOGICAL_PAGE_COUNT = 24;
const PHYSICAL_PAGE_COUNT = 30;
const BLOCK_HEADER_SIZE = 96;
const DESCRIPTOR_SIZE = 16;
const FOOTER_SIZE = 16;
const MAX_BLOCK_US = 15_000_000;
const MAX_FIELDS = 64;
const MAX_DEFINITIONS = 256;
const AUX_POOL_LOGICAL = 0x2c00;
const CATALOG_LOGICAL = 0x0400;
const DEFINITION_LOGICAL = 0x0c00;

const MAGIC_LDC1 = 0x3143444c; // 'LDC1' little-endian
const MAGIC_LDBK = 0x4b42444c; // 'LDBK'
const MAGIC_LDCM = 0x4d43444c; // 'LDCM'

const SEM_LATITUDE = 0x0001;
const SEM_LONGITUDE = 0x0002;
const SEM_GROUND_SPEED = 0x0004;
const SEM_COG = 0x0005;
const SEM_FIX_TYPE = 0x0007;

const MODE_STREAM = 0;
const MODE_CHANGE = 1;
const MODE_CONST = 2;

const TYPE_UINT = 0;
const TYPE_SINT = 1;
const TYPE_BOOL = 2;
const TYPE_ENUM = 3;
const TYPE_BYTES = 4;

const CODEC_RAW = 0x00;
const CODEC_DELTA_VARINT = 0x01;
const CODEC_CHANGE_VARINT = 0x02;
const CODEC_CONST_VARINT = 0x03;

const UNIT_DEGREE = 0x0001;
const UNIT_METRE_PER_SECOND = 0x0004;

const FLAG_HAS_PRESENCE = 0x0001;
const TIME_FLAG_UTC_VALID = 0x01;
const DEF_FLAG_CIRCULAR = 0x0001;

const KNOTS_PER_MPS = 1.9438444924406;
const CRC32C_POLY = 0x82f63b78;

export interface DecodedLdcTrack {
  points: Array<{
    t?: number;
    lat: number;
    lon: number;
    s?: number;
    h?: number;
  }>;
  hadSourceTime: boolean;
  hadSourceSpeed: boolean;
  hadSourceHeading: boolean;
  warnings: string[];
}

interface Superblock {
  generation: bigint;
  pageMap: number[];
  pageCrc: number[];
  fieldCount: number;
  definitionCount: number;
  auxiliaryBytesUsed: number;
  flags: number;
  createdUtcUs: bigint;
  firstValidUtcUs: bigint;
}

interface FieldCatalogEntry {
  localFieldId: number;
  semanticId: number;
}

interface FieldDefinition {
  localFieldId: number;
  definitionVersion: number;
  semanticId: number;
  mode: number;
  valueType: number;
  unitId: number;
  scale: number;
  flags: number;
  circularModulus?: bigint;
}

interface BlockHeader {
  flags: number;
  blockSequence: number;
  blockLength: number;
  startMonoUs: bigint;
  startUtcUs: bigint;
  sampleRateNum: number;
  sampleRateDen: number;
  nominalSlots: number;
  validSlots: number;
  streamCount: number;
  directoryLength: number;
  payloadOffset: number;
  payloadLength: number;
  presenceBitmapOffset: number;
  presenceBitmapLength: number;
  timeFlags: number;
  durationUs: number;
}

interface StreamDescriptor {
  localFieldId: number;
  definitionVersion: number;
  codec: number;
  valueCount: number;
  payloadOffset: number;
  payloadLength: number;
}

const CRC32C_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ CRC32C_POLY : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

function crc32c(bytes: Uint8Array, start = 0, length = bytes.length - start): number {
  let crc = 0xffffffff;
  const end = start + length;
  for (let i = start; i < end; i++) {
    crc = CRC32C_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function u64(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, true);
}

function i64(view: DataView, offset: number): bigint {
  return view.getBigInt64(offset, true);
}

function magicAt(bytes: Uint8Array, offset: number, magic: number): boolean {
  if (offset + 4 > bytes.length) return false;
  const view = viewOf(bytes);
  return view.getUint32(offset, true) === magic;
}

export function looksLikeLdc(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && magicAt(bytes, 0, MAGIC_LDC1);
}

function decodeUvar(
  bytes: Uint8Array,
  offset: number,
  end: number,
): { value: bigint; consumed: number } | null {
  let result = 0n;
  const max = Math.min(end - offset, 10);
  for (let i = 0; i < max; i++) {
    const b = bytes[offset + i]!;
    if (i === 9 && (b & 0xfe) !== 0) return null;
    result |= BigInt(b & 0x7f) << BigInt(i * 7);
    if ((b & 0x80) === 0) {
      if (i > 0 && (b & 0x7f) === 0) return null;
      return { value: result, consumed: i + 1 };
    }
  }
  return null;
}

function decodeSvar(
  bytes: Uint8Array,
  offset: number,
  end: number,
): { value: bigint; consumed: number } | null {
  const decoded = decodeUvar(bytes, offset, end);
  if (!decoded) return null;
  const zigzag = decoded.value;
  const magnitude = zigzag >> 1n;
  const value = (zigzag & 1n) === 0n ? magnitude : -1n - magnitude;
  return { value, consumed: decoded.consumed };
}

function decodeSuperblock(bytes: Uint8Array, offset: number): Superblock | null {
  if (offset + SUPERBLOCK_SIZE > bytes.length) return null;
  const slice = bytes.subarray(offset, offset + SUPERBLOCK_SIZE);
  const view = viewOf(slice);
  if (view.getUint32(0, true) !== MAGIC_LDC1) return null;
  if (u16(view, 4) !== 1 || u16(view, 6) !== 0) return null;
  if (u32(view, 16) !== METADATA_SIZE || u32(view, 20) !== DATA_OFFSET) return null;
  if (u16(view, 82) !== LOGICAL_PAGE_COUNT) return null;
  if (u32(view, 84) !== 0 || u32(view, 88) !== 0) return null;
  if (u32(view, 508) !== crc32c(slice, 0, 508)) return null;
  for (let i = 236; i < 508; i++) {
    if (slice[i] !== 0) return null;
  }

  let sessionAny = 0;
  for (let i = 24; i < 40; i++) sessionAny |= slice[i]!;
  if (sessionAny === 0) return null;

  const flags = u32(view, 72);
  if ((flags & ~3) !== 0) return null;
  const createdUtcUs = i64(view, 56);
  const firstValidUtcUs = i64(view, 64);
  if ((flags & 1) === 0 && createdUtcUs !== 0n) return null;
  if ((flags & 2) === 0 && firstValidUtcUs !== 0n) return null;

  const pageMap: number[] = [];
  const pageCrc: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < LOGICAL_PAGE_COUNT; i++) {
    const physical = u16(view, 92 + 2 * i);
    if (physical >= PHYSICAL_PAGE_COUNT || seen.has(physical)) return null;
    seen.add(physical);
    pageMap.push(physical);
    pageCrc.push(u32(view, 140 + 4 * i));
  }

  const fieldCount = u16(view, 76);
  const definitionCount = u16(view, 78);
  const auxiliaryBytesUsed = u16(view, 80);
  const generation = u64(view, 8);
  if (
    generation === 0n ||
    fieldCount > MAX_FIELDS ||
    definitionCount > MAX_DEFINITIONS ||
    auxiliaryBytesUsed > 2048
  ) {
    return null;
  }

  return {
    generation,
    pageMap,
    pageCrc,
    fieldCount,
    definitionCount,
    auxiliaryBytesUsed,
    flags,
    createdUtcUs,
    firstValidUtcUs,
  };
}

function verifyLogicalPages(bytes: Uint8Array, superblock: Superblock): boolean {
  for (let page = 0; page < LOGICAL_PAGE_COUNT; page++) {
    const physical = 0x400 + superblock.pageMap[page]! * PAGE_SIZE;
    if (physical + PAGE_SIZE > bytes.length) return false;
    if (crc32c(bytes, physical, PAGE_SIZE) !== superblock.pageCrc[page]) return false;
  }
  return true;
}

function readLogical(
  bytes: Uint8Array,
  pageMap: number[],
  logicalOffset: number,
  length: number,
): Uint8Array | null {
  const out = new Uint8Array(length);
  let written = 0;
  let remaining = length;
  let cursor = logicalOffset;
  while (remaining > 0) {
    if (cursor < 0x400 || cursor >= DATA_OFFSET) return null;
    const page = Math.floor((cursor - 0x400) / PAGE_SIZE);
    const remainder = (cursor - 0x400) % PAGE_SIZE;
    if (page < 0 || page >= LOGICAL_PAGE_COUNT) return null;
    const take = Math.min(remaining, PAGE_SIZE - remainder);
    const physical = 0x400 + pageMap[page]! * PAGE_SIZE + remainder;
    if (physical + take > bytes.length) return null;
    out.set(bytes.subarray(physical, physical + take), written);
    written += take;
    remaining -= take;
    cursor += take;
  }
  return out;
}

function parseCircularModulus(
  bytes: Uint8Array,
  pageMap: number[],
  auxOffset: number,
  auxLength: number,
  auxiliaryBytesUsed: number,
): bigint | undefined {
  if (auxLength === 0 || auxOffset === 0) return undefined;
  const poolEnd = AUX_POOL_LOGICAL + auxiliaryBytesUsed;
  if (auxOffset < AUX_POOL_LOGICAL || auxOffset + auxLength > poolEnd) return undefined;
  const blob = readLogical(bytes, pageMap, auxOffset, auxLength);
  if (!blob) return undefined;
  let pos = 0;
  while (pos + 4 <= blob.length) {
    const type = blob[pos]! | (blob[pos + 1]! << 8);
    const payloadLength = blob[pos + 2]! | (blob[pos + 3]! << 8);
    pos += 4;
    if (pos + payloadLength > blob.length) return undefined;
    if (type === 1 && payloadLength === 8) {
      const modulus = viewOf(blob).getBigUint64(pos, true);
      if (modulus > 0n && modulus <= 0x7fffffffffffffffn) return modulus;
    }
    pos += payloadLength;
  }
  return undefined;
}

function loadCatalogAndDefinitions(
  bytes: Uint8Array,
  superblock: Superblock,
): { catalog: Map<number, FieldCatalogEntry>; definitions: Map<string, FieldDefinition> } | null {
  const catalog = new Map<number, FieldCatalogEntry>();
  const definitions = new Map<string, FieldDefinition>();

  for (let i = 0; i < superblock.fieldCount; i++) {
    const raw = readLogical(bytes, superblock.pageMap, CATALOG_LOGICAL + i * 32, 32);
    if (!raw) return null;
    if (crc32c(raw, 0, 28) !== viewOf(raw).getUint32(28, true)) return null;
    const localFieldId = u16(viewOf(raw), 0);
    const semanticId = u16(viewOf(raw), 2);
    if (localFieldId === 0 || catalog.has(localFieldId)) return null;
    catalog.set(localFieldId, { localFieldId, semanticId });
  }

  for (let i = 0; i < superblock.definitionCount; i++) {
    const raw = readLogical(bytes, superblock.pageMap, DEFINITION_LOGICAL + i * 32, 32);
    if (!raw) return null;
    const view = viewOf(raw);
    if (crc32c(raw, 0, 28) !== view.getUint32(28, true)) return null;
    const localFieldId = u16(view, 0);
    const definitionVersion = u16(view, 2);
    const semanticId = u16(view, 4);
    const catalogEntry = catalog.get(localFieldId);
    if (!catalogEntry || definitionVersion === 0 || catalogEntry.semanticId !== semanticId) {
      return null;
    }
    const key = `${localFieldId}:${definitionVersion}`;
    if (definitions.has(key)) return null;
    const auxOffset = view.getUint32(0x18, true);
    const auxLength = u16(view, 0x16);
    const flags = u16(view, 0x0c);
    const circularModulus =
      (flags & DEF_FLAG_CIRCULAR) !== 0
        ? parseCircularModulus(
            bytes,
            superblock.pageMap,
            auxOffset,
            auxLength,
            superblock.auxiliaryBytesUsed,
          )
        : undefined;
    definitions.set(key, {
      localFieldId,
      definitionVersion,
      semanticId,
      mode: raw[6]!,
      valueType: raw[7]!,
      unitId: u16(view, 8),
      scale: view.getInt8(0x0a),
      flags,
      circularModulus,
    });
  }

  return { catalog, definitions };
}

function selectMetadata(bytes: Uint8Array): Superblock {
  if (bytes.byteLength < METADATA_SIZE) {
    throw new Error('This LDC file is truncated and is missing its metadata region.');
  }
  const candidates = [decodeSuperblock(bytes, 0), decodeSuperblock(bytes, SUPERBLOCK_SIZE)]
    .filter((candidate): candidate is Superblock => candidate != null)
    .filter((candidate) => verifyLogicalPages(bytes, candidate));
  if (candidates.length === 0) {
    throw new Error('The LDC metadata region is missing or corrupt.');
  }
  candidates.sort((a, b) => (a.generation < b.generation ? 1 : a.generation > b.generation ? -1 : 0));
  return candidates[0]!;
}

function decodeBlockHeader(bytes: Uint8Array, offset: number): BlockHeader | null {
  if (offset + BLOCK_HEADER_SIZE > bytes.length) return null;
  const slice = bytes.subarray(offset, offset + BLOCK_HEADER_SIZE);
  const view = viewOf(slice);
  if (view.getUint32(0, true) !== MAGIC_LDBK) return null;
  if (u16(view, 4) !== 1 || u32(view, 44) !== 96) return null;
  const copy = new Uint8Array(slice);
  const storedCrc = u32(view, 0x44);
  copy[0x44] = 0;
  copy[0x45] = 0;
  copy[0x46] = 0;
  copy[0x47] = 0;
  if (crc32c(copy) !== storedCrc) return null;
  for (let i = 76; i < 96; i++) {
    if (slice[i] !== 0) return null;
  }
  return {
    flags: u16(view, 6),
    blockSequence: u32(view, 8),
    blockLength: u32(view, 12),
    startMonoUs: u64(view, 16),
    startUtcUs: i64(view, 24),
    sampleRateNum: u16(view, 32),
    sampleRateDen: u16(view, 34),
    nominalSlots: u16(view, 36),
    validSlots: u16(view, 38),
    streamCount: u16(view, 40),
    directoryLength: u16(view, 42),
    payloadOffset: u32(view, 48),
    payloadLength: u32(view, 52),
    presenceBitmapOffset: u32(view, 56),
    presenceBitmapLength: u16(view, 60),
    timeFlags: slice[63]!,
    durationUs: u32(view, 72),
  };
}

function validatePresence(
  bitmap: Uint8Array,
  slots: number,
  validSlots: number,
): boolean {
  if (bitmap.length !== Math.ceil(slots / 8)) return false;
  if (slots % 8 !== 0 && bitmap.length > 0) {
    const extra = 0xff << (slots % 8);
    if ((bitmap[bitmap.length - 1]! & extra) !== 0) return false;
  }
  let count = 0;
  for (const value of bitmap) {
    let v = value;
    while (v) {
      count += v & 1;
      v >>= 1;
    }
  }
  return count === validSlots;
}

function presentSlots(header: BlockHeader, block: Uint8Array): number[] | null {
  if ((header.flags & FLAG_HAS_PRESENCE) === 0) {
    if (header.validSlots !== header.nominalSlots || header.presenceBitmapLength !== 0) {
      return null;
    }
    return Array.from({ length: header.nominalSlots }, (_, i) => i);
  }
  const bitmap = block.subarray(
    header.presenceBitmapOffset,
    header.presenceBitmapOffset + header.presenceBitmapLength,
  );
  if (!validatePresence(bitmap, header.nominalSlots, header.validSlots)) return null;
  const slots: number[] = [];
  for (let i = 0; i < header.nominalSlots; i++) {
    if ((bitmap[i >> 3]! >> (i & 7)) & 1) slots.push(i);
  }
  return slots;
}

function decodeNumericAbsolute(
  bytes: Uint8Array,
  offset: number,
  end: number,
  valueType: number,
): { value: bigint; consumed: number } | null {
  if (valueType === TYPE_SINT) return decodeSvar(bytes, offset, end);
  const decoded = decodeUvar(bytes, offset, end);
  if (!decoded) return null;
  if (valueType === TYPE_BOOL && decoded.value > 1n) return null;
  return decoded;
}

function bigintToNumber(value: bigint): number | null {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    return null;
  }
  return Number(value);
}

function decodeDeltaStream(
  payload: Uint8Array,
  count: number,
  definition: FieldDefinition,
): number[] | null {
  if (count === 0) return payload.length === 0 ? [] : null;
  const isSigned = definition.valueType === TYPE_SINT;
  const circular = (definition.flags & DEF_FLAG_CIRCULAR) !== 0;
  const modulus = definition.circularModulus;
  if (circular && (modulus == null || modulus === 0n)) return null;
  const values: number[] = [];
  let pos = 0;
  let previous = 0n;
  for (let i = 0; i < count; i++) {
    if (i === 0) {
      const decoded = decodeNumericAbsolute(payload, pos, payload.length, definition.valueType);
      if (!decoded) return null;
      if (circular && (decoded.value < 0n || decoded.value >= modulus!)) return null;
      previous = decoded.value;
      pos += decoded.consumed;
    } else {
      const decoded = decodeSvar(payload, pos, payload.length);
      if (!decoded) return null;
      pos += decoded.consumed;
      const delta = decoded.value;
      if (circular) {
        const m = modulus!;
        let current: bigint;
        if (delta >= 0n) {
          current = (previous + delta) % m;
        } else {
          const magnitude = -delta;
          current = (previous + m - (magnitude % m)) % m;
        }
        const forward = (current + m - previous) % m;
        const canonical = forward < (m + 1n) / 2n ? forward : forward - m;
        if (delta !== canonical) return null;
        previous = current;
      } else if (isSigned) {
        previous += delta;
      } else {
        previous += delta;
        if (previous < 0n) return null;
      }
    }
    const numeric = bigintToNumber(previous);
    if (numeric == null) return null;
    values.push(numeric);
  }
  if (pos !== payload.length) return null;
  return values;
}

function decodeRawStream(
  payload: Uint8Array,
  count: number,
  definition: FieldDefinition,
): number[] | null {
  if (count === 0) return payload.length === 0 ? [] : null;
  if (definition.valueType === TYPE_BYTES) return null;
  if (payload.length < 1) return null;
  const width = payload[0]!;
  if (width !== 1 && width !== 2 && width !== 4 && width !== 8) return null;
  if (payload.length !== 1 + count * width) return null;
  const view = viewOf(payload);
  const values: number[] = [];
  const signed = definition.valueType === TYPE_SINT;
  for (let i = 0; i < count; i++) {
    const offset = 1 + i * width;
    let value: number;
    if (width === 1) value = signed ? view.getInt8(offset) : view.getUint8(offset);
    else if (width === 2) value = signed ? view.getInt16(offset, true) : view.getUint16(offset, true);
    else if (width === 4) value = signed ? view.getInt32(offset, true) : view.getUint32(offset, true);
    else {
      const raw = signed ? view.getBigInt64(offset, true) : view.getBigUint64(offset, true);
      const numeric = bigintToNumber(raw);
      if (numeric == null) return null;
      value = numeric;
    }
    values.push(value);
  }
  return values;
}

function decodeChangeToSlots(
  payload: Uint8Array,
  valueCount: number,
  nominalSlots: number,
  definition: FieldDefinition,
): Array<number | undefined> | null {
  if (valueCount < 1) return null;
  let pos = 0;
  const initial = decodeNumericAbsolute(payload, pos, payload.length, definition.valueType);
  if (!initial) return null;
  pos += initial.consumed;
  const slots = Array<number | undefined>(nominalSlots).fill(undefined);
  const first = bigintToNumber(initial.value);
  if (first == null) return null;
  for (let i = 0; i < nominalSlots; i++) slots[i] = first;
  let eventSlot = 0;
  let events = 0;
  while (events < valueCount - 1) {
    const slotDelta = decodeUvar(payload, pos, payload.length);
    if (!slotDelta || slotDelta.value <= 0n) return null;
    pos += slotDelta.consumed;
    const next = decodeNumericAbsolute(payload, pos, payload.length, definition.valueType);
    if (!next) return null;
    pos += next.consumed;
    eventSlot += Number(slotDelta.value);
    if (eventSlot <= 0 || eventSlot >= nominalSlots) return null;
    const numeric = bigintToNumber(next.value);
    if (numeric == null) return null;
    for (let i = eventSlot; i < nominalSlots; i++) slots[i] = numeric;
    events += 1;
  }
  if (pos !== payload.length) return null;
  return slots;
}

function decodeConstValue(
  payload: Uint8Array,
  definition: FieldDefinition,
): number | null {
  const decoded = decodeNumericAbsolute(payload, 0, payload.length, definition.valueType);
  if (!decoded || decoded.consumed !== payload.length) return null;
  return bigintToNumber(decoded.value);
}

function applyScale(stored: number, scale: number): number {
  return stored * 10 ** scale;
}

function toKnots(stored: number, definition: FieldDefinition): number {
  const physical = applyScale(stored, definition.scale);
  if (definition.unitId === UNIT_METRE_PER_SECOND) return physical * KNOTS_PER_MPS;
  return physical;
}

function toDegrees(stored: number, definition: FieldDefinition): number {
  const physical = applyScale(stored, definition.scale);
  if (definition.unitId === UNIT_DEGREE || definition.unitId === 0) return physical;
  return physical;
}

function slotOffsetUs(slot: number, num: number, den: number): bigint {
  return (BigInt(slot) * BigInt(den) * 1_000_000n) / BigInt(num);
}

function usToMs(value: bigint): number {
  return Number(value / 1000n);
}

function decodeHeaderStreams(
  block: Uint8Array,
  header: BlockHeader,
): StreamDescriptor[] | null {
  if (header.directoryLength !== header.streamCount * DESCRIPTOR_SIZE) return null;
  if (header.payloadOffset !== 96 + header.directoryLength) return null;
  const descriptors: StreamDescriptor[] = [];
  let cursor = header.payloadOffset;
  let previousId = 0;
  for (let i = 0; i < header.streamCount; i++) {
    const offset = 96 + i * DESCRIPTOR_SIZE;
    const view = viewOf(block.subarray(offset, offset + DESCRIPTOR_SIZE));
    const descriptor: StreamDescriptor = {
      localFieldId: u16(view, 0),
      definitionVersion: u16(view, 2),
      codec: block[offset + 4]!,
      valueCount: u16(view, 6),
      payloadOffset: u32(view, 8),
      payloadLength: u32(view, 12),
    };
    if (
      descriptor.localFieldId === 0 ||
      descriptor.definitionVersion === 0 ||
      descriptor.localFieldId <= previousId ||
      descriptor.payloadOffset !== cursor ||
      block[offset + 5] !== 0
    ) {
      return null;
    }
    previousId = descriptor.localFieldId;
    cursor += descriptor.payloadLength;
    descriptors.push(descriptor);
  }
  if (cursor !== header.payloadOffset + header.payloadLength) return null;
  return descriptors;
}

function validateBlock(
  bytes: Uint8Array,
  offset: number,
  expectedSequence: number | null,
): { header: BlockHeader; block: Uint8Array } | null {
  const header = decodeBlockHeader(bytes, offset);
  if (!header) return null;
  if (expectedSequence != null && header.blockSequence !== expectedSequence) return null;
  if (
    header.blockLength < BLOCK_HEADER_SIZE + FOOTER_SIZE ||
    offset + header.blockLength > bytes.length
  ) {
    return null;
  }
  if (header.sampleRateNum === 0 || header.sampleRateDen === 0) return null;
  if (header.durationUs < 1 || header.durationUs > MAX_BLOCK_US) return null;
  if (header.streamCount > MAX_FIELDS) return null;
  const block = bytes.subarray(offset, offset + header.blockLength);
  const footer = block.subarray(header.blockLength - FOOTER_SIZE);
  const footerView = viewOf(footer);
  if (footerView.getUint32(12, true) !== MAGIC_LDCM) return null;
  if (footerView.getUint32(4, true) !== header.blockLength) return null;
  if (footerView.getUint32(8, true) !== header.blockSequence) return null;
  if (crc32c(block, 0, header.blockLength - FOOTER_SIZE) !== footerView.getUint32(0, true)) {
    return null;
  }
  const bitmapEnd = header.payloadOffset + header.payloadLength + header.presenceBitmapLength;
  if (bitmapEnd + FOOTER_SIZE !== header.blockLength) return null;
  if (decodeHeaderStreams(block, header) == null) return null;
  if (presentSlots(header, block) == null) return null;
  return { header, block };
}

function expandStreamToSlots(
  descriptor: StreamDescriptor,
  definition: FieldDefinition,
  payload: Uint8Array,
  header: BlockHeader,
  present: number[],
): Array<number | undefined> | null {
  const bySlot = Array<number | undefined>(header.nominalSlots).fill(undefined);
  if (definition.mode === MODE_STREAM) {
    if (descriptor.valueCount !== present.length) return null;
    let values: number[] | null = null;
    if (descriptor.codec === CODEC_DELTA_VARINT) {
      values = decodeDeltaStream(payload, descriptor.valueCount, definition);
    } else if (descriptor.codec === CODEC_RAW) {
      values = decodeRawStream(payload, descriptor.valueCount, definition);
    }
    if (!values) return null;
    for (let i = 0; i < present.length; i++) {
      bySlot[present[i]!] = values[i];
    }
    return bySlot;
  }
  if (definition.mode === MODE_CHANGE && descriptor.codec === CODEC_CHANGE_VARINT) {
    return decodeChangeToSlots(payload, descriptor.valueCount, header.nominalSlots, definition);
  }
  if (definition.mode === MODE_CONST && descriptor.codec === CODEC_CONST_VARINT) {
    if (descriptor.valueCount !== 1) return null;
    const value = decodeConstValue(payload, definition);
    if (value == null) return null;
    return bySlot.map(() => value);
  }
  if (definition.mode === MODE_CONST && descriptor.codec === CODEC_RAW) {
    const values = decodeRawStream(payload, 1, definition);
    if (!values || values.length !== 1) return null;
    return bySlot.map(() => values[0]);
  }
  return null;
}

function pickSemanticField(
  catalog: Map<number, FieldCatalogEntry>,
  semanticId: number,
): number | null {
  const matches = [...catalog.values()]
    .filter((entry) => entry.semanticId === semanticId)
    .sort((a, b) => a.localFieldId - b.localFieldId);
  return matches[0]?.localFieldId ?? null;
}

export function decodeLdcTrack(bytes: Uint8Array): DecodedLdcTrack {
  if (!looksLikeLdc(bytes)) {
    throw new Error('This file is not a valid LDC v1 recording.');
  }

  const superblock = selectMetadata(bytes);
  const tables = loadCatalogAndDefinitions(bytes, superblock);
  if (!tables) {
    throw new Error('The LDC field catalog or definitions are invalid.');
  }

  const latField = pickSemanticField(tables.catalog, SEM_LATITUDE);
  const lonField = pickSemanticField(tables.catalog, SEM_LONGITUDE);
  const speedField = pickSemanticField(tables.catalog, SEM_GROUND_SPEED);
  const cogField = pickSemanticField(tables.catalog, SEM_COG);
  const fixField = pickSemanticField(tables.catalog, SEM_FIX_TYPE);
  if (latField == null || lonField == null) {
    throw new Error('This LDC file does not contain latitude and longitude streams.');
  }

  const warnings: string[] = [];
  const points: DecodedLdcTrack['points'] = [];
  const blocks: Array<{ header: BlockHeader; block: Uint8Array }> = [];
  let offset = DATA_OFFSET;
  let expectedSequence: number | null = null;

  while (offset + BLOCK_HEADER_SIZE + FOOTER_SIZE <= bytes.length) {
    const validated = validateBlock(bytes, offset, expectedSequence);
    if (!validated) break;
    expectedSequence = validated.header.blockSequence + 1;
    offset += validated.header.blockLength;
    blocks.push(validated);
  }

  const utcAnchor = blocks.find((entry) => (entry.header.timeFlags & TIME_FLAG_UTC_VALID) !== 0)
    ?.header ?? null;
  let hadSourceTime = utcAnchor != null;
  let hadSourceSpeed = false;
  let hadSourceHeading = false;
  let skippedFix = 0;
  let estimatedUtc = false;

  for (const { header, block } of blocks) {
    const descriptors = decodeHeaderStreams(block, header);
    const present = presentSlots(header, block);
    if (!descriptors || !present) continue;

    const lat: Array<number | undefined> = Array(header.nominalSlots);
    const lon: Array<number | undefined> = Array(header.nominalSlots);
    const speed: Array<number | undefined> = Array(header.nominalSlots);
    const cog: Array<number | undefined> = Array(header.nominalSlots);
    const fix: Array<number | undefined> = Array(header.nominalSlots);

    for (const descriptor of descriptors) {
      const definition = tables.definitions.get(
        `${descriptor.localFieldId}:${descriptor.definitionVersion}`,
      );
      if (!definition) continue;
      const payload = block.subarray(
        descriptor.payloadOffset,
        descriptor.payloadOffset + descriptor.payloadLength,
      );
      const values = expandStreamToSlots(descriptor, definition, payload, header, present);
      if (!values) continue;
      if (descriptor.localFieldId === latField) {
        for (let i = 0; i < values.length; i++) {
          if (values[i] != null) lat[i] = toDegrees(values[i]!, definition);
        }
      } else if (descriptor.localFieldId === lonField) {
        for (let i = 0; i < values.length; i++) {
          if (values[i] != null) lon[i] = toDegrees(values[i]!, definition);
        }
      } else if (speedField != null && descriptor.localFieldId === speedField) {
        for (let i = 0; i < values.length; i++) {
          if (values[i] != null) speed[i] = toKnots(values[i]!, definition);
        }
      } else if (cogField != null && descriptor.localFieldId === cogField) {
        for (let i = 0; i < values.length; i++) {
          if (values[i] != null) cog[i] = toDegrees(values[i]!, definition);
        }
      } else if (fixField != null && descriptor.localFieldId === fixField) {
        for (let i = 0; i < values.length; i++) fix[i] = values[i];
      }
    }

    for (let slot = 0; slot < header.nominalSlots; slot++) {
      const slotLat = lat[slot];
      const slotLon = lon[slot];
      if (slotLat == null || slotLon == null) continue;
      if (!Number.isFinite(slotLat) || !Number.isFinite(slotLon)) continue;
      if (slotLat < -90 || slotLat > 90 || slotLon < -180 || slotLon >= 180) continue;
      const slotFix = fix[slot];
      if (slotFix === 0 || slotFix === 5) {
        skippedFix += 1;
        continue;
      }
      const offsetUs = slotOffsetUs(slot, header.sampleRateNum, header.sampleRateDen);
      const monoUs = header.startMonoUs + offsetUs;
      const utcValid = (header.timeFlags & TIME_FLAG_UTC_VALID) !== 0;
      let timestampMs: number;
      if (utcValid) {
        timestampMs = usToMs(header.startUtcUs + offsetUs);
      } else if (utcAnchor) {
        timestampMs = usToMs(utcAnchor.startUtcUs + (monoUs - utcAnchor.startMonoUs));
        estimatedUtc = true;
      } else {
        timestampMs = usToMs(monoUs);
      }
      const point: DecodedLdcTrack['points'][number] = {
        t: timestampMs,
        lat: slotLat,
        lon: slotLon,
      };
      if (speed[slot] != null) {
        point.s = speed[slot];
        hadSourceSpeed = true;
      }
      if (cog[slot] != null) {
        point.h = cog[slot];
        hadSourceHeading = true;
      }
      points.push(point);
    }
  }

  if (points.length === 0) {
    throw new Error('No usable latitude/longitude samples were found in this LDC file.');
  }
  if (!hadSourceTime && points.length > 0) {
    const origin = points[0]!.t ?? 0;
    for (const point of points) {
      point.t = 1_000_000_000_000 + Math.max(0, (point.t ?? 0) - origin);
    }
  }
  if (skippedFix > 0) {
    warnings.push(`Skipped ${skippedFix} LDC samples without a usable GNSS fix.`);
  }
  if (!hadSourceTime) {
    warnings.push('This LDC file has no valid UTC timestamps; time is taken from the device clock.');
  } else if (estimatedUtc) {
    warnings.push('Some LDC samples had no UTC stamp; those times were estimated from the device clock.');
  }

  return {
    points,
    hadSourceTime,
    hadSourceSpeed,
    hadSourceHeading,
    warnings,
  };
}
