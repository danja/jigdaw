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
    /// afterwards. Returns an empty string on success, or why not — a status
    /// this plugin's own module declares nonzero is reported as failure the
    /// same as an export that could not be called at all, since only the
    /// plugin author's own docs (jig:comment) say what a particular nonzero
    /// code means.
    std::string loadAsset(const std::string& key, const std::vector<uint8_t>& bytes);

    /// The jig:asset keys this module actually exports jig_load_<key> for —
    /// the profile may declare more than the module implements.
    std::vector<std::string> assetKeys() const;

    bool ready() const;
    uint32_t maxFrames() const;

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
