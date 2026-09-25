// native/jigdaw-adapter/include/jigdaw/Module.hpp
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "jigdaw/Abi.hpp"
#include "jigdaw/Profile.hpp"

namespace jigdaw {

/// A loaded WebAssembly module, called through jig:Abi1 or jig:Abi2.
///
/// Everything this does is described in docs/module-abi.md. The only reason it
/// can exist is that the profile declares an ABI: without that a module is
/// private to its JavaScript processor and a native host has no way in.
class Module {
public:
    Module();
    ~Module();
    Module(Module&&) noexcept;
    Module& operator=(Module&&) noexcept;
    Module(const Module&) = delete;
    Module& operator=(const Module&) = delete;

    /// Compile, instantiate and call jig_init. Returns an empty string on
    /// success, or why it failed.
    std::string load(const std::vector<uint8_t>& wasm, const Profile& profile, double sampleRate);

    /// Write `bytes` into the module's buffer for `key` (a jig:asset's IRI
    /// fragment, e.g. "nam") and call its jig_load_<key>. Control thread only:
    /// like jig_init, a loader may allocate, and docs/for-hosts.md and
    /// ferrite's own jig_load_nam both note it may grow the module's linear
    /// memory, which this re-resolves every cached buffer pointer against
    /// afterwards.
    ///
    /// Returns an empty string on success, or why not. A negative status is
    /// always a failure (the byte parse or build itself did not happen); a
    /// non-negative, non-zero status is treated as success with a caveat
    /// (ferrite's own jig_load_nam and jig_load_ir both return 1 for "loaded,
    /// but this asset's own declared sample rate does not match the host's",
    /// with the asset already applied either way — no other convention is
    /// documented anywhere in this ABI, so 0-or-positive-succeeds is this
    /// host's one working example generalised, not a guess). `statusOut`,
    /// when given, receives the raw value jig_load_<key> returned whenever
    /// that call itself completed, on success or failure alike, so a caller
    /// that knows what a particular plugin's codes mean (only the plugin
    /// author's own docs, e.g. jig:comment, say — this ABI does not) can
    /// build a better message than the generic one returned here.
    std::string loadAsset(const std::string& key, const std::vector<uint8_t>& bytes,
                          int32_t* statusOut = nullptr);

    /// The jig:asset keys this module actually exports jig_load_<key> for —
    /// the profile may declare more than the module implements.
    std::vector<std::string> assetKeys() const;

    bool ready() const;
    uint32_t maxFrames() const;

    /// Frames by which this module's output lags its input, read from the
    /// optional jig_latency_frames export at load (docs/module-abi.md) and 0
    /// without it. The export reports for the rate jig_init was given, which
    /// is what the host compensates against; a module whose latency moves
    /// with its settings would need the messaging.md `latency` message this
    /// ABI has no equivalent of, and reports its load-time figure.
    uint32_t latencyFrames() const;

    /// Set a parameter by its jig:paramIndex. Cheap, but a plugin may retune on
    /// a write, so a host should only call it when the value changed.
    void setParam(uint32_t index, float value);

    void noteOn(uint8_t note, uint8_t velocity);
    void noteOff(uint8_t note);
    void allNotesOff();
    bool hasMidi() const;

    /// True when the module takes whole MIDI messages rather than notes alone.
    bool hasMidiIn() const;
    /// True when the module emits MIDI.
    bool hasMidiOut() const;
    /// True when the module reads a host transport.
    bool hasTransport() const;

    /// Hand over this block's incoming events, before process().
    ///
    /// Returns how many were delivered, which is fewer than `count` when the
    /// module's buffer is smaller. The earliest are kept: dropping those would
    /// turn a note on into an orphaned note off.
    uint32_t sendMidi(const MidiEvent* events, uint32_t count);

    /// What the last process() emitted. Valid until the next one.
    const MidiEvent* midiOut(uint32_t& count) const;

    /// The transport block to fill in before process(), or nullptr.
    Transport* transport();

    /// The module's own input buffer for a channel, or nullptr if it takes none.
    float* input(uint32_t channel);
    /// The module's own output buffer for a channel.
    const float* output(uint32_t channel) const;

    void process(uint32_t frames);

    // Opaque; only Module.cpp's own free functions and this class's members
    // ever name it. Forward-declared outside `private` (rather than nested
    // under it) purely so those free functions can take a `State&` — nothing
    // about State's actual shape is visible outside Module.cpp regardless.
    struct State;

private:
    std::unique_ptr<State> state_;
};

}  // namespace jigdaw
