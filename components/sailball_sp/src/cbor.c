#include "sailball/sp.h"
#include <string.h>

static bool read_argument(const uint8_t *d,size_t n,size_t *p,uint8_t ai,uint64_t *v)
{
    if(ai<24){*v=ai;return true;} size_t bytes=ai==24?1:ai==25?2:ai==26?4:ai==27?8:0;if(bytes==0||bytes>n-*p)return false;
    uint64_t x=0;for(size_t i=0;i<bytes;++i)x=(x<<8)|d[(*p)++];if((bytes==1&&x<24)||(bytes==2&&x<=UINT8_MAX)||(bytes==4&&x<=UINT16_MAX)||(bytes==8&&x<=UINT32_MAX))return false;*v=x;return true;
}
static bool skip_item(const uint8_t*d,size_t n,size_t*p,unsigned depth,sb_cbor_value_t *top)
{
    if(*p>=n)return false;
    uint8_t b=d[(*p)++],major=b>>5,ai=b&31;uint64_t arg=0;
    if(major==7){if(ai==20||ai==21){if(top){top->kind=SB_CBOR_BOOL;top->boolean=ai==21;}return true;}return false;}
    if(!read_argument(d,n,p,ai,&arg))return false;
    if(major==0||major==1){if(top){top->kind=major==0?SB_CBOR_UINT:SB_CBOR_NINT;if(major==0)top->u=arg;else if(arg<=INT64_MAX)top->i=-1-(int64_t)arg;else return false;}return true;}
    if(major==2||major==3){if(arg>n-*p)return false;if(major==3){for(uint64_t i=0;i<arg;++i){uint8_t c=d[*p+i];if(c>=0x80){unsigned extra=(c>=0xF0)?3u:(c>=0xE0)?2u:(c>=0xC2)?1u:99u;if(extra==99||i+extra>=arg)return false;uint32_t cp=c&((1u<<(6u-extra))-1u);for(unsigned j=1;j<=extra;++j){uint8_t cc=d[*p+i+j];if((cc&0xC0)!=0x80)return false;cp=(cp<<6)|(cc&0x3F);}if((extra==1&&cp<0x80)||(extra==2&&cp<0x800)||(extra==3&&cp<0x10000)||cp>0x10FFFF||(cp>=0xD800&&cp<=0xDFFF))return false;i+=extra;}}}if(top){top->kind=major==2?SB_CBOR_BYTES:SB_CBOR_TEXT;top->bytes=d+*p;top->length=(size_t)arg;}*p+=(size_t)arg;return true;}
    if(major==4||major==5){
        if(depth>6)return false;
        if(top){top->kind=major==4?SB_CBOR_ARRAY:SB_CBOR_MAP;top->u=arg;}
        if(major==4){
            for(uint64_t i=0;i<arg;++i)if(!skip_item(d,n,p,depth+1,NULL))return false;
            return true;
        }
        uint8_t seen[32]={0};
        for(uint64_t i=0;i<arg;++i){
            if(*p>=n)return false;
            uint8_t key_head=d[(*p)++];uint64_t key=0;
            if((key_head>>5)!=0||!read_argument(d,n,p,key_head&31u,&key)||key>255u)return false;
            uint8_t mask=(uint8_t)(1u<<(key&7u));uint8_t *byte=&seen[key>>3u];
            if((*byte&mask)!=0)return false;
            *byte|=mask;
            if(!skip_item(d,n,p,depth+1,NULL))return false;
        }
        return true;
    }
    return false;
}
bool sb_cbor_parse_map(const uint8_t*d,size_t n,sb_cbor_map_t*m)
{
    if(!d||!m||n==0)return false;
    memset(m,0,sizeof(*m));size_t p=0;uint8_t b=d[p++];uint64_t count;if((b>>5)!=5||!read_argument(d,n,&p,b&31,&count)||count>32)return false;
    m->data=d;m->length=n;m->count=(uint8_t)count;
    for(uint8_t i=0;i<m->count;++i){if(p>=n)return false;uint8_t keyhead=d[p++];uint64_t key;if((keyhead>>5)!=0||!read_argument(d,n,&p,keyhead&31,&key)||key>255)return false;
        for(uint8_t j=0;j<i;++j)if(m->key[j]==key)return false;
        m->key[i]=(uint8_t)key;
        size_t start=p;
        if(!skip_item(d,n,&p,2,&m->value[i]))return false;
        m->value[i].encoded=d+start;m->value[i].encoded_length=p-start;
    }
    return p==n;
}
const sb_cbor_value_t *sb_cbor_get(const sb_cbor_map_t*m,uint8_t key){if(!m)return NULL;for(uint8_t i=0;i<m->count;++i)if(m->key[i]==key)return &m->value[i];return NULL;}

bool sb_cbor_array_get(const sb_cbor_value_t *array,size_t index,sb_cbor_value_t *value)
{
    if(!array||!value||array->kind!=SB_CBOR_ARRAY||array->encoded==NULL||array->encoded_length==0)return false;
    size_t p=1;uint64_t count;
    if(!read_argument(array->encoded,array->encoded_length,&p,array->encoded[0]&31u,&count)||index>=count)return false;
    for(size_t i=0;i<=index;++i){size_t start=p;sb_cbor_value_t item={0};if(!skip_item(array->encoded,array->encoded_length,&p,3,&item))return false;
        if(i==index){item.encoded=array->encoded+start;item.encoded_length=p-start;*value=item;return true;}}
    return false;
}

static bool put_head(uint8_t*out,size_t cap,size_t*len,uint8_t major,uint64_t x)
{
    size_t n=x<24?1:x<=UINT8_MAX?2:x<=UINT16_MAX?3:x<=UINT32_MAX?5:9;if(!out||!len||*len>cap||n>cap-*len)return false;size_t p=*len;
    if(n==1)out[p++]=(uint8_t)((major<<5)|x);else if(n==2){out[p++]=(major<<5)|24;out[p++]=(uint8_t)x;}else if(n==3){out[p++]=(major<<5)|25;out[p++]=(uint8_t)(x>>8);out[p++]=(uint8_t)x;}else if(n==5){out[p++]=(major<<5)|26;for(int i=3;i>=0;--i)out[p++]=(uint8_t)(x>>(i*8));}else{out[p++]=(major<<5)|27;for(int i=7;i>=0;--i)out[p++]=(uint8_t)(x>>(i*8));}*len=p;return true;
}
bool sb_cbor_put_uint(uint8_t*out,size_t cap,size_t*len,uint64_t v){return put_head(out,cap,len,0,v);}
bool sb_cbor_put_int(uint8_t*out,size_t cap,size_t*len,int64_t v){return v>=0?put_head(out,cap,len,0,(uint64_t)v):put_head(out,cap,len,1,(uint64_t)(-(v+1)));}
bool sb_cbor_put_bool(uint8_t*out,size_t cap,size_t*len,bool v){if(!out||!len||*len>=cap)return false;out[(*len)++]=(uint8_t)(v?0xF5:0xF4);return true;}
bool sb_cbor_put_bytes(uint8_t*out,size_t cap,size_t*len,const void*b,size_t n){if((n&&!b)||!put_head(out,cap,len,2,n)||n>cap-*len)return false;memcpy(out+*len,b,n);*len+=n;return true;}
bool sb_cbor_put_text(uint8_t*out,size_t cap,size_t*len,const char*t,size_t n){if((n&&!t)||!put_head(out,cap,len,3,n)||n>cap-*len)return false;memcpy(out+*len,t,n);*len+=n;return true;}
bool sb_cbor_put_map(uint8_t*out,size_t cap,size_t*len,size_t pairs){return put_head(out,cap,len,5,pairs);}
bool sb_cbor_put_array(uint8_t*out,size_t cap,size_t*len,size_t count){return put_head(out,cap,len,4,count);}
