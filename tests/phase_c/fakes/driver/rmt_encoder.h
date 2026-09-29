#pragma once
typedef void *rmt_encoder_handle_t;
typedef struct { int unused; } rmt_copy_encoder_config_t;
int rmt_new_copy_encoder(const rmt_copy_encoder_config_t *config,rmt_encoder_handle_t *encoder);
