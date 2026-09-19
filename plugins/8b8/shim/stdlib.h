// plugins/8b8/shim/stdlib.h
//
// The part of <stdlib.h> the firmware uses. See string.h for why there is no
// libc to take it from.
//
// The firmware calls atoi only from its serial command parser, which this
// build never feeds: parameters arrive through jig_set_param instead. It is
// here so the firmware compiles unedited, not because anything reaches it.
#pragma once

extern "C" {
int atoi (const char *s);
long strtol (const char *s, char **end, int base);
}
