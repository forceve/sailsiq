#include "sailball/sp.h"

typedef struct { uint16_t service, command; uint8_t allowed_sources; } permission_t;
#define U (1u<<SB_SOURCE_USB)
#define B (1u<<SB_SOURCE_BLE)
#define W (1u<<SB_SOURCE_WIFI)
#define C (1u<<SB_SOURCE_CELLULAR)
static const permission_t s_matrix[] = {
 {1,1,U|B|W|C},{1,2,U|B|W|C},{1,3,U|B|W|C},{1,4,U|B|W|C},{1,5,U},
 {2,1,U|B|W|C},{2,2,U|B|W|C},{2,3,U},
 {3,1,U},{3,2,U},
 {4,1,U|B|W|C},{4,2,U|B|W|C},{4,3,U},{4,4,U},
 {5,1,U|B|W|C},{5,2,U|B|W|C},{5,3,U|B|W|C},
 {6,1,U|B|C},{6,2,U|B|W|C},{6,3,U|B|C},{6,4,U|B|C},{6,5,U|B|C},{6,6,U|B|C},
 {7,1,U|W|C},{7,2,U|W|C},
 {8,1,U|B|W|C},{8,2,U|B|W|C},{8,3,U},
 {9,1,U|B|W|C}
};
bool sb_sp_command_allowed(uint16_t service,uint16_t command,sb_source_t source)
{
    if((unsigned)source>=SB_SOURCE_COUNT)return false;
    for(size_t i=0;i<sizeof(s_matrix)/sizeof(s_matrix[0]);++i)
        if(s_matrix[i].service==service&&s_matrix[i].command==command)return (s_matrix[i].allowed_sources&(1u<<source))!=0;
    return false;
}
