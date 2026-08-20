/*
 * GNFPHash native worker — cpuminer-opt style tight SHA-256 loop.
 * Eight sequential rounds stay (GPU/ASIC brake). Faster than Node crypto.
 *
 * Wire protocol on stdout (one JSON line per find):
 *   {"type":"share","nonce":"..."}
 *   {"type":"hashed","n":N}
 * stdin: {"type":"job","job":{...}} / {"type":"stop"}
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <ctype.h>

#if defined(__APPLE__)
#include <CommonCrypto/CommonDigest.h>
#define SHA256_DIGEST_LENGTH CC_SHA256_DIGEST_LENGTH
static void sha256(const void *data, size_t len, unsigned char out[32]) {
  CC_SHA256(data, (CC_LONG)len, out);
}
#else
#include <openssl/sha.h>
static void sha256(const void *data, size_t len, unsigned char out[32]) {
  SHA256((const unsigned char *)data, len, out);
}
#endif

#define CPU_HASH_ROUNDS 8
#define PERSONAL "GNFPHash-v1"
#define ALGO "GNFPHash"

static int meets_target(const unsigned char *hash, int bits) {
  if (bits <= 0) return 1;
  if (bits > 256) bits = 256;
  int full = bits / 8;
  int rem = bits % 8;
  for (int i = 0; i < full; i++) {
    if (hash[i] != 0) return 0;
  }
  if (!rem) return 1;
  return hash[full] < (1 << (8 - rem));
}

static void nonce_hex16(uint64_t n, char out[16]) {
  static const char *hex = "0123456789abcdef";
  for (int i = 15; i >= 0; i--) {
    out[i] = hex[n & 15];
    n >>= 4;
  }
}

static void gnfp_hash(const char *pre, size_t pre_len, const char nonce[16], unsigned char out[32]) {
  unsigned char acc[32];
  size_t cap = 32 + sizeof(PERSONAL) + 8 + pre_len + 16 + 64;
  unsigned char *buf = (unsigned char *)malloc(cap);
  if (!buf) return;
  size_t n = 0;
  memcpy(buf + n, PERSONAL, strlen(PERSONAL)); n += strlen(PERSONAL);
  memcpy(buf + n, ALGO, strlen(ALGO)); n += strlen(ALGO);
  memcpy(buf + n, pre, pre_len); n += pre_len;
  memcpy(buf + n, nonce, 16); n += 16;
  sha256(buf, n, acc);
  for (int r = 0; r < CPU_HASH_ROUNDS; r++) {
    n = 0;
    memcpy(buf + n, acc, 32); n += 32;
    memcpy(buf + n, PERSONAL, strlen(PERSONAL)); n += strlen(PERSONAL);
    buf[n++] = (unsigned char)('0' + r);
    memcpy(buf + n, pre, pre_len); n += pre_len;
    memcpy(buf + n, nonce, 16); n += 16;
    sha256(buf, n, acc);
  }
  memcpy(out, acc, 32);
  free(buf);
}

static void run_batch(const char *pre, int bits, uint64_t start, uint64_t count, uint64_t stride) {
  size_t pre_len = strlen(pre);
  uint64_t found = 0;
  for (uint64_t i = 0; i < count; i++) {
    char nonce[16];
    nonce_hex16(start + i * stride, nonce);
    unsigned char hash[32];
    gnfp_hash(pre, pre_len, nonce, hash);
    if (meets_target(hash, bits)) {
      fwrite("{\"type\":\"share\",\"nonce\":\"", 1, 25, stdout);
      fwrite(nonce, 1, 16, stdout);
      fwrite("\"}\n", 1, 3, stdout);
      found++;
    }
  }
  printf("{\"type\":\"hashed\",\"n\":%llu,\"found\":%llu}\n",
         (unsigned long long)count, (unsigned long long)found);
  fflush(stdout);
}

int main(int argc, char **argv) {
  if (argc > 1) {
    const char *pre = argv[1];
    int bits = argc > 2 ? atoi(argv[2]) : 14;
    uint64_t start = argc > 3 ? strtoull(argv[3], NULL, 10) : 0;
    uint64_t count = argc > 4 ? strtoull(argv[4], NULL, 10) : 4096;
    uint64_t stride = argc > 5 ? strtoull(argv[5], NULL, 10) : 1;
    run_batch(pre, bits, start, count, stride);
    return 0;
  }
  /* Persistent worker: one JSON line per batch on stdin. */
  char line[4096];
  char pre[512];
  while (fgets(line, sizeof(line), stdin)) {
    if (strstr(line, "\"stop\"")) return 0;
    const char *p = strstr(line, "\"pre\":\"");
    pre[0] = 0;
    if (p) {
      p += 7;
      size_t n = 0;
      while (*p && *p != '"' && n + 1 < sizeof(pre)) pre[n++] = *p++;
      pre[n] = 0;
    }
    int bits = 14;
    const char *b = strstr(line, "\"bits\":");
    if (b) bits = atoi(b + 7);
    uint64_t start = 0, count = 8192, stride = 1;
    const char *s = strstr(line, "\"start\":");
    if (s) start = strtoull(s + 8, NULL, 10);
    const char *c = strstr(line, "\"count\":");
    if (c) count = strtoull(c + 8, NULL, 10);
    const char *st = strstr(line, "\"stride\":");
    if (st) stride = strtoull(st + 9, NULL, 10);
    if (stride < 1) stride = 1;
    run_batch(pre, bits, start, count, stride);
  }
  return 0;
}
