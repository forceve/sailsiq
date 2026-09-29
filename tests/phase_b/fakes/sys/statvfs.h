#pragma once
struct statvfs { unsigned long long f_blocks, f_frsize, f_bavail; };
int statvfs(const char *path, struct statvfs *out);
