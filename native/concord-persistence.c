#define _GNU_SOURCE
#include <arpa/inet.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/rand.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <unistd.h>

/* No SQLite, caller paths, writable existing snapshot or filesystem fallback. */
#define STORE "/home/nur/Projects/archeagent-final-staging/.concord/publisher"
#define MAX_FRAME (24u * 1024u * 1024u)
#define MAX_GENERATIONS 512u
#define MAX_STORE (256u * 1024u * 1024u)
#define HEADER 52u
static int rootfd = -1, pause_stage;
static unsigned char key[32], prior[32];
static unsigned long generation;
static size_t store_bytes;
static unsigned char *latest;
static uint32_t latest_len;

static void die(void) { fputs("Persistence broker refused operation.\n", stderr); exit(1); }
static void allwrite(int fd, const void *data, size_t len) {
  const unsigned char *p = data;
  while (len) { ssize_t n = write(fd, p, len); if (n < 0 && errno == EINTR) continue; if (n <= 0) die(); p += n; len -= (size_t)n; }
}
static int allread(int fd, void *data, size_t len, int eof_ok) {
  unsigned char *p = data; size_t done = 0;
  while (done < len) { ssize_t n = read(fd, p + done, len - done); if (n < 0 && errno == EINTR) continue; if (n == 0 && done == 0 && eof_ok) return 0; if (n <= 0) die(); done += (size_t)n; }
  return 1;
}
static void sendframe(unsigned char kind, const void *data, uint32_t len) {
  uint32_t wire = htonl(len + 1); allwrite(1, &wire, 4); allwrite(1, &kind, 1); if (len) allwrite(1, data, len);
}
static void digest(const void *data, size_t len, unsigned char out[32]) {
  unsigned int size = 0; if (!EVP_Digest(data, len, out, &size, EVP_sha256(), NULL) || size != 32) die();
}
static void mac(const void *data, size_t len, unsigned char out[32]) {
  unsigned int size = 0; if (!HMAC(EVP_sha256(), key, 32, data, len, out, &size) || size != 32) die();
}
static int safeopen(const char *name, struct stat *stat) {
  int fd = openat(rootfd, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
  struct stat leaf;
  if (fd < 0 || fstat(fd, stat) || fstatat(rootfd, name, &leaf, AT_SYMLINK_NOFOLLOW) || !S_ISREG(stat->st_mode) || stat->st_uid != getuid() || stat->st_nlink != 1 || (stat->st_mode & 0777) != 0600 || stat->st_dev != leaf.st_dev || stat->st_ino != leaf.st_ino) die();
  return fd;
}
/* Anonymous inode is fully written/fsynced before any pathname exists. Existing
 * files are never truncated/updated, so a substituted alias cannot be written. */
static void publish(const char *name, const void *bytes, size_t len, int stages) {
  int fd = openat(rootfd, ".", O_TMPFILE | O_RDWR | O_CLOEXEC, 0600);
  if (fd < 0) die();
  allwrite(fd, bytes, len);
  if (fsync(fd)) die();
  if (stages && pause_stage == 1) { sendframe(2, "before-link", 11); raise(SIGSTOP); }
  if (linkat(fd, "", rootfd, name, AT_EMPTY_PATH)) die();
  if (stages && pause_stage == 2) { sendframe(2, "after-link", 10); raise(SIGSTOP); }
  if (fsync(rootfd)) die();
  if (stages && pause_stage == 3) { sendframe(2, "after-directory-sync", 20); raise(SIGSTOP); }
  if (close(fd)) die();
}
static void name_for(unsigned long number, char out[40]) {
  int n = snprintf(out, 40, "%020lu.snap", number); if (n != 25) die();
}
static struct dirent *next_entry(DIR *dir) {
  /* NULL means EOF only when errno remains clear for this exact call. An I/O
   * error must not turn a complete acknowledged chain into an older prefix. */
  errno = 0;
  struct dirent *entry = readdir(dir);
  if (!entry && errno) die();
  return entry;
}
static void recover(void) {
  DIR *dir = fdopendir(dup(rootfd)); if (!dir) die();
  unsigned long maximum = 0; unsigned int count = 0; struct dirent *entry;
  while ((entry = next_entry(dir))) {
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..") || !strcmp(entry->d_name, "authority.key") || !strcmp(entry->d_name, "owner.lock")) continue;
    unsigned long number = 0; char canonical[40];
    if (strlen(entry->d_name) != 25 || sscanf(entry->d_name, "%20lu.snap", &number) != 1 || number == 0 || number > MAX_GENERATIONS) die();
    name_for(number, canonical); if (strcmp(canonical, entry->d_name)) die();
    if (number > maximum) maximum = number;
    count++;
  }
  if (closedir(dir)) die();
  if (maximum != count) die(); /* No gaps and no fallback below corrupt newest. */
  for (unsigned long number = 1; number <= maximum; number++) {
    char name[40]; name_for(number, name); struct stat st;
    int fd = safeopen(name, &st);
    if (st.st_size < (off_t)(HEADER + 32) || st.st_size > (off_t)(MAX_FRAME + HEADER + 32)) die();
    size_t size = (size_t)st.st_size;
    unsigned char *bytes = malloc(size); if (!bytes) die(); allread(fd, bytes, size, 0); close(fd);
    unsigned char expected[32]; uint32_t wire; memcpy(&wire, bytes + 48, 4); uint32_t len = ntohl(wire);
    uint64_t seq = 0; for (unsigned int i = 0; i < 8; i++) seq = (seq << 8) | bytes[8 + i];
    if (memcmp(bytes, "ARCPSD1\0", 8) || seq != number || memcmp(bytes + 16, prior, 32) || len > MAX_FRAME || size != HEADER + (size_t)len + 32) die();
    mac(bytes, size - 32, expected); if (CRYPTO_memcmp(expected, bytes + size - 32, 32)) die();
    digest(bytes, size, prior); store_bytes += size; if (store_bytes > MAX_STORE) die();
    free(latest); latest = malloc(len ? len : 1); if (!latest) die(); memcpy(latest, bytes + HEADER, len); latest_len = len; generation = number; free(bytes);
  }
}
static void checkpoint(const unsigned char *data, uint32_t len) {
  if (!len || generation >= MAX_GENERATIONS || store_bytes + HEADER + len + 32 > MAX_STORE) die();
  size_t size = HEADER + (size_t)len + 32; unsigned char *bytes = calloc(1, size); if (!bytes) die();
  memcpy(bytes, "ARCPSD1\0", 8); uint64_t sequence = generation + 1;
  for (int i = 7; i >= 0; i--) { bytes[8 + i] = (unsigned char)sequence; sequence >>= 8; }
  memcpy(bytes + 16, prior, 32); uint32_t wire = htonl(len); memcpy(bytes + 48, &wire, 4); memcpy(bytes + HEADER, data, len); mac(bytes, size - 32, bytes + size - 32);
  char name[40]; name_for(generation + 1, name); publish(name, bytes, size, 1);
  digest(bytes, size, prior); generation++; store_bytes += size; free(latest); latest = malloc(len); if (!latest) die(); memcpy(latest, data, len); latest_len = len;
  unsigned char ack[40]; uint64_t seq = generation; for (int i = 7; i >= 0; i--) { ack[i] = (unsigned char)seq; seq >>= 8; } memcpy(ack + 8, prior, 32);
  free(bytes); sendframe(0, ack, 40); /* ACK follows file sync, atomic link, directory sync. */
}
int main(int argc, char **argv) {
  if (argc > 2 || (argc == 2 && strcmp(argv[1], "1") && strcmp(argv[1], "2") && strcmp(argv[1], "3"))) die();
  pause_stage = argc == 2 ? atoi(argv[1]) : 0;
  if (prctl(PR_SET_DUMPABLE, 0) || prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) die();
  umask(077); rootfd = open(STORE, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  struct stat rootstat; if (rootfd < 0 || fstat(rootfd, &rootstat) || rootstat.st_uid != getuid() || (rootstat.st_mode & 0777) != 0700) die();
  /* The pinned directory, not a replaceable leaf, owns publisher exclusion.
   * A late owner.lock replacement must not admit another publisher. */
  if (flock(rootfd, LOCK_EX | LOCK_NB)) die();
  int lock = openat(rootfd, "owner.lock", O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK, 0600);
  struct stat st; if (lock < 0 || fstat(lock, &st) || !S_ISREG(st.st_mode) || st.st_nlink != 1 || st.st_uid != getuid() || (st.st_mode & 0777) != 0600) die();
  int authority = openat(rootfd, "authority.key", O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
  if (authority < 0) {
    if (errno != ENOENT) die();
    /* A missing authority must not silently reset an existing history. */
    DIR *dir = fdopendir(dup(rootfd)); if (!dir) die(); struct dirent *entry;
    while ((entry = next_entry(dir))) if (strcmp(entry->d_name, ".") && strcmp(entry->d_name, "..") && strcmp(entry->d_name, "owner.lock")) die();
    if (closedir(dir)) die();
    if (RAND_bytes(key, 32) != 1) die();
    publish("authority.key", key, 32, 0);
  } else close(authority);
  authority = safeopen("authority.key", &st); if (st.st_size != 32) die(); allread(authority, key, 32, 0); close(authority); recover();
  for (;;) {
    uint32_t wire; if (!allread(0, &wire, 4, 1)) break; uint32_t len = ntohl(wire);
    if (!len || len > MAX_FRAME + 1) die();
    unsigned char *frame = malloc(len); if (!frame) die(); allread(0, frame, len, 0);
    if (frame[0] == 0 && len == 1) {
      unsigned char *result = malloc((size_t)latest_len + 8); if (!result) die(); uint64_t seq = generation;
      for (int i = 7; i >= 0; i--) { result[i] = (unsigned char)seq; seq >>= 8; } if (latest_len) memcpy(result + 8, latest, latest_len); sendframe(0, result, latest_len + 8); free(result);
    } else if (frame[0] == 1 && len > 1) checkpoint(frame + 1, len - 1);
    else die();
    free(frame);
  }
  OPENSSL_cleanse(key, 32); free(latest); close(lock); close(rootfd); return 0;
}
