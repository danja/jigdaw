// plugins/quartet/quartet.cpp
//
// Quartet: an eight-voice, four-operator FM synthesiser as a Jig instrument. Ported from the
// Downspout plugin of the same name (downspout/plugins/quartet, MIT), itself a redesign of the
// Operator device in oxide-studio. The algorithm is the original's: four operators A to D, each
// a sine, saw or square (the last two band-limited by a bank of mip-mapped wavetables), eleven
// algorithms, feedback on D, a pitch envelope, one multimode filter, and optional 2x
// oversampling with a half-band decimator. The engine around it is rewritten for a module with
// no libc, no libm, no heap and no threads.
//
// What differs from the original, and why:
//  - No std::vector, std::array or std::complex. Every table is static, so memory never grows
//    after jig_init, and the wavetable bank is built in jig_init, before the module is ready.
//  - sin, cos, tan, exp2 and sqrt are written here (sqrt is the wasm instruction) and checked
//    against Math.* by tests/dsp/quartet.test.js, since a freestanding function is wrong until it
//    has been measured. They run per sample only as exp2, which is exact to 1e-16.
//  - The filter-response plot (filterResponseDb) is not ported: a profile has no way to draw it.
//  - The defaults are a bass voicing, not the original's organ-like default, so a new Quartet
//    plays something useful at once. The ranges and the parameter order are the original's.
//
// Real-time rules (CLAUDE.md): nothing in jig_process allocates.
#include <stddef.h>
#include <stdint.h>

namespace {

constexpr uint32_t MAX_FRAMES = 128;
constexpr uint32_t MIDI_IN_CAPACITY = 256;

constexpr int OPERATORS = 4;
constexpr int ALGORITHMS = 11;
constexpr int VOICES = 8;
constexpr int WAVE_SIZE = 2048;
constexpr int WAVE_MIPS = 11;          // harmonic limits 1024 >> k
constexpr int WAVE_PAD = 4;
constexpr int DECIMATOR_TAPS = 63;

constexpr double PI = 3.14159265358979323846;
constexpr double LOG2_E = 1.44269504088896340736;

// Parameter indices are the original's and are stable: four blocks of ten per operator, then the
// globals. profile.json lists the same ports in the same order and a test binds them.
enum OperatorParam { O_WAVE, O_FIXED, O_RATIO, O_FINE, O_FIXED_HZ, O_LEVEL, O_ATTACK, O_DECAY, O_SUSTAIN, O_RELEASE, PER_OPERATOR };
constexpr int GLOBAL_BASE = OPERATORS * PER_OPERATOR;
enum GlobalParam {
  G_ALGORITHM = GLOBAL_BASE, G_FEEDBACK, G_DEPTH,
  G_PITCH_ON, G_PITCH_AMOUNT, G_PITCH_ATTACK, G_PITCH_DECAY, G_PITCH_SUSTAIN, G_PITCH_RELEASE,
  G_FILTER_TYPE, G_CUTOFF, G_RESONANCE, G_KEY_TRACK,
  G_MASTER, G_VELOCITY, G_BEND_RANGE, G_QUALITY, G_PLAY_MODE, G_GLIDE,
  P_COUNT
};

// Minimum, maximum, default and whether the value is rounded to an integer. The operator rows are
// written once and repeated for the four operators; only the levels and ratios differ in the default.
struct Range { float lo, hi, def; bool integer; };
const Range OPERATOR_RANGE[PER_OPERATOR] = {
  {0, 2, 0, true}, {0, 1, 0, true}, {0.25f, 32, 1, false}, {-50, 50, 0, false}, {10, 20000, 440, false},
  {0, 1, 0.8f, false}, {0.5f, 5000, 5, false}, {1, 8000, 300, false}, {0, 1, 0.7f, false}, {1, 8000, 250, false}
};
const Range GLOBAL_RANGE[P_COUNT - GLOBAL_BASE] = {
  {0, 10, 0, true},          // algorithm
  {0, 1, 0.15f, false},      // feedback
  {0, 4, 1, false},          // depth
  {0, 1, 0, true},           // pitch envelope on
  {-48, 48, 12, false},      // pitch envelope amount
  {0.5f, 5000, 1, false}, {1, 8000, 100, false}, {0, 1, 0, false}, {1, 8000, 100, false},
  {0, 4, 1, true},           // filter type
  {20, 20000, 8000, false},  // cutoff
  {0, 1, 0.15f, false},      // resonance
  {0, 1, 0, false},          // key track
  {0, 1, 0.6f, false},       // master
  {0, 1, 0.7f, false},       // velocity
  {0, 24, 2, false},         // bend range
  {0, 1, 1, true},           // quality
  {0, 2, 0, true},           // play mode
  {0, 2000, 0, false}        // glide
};

// The default voicing, a bass: algorithm 1 (D > C > B > A) with A a sine carrier, B a modulator at the same
// ratio whose envelope decays fast so each note starts with bite and settles to a round tone, and C an octave
// up for a little edge on the attack. D is silent. A mono player with a 24 dB low-pass that follows the note.
struct BassOperator { float wave, ratio, level, attack, decay, sustain, release; };
const BassOperator BASS[OPERATORS] = {
  {0, 1.0f, 0.90f, 2.0f, 600.0f, 0.80f, 140.0f},
  {0, 1.0f, 0.42f, 1.0f, 220.0f, 0.18f, 90.0f},
  {0, 2.0f, 0.14f, 1.0f, 120.0f, 0.00f, 60.0f},
  {0, 1.0f, 0.00f, 1.0f, 100.0f, 0.00f, 60.0f}
};

Range rangeOf(int index) { return index < GLOBAL_BASE ? OPERATOR_RANGE[index % PER_OPERATOR] : GLOBAL_RANGE[index - GLOBAL_BASE]; }

float defaultOf(int index) {
  if (index < GLOBAL_BASE) {
    const BassOperator &b = BASS[index / PER_OPERATOR];
    switch (index % PER_OPERATOR) {
      case O_WAVE: return b.wave;
      case O_FIXED: return 0;
      case O_RATIO: return b.ratio;
      case O_FINE: return 0;
      case O_FIXED_HZ: return 440;
      case O_LEVEL: return b.level;
      case O_ATTACK: return b.attack;
      case O_DECAY: return b.decay;
      case O_SUSTAIN: return b.sustain;
      default: return b.release;
    }
  }
  switch (index) {
    case G_ALGORITHM: return 0;       // algorithm 1
    case G_FEEDBACK: return 0.10f;
    case G_DEPTH: return 1.0f;
    case G_FILTER_TYPE: return 1;     // 24 dB low-pass
    case G_CUTOFF: return 2400;
    case G_RESONANCE: return 0.20f;
    case G_KEY_TRACK: return 0.30f;
    case G_PLAY_MODE: return 1;       // mono
    default: return GLOBAL_RANGE[index - GLOBAL_BASE].def;
  }
}

struct MidiEvent {
  uint32_t frame;
  uint8_t size;
  uint8_t data[3];
};

enum EventKind : uint8_t { EV_NOTE_ON, EV_NOTE_OFF, EV_CONTROLLER, EV_BEND };

struct Event {
  uint32_t frame;
  EventKind kind;
  uint8_t channel, data1, data2;
  int bend;
};

enum class Stage : uint8_t { Idle, Attack, Decay, Release };
struct Envelope { Stage stage; double value; };

struct SvfCoeff { double g, k, a1, a2, a3; };
struct Svf { double ic1, ic2; };

// Algorithm table: for each operator, the bitmask of operators that modulate it, then the carriers.
struct Algorithm { unsigned modulators[OPERATORS]; unsigned carriers; };
const Algorithm ALGORITHM_TABLE[ALGORITHMS] = {
  {{2u, 4u, 8u, 0u}, 1u},      // 1: D > C > B > A
  {{2u, 12u, 0u, 0u}, 1u},     // 2: (C + D) > B > A
  {{6u, 0u, 8u, 0u}, 1u},      // 3: (B + (D > C)) > A
  {{6u, 8u, 8u, 0u}, 1u},      // 4: D > (B + C) > A
  {{2u, 0u, 8u, 0u}, 5u},      // 5: (B > A) + (D > C)
  {{14u, 0u, 0u, 0u}, 1u},     // 6: (B + C + D) > A
  {{0u, 0u, 8u, 0u}, 7u},      // 7: A + B + (D > C)
  {{0u, 4u, 8u, 0u}, 3u},      // 8: A + (D > C > B)
  {{0u, 12u, 0u, 0u}, 3u},     // 9: A + ((C + D) > B)
  {{8u, 8u, 8u, 0u}, 7u},      // 10: D > (A + B + C)
  {{0u, 0u, 0u, 0u}, 15u},     // 11: A + B + C + D
};

// Poly: every note its own voice. Mono: one voice, last note wins, a new note retriggers the envelopes and a
// released note returns to the one still held. Legato: the same, but the envelopes carry on while notes overlap.
enum PlayMode { POLY = 0, MONO, LEGATO };

struct HeldNote { uint8_t note, channel, velocity; };

struct Voice {
  bool active, held, sustained, stealing;
  double glide, pendingGlide;
  int channel;
  float fade;
  int pendingNote, pendingVelocity, pendingChannel;
  int note;
  float velocity;
  double phase[OPERATORS];
  double feedbackY1, feedbackY2;
  Envelope env[OPERATORS];
  Envelope pitchEnv;
  Svf filter1, filter2;
  double opHz[OPERATORS];
  SvfCoeff coeff1, coeff2;
  int controlCountdown;
  float history[DECIMATOR_TAPS];
  int historyPos;
};

struct Settings {
  float op[OPERATORS][PER_OPERATOR];
  int algorithm;
  float feedback, depth;
  bool pitchOn;
  float pitchAmount, pitchAttack, pitchDecay, pitchSustain, pitchRelease;
  int filterType;
  float cutoff, resonance, keyTrack, master, velocity, bendRange;
  int quality, playMode;
  float glide;
};

float outputBuffer[2][MAX_FRAMES];
MidiEvent midiIn[MIDI_IN_CAPACITY];
uint32_t midiInCount = 0;
alignas(8) uint8_t transportBlock[64];   // part of the ABI; this instrument does not use the transport

float params[P_COUNT];
Event events[MIDI_IN_CAPACITY];

Voice voices[VOICES];
bool sustainPedal = false;
HeldNote heldNotes[16];
int heldCount = 0;
int lastNote = -1;                       // the previous note, for portamento
float bendNow[16], bendTarget[16];       // semitones per MIDI channel, smoothed and target
float cutoffSmooth = 8000.0f, masterSmooth = 0.6f;
double dcX = 0.0, dcY = 0.0;
bool primed = false;
double sampleRate = 48000.0;
bool ready = false;

// [wave][mip][WAVE_SIZE + WAVE_PAD]: index 1 is phase 0, so a cubic read at any phase has its four points.
float waveBank[3][WAVE_MIPS][WAVE_SIZE + WAVE_PAD];
double rawMip[WAVE_MIPS][WAVE_SIZE];
double sineTable[WAVE_SIZE], cosineTable[WAVE_SIZE];
float decimatorTaps[DECIMATOR_TAPS];
int decimatorNonzero[DECIMATOR_TAPS];
int decimatorCount = 0;

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

double tand(double x) { return sind(x) / cosd(x); }

// ---- tables, built once in jig_init ---------------------------------------------

double besselI0(double x) {
  double sum = 1.0, term = 1.0;
  for (int k = 1; k < 60; ++k) {
    term *= (x / (2.0 * k)) * (x / (2.0 * k));
    sum += term;
  }
  return sum;
}

// Each operator wave is a sum of harmonics, one set per mip with fewer of them as the table is
// read at a higher pitch, so what is read stays under Nyquist. The harmonics are summed by the
// Chebyshev recurrence sin((h+1)t) = 2 cos(t) sin(h t) - sin((h-1)t), then every table is scaled
// by the peak of the fullest one so the three waves are the same level.
void buildWaves() {
  for (int i = 0; i < WAVE_SIZE; ++i) {
    const double th = 2.0 * PI * i / WAVE_SIZE;
    sineTable[i] = sind(th);
    cosineTable[i] = cosd(th);
  }
  for (int w = 0; w < 3; ++w) {
    double peak = 1e-9;
    for (int m = 0; m < WAVE_MIPS; ++m) {
      const int limit = w == 0 ? 1 : (1024 >> m);
      for (int i = 0; i < WAVE_SIZE; ++i) {
        const double c2 = 2.0 * cosineTable[i];
        double sPrev = 0.0, sNow = sineTable[i], sum = 0.0;
        for (int h = 1; h <= limit; ++h) {
          double amp;
          if (w == 0) amp = 1.0;
          else if (w == 1) amp = (2.0 / PI) * ((h % 2 == 1) ? 1.0 : -1.0) / h;
          else amp = (h % 2 == 1) ? (4.0 / PI) / h : 0.0;
          sum += amp * sNow;
          const double sNext = c2 * sNow - sPrev;
          sPrev = sNow;
          sNow = sNext;
        }
        rawMip[m][i] = sum;
        if (m == 0) peak = maxd(peak, absd(sum));
      }
    }
    for (int m = 0; m < WAVE_MIPS; ++m)
      for (int i = 0; i < WAVE_SIZE + WAVE_PAD; ++i)
        waveBank[w][m][i] = (float)(rawMip[m][((i - 1) % WAVE_SIZE + WAVE_SIZE) % WAVE_SIZE] / peak);
  }

  // The half-band decimator: a Kaiser-windowed sinc at half the rate, unity gain at DC.
  const int c = (DECIMATOR_TAPS - 1) / 2;
  double sum = 0.0;
  double h[DECIMATOR_TAPS];
  for (int n = 0; n < DECIMATOR_TAPS; ++n) {
    const double x = n - c;
    const double sinc = x == 0.0 ? 1.0 : sind(PI * x / 2.0) / (PI * x / 2.0);
    const double r = (double)n / (DECIMATOR_TAPS - 1) * 2.0 - 1.0;
    const double w = besselI0(8.0 * sqrtd(maxd(0.0, 1.0 - r * r))) / besselI0(8.0);
    h[n] = 0.5 * sinc * w;
    sum += h[n];
  }
  decimatorCount = 0;
  for (int n = 0; n < DECIMATOR_TAPS; ++n) {
    decimatorTaps[n] = (float)(h[n] / sum);
    if (absd(decimatorTaps[n]) > 1e-9f) decimatorNonzero[decimatorCount++] = n;
  }
}

inline int mipForHarmonics(double allowed) {
  for (int m = 0; m < WAVE_MIPS; ++m)
    if ((1024 >> m) <= allowed) return m;
  return WAVE_MIPS - 1;
}

inline float readWave(int wave, double phase, double allowedHarmonics) {
  const float *d = waveBank[wave][wave == 0 ? WAVE_MIPS - 1 : mipForHarmonics(allowedHarmonics)];
  const double p = phase - floord(phase);
  const double x = p * WAVE_SIZE;
  const int i = (int)x;
  const float t = (float)(x - i);
  const float y0 = d[i], y1 = d[i + 1], y2 = d[i + 2], y3 = d[i + 3];
  const float c1 = 0.5f * (y2 - y0), c2 = y0 - 2.5f * y1 + 2.0f * y2 - 0.5f * y3, c3 = 0.5f * (y3 - y0) + 1.5f * (y1 - y2);
  return ((c3 * t + c2) * t + c1) * t + y1;
}

// ---- filter: the trapezoidal state-variable filter the Downspout synths share ------

SvfCoeff makeSvf(double cutoff, double resonance, double sr) {
  const double fc = mind(maxd(cutoff, 20.0), mind(20000.0, sr * 0.45));
  SvfCoeff c;
  c.g = tand(PI * fc / sr);
  // res 0 -> Q = 1/sqrt(2) (Butterworth), res 1 -> Q = 20.
  c.k = 1.41421356 - (1.41421356 - 0.05) * mind(maxd(resonance, 0.0), 1.0);
  c.a1 = 1.0 / (1.0 + c.g * (c.g + c.k));
  c.a2 = c.g * c.a1;
  c.a3 = c.g * c.a2;
  return c;
}

struct SvfOut { double lp, bp, hp; };

inline SvfOut runSvf(Svf &s, const SvfCoeff &c, double x) {
  const double v3 = x - s.ic2;
  const double v1 = c.a1 * s.ic1 + c.a2 * v3;
  const double v2 = s.ic2 + c.a2 * s.ic1 + c.a3 * v3;
  s.ic1 = 2.0 * v1 - s.ic1;
  s.ic2 = 2.0 * v2 - s.ic2;
  return {v2, v1, x - c.k * v1 - v2};
}

// 0 LP 12, 1 LP 24, 2 HP 12, 3 BP, 4 notch. c2 is the second stage of the 24 dB low-pass.
inline double filterSample(int type, Svf &s1, Svf &s2, const SvfCoeff &c, const SvfCoeff &c2, double x) {
  const SvfOut a = runSvf(s1, c, x);
  switch (type) {
    case 0: return a.lp;
    case 1: return runSvf(s2, c2, a.lp).lp;
    case 2: return a.hp;
    case 3: return c.k * a.bp;
    default: return a.lp + a.hp;
  }
}

// ---- envelopes: attack linear in time, decay and release one-pole exponentials -----

struct EnvCoeffs { double attackInc, decayCoef, sustain, releaseCoef; };

EnvCoeffs envCoeffs(double attackMs, double decayMs, double sustain, double releaseMs, double sr) {
  return {1.0 / maxd(attackMs * 0.001 * sr, 1.0),
          expd(-1.0 / maxd(decayMs * 0.001 * sr, 1.0)),
          sustain,
          expd(-1.0 / maxd(releaseMs * 0.001 * sr, 1.0))};
}

inline double stepEnvelope(Envelope &e, bool gate, const EnvCoeffs &c) {
  if (e.stage == Stage::Idle) return 0.0;
  if (!gate && e.stage != Stage::Release) e.stage = Stage::Release;
  switch (e.stage) {
    case Stage::Attack:
      e.value += c.attackInc;
      if (e.value >= 1.0) { e.value = 1.0; e.stage = Stage::Decay; }
      break;
    case Stage::Decay:
      e.value = c.sustain + (e.value - c.sustain) * c.decayCoef;
      break;
    case Stage::Release:
      e.value *= c.releaseCoef;
      if (e.value < 1.0e-4) { e.value = 0.0; e.stage = Stage::Idle; }
      break;
    default: break;
  }
  return e.value;
}

// ---- voices and MIDI ---------------------------------------------------------

void clearVoice(Voice &v) {
  unsigned char *bytes = (unsigned char *)&v;
  for (size_t i = 0; i < sizeof(Voice); ++i) bytes[i] = 0;
  v.fade = 1.0f;
  v.pendingNote = -1;
  v.note = 60;
}

void initVoice(Voice &v, int note, int velocity, int channel, double glide) {
  clearVoice(v);
  v.glide = glide;
  v.active = true;
  v.held = true;
  v.channel = channel & 15;
  v.note = note;
  v.velocity = (float)velocity / 127.0f;
  for (Envelope &e : v.env) e.stage = Stage::Attack;
  v.pitchEnv.stage = Stage::Attack;
}

void startVoice(int note, int velocity, int channel, double glide) {
  int idx = -1;
  for (int i = 0; i < VOICES; ++i)
    if (!voices[i].active) { idx = i; break; }
  if (idx >= 0) { initVoice(voices[idx], note, velocity, channel, glide); return; }
  // Steal a releasing voice first, then the quietest, and one already being stolen last. It fades out
  // before the new note starts in its place.
  double best = 1e9;
  for (int i = 0; i < VOICES; ++i) {
    const Voice &v = voices[i];
    const double score = v.env[0].value + (v.held || v.sustained ? 10.0 : 0.0) + (v.stealing ? 20.0 : 0.0);
    if (score < best) { best = score; idx = i; }
  }
  Voice &v = voices[idx];
  v.stealing = true;
  v.held = false;
  v.sustained = false;
  v.pendingNote = note;
  v.pendingVelocity = velocity;
  v.pendingChannel = channel & 15;
  v.pendingGlide = glide;
}

void releaseNote(int note, int channel) {
  for (Voice &v : voices) {
    if (v.active && v.held && v.note == note && v.channel == (channel & 15)) {
      v.held = false;
      if (sustainPedal) v.sustained = true;
    } else if (v.stealing && v.pendingNote == note && v.pendingChannel == (channel & 15)) {
      v.pendingNote = -1;   // released before it ever sounded
    }
  }
}

// The one voice a mono mode plays through: the sounding voice whose key is down.
Voice *monoVoice() {
  for (Voice &v : voices)
    if (v.active && v.held && !v.stealing) return &v;
  return nullptr;
}

// Moves a sounding voice to another note. Its pitch carries on from where it is and slides there when Glide is set.
void retune(const Settings &p, Voice &v, const HeldNote &n, bool retrigger) {
  const double sounding = v.note + v.glide;
  v.note = n.note;
  v.channel = n.channel & 15;
  v.velocity = (float)n.velocity / 127.0f;
  v.glide = p.glide > 0.0f ? sounding - v.note : 0.0;
  v.held = true;
  v.sustained = false;
  if (retrigger) {
    for (Envelope &e : v.env) e.stage = Stage::Attack;
    v.pitchEnv.stage = Stage::Attack;
  }
}

void removeHeld(int note, int channel) {
  for (int i = 0; i < heldCount; ++i)
    if (heldNotes[i].note == note && heldNotes[i].channel == (channel & 15)) {
      for (int j = i; j + 1 < heldCount; ++j) heldNotes[j] = heldNotes[j + 1];
      --heldCount;
      return;
    }
}

void noteOn(const Settings &p, int note, int velocity, int channel) {
  double glide = 0.0;
  if (p.glide > 0.0f && lastNote >= 0) glide = mind(maxd((double)(lastNote - note), -48.0), 48.0);
  removeHeld(note, channel);    // a repeated key moves to the top of the stack
  if (heldCount == 16) {
    for (int j = 0; j + 1 < 16; ++j) heldNotes[j] = heldNotes[j + 1];
    --heldCount;
  }
  const HeldNote hn = {(uint8_t)note, (uint8_t)(channel & 15), (uint8_t)velocity};
  heldNotes[heldCount++] = hn;
  lastNote = note;
  if (p.playMode != POLY) {
    if (Voice *mv = monoVoice()) { retune(p, *mv, hn, p.playMode == MONO); return; }
  }
  startVoice(note, velocity, channel, glide);
}

void noteOff(const Settings &p, int note, int channel) {
  removeHeld(note, channel);
  if (p.playMode != POLY && heldCount > 0) {
    Voice *mv = monoVoice();
    if (mv && mv->note == note && mv->channel == (channel & 15)) {
      retune(p, *mv, heldNotes[heldCount - 1], p.playMode == MONO);
      return;
    }
  }
  releaseNote(note, channel);
}

void handleEvent(const Settings &p, const Event &e) {
  switch (e.kind) {
    case EV_NOTE_ON:
      if (e.data2 == 0) noteOff(p, e.data1, e.channel); else noteOn(p, e.data1, e.data2, e.channel);
      break;
    case EV_NOTE_OFF:
      noteOff(p, e.data1, e.channel);
      break;
    case EV_CONTROLLER:
      if (e.data1 == 64) {
        sustainPedal = e.data2 >= 64;
        if (!sustainPedal) for (Voice &v : voices) v.sustained = false;
      } else if (e.data1 == 120 || e.data1 == 123) {
        heldCount = 0;
        for (Voice &v : voices) {
          v.held = false;
          v.sustained = false;
          if (e.data1 == 120) clearVoice(v);
        }
        if (e.data1 == 120) dcX = dcY = 0.0;
      }
      break;
    case EV_BEND:
      bendTarget[e.channel & 15] = (float)e.bend / 8192.0f * p.bendRange;
      break;
  }
}

Settings settings() {
  Settings s;
  for (int o = 0; o < OPERATORS; ++o)
    for (int k = 0; k < PER_OPERATOR; ++k) s.op[o][k] = params[o * PER_OPERATOR + k];
  s.algorithm = roundi(params[G_ALGORITHM]);
  s.feedback = params[G_FEEDBACK];
  s.depth = params[G_DEPTH];
  s.pitchOn = params[G_PITCH_ON] >= 0.5f;
  s.pitchAmount = params[G_PITCH_AMOUNT];
  s.pitchAttack = params[G_PITCH_ATTACK];
  s.pitchDecay = params[G_PITCH_DECAY];
  s.pitchSustain = params[G_PITCH_SUSTAIN];
  s.pitchRelease = params[G_PITCH_RELEASE];
  s.filterType = roundi(params[G_FILTER_TYPE]);
  s.cutoff = params[G_CUTOFF];
  s.resonance = params[G_RESONANCE];
  s.keyTrack = params[G_KEY_TRACK];
  s.master = params[G_MASTER];
  s.velocity = params[G_VELOCITY];
  s.bendRange = params[G_BEND_RANGE];
  s.quality = params[G_QUALITY] >= 0.5f ? 1 : 0;
  s.playMode = roundi(params[G_PLAY_MODE]);
  s.glide = params[G_GLIDE];
  return s;
}

// Events arrive in stream order, but a sorted insertion keeps a late straggler from blocking the ones behind it.
int collectEvents(uint32_t frames) {
  int count = 0;
  for (uint32_t i = 0; i < midiInCount; i++) {
    const MidiEvent &in = midiIn[i];
    if (in.size < 2 || in.size > 3) continue;
    const uint8_t status = in.data[0];
    const uint8_t kind = status & 0xF0;
    Event e = {};
    e.frame = in.frame < frames ? in.frame : frames - 1;
    e.channel = status & 0x0F;
    e.data1 = in.data[1];
    e.data2 = in.size >= 3 ? in.data[2] : 0;
    if (kind == 0x90 && e.data2 != 0) e.kind = EV_NOTE_ON;
    else if (kind == 0x80 || kind == 0x90) e.kind = EV_NOTE_OFF;
    else if (kind == 0xB0) e.kind = EV_CONTROLLER;
    else if (kind == 0xE0 && in.size >= 3) { e.kind = EV_BEND; e.bend = (((int)e.data2 << 7) | e.data1) - 8192; }
    else continue;
    int at = count++;
    while (at > 0 && events[at - 1].frame > e.frame) { events[at] = events[at - 1]; --at; }
    events[at] = e;
  }
  return count;
}

void resetState() {
  for (Voice &v : voices) clearVoice(v);
  sustainPedal = false;
  heldCount = 0;
  lastNote = -1;
  for (int c = 0; c < 16; ++c) bendNow[c] = bendTarget[c] = 0.0f;
  dcX = dcY = 0.0;
  primed = false;
}

// ---- rendering ---------------------------------------------------------------

void renderRange(const Settings &p, uint32_t begin, uint32_t end) {
  const double sr = sampleRate;
  const int os = p.quality ? 2 : 1;
  const double srOs = sr * os;
  const Algorithm &alg = ALGORITHM_TABLE[p.algorithm < 0 ? 0 : (p.algorithm >= ALGORITHMS ? ALGORITHMS - 1 : p.algorithm)];
  int carriers = 0;
  for (int i = 0; i < OPERATORS; ++i) carriers += (alg.carriers >> i) & 1u;
  const double carrierScale = 1.0 / carriers;
  const float smooth = 1.0f - (float)expd(-1.0 / (0.005 * sr));

  EnvCoeffs coeffs[OPERATORS];
  for (int o = 0; o < OPERATORS; ++o)
    coeffs[o] = envCoeffs(p.op[o][O_ATTACK], p.op[o][O_DECAY], p.op[o][O_SUSTAIN], p.op[o][O_RELEASE], sr);
  const EnvCoeffs pitchCoeffs = envCoeffs(p.pitchAttack, p.pitchDecay, p.pitchSustain, p.pitchRelease, sr);
  // Glide is the time to cover about 95 % of the distance (three time constants), stepped every 32 samples.
  const double glideDecay = p.glide > 0.0f ? expd(-32.0 / (p.glide * 0.001 / 3.0 * sr)) : 0.0;
  const float stealCoef = (float)expd(-1.0 / (0.0005 * sr));   // time constant 0.5 ms: gone in about 3 ms
  const double dcCoeff = 1.0 - 2.0 * PI * 8.0 / sr;

  for (uint32_t i = begin; i < end; ++i) {
    cutoffSmooth += smooth * (p.cutoff - cutoffSmooth);
    masterSmooth += smooth * (p.master - masterSmooth);
    for (int ch = 0; ch < 16; ++ch) bendNow[ch] += smooth * (bendTarget[ch] - bendNow[ch]);

    double sum = 0.0;
    for (Voice &v : voices) {
      if (!v.active) continue;
      const bool gate = v.held || v.sustained || v.stealing;
      if (v.stealing) {
        v.fade *= stealCoef;
        if (v.fade < 1.0e-3f) {
          const int note = v.pendingNote, vel = v.pendingVelocity, ch = v.pendingChannel;
          const double g = v.pendingGlide;
          if (note >= 0) initVoice(v, note, vel, ch, g); else clearVoice(v);
          continue;
        }
      }
      double amp[OPERATORS];
      bool carrierAlive = false;
      for (int o = 0; o < OPERATORS; ++o) {
        const double env = stepEnvelope(v.env[o], gate, coeffs[o]);
        amp[o] = env * p.op[o][O_LEVEL];
        if (((alg.carriers >> o) & 1u) && v.env[o].stage != Stage::Idle) carrierAlive = true;
      }
      const double pitchEnv = p.pitchOn ? stepEnvelope(v.pitchEnv, gate, pitchCoeffs) : 0.0;
      if (!carrierAlive) { v.active = false; continue; }

      if (v.controlCountdown-- <= 0) {
        v.controlCountdown = 31;
        v.glide = absd(v.glide) < 1e-4 ? 0.0 : v.glide * glideDecay;
        const double baseHz = 440.0 * exp2d((v.note + v.glide - 69 + bendNow[v.channel] + pitchEnv * p.pitchAmount) / 12.0);
        for (int o = 0; o < OPERATORS; ++o) {
          const double hz = p.op[o][O_FIXED] >= 0.5f ? (double)p.op[o][O_FIXED_HZ]
                                                      : baseHz * p.op[o][O_RATIO] * exp2d(p.op[o][O_FINE] / 1200.0);
          v.opHz[o] = mind(maxd(hz, 0.1), srOs * 0.48);
        }
        const double cutoff = (double)cutoffSmooth * exp2d(p.keyTrack * (v.note + v.glide - 60) / 12.0);
        v.coeff1 = makeSvf(cutoff, p.resonance, sr);
        v.coeff2 = makeSvf(cutoff, 0.0, sr);
      }

      double voiceOut = 0.0;
      for (int sub = 0; sub < os; ++sub) {
        double out[OPERATORS] = {0, 0, 0, 0};
        for (int o = OPERATORS - 1; o >= 0; --o) {
          double &ph = v.phase[o];
          ph += v.opHz[o] / srOs;
          ph -= floord(ph);
          // Phase modulation in cycles; a modulator's own level and envelope set how much it moves its target.
          double mod = 0.0, speed = 0.0;
          for (int m = o + 1; m < OPERATORS; ++m)
            if ((alg.modulators[o] >> m) & 1u) {
              mod += out[m];
              speed += absd(amp[m]) * v.opHz[m];
            }
          mod *= p.depth;
          speed *= p.depth * 2.0 * PI;
          if (o == OPERATORS - 1 && p.feedback > 0.0f) mod += p.feedback * 0.398 * 0.5 * (v.feedbackY1 + v.feedbackY2);
          // The read must stay under Nyquist even at the fastest the modulation moves the phase.
          const double slope = 1.0 + speed / maxd(v.opHz[o], 1.0);
          const double allowed = (srOs * 0.5) / (maxd(v.opHz[o], 1.0) * slope);
          out[o] = amp[o] * readWave(roundi(p.op[o][O_WAVE]), ph + mod, allowed);
        }
        v.feedbackY2 = v.feedbackY1;
        v.feedbackY1 = out[OPERATORS - 1];
        double mix = 0.0;
        for (int o = 0; o < OPERATORS; ++o)
          if ((alg.carriers >> o) & 1u) mix += out[o];
        mix *= carrierScale;
        if (os == 1) {
          voiceOut = mix;
        } else {
          v.history[v.historyPos] = (float)mix;
          v.historyPos = (v.historyPos + 1) % DECIMATOR_TAPS;
          if (sub == 1) {
            // Newest sample is at historyPos - 1; tap n multiplies the sample n steps back.
            double acc = 0.0;
            for (int k = 0; k < decimatorCount; ++k) {
              const int n = decimatorNonzero[k];
              acc += (double)decimatorTaps[n] * (double)v.history[(v.historyPos - 1 - n + 2 * DECIMATOR_TAPS) % DECIMATOR_TAPS];
            }
            voiceOut = acc;
          }
        }
      }
      const double filtered = filterSample(p.filterType, v.filter1, v.filter2, v.coeff1, v.coeff2, voiceOut);
      const double velGain = 1.0 - p.velocity + p.velocity * v.velocity;
      sum += filtered * velGain * masterSmooth * v.fade;
    }
    // One-pole DC blocker at about 8 Hz: feedback and asymmetric waves can carry an offset.
    const double y = sum - dcX + dcCoeff * dcY;
    dcX = sum;
    dcY = y;
    outputBuffer[0][i] = outputBuffer[1][i] = (float)y;
  }
}

// A denormal in a recursive state makes every later multiply slow on some hosts.
void flushDenormals() {
  constexpr double TINY = 1.0e-30;
  if (absd(dcX) < TINY) dcX = 0.0;
  if (absd(dcY) < TINY) dcY = 0.0;
  for (Voice &v : voices) {
    if (absd(v.filter1.ic1) < TINY) v.filter1.ic1 = 0.0;
    if (absd(v.filter1.ic2) < TINY) v.filter1.ic2 = 0.0;
    if (absd(v.filter2.ic1) < TINY) v.filter2.ic1 = 0.0;
    if (absd(v.filter2.ic2) < TINY) v.filter2.ic2 = 0.0;
    if (absd(v.feedbackY1) < TINY) v.feedbackY1 = 0.0;
    if (absd(v.feedbackY2) < TINY) v.feedbackY2 = 0.0;
  }
}

int activeVoices() {
  int n = 0;
  for (const Voice &v : voices) n += v.active ? 1 : 0;
  return n;
}

}  // namespace

extern "C" {

void jig_init(float rate) {
  sampleRate = rate > 0.0f ? (double)rate : 48000.0;
  for (int c = 0; c < 2; c++)
    for (uint32_t i = 0; i < MAX_FRAMES; i++) outputBuffer[c][i] = 0.0f;
  for (int i = 0; i < P_COUNT; i++) params[i] = defaultOf(i);
  midiInCount = 0;
  buildWaves();
  resetState();
  cutoffSmooth = params[G_CUTOFF];
  masterSmooth = params[G_MASTER];
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

void jig_set_param(uint32_t index, float value) {
  if (index >= (uint32_t)P_COUNT) return;
  const Range r = rangeOf((int)index);
  float v = clampf(value, r.lo, r.hi);
  if (r.integer) v = (float)roundi(v);
  params[index] = v;
}

void jig_process(uint32_t frames) {
  if (frames > MAX_FRAMES) frames = MAX_FRAMES;
  if (!ready || frames == 0) {
    for (uint32_t i = 0; i < frames; i++) outputBuffer[0][i] = outputBuffer[1][i] = 0.0f;
    midiInCount = 0;
    return;
  }
  const Settings p = settings();
  if (!primed) { cutoffSmooth = p.cutoff; masterSmooth = p.master; primed = true; }

  const int count = collectEvents(frames);
  midiInCount = 0;

  uint32_t cursor = 0;
  for (int i = 0; i < count; i++) {
    if (events[i].frame > cursor) {
      renderRange(p, cursor, events[i].frame);
      cursor = events[i].frame;
    }
    handleEvent(p, events[i]);
  }
  renderRange(p, cursor, frames);
  flushDenormals();
}

uint32_t jig_latency_frames(void) { return 0; }

// ---- introspection, for the tests --------------------------------------------
int32_t jig_active_voices(void) { return activeVoices(); }

// The range and default each parameter index has in the module, which tests/dsp/quartet.test.js binds
// to profile.json, since the two are written separately.
float jig_param_min(uint32_t index) { return index < (uint32_t)P_COUNT ? rangeOf((int)index).lo : 0.0f; }
float jig_param_max(uint32_t index) { return index < (uint32_t)P_COUNT ? rangeOf((int)index).hi : 0.0f; }
float jig_param_default(uint32_t index) { return index < (uint32_t)P_COUNT ? defaultOf((int)index) : 0.0f; }
float jig_param(uint32_t index) { return index < (uint32_t)P_COUNT ? params[index] : 0.0f; }

// The freestanding functions, so the tests can set them against Math.*.
// op: 0 sin, 1 cos, 2 tan, 3 exp2.
double jig_math(int32_t op, double a, double b) {
  (void)b;
  switch (op) {
    case 0: return sind(a);
    case 1: return cosd(a);
    case 2: return tand(a);
    case 3: return exp2d(a);
    default: return 0.0;
  }
}

}
