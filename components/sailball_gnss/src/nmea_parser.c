#include "nmea_parser.h"
#include <limits.h>
#include <string.h>

#define NMEA_EPOCH_SETTLE_US UINT64_C(250000)
#define NMEA_AUX_FRESH_US UINT64_C(1500000)
#define NMEA_MAX_FIELDS 24u

typedef struct { char *field[NMEA_MAX_FIELDS]; size_t count; } fields_t;

static bool parse_uint(const char *s,uint64_t max,uint64_t *out)
{
    if(s==NULL||*s<'0'||*s>'9')return false;
    uint64_t v=0;
    for(;*s;++s){if(*s<'0'||*s>'9')return false;unsigned d=(unsigned)(*s-'0');if(d>max||v>(max-d)/10u)return false;v=v*10u+d;}
    *out=v;return true;
}

static bool decimal_scaled(const char *s,uint64_t scale,bool allow_negative,int64_t *out)
{
    if(s==NULL||*s=='\0'||out==NULL)return false;
    bool negative=false;if(*s=='-'||*s=='+'){if(*s=='-'&&!allow_negative)return false;negative=*s=='-';++s;}
    if(*s<'0'||*s>'9')return false;
    uint64_t whole=0;while(*s>='0'&&*s<='9'){unsigned d=(unsigned)(*s-'0');if(whole>(UINT64_MAX-d)/10u)return false;whole=whole*10u+d;++s;}
    uint64_t frac=0,den=1;if(*s=='.'){++s;unsigned digits=0;while(*s>='0'&&*s<='9'){if(digits>=9)return false;frac=frac*10u+(unsigned)(*s-'0');den*=10u;++digits;++s;}if(digits==0)return false;}
    if(*s!='\0'||whole>(uint64_t)INT64_MAX/scale)return false;
    uint64_t base=whole*scale;if(frac!=0){if(frac>UINT64_MAX/scale)return false;uint64_t part=(frac*scale+den/2u)/den;if(UINT64_MAX-base<part)return false;base+=part;}
    if(base>(uint64_t)INT64_MAX+(negative?1u:0u))return false;
    *out=negative?(base==(uint64_t)INT64_MAX+1u?INT64_MIN:-(int64_t)base):(int64_t)base;return true;
}

static bool coordinate_e7(const char *value,const char *hemisphere,bool latitude,int32_t *out)
{
    if(value==NULL||hemisphere==NULL||out==NULL)return false;
    const char *dot=strchr(value,'.');size_t whole_len=dot?(size_t)(dot-value):strlen(value);
    if(whole_len<(latitude?4u:5u)||whole_len>(latitude?5u:6u))return false;
    uint64_t whole=0;if(!parse_uint(value,UINT32_MAX,&whole)){
        char integer[8];if(whole_len>=sizeof(integer))return false;memcpy(integer,value,whole_len);integer[whole_len]='\0';if(!parse_uint(integer,UINT32_MAX,&whole))return false;
    }
    uint64_t degrees=whole/100u,minute_whole=whole%100u;if(minute_whole>=60u)return false;
    uint64_t fraction=0,den=1;
    if(dot){const char *p=dot+1;if(*p=='\0')return false;unsigned digits=0;for(;*p;++p){if(*p<'0'||*p>'9'||digits>=9u)return false;fraction=fraction*10u+(unsigned)(*p-'0');den*=10u;++digits;}}
    uint64_t minutes_scaled=minute_whole*den+fraction;
    uint64_t minute_e7=(minutes_scaled*UINT64_C(10000000)+30u*den)/(60u*den);
    uint64_t limit=latitude?90u:180u;if(degrees>limit||(degrees==limit&&minute_e7!=0u))return false;
    uint64_t magnitude=degrees*UINT64_C(10000000)+minute_e7;
    if(magnitude>(latitude?900000000u:1800000000u))return false;
    bool negative=false;
    if(latitude){if(strcmp(hemisphere,"N")==0)negative=false;else if(strcmp(hemisphere,"S")==0)negative=true;else return false;}
    else {if(strcmp(hemisphere,"E")==0)negative=false;else if(strcmp(hemisphere,"W")==0)negative=true;else return false;}
    if(!latitude&&!negative&&magnitude==1800000000u)return false;
    *out=negative?-(int32_t)magnitude:(int32_t)magnitude;return true;
}

static bool parse_time(const char *s,uint64_t *tod_us)
{
    if(s==NULL||tod_us==NULL)return false;
    size_t n=strlen(s);if(n<6u||s[0]<'0'||s[0]>'9')return false;
    for(size_t i=0;i<6u;++i)if(s[i]<'0'||s[i]>'9')return false;
    unsigned hour=(unsigned)(s[0]-'0')*10u+(unsigned)(s[1]-'0');
    unsigned minute=(unsigned)(s[2]-'0')*10u+(unsigned)(s[3]-'0');
    unsigned second=(unsigned)(s[4]-'0')*10u+(unsigned)(s[5]-'0');
    if(hour>23u||minute>59u||second>59u)return false;
    uint32_t micros=0;size_t i=6u;
    if(i<n){if(s[i++]!='.')return false;unsigned digits=0;for(;i<n;++i){if(s[i]<'0'||s[i]>'9')return false;if(digits<6u)micros=micros*10u+(unsigned)(s[i]-'0');++digits;}if(digits==0u)return false;while(digits<6u){micros*=10u;++digits;}}
    *tod_us=((uint64_t)hour*3600u+(uint64_t)minute*60u+second)*UINT64_C(1000000)+micros;return true;
}

static bool leap_year(unsigned y){return (y%4u==0u&&y%100u!=0u)||y%400u==0u;}
static unsigned month_days(unsigned y,unsigned m){static const uint8_t d[]={31,28,31,30,31,30,31,31,30,31,30,31};return m==2u?d[m-1u]+(leap_year(y)?1u:0u):d[m-1u];}
static int64_t days_from_civil(int y,unsigned m,unsigned d)
{
    y-=m<=2u;int era=(y>=0?y:y-399)/400;unsigned yoe=(unsigned)(y-era*400);
    unsigned adjusted_month=m>2u?m-3u:m+9u;unsigned doy=(153u*adjusted_month+2u)/5u+d-1u;
    unsigned doe=yoe*365u+yoe/4u-yoe/100u+doy;return (int64_t)era*146097+(int64_t)doe-719468;
}
static bool parse_date(const char *s,int64_t *utc_day_us)
{
    if(s==NULL||strlen(s)!=6u)return false;
    for(unsigned i=0;i<6u;++i)if(s[i]<'0'||s[i]>'9')return false;
    unsigned day=(unsigned)(s[0]-'0')*10u+(unsigned)(s[1]-'0');unsigned month=(unsigned)(s[2]-'0')*10u+(unsigned)(s[3]-'0');
    unsigned yy=(unsigned)(s[4]-'0')*10u+(unsigned)(s[5]-'0');unsigned year=yy>=80u?1900u+yy:2000u+yy;
    if(month<1u||month>12u||day<1u||day>month_days(year,month))return false;
    *utc_day_us=days_from_civil((int)year,month,day)*INT64_C(86400000000);return true;
}

static bool tokenize(char *line,fields_t *fields)
{
    fields->count=0;char *p=line;while(*p&&fields->count<NMEA_MAX_FIELDS){fields->field[fields->count++]=p;char *comma=strchr(p,',');if(!comma)break;*comma='\0';p=comma+1;}
    return fields->count!=NMEA_MAX_FIELDS||strchr(fields->field[NMEA_MAX_FIELDS-1u],',')==NULL;
}
static bool check_sentence(char *line,fields_t *fields)
{
    size_t n=strlen(line);if(n<7u||line[0]!='$')return false;char *star=strchr(line,'*');if(!star||star[1]=='\0'||star[2]=='\0'||star[3]!='\0')return false;
    unsigned checksum=0;for(char *p=line+1;p<star;++p)checksum^=(uint8_t)*p;
    int hi=(star[1]>='0'&&star[1]<='9')?star[1]-'0':(star[1]>='A'&&star[1]<='F')?star[1]-'A'+10:(star[1]>='a'&&star[1]<='f')?star[1]-'a'+10:-1;
    int lo=(star[2]>='0'&&star[2]<='9')?star[2]-'0':(star[2]>='A'&&star[2]<='F')?star[2]-'A'+10:(star[2]>='a'&&star[2]<='f')?star[2]-'a'+10:-1;
    if(hi<0||lo<0||checksum!=(unsigned)((hi<<4)|lo))return false;
    *star='\0';return tokenize(line,fields);
}

static bool apply_gsa(sb_gnss_nmea_parser_t *p,sb_gnss_fix_t *fix,const fields_t *f,uint64_t now)
{
    if(f->count<3u)return false;
    uint64_t dim=0;if(!parse_uint(f->field[2],3,&dim)||dim<1u)return false;
    p->gsa_valid=true;p->gsa_fix_type=dim==1u?SB_GNSS_FIX_NONE:(dim==2u?SB_GNSS_FIX_2D:SB_GNSS_FIX_3D);
    p->gsa_update_us=now;
    uint16_t sats=0;for(size_t i=3u;i<15u&&i<f->count;++i)if(f->field[i][0]!='\0'&&sats<UINT16_MAX)++sats;
    p->gsa_satellites_valid=true;p->gsa_satellites=sats;
    fix->fix_type=p->gsa_fix_type;fix->satellites_used=sats;fix->satellites_valid=true;
    return true;
}

static void begin_epoch(sb_gnss_nmea_parser_t *p,uint64_t key,uint64_t now)
{
    p->epoch_has_valid_data=false;
    memset(&p->epoch,0,sizeof(p->epoch));p->epoch.fix_type=SB_GNSS_FIX_NONE;
    p->epoch_gsa_valid=p->gsa_valid&&now>=p->gsa_update_us&&now-p->gsa_update_us<=NMEA_AUX_FRESH_US;
    if(p->epoch_gsa_valid)p->epoch.fix_type=p->gsa_fix_type;
    bool gsa_fresh=p->gsa_satellites_valid&&now>=p->gsa_update_us&&now-p->gsa_update_us<=NMEA_AUX_FRESH_US;
    if(gsa_fresh){p->epoch.satellites_used=p->gsa_satellites;p->epoch.satellites_valid=true;}
    bool vtg_fresh=now>=p->vtg_update_us&&now-p->vtg_update_us<=NMEA_AUX_FRESH_US;
    if(vtg_fresh&&p->vtg_course_valid){p->epoch.course_centi_deg=p->vtg_course_centi_deg;p->epoch.course_valid=true;}
    if(vtg_fresh&&p->vtg_speed_valid){p->epoch.ground_speed_centi_kn=p->vtg_speed_centi_kn;p->epoch.ground_speed_valid=true;}
    p->epoch_tod_us=key;p->last_epoch_update_us=now;p->epoch_active=true;
}
static void emit_epoch(sb_gnss_nmea_parser_t *p,sb_gnss_emit_fix_fn emit,void *context)
{
    if(p->epoch_active&&p->epoch_has_valid_data&&emit!=NULL)(void)emit(context,&p->epoch);
    p->epoch_active=false;p->epoch_has_valid_data=false;p->epoch_gsa_valid=false;
    p->vtg_course_valid=false;p->vtg_speed_valid=false;
}

static bool apply_sentence(sb_gnss_nmea_parser_t *p,char *line,uint64_t now,sb_gnss_emit_fix_fn emit,void *context)
{
    fields_t f;if(!check_sentence(line,&f)||f.count==0u)return false;char *id=f.field[0];size_t idlen=strlen(id);if(idlen<6u)return false;
    const char *kind=id+idlen-3u;bool timed=strcmp(kind,"RMC")==0||strcmp(kind,"GGA")==0;uint64_t tod=0;
    if(timed){if(f.count<2u||!parse_time(f.field[1],&tod))return false;if(p->epoch_active&&tod!=p->epoch_tod_us)emit_epoch(p,emit,context);if(!p->epoch_active)begin_epoch(p,tod,now);p->last_epoch_update_us=now;}
    if(strcmp(kind,"GSA")==0){sb_gnss_fix_t scratch={0};if(!apply_gsa(p,p->epoch_active?&p->epoch:&scratch,&f,now))return false;if(p->epoch_active){p->epoch_gsa_valid=true;p->last_epoch_update_us=now;}return true;}
    if(strcmp(kind,"RMC")==0){
        if(f.count<10u)return false;
        if(f.field[2][0]=='A'){
            int32_t lat,lon;if(!coordinate_e7(f.field[3],f.field[4],true,&lat)||!coordinate_e7(f.field[5],f.field[6],false,&lon))return false;
            p->epoch.latitude_e7=lat;p->epoch.longitude_e7=lon;p->epoch.position_valid=true;
            if(!p->epoch_gsa_valid&&p->epoch.fix_type==SB_GNSS_FIX_NONE)p->epoch.fix_type=SB_GNSS_FIX_UNKNOWN;
        }else if(f.field[2][0]=='V'){p->epoch.position_valid=false;p->epoch.fix_type=SB_GNSS_FIX_NONE;}
        else return false;
        int64_t scaled=0;if(f.field[7][0]&&decimal_scaled(f.field[7],100u,false,&scaled)&&scaled>=0&&scaled<=UINT32_MAX){p->epoch.ground_speed_centi_kn=(uint32_t)scaled;p->epoch.ground_speed_valid=true;}
        if(f.field[8][0]&&decimal_scaled(f.field[8],100u,false,&scaled)&&scaled>=0&&scaled<=36000){p->epoch.course_centi_deg=(uint16_t)(scaled==36000?0:scaled);p->epoch.course_valid=true;}
        int64_t day=0;if(parse_date(f.field[9],&day)&&day<=INT64_MAX-(int64_t)tod){p->epoch.utc_us=day+(int64_t)tod;p->epoch.utc_valid=true;}
        p->epoch_has_valid_data=true;return true;
    }
    if(strcmp(kind,"GGA")==0){
        if(f.count<11u)return false;
        uint64_t quality=0,sats=0;if(!parse_uint(f.field[6],8u,&quality)||!parse_uint(f.field[7],UINT16_MAX,&sats))return false;
        p->epoch.satellites_used=(uint16_t)sats;p->epoch.satellites_valid=true;
        if(quality==0u){p->epoch.position_valid=false;if(p->epoch.fix_type==SB_GNSS_FIX_2D||p->epoch.fix_type==SB_GNSS_FIX_3D)p->epoch.fix_type=SB_GNSS_FIX_NONE;p->epoch_has_valid_data=true;return true;}
        int32_t lat,lon;if(!coordinate_e7(f.field[2],f.field[3],true,&lat)||!coordinate_e7(f.field[4],f.field[5],false,&lon))return false;
        p->epoch.latitude_e7=lat;p->epoch.longitude_e7=lon;p->epoch.position_valid=true;
        if(!p->epoch_gsa_valid&&p->epoch.fix_type==SB_GNSS_FIX_NONE)p->epoch.fix_type=SB_GNSS_FIX_UNKNOWN;
        int64_t altitude=0;if(strcmp(f.field[10],"M")==0&&decimal_scaled(f.field[9],100u,true,&altitude)&&altitude>=INT32_MIN&&altitude<=INT32_MAX){p->epoch.altitude_cm=(int32_t)altitude;p->epoch.altitude_valid=true;}
        p->epoch_has_valid_data=true;return true;
    }
    if(strcmp(kind,"VTG")==0){
        int64_t scaled=0;
        if(f.count>1u&&f.field[1][0]&&decimal_scaled(f.field[1],100u,false,&scaled)&&scaled>=0&&scaled<=36000){p->vtg_course_centi_deg=(uint16_t)(scaled==36000?0:scaled);p->vtg_course_valid=true;if(p->epoch_active){p->epoch.course_centi_deg=p->vtg_course_centi_deg;p->epoch.course_valid=true;}}
        if(f.count>5u&&f.field[5][0]&&decimal_scaled(f.field[5],100u,false,&scaled)&&scaled>=0&&scaled<=UINT32_MAX){p->vtg_speed_centi_kn=(uint32_t)scaled;p->vtg_speed_valid=true;if(p->epoch_active){p->epoch.ground_speed_centi_kn=p->vtg_speed_centi_kn;p->epoch.ground_speed_valid=true;}}
        p->vtg_update_us=now;
        if(p->epoch_active)p->last_epoch_update_us=now;
        return true;
    }
    return timed;
}

void sb_gnss_nmea_reset(sb_gnss_nmea_parser_t *p){if(p)memset(p,0,sizeof(*p));}

void sb_gnss_nmea_feed(sb_gnss_nmea_parser_t *p,const uint8_t *bytes,size_t length,uint64_t now,
                       sb_gnss_emit_fix_fn emit,void *context)
{
    if(p==NULL||(length!=0u&&bytes==NULL))return;
    for(size_t i=0;i<length;++i){uint8_t b=bytes[i];
        if(b=='$'){p->collecting=true;p->dropping=false;p->used=0;p->sentence[p->used++]='$';continue;}
        if(!p->collecting)continue;
        if(b=='\n'){
            if(!p->dropping){if(p->used&&p->sentence[p->used-1u]=='\r')--p->used;p->sentence[p->used]='\0';
                if(apply_sentence(p,p->sentence,now,emit,context)){if(p->valid_sentences!=UINT32_MAX)++p->valid_sentences;}else if(p->invalid_sentences!=UINT32_MAX)++p->invalid_sentences;}
            p->collecting=false;p->dropping=false;p->used=0;continue;
        }
        if(b=='\r')continue;
        if(p->used>=sizeof(p->sentence)-1u){p->dropping=true;p->collecting=false;if(p->overlength_sentences!=UINT32_MAX)++p->overlength_sentences;continue;}
        p->sentence[p->used++]=(char)b;
    }
}

void sb_gnss_nmea_tick(sb_gnss_nmea_parser_t *p,uint64_t now,sb_gnss_emit_fix_fn emit,void *context)
{
    if(p&&p->epoch_active&&now>=p->last_epoch_update_us&&now-p->last_epoch_update_us>=NMEA_EPOCH_SETTLE_US)emit_epoch(p,emit,context);
}
