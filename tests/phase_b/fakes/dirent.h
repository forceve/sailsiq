#pragma once
typedef struct fake_dir DIR;
struct dirent { char d_name[64]; };
DIR *opendir(const char *path);
struct dirent *readdir(DIR *dir);
int closedir(DIR *dir);
