#include "sailball/ldc.h"
#include "sailball/common.h"
#include <limits.h>
#include <string.h>

#define LDC_FLAG_HAS_PRESENCE 0x0001u
#define LDC_FLAG_TIME_DISCONTINUITY 0x0002u

static bool rate_is_reduced(uint16_t n, uint16_t d)
{
    if (n == 0 || d == 0) return false;
    uint16_t a = n, b = d;
    while (b != 0) { uint16_t r = a % b; a = b; b = r; }
    return a == 1;
}

bool sb_ldc_header_encode(const sb_ldc_block_header_t *h, uint8_t out[SB_LDC_BLOCK_HEADER_SIZE])
{
    if (h == NULL || out == NULL || h->duration_us == 0 || h->duration_us > SB_LDC_MAX_BLOCK_US ||
        !rate_is_reduced(h->sample_rate_num, h->sample_rate_den) || h->stream_count > SB_LDC_MAX_FIELDS ||
        h->directory_length != (uint16_t)(h->stream_count * SB_LDC_DESCRIPTOR_SIZE) ||
        h->payload_offset != SB_LDC_BLOCK_HEADER_SIZE + h->directory_length || h->valid_slots > h->nominal_slots ||
        (h->flags & ~(LDC_FLAG_HAS_PRESENCE | LDC_FLAG_TIME_DISCONTINUITY)) != 0) return false;
    uint64_t numerator = (uint64_t)h->duration_us * h->sample_rate_num;
    uint64_t denominator = UINT64_C(1000000) * h->sample_rate_den;
    uint64_t slots = (numerator + denominator - 1) / denominator;
    if (slots != h->nominal_slots || slots > UINT16_MAX) return false;
    if ((h->time_flags & 1u) == 0) {
        if (h->start_utc_us != 0 || h->time_source != 0 || h->time_accuracy_us != UINT32_MAX) return false;
    } else if (h->time_source == 0 || h->time_source > 5) return false;
    if ((h->time_flags & 2u) != 0 && (h->time_flags & 1u) == 0) return false;
    if ((h->time_flags & 0xFCu) != 0) return false;
    if ((h->flags & LDC_FLAG_HAS_PRESENCE) == 0) {
        if (h->valid_slots != h->nominal_slots || h->presence_bitmap_offset != 0 || h->presence_bitmap_length != 0) return false;
    } else if (h->presence_bitmap_length != (uint16_t)((h->nominal_slots + 7u) / 8u) ||
               h->presence_bitmap_offset != h->payload_offset + h->payload_length) return false;
    uint64_t block_length = (uint64_t)h->payload_offset + h->payload_length + h->presence_bitmap_length + SB_LDC_FOOTER_SIZE;
    if (block_length != h->block_length || block_length > UINT32_MAX) return false;
    memset(out, 0, SB_LDC_BLOCK_HEADER_SIZE);
    memcpy(out, "LDBK", 4); sb_write_le16(out + 4, 1); sb_write_le16(out + 6, h->flags);
    sb_write_le32(out + 8, h->block_sequence); sb_write_le32(out + 12, h->block_length);
    sb_write_le64(out + 16, h->start_mono_us); sb_write_le64(out + 24, (uint64_t)h->start_utc_us);
    sb_write_le16(out + 32, h->sample_rate_num); sb_write_le16(out + 34, h->sample_rate_den);
    sb_write_le16(out + 36, h->nominal_slots); sb_write_le16(out + 38, h->valid_slots);
    sb_write_le16(out + 40, h->stream_count); sb_write_le16(out + 42, h->directory_length);
    sb_write_le32(out + 44, SB_LDC_BLOCK_HEADER_SIZE); sb_write_le32(out + 48, h->payload_offset);
    sb_write_le32(out + 52, h->payload_length); sb_write_le32(out + 56, h->presence_bitmap_offset);
    sb_write_le16(out + 60, h->presence_bitmap_length); out[62] = h->time_source; out[63] = h->time_flags;
    sb_write_le32(out + 64, h->time_accuracy_us); sb_write_le32(out + 72, h->duration_us);
    sb_write_le32(out + 68, sb_crc32c(out, SB_LDC_BLOCK_HEADER_SIZE));
    return true;
}

bool sb_ldc_header_decode(const uint8_t in[SB_LDC_BLOCK_HEADER_SIZE], sb_ldc_block_header_t *h)
{
    if (in == NULL || h == NULL || memcmp(in, "LDBK", 4) != 0 || sb_read_le16(in + 4) != 1 || sb_read_le32(in + 44) != 96u) return false;
    uint8_t copy[SB_LDC_BLOCK_HEADER_SIZE]; memcpy(copy, in, sizeof(copy));
    uint32_t stored_crc = sb_read_le32(copy + 68); memset(copy + 68, 0, 4);
    if (stored_crc != sb_crc32c(copy, sizeof(copy))) return false;
    for (size_t i = 76; i < 96; ++i) if (in[i] != 0) return false;
    memset(h, 0, sizeof(*h));
    h->flags = sb_read_le16(in + 6); h->block_sequence = sb_read_le32(in + 8); h->block_length = sb_read_le32(in + 12);
    h->start_mono_us = sb_read_le64(in + 16); h->start_utc_us = (int64_t)sb_read_le64(in + 24);
    h->sample_rate_num = sb_read_le16(in + 32); h->sample_rate_den = sb_read_le16(in + 34);
    h->nominal_slots = sb_read_le16(in + 36); h->valid_slots = sb_read_le16(in + 38);
    h->stream_count = sb_read_le16(in + 40); h->directory_length = sb_read_le16(in + 42);
    h->payload_offset = sb_read_le32(in + 48); h->payload_length = sb_read_le32(in + 52);
    h->presence_bitmap_offset = sb_read_le32(in + 56); h->presence_bitmap_length = sb_read_le16(in + 60);
    h->time_source = in[62]; h->time_flags = in[63]; h->time_accuracy_us = sb_read_le32(in + 64);
    h->duration_us = sb_read_le32(in + 72);
    return sb_ldc_header_encode(h, copy);
}

bool sb_ldc_descriptor_encode(const sb_ldc_descriptor_t *d, uint8_t out[SB_LDC_DESCRIPTOR_SIZE])
{
    if (d == NULL || out == NULL || d->local_field_id == 0 || d->definition_version == 0 || d->flags != 0) return false;
    sb_write_le16(out, d->local_field_id); sb_write_le16(out + 2, d->definition_version);
    out[4] = d->codec; out[5] = d->flags; sb_write_le16(out + 6, d->value_count);
    sb_write_le32(out + 8, d->payload_offset); sb_write_le32(out + 12, d->payload_length);
    return true;
}

bool sb_ldc_descriptor_decode(const uint8_t in[SB_LDC_DESCRIPTOR_SIZE], sb_ldc_descriptor_t *d)
{
    if (in == NULL || d == NULL) return false;
    d->local_field_id = sb_read_le16(in); d->definition_version = sb_read_le16(in + 2);
    d->codec = in[4]; d->flags = in[5]; d->value_count = sb_read_le16(in + 6);
    d->payload_offset = sb_read_le32(in + 8); d->payload_length = sb_read_le32(in + 12);
    return d->local_field_id != 0 && d->definition_version != 0 && d->flags == 0;
}

bool sb_ldc_presence_validate(const uint8_t *bitmap, size_t length, uint16_t slots, uint16_t valid_slots)
{
    if (bitmap == NULL || length != ((size_t)slots + 7u) / 8u) return false;
    if (slots % 8u != 0 && length != 0 && (bitmap[length - 1] & (uint8_t)(0xFFu << (slots % 8u))) != 0) return false;
    uint16_t count = 0;
    for (size_t i = 0; i < length; ++i) {
        uint8_t v = bitmap[i];
        for (unsigned b = 0; b < 8; ++b) count += (v >> b) & 1u;
    }
    return count == valid_slots;
}

bool sb_ldc_block_validate(const uint8_t *block, size_t length, uint32_t expected_sequence)
{
    if (block == NULL || length < SB_LDC_BLOCK_HEADER_SIZE + SB_LDC_FOOTER_SIZE) return false;
    sb_ldc_block_header_t h;
    if (!sb_ldc_header_decode(block, &h) || h.block_sequence != expected_sequence || h.block_length != length) return false;
    if (h.directory_length != h.stream_count * SB_LDC_DESCRIPTOR_SIZE || h.payload_offset != 96u + h.directory_length) return false;
    uint64_t dir_end = (uint64_t)96u + h.directory_length;
    uint64_t payload_end = (uint64_t)h.payload_offset + h.payload_length;
    uint64_t bitmap_end = payload_end + h.presence_bitmap_length;
    if (dir_end > length || payload_end > length || bitmap_end + 16u != length) return false;
    uint32_t cursor = h.payload_offset;
    uint16_t previous_id = 0;
    for (uint16_t i = 0; i < h.stream_count; ++i) {
        sb_ldc_descriptor_t d;
        if (!sb_ldc_descriptor_decode(block + 96u + (size_t)i * 16u, &d) || d.local_field_id <= previous_id || d.payload_offset != cursor) return false;
        previous_id = d.local_field_id;
        uint64_t next_cursor=(uint64_t)cursor+d.payload_length;
        if(next_cursor>UINT32_MAX)return false;
        cursor=(uint32_t)next_cursor;
    }
    if (cursor != payload_end) return false;
    if (h.presence_bitmap_length != 0 && !sb_ldc_presence_validate(block + payload_end, h.presence_bitmap_length, h.nominal_slots, h.valid_slots)) return false;
    if (h.presence_bitmap_length == 0 && h.valid_slots != h.nominal_slots) return false;
    const uint8_t *footer = block + length - 16u;
    if (sb_read_le32(footer + 4) != h.block_length || sb_read_le32(footer + 8) != h.block_sequence || memcmp(footer + 12, "LDCM", 4) != 0) return false;
    return sb_read_le32(footer) == sb_crc32c(block, length - 16u);
}

bool sb_ldc_block_set_sequence(uint8_t *block, size_t length, uint32_t sequence)
{
    if (block == NULL || length < SB_LDC_BLOCK_HEADER_SIZE + SB_LDC_FOOTER_SIZE ||
        !sb_ldc_block_validate(block, length, sb_read_le32(block + 8))) return false;
    sb_ldc_block_header_t header;
    if (!sb_ldc_header_decode(block, &header)) return false;
    header.block_sequence = sequence;
    if (!sb_ldc_header_encode(&header, block)) return false;
    uint8_t *footer = block + length - SB_LDC_FOOTER_SIZE;
    sb_write_le32(footer + 8, sequence);
    sb_write_le32(footer, sb_crc32c(block, length - SB_LDC_FOOTER_SIZE));
    return sb_ldc_block_validate(block, length, sequence);
}

bool sb_ldc_block_commit(const sb_ldc_commit_io_t *io, uint64_t offset, const uint8_t *block,
                         size_t length, uint32_t expected_sequence)
{
    if (io==NULL||io->write==NULL||io->flush==NULL||block==NULL||length<SB_LDC_FOOTER_SIZE||
        offset>UINT64_MAX-length||!sb_ldc_block_validate(block,length,expected_sequence)) return false;
    if (!io->write(io->context,offset,block,length-4u)||!io->flush(io->context)) return false;
    if (!io->write(io->context,offset+length-4u,block+length-4u,4u)||!io->flush(io->context)) return false;
    return true;
}

bool sb_ldc_delta_encode(const int64_t *signed_values, const uint64_t *unsigned_values, size_t count, bool is_signed, bool circular,
                         uint64_t modulus, uint8_t *out, size_t capacity, size_t *written)
{
    if ((count != 0 && ((is_signed ? signed_values == NULL : unsigned_values == NULL) || out == NULL)) || written == NULL ||
        (circular && (modulus == 0 || modulus > INT64_MAX))) return false;
    size_t cursor = 0;
    for (size_t i = 0; i < count; ++i) {
        uint8_t tmp[10]; size_t n;
        uint64_t current_u = is_signed ? 0 : unsigned_values[i];
        int64_t current_s = is_signed ? signed_values[i] : 0;
        uint64_t previous_u = is_signed ? 0 : (i ? unsigned_values[i-1] : 0);
        int64_t previous_s = is_signed ? (i ? signed_values[i-1] : 0) : 0;
        if (circular && ((is_signed && current_s < 0) || (!is_signed && current_u >= modulus) ||
                         (is_signed && (uint64_t)current_s >= modulus))) return false;
        if (i == 0) {
            if (is_signed) { if (!sb_ldc_svar_encode(current_s, tmp, &n)) return false; }
            else { if (!sb_ldc_uvar_encode(current_u, tmp, &n)) return false; }
        } else {
            int64_t delta;
            if (circular) {
                uint64_t a = is_signed ? (uint64_t)previous_s : previous_u;
                uint64_t b = is_signed ? (uint64_t)current_s : current_u;
                uint64_t r = (b + modulus - a) % modulus;
                delta = r < (modulus + 1u) / 2u ? (int64_t)r : (int64_t)r - (int64_t)modulus;
            } else if (is_signed) {
                if ((current_s > 0 && previous_s < INT64_MIN + current_s) ||
                    (current_s < 0 && previous_s > INT64_MAX + current_s)) return false;
                delta = current_s - previous_s;
            } else if (current_u >= previous_u) {
                uint64_t difference = current_u - previous_u;
                if (difference > INT64_MAX) return false;
                delta = (int64_t)difference;
            } else {
                uint64_t difference = previous_u - current_u;
                if (difference > (UINT64_C(1) << 63)) return false;
                delta = difference == (UINT64_C(1) << 63) ? INT64_MIN : -(int64_t)difference;
            }
            if (!sb_ldc_svar_encode(delta, tmp, &n)) return false;
        }
        if (n > capacity - cursor) return false;
        memcpy(out + cursor, tmp, n); cursor += n;
    }
    *written = cursor;
    return true;
}

bool sb_ldc_delta_decode(const uint8_t *input, size_t length, size_t count, bool is_signed,
                         bool circular, uint64_t modulus, int64_t *signed_values,
                         uint64_t *unsigned_values)
{
    if ((count != 0 && input == NULL) || (is_signed ? signed_values == NULL : unsigned_values == NULL) ||
        (circular && (modulus == 0 || modulus > INT64_MAX))) return false;
    size_t pos = 0;
    int64_t previous = 0;
    for (size_t i = 0; i < count; ++i) {
        size_t n; int64_t current = 0;
        if (i == 0) {
            if (is_signed) { if (!sb_ldc_svar_decode(input + pos, length - pos, &current, &n)) return false; }
            else {
                uint64_t v; if (!sb_ldc_uvar_decode(input + pos, length - pos, &v, &n)) return false;
                current = 0;
                pos += n;
                previous = 0;
                if (circular && v >= modulus) return false;
                if (unsigned_values != NULL) unsigned_values[i] = v;
                continue;
            }
        } else {
            int64_t delta;
            if (!sb_ldc_svar_decode(input + pos, length - pos, &delta, &n)) return false;
            if (circular) {
                uint64_t previous_value = is_signed ? (uint64_t)previous : unsigned_values[i-1];
                if ((is_signed && previous < 0) || previous_value >= modulus) return false;
                uint64_t current_value;
                if (delta >= 0) current_value = (previous_value + (uint64_t)delta) % modulus;
                else { uint64_t magnitude = (uint64_t)(-(delta + 1)) + 1u; uint64_t reduced = magnitude % modulus; current_value = (previous_value + modulus - reduced) % modulus; }
                if (is_signed) current = (int64_t)current_value;
                else if (unsigned_values != NULL) unsigned_values[i] = current_value;
                uint64_t d = (current_value + modulus - previous_value) % modulus;
                int64_t canonical = d < (modulus + 1u) / 2u ? (int64_t)d : (int64_t)d - (int64_t)modulus;
                if (delta != canonical) return false;
            } else {
                if (is_signed) {
                    if ((delta > 0 && previous > INT64_MAX - delta) || (delta < 0 && previous < INT64_MIN - delta)) return false;
                    current = previous + delta;
                } else {
                    uint64_t previous_value = unsigned_values[i-1], current_value;
                    if (delta >= 0) { if (UINT64_MAX - previous_value < (uint64_t)delta) return false; current_value = previous_value + (uint64_t)delta; }
                    else { uint64_t magnitude=(uint64_t)(-(delta+1))+1u; if (previous_value < magnitude) return false; current_value=previous_value-magnitude; }
                    unsigned_values[i]=current_value;
                }
            }
        }
        pos += n; previous = current;
        if (is_signed) signed_values[i] = current;
    }
    return pos == length;
}

static bool valid_state(const sb_ldc_metadata_state_t *s)
{
    if (s == NULL || s->generation == 0 || s->field_count > SB_LDC_MAX_FIELDS || s->definition_count > SB_LDC_MAX_DEFINITIONS ||
        s->auxiliary_bytes_used > 2048 || s->active_superblock > 1) return false;
    uint32_t seen = 0;
    for (unsigned i = 0; i < SB_LDC_LOGICAL_PAGE_COUNT; ++i) {
        if (s->page_map[i] >= SB_LDC_PHYSICAL_PAGE_COUNT) return false;
        uint32_t bit = UINT32_C(1) << s->page_map[i]; if (seen & bit) return false; seen |= bit;
    }
    return true;
}

bool sb_ldc_superblock_encode(const sb_ldc_metadata_state_t *s, uint8_t out[SB_LDC_SUPERBLOCK_SIZE])
{
    if (!valid_state(s) || out == NULL) return false;
    memset(out, 0, SB_LDC_SUPERBLOCK_SIZE); memcpy(out, "LDC1", 4);
    sb_write_le16(out + 4, 1); sb_write_le16(out + 6, 0); sb_write_le64(out + 8, s->generation);
    sb_write_le32(out + 16, SB_LDC_METADATA_SIZE); sb_write_le32(out + 20, SB_LDC_DATA_OFFSET);
    memcpy(out + 24, s->ldc_file_session_id, 16); sb_write_le64(out + 40, s->device_id);
    sb_write_le64(out + 48, s->created_mono_us); sb_write_le64(out + 56, (uint64_t)s->created_utc_us);
    sb_write_le64(out + 64, (uint64_t)s->first_valid_utc_us); sb_write_le32(out + 72, s->flags);
    sb_write_le16(out + 76, s->field_count); sb_write_le16(out + 78, s->definition_count);
    sb_write_le16(out + 80, s->auxiliary_bytes_used); sb_write_le16(out + 82, SB_LDC_LOGICAL_PAGE_COUNT);
    for (unsigned i = 0; i < SB_LDC_LOGICAL_PAGE_COUNT; ++i) sb_write_le16(out + 92 + 2u * i, s->page_map[i]);
    for (unsigned i = 0; i < SB_LDC_LOGICAL_PAGE_COUNT; ++i) sb_write_le32(out + 140 + 4u * i, s->page_crc32c[i]);
    sb_write_le32(out + 508, sb_crc32c(out, 508));
    return true;
}

bool sb_ldc_superblock_decode(const uint8_t in[SB_LDC_SUPERBLOCK_SIZE], sb_ldc_metadata_state_t *s)
{
    if (in == NULL || s == NULL || memcmp(in, "LDC1", 4) != 0 || sb_read_le16(in + 4) != 1 || sb_read_le16(in + 6) != 0 ||
        sb_read_le32(in + 16) != SB_LDC_METADATA_SIZE || sb_read_le32(in + 20) != SB_LDC_DATA_OFFSET ||
        sb_read_le16(in + 82) != SB_LDC_LOGICAL_PAGE_COUNT || sb_read_le32(in + 84) != 0 ||
        sb_read_le32(in + 88) != 0 || sb_read_le32(in + 508) != sb_crc32c(in, 508)) return false;
    for (size_t i = 84; i < 92; ++i) if (in[i] != 0) return false;
    for (size_t i = 236; i < 508; ++i) if (in[i] != 0) return false;
    memset(s, 0, sizeof(*s)); s->generation = sb_read_le64(in + 8); s->active_superblock = 0;
    memcpy(s->ldc_file_session_id, in + 24, 16); s->device_id = sb_read_le64(in + 40);
    uint8_t any_session_byte = 0;
    for (unsigned i = 0; i < sizeof(s->ldc_file_session_id); ++i) any_session_byte |= s->ldc_file_session_id[i];
    if (any_session_byte == 0) return false;
    s->created_mono_us = sb_read_le64(in + 48); s->created_utc_us = (int64_t)sb_read_le64(in + 56);
    s->first_valid_utc_us = (int64_t)sb_read_le64(in + 64); s->flags = sb_read_le32(in + 72);
    if ((s->flags & ~3u) != 0 || ((s->flags & 1u) == 0 && s->created_utc_us != 0) || ((s->flags & 2u) == 0 && s->first_valid_utc_us != 0)) return false;
    s->field_count = sb_read_le16(in + 76); s->definition_count = sb_read_le16(in + 78); s->auxiliary_bytes_used = sb_read_le16(in + 80);
    for (unsigned i = 0; i < SB_LDC_LOGICAL_PAGE_COUNT; ++i) s->page_map[i] = sb_read_le16(in + 92 + 2u * i);
    for (unsigned i = 0; i < SB_LDC_LOGICAL_PAGE_COUNT; ++i) s->page_crc32c[i] = sb_read_le32(in + 140 + 4u * i);
    return valid_state(s);
}

bool sb_ldc_metadata_initialize(const sb_ldc_io_t *io, sb_ldc_metadata_state_t *s,
                                const uint8_t session_id[16], uint64_t device_id, uint64_t created_mono_us)
{
    if (io == NULL || io->write == NULL || io->flush == NULL || s == NULL || session_id == NULL) return false;
    uint8_t any_session_byte = 0;
    for (unsigned i = 0; i < 16; ++i) any_session_byte |= session_id[i];
    if (any_session_byte == 0) return false;
    uint8_t zero[SB_LDC_PAGE_SIZE] = {0};
    for (unsigned p = 0; p < SB_LDC_PHYSICAL_PAGE_COUNT; ++p)
        if (!io->write(io->context, 0x400u + p * 512u, zero, sizeof(zero))) return false;
    memset(s, 0, sizeof(*s)); s->generation = 1; memcpy(s->ldc_file_session_id, session_id, 16);
    s->device_id = device_id; s->created_mono_us = created_mono_us;
    for (unsigned i = 0; i < SB_LDC_LOGICAL_PAGE_COUNT; ++i) { s->page_map[i] = (uint16_t)i; s->page_crc32c[i] = sb_crc32c(zero, sizeof(zero)); }
    uint8_t raw[SB_LDC_SUPERBLOCK_SIZE];
    if (!sb_ldc_superblock_encode(s, raw) || !io->write(io->context, 0, raw, sizeof(raw)) ||
        !io->write(io->context, SB_LDC_SUPERBLOCK_SIZE, raw, sizeof(raw)) || !io->flush(io->context)) return false;
    return true;
}

static bool read_logical(const sb_ldc_io_t *io,const sb_ldc_metadata_state_t *s,uint32_t offset,void *data,size_t length)
{
    if(io==NULL||io->read==NULL||offset<0x400u||(uint64_t)offset+length>0x400u+SB_LDC_LOGICAL_PAGE_COUNT*SB_LDC_PAGE_SIZE)return false;
    uint8_t *out=data;size_t done=0;
    while(done<length){uint32_t logical=offset+(uint32_t)done;uint32_t relative=logical-0x400u;unsigned page=relative/SB_LDC_PAGE_SIZE;size_t in_page=relative%SB_LDC_PAGE_SIZE;size_t part=SB_LDC_PAGE_SIZE-in_page;if(part>length-done)part=length-done;
        uint32_t physical=0x400u+(uint32_t)s->page_map[page]*SB_LDC_PAGE_SIZE+(uint32_t)in_page;
        if(!io->read(io->context,physical,out+done,part)) return false;
        done+=part;
    }
    return true;
}

static bool valid_utf8_no_nul(const uint8_t *p,size_t n)
{
    size_t i=0;while(i<n){uint8_t c=p[i];if(c==0)return false;if(c<0x80){++i;continue;}
        unsigned extra=(c>=0xF0&&c<=0xF4)?3u:(c>=0xE0&&c<=0xEF)?2u:(c>=0xC2&&c<=0xDF)?1u:99u;
        if(extra==99||i+extra>=n) return false;
        uint32_t cp=c&((1u<<(6u-extra))-1u);
        for(unsigned j=1;j<=extra;++j){uint8_t cc=p[i+j];if((cc&0xC0)!=0x80)return false;cp=(cp<<6)|(cc&0x3F);}
        if((extra==1&&cp<0x80)||(extra==2&&cp<0x800)||(extra==3&&cp<0x10000)||cp>0x10FFFF||(cp>=0xD800&&cp<=0xDFFF)) return false;
        i+=extra+1u;
    }
    return true;
}

static bool pool_range_valid(const sb_ldc_metadata_state_t *s,uint32_t offset,uint16_t length)
{
    return length==0?offset==0:(offset>=0x2C00u&&(uint64_t)offset+length<=0x2C00u+s->auxiliary_bytes_used);
}

static bool validate_name(const sb_ldc_io_t *io,const sb_ldc_metadata_state_t *s,uint32_t offset,uint16_t length)
{
    if(!pool_range_valid(s,offset,length)) return false;
    if(length==0) return true;
    uint8_t *name=io->workspace->bytes;return length<=sizeof(io->workspace->bytes)&&read_logical(io,s,offset,name,length)&&valid_utf8_no_nul(name,length);
}

static bool validate_aux_bundle(const sb_ldc_io_t *io,const sb_ldc_metadata_state_t *s,uint32_t offset,uint16_t length,
                                uint16_t enum_table,uint16_t unit_id,uint8_t value_type,uint16_t flags)
{
    if(!pool_range_valid(s,offset,length)) return false;
    if(length==0) return enum_table!=0xFFFFu&&(flags&1u)==0&&
        !((unit_id==0&&value_type!=2&&value_type!=3));
    uint8_t *bytes=io->workspace->bytes;if(length>sizeof(io->workspace->bytes)||!read_logical(io,s,offset,bytes,length))return false;
    bool circular=false,unit_expression=false,local_enum=false;size_t p=0;
    while(p<length){if(length-p<4)return false;uint16_t type=sb_read_le16(bytes+p),n=sb_read_le16(bytes+p+2);p+=4;if(n>length-p)return false;const uint8_t *payload=bytes+p;
        if(type==1){if(circular||n!=8)return false;circular=true;uint64_t modulus=sb_read_le64(payload);if(modulus==0||modulus>INT64_MAX)return false;}
        else if(type==2){if(unit_expression||n==0||!valid_utf8_no_nul(payload,n))return false;unit_expression=true;}
        else if(type==3){if(local_enum||n<2)return false;local_enum=true;uint16_t count=sb_read_le16(payload);size_t q=2;uint64_t *values=io->workspace->enum_values;if(count>256)return false;
            for(uint16_t i=0;i<count;++i){if(n-q<10)return false;uint64_t value=sb_read_le64(payload+q);uint16_t label_length=sb_read_le16(payload+q+8);q+=10;if(label_length>n-q||!valid_utf8_no_nul(payload+q,label_length))return false;for(uint16_t j=0;j<i;++j)if(values[j]==value)return false;values[i]=value;q+=label_length;}if(q!=n)return false;}
        p+=n;
    }
    if(((flags&1u)!=0)!=circular||(enum_table==0xFFFFu)!=local_enum)return false;
    if((unit_id==0&&value_type!=2&&value_type!=3)&&!unit_expression)return false;
    return true;
}

static bool validate_field_record(const sb_ldc_io_t *io,const sb_ldc_metadata_state_t *s,uint16_t i,
                                  uint16_t *field_ids,uint16_t *field_semantics)
{
    uint8_t record[32];uint32_t offset=0x400u+(uint32_t)i*32u;
    if(!read_logical(io,s,offset,record,sizeof(record)))return false;
    if(i>=s->field_count){for(unsigned j=0;j<32;++j)if(record[j]!=0)return false;return true;}
    uint16_t id=sb_read_le16(record),semantic=sb_read_le16(record+2);
    if(id==0||sb_read_le16(record+10)!=0||sb_read_le32(record+28)!=sb_crc32c(record,28))return false;
    for(unsigned j=12;j<28;++j)if(record[j]!=0)return false;
    for(uint16_t j=0;j<i;++j)if(field_ids[j]==id)return false;
    uint32_t name_offset=sb_read_le32(record+4);uint16_t name_length=sb_read_le16(record+8);
    if(!validate_name(io,s,name_offset,name_length))return false;
    field_ids[i]=id;field_semantics[i]=semantic;return true;
}

static bool validate_definition_record(const sb_ldc_io_t *io,const sb_ldc_metadata_state_t *s,uint16_t i,
                                       uint16_t *field_ids,uint16_t *field_semantics,
                                       uint16_t *def_fields,uint16_t *def_versions)
{
    uint8_t record[32];uint32_t offset=0xC00u+(uint32_t)i*32u;
    if(!read_logical(io,s,offset,record,sizeof(record)))return false;
    if(i>=s->definition_count){for(unsigned j=0;j<32;++j)if(record[j]!=0)return false;return true;}
    uint16_t field=sb_read_le16(record),version=sb_read_le16(record+2),semantic=sb_read_le16(record+4),flags=sb_read_le16(record+12),enum_table=sb_read_le16(record+14);
    uint8_t mode=record[6],type=record[7],codec=record[11];int8_t scale=(int8_t)record[10];uint16_t unit=sb_read_le16(record+8);
    if(field==0||version==0||mode>2||type>4||(flags&~1u)!=0||sb_read_le32(record+28)!=sb_crc32c(record,28))return false;
    int catalog=-1;for(uint16_t j=0;j<s->field_count;++j)if(field_ids[j]==field){catalog=j;break;}
    if(catalog<0||field_semantics[catalog]!=semantic)return false;
    for(uint16_t j=0;j<i;++j)if(def_fields[j]==field&&def_versions[j]==version)return false;
    if((type==2||type==3)&&scale!=0)return false;
    if(type==4&&(scale!=0||unit!=0||(flags&1u)!=0))return false;
    if((flags&1u)!=0&&(type>1||type==2||type==3||type==4))return false;
    if(type!=3&&enum_table!=0)return false;
    if(enum_table!=0&&enum_table!=1&&enum_table!=0xFFFFu)return false;
    if(type==4&&codec!=0)return false;
    if(codec>3)return false;
    if(codec==0&&mode!=0&&mode!=2)return false;
    if(codec==1&&(mode!=0||type>=2))return false;
    /* ENUM is an integer-valued type and the frozen GNSS profile uses
     * CHANGE_VARINT for fix_type (mode CHANGE, type ENUM). */
    if(codec==2&&(mode!=1||(type>=2&&type!=3)))return false;
    if(codec==3&&(mode!=2||type>=2))return false;
    uint32_t name_offset=sb_read_le32(record+16),aux_offset=sb_read_le32(record+24);
    uint16_t name_length=sb_read_le16(record+20),aux_length=sb_read_le16(record+22);
    if(!validate_name(io,s,name_offset,name_length)||
       !validate_aux_bundle(io,s,aux_offset,aux_length,enum_table,unit,type,flags))return false;
    def_fields[i]=field;def_versions[i]=version;return true;
}

static bool validate_auxiliary_pool_page(const sb_ldc_io_t *io,const sb_ldc_metadata_state_t *s,unsigned page)
{
    uint8_t *pool_page=io->workspace->page;
    if(page<20u||page>=24u||!read_logical(io,s,0x400u+page*SB_LDC_PAGE_SIZE,pool_page,SB_LDC_PAGE_SIZE))return false;
    uint32_t page_offset=(page-20u)*SB_LDC_PAGE_SIZE;
    for(unsigned i=0;i<SB_LDC_PAGE_SIZE;++i)
        if(page_offset+i>=s->auxiliary_bytes_used&&pool_page[i]!=0)return false;
    return true;
}

static bool validate_metadata_records(const sb_ldc_io_t *io,const sb_ldc_metadata_state_t *s)
{
    uint16_t *field_ids=io->workspace->field_ids,*field_semantics=io->workspace->field_semantics;
    uint16_t *def_fields=io->workspace->def_fields,*def_versions=io->workspace->def_versions;
    for(uint16_t i=0;i<SB_LDC_MAX_FIELDS;++i)
        if(!validate_field_record(io,s,i,field_ids,field_semantics))return false;
    for(uint16_t i=0;i<SB_LDC_MAX_DEFINITIONS;++i)
        if(!validate_definition_record(io,s,i,field_ids,field_semantics,def_fields,def_versions))return false;
    for(unsigned page=20;page<24;++page)if(!validate_auxiliary_pool_page(io,s,page))return false;
    return true;
}

void sb_ldc_metadata_load_begin(sb_ldc_metadata_load_ctx_t *context)
{
    if(context!=NULL)memset(context,0,sizeof(*context));
}

static void metadata_load_next_candidate(sb_ldc_metadata_load_ctx_t *context)
{
    ++context->candidate;context->cursor=0;context->phase=0;
    if(context->candidate<2u)return;
    context->complete=true;
    if(!context->candidate_valid[0]&&!context->candidate_valid[1])return;
    if(context->candidate_valid[0]&&context->candidate_valid[1]&&
       context->candidates[0].generation==context->candidates[1].generation&&
       memcmp(context->raw[0],context->raw[1],SB_LDC_SUPERBLOCK_SIZE)!=0)return;
    unsigned selected=(!context->candidate_valid[1]||
        (context->candidate_valid[0]&&context->candidates[0].generation>=context->candidates[1].generation))?0u:1u;
    context->result_valid=true;context->cursor=(uint16_t)selected;
}

bool sb_ldc_metadata_load_step(const sb_ldc_io_t *io,sb_ldc_metadata_load_ctx_t *context,
                               unsigned operation_budget,sb_ldc_metadata_state_t *state,
                               bool *complete,bool *valid)
{
    if(io==NULL||io->read==NULL||io->workspace==NULL||context==NULL||state==NULL||
       complete==NULL||valid==NULL||operation_budget==0u)return false;
    unsigned operations=0u;
    while(!context->complete&&operations<operation_budget){
        unsigned candidate=context->candidate;
        if(candidate>=2u){metadata_load_next_candidate(context);continue;}
        sb_ldc_metadata_state_t *s=&context->candidates[candidate];
        ++operations;
        if(context->phase==0u){
            if(!io->read(io->context,candidate*SB_LDC_SUPERBLOCK_SIZE,context->raw[candidate],SB_LDC_SUPERBLOCK_SIZE)||
               !sb_ldc_superblock_decode(context->raw[candidate],s)){metadata_load_next_candidate(context);continue;}
            s->active_superblock=(uint8_t)candidate;context->phase=1u;context->cursor=0u;continue;
        }
        if(context->phase==1u){
            unsigned page=context->cursor;
            if(page>=SB_LDC_LOGICAL_PAGE_COUNT){context->phase=2u;context->cursor=0u;continue;}
            uint8_t *scratch=io->workspace->page;uint32_t offset=0x400u+(uint32_t)s->page_map[page]*SB_LDC_PAGE_SIZE;
            if(!io->read(io->context,offset,scratch,SB_LDC_PAGE_SIZE)||sb_crc32c(scratch,SB_LDC_PAGE_SIZE)!=s->page_crc32c[page]){
                metadata_load_next_candidate(context);continue;
            }
            ++context->cursor;continue;
        }
        if(context->phase==2u){
            if(context->cursor>=SB_LDC_MAX_FIELDS){context->phase=3u;context->cursor=0u;continue;}
            if(!validate_field_record(io,s,context->cursor,io->workspace->field_ids,io->workspace->field_semantics)){
                metadata_load_next_candidate(context);continue;
            }
            ++context->cursor;continue;
        }
        if(context->phase==3u){
            if(context->cursor>=SB_LDC_MAX_DEFINITIONS){context->phase=4u;context->cursor=20u;continue;}
            if(!validate_definition_record(io,s,context->cursor,io->workspace->field_ids,io->workspace->field_semantics,
                                           io->workspace->def_fields,io->workspace->def_versions)){
                metadata_load_next_candidate(context);continue;
            }
            ++context->cursor;continue;
        }
        if(context->phase==4u){
            if(context->cursor>=24u){context->candidate_valid[candidate]=true;metadata_load_next_candidate(context);continue;}
            if(!validate_auxiliary_pool_page(io,s,context->cursor)){metadata_load_next_candidate(context);continue;}
            ++context->cursor;continue;
        }
        metadata_load_next_candidate(context);
    }
    if(context->complete&&context->result_valid)*state=context->candidates[context->cursor];
    *complete=context->complete;*valid=context->result_valid;
    return true;
}

bool sb_ldc_metadata_load(const sb_ldc_io_t *io,sb_ldc_metadata_state_t *state)
{
    if(io==NULL||io->workspace==NULL||state==NULL)return false;
    sb_ldc_metadata_load_ctx_t *context=&io->workspace->one_shot_loader;
    sb_ldc_metadata_load_begin(context);
    bool complete=false,valid=false;
    while(!complete){
        if(!sb_ldc_metadata_load_step(io,context,16u,state,&complete,&valid))return false;
    }
    return valid;
}

bool sb_ldc_metadata_publish(const sb_ldc_io_t *io, const sb_ldc_metadata_state_t *current,
                             const sb_ldc_metadata_state_t *desired,
                             const uint8_t tables[SB_LDC_LOGICAL_PAGE_COUNT][SB_LDC_PAGE_SIZE],
                             uint32_t changed_mask, sb_ldc_metadata_state_t *published)
{
    if (io == NULL || io->write == NULL || io->flush == NULL || io->workspace == NULL || current == NULL || desired == NULL || tables == NULL || published == NULL ||
        !valid_state(current) || !valid_state(desired) || current->generation == UINT64_MAX) return false;
    unsigned changed_count = 0;
    for (unsigned p = 0; p < SB_LDC_LOGICAL_PAGE_COUNT; ++p) if (changed_mask & (UINT32_C(1) << p)) ++changed_count;
    if (changed_count == 0 || changed_count > 6 || (changed_mask >> SB_LDC_LOGICAL_PAGE_COUNT) != 0) return false;
    unsigned inactive = 1u - current->active_superblock;
    const uint8_t invalid[4] = {0, 0, 0, 0};
    if (!io->write(io->context, inactive * SB_LDC_SUPERBLOCK_SIZE, invalid, sizeof(invalid)) || !io->flush(io->context)) return false;
    *published = *desired; published->generation = current->generation + 1u; published->active_superblock = (uint8_t)inactive;
    memcpy(published->page_map, current->page_map, sizeof(published->page_map));
    memcpy(published->page_crc32c, current->page_crc32c, sizeof(published->page_crc32c));
    uint32_t used = 0;
    for (unsigned i = 0; i < SB_LDC_LOGICAL_PAGE_COUNT; ++i) used |= UINT32_C(1) << current->page_map[i];
    unsigned next_phys = 0;
    for (unsigned p = 0; p < SB_LDC_LOGICAL_PAGE_COUNT; ++p) {
        if ((changed_mask & (UINT32_C(1) << p)) == 0) continue;
        while (next_phys < SB_LDC_PHYSICAL_PAGE_COUNT && (used & (UINT32_C(1) << next_phys)) != 0) ++next_phys;
        if (next_phys >= SB_LDC_PHYSICAL_PAGE_COUNT) return false;
        uint32_t offset = 0x400u + next_phys * SB_LDC_PAGE_SIZE;
        if (!io->write(io->context, offset, tables[p], SB_LDC_PAGE_SIZE)) return false;
        published->page_map[p] = (uint16_t)next_phys;
        published->page_crc32c[p] = sb_crc32c(tables[p], SB_LDC_PAGE_SIZE);
        used |= UINT32_C(1) << next_phys++;
    }
    if (!io->flush(io->context) || io->read == NULL) return false;
    for (unsigned p = 0; p < SB_LDC_LOGICAL_PAGE_COUNT; ++p) {
        if ((changed_mask & (UINT32_C(1) << p)) == 0) continue;
        uint8_t verify[SB_LDC_PAGE_SIZE];
        uint32_t offset = 0x400u + (uint32_t)published->page_map[p] * SB_LDC_PAGE_SIZE;
        if (!io->read(io->context, offset, verify, sizeof(verify)) ||
            sb_crc32c(verify, sizeof(verify)) != published->page_crc32c[p] ||
            memcmp(verify, tables[p], sizeof(verify)) != 0) return false;
    }
    if(!validate_metadata_records(io,published))return false;
    uint8_t raw[SB_LDC_SUPERBLOCK_SIZE];
    if (!sb_ldc_superblock_encode(published, raw) || !io->write(io->context, inactive * SB_LDC_SUPERBLOCK_SIZE, raw, sizeof(raw)) || !io->flush(io->context)) return false;
    uint8_t verify_superblock[SB_LDC_SUPERBLOCK_SIZE];sb_ldc_metadata_state_t verify_state;
    if(!io->read(io->context,inactive*SB_LDC_SUPERBLOCK_SIZE,verify_superblock,sizeof(verify_superblock))||
       memcmp(raw,verify_superblock,sizeof(raw))!=0||!sb_ldc_superblock_decode(verify_superblock,&verify_state))return false;
    return true;
}
