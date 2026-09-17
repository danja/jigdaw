// native/jigdaw-adapter/src/dpf/DistrhoPluginInfo.h
#pragma once

#define DISTRHO_PLUGIN_BRAND   "JigDAW"
#define DISTRHO_PLUGIN_NAME    "JigDAW Adapter"
#define DISTRHO_PLUGIN_URI     "https://github.com/danja/jigdaw#adapter"

#define DISTRHO_PLUGIN_HAS_UI          0
#define DISTRHO_PLUGIN_IS_RT_SAFE      1
#define DISTRHO_PLUGIN_NUM_INPUTS      2
#define DISTRHO_PLUGIN_NUM_OUTPUTS     2
#define DISTRHO_PLUGIN_WANT_MIDI_INPUT  1
#define DISTRHO_PLUGIN_WANT_MIDI_OUTPUT 1
#define DISTRHO_PLUGIN_WANT_STATE       1
#define DISTRHO_PLUGIN_WANT_FULL_STATE  1

#define DISTRHO_PLUGIN_VST3_CATEGORIES "Fx|Instrument"
#define DISTRHO_PLUGIN_CLAP_ID         "it.strandz.jigdaw.adapter"
#define DISTRHO_PLUGIN_CLAP_FEATURES   "audio-effect","instrument"
