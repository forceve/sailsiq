#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "gnss_backend.h"

typedef struct {
    unsigned writes,baud_changes,resets,emitted;
    bool fail_write,fail_baud;
    char commands[3][48];
} fake_uart_t;

static bool fake_write(const uint8_t *data,size_t length,void *context)
{
    fake_uart_t *uart=(fake_uart_t *)context;
    ++uart->writes;
    if(uart->fail_write)return false;
    assert(uart->writes<=3u&&length<sizeof(uart->commands[0]));
    memcpy(uart->commands[uart->writes-1u],data,length);
    uart->commands[uart->writes-1u][length]='\0';
    return true;
}
static bool fake_set_baud(uint32_t baud,void *context)
{fake_uart_t *uart=(fake_uart_t *)context;++uart->baud_changes;return baud==115200u&&!uart->fail_baud;}
static void fake_reset_rx(void *context){++((fake_uart_t *)context)->resets;}
static bool emit_fix(void *context,const sb_gnss_fix_t *fix)
{assert(fix->utc_valid&&!fix->position_valid);++((fake_uart_t *)context)->emitted;return true;}
static void feed(const sb_gnss_backend_t *backend,const char *body,uint64_t now,fake_uart_t *uart)
{
    char sentence[160];unsigned checksum=0u;
    for(const char *p=body;*p;++p)checksum^=(unsigned char)*p;
    int n=snprintf(sentence,sizeof(sentence),"$%s*%02X\r\n",body,checksum);
    assert(n>0&&(size_t)n<sizeof(sentence));
    backend->consume_bytes((const uint8_t *)sentence,(size_t)n,now,emit_fix,uart);
}
static sb_gnss_backend_io_t io_for(fake_uart_t *uart)
{return (sb_gnss_backend_io_t){.write=fake_write,.set_baud=fake_set_baud,.reset_rx=fake_reset_rx,.context=uart};}

int main(void)
{
    const sb_gnss_backend_t *backend=sb_gnss_atgm336h_backend();
    assert(backend->initial_baud()==115200u);
    sb_gnss_runtime_config_t config={.runtime_baud=115200u,.update_rate_hz=10u};
    fake_uart_t uart={0};sb_gnss_backend_io_t io=io_for(&uart);

    backend->start(&config,&io,0u);
    assert(backend->step(0u)==SB_GNSS_BACKEND_CONFIGURING);

    /* Module silence is bounded; it never starts an unbounded command loop. */
    assert(backend->step(UINT64_C(5000000))==SB_GNSS_BACKEND_FAILED);
    assert(uart.writes==0u);

    /* Command write failure has a finite retry count and terminates locally. */
    memset(&uart,0,sizeof(uart));uart.fail_write=true;io=io_for(&uart);
    backend->start(&config,&io,0u);
    feed(backend,"GPRMC,123519.000,V,,,,,,,230394,,,A",0u,&uart);
    assert(backend->step(0u)==SB_GNSS_BACKEND_CONFIGURING);
    backend->step(UINT64_C(100000));
    assert(backend->step(UINT64_C(200000))==SB_GNSS_BACKEND_FAILED);
    assert(uart.writes==3u);

    /* Successful commands followed by UART baud application failure is bounded. */
    memset(&uart,0,sizeof(uart));uart.fail_baud=true;io=io_for(&uart);
    backend->start(&config,&io,0u);
    feed(backend,"GPRMC,123519.000,V,,,,,,,230394,,,A",0u,&uart);
    backend->step(0u);backend->step(10000u);
    assert(backend->step(20000u)==SB_GNSS_BACKEND_CONFIGURING);
    assert(backend->step(120000u)==SB_GNSS_BACKEND_FAILED);
    assert(uart.writes==3u&&uart.baud_changes==1u);

    /* Command and UART setup can succeed while the module remains silent at
     * the selected runtime baud; valid-message verification then times out. */
    memset(&uart,0,sizeof(uart));io=io_for(&uart);
    backend->start(&config,&io,0u);
    feed(backend,"GPRMC,123519.000,V,,,,,,,230394,,,A",0u,&uart);
    backend->step(0u);backend->step(10000u);backend->step(20000u);
    assert(backend->step(120000u)==SB_GNSS_BACKEND_VERIFYING);
    assert(backend->step(UINT64_C(1120000))==SB_GNSS_BACKEND_FAILED);
    assert(uart.writes==3u&&uart.baud_changes==1u);

    /* Valid NO_FIX epochs still prove parser activity and the requested rate. */
    memset(&uart,0,sizeof(uart));io=io_for(&uart);
    backend->start(&config,&io,0u);
    feed(backend,"GPRMC,123519.000,V,,,,,,,230394,,,A",0u,&uart);
    backend->step(0u);backend->step(10000u);backend->step(20000u);
    assert(backend->step(120000u)==SB_GNSS_BACKEND_VERIFYING);
    assert(uart.writes==3u&&uart.baud_changes==1u&&uart.resets==0u);
    feed(backend,"GPRMC,123520.000,V,,,,,,,230394,,,A",130000u,&uart);
    feed(backend,"GPRMC,123520.100,V,,,,,,,230394,,,A",140000u,&uart);
    feed(backend,"GPRMC,123520.200,V,,,,,,,230394,,,A",150000u,&uart);
    feed(backend,"GPRMC,123520.300,V,,,,,,,230394,,,A",160000u,&uart);
    assert(backend->step(160000u)==SB_GNSS_BACKEND_READY);
    assert(uart.emitted==4u); /* one pre-config epoch plus three runtime-rate samples */
    assert(strcmp(uart.commands[0],"$PCAS03,1,0,1,0,1,0,0,0*03\r\n")==0);
    assert(strcmp(uart.commands[1],"$PCAS02,100*1E\r\n")==0);
    assert(strcmp(uart.commands[2],"$PCAS01,5*19\r\n")==0);
    puts("PASS ATGM startup state machine: bounded silence/write/baud failures, 10 Hz configuration, valid NO_FIX verification");
    return 0;
}
