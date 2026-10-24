// plugins/sam/shim/stdio.h
//
// SAM's debug branches call printf behind `if (debug)`, and debug is never
// set here. The macro makes them compile to nothing; there is no libc to
// link a real one from (see string.h).
#pragma once
#define printf(...) ((void)0)
