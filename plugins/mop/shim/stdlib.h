// plugins/mop/shim/stdlib.h
//
// The part of <stdlib.h> the module uses. See string.h for why there is no
// libc to take it from.
#pragma once

#ifdef __cplusplus
extern "C" {
#endif
int atoi (const char *s);
long strtol (const char *s, char **end, int base);
#ifdef __cplusplus
}
#endif
