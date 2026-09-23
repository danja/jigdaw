// native/jigdaw-adapter/src/juce/PluginEditor.cpp
#include "PluginEditor.h"

JigdawJuceEditor::JigdawJuceEditor(JigdawJuceProcessor& p)
    : AudioProcessorEditor(&p), processor_(p) {
    irisLabel_.setText("Plugin IRIs, one per line, loaded in order:", juce::dontSendNotification);
    irisLabel_.setJustificationType(juce::Justification::topLeft);
    addAndMakeVisible(irisLabel_);

    irisEditor_.setMultiLine(true);
    irisEditor_.setReturnKeyStartsNewLine(true);
    irisEditor_.setText(processor_.iris(), juce::dontSendNotification);
    addAndMakeVisible(irisEditor_);

    loadButton_.onClick = [this] { load(); };
    addAndMakeVisible(loadButton_);

    reportLabel_.setText("Load report:", juce::dontSendNotification);
    reportLabel_.setJustificationType(juce::Justification::topLeft);
    addAndMakeVisible(reportLabel_);

    reportView_.setMultiLine(true);
    reportView_.setReadOnly(true);
    reportView_.setScrollbarsShown(true);
    reportView_.setFont(juce::Font(juce::FontOptions(juce::Font::getDefaultMonospacedFontName(), 13.0f, juce::Font::plain)));
    reportView_.setText(processor_.report(), juce::dontSendNotification);
    lastReport_ = processor_.report();
    addAndMakeVisible(reportView_);

    setResizable(true, true);
    setSize(640, 480);
    startTimerHz(4);
}

JigdawJuceEditor::~JigdawJuceEditor() { stopTimer(); }

void JigdawJuceEditor::paint(juce::Graphics& g) {
    g.fillAll(getLookAndFeel().findColour(juce::ResizableWindow::backgroundColourId));
}

void JigdawJuceEditor::resized() {
    auto area = getLocalBounds().reduced(10);
    irisLabel_.setBounds(area.removeFromTop(20));
    irisEditor_.setBounds(area.removeFromTop(100));
    area.removeFromTop(6);
    loadButton_.setBounds(area.removeFromTop(28).removeFromLeft(100));
    area.removeFromTop(10);
    reportLabel_.setBounds(area.removeFromTop(20));
    reportView_.setBounds(area);
}

void JigdawJuceEditor::load() {
    processor_.loadIris(irisEditor_.getText());
}

void JigdawJuceEditor::timerCallback() {
    const auto report = processor_.report();
    if (report != lastReport_) {
        lastReport_ = report;
        reportView_.setText(report, juce::dontSendNotification);
    }
}
