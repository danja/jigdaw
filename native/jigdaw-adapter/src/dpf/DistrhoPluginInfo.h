// native/jigdaw-adapter/src/dpf/DistrhoPluginInfo.h
#pragma once

#define DISTRHO_PLUGIN_BRAND   "JigDAW"
#define DISTRHO_PLUGIN_NAME    "JigDAW Adapter"
#define DISTRHO_PLUGIN_URI     "https://github.com/danja/jigdaw#adapter"

#define DISTRHO_PLUGIN_HAS_UI          1
#define DISTRHO_PLUGIN_IS_RT_SAFE      1
#define DISTRHO_PLUGIN_NUM_INPUTS      2
#define DISTRHO_PLUGIN_NUM_OUTPUTS     2
#define DISTRHO_PLUGIN_WANT_MIDI_INPUT  1
#define DISTRHO_PLUGIN_WANT_MIDI_OUTPUT 1
#define DISTRHO_PLUGIN_WANT_STATE       1
#define DISTRHO_PLUGIN_WANT_FULL_STATE  1

// The transport, for jig:Abi2. A plugin that generates a bass line has to be in
// time with the session, and without this getTimePosition reports nothing.
#define DISTRHO_PLUGIN_WANT_TIMEPOS     1

// How many generic parameter slots the host is offered. Here rather than in the
// plugin because the editor has to lay out exactly these slots, and two files
// each holding their own 16 is how they come to disagree.
#define JIGDAW_PARAMETER_COUNT          16

// The editor is drawn with NanoVG, as the downspout plugins are.
#define DISTRHO_UI_USE_NANOVG           1
#define DISTRHO_UI_DEFAULT_WIDTH        760
#define DISTRHO_UI_DEFAULT_HEIGHT       560

#define DISTRHO_PLUGIN_VST3_CATEGORIES "Fx|Instrument"
#define DISTRHO_PLUGIN_CLAP_ID         "it.strandz.jigdaw.adapter"
#define DISTRHO_PLUGIN_CLAP_FEATURES   "audio-effect","instrument"
