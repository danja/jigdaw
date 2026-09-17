// native/jigdaw-adapter/include/jigdaw/Abi.hpp
#pragma once

#include <cstddef>
#include <cstdint>

namespace jigdaw {

/// The ABI IRIs, as a profile declares them.
constexpr const char* kAbi1 = "http://purl.org/stuff/jigdaw/Abi1";
constexpr const char* kAbi2 = "http://purl.org/stuff/jigdaw/Abi2";

/// One MIDI message, exactly as docs/module-abi.md lays it out.
///
/// `frame` is an offset within the block being processed and is meaningless
/// once that block has passed. It is not a stream position.
struct MidiEvent {
    uint32_t frame = 0;
    uint8_t size = 0;      ///< 1 to 3; anything else is ignored
    uint8_t data[3] = {0, 0, 0};
};
static_assert(sizeof(MidiEvent) == 8, "the ABI fixes a MIDI event at 8 bytes");

/// Which transport fields the host actually knows.
///
/// A bit field because a zero is not distinguishable from a genuine zero, and
/// because hosts differ: a JACK client gets bar, beat and tick only when
/// something on the graph is a timebase master.
enum TransportValid : uint32_t {
    kTransportBpm = 1,
    kTransportBeat = 2,
    kTransportBbt = 4,
    kTransportMeter = 8,
    kTransportSeconds = 16
};

/// The 64 byte transport block a host fills in before each jig_process.
///
/// A block rather than an argument list, because a transport grows new fields
/// and a signature cannot. The member order is the byte layout, and the static
/// assertions below are what stop a careless edit shifting every field by four.
struct Transport {
    uint32_t playing = 0;
    uint32_t ticksPerBeat = 0;
    double bpm = 120.0;
    double beat = 0.0;
    double barStartBeat = 0.0;
    int32_t bar = 1;
    int32_t beatInBar = 1;
    int32_t tick = 0;
    int32_t numerator = 4;
    int32_t denominator = 4;
    uint32_t valid = 0;
    double seconds = 0.0;
};
static_assert(sizeof(Transport) == 64, "the ABI fixes the transport block at 64 bytes");
static_assert(offsetof(Transport, bpm) == 8, "transport layout");
static_assert(offsetof(Transport, beat) == 16, "transport layout");
static_assert(offsetof(Transport, barStartBeat) == 24, "transport layout");
static_assert(offsetof(Transport, bar) == 32, "transport layout");
static_assert(offsetof(Transport, valid) == 52, "transport layout");
static_assert(offsetof(Transport, seconds) == 56, "transport layout");

}  // namespace jigdaw
