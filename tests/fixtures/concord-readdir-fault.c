#define _GNU_SOURCE
#include <dirent.h>
#include <dlfcn.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>

/* Test-only syscall fault. No production launcher accepts LD_PRELOAD. */
static int saw_snapshot;
struct dirent *readdir(DIR *dir) {
  static struct dirent *(*original)(DIR *);
  if (!original) original = dlsym(RTLD_NEXT, "readdir");
  if (saw_snapshot) {
    errno = EIO;
    fputs("TEST_READDIR_EIO\n", stderr);
    return NULL;
  }
  struct dirent *entry = original(dir);
  if (entry && !strcmp(entry->d_name, "00000000000000000001.snap")) saw_snapshot = 1;
  return entry;
}
