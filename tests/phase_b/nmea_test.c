#include "nmea_parser.h"
#include "gnss_backend.h"
#include <stdio.h>
#include <string.h>

#define CHECK(x) do{if(!(x)){fprintf(stderr,"FAIL %s:%d: %s\n",__FILE__,__LINE__,#x);return 1;}}while(0)
typedef struct{unsigned count;sb_gnss_fix_t last;} capture_t;
static bool emit(void *context,const sb_gnss_fix_t *fix){capture_t *c=context;c->last=*fix;++c->count;return true;}
static bool backend_write_ok(const uint8_t *data,size_t length,void *context)
{(void)data;(void)length;(void)context;return true;}
static bool backend_baud_ok(uint32_t baud,void *context)
{(void)context;return baud==115200u;}
static void backend_reset_input(void *context){(void)context;}
static size_t sentence(char *out,size_t cap,const char *body)
{
    unsigned checksum=0;for(const char *p=body;*p;++p)checksum^=(unsigned char)*p;
    int n=snprintf(out,cap,"$%s*%02X\r\n",body,checksum);return n>0?(size_t)n:0u;
}
int main(void)
{
    sb_gnss_nmea_parser_t parser;sb_gnss_nmea_reset(&parser);capture_t c={0};char line[160];
    size_t n=sentence(line,sizeof(line),"GNRMC,123519.000,A,4807.038,N,01131.000,E,022.4,084.4,230394,,,A");
    sb_gnss_nmea_feed(&parser,(const uint8_t *)"noise",5,1000,emit,&c);
    sb_gnss_nmea_feed(&parser,(const uint8_t *)line,n/2u,2000,emit,&c);
    sb_gnss_nmea_feed(&parser,(const uint8_t *)line+n/2u,n-n/2u,3000,emit,&c);
    n=sentence(line,sizeof(line),"GPGGA,123519.000,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,");
    sb_gnss_nmea_feed(&parser,(const uint8_t *)line,n,4000,emit,&c);
    n=sentence(line,sizeof(line),"GNGSA,A,3,04,05,09,12,24,25,26,27");
    sb_gnss_nmea_feed(&parser,(const uint8_t *)line,n,5000,emit,&c);
    n=sentence(line,sizeof(line),"GNVTG,084.4,T,,M,022.4,N,041.5,K,A");
    sb_gnss_nmea_feed(&parser,(const uint8_t *)line,n,6000,emit,&c);
    CHECK(c.count==0&&parser.valid_sentences==4u);
    sb_gnss_nmea_tick(&parser,UINT64_C(306001),emit,&c);
    CHECK(c.count==1);CHECK(c.last.position_valid&&c.last.utc_valid);
    CHECK(c.last.latitude_e7==481173000&&c.last.longitude_e7==115166667);
    CHECK(c.last.altitude_valid&&c.last.altitude_cm==54540);
    CHECK(c.last.ground_speed_valid&&c.last.ground_speed_centi_kn==2240);
    CHECK(c.last.course_valid&&c.last.course_centi_deg==8440);
    CHECK(c.last.satellites_valid&&c.last.satellites_used==8u&&c.last.fix_type==SB_GNSS_FIX_3D);

    n=sentence(line,sizeof(line),"GPRMC,123520.000,V,,,,,,,230394,,,A");
    sb_gnss_nmea_feed(&parser,(const uint8_t *)line,n,400000,emit,&c);
    sb_gnss_nmea_tick(&parser,700001,emit,&c);
    CHECK(c.count==2&&c.last.utc_valid&&!c.last.position_valid&&c.last.fix_type==SB_GNSS_FIX_NONE);

    n=sentence(line,sizeof(line),"GPRMC,123521.000,A,4807.038,N,01131.000,E,0,360.0,230394,,,A");
    line[n-4]^=1u;sb_gnss_nmea_feed(&parser,(const uint8_t *)line,n,800000,emit,&c);
    CHECK(parser.invalid_sentences>=1u&&c.count==2);
    memset(line,'X',sizeof(line));line[0]='$';sb_gnss_nmea_feed(&parser,(const uint8_t *)line,sizeof(line),900000,emit,&c);
    CHECK(parser.overlength_sentences>=1u);

    /* A changed epoch finalizes the prior one even without a blocking wait. */
    n=sentence(line,sizeof(line),"GPRMC,123522.000,A,4807.038,N,01131.000,E,0,360.0,230394,,,A");
    sb_gnss_nmea_feed(&parser,(const uint8_t *)line,n,1000000,emit,&c);
    n=sentence(line,sizeof(line),"GNRMC,123523.000,A,4807.038,N,01131.000,E,0,360.0,230394,,,A");
    sb_gnss_nmea_feed(&parser,(const uint8_t *)line,n,1100000,emit,&c);
    CHECK(c.count==3&&c.last.course_centi_deg==0u);
    n=sentence(line,sizeof(line),"GPRMC,123524.000,A,4807.038,N,01131.000,E,0,0.0,310299,,,A");
    sb_gnss_nmea_feed(&parser,(const uint8_t *)line,n,1200000,emit,&c);
    sb_gnss_nmea_tick(&parser,1500001,emit,&c);
    CHECK(c.count==5&&c.last.position_valid&&!c.last.utc_valid);
    n=sentence(line,sizeof(line),"GNGSA,A,9,04,05,09,12,24,25,26,27");
    sb_gnss_nmea_feed(&parser,(const uint8_t *)line,n,1600000,emit,&c);
    CHECK(parser.invalid_sentences>=2u);

    /* A position does not imply 3D when GSA is absent, and an old GSA
     * dimension must not leak into a later epoch. */
    sb_gnss_nmea_reset(&parser);c.count=0;
    n=sentence(line,sizeof(line),"GPGGA,123519.000,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,");
    sb_gnss_nmea_feed(&parser,(const uint8_t *)line,n,1000000,emit,&c);
    sb_gnss_nmea_tick(&parser,1250000,emit,&c);
    CHECK(c.count==1&&c.last.position_valid&&c.last.fix_type==SB_GNSS_FIX_UNKNOWN);

    sb_gnss_nmea_reset(&parser);c.count=0;
    n=sentence(line,sizeof(line),"GNGSA,A,3,04,05,09,12,24,25,26,27");
    sb_gnss_nmea_feed(&parser,(const uint8_t *)line,n,1000000,emit,&c);
    n=sentence(line,sizeof(line),"GPGGA,123519.000,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,");
    sb_gnss_nmea_feed(&parser,(const uint8_t *)line,n,3000000,emit,&c);
    sb_gnss_nmea_tick(&parser,3250000,emit,&c);
    CHECK(c.count==1&&c.last.position_valid&&c.last.fix_type==SB_GNSS_FIX_UNKNOWN);

    sb_gnss_nmea_reset(&parser);c.count=0;
    n=sentence(line,sizeof(line),"GNGSA,A,1,,,,,,,,,,,,,");
    sb_gnss_nmea_feed(&parser,(const uint8_t *)line,n,1000000,emit,&c);
    CHECK(parser.valid_sentences==1u&&parser.invalid_sentences==0u);
    n=sentence(line,sizeof(line),"GPGGA,123519.000,,,,,0,00,99.9,,,,,,");
    sb_gnss_nmea_feed(&parser,(const uint8_t *)line,n,1000100,emit,&c);
    sb_gnss_nmea_tick(&parser,1250100,emit,&c);
    CHECK(c.count==1&&!c.last.position_valid&&c.last.fix_type==SB_GNSS_FIX_NONE);

    /* Exercise the selected private ATGM backend boundary, not only parser helpers. */
    const sb_gnss_backend_t *backend=sb_gnss_atgm336h_backend();CHECK(backend&&backend->initial_baud()==115200u);
    sb_gnss_runtime_config_t config={.runtime_baud=115200u,.update_rate_hz=10u};
    sb_gnss_backend_io_t io={.write=backend_write_ok,.set_baud=backend_baud_ok,.reset_rx=backend_reset_input};
    backend->start(&config,&io,0u);CHECK((backend->capabilities&1u)!=0u);
    c.count=0;n=sentence(line,sizeof(line),"GPRMC,123524.000,V,,,,,,,230394,,,A");
    backend->consume_bytes((const uint8_t *)line,n,1000u,emit,&c);backend->step(1000u);
    backend->step(2000u);backend->step(3000u);backend->step(103000u);
    n=sentence(line,sizeof(line),"GPRMC,123525.000,A,4807.038,N,01131.000,E,1.0,2.0,230394,,,A");
    backend->consume_bytes((const uint8_t *)line,n,2000000,emit,&c);
    backend->tick(2300001,emit,&c);
    CHECK(c.count==2&&c.last.position_valid&&c.last.ground_speed_centi_kn==100u);
    puts("PASS production ATGM NMEA parser: fragmented/multiple stream, checksum, GNSS epoch normalization, no-fix, talker IDs, overlength");
    return 0;
}
