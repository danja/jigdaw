// plugins/octet/octet.cpp
//
// Octet: an eight-band parametric equalizer as a Jig effect. Ported from the Downspout plugin of the same
// name (downspout/plugins/octet, MIT), itself a redesign of the EQ Eight in oxide-studio. Each band is one
// of eight shapes (two cuts at 12 or 48 dB per octave, low and high shelves, a bell, a notch), in
// double precision, with its own stereo channel assignment; Stereo, Left/Right and Mid/Side modes;
// a transparent default (a fresh instance passes the signal bit for bit); frequency, gain and Q gliding
// to a new value in steps of 32 samples so a fast sweep does not zipper; and the Drift convention for MIDI,
// where CC 1 to 4 on a chosen channel drive one band's frequency, gain and Q and the output level.
//
// The spectrum analyser (a Hann windowed 4096 point FFT of the mono sum, 64 log spaced bands, refreshed
// about 30 times a second) is here too, and its levels are published for the processor to hand to the
// plugin's own editor (messaging.md 2.4). The original published them as 64 read-only output
// parameters; a profile has no output ports, so they go through the relay instead and the module only
// says where they are (jig_spectrum_ptr) and when they changed (jig_spectrum_serial).
//
// What differs from the original, and why:
//  - No std::array, std::complex or libm. Every table is static and built in jig_init, before the module
//    is ready, and sin, cos, 2^x and log2 are written here and checked against Math.* by
//    tests/dsp/octet.test.js. The plotted response (bandResponseDb) is not here: the editor draws it in
//    JavaScript from the same formulae, and the tests hold the audio to that curve.
//  - The module keeps the original's parameter indices, and drops its 64 spectrum outputs.
//
// Real-time rules (CLAUDE.md): nothing in jig_process allocates.
#include <stddef.h>
#include <stdint.h>

namespace {

constexpr uint32_t MAX_FRAMES = 128;
constexpr uint32_t MIDI_IN_CAPACITY = 256;

constexpr int BANDS = 8;
constexpr int MAX_SECTIONS = 4;
constexpr int SPECTRUM_BINS = 64;
constexpr int FFT_SIZE = 4096;
constexpr float SPECTRUM_FLOOR_DB = -90.0f;
constexpr float SPECTRUM_FALL_DB_PER_SECOND = 40.0f;
constexpr float SPECTRUM_UPDATES_PER_SECOND = 30.0f;

constexpr double PI = 3.14159265358979323846;
constexpr double LOG2_10 = 3.32192809488736234787;
constexpr double LOG10_2 = 0.30102999566398119521;
constexpr double LOG2_E = 1.44269504088896340736;

// Parameter indices are the original's and are stable: 0 mode, 1 output, then six per band, then the
// controls appended after them. profile.json lists the same ports in the same order and a test binds them.
enum BandParam { B_ON, B_TYPE, B_FREQ, B_GAIN, B_Q, B_CHANNEL, PER_BAND };
constexpr int P_MODE = 0;
constexpr int P_OUTPUT = 1;
constexpr int FIRST_BAND = 2;
constexpr int BAND_END = FIRST_BAND + BANDS * PER_BAND;
constexpr int P_CC_CHANNEL = BAND_END;
constexpr int P_CC_BAND = BAND_END + 1;
constexpr int P_SPECTRUM_SOURCE = BAND_END + 2;
constexpr int P_COUNT = BAND_END + 3;

enum BandType { HP12, HP48, LOW_SHELF, BELL, NOTCH, HIGH_SHELF, LP12, LP48 };
constexpr int BAND_TYPES = 8;
enum StereoMode { STEREO, LEFT_RIGHT, MID_SIDE };
enum SpectrumSource { SOURCE_OFF, SOURCE_PRE, SOURCE_POST };

struct Range { float lo, hi, def; bool integer; };

// A band's own ranges, then the globals. The band defaults (type, frequency, on, Q) vary by band and are
// set in defaultOf().
const Range BAND_RANGE[PER_BAND] = {
  {0, 1, 0, true}, {0, 7, 3, true}, {20, 20000, 1000, false}, {-18, 18, 0, false}, {0.1f, 18, 1, false}, {0, 2, 0, true}
};
const Range MODE_RANGE = {0, 2, 0, true};
const Range OUTPUT_RANGE = {-12, 12, 0, false};
const Range CC_CHANNEL_RANGE = {0, 16, 1, true};
const Range CC_BAND_RANGE = {1, 8, 4, true};
const Range SPECTRUM_RANGE = {0, 2, 2, true};

// The conventional eight band layout. The cuts start off, so a fresh instance changes nothing.
const float BAND_FREQ[BANDS] = {30, 100, 250, 600, 1500, 4000, 8000, 18000};
const int BAND_TYPE[BANDS] = {HP48, LOW_SHELF, BELL, BELL, BELL, BELL, HIGH_SHELF, LP48};

Range rangeOf(int index) {
  if (index == P_MODE) return MODE_RANGE;
  if (index == P_OUTPUT) return OUTPUT_RANGE;
  if (index == P_CC_CHANNEL) return CC_CHANNEL_RANGE;
  if (index == P_CC_BAND) return CC_BAND_RANGE;
  if (index == P_SPECTRUM_SOURCE) return SPECTRUM_RANGE;
  return BAND_RANGE[(index - FIRST_BAND) % PER_BAND];
}

float defaultOf(int index) {
  if (index < FIRST_BAND || index >= BAND_END) return rangeOf(index).def;
  const int band = (index - FIRST_BAND) / PER_BAND;
  switch ((index - FIRST_BAND) % PER_BAND) {
    case B_ON: return (band == 0 || band == BANDS - 1) ? 0.0f : 1.0f;
    case B_TYPE: return (float)BAND_TYPE[band];
    case B_FREQ: return BAND_FREQ[band];
    case B_Q: return (BAND_TYPE[band] == LOW_SHELF || BAND_TYPE[band] == HIGH_SHELF) ? 0.71f : 1.0f;
    default: return rangeOf(index).def;
  }
}

struct MidiEvent {
  uint32_t frame;
  uint8_t size;
  uint8_t data[3];
};

struct Band { float on, type, freqHz, gainDb, q, channel; };

struct Biquad { double b0, b1, b2, a1, a2; };
struct Sections { int count; Biquad bq[MAX_SECTIONS]; };
struct SectionState { double z1, z2; };

struct BandRuntime {
  Sections sections;
  SectionState state[2][MAX_SECTIONS];
  bool active;
  int channels;          // bit 0 = channel A, bit 1 = channel B
  Band last;             // what the sections were computed from: it glides to the target in steps of 32 samples
  bool computed;
};

// A controller overrides one control until the panel moves it or the host automates it (the Drift convention).
constexpr int CC_SLOTS = 4;
struct LiveControl { float value[CC_SLOTS]; bool active[CC_SLOTS]; };

float inputBuffer[2][MAX_FRAMES];
float outputBuffer[2][MAX_FRAMES];
MidiEvent midiIn[MIDI_IN_CAPACITY];
uint32_t midiInCount = 0;
alignas(8) uint8_t transportBlock[64];   // part of the ABI; this effect does not use the transport

float params[P_COUNT];
BandRuntime bands[BANDS];
LiveControl live;
float outputLinear = 1.0f;
bool primed = false;
double sampleRate = 48000.0;
bool ready = false;

// ---- the analyser's memory ---------------------------------------------------

float spectrumRing[FFT_SIZE];
int spectrumWrite = 0;
int spectrumSince = 0;
double fftRe[FFT_SIZE], fftIm[FFT_SIZE];
float spectrumLevel[SPECTRUM_BINS];
bool spectrumPrimed = false;
uint32_t spectrumSerial = 0;
double windowTable[FFT_SIZE];
double cosTable[FFT_SIZE / 2], sinTable[FFT_SIZE / 2];
int reverseTable[FFT_SIZE];

// ---- freestanding maths ------------------------------------------------------

inline double absd(double v) { return v < 0.0 ? -v : v; }
inline double mind(double a, double b) { return a < b ? a : b; }
inline double maxd(double a, double b) { return a > b ? a : b; }
inline float clampf(float v, float lo, float hi) {
  if (!(v == v) || v - v != 0.0f) return lo;     // NaN and infinities
  return v < lo ? lo : (v > hi ? hi : v);
}
inline int roundi(double v) { return (int)__builtin_floor(v + 0.5); }
inline double floord(double v) { return __builtin_floor(v); }
inline double sqrtd(double v) { return __builtin_sqrt(v); }
inline bool finitef(float v) { return v == v && v - v == 0.0f; }

// exp2 splits off the integer part exactly and sums a Taylor series for the fraction in
// [-0.5, 0.5], where fourteen terms are good to about 1e-16.
double exp2d(double x) {
  if (x < -1000.0) return 0.0;
  if (x > 1000.0) x = 1000.0;
  const double n = __builtin_floor(x + 0.5);
  const double f = (x - n) * 0.69314718055994530942;
  double term = 1.0, sum = 1.0;
  for (int i = 1; i < 14; i++) { term *= f / i; sum += term; }
  union { uint64_t bits; double value; } scale;
  scale.bits = (uint64_t)((int)n + 1023) << 52;
  return sum * scale.value;
}

double expd(double x) { return exp2d(x * LOG2_E); }

// log2 of a positive number: the exponent comes out of the bits exactly, and the mantissa, folded into
// [sqrt(1/2), sqrt(2)), goes through 2 atanh((m - 1) / (m + 1)), a series that converges fast there.
double log2d(double x) {
  if (!(x > 0.0)) return -1000.0;
  union { uint64_t bits; double value; } v;
  v.value = x;
  int exponent = (int)((v.bits >> 52) & 0x7ff) - 1023;
  v.bits = (v.bits & 0x000fffffffffffffULL) | 0x3ff0000000000000ULL;
  double m = v.value;
  if (m > 1.41421356237309504880) { m *= 0.5; exponent += 1; }
  const double s = (m - 1.0) / (m + 1.0);
  const double s2 = s * s;
  double term = s, sum = s;
  for (int i = 1; i < 14; i++) { term *= s2; sum += term / (2.0 * i + 1.0); }
  return exponent + 2.0 * sum * LOG2_E;
}

inline double pow10d(double x) { return exp2d(x * LOG2_10); }
inline double log10d(double x) { return log2d(x) * LOG10_2; }

double reduceAngle(double x) {
  const double turns = __builtin_floor(x / (2.0 * PI) + 0.5);
  return x - turns * 2.0 * PI;
}

// Taylor series on an angle reduced to [-pi, pi]; sixteen terms reach 1e-16 at pi.
double sind(double x) {
  x = reduceAngle(x);
  const double x2 = x * x;
  double term = x, sum = x;
  for (int i = 1; i < 16; i++) { term *= -x2 / ((2.0 * i) * (2.0 * i + 1.0)); sum += term; }
  return sum;
}

double cosd(double x) {
  x = reduceAngle(x);
  const double x2 = x * x;
  double term = 1.0, sum = 1.0;
  for (int i = 1; i < 16; i++) { term *= -x2 / ((2.0 * i - 1.0) * (2.0 * i)); sum += term; }
  return sum;
}

// ---- bands -------------------------------------------------------------------

Band clampBand(const Band &in) {
  Band b = in;
  b.on = in.on >= 0.5f ? 1.0f : 0.0f;
  b.type = (float)roundi(clampf(in.type, 0.0f, (float)(BAND_TYPES - 1)));
  b.freqHz = clampf(in.freqHz, 20.0f, 20000.0f);
  b.gainDb = clampf(in.gainDb, -18.0f, 18.0f);
  b.q = clampf(in.q, 0.1f, 18.0f);
  b.channel = (float)roundi(clampf(in.channel, 0.0f, 2.0f));
  return b;
}

inline int typeOf(const Band &b) { return roundi(b.type); }
inline bool usesGain(const Band &b) { const int t = typeOf(b); return t == BELL || t == LOW_SHELF || t == HIGH_SHELF; }

// A band that changes the signal at all: a bell or shelf at 0 dB, or a band that is off, does not.
bool isActive(const Band &raw) {
  const Band b = clampBand(raw);
  if (b.on < 0.5f) return false;
  return !usesGain(b) || absd(b.gainDb) > 0.005;
}

// RBJ cookbook cell with an explicit Q.
Biquad cell(int type, double f0, double gainDb, double q, double sr) {
  const double w0 = 2.0 * PI * f0 / sr;
  const double cw = cosd(w0), sw = sind(w0);
  const double alpha = sw / (2.0 * q);
  const double A = pow10d(gainDb / 40.0);
  double b0, b1, b2, a0, a1, a2;
  switch (type) {
    case BELL:
      b0 = 1.0 + alpha * A; b1 = -2.0 * cw; b2 = 1.0 - alpha * A;
      a0 = 1.0 + alpha / A; a1 = -2.0 * cw; a2 = 1.0 - alpha / A;
      break;
    case LOW_SHELF: {
      const double s = 2.0 * sqrtd(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cw + s);
      b1 = 2 * A * ((A - 1) - (A + 1) * cw);
      b2 = A * ((A + 1) - (A - 1) * cw - s);
      a0 = (A + 1) + (A - 1) * cw + s;
      a1 = -2 * ((A - 1) + (A + 1) * cw);
      a2 = (A + 1) + (A - 1) * cw - s;
      break;
    }
    case HIGH_SHELF: {
      const double s = 2.0 * sqrtd(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cw + s);
      b1 = -2 * A * ((A - 1) + (A + 1) * cw);
      b2 = A * ((A + 1) + (A - 1) * cw - s);
      a0 = (A + 1) - (A - 1) * cw + s;
      a1 = 2 * ((A - 1) - (A + 1) * cw);
      a2 = (A + 1) - (A - 1) * cw - s;
      break;
    }
    case NOTCH:
      b0 = 1.0; b1 = -2.0 * cw; b2 = 1.0;
      a0 = 1.0 + alpha; a1 = -2.0 * cw; a2 = 1.0 - alpha;
      break;
    case HP12:
    case HP48:
      b0 = (1.0 + cw) * 0.5; b1 = -(1.0 + cw); b2 = (1.0 + cw) * 0.5;
      a0 = 1.0 + alpha; a1 = -2.0 * cw; a2 = 1.0 - alpha;
      break;
    default:  // low-pass
      b0 = (1.0 - cw) * 0.5; b1 = 1.0 - cw; b2 = (1.0 - cw) * 0.5;
      a0 = 1.0 + alpha; a1 = -2.0 * cw; a2 = 1.0 - alpha;
      break;
  }
  const double inv = 1.0 / a0;
  return {b0 * inv, b1 * inv, b2 * inv, a1 * inv, a2 * inv};
}

Sections makeSections(const Band &raw, double sampleRateHz) {
  const Band b = clampBand(raw);
  const double sr = sampleRateHz > 0.0 ? sampleRateHz : 44100.0;
  const double f0 = mind((double)b.freqHz, sr * 0.49);
  const int t = typeOf(b);
  Sections s;
  s.count = 0;
  switch (t) {
    case HP48:
    case LP48:
      // 8th-order Butterworth: four sections with Q = 1 / (2 cos((2k-1) pi / 16)), so the response is
      // -3 dB at the cutoff (identical Q = 0.707 sections would be -12 dB there).
      for (int k = 1; k <= 4; ++k) {
        const double q = 1.0 / (2.0 * cosd((2.0 * k - 1.0) * PI / 16.0));
        s.bq[s.count++] = cell(t, f0, 0.0, q, sr);
      }
      break;
    case HP12:
    case LP12:
      s.bq[s.count++] = cell(t, f0, 0.0, 0.70710678118654752, sr);
      break;
    default:
      s.bq[s.count++] = cell(t, f0, b.gainDb, b.q, sr);
      break;
  }
  return s;
}

inline double runCell(SectionState &s, const Biquad &c, double x) {
  const double y = c.b0 * x + s.z1;
  s.z1 = c.b1 * x - c.a1 * y + s.z2;
  s.z2 = c.b2 * x - c.a2 * y;
  return y;
}

// ---- parameters and MIDI -------------------------------------------------------

struct Settings {
  float mode, outputDb, ccChannel, ccBand, spectrumSource;
  Band bands[BANDS];
};

Settings settings() {
  Settings s;
  s.mode = (float)roundi(clampf(params[P_MODE], 0.0f, 2.0f));
  s.outputDb = clampf(params[P_OUTPUT], -12.0f, 12.0f);
  s.ccChannel = (float)roundi(clampf(params[P_CC_CHANNEL], 0.0f, 16.0f));
  s.ccBand = (float)roundi(clampf(params[P_CC_BAND], 1.0f, (float)BANDS));
  s.spectrumSource = (float)roundi(clampf(params[P_SPECTRUM_SOURCE], 0.0f, 2.0f));
  for (int i = 0; i < BANDS; ++i) {
    const float *p = &params[FIRST_BAND + i * PER_BAND];
    s.bands[i] = clampBand({p[B_ON], p[B_TYPE], p[B_FREQ], p[B_GAIN], p[B_Q], p[B_CHANNEL]});
  }
  return s;
}

// CC 1 Frequency (logarithmic, 20 Hz to 20 kHz), 2 Gain, 3 Q (logarithmic, 0.1 to 18) of the band chosen by
// ccBand, and 4 the Output.
float ccToValue(int slot, int cc) {
  const double u = (double)(cc < 0 ? 0 : (cc > 127 ? 127 : cc)) / 127.0;
  switch (slot) {
    case 0: return (float)(20.0 * exp2d(u * log2d(1000.0)));
    case 1: return (float)(-18.0 + 36.0 * u);
    case 2: return (float)(0.1 * exp2d(u * log2d(180.0)));
    default: return (float)(-12.0 + 24.0 * u);
  }
}

bool ccChannelMatches(uint8_t status, float ccChannel) {
  return (status & 0xF0) == 0xB0 && ccChannel >= 0.5f && (int)(status & 0x0F) + 1 == roundi(ccChannel);
}

Settings withLive(const Settings &s) {
  Settings o = s;
  const int band = (int)(s.ccBand < 1 ? 1 : (s.ccBand > BANDS ? BANDS : s.ccBand)) - 1;
  Band &b = o.bands[band];
  if (live.active[0]) b.freqHz = live.value[0];
  if (live.active[1]) b.gainDb = live.value[1];
  if (live.active[2]) b.q = live.value[2];
  if (live.active[3]) o.outputDb = live.value[3];
  return o;
}

// The control a Drift CC overrides, or -1: the panel moving it takes it back.
int liveSlot(int index, int ccBand) {
  const int band = ccBand < 1 ? 0 : (ccBand > BANDS ? BANDS - 1 : ccBand - 1);
  const int base = FIRST_BAND + band * PER_BAND;
  return index == base + B_FREQ ? 0 : index == base + B_GAIN ? 1 : index == base + B_Q ? 2 : index == P_OUTPUT ? 3 : -1;
}

void clearLive() {
  for (int i = 0; i < CC_SLOTS; ++i) { live.value[i] = 0.0f; live.active[i] = false; }
}

// ---- the equaliser ---------------------------------------------------------------

void resetBands() {
  unsigned char *bytes = (unsigned char *)bands;
  for (size_t i = 0; i < sizeof(bands); ++i) bytes[i] = 0;
  for (int i = 0; i < BANDS; ++i) bands[i].channels = 3;
}

void processBlock(const Settings &p, uint32_t frames) {
  const double sr = sampleRate;
  const int mode = roundi(p.mode);

  const float outGoal = (float)pow10d(p.outputDb / 20.0);
  if (!primed) { outputLinear = outGoal; primed = true; }
  const float outFrom = outputLinear;
  const float invFrames = frames > 0 ? 1.0f / (float)frames : 0.0f;

  float *out0 = outputBuffer[0];
  float *out1 = outputBuffer[1];
  for (uint32_t i = 0; i < frames; ++i) {
    const float a = finitef(inputBuffer[0][i]) ? inputBuffer[0][i] : 0.0f;
    const float b = finitef(inputBuffer[1][i]) ? inputBuffer[1][i] : 0.0f;
    out0[i] = a;
    out1[i] = b;
  }

  bool any = false;
  for (int bi = 0; bi < BANDS; ++bi) {
    BandRuntime &br = bands[bi];
    const Band &b = p.bands[bi];
    const bool active = isActive(b);
    if (active) {
      // A change of type (or a band coming on) takes effect at once; frequency, gain and Q glide to the target.
      if (!br.computed || b.type != br.last.type) {
        br.sections = makeSections(b, sr);
        br.last = b;
        br.computed = true;
      }
    } else if (br.active) {
      for (int c = 0; c < 2; ++c) for (int s = 0; s < MAX_SECTIONS; ++s) br.state[c][s].z1 = br.state[c][s].z2 = 0.0;  // switched off: drop the memory
      br.computed = false;
    }
    br.active = active;
    const int ch = mode == STEREO ? 0 : roundi(b.channel);
    br.channels = ch == 0 ? 3 : (ch == 1 ? 1 : 2);
    any = any || active;
  }

  const float s2 = 0.70710678118654752f;
  const bool matrix = any && mode == MID_SIDE;
  if (matrix) {
    for (uint32_t i = 0; i < frames; ++i) {
      const float l = out0[i], r = out1[i];
      out0[i] = (l + r) * s2;
      out1[i] = (l - r) * s2;
    }
  }

  // Frequency (in octaves), gain and Q glide toward the target in steps of 32 samples (about a 4 ms time
  // constant), so a fast sweep of a high-Q band does not zipper or click. The sections are rebuilt from the
  // gliding parameters, which keeps every step a stable filter; once the target is reached nothing is recomputed.
  constexpr uint32_t STEP = 32;
  const double glide = 1.0 - expd(-(double)STEP / (0.004 * sr));
  for (int bi = 0; bi < BANDS; ++bi) {
    BandRuntime &br = bands[bi];
    if (!br.active) continue;
    const Band &target = p.bands[bi];
    for (uint32_t start = 0; start < frames; start += STEP) {
      const uint32_t n = (frames - start) < STEP ? (frames - start) : STEP;
      Band &cur = br.last;
      const double dOct = log2d((double)target.freqHz / cur.freqHz);
      const double dGain = (double)target.gainDb - cur.gainDb;
      const double dQ = log2d((double)target.q / cur.q);
      if (dOct != 0.0 || dGain != 0.0 || dQ != 0.0) {
        const bool close = absd(dOct) < 1e-4 && absd(dGain) < 5e-3 && absd(dQ) < 1e-3;
        if (close) {
          cur = target;
        } else {
          cur.freqHz = (float)(cur.freqHz * exp2d(dOct * glide));
          cur.gainDb = (float)(cur.gainDb + dGain * glide);
          cur.q = (float)(cur.q * exp2d(dQ * glide));
        }
        br.sections = makeSections(cur, sr);
      }
      for (int c = 0; c < 2; ++c) {
        if (!(br.channels & (1 << c))) continue;
        float *buf = (c == 0 ? out0 : out1) + start;
        SectionState *st = br.state[c];
        for (uint32_t i = 0; i < n; ++i) {
          double x = buf[i];
          for (int s = 0; s < br.sections.count; ++s) x = runCell(st[s], br.sections.bq[s], x);
          buf[i] = (float)x;
        }
      }
    }
  }

  if (matrix) {
    for (uint32_t i = 0; i < frames; ++i) {
      const float m = out0[i], s = out1[i];
      out0[i] = (m + s) * s2;
      out1[i] = (m - s) * s2;
    }
  }

  for (uint32_t i = 0; i < frames; ++i) {
    const float g = outFrom + (outGoal - outFrom) * ((float)(i + 1) * invFrames);
    out0[i] *= g;
    out1[i] *= g;
  }
  outputLinear = outGoal;

  // Recursive memory decays into denormals on a silent input; zero what is negligible.
  constexpr double TINY = 1.0e-30;
  for (BandRuntime &br : bands)
    for (int c = 0; c < 2; ++c)
      for (int s = 0; s < MAX_SECTIONS; ++s) {
        if (absd(br.state[c][s].z1) < TINY) br.state[c][s].z1 = 0.0;
        if (absd(br.state[c][s].z2) < TINY) br.state[c][s].z2 = 0.0;
      }
}

// ---- the spectrum analyser -----------------------------------------------------------

void buildFftTables() {
  for (int i = 0; i < FFT_SIZE; ++i) windowTable[i] = 0.5 - 0.5 * cosd(2.0 * PI * i / FFT_SIZE);
  for (int i = 0; i < FFT_SIZE / 2; ++i) {
    cosTable[i] = cosd(2.0 * PI * i / FFT_SIZE);
    sinTable[i] = -sind(2.0 * PI * i / FFT_SIZE);
  }
  int bits = 0;
  while ((1 << bits) < FFT_SIZE) ++bits;
  for (int i = 0; i < FFT_SIZE; ++i) {
    int r = 0;
    for (int b = 0; b < bits; ++b)
      if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    reverseTable[i] = r;
  }
}

// Edge frequencies of band k (0..64): geometric from 20 Hz to 20 kHz.
double bandEdgeHz(int k) { return 20.0 * exp2d((double)k / SPECTRUM_BINS * log2d(1000.0)); }

// In-place radix-2 complex FFT.
void fft() {
  for (int i = 0; i < FFT_SIZE; ++i) {
    const int j = reverseTable[i];
    if (j > i) {
      const double tr = fftRe[i]; fftRe[i] = fftRe[j]; fftRe[j] = tr;
      const double ti = fftIm[i]; fftIm[i] = fftIm[j]; fftIm[j] = ti;
    }
  }
  for (int len = 2; len <= FFT_SIZE; len <<= 1) {
    const int half = len / 2, step = FFT_SIZE / len;
    for (int start = 0; start < FFT_SIZE; start += len) {
      for (int k = 0; k < half; ++k) {
        const double wr = cosTable[k * step], wi = sinTable[k * step];
        const int a = start + k, b = start + k + half;
        const double xr = fftRe[b] * wr - fftIm[b] * wi, xi = fftRe[b] * wi + fftIm[b] * wr;
        fftRe[b] = fftRe[a] - xr;
        fftIm[b] = fftIm[a] - xi;
        fftRe[a] += xr;
        fftIm[a] += xi;
      }
    }
  }
}

inline double magnitude(int k, double scale) {
  return sqrtd(fftRe[k] * fftRe[k] + fftIm[k] * fftIm[k]) * scale;
}

void refreshSpectrum() {
  for (int i = 0; i < FFT_SIZE; ++i) {
    fftRe[i] = (double)spectrumRing[(spectrumWrite + i) % FFT_SIZE] * windowTable[i];
    fftIm[i] = 0.0;
  }
  fft();

  // A sine of amplitude A peaks at A * N / 4 with a Hann window.
  const double scale = 4.0 / FFT_SIZE;
  const double binHz = sampleRate / FFT_SIZE;
  const double nyquist = 0.5 * sampleRate;
  const float fall = SPECTRUM_FALL_DB_PER_SECOND / SPECTRUM_UPDATES_PER_SECOND;

  for (int k = 0; k < SPECTRUM_BINS; ++k) {
    const double lo = bandEdgeHz(k), hi = bandEdgeHz(k + 1);
    float db = SPECTRUM_FLOOR_DB;
    if (lo < nyquist * 0.98) {
      // Narrow low bands fall between bins: interpolate at the band centre. Wide bands take their loudest bin.
      const double centre = sqrtd(lo * hi) / binHz;
      int c0 = (int)floord(centre);
      c0 = c0 < 0 ? 0 : (c0 > FFT_SIZE / 2 - 1 ? FFT_SIZE / 2 - 1 : c0);
      const double frac = centre - floord(centre);
      const int c1 = c0 + 1 < FFT_SIZE / 2 ? c0 + 1 : FFT_SIZE / 2;
      double m = magnitude(c0, scale) * (1.0 - frac) + magnitude(c1, scale) * frac;
      const int first = (int)(__builtin_ceil(lo / binHz));
      int last = (int)floord(hi / binHz);
      if (last > FFT_SIZE / 2) last = FFT_SIZE / 2;
      for (int b = first; b <= last; ++b) m = maxd(m, magnitude(b, scale));
      db = clampf((float)(20.0 * log10d(m + 1e-9)), SPECTRUM_FLOOR_DB, 6.0f);
    }
    float &held = spectrumLevel[k];
    held = spectrumPrimed ? (db > held - fall ? db : held - fall) : db;
  }
  spectrumPrimed = true;
  spectrumSerial++;
}

void resetSpectrum() {
  for (int i = 0; i < FFT_SIZE; ++i) spectrumRing[i] = 0.0f;
  spectrumWrite = 0;
  spectrumSince = 0;
  for (int k = 0; k < SPECTRUM_BINS; ++k) spectrumLevel[k] = SPECTRUM_FLOOR_DB;
  spectrumPrimed = false;
  spectrumSerial++;
}

// Feeds `frames` stereo frames and refreshes the levels when a hop has passed.
void analyse(uint32_t frames, const float *left, const float *right) {
  const int hop = (int)(sampleRate / SPECTRUM_UPDATES_PER_SECOND) < 1 ? 1 : (int)(sampleRate / SPECTRUM_UPDATES_PER_SECOND);
  for (uint32_t i = 0; i < frames; ++i) {
    spectrumRing[spectrumWrite] = 0.5f * (left[i] + right[i]);
    spectrumWrite = (spectrumWrite + 1) % FFT_SIZE;
    if (++spectrumSince >= hop) {
      spectrumSince = 0;
      refreshSpectrum();
    }
  }
}

}  // namespace

extern "C" {

void jig_init(float rate) {
  sampleRate = rate > 0.0f ? (double)rate : 48000.0;
  for (int c = 0; c < 2; c++)
    for (uint32_t i = 0; i < MAX_FRAMES; i++) { inputBuffer[c][i] = 0.0f; outputBuffer[c][i] = 0.0f; }
  for (int i = 0; i < P_COUNT; i++) params[i] = defaultOf(i);
  midiInCount = 0;
  buildFftTables();
  resetBands();
  clearLive();
  resetSpectrum();
  outputLinear = 1.0f;
  primed = false;
  ready = true;
}

uint32_t jig_max_frames(void) { return MAX_FRAMES; }

uint32_t jig_input_ptr(uint32_t channel) { return (uint32_t)(uintptr_t)inputBuffer[channel < 2 ? channel : 1]; }
uint32_t jig_output_ptr(uint32_t channel) { return (uint32_t)(uintptr_t)outputBuffer[channel < 2 ? channel : 1]; }

uint32_t jig_midi_in_ptr(void) { return (uint32_t)(uintptr_t)midiIn; }
uint32_t jig_midi_in_capacity(void) { return MIDI_IN_CAPACITY; }
void jig_midi_in(uint32_t count) { midiInCount = count < MIDI_IN_CAPACITY ? count : MIDI_IN_CAPACITY; }

uint32_t jig_transport_ptr(void) { return (uint32_t)(uintptr_t)transportBlock; }

void jig_set_param(uint32_t index, float value) {
  if (index >= (uint32_t)P_COUNT) return;
  const Range r = rangeOf((int)index);
  float v = clampf(value, r.lo, r.hi);
  if (r.integer) v = (float)roundi(v);
  params[index] = v;
  // The panel or the host has taken the control back from a controller; a new CC band starts with none held.
  if ((int)index == P_CC_BAND) clearLive();
  else {
    const int slot = liveSlot((int)index, roundi(params[P_CC_BAND]));
    if (slot >= 0) live.active[slot] = false;
  }
}

void jig_process(uint32_t frames) {
  if (frames > MAX_FRAMES) frames = MAX_FRAMES;
  if (!ready || frames == 0) {
    for (uint32_t i = 0; i < frames; i++) outputBuffer[0][i] = outputBuffer[1][i] = 0.0f;
    midiInCount = 0;
    return;
  }
  const Settings base = settings();

  // CC 1-4 on the set channel drive one band's Frequency, Gain and Q and the Output. Applied at block start.
  for (uint32_t i = 0; i < midiInCount; i++) {
    const MidiEvent &e = midiIn[i];
    if (e.size >= 3 && ccChannelMatches(e.data[0], base.ccChannel)) {
      const int controller = e.data[1];
      if (controller >= 1 && controller <= CC_SLOTS) {
        live.value[controller - 1] = ccToValue(controller - 1, e.data[2]);
        live.active[controller - 1] = true;
      }
    }
  }
  midiInCount = 0;
  const Settings effective = withLive(base);

  const int source = roundi(base.spectrumSource);
  // Pre-EQ reads the inputs before they are processed; post-EQ reads the outputs after.
  if (source == SOURCE_PRE) analyse(frames, inputBuffer[0], inputBuffer[1]);
  processBlock(effective, frames);
  if (source == SOURCE_POST) analyse(frames, outputBuffer[0], outputBuffer[1]);
  // Switched off: let the display's bars fall to nothing.
  if (source == SOURCE_OFF && spectrumPrimed) resetSpectrum();
}

uint32_t jig_latency_frames(void) { return 0; }

// ---- what the processor hands to the editor, and introspection for the tests ----
// Not part of the ABI. The processor posts jig_spectrum_ptr's 64 floats to the plugin's own editor when
// jig_spectrum_serial has moved; the tests read back what the module did rather than inferring it from audio.
uint32_t jig_spectrum_ptr(void) { return (uint32_t)(uintptr_t)spectrumLevel; }
uint32_t jig_spectrum_bins(void) { return SPECTRUM_BINS; }
uint32_t jig_spectrum_serial(void) { return spectrumSerial; }
double jig_spectrum_edge_hz(int32_t k) { return bandEdgeHz(k); }

float jig_param_min(uint32_t index) { return index < (uint32_t)P_COUNT ? rangeOf((int)index).lo : 0.0f; }
float jig_param_max(uint32_t index) { return index < (uint32_t)P_COUNT ? rangeOf((int)index).hi : 0.0f; }
float jig_param_default(uint32_t index) { return index < (uint32_t)P_COUNT ? defaultOf((int)index) : 0.0f; }
float jig_param(uint32_t index) { return index < (uint32_t)P_COUNT ? params[index] : 0.0f; }

// Whether controller slot 0 to 3 is being held by a MIDI controller, and what it holds.
int32_t jig_live_active(int32_t slot) { return slot >= 0 && slot < CC_SLOTS && live.active[slot] ? 1 : 0; }
float jig_live_value(int32_t slot) { return slot >= 0 && slot < CC_SLOTS ? live.value[slot] : 0.0f; }

// The freestanding functions, so the tests can set them against Math.*.
// op: 0 sin, 1 cos, 2 log2, 3 exp2, 4 10^x.
double jig_math(int32_t op, double a, double b) {
  (void)b;
  switch (op) {
    case 0: return sind(a);
    case 1: return cosd(a);
    case 2: return log2d(a);
    case 3: return exp2d(a);
    case 4: return pow10d(a);
    default: return 0.0;
  }
}

}
