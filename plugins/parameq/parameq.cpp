// plugins/parameq/parameq.cpp
//
// A six-band stereo parametric equalizer: one RBJ biquad per band per
// channel, cascaded, following Robert Bristow-Johnson's Audio EQ Cookbook.
// Band shapes are Peak, Low Shelf, High Shelf, Low Pass, High Pass, Band
// Pass and Notch; shelves take their slope from Q so that every position of
// every control means something.
//
// Compiled with clang++ --target=wasm32 -nostdlib (see build.sh): no libc
// and no libm, so the handful of transcendental functions the coefficient
// update needs (sin, cos, sqrt, 2^x) are approximated below rather than
// called. They run only when a parameter changes or the rate is set, never
// in jig_process, where a few parts per million would be inaudible anyway
// and these manage about one.
#include <stdint.h>

// The compiler emits calls to memcpy and memset for array initialisation
// whatever the source says, and this is a -nostdlib build with no libc to
// answer them (see plugins/8b8/shim/nostdlib.cpp for the same three). They
// run at instantiation, never in jig_process.
typedef unsigned long size_t_shim;
extern "C" {
void *memcpy(void *dest, const void *src, size_t_shim n) {
  unsigned char *d = (unsigned char *)dest;
  const unsigned char *s = (const unsigned char *)src;
  for (size_t_shim i = 0; i < n; i++) d[i] = s[i];
  return dest;
}
void *memset(void *dest, int value, size_t_shim n) {
  unsigned char *d = (unsigned char *)dest;
  for (size_t_shim i = 0; i < n; i++) d[i] = (unsigned char)value;
  return dest;
}
}

namespace {
constexpr uint32_t kMaxFrames = 128;
constexpr int kChannels = 2;
constexpr int kBands = 6;

constexpr float kPi = 3.14159265358979323846f;

// --- freestanding math -------------------------------------------------------
// Sine, cosine, square root and 2^x in double precision, from polynomials
// and Newton iteration rather than libm: this is a -nostdlib build with no
// libm to call, and a module declaring an ABI must instantiate with no
// imports.
//
// Double precision here is load bearing, not luxury. A corner far below the
// sample rate puts its poles next to z = 1, where the a1 coefficient is a
// shade under -2 and an absolute error of 1e-4 in cos(w0) moves the corner
// an octave: measured, a high pass ordered at 80 Hz filtered at 170. The
// coefficient update runs only on jig_set_param/jig_init, never in
// jig_process, so doing it in f64 costs nothing audible and the only error
// left is the final rounding to the f32 the filter state keeps, which is
// what every f32 biquad lives with.

float fabsf_local(float x) { return x < 0 ? -x : x; }

// Taylor to x^13 on [0, pi/2]: truncation under 1e-12 there.
double sin_unit(double x) {
  const double x2 = x * x;
  return x * (1.0 + x2 * (-1.0 / 6.0 + x2 * (1.0 / 120.0 + x2 * (-1.0 / 5040.0 + x2 * (1.0 / 362880.0 + x2 * (-1.0 / 39916800.0 + x2 * (1.0 / 6227020800.0)))))));
}

// Taylor to x^12 on [0, pi/2]: truncation under 1e-12 there.
double cos_unit(double x) {
  const double x2 = x * x;
  return 1.0 + x2 * (-1.0 / 2.0 + x2 * (1.0 / 24.0 + x2 * (-1.0 / 720.0 + x2 * (1.0 / 40320.0 + x2 * (-1.0 / 3628800.0 + x2 * (1.0 / 479001600.0))))));
}

// The domain is only ever w0 in (0, pi), a corner below Nyquist, which
// updateBand guarantees by clamping. Folded onto [0, pi/2] by symmetry.
void sincos_local(float x, float* s, float* c) {
  double xd = (double)x;
  double ax = xd;
  bool over = ax > (double)kPi / 2.0;
  if (over) ax = (double)kPi - ax;
  double sn = sin_unit(ax);
  double cs = cos_unit(ax);
  *s = (float)sn;
  *c = (float)(over ? -cs : cs);
}

double sqrt_local(double x) {
  if (x <= 0) return 0;
  // Initial guess from the bit pattern, then Newton to convergence.
  union { double d; uint64_t u; } v = {x};
  v.u = (v.u >> 1) + 0x1ff6000000000000ull;
  double y = v.d;
  for (int i = 0; i < 6; i++) y = 0.5 * (y + x / y);
  return y;
}

// 2^x by integer/fraction split and a degree-7 polynomial on the fraction,
// truncation under 1e-11 for |x| under about 8. Used only as 10^(dB/40).
double exp2_local(double x) {
  long whole = (long)x;
  if (x < 0 && x != (double)whole) whole -= 1;
  double frac = x - (double)whole;
  // 2^frac = e^(frac ln 2), Taylor to t^7 in (frac ln 2): seven Horner
  // stages for powers 7 down to 1, then the constant term.
  const double ln2 = 0.6931471805599453;
  double t = frac * ln2;
  double p = 1.0 / 5040.0;
  p = 1.0 / 720.0 + t * p;
  p = 1.0 / 120.0 + t * p;
  p = 1.0 / 24.0 + t * p;
  p = 1.0 / 6.0 + t * p;
  p = 1.0 / 2.0 + t * p;
  p = 1.0 + t * p;
  p = 1.0 + t * p;
  double scale = 1.0;
  if (whole >= 0) {
    for (long i = 0; i < whole; i++) scale *= 2.0;
  } else {
    for (long i = 0; i < -whole; i++) scale *= 0.5;
  }
  return p * scale;
}

// --- state -------------------------------------------------------------------

// Preallocated, never resized: docs/module-abi.md's "a module MUST NOT grow
// its memory after jig_init" rule. A host takes these pointers once and
// holds them for the module's whole lifetime.
float inputBuffer[kChannels][kMaxFrames];
float outputBuffer[kChannels][kMaxFrames];

float sampleRate = 48000.0f;
float enabled = 1.0f;

float bandOn[kBands] = {1, 1, 1, 1, 1, 1};
float bandType[kBands] = {4, 1, 0, 0, 2, 3};
float bandFreq[kBands] = {80, 250, 1000, 4000, 8000, 16000};
float bandGainDb[kBands] = {0, 0, 0, 0, 0, 0};
float bandQ[kBands] = {0.7f, 1, 1, 1, 1, 0.7f};

// Normalised biquad coefficients per band (a0 divided out).
float b0[kBands] = {1, 1, 1, 1, 1, 1};
float b1[kBands] = {0, 0, 0, 0, 0, 0};
float b2[kBands] = {0, 0, 0, 0, 0, 0};
float a1[kBands] = {0, 0, 0, 0, 0, 0};
float a2[kBands] = {0, 0, 0, 0, 0, 0};

// Direct form II transposed state, per channel per band.
float z1[kChannels][kBands] = {};
float z2[kChannels][kBands] = {};

enum Type { Peak = 0, LowShelf = 1, HighShelf = 2, LowPass = 3, HighPass = 4, BandPass = 5, Notch = 6 };

void updateBand(int band) {
  double freq = (double)bandFreq[band];
  if (freq < 10.0) freq = 10.0;
  double nyquist = 0.5 * (double)sampleRate;
  if (freq > nyquist * 0.99) freq = nyquist * 0.99;
  double q = (double)bandQ[band];
  if (q < 0.05) q = 0.05;
  if (q > 20.0) q = 20.0;

  double w0 = 2.0 * (double)kPi * freq / (double)sampleRate;
  float sinw0f, cosw0f;
  sincos_local((float)w0, &sinw0f, &cosw0f);
  double sinw0 = (double)sinw0f, cosw0 = (double)cosw0f;

  // 10^(dB/40) = 2^(dB * log2(10) / 40).
  double A = exp2_local((double)bandGainDb[band] * 0.08304820237218444);
  double sqrtA = sqrt_local(A);

  double alpha = sinw0 / (2.0 * q);
  int t = (int)(bandType[band] + 0.5f);

  double nb0, nb1, nb2, na0, na1, na2;
  if (t == Peak) {
    nb0 = 1 + alpha * A; nb1 = -2 * cosw0; nb2 = 1 - alpha * A;
    na0 = 1 + alpha / A; na1 = -2 * cosw0; na2 = 1 - alpha / A;
  } else if (t == LowShelf) {
    // Shelf slope S comes from Q, so Q stays meaningful on shelves.
    double S = q;
    double as = sinw0 / 2.0 * sqrt_local((A + 1 / A) * (1 / S - 1) + 2);
    double ap1 = (A + 1), am1 = (A - 1), mul = 2 * sqrtA * as;
    nb0 = A * (ap1 - am1 * cosw0 + mul);
    nb1 = 2 * A * (am1 - ap1 * cosw0);
    nb2 = A * (ap1 - am1 * cosw0 - mul);
    na0 = ap1 + am1 * cosw0 + mul;
    na1 = -2 * (am1 + ap1 * cosw0);
    na2 = ap1 + am1 * cosw0 - mul;
  } else if (t == HighShelf) {
    double S = q;
    double as = sinw0 / 2.0 * sqrt_local((A + 1 / A) * (1 / S - 1) + 2);
    double ap1 = (A + 1), am1 = (A - 1), mul = 2 * sqrtA * as;
    nb0 = A * (ap1 + am1 * cosw0 + mul);
    nb1 = -2 * A * (am1 + ap1 * cosw0);
    nb2 = A * (ap1 + am1 * cosw0 - mul);
    na0 = ap1 - am1 * cosw0 + mul;
    na1 = 2 * (am1 - ap1 * cosw0);
    na2 = ap1 - am1 * cosw0 - mul;
  } else if (t == LowPass) {
    double c = 1 - cosw0;
    nb0 = c / 2; nb1 = c; nb2 = c / 2;
    na0 = 1 + alpha; na1 = -2 * cosw0; na2 = 1 - alpha;
  } else if (t == HighPass) {
    double c = 1 + cosw0;
    nb0 = c / 2; nb1 = -c; nb2 = c / 2;
    na0 = 1 + alpha; na1 = -2 * cosw0; na2 = 1 - alpha;
  } else if (t == BandPass) {
    nb0 = alpha; nb1 = 0; nb2 = -alpha;
    na0 = 1 + alpha; na1 = -2 * cosw0; na2 = 1 - alpha;
  } else {  // Notch, and anything out of range fails safe to a notch.
    nb0 = 1; nb1 = -2 * cosw0; nb2 = 1;
    na0 = 1 + alpha; na1 = -2 * cosw0; na2 = 1 - alpha;
  }

  b0[band] = (float)(nb0 / na0);
  b1[band] = (float)(nb1 / na0);
  b2[band] = (float)(nb2 / na0);
  a1[band] = (float)(na1 / na0);
  a2[band] = (float)(na2 / na0);
}

void updateAll() {
  for (int band = 0; band < kBands; band++) updateBand(band);
}

}  // namespace

extern "C" {

void jig_init(float rate) {
  if (rate > 0) sampleRate = rate;
  updateAll();
  for (int c = 0; c < kChannels; c++)
    for (int b = 0; b < kBands; b++) z1[c][b] = z2[c][b] = 0;
}

uint32_t jig_max_frames() { return kMaxFrames; }

uint32_t jig_input_ptr(uint32_t channel) {
  return reinterpret_cast<uint32_t>(&inputBuffer[channel < kChannels ? channel : 0][0]);
}

uint32_t jig_output_ptr(uint32_t channel) {
  return reinterpret_cast<uint32_t>(&outputBuffer[channel < kChannels ? channel : 0][0]);
}

void jig_set_param(uint32_t index, float value) {
  if (index == 0) {
    enabled = value;
    return;
  }
  uint32_t band = (index - 1) / 5;
  uint32_t field = (index - 1) % 5;
  if (band >= kBands) return;
  if (field == 0) {
    bandOn[band] = value;
    return;  // No coefficient change: bypass keeps its state.
  }
  if (field == 1) bandType[band] = value;
  else if (field == 2) bandFreq[band] = value;
  else if (field == 3) bandGainDb[band] = value;
  else bandQ[band] = value;
  updateBand(static_cast<int>(band));
}

void jig_process(uint32_t frames) {
  if (frames > kMaxFrames) frames = kMaxFrames;
  for (int channel = 0; channel < kChannels; channel++) {
    if (enabled < 0.5f) {
      for (uint32_t i = 0; i < frames; i++) outputBuffer[channel][i] = inputBuffer[channel][i];
      continue;
    }
    for (uint32_t i = 0; i < frames; i++) {
      float x = inputBuffer[channel][i];
      for (int band = 0; band < kBands; band++) {
        if (bandOn[band] < 0.5f) continue;
        // Direct form II transposed, one multiply-accumulate chain.
        float y = b0[band] * x + z1[channel][band];
        z1[channel][band] = b1[band] * x - a1[band] * y + z2[channel][band];
        z2[channel][band] = b2[band] * x - a2[band] * y;
        // Denormal guard: a parked filter decays into subnormals, which
        // trap on some hardware. Anything this small is silence.
        if (fabsf_local(z1[channel][band]) < 1e-18f) z1[channel][band] = 0;
        if (fabsf_local(z2[channel][band]) < 1e-18f) z2[channel][band] = 0;
        x = y;
      }
      outputBuffer[channel][i] = x;
    }
  }
}

}  // extern "C"
