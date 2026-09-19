// plugins/8b8/shim/MIDIUSB.h
//
// MIDIUSB stub. The firmware calls read() once per loop() and acts on whatever
// packet comes back, so this is the door every incoming message goes through.
//
// A fixed ring, not a std::deque: this is written from jig_midi_in and drained
// from inside jig_process, both of which run on the audio thread, where
// AGENTS.md forbids allocating. It holds one render quantum's worth of events
// several times over. On overflow it refuses the newest rather than
// overwriting the oldest, because dropping an older note on while keeping its
// note off would leave a voice sounding for ever.
#pragma once
#include <stdint.h>

#define MIDIUSB_h

typedef struct {
  uint8_t header;
  uint8_t byte1;
  uint8_t byte2;
  uint8_t byte3;
} midiEventPacket_t;

class MidiUSB_ {
public:
  static const int CAPACITY = 128;

  midiEventPacket_t read () {
    if (head == tail) return midiEventPacket_t{0, 0, 0, 0};
    midiEventPacket_t e = q[tail];
    tail = (tail + 1) % CAPACITY;
    return e;
  }
  void flush () {}
  void sendMIDI (midiEventPacket_t) {}

  // Host side. Returns false when the ring is full, which is how the caller
  // learns it dropped something rather than finding out by silence.
  bool push (midiEventPacket_t e) {
    int next = (head + 1) % CAPACITY;
    if (next == tail) return false;
    q[head] = e;
    head = next;
    return true;
  }
  void clear () { head = tail = 0; }

private:
  midiEventPacket_t q[CAPACITY];
  int head = 0, tail = 0;
};
extern MidiUSB_ MidiUSB;
