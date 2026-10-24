// plugins/sam/sam.cpp
//
// Sam: the 1982 Commodore 64 formant speech synthesiser (Software Automatic
// Mouth) as a Jig instrument. Ported from the Downspout plugin of the same
// name; the speech is the vendored C in third_party/, the engine around it is
// rewritten for a module with no libc, no heap and no threads.
//
// Two ways to play it. Keys: each MIDI note speaks one word of the text, sung
// at the pitch of the key. Transport: the words are laid out one per step from
// a start bar and each is spoken as the host playhead reaches it.
//
// Real-time rules (CLAUDE.md): nothing here allocates. Every buffer is static,
// so memory never grows after jig_init. A word is rendered by SAM straight into
// a preallocated voice when it starts, 30 to 50 us for a short word natively.
// The text is parsed in jig_set_text, which the processor calls between
// blocks, never inside jig_process.
#include <stddef.h>
#include <stdint.h>

extern "C" {
#include "third_party/reciter.h"
#include "third_party/sam.h"
}

// The vendored SAM code reads this global (it was main.c's debug switch).
extern "C" {
int debug = 0;
}

namespace {

constexpr uint32_t MAX_FRAMES = 128;
constexpr uint32_t MIDI_IN_CAPACITY = 256;
constexpr int VOICES = 8;
constexpr size_t MAX_RENDER = 22050 * 10;        // SAM's own buffer size
constexpr size_t MAX_WORD_CHARS = 48;            // keeps the phoneme string in range
constexpr size_t MAX_TEXT_BYTES = 2000;
constexpr size_t MAX_SLOTS = 512;
constexpr int MAX_EVENTS = 512;
constexpr int MAX_EVENTS_PER_BLOCK = 64;         // word onsets per block, a guard for tiny steps

constexpr double PI = 3.14159265358979323846;
constexpr double SAM_RATE = 22050.0;
constexpr double PITCH_CONSTANT = 22050.0 * 50.0 / 162.0;   // f0 = 6805.56 / pitch byte
constexpr double FADE_IN_SECONDS = 0.002;
constexpr double TAIL_SOURCE_SAMPLES = 110.0;    // about 5 ms of SAM output
constexpr float STOP_MS = 8.0f;
constexpr float ALL_OFF_MS = 20.0f;
constexpr int FIRST_KEY_WORD = 48;               // C3 speaks the first word in Key = word mode
constexpr int LOWEST_PITCH_BYTE = 3;

enum Param {
  P_MODE, P_SPEED, P_PITCH, P_MOUTH, P_THROAT, P_MONOTONE, P_PHONETIC,
  P_MIDI_CH, P_ADVANCE, P_TRANSPOSE, P_RELEASE,
  P_STEP, P_START_BAR, P_LOOP, P_SPEAK,
  P_TONE, P_LEVEL,
  P_COUNT
};

const float P_MIN[P_COUNT] = {0, 20, 16, 0, 0, 0, 0, 0, 0, -24, 5, 0, 1, 0, 0, 1000, 0};
const float P_MAX[P_COUNT] = {1, 200, 255, 255, 255, 1, 1, 17, 1, 24, 1000, 7, 256, 1, 1, 12000, 1};
const float P_DEF[P_COUNT] = {0, 72, 64, 128, 128, 0, 0, 17, 0, 0, 60, 2, 1, 1, 0, 8000, 0.70f};
const bool P_INTEGER[P_COUNT] = {1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0};

// Length of one word slot in host beats. Values below zero are bars, resolved
// against the time signature: -1 = 1 bar, -2 = 2 bars, -4 = 4 bars.
const float STEP_BEATS[8] = {0.25f, 0.5f, 1.0f, 2.0f, 4.0f, -1.0f, -2.0f, -4.0f};

struct MidiEvent {
  uint32_t frame;
  uint8_t size;
  uint8_t data[3];
};

enum EventKind : uint8_t { EV_NOTE_ON, EV_NOTE_OFF, EV_ALL_OFF, EV_STOP_ALL, EV_WORD, EV_BEND };

struct Event {
  uint32_t frame;
  EventKind kind;
  int a;            // note, slot, or bend value
  int b;            // channel << 8 | velocity, or channel
  double seek;      // seconds into the word, for a word entered mid-slot
};

struct Voice {
  size_t length;
  double position;  // in source samples
  double rate;      // source samples per output sample, before bend
  float gain;
  float dc;
  float lastOut;
  float releaseGain;
  float releaseStep;
  uint32_t fadeIn;
  uint64_t age;
  int note;
  int channel;
  bool active;
  bool releasing;
};

struct Token {
  uint16_t begin;
  uint16_t length;
  bool rest;
};

struct Snapshot {
  int mode, speed, pitch, mouth, throat, midiCh, advance, transpose, step, startBar;
  bool sing, phonetic, loop;
  float releaseMs, toneHz, level;
};

float outputBuffer[2][MAX_FRAMES];
MidiEvent midiIn[MIDI_IN_CAPACITY];
uint32_t midiInCount = 0;
alignas(8) uint8_t transportBlock[64];

float params[P_COUNT];
bool speakRequested = false;

char text[MAX_TEXT_BYTES + 1];     // what jig_text_ptr hands the processor to write into
size_t textLength = 0;
char script[MAX_TEXT_BYTES + 1];   // the cleaned copy the tokens index into
Token tokens[MAX_SLOTS];
size_t tokenCount = 0;

uint8_t voiceData[VOICES][MAX_RENDER];
Voice voices[VOICES];
Event events[MAX_EVENTS];
int eventCount = 0;

double sampleRate = 48000.0;
uint64_t voiceClock = 0;
float stealTail = 0.0f, tone1 = 0.0f, tone2 = 0.0f, bend = 1.0f;
size_t nextSlot = 0;
int lastMode = -1;
bool hostWasPlaying = false;
bool wasLive = false, audition = false;
double auditionBeat = 0.0, expectedBeat = 0.0;
int64_t lastTriggered = -1, currentSlot = -1;
int outWord = 0;
bool ready = false;

// ---- freestanding maths ------------------------------------------------------
// No libm. exp2 splits off the integer part exactly and sums a Taylor series for
// the fraction in [-0.5, 0.5], where twelve terms are good to about 1e-16.
// tests/dsp/sam.test.js compares it with Math.pow across the range it is used in.

double exp2d(double x) {
  if (x < -1000.0) return 0.0;
  if (x > 1000.0) x = 1000.0;
  const double n = __builtin_floor(x + 0.5);
  const double f = (x - n) * 0.69314718055994530942;
  double term = 1.0, sum = 1.0;
  for (int i = 1; i < 14; i++) { term *= f / i; sum += term; }
  const int e = (int)n + 1023;
  union { uint64_t bits; double value; } scale;
  scale.bits = (uint64_t)e << 52;
  return sum * scale.value;
}

double expd(double x) { return exp2d(x * 1.44269504088896340736); }

inline float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }
inline int roundi(double v) { return v < 0.0 ? -(int)(-v + 0.5) : (int)(v + 0.5); }
inline float fabsf_(float v) { return v < 0.0f ? -v : v; }
inline int imin(int a, int b) { return a < b ? a : b; }
inline int imax(int a, int b) { return a > b ? a : b; }
inline int iclamp(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }

// ---- the text ----------------------------------------------------------------

// Printable ASCII is kept, newlines and tabs fold to a space (run lengths are
// kept, so positions in the text do not move), anything else is dropped.
void parseScript(size_t rawLength) {
  size_t n = 0;
  for (size_t i = 0; i < rawLength && n < MAX_TEXT_BYTES; i++) {
    const uint8_t u = (uint8_t)text[i];
    if (u == '\n' || u == '\r' || u == '\t') script[n++] = ' ';
    else if (u >= 0x20 && u < 0x7f) script[n++] = (char)u;
  }
  script[n] = 0;
  textLength = n;

  tokenCount = 0;
  size_t i = 0;
  while (i < n && tokenCount < MAX_SLOTS) {
    while (i < n && script[i] == ' ') i++;
    if (i >= n) break;
    const size_t begin = i;
    while (i < n && script[i] != ' ') i++;
    Token &t = tokens[tokenCount++];
    t.begin = (uint16_t)begin;
    t.length = (uint16_t)(i - begin);
    t.rest = (i - begin == 1 && script[begin] == '_');
  }
}

// Upper-cases and removes what SAM cannot read. Phonetic words keep digits
// (stress marks) and '/'; English words keep letters and the punctuation SAM
// inflects on. Writes at most MAX_WORD_CHARS characters.
size_t cleanWord(const Token &token, bool phonetic, char *out) {
  size_t length = 0;
  const size_t take = token.length < MAX_WORD_CHARS ? token.length : MAX_WORD_CHARS;
  for (size_t i = 0; i < take && length < MAX_WORD_CHARS; i++) {
    unsigned char u = (unsigned char)script[token.begin + i];
    if (u >= 'a' && u <= 'z') u = (unsigned char)(u - 'a' + 'A');
    const bool letter = u >= 'A' && u <= 'Z';
    const bool punctuation = u == '.' || u == ',' || u == '?' || u == '-';
    const bool keep = phonetic ? (letter || punctuation || u == '/' || (u >= '0' && u <= '9'))
                               : (letter || punctuation || u == '\'');
    if (keep) out[length++] = (char)u;
  }
  return length;
}

// ---- SAM ---------------------------------------------------------------------

// Renders one cleaned word to unsigned 8-bit samples at 22.05 kHz, 128 being
// silence. Returns the sample count, or 0 when SAM rejects the word.
size_t renderWord(const char *word, size_t wordLength, const Snapshot &s, bool sing, int pitch, uint8_t *out) {
  if (wordLength == 0) return 0;
  // TextToPhonemes() walks all 256 bytes of its input, so give it a zeroed block.
  unsigned char input[256] = {};
  const size_t length = wordLength < MAX_WORD_CHARS ? wordLength : MAX_WORD_CHARS;
  for (size_t i = 0; i < length; i++) input[i] = (unsigned char)word[i];

  if (s.phonetic) {
    input[length] = 0x9b;
  } else {
    input[length] = '[';
    if (!TextToPhonemes(input)) return 0;
  }
  SetSingmode(sing ? 1 : 0);
  SetSpeed((unsigned char)iclamp(s.speed, 1, 255));
  SetPitch((unsigned char)iclamp(pitch, 0, 255));
  SetMouth((unsigned char)iclamp(s.mouth, 0, 255));
  SetThroat((unsigned char)iclamp(s.throat, 0, 255));
  SetInput(input);
  if (!SAMMain()) return 0;

  const int produced = GetBufferLength() / 50;
  if (produced <= 0) return 0;
  size_t count = (size_t)produced;
  if (count > MAX_RENDER) count = MAX_RENDER;
  const char *source = GetBuffer();
  for (size_t i = 0; i < count; i++) out[i] = (uint8_t)source[i];
  return count;
}

// ---- engine ------------------------------------------------------------------

Snapshot snapshot() {
  Snapshot s;
  s.mode = roundi(params[P_MODE]);
  s.speed = roundi(params[P_SPEED]);
  s.pitch = roundi(params[P_PITCH]);
  s.mouth = roundi(params[P_MOUTH]);
  s.throat = roundi(params[P_THROAT]);
  s.sing = roundi(params[P_MONOTONE]) != 0;
  s.phonetic = roundi(params[P_PHONETIC]) != 0;
  s.midiCh = roundi(params[P_MIDI_CH]);
  s.advance = roundi(params[P_ADVANCE]);
  s.transpose = roundi(params[P_TRANSPOSE]);
  s.releaseMs = params[P_RELEASE];
  s.step = iclamp(roundi(params[P_STEP]), 0, 7);
  s.startBar = roundi(params[P_START_BAR]);
  s.loop = roundi(params[P_LOOP]) != 0;
  s.toneHz = params[P_TONE];
  s.level = params[P_LEVEL];
  return s;
}

int activeVoices() {
  int n = 0;
  for (int i = 0; i < VOICES; i++) n += voices[i].active ? 1 : 0;
  return n;
}

// Insertion sort keeps events in frame order, and equal frames in arrival order.
void addEvent(const Event &event) {
  if (eventCount >= MAX_EVENTS) return;
  int at = eventCount++;
  while (at > 0 && events[at - 1].frame > event.frame) { events[at] = events[at - 1]; --at; }
  events[at] = event;
}

bool channelMatches(int setting, uint8_t status) {
  if (setting <= 0) return false;
  return setting > 16 || (status & 0x0F) + 1 == setting;
}

void collectMidi(const Snapshot &s, uint32_t frames) {
  for (uint32_t i = 0; i < midiInCount; i++) {
    const MidiEvent &in = midiIn[i];
    if (in.size < 2 || in.size > 3) continue;
    const uint8_t status = in.data[0];
    const uint8_t kind = status & 0xF0;
    if (!channelMatches(s.midiCh, status)) continue;

    Event event = {};
    event.frame = in.frame < frames ? in.frame : frames - 1;
    event.b = status & 0x0F;
    if (kind == 0x90 && in.size >= 3 && in.data[2] != 0) {
      event.kind = EV_NOTE_ON;
      event.a = in.data[1];
      event.b = (event.b << 8) | in.data[2];   // channel in the high byte, velocity low
    } else if (kind == 0x80 || kind == 0x90) {
      event.kind = EV_NOTE_OFF;
      event.a = in.data[1];
    } else if (kind == 0xB0 && (in.data[1] == 120 || in.data[1] == 123)) {
      event.kind = EV_ALL_OFF;
    } else if (kind == 0xE0 && in.size >= 3) {
      event.kind = EV_BEND;
      event.a = ((in.data[2] << 7) | in.data[1]) - 8192;
    } else {
      continue;
    }
    addEvent(event);
  }
}

struct Transport {
  bool valid, playing;
  double beat, beatsPerBar, bpm;
};

// The ABI's transport block (docs/module-abi.md). Every field is checked
// against `valid` before use; a host with a tempo and no beat is ordinary.
Transport readTransport() {
  Transport t = {};
  const uint32_t validBits = *(const uint32_t *)(transportBlock + 52);
  t.playing = *(const uint32_t *)(transportBlock + 0) != 0;
  t.valid = (validBits & 1) && (validBits & 2);
  t.bpm = (validBits & 1) ? *(const double *)(transportBlock + 8) : 120.0;
  t.beat = (validBits & 2) ? *(const double *)(transportBlock + 16) : 0.0;
  t.beatsPerBar = 4.0;
  if (validBits & 8) {
    const int32_t numerator = *(const int32_t *)(transportBlock + 44);
    if (numerator > 0) t.beatsPerBar = numerator;
  }
  return t;
}

void scheduleTransport(const Snapshot &s, const Transport &t, uint32_t frames) {
  const bool live = t.valid && t.playing;
  const double bpm = (t.valid && t.bpm > 0.0) ? t.bpm : 120.0;
  const double beatsPerBar = (t.valid && t.beatsPerBar > 0.0) ? t.beatsPerBar : 4.0;
  const double startBeat = (double)(s.startBar - 1) * beatsPerBar;

  const bool speak = speakRequested;
  speakRequested = false;
  if (speak && !live) {
    audition = true;
    auditionBeat = startBeat;
    wasLive = false;   // forces a fresh locate below
  }
  if (live) audition = false;

  if (!live && !audition) {
    if (wasLive) addEvent({0, EV_STOP_ALL, 0, 0, 0.0});
    wasLive = false;
    return;
  }

  const double songBeat = live ? t.beat : auditionBeat;
  const float stepValue = STEP_BEATS[s.step];
  const double stepBeats = stepValue > 0.0f ? (double)stepValue : -(double)stepValue * beatsPerBar;
  const double rel0 = songBeat - startBeat;
  const double beatsPerFrame = bpm / (60.0 * sampleRate);
  const double blockBeats = (double)frames * beatsPerFrame;
  const int64_t count = (int64_t)tokenCount;

  // A relocation (stop and start, a loop wrap, a dragged playhead) is any position
  // the previous block did not lead to. Beats are compared with a margin of a
  // hundredth of a beat because hosts report them in whole ticks.
  const double drift = songBeat - expectedBeat;
  const bool jumped = !wasLive || (drift < 0 ? -drift : drift) > 0.01;
  if (jumped) {
    addEvent({0, EV_STOP_ALL, 0, 0, 0.0});
    if (rel0 >= 0.0) {
      const double slot = __builtin_floor(rel0 / stepBeats + 1.0e-9);
      const double offset = rel0 - slot * stepBeats;
      if (offset > 1.0e-4) {
        // Entered part-way through a slot: speak that word from the matching point.
        lastTriggered = (int64_t)slot;
        const int64_t index = (int64_t)slot;
        const bool inRange = count > 0 && (s.loop || index < count);
        if (inRange && !audition) {
          const int64_t word = s.loop ? index % count : index;
          addEvent({0, EV_WORD, (int)word, 0, offset * 60.0 / bpm});
        }
      } else {
        lastTriggered = (int64_t)slot - 1;
      }
    } else {
      lastTriggered = -1;
    }
  }

  const bool looping = s.loop && !audition;
  int emitted = 0;
  for (int64_t slot = lastTriggered + 1 > 0 ? lastTriggered + 1 : 0; emitted < MAX_EVENTS_PER_BLOCK; ++slot) {
    // The word starts on the first frame at or after its step. Rounding to the
    // nearest frame would put it one frame earlier or later depending on where the
    // host cuts its blocks, and the tolerance keeps a boundary that lands on a
    // frame from slipping. Located by position, never by equality with a block edge.
    const double slotStart = (double)slot * stepBeats;
    const double exact = (slotStart - rel0) / beatsPerFrame - 1.0e-6;
    const int64_t frame = (int64_t)__builtin_ceil(exact);
    if (frame >= (int64_t)frames) break;
    lastTriggered = slot;
    ++emitted;
    if (count == 0) continue;
    if (!looping && slot >= count) continue;
    const int64_t word = looping ? slot % count : slot;
    addEvent({(uint32_t)(frame > 0 ? frame : 0), EV_WORD, (int)word, 0, 0.0});
  }

  expectedBeat = songBeat + blockBeats;
  wasLive = true;
  if (audition) {
    auditionBeat += blockBeats;
    // One pass over the text, then stop once the last word has finished.
    if (lastTriggered >= count - 1 && activeVoices() == 0) audition = false;
  }
}

Voice &takeVoice() {
  Voice *chosen = nullptr;
  for (int i = 0; i < VOICES; i++) {
    Voice &v = voices[i];
    if (!v.active) { chosen = &v; break; }
    if (chosen == nullptr || v.age < chosen->age) chosen = &v;
  }
  if (chosen->active) {
    // Stolen mid-word: carry its last output into a short decay so the cut is not a click.
    stealTail += chosen->lastOut;
    chosen->active = false;
  }
  return *chosen;
}

void startWord(const Snapshot &s, size_t slot, bool sing, int pitch, double pitchRatio, float gain,
               int note, int channel, double seekSeconds) {
  if (slot >= tokenCount) return;
  currentSlot = (int64_t)slot;
  const Token &token = tokens[slot];
  if (token.rest) return;
  char word[MAX_WORD_CHARS + 1];
  const size_t wordLength = cleanWord(token, s.phonetic, word);
  if (wordLength == 0) return;

  Voice &voice = takeVoice();
  uint8_t *data = voiceData[&voice - voices];
  voice.length = renderWord(word, wordLength, s, sing, pitch, data);
  const double start = seekSeconds * SAM_RATE;
  if (voice.length < 4 || start >= (double)voice.length - 2.0) {
    voice.active = false;
    return;
  }

  double sum = 0.0;
  for (size_t i = 0; i < voice.length; i++) sum += (double)data[i];
  voice.dc = (float)((sum / (double)voice.length - 128.0) / 128.0);

  voice.position = start;
  voice.rate = SAM_RATE / sampleRate * pitchRatio;
  voice.gain = gain;
  voice.lastOut = 0.0f;
  voice.releaseGain = 1.0f;
  voice.releaseStep = 0.0f;
  voice.fadeIn = 0;
  voice.age = ++voiceClock;
  voice.note = note;
  voice.channel = channel;
  voice.releasing = false;
  voice.active = true;
}

void releaseVoices(float milliseconds, int note, int channel, bool matchNote) {
  float samples = (float)(sampleRate * 0.001) * milliseconds;
  if (samples < 1.0f) samples = 1.0f;
  for (int i = 0; i < VOICES; i++) {
    Voice &v = voices[i];
    if (!v.active || v.releasing) continue;
    if (matchNote && (v.note != note || v.channel != channel)) continue;
    v.releasing = true;
    v.releaseStep = v.releaseGain / samples;
  }
}

void apply(const Snapshot &s, const Event &event) {
  switch (event.kind) {
    case EV_NOTE_ON: {
      const size_t count = tokenCount;
      if (count == 0) return;
      const int note = event.a;
      const int channel = event.b >> 8;
      const int velocity = event.b & 0xFF;
      size_t slot;
      if (s.advance == 0) {
        slot = nextSlot % count;
        nextSlot = slot + 1;
      } else {
        const int n = (int)count;
        slot = (size_t)(((note - FIRST_KEY_WORD) % n + n) % n);
      }
      // Sung at the key's pitch: the nearest whole glottal period, then the small
      // remainder is made up by resampling so the key is in tune.
      const double hz = 440.0 * exp2d((double)(note + s.transpose - 69) / 12.0);
      const int pitchByte = iclamp(roundi(PITCH_CONSTANT / hz), LOWEST_PITCH_BYTE, 255);
      const double actualHz = PITCH_CONSTANT / (double)pitchByte;
      const float gain = 0.25f + 0.75f * (float)velocity / 127.0f;
      startWord(s, slot, true, pitchByte, hz / actualHz, gain, note, channel, 0.0);
      break;
    }
    case EV_NOTE_OFF: releaseVoices(s.releaseMs, event.a, event.b, true); break;
    case EV_ALL_OFF: releaseVoices(ALL_OFF_MS, 0, 0, false); break;
    case EV_STOP_ALL: releaseVoices(STOP_MS, 0, 0, false); break;
    case EV_WORD:
      startWord(s, (size_t)event.a, s.sing, s.pitch, 1.0, 1.0f, -1, 0, event.seek);
      break;
    case EV_BEND:
      bend = (float)exp2d((double)event.a / 8192.0 * 2.0 / 12.0);
      break;
  }
}

float tick(Voice &voice) {
  const size_t index = (size_t)voice.position;
  if (index + 1 >= voice.length) {
    voice.active = false;
    voice.lastOut = 0.0f;
    return 0.0f;
  }
  const uint8_t *data = voiceData[&voice - voices];
  const float frac = (float)(voice.position - (double)index);
  const float a = (float)data[index];
  const float b = (float)data[index + 1];
  const float sample = ((a + (b - a) * frac) - 128.0f) * (1.0f / 128.0f) - voice.dc;

  float envelope = voice.gain;
  double fadeSamples = sampleRate * FADE_IN_SECONDS;
  if (fadeSamples < 1.0) fadeSamples = 1.0;
  if ((double)voice.fadeIn < fadeSamples) envelope *= (float)((double)voice.fadeIn++ / fadeSamples);
  const double remaining = (double)(voice.length - 1) - voice.position;
  if (remaining < TAIL_SOURCE_SAMPLES) envelope *= (float)(remaining / TAIL_SOURCE_SAMPLES);
  if (voice.releasing) {
    voice.releaseGain -= voice.releaseStep;
    if (voice.releaseGain <= 0.0f) {
      voice.active = false;
      voice.lastOut = 0.0f;
      return 0.0f;
    }
    envelope *= voice.releaseGain;
  }

  voice.position += voice.rate * (double)bend;
  voice.lastOut = sample * envelope;
  return voice.lastOut;
}

void renderRange(const Snapshot &s, uint32_t begin, uint32_t end) {
  const bool toneOn = s.toneHz < P_MAX[P_TONE];
  const float coefficient = toneOn ? (float)(1.0 - expd(-2.0 * PI * (double)s.toneHz / sampleRate)) : 1.0f;

  for (uint32_t frame = begin; frame < end; frame++) {
    float sum = stealTail;
    stealTail = fabsf_(stealTail) < 1.0e-9f ? 0.0f : stealTail * 0.99f;
    for (int i = 0; i < VOICES; i++) {
      if (voices[i].active) sum += tick(voices[i]);
    }
    if (toneOn) {
      tone1 += coefficient * (sum - tone1);
      tone2 += coefficient * (tone1 - tone2);
      if (fabsf_(tone1) < 1.0e-18f) tone1 = 0.0f;
      if (fabsf_(tone2) < 1.0e-18f) tone2 = 0.0f;
      sum = tone2;
    }
    const float out = clampf(sum * s.level, -1.0f, 1.0f);
    outputBuffer[0][frame] = out;
    outputBuffer[1][frame] = out;
  }
}

void setParamValue(uint32_t index, float value) {
  if (index >= (uint32_t)P_COUNT) return;
  if (index == P_SPEAK) {
    if (value > 0.5f) speakRequested = true;
    return;
  }
  float v = clampf(value, P_MIN[index], P_MAX[index]);
  if (P_INTEGER[index]) v = (float)roundi(v);
  params[index] = v;
}

void resetState() {
  for (int i = 0; i < VOICES; i++) { voices[i].active = false; voices[i].releasing = false; voices[i].lastOut = 0.0f; }
  eventCount = 0;
  voiceClock = 0;
  stealTail = tone1 = tone2 = 0.0f;
  bend = 1.0f;
  nextSlot = 0;
  lastMode = -1;
  hostWasPlaying = false;
  wasLive = false;
  audition = false;
  auditionBeat = expectedBeat = 0.0;
  lastTriggered = -1;
  currentSlot = -1;
  speakRequested = false;
  outWord = 0;
}

}  // namespace

extern "C" {

void jig_init(float rate) {
  sampleRate = rate > 0.0f ? (double)rate : 48000.0;
  for (int c = 0; c < 2; c++)
    for (uint32_t i = 0; i < MAX_FRAMES; i++) outputBuffer[c][i] = 0.0f;
  for (int i = 0; i < P_COUNT; i++) params[i] = P_DEF[i];
  midiInCount = 0;
  resetState();
  ready = true;
}

uint32_t jig_max_frames(void) { return MAX_FRAMES; }

uint32_t jig_output_ptr(uint32_t channel) {
  return (uint32_t)(uintptr_t)outputBuffer[channel < 2 ? channel : 1];
}

uint32_t jig_midi_in_ptr(void) { return (uint32_t)(uintptr_t)midiIn; }
uint32_t jig_midi_in_capacity(void) { return MIDI_IN_CAPACITY; }
void jig_midi_in(uint32_t count) { midiInCount = count < MIDI_IN_CAPACITY ? count : MIDI_IN_CAPACITY; }

uint32_t jig_transport_ptr(void) { return (uint32_t)(uintptr_t)transportBlock; }

void jig_set_param(uint32_t index, float value) { setParamValue(index, value); }

// The text is written by the processor into this buffer, then adopted by length.
// Not part of the ABI: a host must ignore what it does not know. The processor
// calls it between blocks, so no render is in progress.
uint32_t jig_text_ptr(void) { return (uint32_t)(uintptr_t)text; }
uint32_t jig_text_capacity(void) { return MAX_TEXT_BYTES; }
void jig_set_text(uint32_t length) {
  parseScript(length < MAX_TEXT_BYTES ? length : MAX_TEXT_BYTES);
  // The old position may name a word that no longer exists.
  nextSlot = 0;
}

void jig_process(uint32_t frames) {
  if (frames > MAX_FRAMES) frames = MAX_FRAMES;
  if (!ready || frames == 0) {
    for (uint32_t i = 0; i < frames; i++) outputBuffer[0][i] = outputBuffer[1][i] = 0.0f;
    midiInCount = 0;
    return;
  }

  const Snapshot s = snapshot();
  eventCount = 0;

  if (s.mode != lastMode) {
    // Switching between Keys and Transport: let go of whatever the other mode started.
    if (lastMode >= 0) releaseVoices(STOP_MS, 0, 0, false);
    lastMode = s.mode;
    wasLive = false;
    audition = false;
    currentSlot = -1;
  }

  const Transport transport = readTransport();
  const bool hostPlaying = transport.valid && transport.playing;
  if (hostPlaying && !hostWasPlaying) nextSlot = 0;   // the text starts again with the song
  hostWasPlaying = hostPlaying;

  if (s.mode == 0) collectMidi(s, frames);
  else scheduleTransport(s, transport, frames);
  midiInCount = 0;

  uint32_t cursor = 0;
  for (int i = 0; i < eventCount; i++) {
    const Event event = events[i];
    if (event.frame > cursor) {
      renderRange(s, cursor, event.frame);
      cursor = event.frame;
    }
    apply(s, event);
  }
  renderRange(s, cursor, frames);

  const bool sounding = s.mode == 0 ? activeVoices() > 0 : (wasLive || audition);
  outWord = sounding && currentSlot >= 0 ? (int)currentSlot + 1 : 0;
}

uint32_t jig_latency_frames(void) { return 0; }

// ---- introspection, for the tests --------------------------------------------
// Not part of the ABI. tests/dsp/sam.test.js reads back what the module did
// rather than inferring it from the audio.
int32_t jig_active_voices(void) { return activeVoices(); }
int32_t jig_out_word(void) { return outWord; }
int32_t jig_word_count(void) { return (int32_t)tokenCount; }
double jig_exp2(double x) { return exp2d(x); }

}
