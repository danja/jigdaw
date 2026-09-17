// native/jigdaw-adapter/src/Chain.cpp
#include "jigdaw/Chain.hpp"

#include <algorithm>
#include <cstring>

#include "jigdaw/Fetch.hpp"
#include "jigdaw/Integrity.hpp"

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

void Chain::process(float** audio, int channels, uint32_t frames) {
    for (const auto& slot : slots_) {
        Module& module = *slot->module;
        const uint32_t block = std::min(frames, module.maxFrames());

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

        for (int channel = 0; channel < channels; ++channel) {
            const float* from = module.output(static_cast<uint32_t>(channel));
            if (from == nullptr) continue;
            std::memcpy(audio[channel], from, block * sizeof(float));
        }
    }
}

}  // namespace jigdaw
