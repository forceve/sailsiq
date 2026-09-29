#pragma once
struct stat { long long st_size; };
int fake_fstat(int fd, struct stat *out);
#define fstat fake_fstat
