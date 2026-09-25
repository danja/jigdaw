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

// Latency reporting, for jig_latency_frames. A plugin that delays its output
// has to say so or the host cannot place it: Quefrency's 2047 frames arrived
// 43ms late with nothing told to the host.
#define DISTRHO_PLUGIN_WANT_LATENCY     1

// How many generic parameter slots the host is offered. Here rather than in the
// plugin because the editor has to lay out exactly these slots, and two files
// each holding their own count is how they come to disagree.
//
// Was 16, chosen before the 8-Bit 8asterd (42 ports) existed: a chain is a flat
// list of every loaded plugin's parameters, and a host is never told about a
// slot past this count. Found live, in Reaper, showing a fraction of the
// 8b8's controls. 128 covers that plugin alone with room for a short chain
// beside it: even every jig:abi plugin here loaded together is 79.
// tests/parameter_count_test.cpp binds this to the largest plugin on disk.
#define JIGDAW_PARAMETER_COUNT          128

// The editor is drawn with NanoVG, as the downspout plugins are.
#define DISTRHO_UI_USE_NANOVG           1
#define DISTRHO_UI_DEFAULT_WIDTH        760
#define DISTRHO_UI_DEFAULT_HEIGHT       560

#define DISTRHO_PLUGIN_VST3_CATEGORIES "Fx|Instrument"
#define DISTRHO_PLUGIN_CLAP_ID         "it.strandz.jigdaw.adapter"
#define DISTRHO_PLUGIN_CLAP_FEATURES   "audio-effect","instrument"
