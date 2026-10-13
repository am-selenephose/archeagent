#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/openat2.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>
#define ROOT "/home/nur/Projects/archeagent-final-staging"
#define BROKER ROOT "/.local-audit/native-persistence/broker"
static void die(void) { fputs("Persistence acquisition refused.\n", stderr); exit(1); }
static unsigned long long number(const char *value) {
  if (!*value) die();
  for (const char *p = value; *p; p++) if (*p < '0' || *p > '9') die();
  errno = 0; unsigned long long result = strtoull(value, NULL, 10); if (errno) die(); return result;
}
int main(int argc, char **argv) {
  if (argc < 4 || argc > 5 || strncmp(argv[1], "durable-store-", 14) || strlen(argv[1]) > 94 || strlen(argv[1]) < 15) die();
  for (const char *p = argv[1]; *p; p++) if (!((*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') || (*p >= '0' && *p <= '9') || *p == '-' || *p == '_')) die();
  if (argc == 5 && strcmp(argv[4], "1") && strcmp(argv[4], "2") && strcmp(argv[4], "3")) die();
  char filename[256]; if (snprintf(filename, sizeof(filename), "home/nur/Projects/archeagent-final-staging/.concord/test-harness/%s", argv[1]) >= (int)sizeof(filename)) die();
  int root = open("/", O_PATH | O_DIRECTORY | O_CLOEXEC); if (root < 0) die();
  struct open_how how = { .flags = O_RDONLY | O_DIRECTORY | O_CLOEXEC, .resolve = RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS };
  int fd = (int)syscall(SYS_openat2, root, filename, &how, sizeof(how)); close(root);
  struct stat st; if (fd < 0 || fstat(fd, &st) || !S_ISDIR(st.st_mode) || st.st_uid != getuid() || (st.st_mode & 0777) != 0700 || (unsigned long long)st.st_dev != number(argv[2]) || (unsigned long long)st.st_ino != number(argv[3])) die();
  if (fd != 3) { if (dup2(fd, 3) < 0) die(); close(fd); }
  if (fcntl(3, F_SETFD, 0)) die();
  char *args[] = { "/usr/bin/bwrap", "--unshare-all", "--unshare-user", "--die-with-parent", "--new-session", "--disable-userns", "--cap-drop", "ALL", "--clearenv",
    "--ro-bind", "/usr", "/usr", "--ro-bind", "/lib", "/lib", "--ro-bind", "/lib64", "/lib64", "--ro-bind", ROOT, ROOT,
    "--tmpfs", ROOT "/.concord", "--perms", "0700", "--dir", ROOT "/.concord/publisher",
    "--bind-fd", "3", ROOT "/.concord/publisher", "--remount-ro", ROOT "/.concord", "--proc", "/proc", "--remount-ro", "/proc", "--remount-ro", "/", "--chdir", ROOT,
    "--", BROKER, argc == 5 ? argv[4] : NULL, NULL };
  execv(args[0], args); die();
}
