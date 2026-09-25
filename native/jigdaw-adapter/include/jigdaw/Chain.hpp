// native/jigdaw-adapter/include/jigdaw/Chain.hpp
#pragma once

#include <algorithm>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "jigdaw/Abi.hpp"
#include "jigdaw/Module.hpp"
#include "jigdaw/Profile.hpp"

namespace jigdaw {

/// One loaded plugin and what the host needs to know about it.
struct Slot {
    Profile profile;
    std::unique_ptr<Module> module;
    std::vector<Port> ports;   ///< sorted by index
    int firstParameter = 0;     ///< where this plugin's parameters start in the flat list
};

/// A chain of JigDAW plugins, loaded from their IRIs and run in order.
///
/// Built entirely on the message thread and handed to the audio thread as a
/// finished object. Nothing here allocates once processing starts, and the
/// audio thread never touches a Chain it is not already holding.
class Chain {
public:
    /// Load a plugin and append it. Returns empty on success, or why not.
    std::string add(const std::string& iri, double sampleRate);

    /// Run the whole chain over one block, in place.
    ///
    /// `audio` is the host's buffers, which are read and written. Each plugin
    /// reads what the last one wrote, which is what makes it a chain.
    ///
    /// `in` is the host's MIDI for this block, in ascending frame order. A
    /// plugin that accepts MIDI receives it, along with whatever the plugins
    /// before it emitted, so a generator can drive an instrument further down
    /// the chain. After the call, midiOut() is what the chain produced.
    void process(float** audio, int channels, uint32_t frames,
                 const MidiEvent* in = nullptr, uint32_t inCount = 0);

    /// What the last process() emitted, which is what the plugins generated and
    /// never an echo of what the host sent in. Valid until the next process().
    const MidiEvent* midiOut(uint32_t& count) const;

    /// Filled in by the host before process(). Copied to every plugin that asked
    /// for a transport.
    Transport& transport() { return transport_; }

    /// True when some plugin in the chain emits MIDI.
    bool producesMidi() const;

    void noteOn(uint8_t note, uint8_t velocity);
    void noteOff(uint8_t note);
    void allNotesOff();

    /// The flat parameter list, in load order. A native host has no way to
    /// present a plugin's own panel, so every parameter is exposed in a line.
    const std::vector<Port>& parameters() const { return flat_; }
    void setParameter(size_t index, float value);

    size_t size() const { return slots_.size(); }
    const Slot& at(size_t i) const { return *slots_[i]; }
    uint32_t maxFrames() const { return maxFrames_; }

    /// Frames by which the chain's output lags its input: the sum of what
    /// each module reports, because they run in series and every one delays
    /// what the next one hears. A module's jig_latency_frames export wins
    /// where it exists; otherwise its profile's declared figure stands.
    uint32_t latencyFrames() const {
        uint32_t total = 0;
        for (const auto& slot : slots_) {
            const uint32_t reported = slot->module->latencyFrames();
            total += reported > 0 ? reported : static_cast<uint32_t>(std::max(0, slot->profile.latencyFrames));
        }
        return total;
    }

    /// Fetch and verify, without loading. Exposed so a caller can report each
    /// step separately, which is what makes a failure diagnosable.
    static std::string fetchProfile(const std::string& iri, Profile& into);

private:
    /// Hand one block's events to a slot, whichever ABI it speaks.
    void deliver(Slot& slot, const MidiEvent* events, uint32_t count);

    /// The transport as it stands `offset` frames into the current block.
    Transport transportAt(uint32_t offset) const;

    std::vector<std::unique_ptr<Slot>> slots_;
    std::vector<Port> flat_;
    uint32_t maxFrames_ = 128;
    double sampleRate_ = 0.0;   ///< needed to advance the transport across sub-blocks

    Transport transport_;

    /// Preallocated at load, never resized while processing. A chain that ran
    /// out of room drops the latest events rather than allocating on the audio
    /// thread, which is the one thing it must never do.
    static constexpr uint32_t kEventCapacity = 512;
    std::vector<MidiEvent> pending_;   ///< what the next plugin will receive
    std::vector<MidiEvent> emitted_;   ///< what the chain hands back
    uint32_t pendingCount_ = 0;
    uint32_t emittedCount_ = 0;
};

}  // namespace jigdaw
