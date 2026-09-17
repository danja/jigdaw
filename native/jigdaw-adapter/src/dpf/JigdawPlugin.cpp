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
#include <mutex>
#include <sstream>
#include <string>
#include <vector>

#include "jigdaw/Chain.hpp"

START_NAMESPACE_DISTRHO

/// Parameters are a fixed list, because a DAW asks for them before anything is
/// loaded. Thirty-two is enough for several plugins at once and cheap to carry.
static constexpr uint32_t kParameterCount = 32;

class JigdawAdapter : public Plugin {
public:
    JigdawAdapter()
        : Plugin(kParameterCount, 0, 1)   // parameters, programs, states
    {
        values_.resize(kParameterCount, 0.0f);
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
        if (index != 0) return;
        state.key = "iris";
        state.label = "Plugin IRIs";
        state.defaultValue = "";
        state.hints = kStateIsHostWritable;
        state.description =
            "One JigDAW plugin IRI per line, loaded in order. For example "
            "https://strandz.it/jigdaw/plugins/pulse/";
    }

    float getParameterValue(uint32_t index) const override {
        return index < values_.size() ? values_[index] : 0.0f;
    }

    void setParameterValue(uint32_t index, float value) override {
        if (index >= values_.size()) return;
        values_[index] = value;

        Chain* chain = chain_.load(std::memory_order_acquire);
        if (chain == nullptr || index >= chain->parameters().size()) return;
        // The host gives a normalised value; the plugin declared a real range.
        const auto& port = chain->parameters()[index];
        chain->setParameter(index, port.minimum + value * (port.maximum - port.minimum));
    }

    String getState(const char* key) const override {
        if (std::strcmp(key, "iris") == 0) return String(iris_.c_str());
        return String();
    }

    /// Loading reaches the network, so it happens here, never in run().
    void setState(const char* key, const char* value) override {
        if (std::strcmp(key, "iris") != 0) return;
        iris_ = value != nullptr ? value : "";

        auto built = std::make_unique<jigdaw::Chain>();
        std::ostringstream report;
        std::istringstream lines(iris_);
        std::string iri;

        while (std::getline(lines, iri)) {
            while (!iri.empty() && (iri.back() == '\r' || iri.back() == ' ')) iri.pop_back();
            if (iri.empty() || iri[0] == '#') continue;

            const auto error = built->add(iri, getSampleRate());
            if (error.empty()) {
                report << "loaded " << iri << "\n";
            } else {
                // Named and survivable: one bad IRI must not stop the rest.
                report << "refused " << iri << ": " << error << "\n";
                d_stderr("jigdaw-adapter: %s", error.c_str());
            }
        }
        d_stdout("jigdaw-adapter:\n%s", report.str().c_str());

        // Published by an atomic swap. The retired chain is freed here, on the
        // message thread, never on the audio thread.
        auto* previous = chain_.exchange(built.release(), std::memory_order_acq_rel);
        std::lock_guard<std::mutex> guard(retiredLock_);
        retired_.reset(previous);

        // Apply whatever the host already set, so a reload does not reset
        // every control to a default the user did not choose.
        Chain* now = chain_.load(std::memory_order_acquire);
        if (now != nullptr) {
            for (size_t i = 0; i < now->parameters().size() && i < values_.size(); ++i) {
                const auto& port = now->parameters()[i];
                now->setParameter(i, port.minimum + values_[i] * (port.maximum - port.minimum));
            }
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

        Chain* chain = chain_.load(std::memory_order_acquire);
        if (chain == nullptr) return;   // nothing loaded: pass the audio through

        for (uint32_t i = 0; i < midiEventCount; ++i) {
            const MidiEvent& event = midiEvents[i];
            if (event.size < 2) continue;
            const uint8_t status = event.data[0] & 0xf0;
            if (status == 0x90 && event.size > 2 && event.data[2] > 0) {
                chain->noteOn(event.data[1], event.data[2]);
            } else if (status == 0x80 || (status == 0x90 && event.size > 2 && event.data[2] == 0)) {
                // A note on with velocity zero is a note off. Every MIDI source
                // does this, and a synth that ignores it sustains for ever.
                chain->noteOff(event.data[1]);
            } else if (status == 0xb0 && event.size > 1 && event.data[1] == 123) {
                chain->allNotesOff();
            }
        }

        // In blocks the modules can take. A host may hand over more frames than
        // a module's jig_max_frames, and passing them would write past a buffer.
        const uint32_t block = chain->maxFrames();
        float* channels[2] = {outputs[0], outputs[1]};
        for (uint32_t offset = 0; offset < frames; offset += block) {
            const uint32_t count = std::min(block, frames - offset);
            float* window[2] = {channels[0] + offset, channels[1] + offset};
            chain->process(window, 2, count);
        }
    }

private:
    using Chain = jigdaw::Chain;

    std::atomic<Chain*> chain_{nullptr};
    std::unique_ptr<Chain> retired_;
    std::mutex retiredLock_;

    std::string iris_;
    std::vector<float> values_;

    DISTRHO_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(JigdawAdapter)
};

Plugin* createPlugin() { return new JigdawAdapter(); }

END_NAMESPACE_DISTRHO
