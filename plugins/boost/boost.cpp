// plugins/boost/boost.cpp
//
// A minimal jig:Abi1 module, in C++, meant to be copied. It does one thing,
// gain, so that changing jig_process is the whole job of starting a new
// WebAssembly plugin from here: everything else below is ABI wiring, which
// docs/module-abi.md specifies and every worked plugin repeats regardless of
// what it actually does.
//
// Compiled with clang++ --target=wasm32 -nostdlib (see build.sh): no libc,
// and nothing here calls one. A plugin whose own DSP needs one (memcpy,
// memset, floating point intrinsics libgcc would normally supply) is what
// plugins/8b8/shim/ is for; copy from there instead if jig_process needs
// something this file does not.
// stdint.h rather than <cstdint>: a freestanding header clang always
// supplies, unlike <cstdint>, which lives in a C++ standard library this
// -nostdlib build has none of. plugins/8b8/8b8.cpp does the same.
#include <stdint.h>

namespace {
constexpr uint32_t kMaxFrames = 128;
constexpr int kChannels = 2;

// Preallocated, never resized: docs/module-abi.md's "a module MUST NOT grow
// its memory after jig_init" rule, and the reason this project's real-time
// rules forbid an allocator in the first place. A host takes these pointers
// once and holds them for the module's whole lifetime.
float inputBuffer[kChannels][kMaxFrames];
float outputBuffer[kChannels][kMaxFrames];

float gain = 1.0f;
}  // namespace

extern "C" {

void jig_init(float) {
  // A gain stage has no time constant, so the sample rate is unused. A
  // filter or an oscillator would set one up here, once, before anything
  // else runs.
}

uint32_t jig_max_frames() { return kMaxFrames; }

uint32_t jig_input_ptr(uint32_t channel) {
  return reinterpret_cast<uint32_t>(&inputBuffer[channel < kChannels ? channel : 0][0]);
}

uint32_t jig_output_ptr(uint32_t channel) {
  return reinterpret_cast<uint32_t>(&outputBuffer[channel < kChannels ? channel : 0][0]);
}

void jig_set_param(uint32_t index, float value) {
  if (index == 0) gain = value;
}

// The one line that is actually DSP. Everything above exists so that a host
// can find this buffer, fill it, and read what this function wrote.
void jig_process(uint32_t frames) {
  if (frames > kMaxFrames) frames = kMaxFrames;
  for (int channel = 0; channel < kChannels; channel++) {
    for (uint32_t i = 0; i < frames; i++) {
      outputBuffer[channel][i] = inputBuffer[channel][i] * gain;
    }
  }
}

}  // extern "C"
