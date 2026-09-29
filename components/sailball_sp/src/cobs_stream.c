#include "sailball/sp.h"
#include <string.h>

bool sb_sp_cobs_encode_delimited(const sb_sp_frame_t *frame, uint8_t *output,
                                 size_t capacity, size_t *wire_length)
{
    if (frame == NULL || output == NULL || wire_length == NULL || capacity < 2u ||
        frame->major != 1u || frame->type < SB_SP_REQUEST || frame->type > SB_SP_BULK ||
        frame->flags != 0u || frame->channel != 0u || frame->reserved != 0u ||
        frame->payload_length > SB_SP_MAX_RX_PAYLOAD ||
        (frame->payload_length != 0u && frame->payload == NULL)) return false;
    if(frame->payload_length != 0u){
        uintptr_t source=(uintptr_t)frame->payload,dest=(uintptr_t)output;
        if((source>=dest&&source-dest<capacity)||
           (dest>source&&dest-source<frame->payload_length))return false;
    }
    uint8_t header[SB_SP_HEADER_SIZE]={ 'S','P',frame->major,frame->minor,frame->type,
        frame->flags,frame->channel,frame->reserved };
    sb_write_le16(header+8u,frame->service_id);
    sb_write_le16(header+10u,frame->message_id);
    sb_write_le32(header+12u,frame->request_id);
    sb_write_le32(header+16u,frame->sequence);
    sb_write_le32(header+20u,frame->payload_length);
    uint8_t crc_bytes[SB_SP_CRC_SIZE]={0};
    uint32_t crc=UINT32_C(0xFFFFFFFF);
    size_t data_length=SB_SP_HEADER_SIZE+(size_t)frame->payload_length;
    size_t raw_length=data_length+SB_SP_CRC_SIZE;
    size_t write=1u,code_at=0u;
    uint8_t code=1u;
    for(size_t i=0u;i<raw_length;++i){
        uint8_t byte=i<SB_SP_HEADER_SIZE?header[i]:
            i<data_length?frame->payload[i-SB_SP_HEADER_SIZE]:crc_bytes[i-data_length];
        if(i<data_length){
            crc^=byte;
            for(unsigned bit=0;bit<8u;++bit)
                crc=(crc>>1u)^((crc&1u)?UINT32_C(0x82F63B78):0u);
            if(i+1u==data_length)sb_write_le32(crc_bytes,crc^UINT32_C(0xFFFFFFFF));
        }
        if(byte==0u){
            output[code_at]=code;
            if(write>=capacity-1u)return false;
            code_at=write++;code=1u;
        }else{
            if(write>=capacity-1u)return false;
            output[write++]=byte;++code;
            if(code==UINT8_MAX&&i+1u<raw_length){
                output[code_at]=code;
                if(write>=capacity-1u)return false;
                code_at=write++;code=1u;
            }
        }
    }
    output[code_at]=code;
    output[write]=0u;
    *wire_length=write+1u;
    return true;
}

void sb_sp_cobs_stream_reset(sb_sp_cobs_stream_t *stream)
{
    if (stream != NULL) memset(stream, 0, sizeof(*stream));
}

bool sb_sp_cobs_stream_feed(sb_sp_cobs_stream_t *stream, const uint8_t *bytes, size_t length,
                            uint32_t max_payload, sb_sp_cobs_frame_fn on_frame, void *context,
                            uint32_t *frame_errors)
{
    if (stream == NULL || (length != 0u && bytes == NULL) || on_frame == NULL) return false;
    for (size_t i = 0; i < length; ++i) {
        uint8_t byte = bytes[i];
        if (stream->discard_until_delimiter) {
            if (byte == 0u) stream->discard_until_delimiter = false;
            continue;
        }
        if (byte != 0u) {
            if (stream->used == sizeof(stream->encoded)) {
                stream->used = 0u;
                stream->discard_until_delimiter = true;
                if (frame_errors != NULL && *frame_errors != UINT32_MAX) ++*frame_errors;
            } else stream->encoded[stream->used++] = byte;
            continue;
        }
        if (stream->used == 0u) continue;
        size_t raw_length = 0u;
        bool valid = sb_cobs_decode(stream->encoded, stream->used, stream->encoded,
                                    sizeof(stream->encoded), &raw_length);
        stream->used = 0u;
        sb_sp_frame_t frame;
        if (!valid || raw_length > SB_SP_MAX_FRAME ||
            !sb_sp_frame_decode(stream->encoded, raw_length, max_payload, &frame)) {
            if (frame_errors != NULL && *frame_errors != UINT32_MAX) ++*frame_errors;
            continue;
        }
        if (!on_frame(context, &frame)) return false;
    }
    return true;
}
