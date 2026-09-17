// native/jigdaw-adapter/include/jigdaw/Midi.hpp
#pragma once

#include <cstddef>
#include <cstdint>

#include "jigdaw/Chain.hpp"
#include "jigdaw/Module.hpp"

namespace jigdaw {

/// Apply one MIDI message to a chain.
///
/// Separate from the DPF wrapper so that it can be tested against real bytes.
/// While this lived inside run() the only way to reach it was a DAW and a
/// keyboard, so the one part of the adapter a person drives directly was the
/// one part nothing checked.
///
/// Returns true if the message was understood. Anything else is ignored rather
/// than guessed at: a message this does not handle belongs to whatever the
/// chain does not implement, and inventing a meaning for it would be worse than
/// passing it on untouched.
///
/// `size` is the whole message including status. Running status is not handled
/// because neither VST3 nor LV2 nor CLAP delivers it: every host hands over
/// complete messages.
bool applyMidi(Chain& chain, const uint8_t* data, std::size_t size);

/// The same decoding, for one module that speaks version 1 notes.
///
/// Two entry points and one decoder. A chain routing events to an ABI 1 module
/// has to turn them into notes, and writing that out a second time next to this
/// one is how the two come to disagree about whether a note on of velocity zero
/// is a note off.
bool applyMidi(Module& module, const uint8_t* data, std::size_t size);

}  // namespace jigdaw
