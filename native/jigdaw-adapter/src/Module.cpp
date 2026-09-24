// native/jigdaw-adapter/src/Module.cpp
//
// jig:Abi1 and jig:Abi2, called through WAMR (WebAssembly Micro Runtime).
//
// WAMR is the only runtime this file knows about, and it is the only file
// that knows about any runtime. Swapping it is a change here and nowhere
// else. It replaces wasm3 for one reason: wasm3's interpreter has no
// WebAssembly SIMD support, and Ferrite (jig:wasmFeature jig:Simd128) needs
// it. Built as WAMR's fast interpreter with SIMD on and AOT/JIT off — pure
// bytecode interpretation, same as wasm3 before it: no executable pages, no
// JIT-at-runtime, nothing platform-specific to debug.
#include "jigdaw/Module.hpp"

#include <wasm_export.h>

#include <cstring>
#include <map>
#include <mutex>

namespace jigdaw {
namespace {

// WAMR's runtime is a process-wide singleton; every Module shares it. Never
// torn down: a Module can outlive any notion of "last one", and leaking a
// singleton at process exit is the ordinary, accepted shape of this problem.
void ensureRuntimeInitialized() {
    static std::once_flag once;
    std::call_once(once, [] {
        RuntimeInitArgs args;
        std::memset(&args, 0, sizeof(args));
        args.mem_alloc_type = Alloc_With_System_Allocator;
        args.running_mode = Mode_Interp;
        wasm_runtime_full_init(&args);
    });
}

// docs/embed_wamr.md: a thread the runtime did not create itself must
// register before it can call into a module, once, on that thread. The
// audio callback thread is exactly such a thread — JACK creates it, not
// WAMR — so this runs lazily on a module's first call from wherever that
// turns out to be, guarded by a thread_local flag so every call after the
// first is just that flag read. It is the one place this file does
// something on the audio thread that is not, in the strictest sense, free:
// registering a new thread is a one-time setup cost paid once per OS thread
// the whole session, the same shape as the thread's own creation and first
// stack touch. `TODO.md`'s JigDAW section explains the alternative (a JACK
// thread-init callback registering every real-time thread up front) and why
// it was not taken here: this guard is correct regardless of which thread —
// JACK, an offline render, a future backend — ends up calling in, without
// hunting down every thread-creation site across the codebase.
void ensureThreadRegistered() {
    thread_local bool registered = false;
    if (!registered) {
        wasm_runtime_init_thread_env();
        registered = true;
    }
}

wasm_val_t i32Val(int32_t value) {
    wasm_val_t v{};
    v.kind = WASM_I32;
    v.of.i32 = value;
    return v;
}

wasm_val_t f32Val(float value) {
    wasm_val_t v{};
    v.kind = WASM_F32;
    v.of.f32 = value;
    return v;
}

// Call a function taking `args` and returning nothing. False on a missing
// export or a trapped call — the caller decides whether that is fatal.
bool callVoid(wasm_exec_env_t env, wasm_function_inst_t fn, uint32_t argc = 0,
             const wasm_val_t* args = nullptr) {
    if (fn == nullptr) return false;
    return wasm_runtime_call_wasm_a(env, fn, 0, nullptr, argc,
                                    const_cast<wasm_val_t*>(args));
}

// Call a function taking `args` and returning one i32/u32, read into `out`.
bool callU32(wasm_exec_env_t env, wasm_function_inst_t fn, uint32_t& out,
            uint32_t argc = 0, const wasm_val_t* args = nullptr) {
    if (fn == nullptr) return false;
    wasm_val_t result = i32Val(0);
    if (!wasm_runtime_call_wasm_a(env, fn, 1, &result, argc,
                                  const_cast<wasm_val_t*>(args))) {
        return false;
    }
    out = static_cast<uint32_t>(result.of.i32);
    return true;
}

}  // namespace

struct Module::State {
    wasm_module_t module = nullptr;
    wasm_module_inst_t instance = nullptr;
    wasm_exec_env_t execEnv = nullptr;
    std::vector<uint8_t> wasm;   ///< must outlive the module; WAMR keeps referencing it

    wasm_function_inst_t init = nullptr;
    wasm_function_inst_t process = nullptr;
    wasm_function_inst_t setParam = nullptr;
    wasm_function_inst_t maxFramesFn = nullptr;
    wasm_function_inst_t inputPtr = nullptr;
    wasm_function_inst_t outputPtr = nullptr;
    wasm_function_inst_t noteOn = nullptr;
    wasm_function_inst_t noteOff = nullptr;
    wasm_function_inst_t allNotesOff = nullptr;

    // Version 2. Each is null unless the profile declared the facility.
    wasm_function_inst_t midiInPtr = nullptr;
    wasm_function_inst_t midiInCapacity = nullptr;
    wasm_function_inst_t midiIn = nullptr;
    wasm_function_inst_t midiOutPtr = nullptr;
    wasm_function_inst_t midiOutCapacity = nullptr;
    wasm_function_inst_t midiOutCount = nullptr;
    wasm_function_inst_t transportPtr = nullptr;

    /// One entry per jig:asset the module actually exports the trio of
    /// exports for. Resolved once at load, the same as everything above.
    struct AssetFunctions {
        wasm_function_inst_t ptr = nullptr;
        wasm_function_inst_t maxLen = nullptr;
        wasm_function_inst_t load = nullptr;
    };
    std::map<std::string, AssetFunctions> assets;

    MidiEvent* midiInBuffer = nullptr;
    uint32_t midiInSlots = 0;
    const MidiEvent* midiOutBuffer = nullptr;
    uint32_t midiOutSlots = 0;
    Transport* transportBlock = nullptr;

    uint32_t frames = 0;
    // Resolved once, at load, and again after any loadAsset() that may have
    // grown memory. The ABI otherwise forbids growing it so that a host may
    // hold these.
    std::vector<float*> inputs;
    std::vector<const float*> outputs;
    bool ready = false;

    ~State() {
        if (execEnv != nullptr) wasm_runtime_destroy_exec_env(execEnv);
        if (instance != nullptr) wasm_runtime_deinstantiate(instance);
        if (module != nullptr) wasm_runtime_unload(module);
    }
};

namespace {

// A pointer that would run past the end is refused rather than trusted:
// wasm_runtime_validate_app_addr is WAMR's own bounds check against the
// module's real memory, the one place a module could otherwise reach
// outside itself.
uint8_t* resolveOffset(wasm_module_inst_t instance, uint32_t offset, uint32_t size) {
    if (offset == 0 || size == 0) return nullptr;
    if (!wasm_runtime_validate_app_addr(instance, offset, size)) return nullptr;
    return reinterpret_cast<uint8_t*>(wasm_runtime_addr_app_to_native(instance, offset));
}

// jig_input_ptr(channel) / jig_output_ptr(channel): one audio-frames-sized
// buffer per channel.
uint8_t* resolveChannelBuffer(Module::State& s, wasm_function_inst_t fn, int channel) {
    const auto arg = i32Val(channel);
    uint32_t offset = 0;
    if (!callU32(s.execEnv, fn, offset, 1, &arg)) return nullptr;
    return resolveOffset(s.instance, offset, s.frames * static_cast<uint32_t>(sizeof(float)));
}

// jig_midi_in_ptr() / jig_midi_out_ptr() / jig_transport_ptr(): a
// no-argument pointer to a block of a known byte size.
uint8_t* resolveBlockBuffer(Module::State& s, wasm_function_inst_t fn, uint32_t bytes) {
    uint32_t offset = 0;
    if (!callU32(s.execEnv, fn, offset)) return nullptr;
    return resolveOffset(s.instance, offset, bytes);
}

// Re-resolves every cached buffer pointer against the module's current
// memory. Called once at the end of load(), and again after loadAsset(),
// which may have grown it (ferrite-processor.js's own comment on this ABI:
// a loader may grow the module's linear memory to build whatever it just
// parsed, moving the base address every cached pointer was computed from).
std::string refreshBuffers(Module::State& s) {
    for (std::size_t channel = 0; channel < s.inputs.size(); ++channel) {
        auto* buffer = resolveChannelBuffer(s, s.inputPtr, static_cast<int>(channel));
        if (buffer == nullptr) return "jig_input_ptr returned an unusable pointer";
        s.inputs[channel] = reinterpret_cast<float*>(buffer);
    }
    for (std::size_t channel = 0; channel < s.outputs.size(); ++channel) {
        auto* buffer = resolveChannelBuffer(s, s.outputPtr, static_cast<int>(channel));
        if (buffer == nullptr) return "jig_output_ptr returned an unusable pointer";
        s.outputs[channel] = reinterpret_cast<const float*>(buffer);
    }
    if (s.midiInBuffer != nullptr) {
        auto* buffer = resolveBlockBuffer(s, s.midiInPtr, s.midiInSlots * sizeof(MidiEvent));
        if (buffer == nullptr) return "jig_midi_in_ptr returned an unusable pointer";
        s.midiInBuffer = reinterpret_cast<MidiEvent*>(buffer);
    }
    if (s.midiOutBuffer != nullptr) {
        auto* buffer = resolveBlockBuffer(s, s.midiOutPtr, s.midiOutSlots * sizeof(MidiEvent));
        if (buffer == nullptr) return "jig_midi_out_ptr returned an unusable pointer";
        s.midiOutBuffer = reinterpret_cast<const MidiEvent*>(buffer);
    }
    if (s.transportBlock != nullptr) {
        // The bytes already there survive a wasm memory grow, so only the
        // pointer is re-resolved — re-zeroing here would drop the transport
        // state the host just wrote for this block.
        auto* buffer = resolveBlockBuffer(s, s.transportPtr, sizeof(Transport));
        if (buffer == nullptr) return "jig_transport_ptr returned an unusable pointer";
        s.transportBlock = reinterpret_cast<Transport*>(buffer);
    }
    return {};
}

}  // namespace

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

    ensureRuntimeInitialized();

    s.wasm = wasm;

    char errorBuf[256];
    s.module = wasm_runtime_load(s.wasm.data(), static_cast<uint32_t>(s.wasm.size()),
                                 errorBuf, sizeof(errorBuf));
    if (s.module == nullptr) return std::string("the module did not parse: ") + errorBuf;

    // Stack size. Generous for an audio callback that must not grow one. No
    // host-managed heap: every module here manages its own memory with
    // ordinary wasm memory.grow, the same as jig_load_nam building a model.
    constexpr uint32_t kStackSize = 64 * 1024;
    s.instance = wasm_runtime_instantiate(s.module, kStackSize, 0, errorBuf, sizeof(errorBuf));
    if (s.instance == nullptr) return std::string("the module did not instantiate: ") + errorBuf;

    s.execEnv = wasm_runtime_create_exec_env(s.instance, kStackSize);
    if (s.execEnv == nullptr) return "could not create a WebAssembly execution environment";

    struct Wanted { const char* name; wasm_function_inst_t* into; bool required; };
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
        *item.into = wasm_runtime_lookup_function(s.instance, item.name);
        if (*item.into == nullptr && item.required) {
            return std::string("the module declares ") + (abi2 ? "jig:Abi2" : "jig:Abi1")
                 + " but does not export " + item.name;
        }
    }

    // jig:asset: optional per key. A profile may declare an asset a module's
    // build does not actually implement, and that is only a problem for the
    // specific asset, not the whole load — the same tolerance `wanted`
    // applies to a version 2 facility on version 1.
    for (const auto& asset : profile.assets) {
        State::AssetFunctions fns;
        const std::string ptrName = "jig_" + asset.key + "_ptr";
        const std::string maxLenName = "jig_" + asset.key + "_max_len";
        const std::string loadName = "jig_load_" + asset.key;
        fns.ptr = wasm_runtime_lookup_function(s.instance, ptrName.c_str());
        fns.maxLen = wasm_runtime_lookup_function(s.instance, maxLenName.c_str());
        fns.load = wasm_runtime_lookup_function(s.instance, loadName.c_str());
        if (fns.ptr != nullptr && fns.maxLen != nullptr && fns.load != nullptr)
            s.assets[asset.key] = fns;
    }

    const auto sampleRateArg = f32Val(static_cast<float>(sampleRate));
    if (!callVoid(s.execEnv, s.init, 1, &sampleRateArg))
        return "jig_init failed: " + std::string(wasm_runtime_get_exception(s.instance));

    uint32_t frames = 0;
    if (!callU32(s.execEnv, s.maxFramesFn, frames))
        return "jig_max_frames failed: " + std::string(wasm_runtime_get_exception(s.instance));
    if (frames == 0) return "the module reports a maximum of zero frames";
    s.frames = frames;

    // A version 2 plugin with no audio output has nothing to resolve, and
    // calling jig_output_ptr on it is forbidden rather than merely pointless.
    const int outputChannels = wantsAudioOut ? profile.outputChannels : 0;
    const int inputChannels = profile.audioInputs > 0 ? profile.inputChannels : 0;

    for (int channel = 0; channel < inputChannels; ++channel) {
        auto* buffer = resolveChannelBuffer(s, s.inputPtr, channel);
        if (buffer == nullptr) return "jig_input_ptr returned an unusable pointer";
        s.inputs.push_back(reinterpret_cast<float*>(buffer));
    }
    for (int channel = 0; channel < outputChannels; ++channel) {
        auto* buffer = resolveChannelBuffer(s, s.outputPtr, channel);
        if (buffer == nullptr) return "jig_output_ptr returned an unusable pointer";
        s.outputs.push_back(reinterpret_cast<const float*>(buffer));
    }

    if (wantsMidiIn) {
        callU32(s.execEnv, s.midiInCapacity, s.midiInSlots);
        auto* buffer = resolveBlockBuffer(s, s.midiInPtr, s.midiInSlots * sizeof(MidiEvent));
        if (buffer == nullptr) return "jig_midi_in_ptr returned an unusable pointer";
        s.midiInBuffer = reinterpret_cast<MidiEvent*>(buffer);
    }
    if (wantsMidiOut) {
        callU32(s.execEnv, s.midiOutCapacity, s.midiOutSlots);
        auto* buffer = resolveBlockBuffer(s, s.midiOutPtr, s.midiOutSlots * sizeof(MidiEvent));
        if (buffer == nullptr) return "jig_midi_out_ptr returned an unusable pointer";
        s.midiOutBuffer = reinterpret_cast<const MidiEvent*>(buffer);
    }
    if (wantsTransport) {
        auto* buffer = resolveBlockBuffer(s, s.transportPtr, sizeof(Transport));
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
    ensureThreadRegistered();
    const wasm_val_t args[2] = { i32Val(static_cast<int32_t>(index)), f32Val(value) };
    callVoid(state_->execEnv, state_->setParam, 2, args);
}

void Module::noteOn(uint8_t note, uint8_t velocity) {
    if (!state_ || state_->noteOn == nullptr) return;
    ensureThreadRegistered();
    const wasm_val_t args[2] = { i32Val(note), i32Val(velocity) };
    callVoid(state_->execEnv, state_->noteOn, 2, args);
}

void Module::noteOff(uint8_t note) {
    if (!state_ || state_->noteOff == nullptr) return;
    ensureThreadRegistered();
    const auto arg = i32Val(note);
    callVoid(state_->execEnv, state_->noteOff, 1, &arg);
}

void Module::allNotesOff() {
    if (!state_ || state_->allNotesOff == nullptr) return;
    ensureThreadRegistered();
    callVoid(state_->execEnv, state_->allNotesOff);
}

uint32_t Module::sendMidi(const MidiEvent* events, uint32_t count) {
    auto& s = *state_;
    if (s.midiInBuffer == nullptr || s.midiIn == nullptr) return 0;
    ensureThreadRegistered();
    // The earliest, not the first that fit by luck: events arrive in frame
    // order and truncating the tail keeps a note on with its note off.
    const uint32_t delivered = count < s.midiInSlots ? count : s.midiInSlots;
    for (uint32_t i = 0; i < delivered; ++i) s.midiInBuffer[i] = events[i];
    const auto arg = i32Val(static_cast<int32_t>(delivered));
    callVoid(s.execEnv, s.midiIn, 1, &arg);
    return delivered;
}

const MidiEvent* Module::midiOut(uint32_t& count) const {
    count = 0;
    if (!state_ || state_->midiOutBuffer == nullptr || state_->midiOutCount == nullptr) {
        return nullptr;
    }
    ensureThreadRegistered();
    uint32_t produced = 0;
    if (!callU32(state_->execEnv, state_->midiOutCount, produced)) return nullptr;
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
    ensureThreadRegistered();
    const auto arg = i32Val(static_cast<int32_t>(frames > state_->frames ? state_->frames : frames));
    callVoid(state_->execEnv, state_->process, 1, &arg);
}

std::vector<std::string> Module::assetKeys() const {
    std::vector<std::string> keys;
    if (!state_) return keys;
    for (const auto& [key, fns] : state_->assets) keys.push_back(key);
    return keys;
}

std::string Module::loadAsset(const std::string& key, const std::vector<uint8_t>& bytes) {
    if (!state_ || !state_->ready) return "the module is not loaded";
    auto& s = *state_;

    const auto found = s.assets.find(key);
    if (found == s.assets.end()) return "this module has no loadable \"" + key + "\" asset";
    auto& fns = found->second;

    uint32_t maxLen = 0;
    if (!callU32(s.execEnv, fns.maxLen, maxLen))
        return "jig_" + key + "_max_len failed: " + wasm_runtime_get_exception(s.instance);
    if (bytes.size() > maxLen) {
        return key + " is " + std::to_string(bytes.size()) +
               " bytes, more than this module accepts (" + std::to_string(maxLen) + ")";
    }

    uint32_t offset = 0;
    if (!callU32(s.execEnv, fns.ptr, offset))
        return "jig_" + key + "_ptr failed: " + wasm_runtime_get_exception(s.instance);
    auto* buffer = resolveOffset(s.instance, offset, static_cast<uint32_t>(bytes.size()));
    // An empty asset still needs a valid pointer to not write into, so the
    // bound is checked against at least 1 byte even when there is nothing
    // to copy.
    if (buffer == nullptr && !bytes.empty())
        return "jig_" + key + "_ptr returned an unusable pointer";
    if (!bytes.empty()) std::memcpy(buffer, bytes.data(), bytes.size());

    uint32_t status = 0;
    const auto lenArg = i32Val(static_cast<int32_t>(bytes.size()));
    if (!callU32(s.execEnv, fns.load, status, 1, &lenArg))
        return "jig_load_" + key + " failed: " + wasm_runtime_get_exception(s.instance);
    const auto signedStatus = static_cast<int32_t>(status);
    if (signedStatus != 0) {
        return key + " was rejected (jig_load_" + key + " returned " +
               std::to_string(signedStatus) + ")";
    }

    // ferrite-processor.js's own comment on this ABI: a loader may grow the
    // module's linear memory to build whatever it just parsed, which can move
    // the base address every cached buffer pointer below was computed from.
    // Every one of them is re-resolved against the current memory now, rather
    // than trusted until the next process() call finds out the hard way.
    return refreshBuffers(s);
}

}  // namespace jigdaw
