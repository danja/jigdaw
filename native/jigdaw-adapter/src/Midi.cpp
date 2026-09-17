// native/jigdaw-adapter/src/Midi.cpp
#include "jigdaw/Midi.hpp"

namespace jigdaw {

namespace {
constexpr uint8_t kNoteOff = 0x80;
constexpr uint8_t kNoteOn = 0x90;
constexpr uint8_t kControlChange = 0xb0;
constexpr uint8_t kAllNotesOff = 123;
constexpr uint8_t kAllSoundOff = 120;
}  // namespace

namespace {

/// What the message means, decided once.
enum class Action { none, noteOn, noteOff, allOff };

Action decode(const uint8_t* const data, const std::size_t size) {
    if (data == nullptr || size < 2) return Action::none;
    const uint8_t status = data[0] & 0xf0;

    // A note on with velocity zero is a note off. Every MIDI source does this,
    // and a synth that ignores it sustains for ever.
    if (status == kNoteOn && size > 2 && data[2] > 0) return Action::noteOn;
    if (status == kNoteOff || (status == kNoteOn && size > 2 && data[2] == 0)) return Action::noteOff;
    // 120 as well as 123: a DAW sends 120 on stop, and a synth that only knows
    // 123 keeps ringing after the transport has stopped.
    if (status == kControlChange && (data[1] == kAllNotesOff || data[1] == kAllSoundOff)) {
        return Action::allOff;
    }
    return Action::none;
}

}  // namespace

bool applyMidi(Chain& chain, const uint8_t* const data, const std::size_t size) {
    switch (decode(data, size)) {
        case Action::noteOn:  chain.noteOn(data[1], data[2]); return true;
        case Action::noteOff: chain.noteOff(data[1]); return true;
        case Action::allOff:  chain.allNotesOff(); return true;
        case Action::none:    return false;
    }
    return false;
}

bool applyMidi(Module& module, const uint8_t* const data, const std::size_t size) {
    switch (decode(data, size)) {
        case Action::noteOn:  module.noteOn(data[1], data[2]); return true;
        case Action::noteOff: module.noteOff(data[1]); return true;
        case Action::allOff:  module.allNotesOff(); return true;
        case Action::none:    return false;
    }
    return false;
}

}  // namespace jigdaw
