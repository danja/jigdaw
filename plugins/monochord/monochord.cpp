// plugins/monochord/monochord.cpp
//
// Monochord: an eight-voice waveguide string, plucked, bowed or hammered, as a
// Jig instrument. Ported from the Downspout plugin of the same name
// (downspout/plugins/monochord, MIT), which is itself a redesign of the Tension
// device in oxide-studio. The algorithm is the original's; the engine around it
// is rewritten for a module with no libc, no libm, no heap and no threads.
//
// Each voice is a delay line closed into a loop with a one-pole damping
// low-pass, a first-order all-pass for the fractional delay and a cascade of
// four all-passes for stiffness. The loop is tuned from its own phase delay:
// the all-pass fraction is chosen so the whole loop has exactly one period of
// delay at the note, whatever the damping and stiffness.
//
// What differs from the original, and why:
//  - No std::complex. The phase delay of both kinds of all-pass has a closed
//    form (tan of half the angle), so tuning solves for the coefficient
//    directly instead of bisecting 60 times on a complex argument. That keeps
//    a retune, four per voice per block, cheap enough for a slow host.
//  - No std::vector. The pluck shape is written into static scratch.
//  - sin, atan, tan and exp2 are written here and checked against Math.* by
//    tests/dsp/monochord.test.js, since a freestanding function is wrong until
//    it has been measured.
//
// Real-time rules (CLAUDE.md): nothing here allocates. Every buffer is static
// so memory never grows after jig_init.
#include <stddef.h>
#include <stdint.h>

namespace {

constexpr uint32_t MAX_FRAMES = 128;
constexpr uint32_t MIDI_IN_CAPACITY = 256;
constexpr int VOICES = 8;
constexpr int DELAY_SIZE = 16384;       // fits 20 Hz up to 192 kHz
constexpr int CONTROL_PERIOD = 32;      // samples between retunes of a voice

constexpr double PI = 3.14159265358979323846;
constexpr double LOG2_10 = 3.32192809488736234787;
constexpr double LOG2_E = 1.44269504088896340736;

enum Param {
  P_EXCITER, P_POSITION, P_HARDNESS, P_BOW_PRESSURE, P_DECAY, P_DAMPING, P_STIFFNESS,
  P_BODY_SIZE, P_BODY_LEVEL, P_PICKUP, P_RELEASE, P_MASTER, P_VELOCITY, P_BEND_RANGE,
  P_COUNT
};

const float P_MIN[P_COUNT] = {0, 0.05f, 0, 0, 0.1f, 0, 0, 0.5f, 0, 0, 5, 0, 0, 0};
const float P_MAX[P_COUNT] = {2, 0.5f, 1, 1, 20, 1, 1, 2, 1, 0.5f, 2000, 1, 1, 24};
const float P_DEF[P_COUNT] = {0, 0.2f, 0.6f, 0.5f, 3, 0.3f, 0.5f, 1, 0.3f, 0, 250, 0.6f, 0.7f, 2};
const bool P_INTEGER[P_COUNT] = {1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};

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

// The coefficients of one string loop.
struct LoopTuning {
  int delay;              // whole samples
  double fractionCoeff;   // all-pass that supplies the fraction of a sample
  double lowpass;         // pole of the damping filter; 0 = none
  int stiffStages;        // identical first-order all-passes (0 = none)
  double stiffCoeff;      // theirs; negative: more delay at low frequencies than high
  double gain;            // per loop pass at the fundamental, after the low-pass
};

struct Biquad {
  double b0, b1, b2, a1, a2, z1, z2;
};

// A plain struct, zeroed by clearVoice. Deliberately without member
// initialisers: the delay line is 64 KB and a value-initialised temporary
// would be built on the stack and copied.
struct Voice {
  bool active, held, sustained, bowing, bowed;
  int channel, note;
  float velocity;
  uint64_t age;
  float line[DELAY_SIZE];
  int writePos;
  LoopTuning tuning;
  double lowpassState, fracX1, fracY1;
  double stiffX1[4], stiffY1[4];
  double bowSpeed, envelope, peak;
  int controlCountdown;
  Biquad body[2];
};

struct Settings {
  float exciter, position, hardness, bowPressure, decay, damping, stiffness;
  float bodySize, bodyLevel, pickup, release, master, velocity, bendRange;
};

float outputBuffer[2][MAX_FRAMES];
MidiEvent midiIn[MIDI_IN_CAPACITY];
uint32_t midiInCount = 0;
alignas(8) uint8_t transportBlock[64];   // part of the ABI; this instrument does not use the transport

float params[P_COUNT];
Event events[MIDI_IN_CAPACITY];
float shape[DELAY_SIZE];                 // scratch for the pluck shape, then copied into a voice
double scratch[2][DELAY_SIZE];

Voice voices[VOICES];
uint64_t voiceCounter = 0;
bool sustainPedal = false;
float bendNow[16], bendTarget[16];       // semitones per MIDI channel, smoothed and target
float masterSmooth = 0.6f;
double dcX = 0.0, dcY = 0.0;
bool primed = false;
double sampleRate = 48000.0;
bool ready = false;

// ---- freestanding maths ------------------------------------------------------

inline double absd(double v) { return v < 0.0 ? -v : v; }
inline double mind(double a, double b) { return a < b ? a : b; }
inline double maxd(double a, double b) { return a > b ? a : b; }
inline int mini(int a, int b) { return a < b ? a : b; }
inline int maxi(int a, int b) { return a > b ? a : b; }
inline float clampf(float v, float lo, float hi) {
  if (!(v == v) || v - v != 0.0f) return lo;     // NaN and infinities
  return v < lo ? lo : (v > hi ? hi : v);
}
inline int roundi(double v) { return (int)__builtin_floor(v + 0.5); }

// exp2 splits off the integer part exactly and sums a Taylor series for the
// fraction in [-0.5, 0.5], where fourteen terms are good to about 1e-16.
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

// Sine and cosine of an angle reduced to [-pi, pi], by Taylor series: sixteen
// terms reach 1e-16 at pi. Used on the control path (retuning, the body
// filters), never per sample.
double reduceAngle(double x) {
  const double turns = __builtin_floor(x / (2.0 * PI) + 0.5);
  return x - turns * 2.0 * PI;
}

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

// Arctangent: fold to [0, 1], then to [0, tan(pi/12)] with the angle-addition
// identity, where the Taylor series converges fast.
double atand(double x) {
  const bool negative = x < 0.0;
  if (negative) x = -x;
  const bool inverted = x > 1.0;
  if (inverted) x = 1.0 / x;
  constexpr double SQRT3 = 1.73205080756887729353;
  const bool shifted = x > 0.2679491924311227;     // tan(pi/12)
  if (shifted) x = (x * SQRT3 - 1.0) / (SQRT3 + x);
  const double x2 = x * x;
  double term = x, sum = x;
  for (int i = 1; i < 14; i++) { term *= -x2; sum += term / (2.0 * i + 1.0); }
  if (shifted) sum += PI / 6.0;
  if (inverted) sum = PI / 2.0 - sum;
  return negative ? -sum : sum;
}

double atan2d(double y, double x) {
  if (x > 0.0) return atand(y / x);
  if (x < 0.0) return y >= 0.0 ? atand(y / x) + PI : atand(y / x) - PI;
  return y > 0.0 ? PI / 2.0 : (y < 0.0 ? -PI / 2.0 : 0.0);
}

double tand(double x) { return sind(x) / cosd(x); }

// ---- the loop ----------------------------------------------------------------

// Phase delay in samples of the all-pass (c + z^-1) / (1 + c z^-1) at angular
// frequency w. Its phase is -2 atan(((1 - c) / (1 + c)) tan(w / 2)).
double allpassDelay(double c, double w) {
  return 2.0 * atand((1.0 - c) / (1.0 + c) * tand(0.5 * w)) / w;
}

// The coefficient whose phase delay at w is `delay`: the same relation solved
// for c. A delay of a quarter turn or more of half the angle has no all-pass of
// this kind, so it saturates at the same limit the coefficient is held to.
double allpassCoefficient(double delay, double w) {
  const double half = 0.5 * delay * w;
  if (half >= PI / 2.0 - 1.0e-9) return -0.5;
  const double k = tand(half) / tand(0.5 * w);
  double c = (1.0 - k) / (1.0 + k);
  if (!(c == c)) c = 0.0;
  return c < -0.5 ? -0.5 : (c > 0.5 ? 0.5 : c);
}

// Phase delay of the one-pole low-pass (1 - a) / (1 - a z^-1).
double lowpassDelay(double a, double w) {
  if (a == 0.0) return 0.0;
  return atan2d(a * sind(w), 1.0 - a * cosd(w)) / w;
}

double lowpassMagnitude(double a, double w) {
  const double re = 1.0 - a * cosd(w), im = a * sind(w);
  return (1.0 - a) / __builtin_sqrt(re * re + im * im);
}

LoopTuning tuneLoop(double frequencyHz, const Settings &p, double sr) {
  const double f0 = mind(maxd(frequencyHz, 20.0), sr * 0.4);
  const double w = 2.0 * PI * f0 / sr;
  LoopTuning t;
  t.lowpass = (double)p.damping * 0.7;
  t.stiffStages = 0;
  t.stiffCoeff = 0.0;
  // Stiffness is a cascade of four identical all-passes whose low-frequency
  // delay together is stiffness^2 x a quarter of the period. A single section
  // changes its delay far too little between the fundamental and the partials
  // to be audible; a cascade whose delay scales with the period gives an
  // inharmonicity that is the same fraction of the cycle at any pitch.
  if (p.stiffness > 0.001f) {
    const double period = sr / f0;
    const double perStage = maxd(1.0, (double)p.stiffness * p.stiffness * 0.25 * period / 4.0);
    t.stiffStages = 4;
    t.stiffCoeff = (1.0 - perStage) / (1.0 + perStage);
  }
  const double fixedDelay = lowpassDelay(t.lowpass, w) + (double)t.stiffStages * allpassDelay(t.stiffCoeff, w);
  // The rest of one period goes to a whole delay and a fraction. The all-pass
  // coefficient is chosen so its phase delay AT f0 equals the fraction (the
  // delay at DC would only be right at low pitch).
  const double remaining = sr / f0 - fixedDelay;
  t.delay = maxi(2, (int)__builtin_floor(remaining - 0.5));
  const double target = mind(maxd(remaining - t.delay, 0.5), 1.5);
  t.fractionCoeff = allpassCoefficient(target, w);
  t.delay = mini(t.delay, DELAY_SIZE - 8);
  // Loop gain so the fundamental falls 60 dB in `decay` seconds; the low-pass
  // already takes some of it at f0.
  const double perPass = exp2d(-3.0 * LOG2_10 / ((double)p.decay * f0));
  const double g = perPass / lowpassMagnitude(t.lowpass, w);
  t.gain = g < 0.99999 ? g : 0.99999;
  return t;
}

// Total phase delay of the loop at hz, in samples, from the coefficients in
// use. Read by the tests (jig_tuning_error).
double loopPhaseDelay(const LoopTuning &t, double hz, double sr) {
  const double w = 2.0 * PI * hz / sr;
  return (double)t.delay + allpassDelay(t.fractionCoeff, w) + lowpassDelay(t.lowpass, w)
    + (double)t.stiffStages * allpassDelay(t.stiffCoeff, w);
}

Settings settings() {
  Settings s;
  s.exciter = params[P_EXCITER]; s.position = params[P_POSITION]; s.hardness = params[P_HARDNESS];
  s.bowPressure = params[P_BOW_PRESSURE]; s.decay = params[P_DECAY]; s.damping = params[P_DAMPING];
  s.stiffness = params[P_STIFFNESS]; s.bodySize = params[P_BODY_SIZE]; s.bodyLevel = params[P_BODY_LEVEL];
  s.pickup = params[P_PICKUP]; s.release = params[P_RELEASE]; s.master = params[P_MASTER];
  s.velocity = params[P_VELOCITY]; s.bendRange = params[P_BEND_RANGE];
  return s;
}

// The displacement written into the string at note-on: zero mean, peak 1; all
// zero for the bow. `out` has n points along the string.
void excitation(int exciter, int n, const Settings &p, float *out) {
  n = maxi(n, 2);
  for (int i = 0; i < n; ++i) out[i] = 0.0f;
  if (exciter == 1) return;
  double *x = scratch[0], *y = scratch[1];
  for (int i = 0; i < n; ++i) x[i] = 0.0;
  const double pos = p.position;
  if (exciter == 0) {
    // A triangle with its apex at the pluck position; a soft pluck is that
    // triangle rounded off.
    const double peak = maxd(pos * n, 1.0);
    for (int i = 0; i < n; ++i) x[i] = i < peak ? i / peak : (n - i) / maxd(n - peak, 1.0);
    const int passes = roundi((1.0 - p.hardness) * 6.0);
    for (int k = 0; k < passes; ++k) {
      for (int i = 0; i < n; ++i) y[i] = 0.25 * x[(i + n - 1) % n] + 0.5 * x[i] + 0.25 * x[(i + 1) % n];
      double *swap = x; x = y; y = swap;
    }
  } else {
    // A half-sine pulse centred at the strike position; a soft (wide) hammer
    // is a wide pulse.
    const double width = maxd(n * (0.02 + 0.28 * (1.0 - p.hardness)), 3.0);
    const double centre = pos * n;
    for (int i = 0; i < n; ++i) {
      const double d = i - (centre - width * 0.5);
      if (d >= 0.0 && d <= width) x[i] = sind(PI * d / width);
    }
  }
  double mean = 0.0;
  for (int i = 0; i < n; ++i) mean += x[i];
  mean /= n;
  double peak = 1e-9;
  for (int i = 0; i < n; ++i) { x[i] -= mean; peak = maxd(peak, absd(x[i])); }
  for (int i = 0; i < n; ++i) out[i] = (float)(x[i] / peak);
}

// RBJ band-pass (constant 0 dB peak gain).
Biquad bandPass(double f0, double q, double sr) {
  const double w0 = 2.0 * PI * mind(f0, sr * 0.45) / sr;
  const double alpha = sind(w0) / (2.0 * q);
  const double a0 = 1.0 + alpha;
  Biquad b = {};
  b.b0 = alpha / a0;
  b.b2 = -alpha / a0;
  b.a1 = -2.0 * cosd(w0) / a0;
  b.a2 = (1.0 - alpha) / a0;
  return b;
}

inline double runBiquad(Biquad &b, double x) {
  const double y = b.b0 * x + b.z1;
  b.z1 = b.b1 * x - b.a1 * y + b.z2;
  b.z2 = b.b2 * x - b.a2 * y;
  return y;
}

void clearVoice(Voice &v) {
  __builtin_memset(&v, 0, sizeof(Voice));
  v.note = 60;
  v.velocity = 1.0f;
  v.envelope = 1.0;
  v.tuning.delay = 100;
  v.tuning.gain = 0.999;
}

// ---- notes -------------------------------------------------------------------

void startVoice(const Settings &p, int note, int velocity, int channel) {
  int idx = -1;
  for (int i = 0; i < VOICES; ++i) if (!voices[i].active) { idx = i; break; }
  if (idx < 0) {
    // Steal the quietest: a released, decayed voice before a held one.
    double best = 1e9;
    for (int i = 0; i < VOICES; ++i) {
      const Voice &v = voices[i];
      const double score = v.envelope * (0.05 + v.peak) + (v.held || v.sustained ? 10.0 : 0.0);
      if (score < best) { best = score; idx = i; }
    }
  }
  Voice &v = voices[idx];
  clearVoice(v);
  v.active = true;
  v.held = true;
  v.channel = channel & 15;
  v.note = note;
  // The Velocity control mixes between every note at full level (0) and the
  // key velocity itself (1); this one value scales the excitation, and
  // nothing scales the output again.
  v.velocity = 1.0f - p.velocity + p.velocity * (float)velocity / 127.0f;
  v.age = ++voiceCounter;
  v.peak = 1.0;
  const double f0 = maxd(440.0 * exp2d((note - 69 + bendNow[channel & 15]) / 12.0), 20.0);
  v.tuning = tuneLoop(f0, p, sampleRate);
  const int exciter = roundi(p.exciter);
  if (exciter == 1) {
    v.bowing = true;
    // A slow bow: at higher speeds the string settles to a constant offset
    // (which the DC blocker removes) instead of sticking and slipping. The
    // oscillation's size is set by the friction curve, so loudness comes from
    // the output level.
    v.bowSpeed = 0.03 + 0.12 * (double)v.velocity;
    v.bowed = true;
  } else {
    excitation(exciter, v.tuning.delay, p, shape);
    for (int i = 0; i < v.tuning.delay; ++i) v.line[i] = shape[i] * v.velocity * 0.8f;
    v.writePos = v.tuning.delay;
  }
}

void noteOff(int note, int channel) {
  for (int i = 0; i < VOICES; ++i) {
    Voice &v = voices[i];
    if (v.active && v.held && v.note == note && v.channel == (channel & 15)) {
      v.held = false;
      if (sustainPedal) v.sustained = true;
    }
  }
}

void handleEvent(const Settings &p, const Event &e) {
  switch (e.kind) {
    case EV_NOTE_ON: startVoice(p, e.data1, e.data2, e.channel); break;
    case EV_NOTE_OFF: noteOff(e.data1, e.channel); break;
    case EV_CONTROLLER:
      if (e.data1 == 64) {
        sustainPedal = e.data2 >= 64;
        if (!sustainPedal) for (int i = 0; i < VOICES; ++i) voices[i].sustained = false;
      } else if (e.data1 == 120 || e.data1 == 123) {
        for (int i = 0; i < VOICES; ++i) {
          voices[i].held = false;
          voices[i].sustained = false;
          if (e.data1 == 120) clearVoice(voices[i]);
        }
        if (e.data1 == 120) dcX = dcY = 0.0;
      }
      break;
    case EV_BEND: bendTarget[e.channel & 15] = (float)e.bend / 8192.0f * p.bendRange; break;
  }
}

// Decode the host's events into `events`, in frame order. The host delivers
// them in order, but the insertion keeps a late straggler from blocking the
// ones behind it.
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

// ---- rendering ---------------------------------------------------------------

void renderRange(const Settings &p, uint32_t begin, uint32_t end) {
  const double sr = sampleRate;
  const float smooth = 1.0f - (float)expd(-1.0 / (0.005 * sr));
  const double releaseCoef = expd(-1.0 / maxd((double)p.release * 0.001 * sr, 1.0));
  const double bodyGain = (double)p.bodyLevel * 1.5;
  const double bowGain = 1.5 + 4.5 * p.bowPressure;
  const double bowDrive = 0.1 + 0.5 * p.bowPressure;
  const double dcCoeff = 1.0 - 2.0 * PI * 8.0 / sr;
  Biquad body1 = {}, body2 = {};
  bool bodyBuilt = false;

  for (uint32_t i = begin; i < end; ++i) {
    masterSmooth += smooth * (p.master - masterSmooth);
    for (int ch = 0; ch < 16; ++ch) bendNow[ch] += smooth * (bendTarget[ch] - bendNow[ch]);

    double sum = 0.0;
    for (int n = 0; n < VOICES; ++n) {
      Voice &v = voices[n];
      if (!v.active) continue;
      const bool gate = v.held || v.sustained;
      if (!gate) {
        v.bowing = false;
        v.envelope *= releaseCoef;
        if (v.envelope < 1.0e-4) { v.active = false; continue; }
      }
      if (v.controlCountdown-- <= 0) {
        v.controlCountdown = CONTROL_PERIOD - 1;
        v.tuning = tuneLoop(440.0 * exp2d((v.note - 69 + bendNow[v.channel]) / 12.0), p, sr);
        if (!bodyBuilt) {
          body1 = bandPass(120.0 * p.bodySize, 4.0, sr);
          body2 = bandPass(280.0 * p.bodySize, 5.0, sr);
          bodyBuilt = true;
        }
        // Keep the bodies' memory across retunes: copy only the coefficients.
        v.body[0].b0 = body1.b0; v.body[0].b1 = body1.b1; v.body[0].b2 = body1.b2; v.body[0].a1 = body1.a1; v.body[0].a2 = body1.a2;
        v.body[1].b0 = body2.b0; v.body[1].b1 = body2.b1; v.body[1].b2 = body2.b2; v.body[1].a1 = body2.a1; v.body[1].a2 = body2.a2;
      }
      const LoopTuning &t = v.tuning;
      const int readIdx = (v.writePos - t.delay + DELAY_SIZE) % DELAY_SIZE;
      const double x = (double)v.line[readIdx];

      double inject = 0.0;
      if (v.bowing) {
        // Friction against the string: a sticking region around zero relative
        // speed, then falling force.
        const double rel = v.bowSpeed - x;
        inject = bowDrive * 0.5 * (2.0 * rel) / (1.0 + (bowGain * rel) * (bowGain * rel));
      }
      // Loop: damping low-pass, then the fractional-delay all-pass, then the
      // stiffness all-pass.
      v.lowpassState = (1.0 - t.lowpass) * x + t.lowpass * v.lowpassState;
      const double frac = t.fractionCoeff * v.lowpassState + v.fracX1 - t.fractionCoeff * v.fracY1;
      v.fracX1 = v.lowpassState;
      v.fracY1 = frac;
      double stiff = frac;
      for (int k = 0; k < t.stiffStages; ++k) {
        const double in = stiff;
        stiff = t.stiffCoeff * in + v.stiffX1[k] - t.stiffCoeff * v.stiffY1[k];
        v.stiffX1[k] = in;
        v.stiffY1[k] = stiff;
      }
      const double written = t.gain * stiff + inject;
      v.line[v.writePos] = (float)(written < -3.0 ? -3.0 : (written > 3.0 ? 3.0 : written));
      v.writePos = (v.writePos + 1) % DELAY_SIZE;

      // Pickup comb: the string read at two points along its length.
      double out = x;
      if (p.pickup > 0.0f) {
        const int d = maxi(1, roundi((double)p.pickup * t.delay));
        out = 0.7 * (x - (double)v.line[(readIdx + d) % DELAY_SIZE]);
      }
      const double body = runBiquad(v.body[0], out) + runBiquad(v.body[1], out);
      const double voiceOut = (out * 0.8 + body * bodyGain) * v.envelope * (v.bowed ? (double)v.velocity : 1.0);
      v.peak = maxd(absd(x), v.peak * 0.9998);
      if (!v.bowing && v.peak < 1.0e-6) { v.active = false; continue; }
      sum += voiceOut * masterSmooth;
    }
    // One-pole DC blocker at about 8 Hz (a bow or a hammer can carry an offset).
    const double y = sum - dcX + dcCoeff * dcY;
    dcX = sum;
    dcY = y;
    outputBuffer[0][i] = outputBuffer[1][i] = (float)y;
  }
}

// Recursive memory on a silent input decays into denormals; zero what is
// negligible.
void flushDenormals() {
  constexpr double TINY = 1.0e-30;
  if (absd(dcX) < TINY) dcX = 0.0;
  if (absd(dcY) < TINY) dcY = 0.0;
  for (int n = 0; n < VOICES; ++n) {
    Voice &v = voices[n];
    if (absd(v.lowpassState) < TINY) v.lowpassState = 0.0;
    if (absd(v.fracX1) < TINY) v.fracX1 = 0.0;
    if (absd(v.fracY1) < TINY) v.fracY1 = 0.0;
    for (int k = 0; k < 4; ++k) {
      if (absd(v.stiffX1[k]) < TINY) v.stiffX1[k] = 0.0;
      if (absd(v.stiffY1[k]) < TINY) v.stiffY1[k] = 0.0;
    }
    for (int b = 0; b < 2; ++b) {
      if (absd(v.body[b].z1) < TINY) v.body[b].z1 = 0.0;
      if (absd(v.body[b].z2) < TINY) v.body[b].z2 = 0.0;
    }
    if (v.peak < TINY) v.peak = 0.0;
  }
}

int activeVoices() {
  int n = 0;
  for (int i = 0; i < VOICES; ++i) n += voices[i].active ? 1 : 0;
  return n;
}

void resetState() {
  for (int i = 0; i < VOICES; ++i) clearVoice(voices[i]);
  voiceCounter = 0;
  sustainPedal = false;
  for (int c = 0; c < 16; ++c) bendNow[c] = bendTarget[c] = 0.0f;
  masterSmooth = params[P_MASTER];
  dcX = dcY = 0.0;
  primed = false;
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

void jig_set_param(uint32_t index, float value) {
  if (index >= (uint32_t)P_COUNT) return;
  float v = clampf(value, P_MIN[index], P_MAX[index]);
  if (P_INTEGER[index]) v = (float)roundi(v);
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
  if (!primed) { masterSmooth = p.master; primed = true; }

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
// Not part of the ABI. tests/dsp/monochord.test.js reads back what the module
// did rather than inferring it from the audio.
int32_t jig_active_voices(void) { return activeVoices(); }

// The loop's phase delay at the note's own frequency minus one period, in
// samples, for the settings now in force. Zero when the string is in tune.
double jig_tuning_error(float hz) {
  const Settings p = settings();
  const double f0 = mind(maxd((double)hz, 20.0), sampleRate * 0.4);
  const LoopTuning t = tuneLoop(f0, p, sampleRate);
  return loopPhaseDelay(t, f0, sampleRate) - sampleRate / f0;
}

// The freestanding functions, so the tests can set them against Math.*.
// op: 0 sin, 1 cos, 2 atan2(a, b), 3 tan, 4 exp2.
double jig_math(int32_t op, double a, double b) {
  switch (op) {
    case 0: return sind(a);
    case 1: return cosd(a);
    case 2: return atan2d(a, b);
    case 3: return tand(a);
    case 4: return exp2d(a);
    default: return 0.0;
  }
}

}
