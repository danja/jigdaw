// plugins/8b8/shim/string.h
//
// The part of <string.h> the firmware uses, for a freestanding wasm build.
//
// There is no libc here. The module is linked with -nostdlib because
// docs/module-abi.md requires a module to instantiate with no imports, and a
// libc brings in imports for things a plugin has no business doing anyway.
// The definitions are in nostdlib.cpp.
#pragma once
#include <stddef.h>

extern "C" {
void *memcpy (void *dest, const void *src, size_t n);
void *memmove (void *dest, const void *src, size_t n);
void *memset (void *dest, int value, size_t n);
int memcmp (const void *a, const void *b, size_t n);
size_t strlen (const char *s);
int strcmp (const char *a, const char *b);
int strncmp (const char *a, const char *b, size_t n);
char *strchr (const char *s, int c);
}
