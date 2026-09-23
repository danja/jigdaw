// native/jigdaw-adapter/src/juce/PluginProcessor.h
//
// The JUCE wrapper. A thin shell over jigdaw::Chain, exactly as
// src/dpf/JigdawPlugin.cpp is: JUCE is a second shell over the same portable
// core, not a second architecture, the same reason Transmission could add
// jigdaw_core as a library rather than reimplement the contract.
//
// GPLv3 unless built against a commercial JUCE license. See README.md in
// this directory: this is the one component in the repository that is not
// Apache-2.0, because JUCE is not.
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "jigdaw/Chain.hpp"

class JigdawJuceProcessor final : public juce::AudioProcessor {
public:
    // Matches DISTRHO_PLUGIN's JIGDAW_PARAMETER_COUNT (src/dpf/
    // DistrhoPluginInfo.h): a chain is a flat list of every loaded plugin's
    // parameters, and a host is never told about a slot past this count. Kept
    // equal on purpose rather than redefined, so the two shells report the
    // same limit to whoever builds a chain against either of them.
    static constexpr int kParameterCount = 128;

    JigdawJuceProcessor();
    ~JigdawJuceProcessor() override;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;

    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    using AudioProcessor::processBlock;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "JigDAW Adapter"; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return true; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    /// Rebuild the chain from newline separated IRIs, exactly what DPF's
    /// setState("iris", ...) does. Reaches the network, so called from the
    /// message thread only: the editor's Load button, and setStateInformation
    /// when a saved session is reopened.
    void loadIris(const juce::String& iris);
    juce::String iris() const { return iris_; }
    juce::String report() const { return juce::String(report_); }

private:
    using Chain = jigdaw::Chain;

    // Published by an atomic swap; the retired chain is freed on the message
    // thread, never the audio thread. Identical shape to the DPF wrapper's
    // chain_/retired_/retiredLock_, for the identical reason.
    std::atomic<Chain*> chain_{nullptr};
    std::unique_ptr<Chain> retired_;
    std::mutex retiredLock_;

    juce::String iris_;
    std::string report_;

    // Last applied normalised value per slot, and which slots the user has
    // actually moved. jigdaw::applyParameters reads both: an untouched slot
    // takes the freshly loaded plugin's own default rather than whatever slot
    // zero happens to mean for it.
    std::vector<float> values_;
    std::vector<uint8_t> touched_;

    // Owned by juce::AudioProcessor once addParameter() is called; kept here
    // only for the index-by-index access processBlock and the editor need.
    std::vector<juce::AudioParameterFloat*> params_;

    static constexpr uint32_t kMaxEvents = 512;
    jigdaw::MidiEvent incoming_[kMaxEvents];

    void fillTransport(jigdaw::Transport& into);
    void collectMidi(jigdaw::Chain& chain, int offset, juce::MidiBuffer& midiOut);

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(JigdawJuceProcessor)
};
