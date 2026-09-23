// native/jigdaw-adapter/src/juce/tools/DumpParameters.h
//
// A JUCE developer's existing parameter layout, read live from a real
// juce::AudioProcessor and written out as JSON, for
// bin/juce-params-to-profile.js to turn into a profile's lv2:port list, the
// jig_set_param dispatch a ported module needs, and the AudioWorklet
// processor's own parameterDescriptors.
//
// Reading the live AudioProcessorParameter objects rather than parsing the
// C++ that created them, because JUCE has already resolved every default,
// range and choice list correctly and a second reader of the same source
// can only disagree with it, never improve on it. This is also why it asks
// nothing of how the parameters were declared: a legacy
// AudioProcessor::getParameters() override, an AudioProcessorValueTreeState,
// or juce::ParameterID-based construction all answer the same interface.
//
// This header is meant to be copied into your own JUCE project, not built
// as part of this repository: it needs only juce_audio_processors_headless
// (every parameter class here lives there, not in juce_audio_processors
// itself, so nothing pulls in JUCE's GUI modules), and nothing in it is
// specific to JigDAW's own adapter. Call
// jigdaw::dumpParametersAsJson from wherever your AudioProcessor is already
// constructed (a Standalone's constructor, a menu item, a one-off main()),
// write what it returns to a file, run
// bin/juce-params-to-profile.js against that file, then remove the call:
// nothing here needs to ship in your plugin.
#pragma once

#include <juce_audio_processors_headless/juce_audio_processors_headless.h>

namespace jigdaw {
namespace detail {

inline juce::String jsonQuoted (const juce::String& s) {
  return "\"" + s.replace ("\\", "\\\\").replace ("\"", "\\\"") + "\"";
}

/// One parameter's range and default, in real (non-normalised) units,
/// whichever concrete RangedAudioParameter subclass it is. `getDefaultValue()`
/// on the base class returns a value normalised to 0..1 regardless of the
/// subclass, which is why every branch below goes through the parameter's
/// own range to get back a real number rather than assuming one.
inline void appendParameter (juce::String& json, juce::AudioProcessorParameter& param, bool isLast) {
  auto* withId = dynamic_cast<juce::AudioProcessorParameterWithID*> (&param);
  const juce::String id = withId != nullptr ? withId->getParameterID() : juce::String (param.getParameterIndex());
  const juce::String name = param.getName (128);

  json << "    { \"id\": " << jsonQuoted (id) << ", \"name\": " << jsonQuoted (name);

  if (auto* choice = dynamic_cast<juce::AudioParameterChoice*> (&param)) {
    json << ", \"type\": \"choice\", \"default\": " << choice->getIndex() << ", \"choices\": [";
    for (int i = 0; i < choice->choices.size(); ++i) {
      json << jsonQuoted (choice->choices[i]);
      if (i + 1 < choice->choices.size()) json << ", ";
    }
    json << "]";
  } else if (auto* boolParam = dynamic_cast<juce::AudioParameterBool*> (&param)) {
    // operator<<(String&, bool) is deleted in JUCE on purpose, so this is
    // written out as a literal rather than streamed.
    json << ", \"type\": \"bool\", \"default\": " << (boolParam->get() ? "true" : "false");
  } else if (auto* ranged = dynamic_cast<juce::RangedAudioParameter*> (&param)) {
    const auto& range = ranged->getNormalisableRange();
    const bool isInt = dynamic_cast<juce::AudioParameterInt*> (&param) != nullptr;
    json << ", \"type\": " << jsonQuoted (isInt ? "int" : "float")
         << ", \"minimum\": " << range.start
         << ", \"maximum\": " << range.end
         << ", \"default\": " << range.convertFrom0to1 (param.getDefaultValue());
  } else {
    // Neither ranged, bool, nor choice: a custom AudioProcessorParameter
    // subclass with no declared range. Its 0..1 value is read rather than a
    // real range guessed at; bin/juce-params-to-profile.js treats this the
    // same as a float already scaled 0..1.
    json << ", \"type\": \"normalised\", \"default\": " << param.getDefaultValue();
  }

  json << " }";
  if (!isLast) json << ",";
  json << "\n";
}

}  // namespace detail

/// Every parameter juce::AudioProcessor::getParameters() reports, as the
/// JSON bin/juce-params-to-profile.js reads. Order is preserved: it becomes
/// jig:paramIndex order, so a jig_set_param switch written against this
/// file's list matches the profile written against the same one.
inline juce::String dumpParametersAsJson (juce::AudioProcessor& processor) {
  juce::String json = "{\n  \"parameters\": [\n";
  auto& params = processor.getParameters();
  for (int i = 0; i < params.size(); ++i) {
    detail::appendParameter (json, *params[i], i + 1 == params.size());
  }
  json << "  ]\n}\n";
  return json;
}

}  // namespace jigdaw
