// plugins/sam/shim/stdlib.h
//
// The part of <stdlib.h> SAM uses. See string.h for why there is no libc.
#pragma once

static inline int abs (int x) { return x < 0 ? -x : x; }
