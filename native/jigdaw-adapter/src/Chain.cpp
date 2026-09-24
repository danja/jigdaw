// native/jigdaw-adapter/src/Chain.cpp
#include "jigdaw/Chain.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>

#include "jigdaw/Fetch.hpp"
#include "jigdaw/Integrity.hpp"
#include "jigdaw/Midi.hpp"

namespace jigdaw {

std::string Chain::fetchProfile(const std::string& iri, Profile& into) {
    // Turtle first, JSON-LD second, exactly as a browser host asks.
    const auto response = fetchUrl(iri, "text/turtle, application/ld+json;q=0.9");
    if (!response.ok) return response.error;

    // The syntax is decided by looking at the content, not by trusting the
    // media type: a .ttl served as text/plain is what most static hosts return.
    auto parsed = parseProfile(response.body, iri);
    if (!parsed.ok) return parsed.error;

    into = std::move(parsed.profile);
    return {};
}

std::string Chain::add(const std::string& iri, double sampleRate) {
    Profile profile;
    if (auto error = fetchProfile(iri, profile); !error.empty()) return error;

    if (!profile.module) {
        return profile.label + " declares no WebAssembly module, so there is nothing to run here";
    }

    const auto wasm = fetchUrl(profile.module->location);
    if (!wasm.ok) return wasm.error;

    // Contract section 3.2: verified before anything is instantiated, and no
    // way to skip.
    if (auto bad = verifyIntegrity(wasm.bytes, profile.module->integrity); !bad.empty()) {
        return profile.label + ": " + bad;
    }

    // Preallocated the first time anything loads, so processing never does.
    if (pending_.empty()) {
        pending_.resize(kEventCapacity);
        emitted_.resize(kEventCapacity);
    }

    auto slot = std::make_unique<Slot>();
    slot->module = std::make_unique<Module>();
    if (auto error = slot->module->load(wasm.bytes, profile, sampleRate); !error.empty()) {
        return profile.label + ": " + error;
    }

    // docs/for-hosts.md: a jig:asset is fetched and verified exactly like the
    // module, and loaded before the plugin sees any real audio — a default
    // shipped by the profile's own author, not yet a person's replacement.
    // Every one of them is control-thread work, same as everything above.
    for (const auto& asset : profile.assets) {
        const auto bytes = fetchUrl(asset.resource.location);
        if (!bytes.ok) {
            return profile.label + ": could not fetch \"" + asset.key + "\": " + bytes.error;
        }
        if (auto bad = verifyIntegrity(bytes.bytes, asset.resource.integrity); !bad.empty()) {
            return profile.label + ": \"" + asset.key + "\": " + bad;
        }
        if (auto error = slot->module->loadAsset(asset.key, bytes.bytes); !error.empty()) {
            return profile.label + ": \"" + asset.key + "\": " + error;
        }
    }

    slot->profile = profile;
    slot->ports = profile.portsByIndex();
    slot->firstParameter = static_cast<int>(flat_.size());
    for (const auto& port : slot->ports) flat_.push_back(port);

    sampleRate_ = sampleRate;
    maxFrames_ = slots_.empty() ? slot->module->maxFrames()
                                : std::min(maxFrames_, slot->module->maxFrames());
    slots_.push_back(std::move(slot));
    return {};
}

void Chain::setParameter(size_t index, float value) {
    if (index >= flat_.size()) return;
    // Which plugin owns this parameter, and which of its indices it is.
    for (const auto& slot : slots_) {
        const size_t begin = static_cast<size_t>(slot->firstParameter);
        const size_t end = begin + slot->ports.size();
        if (index >= begin && index < end) {
            const auto& port = slot->ports[index - begin];
            const float clamped = std::min(port.maximum, std::max(port.minimum, value));
            slot->module->setParam(static_cast<uint32_t>(port.index), clamped);
            return;
        }
    }
}

void Chain::noteOn(uint8_t note, uint8_t velocity) {
    for (const auto& slot : slots_) if (slot->module->hasMidi()) slot->module->noteOn(note, velocity);
}

void Chain::noteOff(uint8_t note) {
    for (const auto& slot : slots_) if (slot->module->hasMidi()) slot->module->noteOff(note);
}

void Chain::allNotesOff() {
    for (const auto& slot : slots_) if (slot->module->hasMidi()) slot->module->allNotesOff();
}

bool Chain::producesMidi() const {
    for (const auto& slot : slots_) if (slot->module->hasMidiOut()) return true;
    return false;
}

const MidiEvent* Chain::midiOut(uint32_t& count) const {
    count = emittedCount_;
    return emitted_.empty() ? nullptr : emitted_.data();
}

void Chain::deliver(Slot& slot, const MidiEvent* events, const uint32_t count) {
    Module& module = *slot.module;
    if (count == 0) return;

    if (module.hasMidiIn()) {
        module.sendMidi(events, count);
        return;
    }

    // A version 1 module knows notes and nothing else. Decoding here rather
    // than at the host edge means one MIDI path for both ABIs, and a plugin
    // author can move to version 2 without the host changing.
    if (!module.hasMidi()) return;
    for (uint32_t i = 0; i < count; ++i) {
        applyMidi(module, events[i].data, events[i].size);
    }
}

/// The transport as it stands `offset` frames into the block.
///
/// A module is entitled to know where it is, and a host that fills the block in
/// once and then runs eight sub-blocks has told it the same lie eight times.
/// Only fields the host marked valid are advanced: deriving a bar number from a
/// beat the host never gave us would be inventing one.
Transport Chain::transportAt(uint32_t offset) const {
    Transport at = transport_;
    if (offset == 0 || sampleRate_ <= 0.0) return at;

    const double seconds = static_cast<double>(offset) / sampleRate_;
    if (at.valid & kTransportSeconds) at.seconds = transport_.seconds + seconds;
    if (!(at.valid & kTransportBeat) || !(at.valid & kTransportBpm)) return at;

    at.beat = transport_.beat + seconds * (transport_.bpm / 60.0);
    if (!(at.valid & kTransportBbt) || !(at.valid & kTransportMeter)) return at;

    // Walk whole bars rather than dividing, because the meter can only be
    // trusted for the bar we were given and a block is never many bars long.
    const double beatsPerBar = transport_.numerator > 0 ? transport_.numerator : 4;
    while (at.beat >= at.barStartBeat + beatsPerBar) {
        at.barStartBeat += beatsPerBar;
        at.bar += 1;
    }
    const double intoBar = at.beat - at.barStartBeat;
    at.beatInBar = static_cast<int32_t>(intoBar) + 1;
    at.tick = at.ticksPerBeat > 0
        ? static_cast<int32_t>((intoBar - std::floor(intoBar)) * at.ticksPerBeat)
        : 0;
    return at;
}

void Chain::process(float** audio, int channels, uint32_t frames,
                    const MidiEvent* in, uint32_t inCount) {
    emittedCount_ = 0;
    pendingCount_ = 0;
    if (slots_.empty() || frames == 0) return;

    // A module states the largest block it will accept and maxFrames_ is the
    // smallest of those over the chain, so the host's block is processed in
    // pieces that every plugin can take.
    //
    // This loop is the whole point. Before it existed the chain processed
    // min(frames, maxFrames) once and left the rest of the host's buffer as it
    // found it: at a 512 frame buffer, with every worked plugin reporting 128,
    // three quarters of every block was stale, and the MIDI and the transport
    // were handled once for the lot.
    const uint32_t limit = maxFrames_ > 0 ? maxFrames_ : frames;

    for (uint32_t offset = 0; offset < frames; offset += limit) {
        const uint32_t block = std::min(limit, frames - offset);
        const Transport now = transportAt(offset);

        // The host's events for this sub-block, rebased onto it. A module is
        // told where an event falls within the block it is being given, and
        // after splitting that is no longer where it falls in the host's.
        pendingCount_ = 0;
        for (uint32_t i = 0; i < inCount && in != nullptr; ++i) {
            if (in[i].frame < offset || in[i].frame >= offset + block) continue;
            if (pendingCount_ >= kEventCapacity) break;
            MidiEvent rebased = in[i];
            rebased.frame -= offset;
            pending_[pendingCount_++] = rebased;
        }

        for (const auto& slot : slots_) {
            Module& module = *slot->module;

            if (Transport* into = module.transport()) *into = now;

            deliver(*slot, pending_.data(), pendingCount_);

            // An instrument takes no audio: it replaces what is there rather
            // than adding to it, which is why the input copy is conditional.
            if (slot->profile.audioInputs > 0) {
                for (int channel = 0; channel < slot->profile.inputChannels; ++channel) {
                    float* into = module.input(static_cast<uint32_t>(channel));
                    if (into == nullptr) continue;
                    const int source = std::min(channel, channels - 1);
                    std::memcpy(into, audio[source] + offset, block * sizeof(float));
                }
            }

            module.process(block);

            // A plugin with no audio output leaves what is passing through it
            // untouched. A MIDI generator has nothing to write and version 2
            // lets it say so; writing silence instead would mute the chain.
            if (slot->profile.audioOutputs > 0) {
                for (int channel = 0; channel < channels; ++channel) {
                    const float* from = module.output(static_cast<uint32_t>(channel));
                    if (from == nullptr) continue;
                    std::memcpy(audio[channel] + offset, from, block * sizeof(float));
                }
            }

            if (!module.hasMidiOut()) continue;

            uint32_t produced = 0;
            const MidiEvent* fromModule = module.midiOut(produced);
            if (fromModule == nullptr || produced == 0) continue;

            for (uint32_t i = 0; i < produced; ++i) {
                const MidiEvent& event = fromModule[i];
                if (event.size < 1 || event.size > 3) continue;   // the ABI says ignore

                // Out of the chain, for the host, in the host's own frames.
                if (emittedCount_ < kEventCapacity) {
                    MidiEvent out = event;
                    out.frame += offset;
                    emitted_[emittedCount_++] = out;
                }
                // And on to whatever comes next in this sub-block, so a
                // generator can drive an instrument further down without the
                // host routing it back round. Left sub-block relative, because
                // that is the frame the next module will be given.
                if (pendingCount_ < kEventCapacity) pending_[pendingCount_++] = event;
            }

            // The next plugin is entitled to events in ascending frame order,
            // and what a generator emits is not necessarily later than what
            // arrived.
            std::sort(pending_.begin(), pending_.begin() + pendingCount_,
                      [](const MidiEvent& a, const MidiEvent& b) { return a.frame < b.frame; });
        }
    }
}

}  // namespace jigdaw
