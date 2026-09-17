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

private:
    struct State;
    std::unique_ptr<State> state_;
};

}  // namespace jigdaw
