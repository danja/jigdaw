// plugins/mop/mop.cpp
//
// The JigDAW module for Mop: an OPL3 FM General MIDI instrument.
//
// mop plays MIDI files through an Opal YMF262 emulator fed with a standard
// AdLib .bnk bank. This module is that synthesiser with the file player
// removed: live MIDI arrives through the jig:Abi2 event buffer instead of
// tml.h, and the 18 hardware voices are capped by the `voices` parameter,
// which defaults to 8.
//
// This software is based on mop by M. Glargaard, used under its zlib licence
// and marked as altered as that licence requires. The Opal core in opal/ is
// included unmodified. The .bnk bank is mop's own mop.bnk, embedded so the
// module is self-contained: a worklet cannot fetch, and the profile names
// every file a plugin uses.
//
// What is faithful to mop.c: the bank parsing, the operator register
// programming, the f-number search, the voice allocation with
// least-recently-released stealing, the per-channel volume, expression, pan,
// sustain and pitch bend handling, and the channel 10 percussion map.
//
// What is new: the MIDI file front end is gone, the voice pool is capped by
// a parameter, pitch bend range and master tuning are parameters rather than
// constants, velocity response is adjustable, every parameter answers to a
// MIDI CC as the profile's midi:binding declarations say, and a pan change
// retunes the stereo bits of sounding voices rather than only of new ones.
//
// Real-time rules, from AGENTS.md: nothing here allocates after jig_init,
// memory is never grown, and events are applied at their frame within the
// block. The Opal struct holds no pointers (its own header says so), so the
// whole synth is static storage sized at compile time. There is no libm
// here either: pitch comes from a semitone ratio table, never from pow.

#include <stdint.h>
#include <string.h>

#include "opal/opal.h"
#include "bank.h"

// ---------------------------------------------------------------------------
// Parameters, in the order mop-processor.js writes them and the profile
// lists them. tests/dsp/mop.test.js holds the three together.
// ---------------------------------------------------------------------------
enum {
  P_PROGRAM = 0,
  P_VOICES = 1,
  P_GAIN = 2,
  P_BEND_RANGE = 3,
  P_TUNING = 4,
  P_VEL_SENSE = 5,
  P_COUNT = 6
};

// The profile's midi:binding declarations, one controller per parameter as
// 8b8 does. Program has none: a program change is its MIDI control.
static const uint8_t PARAM_CC[P_COUNT] = { 0, 70, 71, 72, 73, 74 };

static const float P_MIN[P_COUNT] = { 0.0f, 1.0f, 0.0f, 0.0f, -100.0f, 0.0f };
static const float P_MAX[P_COUNT] = { 127.0f, 18.0f, 1.0f, 12.0f, 100.0f, 1.0f };

static const uint32_t MAX_FRAMES = 128;      // one render quantum
static const uint32_t MIDI_IN_CAPACITY = 128;
static const int CHIP_VOICES = 18;           // the OPL3's two banks of nine
static const int MAX_PROGRAMS = 256;
static const int PERC_BASE = 163;            // mop's percussion offset
static const int PERC_CHANNEL = 9;           // MIDI channel 10, zero-based

// ---------------------------------------------------------------------------
// The ABI's buffers. Static, and never resized.
// ---------------------------------------------------------------------------
static float outputBuffer[2][MAX_FRAMES];

// docs/module-abi.md fixes the record at 8 bytes with no padding. Declared
// as the bytes it is rather than as a struct, so no compiler's idea of
// alignment can put a hole in the middle of the host's writes.
struct MidiEvent {
  uint32_t frame;
  uint8_t size;
  uint8_t data[3];
};
static_assert(sizeof(MidiEvent) == 8, "the ABI's event record is 8 bytes");

static MidiEvent midiIn[MIDI_IN_CAPACITY];
static uint32_t midiInCount = 0;

// ---------------------------------------------------------------------------
// The synth state, all static. A copy of mop.c's, minus the file player.
// ---------------------------------------------------------------------------
static Opal chip;

static uint8_t bankInst[MAX_PROGRAMS][30];
static int bankCount = 0;

struct Voice {
  int active;
  int released;     // held by the sustain pedal
  int channel;
  int note;
  int velocity;
  unsigned long age;
  int prog;
};
static Voice voices[CHIP_VOICES];

static uint8_t program[16];
static uint8_t chVolume[16];
static uint8_t chExpression[16];
static uint8_t chSustain[16];
static uint8_t chPan[16];
static int chPitch[16];        // bend, centred on 0 (-8192..8191)

static unsigned long voiceAge = 0;

// Parameters, as the panel shows them.
static float paramProgram = 0.0f;
static int voiceCap = 8;
static float masterGain = 0.8f;
static float bendRange = 2.0f; // semitones each way on a full bend
static float tuningCents = 0.0f;
static float velSense = 1.0f;

static float hostSampleRate = 48000.0f;
static bool ready = false;

// ---------------------------------------------------------------------------
// OPL register layout, from mop.c.
// ---------------------------------------------------------------------------
static const uint8_t modBase[9] = { 0, 1, 2, 8, 9, 10, 16, 17, 18 };
static const uint8_t carBase[9] = { 3, 4, 5, 11, 12, 13, 19, 20, 21 };

#define BANKOF(v)    (((v) >= 9) << 8)
#define MODR(v, b)   (BANKOF(v) + (b) + modBase[(v) % 9])
#define CARR(v, b)   (BANKOF(v) + (b) + carBase[(v) % 9])
#define CHANR(v, b)  (BANKOF(v) + (b) + ((v) % 9))

static void chipWrite(uint32_t reg, uint8_t val) {
  opalWriteReg(&chip, (uint16_t)reg, val);
}

// The twelve ratios within an octave, quarter-semitone accurate the way
// pulse's table is. Pitch bends and tuning land between steps, so the table
// carries the top octave doubling as a thirteenth entry to interpolate to.
static const float SEMITONE[13] = {
  1.0f, 1.0594631f, 1.122462f, 1.1892071f, 1.259921f, 1.3348398f,
  1.4142135f, 1.4983071f, 1.587401f, 1.6817929f, 1.7817972f, 1.8877486f,
  2.0f
};

// A4 = note 69 = 440 Hz. The octave part is a shift and only the twelve
// ratios need the table, which keeps libm off the audio thread and out of
// the link: a module declaring an ABI must instantiate with no imports.
static float voiceFrequency(int note, float bendSemis) {
  float total = (float)note - 69.0f + bendSemis;
  int oct = (int)(total / 12.0f);
  float rem = total - (float)oct * 12.0f;
  if (rem < 0.0f) { rem += 12.0f; oct -= 1; }
  if (rem >= 12.0f) { rem -= 12.0f; oct += 1; }
  int step = (int)rem;                       // 0..11
  if (step < 0) step = 0;
  if (step > 11) step = 11;
  float frac = rem - (float)step;
  float ratio = SEMITONE[step] + (SEMITONE[step + 1] - SEMITONE[step]) * frac;
  float f = 440.0f * ratio;
  int s = oct;
  int guard = 0;                             // a corrupt bend never loops here
  while (s > 0 && guard < 16) { f *= 2.0f; s--; guard++; }
  while (s < 0 && guard < 16) { f *= 0.5f; s++; guard++; }
  return f;
}

static float channelBendSemis(int ch) {
  return (float)chPitch[ch] / 8192.0f * bendRange + tuningCents / 100.0f;
}

// OPL frequency: f = fnum * 2^block * 49715.9 / 2^20. The lowest block giving
// a valid 10-bit f-number, exactly as mop computes it.
static void noteFrequency(int note, float bendSemis, int *fnum, int *block) {
  float freq = voiceFrequency(note, bendSemis);
  int b = 0;
  int f = 0;
  for (;;) {
    float x = freq * 1048576.0f / (49715.9027777778f * (float)(1 << b));
    f = (int)(x + 0.5f);
    if (f <= 1023 || b >= 7) break;
    b++;
  }
  if (f < 0) f = 0;
  if (f > 1023) f = 1023;
  *fnum = f;
  *block = b;
}

// OPLREGS offsets inside each 13-byte BNK operator, from mop.c.
static uint8_t oplReg20(const uint8_t *o) {
  return (uint8_t)(((o[9] ? 1 : 0) << 7) | ((o[10] ? 1 : 0) << 6) |
                   ((o[5] ? 1 : 0) << 5) | ((o[11] ? 1 : 0) << 4) |
                   (o[1] & 0x0f));
}

static uint8_t oplReg40(const uint8_t *o) {
  return (uint8_t)(((o[0] & 3) << 6) | (o[8] & 0x3f));
}

static uint8_t oplReg60(const uint8_t *o) {
  return (uint8_t)(((o[3] & 0x0f) << 4) | (o[6] & 0x0f));
}

static uint8_t oplReg80(const uint8_t *o) {
  return (uint8_t)(((o[4] & 0x0f) << 4) | (o[7] & 0x0f));
}

static uint8_t oplRegC0(const uint8_t *o) {
  // BNK "con" is inverted: 0 means the OPL connection bit is 1.
  return (uint8_t)(((o[2] & 7) << 1) | (o[12] ? 0 : 1));
}

static int panToStereoMode(uint8_t pan) {
  if (pan < 48) return 1;   // left only
  if (pan > 80) return 2;   // right only
  return 3;                 // centre
}

static uint8_t connectionFor(int prog, int channel) {
  const uint8_t *mod = bankInst[prog] + 2;
  uint8_t con = oplRegC0(mod);
  int mode = panToStereoMode(chPan[channel]);
  con &= ~0x30u;
  if (mode & 1) con |= 0x10;
  if (mode & 2) con |= 0x20;
  return con;
}

static void loadOplInstrument(int voice, int prog, int channel) {
  if (prog < 0 || prog >= bankCount) prog = 0;
  const uint8_t *p = bankInst[prog];
  const uint8_t *mod = p + 2;
  const uint8_t *car = p + 15;

  chipWrite(MODR(voice, 0x20), oplReg20(mod));
  chipWrite(MODR(voice, 0x40), oplReg40(mod));
  chipWrite(MODR(voice, 0x60), oplReg60(mod));
  chipWrite(MODR(voice, 0x80), oplReg80(mod));
  chipWrite(MODR(voice, 0xe0), p[28] & 7);

  chipWrite(CARR(voice, 0x20), oplReg20(car));
  chipWrite(CARR(voice, 0x40), oplReg40(car));
  chipWrite(CARR(voice, 0x60), oplReg60(car));
  chipWrite(CARR(voice, 0x80), oplReg80(car));
  chipWrite(CARR(voice, 0xe0), p[29] & 7);

  chipWrite(CHANR(voice, 0xc0), connectionFor(prog, channel));
}

static void oplNote(int voice, int note, float bendSemis, int on) {
  int fnum, block;
  noteFrequency(note, bendSemis, &fnum, &block);
  chipWrite(CHANR(voice, 0xa0), fnum & 0xff);
  chipWrite(CHANR(voice, 0xb0),
            ((fnum >> 8) & 3) | ((block & 7) << 2) | (on ? 0x20 : 0));
}

static int isPercussionChannel(int ch) { return ch == PERC_CHANNEL; }

static uint8_t percussionProgram(int note) {
  if (note < 35 || note > 81) return (uint8_t)PERC_BASE;
  return (uint8_t)(PERC_BASE + (note - 35));
}

// Channel volume into carrier total level, from mop.c, with the velocity
// response made adjustable: at full sense this is mop exactly, at zero the
// velocity is ignored and every note sounds at the channel level.
static void setVolume(int v) {
  const uint8_t *car = bankInst[voices[v].prog] + 15;
  float velf = (float)voices[v].velocity / 127.0f;
  float eff = velf * velSense + (1.0f - velSense);
  int amp;
  if (isPercussionChannel(voices[v].channel)) {
    amp = 60 + (int)(eff * 63.0f);
  } else {
    float a = (float)chVolume[voices[v].channel] *
              (float)chExpression[voices[v].channel] * eff / 16129.0f;
    amp = (int)(a * 127.0f);
  }
  int level = (car[8] & 63) + (127 - amp) * 63 / 127;
  if (level > 63) level = 63;
  if (level < 0) level = 0;
  chipWrite(CARR(v, 0x40), (uint8_t)(((car[0] & 3) << 6) | level));
}

// ---------------------------------------------------------------------------
// Voices. One pool for pitched and percussion notes, as in mop: the chip has
// eighteen 2-op channels and no opinion about which is which. The pool is
// capped by the voices parameter; allocation and stealing only ever look at
// the first voiceCap slots.
// ---------------------------------------------------------------------------
static int findVoice(int channel, int note) {
  for (int i = 0; i < CHIP_VOICES; i++) {
    if (voices[i].active && voices[i].channel == channel && voices[i].note == note)
      return i;
  }
  return -1;
}

static void voiceFree(int v) {
  oplNote(v, voices[v].note, channelBendSemis(voices[v].channel), 0);
  voices[v].active = 0;
  voices[v].released = 0;
  voices[v].age = ++voiceAge;
}

static int allocVoice(void) {
  int best = -1;
  int cap = voiceCap < 1 ? 1 : (voiceCap > CHIP_VOICES ? CHIP_VOICES : voiceCap);
  for (int i = 0; i < cap; i++) {
    if (!voices[i].active &&
        (best < 0 || voices[i].age < voices[best].age))
      best = i;
  }
  if (best >= 0) return best;

  // Steal: sustain-held voices first, then the oldest sounding one.
  for (int i = 0; i < cap; i++) {
    if (best < 0 || voices[i].released > voices[best].released ||
        (voices[i].released == voices[best].released &&
         voices[i].age < voices[best].age))
      best = i;
  }
  voiceFree(best);
  return best;
}

static void noteOn(int channel, int note, int velocity) {
  int v = findVoice(channel, note);
  if (v >= 0) {
    oplNote(v, note, channelBendSemis(channel), 0);
    voices[v].active = 0;
  }
  v = allocVoice();

  int prog;
  if (isPercussionChannel(channel)) {
    prog = percussionProgram(note);
  } else {
    prog = program[channel];
    if (prog >= bankCount) prog = 0;
  }
  loadOplInstrument(v, prog, channel);

  voices[v].active = 1;
  voices[v].released = 0;
  voices[v].channel = channel;
  voices[v].note = note;
  voices[v].velocity = velocity;
  voices[v].age = ++voiceAge;
  voices[v].prog = prog;

  setVolume(v);
  oplNote(v, note, channelBendSemis(channel), 1);
}

static void noteOff(int channel, int note) {
  int v = findVoice(channel, note);
  if (v < 0) return;
  if (chSustain[channel] >= 64) {
    voices[v].released = 1;
    return;
  }
  oplNote(v, note, channelBendSemis(channel), 0);
  voices[v].active = 0;
}

static void releaseSustain(int channel) {
  for (int i = 0; i < CHIP_VOICES; i++) {
    if (voices[i].active && voices[i].channel == channel && voices[i].released) {
      oplNote(i, voices[i].note, channelBendSemis(channel), 0);
      voices[i].active = 0;
    }
  }
}

static void allNotesOff(int channel) {
  for (int i = 0; i < CHIP_VOICES; i++) {
    if (voices[i].active && voices[i].channel == channel) {
      oplNote(i, voices[i].note, channelBendSemis(channel), 0);
      voices[i].active = 0;
    }
  }
}

static void setPitch(int channel, int value) {
  chPitch[channel] = value - 8192;
  float bend = channelBendSemis(channel);
  for (int i = 0; i < CHIP_VOICES; i++) {
    if (voices[i].active && voices[i].channel == channel)
      oplNote(i, voices[i].note, bend, 1);
  }
}

static void retuneAll(void) {
  for (int i = 0; i < CHIP_VOICES; i++) {
    if (voices[i].active)
      oplNote(i, voices[i].note, channelBendSemis(voices[i].channel), 1);
  }
}

static void refreshChannelVolume(int channel) {
  for (int i = 0; i < CHIP_VOICES; i++) {
    if (voices[i].active && voices[i].channel == channel) setVolume(i);
  }
}

// mop applies a pan change to subsequently loaded instruments only. The
// connection byte is recomputed from the bank here, so sounding voices
// follow the pan too.
static void refreshChannelPan(int channel) {
  for (int i = 0; i < CHIP_VOICES; i++) {
    if (voices[i].active && voices[i].channel == channel)
      chipWrite(CHANR(i, 0xc0), connectionFor(voices[i].prog, channel));
  }
}

static void resetControllers(int channel) {
  chVolume[channel] = 127;
  chExpression[channel] = 127;
  chSustain[channel] = 0;
  chPitch[channel] = 0;
  chPan[channel] = 64;
  refreshChannelVolume(channel);
  refreshChannelPan(channel);
  retuneAll();
}

// ---------------------------------------------------------------------------
// MIDI dispatch. Whole messages on all sixteen channels: notes, program
// change, pitch bend, and the controllers mop answers to, plus reset-all
// (121) which mop folds into all-notes-off and which here does what it says.
// Controllers 70 to 74 drive the plugin's own parameters on any channel,
// one controller per port as the profile declares.
// ---------------------------------------------------------------------------
static void setParamValue(uint32_t index, float value);

static void applyParamCC(int index, int ccValue) {
  float v = P_MIN[index] +
            (P_MAX[index] - P_MIN[index]) * (float)ccValue / 127.0f;
  // setParamValue clamps; this keeps the two paths to a parameter in one place.
  setParamValue((uint32_t)index, v);
}

static void control(int channel, int number, int value) {
  switch (number) {
    case 7:   chVolume[channel] = (uint8_t)value; refreshChannelVolume(channel); break;
    case 10:  chPan[channel] = (uint8_t)value; refreshChannelPan(channel); break;
    case 11:  chExpression[channel] = (uint8_t)value; refreshChannelVolume(channel); break;
    case 64:
      chSustain[channel] = (uint8_t)value;
      if (value < 64) releaseSustain(channel);
      break;
    case 70:  applyParamCC(P_VOICES, value); break;
    case 71:  applyParamCC(P_GAIN, value); break;
    case 72:  applyParamCC(P_BEND_RANGE, value); break;
    case 73:  applyParamCC(P_TUNING, value); break;
    case 74:  applyParamCC(P_VEL_SENSE, value); break;
    case 120: chSustain[channel] = 0; allNotesOff(channel); break;
    case 121: resetControllers(channel); break;
    case 123: allNotesOff(channel); break;
    default: break;
  }
}

static void dispatch(uint8_t status, uint8_t d1, uint8_t d2) {
  if (status < 0x80 || status >= 0xF0) return;   // no realtime, no sysex
  int channel = status & 0x0F;
  switch (status & 0xF0) {
    case 0x80: noteOff(channel, d1); break;
    case 0x90:
      // A note on with velocity zero is a note off. Every MIDI source does
      // this and a synth that ignores it sustains for ever.
      if (d2) noteOn(channel, d1, d2);
      else noteOff(channel, d1);
      break;
    case 0xB0: control(channel, d1, d2); break;
    case 0xC0:
      if (!isPercussionChannel(channel))
        program[channel] = (d1 < bankCount) ? d1 : 0;
      break;
    case 0xE0: setPitch(channel, (d2 << 7) | d1); break;
    default: break;   // aftertouch has no OPL meaning and is ignored
  }
}

// ---------------------------------------------------------------------------
// Bank parsing, from mop.c's load_bnk_memory, over the embedded bank.
// ---------------------------------------------------------------------------
static uint16_t le16(const uint8_t *p) {
  return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

static uint32_t le32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
         ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static int loadEmbeddedBank(void) {
  const uint8_t *buf = BANK_DATA;
  size_t size = BANK_SIZE;
  if (size < 28) return -1;
  if (memcmp(buf + 2, "ADLIB-", 6) != 0) return -1;
  uint16_t numInstruments = le16(buf + 10);
  uint32_t offsetName = le32(buf + 12);
  uint32_t offsetData = le32(buf + 16);
  size_t namesSize = (size_t)numInstruments * 12;
  size_t dataSize = (size_t)numInstruments * 30;
  if (offsetName > size || namesSize > size - offsetName) return -1;
  if (offsetData > size || dataSize > size - offsetData) return -1;

  const uint8_t *names = buf + offsetName;
  const uint8_t *data = buf + offsetData;
  int count = 0;
  for (size_t i = 0; i < numInstruments && count < MAX_PROGRAMS; i++) {
    const uint8_t *entry = names + i * 12;
    uint16_t midiIndex = le16(entry);
    if (midiIndex >= numInstruments) continue;
    // mop.bnk is version 1.0, whose valid instruments carry flags != 0.
    if (entry[2] != 0) {
      memcpy(bankInst[count], data + (size_t)midiIndex * 30, 30);
      count++;
    }
  }
  bankCount = count;
  return count ? 0 : -1;
}

static void initState(void) {
  for (int i = 0; i < CHIP_VOICES; i++) {
    voices[i].active = 0;
    voices[i].released = 0;
    voices[i].channel = 0;
    voices[i].note = 0;
    voices[i].velocity = 0;
    voices[i].age = 0;
    voices[i].prog = 0;
  }
  voiceAge = 0;
  for (int i = 0; i < 16; i++) {
    program[i] = 0;
    chVolume[i] = 127;
    chExpression[i] = 127;
    chSustain[i] = 0;
    chPitch[i] = 0;
    chPan[i] = 64;
  }
  paramProgram = 0.0f;
  voiceCap = 8;
  masterGain = 0.8f;
  bendRange = 2.0f;
  tuningCents = 0.0f;
  velSense = 1.0f;
}

static float clampParam(int index, float value) {
  if (value < P_MIN[index]) return P_MIN[index];
  if (value > P_MAX[index]) return P_MAX[index];
  return value;
}

extern "C" {

void jig_init(float rate) {
  hostSampleRate = rate > 0.0f ? rate : 48000.0f;
  for (int c = 0; c < 2; c++)
    for (uint32_t i = 0; i < MAX_FRAMES; i++) outputBuffer[c][i] = 0.0f;
  midiInCount = 0;

  loadEmbeddedBank();

  opalInit(&chip, (int)hostSampleRate);
  chipWrite(0x105, 0x01);   // OPL3 mode
  chipWrite(0x01, 0x20);    // waveform select
  chipWrite(0xBD, 0x00);    // melodic mode: drums here are pitched voices

  initState();
  ready = true;
}

uint32_t jig_max_frames(void) { return MAX_FRAMES; }

uint32_t jig_output_ptr(uint32_t channel) {
  return (uint32_t)(uintptr_t)outputBuffer[channel < 2 ? channel : 1];
}

uint32_t jig_midi_in_ptr(void) { return (uint32_t)(uintptr_t)midiIn; }

uint32_t jig_midi_in_capacity(void) { return MIDI_IN_CAPACITY; }

void jig_midi_in(uint32_t count) {
  midiInCount = count < MIDI_IN_CAPACITY ? count : MIDI_IN_CAPACITY;
}

static void setParamValue(uint32_t index, float value);

void jig_set_param(uint32_t index, float value) { setParamValue(index, value); }

static void setParamValue(uint32_t index, float value) {
  if (index >= (uint32_t)P_COUNT) return;
  value = clampParam((int)index, value);
  switch (index) {
    case P_PROGRAM: {
      int p = (int)(value + 0.5f);
      if (p < 0) p = 0;
      if (p > 127) p = 127;
      paramProgram = (float)p;
      // The panel program is the default every melodic channel plays. An
      // incoming program change still overrides a single channel, which is
      // why auditioning presets from the panel does not fight a sequence.
      for (int ch = 0; ch < 16; ch++) {
        if (!isPercussionChannel(ch))
          program[ch] = (p < bankCount) ? (uint8_t)p : 0;
      }
      break;
    }
    case P_VOICES: {
      int v = (int)(value + 0.5f);
      if (v < 1) v = 1;
      if (v > CHIP_VOICES) v = CHIP_VOICES;
      voiceCap = v;
      break;
    }
    case P_GAIN: masterGain = value; break;
    case P_BEND_RANGE: bendRange = value; retuneAll(); break;
    case P_TUNING: tuningCents = value; retuneAll(); break;
    case P_VEL_SENSE: velSense = value; break;
    default: break;
  }
}

// Render one block. Per sample: release any event happening on this sample,
// then step the chip. Events carry offsets within this block; one past its
// end is still released, because the alternative is holding it into a block
// it has no position in at all.
void jig_process(uint32_t frames) {
  if (frames > MAX_FRAMES) frames = MAX_FRAMES;
  if (!ready || bankCount <= 0) {
    for (uint32_t i = 0; i < frames; i++)
      outputBuffer[0][i] = outputBuffer[1][i] = 0.0f;
    midiInCount = 0;
    return;
  }

  uint32_t nextEvent = 0;
  const float scale = masterGain * (1.0f / 32768.0f);

  for (uint32_t i = 0; i < frames; i++) {
    while (nextEvent < midiInCount && midiIn[nextEvent].frame <= i) {
      const MidiEvent &e = midiIn[nextEvent];
      if (e.size >= 1 && e.size <= 3)
        dispatch(e.data[0], e.data[1], e.data[2]);
      nextEvent++;
    }

    int16_t l = 0, r = 0;
    opalSample(&chip, &l, &r);
    outputBuffer[0][i] = (float)l * scale;
    outputBuffer[1][i] = (float)r * scale;
  }

  while (nextEvent < midiInCount) {
    const MidiEvent &e = midiIn[nextEvent];
    if (e.size >= 1 && e.size <= 3)
      dispatch(e.data[0], e.data[1], e.data[2]);
    nextEvent++;
  }
  // The count describes the block that just ran and nothing else.
  midiInCount = 0;
}

uint32_t jig_latency_frames(void) { return 0; }

// ---- introspection, for the tests ------------------------------------------
// Not part of the ABI. A host must ignore what it does not know, and these
// are how tests/dsp/mop.test.js reads back what the module did rather than
// inferring it from the audio.
int32_t jig_active_voices(void) {
  int n = 0;
  for (int i = 0; i < CHIP_VOICES; i++)
    if (voices[i].active) n++;
  return n;
}

int32_t jig_channel_program(uint32_t channel) {
  if (channel >= 16) return -1;
  return program[channel];
}

}
