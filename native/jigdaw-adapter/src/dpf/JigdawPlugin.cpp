// native/jigdaw-adapter/src/dpf/JigdawPlugin.cpp
//
// The DPF wrapper. A thin shell over jigdaw::Chain, which is where everything
// that matters lives: DPF is the shell, not the architecture.
//
// The real-time rules are the same as anywhere else in this project. Loading a
// plugin reaches the network, so it happens on the message thread and the
// finished chain is handed over by an atomic swap. The audio thread never
// builds one and never frees one.
#include "DistrhoPlugin.hpp"

#include <atomic>
#include <cstring>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include "jigdaw/Chain.hpp"
#include "jigdaw/Abi.hpp"
#include "jigdaw/Midi.hpp"
#include "jigdaw/Params.hpp"
#include "jigdaw/Publish.hpp"
#include "jigdaw/Report.hpp"

START_NAMESPACE_DISTRHO

/// Parameters are a fixed list, because a DAW asks for them before anything is
/// loaded and cannot be told later.
///
/// Sixteen rather than thirty-two: a host shows every one it is told about, and
/// a wall of controls named "Param 19" is worse than running out. Three plugins
/// of five parameters fit, which is the shape a chain usually has. The editor
/// shows which slot belongs to which plugin, because nothing else can.
static constexpr uint32_t kParameterCount = JIGDAW_PARAMETER_COUNT;

class JigdawAdapter : public Plugin {
public:
    JigdawAdapter()
        : Plugin(kParameterCount, 0, 2)   // parameters, programs, states
    {
        values_.resize(kParameterCount, 0.0f);
        touched_.resize(kParameterCount, 0);
    }

protected:
    const char* getLabel() const override { return "JigDAW Adapter"; }
    const char* getDescription() const override {
        return "Loads JigDAW plugins by IRI and runs them in a chain. A JigDAW plugin is a URL: "
               "the adapter fetches its profile, verifies the declared digest, and runs the "
               "WebAssembly module through the published ABI.";
    }
    const char* getMaker() const override { return "danja"; }
    const char* getHomePage() const override { return "https://github.com/danja/jigdaw"; }
    const char* getLicense() const override { return "Apache-2.0"; }
    uint32_t getVersion() const override { return d_version(0, 1, 0); }
    int64_t getUniqueId() const override { return d_cconst('J', 'g', 'D', 'w'); }

    void initParameter(uint32_t index, Parameter& parameter) override {
        parameter.hints = kParameterIsAutomatable;
        // Named generically because the names are not known until something is
        // loaded, and a DAW reads them once. The current mapping is reported
        // through the state, which a host can show.
        char name[32];
        std::snprintf(name, sizeof(name), "Param %u", index + 1);
        parameter.name = name;
        char symbol[32];
        std::snprintf(symbol, sizeof(symbol), "p%u", index + 1);
        parameter.symbol = symbol;
        // Normalised, because the real range belongs to whatever gets loaded.
        parameter.ranges.def = 0.0f;
        parameter.ranges.min = 0.0f;
        parameter.ranges.max = 1.0f;
    }

    void initState(uint32_t index, State& state) override {
        if (index == 0) {
            state.key = "iris";
            state.label = "Plugin IRIs";
            state.defaultValue = "";
            state.hints = kStateIsHostWritable;
            state.description =
                "One JigDAW plugin IRI per line, loaded in order. For example "
                "https://strandz.it/jigdaw/plugins/pulse/";
            return;
        }
        // What happened when they were loaded. Written by the plugin and read
        // by the editor, which has no other way to know: loading reaches the
        // network and belongs here, not in a UI that may not exist.
        state.key = "report";
        state.label = "Load report";
        state.defaultValue = "";
        state.hints = kStateIsHostReadable;
        state.description = "What loaded, what did not, and which parameter slot is which.";
    }

    float getParameterValue(uint32_t index) const override {
        return index < values_.size() ? values_[index] : 0.0f;
    }

    void setParameterValue(uint32_t index, float value) override {
        if (index >= values_.size()) return;
        // Only a value that differs is an edit. A host pushes the declared
        // default at insert time and on reset, and treating that as a choice
        // would overwrite the loaded plugin's own default with slot zero, which
        // for most ports is silence.
        if (value != values_[index]) touched_[index] = 1;
        values_[index] = value;

        Chain* chain = chain_.load(std::memory_order_acquire);
        if (chain == nullptr || index >= chain->parameters().size()) return;
        // The host gives a normalised value; the plugin declared a real range.
        const auto& port = chain->parameters()[index];
        chain->setParameter(index, port.minimum + value * (port.maximum - port.minimum));
    }

    String getState(const char* key) const override {
        if (std::strcmp(key, "iris") == 0) return String(iris_.c_str());
        if (std::strcmp(key, "report") == 0) return String(report_.c_str());
        return String();
    }

    /// Loading reaches the network, so it happens here, never in run().
    void setState(const char* key, const char* value) override {
        // The report is written by this plugin, never set from outside.
        if (std::strcmp(key, "iris") != 0) return;
        iris_ = value != nullptr ? value : "";

        auto built = std::make_unique<jigdaw::Chain>();
        report_ = jigdaw::describe(jigdaw::buildChain(*built, iris_, getSampleRate()));
        d_stdout("jigdaw-adapter:\n%s", report_.c_str());

        // Published by an atomic swap. The retired chain is retired rather
        // than freed: the audio thread may be mid-process on it, announced
        // below, and freeing it here would be a use-after-free the next
        // block trips over. The reap frees what is not announced.
        auto* previous = chain_.exchange(built.release(), std::memory_order_acq_rel);
        jigdaw::retireChain(retired_, previous);
        jigdaw::reapChains(retired_, announced_.load(std::memory_order_acquire));

        // Tell the editor what happened, where the format allows it. DPF wires
        // this callback under CLAP only: it is a null pointer in the VST3, VST2
        // and JACK wrappers, so this is an improvement where it lands and never
        // the editor's only source. The editor works the answer out for itself,
        // through the same jigdaw::buildChain this just called.
        updateStateValue("report", report_.c_str());

        // Give every slot a value: the user's where they moved it, the port's
        // declared default everywhere else. In jigdaw::applyParameters, with a
        // test, because getting this wrong made the adapter silent in a DAW.
        //
        // The host is not told the new values. DPF wires
        // requestParameterValueChange under CLAP alone, exactly as it does the
        // state push, so a slider may read zero while the plugin runs at the
        // default. getParameterValue reports the real value, so a host that
        // reads back agrees, and the first move of that slider takes over.
        if (Chain* now = chain_.load(std::memory_order_acquire)) {
            jigdaw::applyParameters(*now, values_, touched_);
            // Tell the host how far behind the output lags, so it can place
            // it: an unreported 2047 frames is 43ms of late audio at 48kHz.
            setLatency(now->latencyFrames());
        } else {
            setLatency(0);
        }
    }

    /// Take what the chain emitted and give it to the host.
    ///
    /// `offset` puts a slice relative frame back onto the host's block, which is
    /// the inverse of the adjustment made on the way in. Without it every
    /// generated note would land in the first 128 frames of the block.
    void collectMidi(jigdaw::Chain& chain, uint32_t offset) {
       #if DISTRHO_PLUGIN_WANT_MIDI_OUTPUT
        uint32_t produced = 0;
        const jigdaw::MidiEvent* events = chain.midiOut(produced);
        for (uint32_t i = 0; i < produced; ++i) {
            MidiEvent out;
            out.frame = events[i].frame + offset;
            out.size = events[i].size;
            out.data[0] = events[i].data[0];
            out.data[1] = events[i].data[1];
            out.data[2] = events[i].data[2];
            out.data[3] = 0;
            out.dataExt = nullptr;
            writeMidiEvent(out);
        }
       #else
        (void)chain; (void)offset;
       #endif
    }

    /// What the DAW knows about where we are, in the ABI's own block.
    ///
    /// Every field is flagged rather than merely written, because a host that
    /// has tempo and no bar, beat and tick is ordinary and a plugin that reads
    /// bar 1 beat 1 from a host that never filled them in restarts its pattern
    /// on every block.
    void fillTransport(jigdaw::Transport& into, uint32_t frames) {
        const TimePosition& now = getTimePosition();
        into = jigdaw::Transport{};
        into.playing = now.playing ? 1u : 0u;

        const double rate = getSampleRate();
        if (rate > 0.0) {
            into.seconds = static_cast<double>(now.frame) / rate;
            into.valid |= jigdaw::kTransportSeconds;
        }
        (void)frames;

        if (!now.bbt.valid) return;

        into.bpm = now.bbt.beatsPerMinute;
        into.valid |= jigdaw::kTransportBpm;

        into.numerator = static_cast<int32_t>(now.bbt.beatsPerBar);
        into.denominator = static_cast<int32_t>(now.bbt.beatType);
        into.valid |= jigdaw::kTransportMeter;

        into.bar = now.bbt.bar;
        into.beatInBar = now.bbt.beat;
        into.ticksPerBeat = static_cast<uint32_t>(now.bbt.ticksPerBeat);
        into.tick = static_cast<int32_t>(now.bbt.tick);
        into.valid |= jigdaw::kTransportBbt;

        // Quarter notes from the start, which is what a pattern counts in.
        // barStartTick is in the host's ticks, so it needs the same conversion.
        if (now.bbt.ticksPerBeat > 0.0) {
            const double beatsFromStart =
                (now.bbt.barStartTick + (now.bbt.beat - 1) * now.bbt.ticksPerBeat + now.bbt.tick)
                / now.bbt.ticksPerBeat;
            into.beat = beatsFromStart;
            into.barStartBeat = now.bbt.barStartTick / now.bbt.ticksPerBeat;
            into.valid |= jigdaw::kTransportBeat;
        }
    }

    void sampleRateChanged(double) override {
        // Reload at the new rate: a module is told its rate once, in jig_init.
        if (!iris_.empty()) setState("iris", iris_.c_str());
    }

    void activate() override {
        if (Chain* chain = chain_.load(std::memory_order_acquire)) chain->allNotesOff();
    }

    void run(const float** inputs, float** outputs, uint32_t frames,
             const MidiEvent* midiEvents, uint32_t midiEventCount) override {
        // Copy in first: the chain works in place, and a host may hand the same
        // buffer for input and output anyway.
        for (int channel = 0; channel < 2; ++channel) {
            if (outputs[channel] != inputs[channel]) {
                std::memcpy(outputs[channel], inputs[channel], frames * sizeof(float));
            }
        }

        // MIDI through, before anything else and whatever is loaded. A plugin in
        // the chain may also emit, and that is collected after processing; this
        // is the host's own MIDI continuing on its way.
       #if DISTRHO_PLUGIN_WANT_MIDI_OUTPUT
        for (uint32_t i = 0; i < midiEventCount; ++i) writeMidiEvent(midiEvents[i]);
       #endif

        Chain* chain = jigdaw::acquireStable(chain_, announced_);
        if (chain == nullptr) { jigdaw::releaseSlot(announced_); return; }   // nothing loaded: pass the audio through

        const uint32_t block = chain->maxFrames();
        if (block == 0) { jigdaw::releaseSlot(announced_); return; }   // a module claiming no frames would loop for ever

        fillTransport(chain->transport(), frames);

        // The chain runs in slices of at most jig_max_frames, and each slice is
        // at a different point in time. Handing them all the block's opening
        // beat would make every plugin's timing as coarse as the host's buffer:
        // at 1024 frames that is 21ms, which is audible as a late note.
        const jigdaw::Transport opening = chain->transport();
        const double beatsPerFrame = (opening.valid & jigdaw::kTransportBpm) != 0
            && getSampleRate() > 0.0
            ? opening.bpm / (60.0 * getSampleRate())
            : 0.0;

        // Gather this block's events once, in the ABI's own layout. The chain
        // wants them in ascending frame order, which is how a host delivers them.
        uint32_t incoming = 0;
        for (uint32_t i = 0; i < midiEventCount && incoming < kMaxEvents; ++i) {
            const MidiEvent& event = midiEvents[i];
            if (event.size < 1 || event.size > 3) continue;   // the ABI says ignore
            jigdaw::MidiEvent& into = incoming_[incoming++];
            into.frame = event.frame < frames ? event.frame : frames - 1;
            into.size = static_cast<uint8_t>(event.size);
            into.data[0] = event.data[0];
            into.data[1] = event.size > 1 ? event.data[1] : 0;
            into.data[2] = event.size > 2 ? event.data[2] : 0;
        }

        // Walk the block, stopping where an event falls, so a note sounds at the
        // frame it was written at rather than at the start of whatever block
        // happened to contain it. Processing is still capped at the module's
        // jig_max_frames: a host may hand over more frames than that, and
        // passing them would write past a buffer.
        uint32_t done = 0;
        uint32_t next = 0;

        while (done < frames) {
            const uint32_t sliceStart = next;
            while (next < incoming && incoming_[next].frame <= done) ++next;

            uint32_t limit = frames;
            if (next < incoming && incoming_[next].frame < frames) limit = incoming_[next].frame;
            const uint32_t count = std::min(block, limit - done);

            // Frames are relative to the slice the chain is about to run, not to
            // the host's block. An event at frame 300 of the block is at frame 0
            // of the slice that starts there, and handing over the block's own
            // number would put it past the end of a 128 frame slice.
            for (uint32_t i = sliceStart; i < next; ++i) {
                incoming_[i].frame = incoming_[i].frame > done ? incoming_[i].frame - done : 0;
            }

            jigdaw::Transport& moving = chain->transport();
            moving = opening;
            moving.beat = opening.beat + beatsPerFrame * done;
            moving.seconds = opening.seconds + double(done) / getSampleRate();

            float* window[2] = {outputs[0] + done, outputs[1] + done};
            chain->process(window, 2, count, incoming_ + sliceStart, next - sliceStart);
            collectMidi(*chain, done);
            done += count;
        }

        // Anything left is an event at or past the end of the block, which no
        // host should send. Delivering it is better than dropping it silently.
        if (next < incoming) {
            for (uint32_t i = next; i < incoming; ++i) incoming_[i].frame = 0;
            chain->process(outputs, 2, 0, incoming_ + next, incoming - next);
            collectMidi(*chain, frames > 0 ? frames - 1 : 0);
        }
        jigdaw::releaseSlot(announced_);
    }

private:
    using Chain = jigdaw::Chain;

    ~JigdawAdapter() override {
        // The teardown runs on the message thread with no audio in flight, so
        // the published chain and whatever retires remain go together here.
        delete chain_.load(std::memory_order_acquire);
    }

    std::atomic<Chain*> chain_{nullptr};
    /// The chain the audio thread announced it is running, or nullptr.
    /// Written by the audio thread, read by reaps. See Publish.hpp.
    std::atomic<Chain*> announced_{nullptr};
    /// Chains no longer published but possibly still running. Message thread
    /// only; freed by reaps, never while announced.
    std::vector<std::unique_ptr<Chain>> retired_;

    std::string iris_;
    std::string report_;
    std::vector<float> values_;
    std::vector<uint8_t> touched_;   ///< slots the user has actually moved

    /// This block's incoming MIDI, in the ABI's layout. A fixed array because
    /// run() must not allocate, and 512 events in one block is already far more
    /// than any host sends.
    static constexpr uint32_t kMaxEvents = 512;
    jigdaw::MidiEvent incoming_[kMaxEvents];

    DISTRHO_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(JigdawAdapter)
};

Plugin* createPlugin() { return new JigdawAdapter(); }

END_NAMESPACE_DISTRHO
