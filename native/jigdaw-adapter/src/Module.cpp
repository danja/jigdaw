// native/jigdaw-adapter/src/Module.cpp
//
// jig:Abi1 and jig:Abi2, called through wasm3.
//
// wasm3 is the only runtime this file knows about, and it is the only file that
// knows about any runtime. Swapping it is a change here and nowhere else.
#include "jigdaw/Module.hpp"

#include <wasm3.h>
#include <m3_env.h>

#include <cstring>

namespace jigdaw {
namespace {

/// A wasm3 result is a const char* that is null on success.
std::string asError(M3Result result, const std::string& what) {
    if (result == m3Err_none) return {};
    return what + ": " + result;
}

}  // namespace

struct Module::State {
    IM3Environment environment = nullptr;
    IM3Runtime runtime = nullptr;
    IM3Module module = nullptr;
    std::vector<uint8_t> wasm;   ///< wasm3 does not copy, so we must keep it

    IM3Function init = nullptr;
    IM3Function process = nullptr;
    IM3Function setParam = nullptr;
    IM3Function maxFramesFn = nullptr;
    IM3Function inputPtr = nullptr;
    IM3Function outputPtr = nullptr;
    IM3Function noteOn = nullptr;
    IM3Function noteOff = nullptr;
    IM3Function allNotesOff = nullptr;

    // Version 2. Each is null unless the profile declared the facility.
    IM3Function midiInPtr = nullptr;
    IM3Function midiInCapacity = nullptr;
    IM3Function midiIn = nullptr;
    IM3Function midiOutPtr = nullptr;
    IM3Function midiOutCapacity = nullptr;
    IM3Function midiOutCount = nullptr;
    IM3Function transportPtr = nullptr;

    MidiEvent* midiInBuffer = nullptr;
    uint32_t midiInSlots = 0;
    const MidiEvent* midiOutBuffer = nullptr;
    uint32_t midiOutSlots = 0;
    Transport* transportBlock = nullptr;

    uint32_t frames = 0;
    // Resolved once, at load. The ABI forbids growing memory after jig_init
    // precisely so a host may hold these.
    std::vector<float*> inputs;
    std::vector<const float*> outputs;
    bool ready = false;

    ~State() {
        if (runtime != nullptr) m3_FreeRuntime(runtime);
        if (environment != nullptr) m3_FreeEnvironment(environment);
    }
};

Module::Module() : state_(std::make_unique<State>()) {}
Module::~Module() = default;
Module::Module(Module&&) noexcept = default;
Module& Module::operator=(Module&&) noexcept = default;

bool Module::ready() const { return state_ && state_->ready; }
uint32_t Module::maxFrames() const { return state_ ? state_->frames : 0; }
bool Module::hasMidi() const {
    return state_ && (state_->noteOn != nullptr || state_->midiInBuffer != nullptr);
}
bool Module::hasMidiIn() const { return state_ && state_->midiInBuffer != nullptr; }
bool Module::hasMidiOut() const { return state_ && state_->midiOutBuffer != nullptr; }
bool Module::hasTransport() const { return state_ && state_->transportBlock != nullptr; }

std::string Module::load(const std::vector<uint8_t>& wasm, const Profile& profile, double sampleRate) {
    auto& s = *state_;

    const bool abi2 = profile.abi == kAbi2;
    if (profile.abi != kAbi1 && !abi2) {
        // The honest refusal. Without a declared ABI the module is private to
        // its JavaScript processor, and guessing at its exports would be
        // guessing. docs/module-abi.md.
        return profile.abi.empty()
            ? "this plugin declares no jig:abi, so its module is private to its JavaScript "
              "processor and a host without a JavaScript engine cannot load it"
            : "unsupported ABI: " + profile.abi + ". This host implements jig:Abi1 and jig:Abi2.";
    }

    // Version 2 makes audio optional, so a MIDI generator can say it has none.
    // Version 1 assumed every plugin had an output to write.
    const bool wantsAudioOut = !abi2 || profile.audioOutputs > 0;
    const bool wantsMidiIn = abi2 && profile.acceptsMidi();
    const bool wantsMidiOut = abi2 && profile.producesMidi();
    const bool wantsTransport = abi2 && profile.requiresTransport();

    s.wasm = wasm;

    s.environment = m3_NewEnvironment();
    if (s.environment == nullptr) return "could not create a WebAssembly environment";

    // Stack size. Generous for an audio callback that must not grow one.
    s.runtime = m3_NewRuntime(s.environment, 64 * 1024, nullptr);
    if (s.runtime == nullptr) return "could not create a WebAssembly runtime";

    if (auto error = asError(m3_ParseModule(s.environment, &s.module, s.wasm.data(),
                                            static_cast<uint32_t>(s.wasm.size())),
                             "the module did not parse"); !error.empty()) {
        return error;
    }
    if (auto error = asError(m3_LoadModule(s.runtime, s.module), "the module did not load");
        !error.empty()) {
        return error;
    }

    struct Wanted { const char* name; IM3Function* into; bool required; };
    const Wanted wanted[] = {
        {"jig_init", &s.init, true},
        {"jig_process", &s.process, true},
        {"jig_set_param", &s.setParam, true},
        {"jig_max_frames", &s.maxFramesFn, true},
        {"jig_output_ptr", &s.outputPtr, wantsAudioOut},
        {"jig_input_ptr", &s.inputPtr, profile.audioInputs > 0},
        // Under version 2 the event buffer supersedes these, so they are wanted
        // only when there is no event buffer to supersede them.
        {"jig_note_on", &s.noteOn, profile.acceptsMidi() && !wantsMidiIn},
        {"jig_note_off", &s.noteOff, profile.acceptsMidi() && !wantsMidiIn},
        {"jig_all_notes_off", &s.allNotesOff, false},
        {"jig_midi_in_ptr", &s.midiInPtr, wantsMidiIn},
        {"jig_midi_in_capacity", &s.midiInCapacity, wantsMidiIn},
        {"jig_midi_in", &s.midiIn, wantsMidiIn},
        {"jig_midi_out_ptr", &s.midiOutPtr, wantsMidiOut},
        {"jig_midi_out_capacity", &s.midiOutCapacity, wantsMidiOut},
        {"jig_midi_out_count", &s.midiOutCount, wantsMidiOut},
        {"jig_transport_ptr", &s.transportPtr, wantsTransport},
    };

    for (const auto& item : wanted) {
        const M3Result result = m3_FindFunction(item.into, s.runtime, item.name);
        if (result != m3Err_none) {
            *item.into = nullptr;
            if (item.required) {
                return std::string("the module declares ") + (abi2 ? "jig:Abi2" : "jig:Abi1")
                     + " but does not export " + item.name;
            }
        }
    }

    if (auto error = asError(m3_CallV(s.init, static_cast<float>(sampleRate)), "jig_init failed");
        !error.empty()) {
        return error;
    }

    uint32_t frames = 0;
    if (auto error = asError(m3_CallV(s.maxFramesFn), "jig_max_frames failed"); !error.empty()) {
        return error;
    }
    if (auto error = asError(m3_GetResultsV(s.maxFramesFn, &frames), "jig_max_frames returned nothing");
        !error.empty()) {
        return error;
    }
    if (frames == 0) return "the module reports a maximum of zero frames";
    s.frames = frames;

    // Resolve the buffers once. A pointer is a byte offset into the module's
    // own memory, so it has to be turned into a real address here.
    uint32_t memorySize = 0;
    uint8_t* memory = m3_GetMemory(s.runtime, &memorySize, 0);
    if (memory == nullptr) return "the module exports no memory";

    auto bufferAt = [&](IM3Function fn, uint32_t channel, const char* what) -> uint8_t* {
        if (fn == nullptr) return nullptr;
        if (m3_CallV(fn, channel) != m3Err_none) return nullptr;
        uint32_t offset = 0;
        if (m3_GetResultsV(fn, &offset) != m3Err_none) return nullptr;
        // A pointer that would run past the end is refused rather than
        // trusted: this is the one place a module could reach outside itself.
        if (offset == 0 || offset + s.frames * sizeof(float) > memorySize) {
            (void)what;
            return nullptr;
        }
        return memory + offset;
    };

    // A version 2 plugin with no audio output has nothing to resolve, and
    // calling jig_output_ptr on it is forbidden rather than merely pointless.
    const int outputChannels = wantsAudioOut ? profile.outputChannels : 0;

    const int inputChannels = profile.audioInputs > 0 ? profile.inputChannels : 0;
    for (int channel = 0; channel < inputChannels; ++channel) {
        auto* buffer = bufferAt(s.inputPtr, static_cast<uint32_t>(channel), "input");
        if (buffer == nullptr) return "jig_input_ptr returned an unusable pointer";
        s.inputs.push_back(reinterpret_cast<float*>(buffer));
    }
    for (int channel = 0; channel < outputChannels; ++channel) {
        auto* buffer = bufferAt(s.outputPtr, static_cast<uint32_t>(channel), "output");
        if (buffer == nullptr) return "jig_output_ptr returned an unusable pointer";
        s.outputs.push_back(reinterpret_cast<const float*>(buffer));
    }

    // The version 2 blocks, resolved once alongside the audio buffers and for
    // the same reason: the ABI forbids growing memory so that a host may hold
    // them, and re-reading a pointer every block would be trusting that twice.
    auto blockAt = [&](IM3Function fn, uint32_t bytes) -> uint8_t* {
        if (fn == nullptr) return nullptr;
        if (m3_CallV(fn) != m3Err_none) return nullptr;
        uint32_t offset = 0;
        if (m3_GetResultsV(fn, &offset) != m3Err_none) return nullptr;
        if (offset == 0 || bytes == 0 || offset + bytes > memorySize) return nullptr;
        return memory + offset;
    };
    auto countFrom = [&](IM3Function fn) -> uint32_t {
        if (fn == nullptr) return 0;
        if (m3_CallV(fn) != m3Err_none) return 0;
        uint32_t value = 0;
        if (m3_GetResultsV(fn, &value) != m3Err_none) return 0;
        return value;
    };

    if (wantsMidiIn) {
        s.midiInSlots = countFrom(s.midiInCapacity);
        auto* buffer = blockAt(s.midiInPtr, s.midiInSlots * sizeof(MidiEvent));
        if (buffer == nullptr) return "jig_midi_in_ptr returned an unusable pointer";
        s.midiInBuffer = reinterpret_cast<MidiEvent*>(buffer);
    }
    if (wantsMidiOut) {
        s.midiOutSlots = countFrom(s.midiOutCapacity);
        auto* buffer = blockAt(s.midiOutPtr, s.midiOutSlots * sizeof(MidiEvent));
        if (buffer == nullptr) return "jig_midi_out_ptr returned an unusable pointer";
        s.midiOutBuffer = reinterpret_cast<const MidiEvent*>(buffer);
    }
    if (wantsTransport) {
        auto* buffer = blockAt(s.transportPtr, sizeof(Transport));
        if (buffer == nullptr) return "jig_transport_ptr returned an unusable pointer";
        s.transportBlock = reinterpret_cast<Transport*>(buffer);
        *s.transportBlock = Transport{};
    }

    // Declared defaults, so a plugin sounds as its author intended before
    // anything is touched.
    for (const auto& port : profile.ports) {
        if (port.index >= 0) setParam(static_cast<uint32_t>(port.index), port.defaultValue);
    }

    s.ready = true;
    return {};
}

void Module::setParam(uint32_t index, float value) {
    if (!state_ || state_->setParam == nullptr) return;
    m3_CallV(state_->setParam, index, value);
}

void Module::noteOn(uint8_t note, uint8_t velocity) {
    if (!state_ || state_->noteOn == nullptr) return;
    m3_CallV(state_->noteOn, static_cast<uint32_t>(note), static_cast<uint32_t>(velocity));
}

void Module::noteOff(uint8_t note) {
    if (!state_ || state_->noteOff == nullptr) return;
    m3_CallV(state_->noteOff, static_cast<uint32_t>(note));
}

void Module::allNotesOff() {
    if (!state_ || state_->allNotesOff == nullptr) return;
    m3_CallV(state_->allNotesOff);
}

uint32_t Module::sendMidi(const MidiEvent* events, uint32_t count) {
    auto& s = *state_;
    if (s.midiInBuffer == nullptr || s.midiIn == nullptr) return 0;
    // The earliest, not the first that fit by luck: events arrive in frame
    // order and truncating the tail keeps a note on with its note off.
    const uint32_t delivered = count < s.midiInSlots ? count : s.midiInSlots;
    for (uint32_t i = 0; i < delivered; ++i) s.midiInBuffer[i] = events[i];
    m3_CallV(s.midiIn, delivered);
    return delivered;
}

const MidiEvent* Module::midiOut(uint32_t& count) const {
    count = 0;
    if (!state_ || state_->midiOutBuffer == nullptr || state_->midiOutCount == nullptr) {
        return nullptr;
    }
    if (m3_CallV(state_->midiOutCount) != m3Err_none) return nullptr;
    uint32_t produced = 0;
    if (m3_GetResultsV(state_->midiOutCount, &produced) != m3Err_none) return nullptr;
    // A module that lies about its count would walk the host off the end of a
    // buffer it declared the size of itself.
    count = produced < state_->midiOutSlots ? produced : state_->midiOutSlots;
    return state_->midiOutBuffer;
}

Transport* Module::transport() { return state_ ? state_->transportBlock : nullptr; }

float* Module::input(uint32_t channel) {
    if (!state_ || channel >= state_->inputs.size()) return nullptr;
    return state_->inputs[channel];
}

const float* Module::output(uint32_t channel) const {
    if (!state_ || state_->outputs.empty()) return nullptr;
    // A mono plugin feeding a stereo host reads its one buffer twice rather
    // than leaving a channel silent.
    const size_t index = channel < state_->outputs.size() ? channel : state_->outputs.size() - 1;
    return state_->outputs[index];
}

void Module::process(uint32_t frames) {
    if (!state_ || !state_->ready) return;
    m3_CallV(state_->process, frames > state_->frames ? state_->frames : frames);
}

}  // namespace jigdaw
