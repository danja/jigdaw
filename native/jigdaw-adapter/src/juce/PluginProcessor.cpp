// native/jigdaw-adapter/src/juce/PluginProcessor.cpp
//
// Real-time rules identical to src/dpf/JigdawPlugin.cpp, because they are
// this project's rules and not DPF's: loading reaches the network and
// happens on the message thread; the finished chain is handed to the audio
// thread by an atomic swap; the audio thread never builds one, frees one, or
// allocates anything else.
#include "PluginProcessor.h"
#include "PluginEditor.h"

#include <algorithm>

#include "jigdaw/Midi.hpp"
#include "jigdaw/Params.hpp"
#include "jigdaw/Publish.hpp"
#include "jigdaw/Report.hpp"

JigdawJuceProcessor::JigdawJuceProcessor()
    : AudioProcessor(BusesProperties()
                          .withInput("Input", juce::AudioChannelSet::stereo(), true)
                          .withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
    values_.resize(static_cast<size_t>(kParameterCount), 0.0f);
    touched_.resize(static_cast<size_t>(kParameterCount), 0);
    params_.reserve(static_cast<size_t>(kParameterCount));
    for (int i = 0; i < kParameterCount; ++i) {
        // Named generically, exactly as the DPF wrapper's parameters are: the
        // real names are not known until something is loaded, and both
        // shells report the current mapping through the load report instead.
        auto* param = new juce::AudioParameterFloat(
            juce::ParameterID("p" + juce::String(i + 1), 1),
            "Param " + juce::String(i + 1),
            juce::NormalisableRange<float>(0.0f, 1.0f),
            0.0f);
        params_.push_back(param);
        addParameter(param);   // AudioProcessor takes ownership
    }
}

JigdawJuceProcessor::~JigdawJuceProcessor() {
    delete chain_.load(std::memory_order_acquire);
}

void JigdawJuceProcessor::prepareToPlay(double, int) {
    // Nothing to preallocate here: incoming_ is a fixed member array and the
    // chain, if any, was already built with this sample rate at load time.
}

void JigdawJuceProcessor::releaseResources() {}

bool JigdawJuceProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
    return layouts.getMainInputChannelSet() == juce::AudioChannelSet::stereo()
        && layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
}

juce::AudioProcessorEditor* JigdawJuceProcessor::createEditor() {
    return new JigdawJuceEditor(*this);
}

void JigdawJuceProcessor::getStateInformation(juce::MemoryBlock& destData) {
    // Just the IRIs: the report is derived from them by loadIris and does not
    // need to survive a save, the same reason DPF's "report" state is host
    // readable rather than host writable.
    juce::MemoryOutputStream stream(destData, false);
    stream.writeString(iris_);
}

void JigdawJuceProcessor::setStateInformation(const void* data, int sizeInBytes) {
    juce::MemoryInputStream stream(data, static_cast<size_t>(sizeInBytes), false);
    loadIris(stream.readString());
}

void JigdawJuceProcessor::loadIris(const juce::String& iris) {
    iris_ = iris;

    auto built = std::make_unique<Chain>();
    const double sampleRate = getSampleRate() > 0.0 ? getSampleRate() : 48000.0;
    report_ = jigdaw::describe(jigdaw::buildChain(*built, iris_.toStdString(), sampleRate));

    // Published by an atomic swap; the retired chain is retired rather than
    // freed, because the audio thread may be mid-process on it, announced
    // below. See jigdaw/Publish.hpp.
    auto* previous = chain_.exchange(built.release(), std::memory_order_acq_rel);
    jigdaw::retireChain(retired_, previous);
    jigdaw::reapChains(retired_, announced_.load(std::memory_order_acquire));

    if (Chain* now = chain_.load(std::memory_order_acquire)) {
        jigdaw::applyParameters(*now, values_, touched_);
        // Tell the host how far behind the output lags, so it can place it.
        setLatencySamples(static_cast<int>(now->latencyFrames()));
    } else {
        setLatencySamples(0);
    }
}

/// What the host knows about where we are. JUCE reports position in quarter
/// notes directly (getPpqPosition), which is what jigdaw::Transport::beat
/// already wants: unlike DPF's BBT block, no ticks-per-beat conversion is
/// needed to get there.
void JigdawJuceProcessor::fillTransport(jigdaw::Transport& into) {
    into = jigdaw::Transport{};

    auto* head = getPlayHead();
    const auto position = head != nullptr ? head->getPosition() : juce::Optional<juce::AudioPlayHead::PositionInfo>{};
    if (!position.hasValue()) return;

    into.playing = position->getIsPlaying() ? 1u : 0u;

    if (const auto seconds = position->getTimeInSeconds()) {
        into.seconds = *seconds;
        into.valid |= jigdaw::kTransportSeconds;
    }
    if (const auto bpm = position->getBpm()) {
        into.bpm = *bpm;
        into.valid |= jigdaw::kTransportBpm;
    }
    if (const auto signature = position->getTimeSignature()) {
        into.numerator = signature->numerator;
        into.denominator = signature->denominator;
        into.valid |= jigdaw::kTransportMeter;
    }
    if (const auto beat = position->getPpqPosition()) {
        into.beat = *beat;
        into.valid |= jigdaw::kTransportBeat;
        if (const auto barStart = position->getPpqPositionOfLastBarStart()) {
            into.barStartBeat = *barStart;
        }
    }
    if (const auto bar = position->getBarCount()) {
        into.bar = static_cast<int32_t>(*bar) + 1;   // JUCE counts bars from 0
    }
}

void JigdawJuceProcessor::collectMidi(jigdaw::Chain& chain, int offset, juce::MidiBuffer& midiOut) {
    uint32_t produced = 0;
    const jigdaw::MidiEvent* events = chain.midiOut(produced);
    for (uint32_t i = 0; i < produced; ++i) {
        const auto& event = events[i];
        midiOut.addEvent(event.data, event.size, offset + static_cast<int>(event.frame));
    }
}

void JigdawJuceProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midiMessages) {
    juce::ScopedNoDenormals noDenormals;
    const uint32_t frames = static_cast<uint32_t>(buffer.getNumSamples());

    // Gathered once, in the ABI's own layout, before anything is added to
    // midiMessages below: the host's own events stay in the buffer untouched,
    // which is what makes them pass through as output for free, exactly as
    // src/dpf/JigdawPlugin.cpp's explicit writeMidiEvent loop does on
    // purpose.
    uint32_t incomingCount = 0;
    for (const auto metadata : midiMessages) {
        if (incomingCount >= kMaxEvents) break;
        const int size = metadata.numBytes;
        if (size < 1 || size > 3) continue;   // the ABI says ignore
        jigdaw::MidiEvent& into = incoming_[incomingCount++];
        const auto position = static_cast<uint32_t>(metadata.samplePosition);
        into.frame = position < frames ? position : (frames > 0 ? frames - 1 : 0);
        into.size = static_cast<uint8_t>(size);
        into.data[0] = metadata.data[0];
        into.data[1] = size > 1 ? metadata.data[1] : 0;
        into.data[2] = size > 2 ? metadata.data[2] : 0;
    }

    Chain* chain = jigdaw::acquireStable(chain_, announced_);
    if (chain == nullptr) { jigdaw::releaseSlot(announced_); return; }   // nothing loaded: pass audio and MIDI through

    const uint32_t block = chain->maxFrames();
    if (block == 0) { jigdaw::releaseSlot(announced_); return; }   // a module claiming no frames would loop for ever

    // Polled rather than pushed by a parameter listener, because a listener
    // callback's thread is host defined and the audio thread must never wait
    // on one. kParameterCount float comparisons cost nothing next to a block
    // of audio.
    const size_t paramCount = std::min(params_.size(), chain->parameters().size());
    for (size_t i = 0; i < paramCount; ++i) {
        const float value = params_[i]->get();
        if (value != values_[i]) {
            touched_[i] = 1;
            values_[i] = value;
            const auto& port = chain->parameters()[i];
            chain->setParameter(i, port.minimum + value * (port.maximum - port.minimum));
        }
    }

    fillTransport(chain->transport());
    const jigdaw::Transport opening = chain->transport();
    const double sampleRate = getSampleRate();
    const double beatsPerFrame = (opening.valid & jigdaw::kTransportBpm) != 0 && sampleRate > 0.0
        ? opening.bpm / (60.0 * sampleRate)
        : 0.0;

    float* channels[2] = {
        buffer.getWritePointer(0),
        buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : buffer.getWritePointer(0)
    };

    // Walk the block, stopping where an event falls and never processing more
    // than the module's own jig_max_frames in one call, exactly the sub-block
    // loop src/dpf/JigdawPlugin.cpp::run() uses and for the same reason: a
    // host's buffer is usually larger than a module's own quantum, and
    // handing every event the block's opening beat would make every plugin's
    // timing as coarse as the host's buffer.
    uint32_t done = 0;
    uint32_t next = 0;
    while (done < frames) {
        const uint32_t sliceStart = next;
        while (next < incomingCount && incoming_[next].frame <= done) ++next;

        uint32_t limit = frames;
        if (next < incomingCount && incoming_[next].frame < frames) limit = incoming_[next].frame;
        const uint32_t count = std::min(block, limit - done);

        for (uint32_t i = sliceStart; i < next; ++i) {
            incoming_[i].frame = incoming_[i].frame > done ? incoming_[i].frame - done : 0;
        }

        jigdaw::Transport& moving = chain->transport();
        moving = opening;
        moving.beat = opening.beat + beatsPerFrame * done;
        moving.seconds = opening.seconds + double(done) / sampleRate;

        float* window[2] = { channels[0] + done, channels[1] + done };
        chain->process(window, 2, count, incoming_ + sliceStart, next - sliceStart);
        collectMidi(*chain, static_cast<int>(done), midiMessages);
        done += count;
    }

    if (next < incomingCount) {
        for (uint32_t i = next; i < incomingCount; ++i) incoming_[i].frame = 0;
        chain->process(channels, 2, 0, incoming_ + next, incomingCount - next);
        collectMidi(*chain, frames > 0 ? static_cast<int>(frames) - 1 : 0, midiMessages);
    }
    jigdaw::releaseSlot(announced_);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() {
    return new JigdawJuceProcessor();
}
