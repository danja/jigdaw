// plugins/8b8/shim/nostdlib.cpp
//
// The handful of libc functions the firmware and the compiler need, for a
// build with no libc.
//
// clang emits calls to memcpy and memset for structure copies and array
// initialisation whatever the source says, so these are not optional even
// though the firmware's own uses are few.
#include <stddef.h>
#include <stdint.h>

extern "C" {

void *memcpy (void *dest, const void *src, size_t n) {
  unsigned char *d = (unsigned char *)dest;
  const unsigned char *s = (const unsigned char *)src;
  for (size_t i = 0; i < n; i++) d[i] = s[i];
  return dest;
}

void *memmove (void *dest, const void *src, size_t n) {
  unsigned char *d = (unsigned char *)dest;
  const unsigned char *s = (const unsigned char *)src;
  if (d == s || n == 0) return dest;
  if (d < s) { for (size_t i = 0; i < n; i++) d[i] = s[i]; }
  else       { for (size_t i = n; i-- > 0;)   d[i] = s[i]; }
  return dest;
}

void *memset (void *dest, int value, size_t n) {
  unsigned char *d = (unsigned char *)dest;
  for (size_t i = 0; i < n; i++) d[i] = (unsigned char)value;
  return dest;
}

int memcmp (const void *a, const void *b, size_t n) {
  const unsigned char *x = (const unsigned char *)a;
  const unsigned char *y = (const unsigned char *)b;
  for (size_t i = 0; i < n; i++) if (x[i] != y[i]) return (int)x[i] - (int)y[i];
  return 0;
}

size_t strlen (const char *s) {
  size_t n = 0;
  while (s[n]) n++;
  return n;
}

int strcmp (const char *a, const char *b) {
  while (*a && *a == *b) { a++; b++; }
  return (int)(unsigned char)*a - (int)(unsigned char)*b;
}

int strncmp (const char *a, const char *b, size_t n) {
  for (size_t i = 0; i < n; i++) {
    if (a[i] != b[i]) return (int)(unsigned char)a[i] - (int)(unsigned char)b[i];
    if (a[i] == 0) return 0;
  }
  return 0;
}

char *strchr (const char *s, int c) {
  for (;; s++) {
    if (*s == (char)c) return (char *)s;
    if (*s == 0) return nullptr;
  }
}

long strtol (const char *s, char **end, int base) {
  while (*s == ' ' || *s == '\t' || *s == '\n' || *s == '\r') s++;
  int sign = 1;
  if (*s == '-') { sign = -1; s++; }
  else if (*s == '+') s++;
  if (base != 10) base = 10;   // the firmware parses decimal and nothing else
  long value = 0;
  while (*s >= '0' && *s <= '9') value = value * 10 + (*s++ - '0');
  if (end) *end = (char *)s;
  return sign * value;
}

int atoi (const char *s) { return (int)strtol(s, nullptr, 10); }

}
