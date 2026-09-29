#pragma once
typedef struct sdmmc_card { int dummy; } sdmmc_card_t;
typedef struct sdmmc_host { int slot; } sdmmc_host_t;
#define SDSPI_HOST_DEFAULT() ((sdmmc_host_t){0})
