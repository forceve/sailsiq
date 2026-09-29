#include "sailball/sp.h"
#include "sailball/common.h"
#include "sailball/ldc.h"
#include <string.h>

bool sb_sp_frame_encode(const sb_sp_frame_t *f, uint8_t *out, size_t capacity, size_t *written)
{
    if (f == NULL || out == NULL || written == NULL || f->major != 1 || f->type < SB_SP_REQUEST || f->type > SB_SP_BULK ||
        f->flags != 0 || f->channel != 0 || f->reserved != 0 || f->payload_length > SB_SP_MAX_RX_PAYLOAD ||
        (f->payload_length != 0 && f->payload == NULL)) return false;
    size_t total = SB_SP_HEADER_SIZE + f->payload_length + SB_SP_CRC_SIZE;
    if (capacity < total) return false;
    memcpy(out, "SP", 2); out[2]=f->major; out[3]=f->minor; out[4]=f->type; out[5]=f->flags; out[6]=f->channel; out[7]=f->reserved;
    sb_write_le16(out+8,f->service_id); sb_write_le16(out+10,f->message_id); sb_write_le32(out+12,f->request_id);
    sb_write_le32(out+16,f->sequence); sb_write_le32(out+20,f->payload_length);
    if (f->payload_length) memcpy(out+24,f->payload,f->payload_length);
    sb_write_le32(out+24+f->payload_length,sb_crc32c(out,24+f->payload_length)); *written=total; return true;
}

bool sb_sp_frame_decode(const uint8_t *data, size_t length, uint32_t max_payload, sb_sp_frame_t *f)
{
    if (data == NULL || f == NULL || length < 28 || max_payload > SB_SP_MAX_RX_PAYLOAD || memcmp(data,"SP",2)!=0 || data[2]!=1) return false;
    uint32_t n=sb_read_le32(data+20);
    if (n>max_payload || length!=24u+(size_t)n+4u || sb_read_le32(data+24+n)!=sb_crc32c(data,24+n)) return false;
    f->major=data[2]; f->minor=data[3]; f->type=data[4]; f->flags=data[5]; f->channel=data[6]; f->reserved=data[7];
    f->service_id=sb_read_le16(data+8); f->message_id=sb_read_le16(data+10); f->request_id=sb_read_le32(data+12);
    f->sequence=sb_read_le32(data+16); f->payload_length=n; f->payload=data+24;
    f->storage_epoch=0u;
    return true;
}
