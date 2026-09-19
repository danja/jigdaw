// plugins/8b8/8b8.cpp
//
// The JigDAW module for the 8b8, wrapping the firmware in docs/module-abi.md.
//
// The firmware is included as one translation unit, exactly as the Arduino
// IDE builds it and exactly as the 8bit8asterd emulator's own host.cpp does.
// There is no second implementation of the synth here to drift out of step
// with the hardware: the only accommodation is the AY_EMULATOR seam already
// in the firmware's writeReg(), which hands register writes to the chip model
// instead of bit-banging pins.
//
// What this file adds is the ABI. jig:Abi2, because a device whose percussion
// is MIDI channel 10 and whose every control also answers to a CC cannot be
// driven through version 1's jig_note_on and jig_note_off: they carry no
// channel and no controller. Events arrive as whole MIDI messages.
//
// Real-time rules, from AGENTS.md:
//
//  - Nothing here allocates. There is no libc, no C++ runtime and no malloc
//    linked at all, so an accidental allocation is a link error rather than a
//    glitch. Every buffer below is static and sized at compile time.
//  - Memory is never grown, so the host may hold the pointers and the views
//    it took after jig_init. The ABI requires that; in a browser the symptom
//    of breaking it is silence rather than an exception.
//  - An event happens at its frame within the block. The render loop pushes
//    each one into the firmware's MIDI queue on the sample it belongs to and
//    the firmware picks it up on its next poll, which is what the hardware
//    does with a packet arriving between polls.

#include <stdint.h>

#include "shim/arduino_shim.h"
#include "firmware/ay8910.h"
#include "shim/MIDIUSB.h"
#include "generated/param-map.h"

// ---- storage for everything the shim declares ------------------------------
uint8_t emuPins[32];
uint64_t emuMicros = 0;
uint8_t TCCR1A = 0, TCCR1B = 0, TCCR1C = 0, TIMSK0 = 0, TIMSK1 = 0, SREG = 0;
uint16_t OCR1A = 0, TCNT1 = 0;
uint8_t OCR1AH = 0, OCR1AL = 0;
uint8_t emuEeprom[1024];
EEPROMClass EEPROM;
NullSerial Serial;
NullSerial Serial1;
MidiUSB_ MidiUSB;

// ---- the three chips -------------------------------------------------------
static AY8910 chips[3];

void emuWriteReg (uint8_t chip, unsigned char reg, unsigned char db) {
  if (chip < 3) chips[chip].write(reg, db);
}

#define AY_EMULATOR 1
#include "firmware/8b8_firmware.ino"


// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------
// The chip model steps at clock/8, and the firmware programs Timer1 for a
// 1MHz master clock, so 125000 steps a second box-filtered down to the host's
// rate. The same figures the 8bit8asterd emulator renders at, so what a DAW
// hears here is what that repository's tests check.
static const double CHIP_STEP_HZ = 1000000.0 / 8.0;

// A real board AC-couples the chip output. Without modelling that, the steady
// DC a muted channel puts out appears as offset in the render, and offset
// summed across several instances is headroom lost for nothing.
static double dcPrev = 0.0, dcOut = 0.0;

static double hostSampleRate = 48000.0;
static double stepCarry = 0.0;
static double loopAccUs = 0.0;
static bool ready = false;

// ---------------------------------------------------------------------------
// The ABI's buffers. Static, and never resized.
// ---------------------------------------------------------------------------
static const uint32_t MAX_FRAMES = 128;      // one render quantum
static const uint32_t MIDI_IN_CAPACITY = 128;

static float outputBuffer[2][MAX_FRAMES];

// docs/module-abi.md fixes the record at 8 bytes with no padding. Declared as
// the bytes it is rather than as a struct, so no compiler's idea of alignment
// can put a hole in the middle of the host's writes.
struct MidiEvent {
  uint32_t frame;
  uint8_t size;
  uint8_t data[3];
};
static_assert(sizeof(MidiEvent) == 8, "the ABI's event record is 8 bytes");

static MidiEvent midiIn[MIDI_IN_CAPACITY];
static uint32_t midiInCount = 0;

// Set when a message that makes the firmware reset has been handed over, so
// the state it leaves behind can be corrected once it has acted on it.
static bool panicPending = false;

/**
 * Run the firmware for a stretch of time with nothing to render.
 *
 * The firmware writes its chip registers through a cache: it keeps a shadow
 * of all sixteen and flushes the ones that changed on its 100Hz tick. Its
 * startup ends with psg.invalidate(), which sets the "what the chip has"
 * copy to the complement of the shadow so that the next flush rewrites
 * everything.
 *
 * That makes the flush load bearing, and it is ten milliseconds away. A note
 * arriving before it gets there changes the shadow first, and any register
 * whose new value happens to equal the complement that invalidate() wrote is
 * then considered already correct and is never sent. Middle C is tone period
 * 239, whose high byte is 0 against a complement of 0, so the chip keeps the
 * 0xFF that psg.init() left there and the note sounds at under a hertz.
 *
 * Hardware never sees it: a Leonardo takes far longer than ten milliseconds
 * to enumerate on USB, so the flush has always happened before the first
 * MIDI byte can arrive. A host calling jig_init and then jig_process with an
 * event in the first block is what makes it reachable, and that is an
 * ordinary thing for a host to do.
 *
 * So the boot period is modelled rather than skipped. The chips are not
 * stepped, because nothing is listening yet and their counters are reset
 * after.
 */
static void settle (double microseconds) {
  for (double t = 0.0; t < microseconds; t += 125.0) {
    emuMicros += 125;
    loop();
  }
}

/**
 * Whether this message makes the firmware run softReset().
 *
 * All Sound Off, Reset All Controllers and All Notes Off. See resettle()
 * below for why the module has to know.
 */
static bool isPanic (uint8_t status, uint8_t controller) {
  return (status & 0xF0) == 0xB0 &&
         (controller == 120 || controller == 121 || controller == 123);
}

/** Hand one message to the firmware, in the packet shape MIDIUSB delivers. */
static void deliver (const MidiEvent &event) {
  if (event.size < 1 || event.size > 3) return;   // the ABI says ignore
  const uint8_t status = event.data[0];
  if (status < 0x80 || status >= 0xF0) return;    // no realtime, no sysex

  // The USB MIDI header's code index number is the status nibble for every
  // channel message, which is all the firmware reads it as.
  MidiUSB.push(midiEventPacket_t{
    (uint8_t)(status >> 4), status, event.data[1], event.data[2]
  });
  if (isPanic(status, event.data[1])) panicPending = true;
}

/**
 * Send the firmware's register cache to the chips, now.
 *
 * The cache holds a shadow of all sixteen registers per chip and a copy of
 * what it believes the chip has, and it flushes the difference on the 100Hz
 * tick. invalidate() sets the second copy to the complement of the first so
 * that the next flush rewrites everything, which works only if nothing
 * changes the shadow in between: a register whose new value happens to equal
 * the complement is then taken for already sent and never goes out.
 *
 * The firmware invalidates whenever a parameter changes and whenever it
 * resets, and leaves up to ten milliseconds before the flush. Hardware gets
 * away with it. A host setting a parameter and playing a note in the same
 * millisecond does not, and middle C is one of the values it goes wrong on.
 *
 * So the module invalidates and flushes together, which closes the window
 * rather than narrowing it. It costs 48 register writes and happens on a
 * parameter change, never in the render loop.
 */
static void flush () {
  psg.invalidate();
  psg.updateAll();
}

/**
 * Put the chips back where boot leaves them, after the firmware has reset.
 *
 * softReset() silences the voices and then calls psg.init(), which fills all
 * sixteen registers of all three chips with 0xFF and writes them out. Boot
 * does the same two things the other way round, so it ends with the
 * amplitude registers at zero; the reset ends with them at 0xFF, which sets
 * the chip's M bit and hands the volume of every channel to the envelope
 * generator, at a period of 0xFFFF with the mixer muting tone and noise.
 *
 * That is not silence. It is a sixteen second ramp from nothing to full
 * scale, and it arrives as a bang about seventeen seconds after the panic
 * message that a host sends precisely to make everything stop. Measured at
 * 0.93 RMS with nothing playing.
 *
 * The firmware does this on hardware too, and the fix belongs there. Until
 * it has one, this repeats the half of boot that softReset() undoes: kill
 * every voice, which is the firmware's own call and writes zero into those
 * same amplitude registers. Nothing else is touched.
 */
static void resettle () {
  panicPending = false;
  for (ushort v = 0; v < MAX_VOICES; v++) voices[v].kill();
  flush();
}

extern "C" {

// The linker leaves static constructors to be run by __wasm_call_ctors, and
// with no entry point nothing calls it. The chips and the firmware's own
// objects are constructed here, once, before anything touches them.
extern void __wasm_call_ctors ();

void jig_init (float rate) {
  static bool constructed = false;
  if (!constructed) { __wasm_call_ctors(); constructed = true; }

  hostSampleRate = rate > 0.0f ? (double)rate : 48000.0;
  stepCarry = 0.0;
  loopAccUs = 0.0;
  dcPrev = dcOut = 0.0;
  emuMicros = 0;
  midiInCount = 0;
  MidiUSB.clear();

  // 0xFF is what an unwritten EEPROM reads as, so the firmware's layout check
  // fails and it boots on the generated defaults, exactly as a fresh board
  // does. There is nowhere to persist to here: state belongs in the project.
  memset(emuEeprom, 0xFF, sizeof emuEeprom);

  for (int i = 0; i < 3; i++) chips[i].reset();
  for (int c = 0; c < 2; c++)
    for (uint32_t i = 0; i < MAX_FRAMES; i++) outputBuffer[c][i] = 0.0f;

  setup();

  // Long enough for several of the firmware's 100Hz ticks, so its first
  // register flush has happened before a host can deliver anything.
  settle(50000.0);

  ready = true;
}

uint32_t jig_max_frames () { return MAX_FRAMES; }

uint32_t jig_output_ptr (uint32_t channel) {
  return (uint32_t)(uintptr_t)outputBuffer[channel < 2 ? channel : 1];
}

uint32_t jig_midi_in_ptr () { return (uint32_t)(uintptr_t)midiIn; }
uint32_t jig_midi_in_capacity () { return MIDI_IN_CAPACITY; }

void jig_midi_in (uint32_t count) {
  midiInCount = count < MIDI_IN_CAPACITY ? count : MIDI_IN_CAPACITY;
}

/**
 * Set a parameter by its jig:paramIndex.
 *
 * The port carries the displayed value, which is what generate.py's scale and
 * offset turn the firmware's byte into: raw 0 to 48 is minus 24 to plus 24
 * semitones. This runs that backwards. setParam clamps, so a value outside
 * the port's declared range lands at the end of it rather than wrapping.
 */
void jig_set_param (uint32_t index, float value) {
  if (index >= JIG_PARAM_COUNT) return;
  const JigParamScale &map = JIG_PARAM_SCALE[index];
  float raw = value / map.scale - (float)map.offset;
  // Round half away from zero without libm: every raw value is a small
  // non-negative integer by the time it gets here.
  int rounded = (int)(raw >= 0.0f ? raw + 0.5f : raw - 0.5f);
  setParam((uint8_t)index, rounded);

  // What the firmware does after every setParam of its own, in both its CC
  // handler and its serial command handler. It is where the LFO phase steps,
  // the warp interval and the retuning of held notes are worked out, so a
  // parameter set without it is stored and not applied.
  recalcDerived();
  flush();
}

/**
 * Render one block.
 *
 * Per sample: advance the firmware's clock, service loop() at about 8kHz,
 * release any event that happens on this sample, then step the chips.
 *
 * loop() used to be called once per sample in the emulator this came from,
 * which is 44100 services a second of a firmware whose fastest timer is 4kHz.
 * Polling at 8kHz is ample and cuts the work by about five sixths, which
 * matters when it is sharing an audio thread.
 */
void jig_process (uint32_t frames) {
  if (frames > MAX_FRAMES) frames = MAX_FRAMES;
  if (!ready) {
    for (uint32_t i = 0; i < frames; i++) outputBuffer[0][i] = outputBuffer[1][i] = 0.0f;
    midiInCount = 0;
    return;
  }

  const double stepsPerSample = CHIP_STEP_HZ / hostSampleRate;
  const double usPerSample = 1000000.0 / hostSampleRate;

  uint32_t nextEvent = 0;

  for (uint32_t i = 0; i < frames; i++) {
    // Events first, so one landing on this sample is in the queue before the
    // poll that would read it. Ascending frame order is the host's promise;
    // an event whose frame is past the end of the block is still released,
    // because the alternative is holding it into a block it has no position
    // in at all.
    while (nextEvent < midiInCount && midiIn[nextEvent].frame <= i) {
      deliver(midiIn[nextEvent]);
      nextEvent++;
    }

    emuMicros += (uint64_t)usPerSample;
    loopAccUs += usPerSample;
    if (loopAccUs >= 125.0) {
      loopAccUs = 0.0;
      loop();
      if (panicPending) resettle();
    }

    stepCarry += stepsPerSample;
    int steps = (int)stepCarry;
    stepCarry -= steps;
    if (steps < 1) steps = 1;

    float acc = 0.0f;
    for (int s = 0; s < steps; s++) {
      acc += chips[0].step() + chips[1].step() + chips[2].step();
    }
    double v = acc / (double)(steps * 3);
    dcOut = v - dcPrev + 0.9995 * dcOut;   // about 3.5Hz, one pole, high pass
    dcPrev = v;

    // Mono. Both channels carry it, rather than jig_output_ptr handing out
    // one buffer twice: a host is entitled to treat the two as separate.
    outputBuffer[0][i] = outputBuffer[1][i] = (float)dcOut;
  }

  // Anything the host wrote past the events it delivered has been consumed.
  // The count describes the block that just ran and nothing else.
  while (nextEvent < midiInCount) { deliver(midiIn[nextEvent]); nextEvent++; }
  midiInCount = 0;
}

// ---- introspection, for the tests ------------------------------------------
// Not part of the ABI. A host must ignore what it does not know, and these
// are how tests/dsp/8b8.test.js reads the chip state the firmware programmed
// rather than inferring it from the audio.
int32_t jig_x_register (uint32_t chip, uint32_t reg) {
  if (chip > 2) return -1;
  return chips[chip].read((uint8_t)reg);
}
int32_t jig_x_voice_playing (uint32_t voice) {
  if (voice >= MAX_VOICES) return -1;
  return m_playing[voice];
}
int32_t jig_x_param (uint32_t index) {
  if (index >= JIG_PARAM_COUNT) return -1;
  return params[index];
}

}
