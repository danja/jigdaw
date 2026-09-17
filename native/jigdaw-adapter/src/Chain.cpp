// native/jigdaw-adapter/src/Chain.cpp
#include "jigdaw/Chain.hpp"

#include <algorithm>
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

    slot->profile = profile;
    slot->ports = profile.portsByIndex();
    slot->firstParameter = static_cast<int>(flat_.size());
    for (const auto& port : slot->ports) flat_.push_back(port);

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

void Chain::process(float** audio, int channels, uint32_t frames,
                    const MidiEvent* in, uint32_t inCount) {
    emittedCount_ = 0;
    pendingCount_ = 0;

    if (!pending_.empty() && in != nullptr) {
        pendingCount_ = std::min(inCount, kEventCapacity);
        std::memcpy(pending_.data(), in, pendingCount_ * sizeof(MidiEvent));
    }

    for (const auto& slot : slots_) {
        Module& module = *slot->module;
        const uint32_t block = std::min(frames, module.maxFrames());

        if (Transport* into = module.transport()) *into = transport_;

        deliver(*slot, pending_.data(), pendingCount_);

        // An instrument takes no audio: it replaces what is there rather than
        // adding to it, which is why the input copy is conditional.
        if (slot->profile.audioInputs > 0) {
            for (int channel = 0; channel < slot->profile.inputChannels; ++channel) {
                float* into = module.input(static_cast<uint32_t>(channel));
                if (into == nullptr) continue;
                const int source = std::min(channel, channels - 1);
                std::memcpy(into, audio[source], block * sizeof(float));
            }
        }

        module.process(block);

        // A plugin with no audio output leaves what is passing through it
        // untouched. A MIDI generator has nothing to write and version 2 lets
        // it say so; writing silence instead would mute the whole chain.
        if (slot->profile.audioOutputs > 0) {
            for (int channel = 0; channel < channels; ++channel) {
                const float* from = module.output(static_cast<uint32_t>(channel));
                if (from == nullptr) continue;
                std::memcpy(audio[channel], from, block * sizeof(float));
            }
        }

        if (!module.hasMidiOut()) continue;

        uint32_t produced = 0;
        const MidiEvent* fromModule = module.midiOut(produced);
        if (fromModule == nullptr || produced == 0) continue;

        for (uint32_t i = 0; i < produced; ++i) {
            const MidiEvent& event = fromModule[i];
            if (event.size < 1 || event.size > 3) continue;   // the ABI says ignore

            // Out of the chain, for the host.
            if (emittedCount_ < kEventCapacity) emitted_[emittedCount_++] = event;
            // And on to whatever comes next, so a generator can drive an
            // instrument further down without the host routing it back round.
            if (pendingCount_ < kEventCapacity) pending_[pendingCount_++] = event;
        }

        // The next plugin is entitled to events in ascending frame order, and
        // what a generator emits is not necessarily later than what arrived.
        std::sort(pending_.begin(), pending_.begin() + pendingCount_,
                  [](const MidiEvent& a, const MidiEvent& b) { return a.frame < b.frame; });
    }
}

}  // namespace jigdaw
