#include "sailball/sp.h"

bool sb_cobs_encode(const uint8_t *in,size_t n,uint8_t *out,size_t cap,size_t *written)
{
    if ((n && in==NULL)||out==NULL||written==NULL||cap==0) return false;
    size_t read=0,code_at=0,write=1;uint8_t code=1;
    while(read<n){
        if(in[read]==0){out[code_at]=code;++read;if(write>=cap)return false;code_at=write++;code=1;}
        else{if(write>=cap)return false;out[write++]=in[read++];++code;
            if(code==0xFF&&read<n){out[code_at]=code;if(write>=cap)return false;code_at=write++;code=1;}}
    }
    out[code_at]=code;*written=write;return true;
}
bool sb_cobs_decode(const uint8_t *in,size_t n,uint8_t *out,size_t cap,size_t *written)
{
    if(in==NULL||out==NULL||written==NULL||n==0)return false;
    size_t r=0,w=0;
    while(r<n){uint8_t code=in[r++];if(code==0)return false;size_t count=(size_t)code-1u;if(count>n-r||count>cap-w)return false;
        for(size_t i=0;i<count;++i){if(in[r]==0)return false;out[w++]=in[r++];}
        if(code!=0xFF&&r<n){if(w>=cap)return false;out[w++]=0;}}
    *written=w;return true;
}
