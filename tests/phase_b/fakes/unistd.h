#pragma once
#include <stddef.h>
typedef long long off_t;
typedef long long ssize_t;
int fake_open(const char *path, int flags, ...);
ssize_t fake_write(int fd, const void *data, size_t size);
ssize_t fake_read(int fd, void *data, size_t size);
off_t fake_lseek(int fd, off_t offset, int whence);
int fake_fsync(int fd);
int fake_close(int fd);
int fake_unlink(const char *path);
#define open(...) fake_open(__VA_ARGS__)
#define write(...) fake_write(__VA_ARGS__)
#define read(...) fake_read(__VA_ARGS__)
#define lseek(...) fake_lseek(__VA_ARGS__)
#define fsync(...) fake_fsync(__VA_ARGS__)
#define close(...) fake_close(__VA_ARGS__)
#define unlink(...) fake_unlink(__VA_ARGS__)
