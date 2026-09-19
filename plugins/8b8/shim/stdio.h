// plugins/8b8/shim/stdio.h
//
// Nothing. arduino_shim.h in the 8b8 emulator includes <stdio.h> for the
// snprintf its serial formatter uses; the shim here formats nothing, so the
// header exists only to satisfy an include that would otherwise reach a libc
// this build does not link.
#pragma once
