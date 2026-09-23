// native/jigdaw-adapter/src/juce/PluginEditor.h
//
// A far smaller editor than src/dpf/JigdawUI.cpp's, on purpose: DPF gives a
// plugin a bare canvas and JigdawUI.cpp draws every widget itself in NanoVG,
// including the scrollable parameter picker. JUCE gives a plugin real native
// widgets, so the same job (name the IRIs, see what loaded, see which slot is
// which) is a TextEditor and a read-only TextEditor rather than an immediate
// mode renderer. The parameter-to-plugin mapping lives in the load report
// text rather than a drawn list of 128 rows, which is what the DPF UI's
// scrolling exists to make readable and this one does not need.
#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

#include "PluginProcessor.h"

class JigdawJuceEditor final : public juce::AudioProcessorEditor,
                                private juce::Timer {
public:
    explicit JigdawJuceEditor(JigdawJuceProcessor&);
    ~JigdawJuceEditor() override;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;
    void load();

    JigdawJuceProcessor& processor_;

    juce::Label irisLabel_;
    juce::TextEditor irisEditor_;
    juce::TextButton loadButton_ { "Load" };
    juce::Label reportLabel_;
    juce::TextEditor reportView_;

    // Polled on a timer rather than pushed: loadIris() runs on the message
    // thread from either this editor's own button or a host reopening a
    // saved session, and the editor has no other way to learn of the second
    // case. Redrawing only on a change is what keeps this from being a
    // flicker.
    juce::String lastReport_;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(JigdawJuceEditor)
};
