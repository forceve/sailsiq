#include "gnss_backend.h"
#include <stdio.h>
#include <string.h>

enum { GNSS_CAP_NMEA=1u, GNSS_CAP_POSITION=2u, GNSS_CAP_UTC=4u };
enum {
    ATGM_BOOT_BAUD = 115200u,
    ATGM_BOOT_CONFIRM_TIMEOUT_US = 5000000u,
    ATGM_CONFIG_RETRY_US = 100000u,
    ATGM_BAUD_GUARD_US = 100000u,
    ATGM_VERIFY_MIN_SAMPLES = 3u,
    ATGM_MAX_COMMAND_RETRIES = 3u
};

typedef enum {
    ATGM_WAIT_BOOT_NMEA=0,
    ATGM_SEND_CONFIG,
    ATGM_BAUD_GUARD,
    ATGM_VERIFY_RATE,
    ATGM_READY,
    ATGM_FAILED
} atgm_state_t;

static sb_gnss_nmea_parser_t s_parser;
static sb_gnss_runtime_config_t s_config;
static sb_gnss_backend_io_t s_io;
static atgm_state_t s_state;
static uint64_t s_started_us,s_deadline_us,s_first_sample_utc_us,s_last_sample_utc_us;
static uint32_t s_command_index,s_command_attempts,s_verified_samples;
static bool s_first_sample_seen;

static uint32_t initial_baud(void){return ATGM_BOOT_BAUD;}

static void start(const sb_gnss_runtime_config_t *config,const sb_gnss_backend_io_t *io,uint64_t now)
{
    memset(&s_config,0,sizeof(s_config));
    memset(&s_io,0,sizeof(s_io));
    if(config!=NULL)s_config=*config;
    if(io!=NULL)s_io=*io;
    sb_gnss_nmea_reset(&s_parser);
    s_state=ATGM_WAIT_BOOT_NMEA;s_started_us=now;s_deadline_us=now+ATGM_BOOT_CONFIRM_TIMEOUT_US;
    s_command_index=0u;s_command_attempts=0u;s_verified_samples=0u;
    s_first_sample_seen=false;
    s_first_sample_utc_us=0u;s_last_sample_utc_us=0u;
}

static void restart(const sb_gnss_runtime_config_t *config,const sb_gnss_backend_io_t *io,uint64_t now)
{start(config,io,now);}

static bool format_command(char *out,size_t capacity,const char *body)
{
    uint8_t checksum=0u;
    for(const char *p=body;*p!='\0';++p)checksum^=(uint8_t)*p;
    int n=snprintf(out,capacity,"$%s*%02X\r\n",body,checksum);
    return n>0&&(size_t)n<capacity;
}

static int baud_code(uint32_t baud)
{
    switch(baud){
    case 4800u:return 0;
    case 9600u:return 1;
    case 19200u:return 2;
    case 38400u:return 3;
    case 57600u:return 4;
    case 115200u:return 5;
    default:return -1;
    }
}

static bool send_config_command(uint32_t index)
{
    char body[40],wire[52];
    if(index==0u){
        /* CAS03 order: GGA,GLL,GSA,GSV,RMC,VTG,ZDA,TXT. Retain only the
         * three sentence families consumed by the v1 normalized-fix parser. */
        memcpy(body,"PCAS03,1,0,1,0,1,0,0,0",sizeof("PCAS03,1,0,1,0,1,0,0,0"));
    }else if(index==1u){
        if(s_config.update_rate_hz==0u||s_config.update_rate_hz>10u||
           (1000u%s_config.update_rate_hz)!=0u)return false;
        int n=snprintf(body,sizeof(body),"PCAS02,%u",(unsigned)(1000u/s_config.update_rate_hz));
        if(n<=0||(size_t)n>=sizeof(body))return false;
    }else if(index==2u){
        int code=baud_code(s_config.runtime_baud);
        if(code<0)return false;
        int n=snprintf(body,sizeof(body),"PCAS01,%d",code);
        if(n<=0||(size_t)n>=sizeof(body))return false;
    }else return false;
    if(!format_command(wire,sizeof(wire),body)||s_io.write==NULL)return false;
    return s_io.write((const uint8_t *)wire,strlen(wire),s_io.context);
}

static uint64_t day_wrap_delta(uint64_t first,uint64_t last)
{
    if(last>=first)return last-first;
    const uint64_t utc_day_us=UINT64_C(86400000000);
    return utc_day_us-first+last;
}

static void note_fix_for_startup(const sb_gnss_fix_t *fix)
{
    if(s_state!=ATGM_VERIFY_RATE||!fix->utc_valid)return;
    if(!s_first_sample_seen){
        s_first_sample_seen=true;s_first_sample_utc_us=fix->utc_us;s_last_sample_utc_us=fix->utc_us;
        s_verified_samples=1u;return;
    }
    uint64_t delta=day_wrap_delta(s_last_sample_utc_us,fix->utc_us);
    if(delta==0u)return;
    uint64_t period=UINT64_C(1000000)/s_config.update_rate_hz;
    if(delta<(period*50u)/100u||delta>(period*180u)/100u){
        /* Buffered pre-transition messages can straddle configuration. Start
         * cadence measurement again at the first plausible target-rate pair. */
        s_first_sample_utc_us=fix->utc_us;s_last_sample_utc_us=fix->utc_us;s_verified_samples=1u;
        return;
    }
    s_last_sample_utc_us=fix->utc_us;
    if(s_verified_samples!=UINT32_MAX)++s_verified_samples;
}

static sb_gnss_backend_state_t step(uint64_t now)
{
    if(s_state==ATGM_WAIT_BOOT_NMEA){
        if(s_parser.valid_sentences!=0u){s_state=ATGM_SEND_CONFIG;s_deadline_us=now;}
        else if(now-s_started_us>=ATGM_BOOT_CONFIRM_TIMEOUT_US)s_state=ATGM_FAILED;
    }
    if(s_state==ATGM_SEND_CONFIG&&now>=s_deadline_us){
        if(send_config_command(s_command_index)){
            s_command_attempts=0u;
            if(++s_command_index==3u){s_state=ATGM_BAUD_GUARD;s_deadline_us=now+ATGM_BAUD_GUARD_US;}
        }else if(++s_command_attempts>=ATGM_MAX_COMMAND_RETRIES){
            s_state=ATGM_FAILED;
        }else s_deadline_us=now+ATGM_CONFIG_RETRY_US;
    }
    if(s_state==ATGM_BAUD_GUARD&&now>=s_deadline_us){
        if(s_io.set_baud==NULL||!s_io.set_baud(s_config.runtime_baud,s_io.context)){
            s_state=ATGM_FAILED;
        }else{
            if(s_config.runtime_baud!=ATGM_BOOT_BAUD){
                if(s_io.reset_rx!=NULL)s_io.reset_rx(s_io.context);
                sb_gnss_nmea_reset(&s_parser);
            }
            s_verified_samples=0u;s_first_sample_seen=false;
            s_started_us=now;s_deadline_us=now+((UINT64_C(5000000)/s_config.update_rate_hz)+UINT64_C(500000));
            s_state=ATGM_VERIFY_RATE;
        }
    }
    if(s_state==ATGM_VERIFY_RATE&&s_verified_samples>=ATGM_VERIFY_MIN_SAMPLES){
        uint64_t span=day_wrap_delta(s_first_sample_utc_us,s_last_sample_utc_us);
        uint64_t ideal=UINT64_C(2000000)/s_config.update_rate_hz;
        if(span>=(ideal*55u)/100u&&span<=(ideal*180u)/100u)s_state=ATGM_READY;
        else s_state=ATGM_FAILED;
    }else if(s_state==ATGM_VERIFY_RATE&&now>=s_deadline_us){
        s_state=ATGM_FAILED;
    }
    if(s_state==ATGM_READY)return SB_GNSS_BACKEND_READY;
    if(s_state==ATGM_FAILED)return SB_GNSS_BACKEND_FAILED;
    if(s_state==ATGM_VERIFY_RATE)return SB_GNSS_BACKEND_VERIFYING;
    return SB_GNSS_BACKEND_CONFIGURING;
}

typedef struct {sb_gnss_emit_fix_fn emit;void *context;} emit_context_t;
static bool emit_and_track(void *context,const sb_gnss_fix_t *fix)
{
    emit_context_t *target=(emit_context_t *)context;
    note_fix_for_startup(fix);
    return target->emit==NULL||target->emit(target->context,fix);
}

static void consume(const uint8_t *bytes,size_t length,uint64_t now,sb_gnss_emit_fix_fn emit,void *context)
{
    emit_context_t target={emit,context};
    sb_gnss_nmea_feed(&s_parser,bytes,length,now,emit_and_track,&target);
}
static void tick(uint64_t now,sb_gnss_emit_fix_fn emit,void *context)
{
    emit_context_t target={emit,context};
    sb_gnss_nmea_tick(&s_parser,now,emit_and_track,&target);
}
static uint32_t valid_sentence_count(void){return s_parser.valid_sentences;}
static void reset_parser(void){sb_gnss_nmea_reset(&s_parser);}
static const sb_gnss_backend_t s_backend={
    .initial_baud=initial_baud,.start=start,.step=step,.restart=restart,
    .reset_parser=reset_parser,
    .consume_bytes=consume,.tick=tick,.valid_sentence_count=valid_sentence_count,
    .capabilities=GNSS_CAP_NMEA|GNSS_CAP_POSITION|GNSS_CAP_UTC
};
const sb_gnss_backend_t *sb_gnss_atgm336h_backend(void){return &s_backend;}
