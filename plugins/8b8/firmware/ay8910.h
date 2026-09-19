// AY-3-8910 emulator.
//
// Enough of the chip to sound like the chip: three square-wave tone
// channels, a 17-bit LFSR noise source, one envelope generator per chip,
// the mixer, and the logarithmic DAC. Shared by the native test build and
// the browser build, so what you hear in a browser is what the tests check.
//
// Internal rate is clock/8. The datasheet's tone frequency is
// clock / (16 * period), and the output toggles once per period, so a full
// square cycle is two periods: stepping at clock/8 makes
// clock/8 / (2 * period) == clock / (16 * period). Noise shifts every
// 2*period steps, matching clock/(16*NP).
//
// The envelope advances one STEP every 2*period steps, giving a step rate of
// clock/(16*EP) and so a complete 16-step cycle of clock/(256*EP) -- which is
// what the datasheet's envelope frequency actually refers to. Treating that
// figure as the step rate instead makes every envelope 16x too slow, which is
// audible immediately on drums since they are the envelope-driven voices.
#pragma once
#include <stdint.h>
#include <string.h>

class AY8910 {
public:
  static const int REG_COUNT = 16;

  void reset() {
    memset(regs, 0, sizeof regs);
    memset(toneCount, 0, sizeof toneCount);
    memset(toneState, 0, sizeof toneState);
    noiseCount = 0; noiseLfsr = 1; noiseState = 0;
    envCount = 0; envStep = 0; envHolding = false; envOut = 0;
  }

  void write(uint8_t reg, uint8_t val) {
    if (reg >= REG_COUNT) return;
    regs[reg] = val;
    // Writing the shape register always restarts the envelope from the top.
    // That is the behaviour Sync Buzz and Drum Roll rely on.
    if (reg == 13) {
      envStep = 0; envHolding = false; envCount = 0;
      updateEnvOut();
    }
  }

  uint8_t read(uint8_t reg) const { return reg < REG_COUNT ? regs[reg] : 0; }

  // Advance one chip step (clock/16) and return the summed output, 0..1.
  float step() {
    // --- tone channels -----------------------------------------------
    for (int c = 0; c < 3; c++) {
      uint16_t period = (uint16_t)(regs[c * 2] | ((regs[c * 2 + 1] & 0x0F) << 8));
      if (period == 0) period = 1;          // a zero period behaves as one
      if (++toneCount[c] >= period) {
        toneCount[c] = 0;
        toneState[c] ^= 1;
      }
    }

    // --- noise --------------------------------------------------------
    uint8_t nper = regs[6] & 0x1F;
    if (nper == 0) nper = 1;
    if (++noiseCount >= (uint16_t)nper * 2u) {
      noiseCount = 0;
      // 17-bit LFSR, taps at bits 0 and 3.
      uint32_t bit = ((noiseLfsr ^ (noiseLfsr >> 3)) & 1);
      noiseLfsr = (noiseLfsr >> 1) | (bit << 16);
      noiseState = (uint8_t)(noiseLfsr & 1);
    }

    // --- envelope -----------------------------------------------------
    uint16_t eper = (uint16_t)(regs[11] | (regs[12] << 8));
    if (eper == 0) eper = 1;
    // One envelope step every 2*EP steps of clock/8, so the full 16-step
    // cycle lands on the datasheet's clock/(256*EP).
    if (++envCount >= (uint32_t)eper * 2u) {
      envCount = 0;
      if (!envHolding) {
        envStep++;
        updateEnvOut();
      }
    }

    // --- mixer and amplitude ------------------------------------------
    uint8_t mix = regs[7];
    float out = 0.0f;
    for (int c = 0; c < 3; c++) {
      bool toneOn  = ((mix >> c) & 1) == 0;
      bool noiseOn = ((mix >> (c + 3)) & 1) == 0;
      // Channel output is high unless a source that is enabled pulls it low.
      uint8_t level = 1;
      if (toneOn  && !toneState[c])  level = 0;
      if (noiseOn && !noiseState)    level = 0;
      if (!toneOn && !noiseOn)       level = 1;   // both muted: steady DC

      uint8_t amp = regs[8 + c];
      uint8_t vol = (amp & 0x10) ? envOut : (amp & 0x0F);
      out += level ? dac(vol) : 0.0f;
    }
    return out / 3.0f;
  }

  // The chip's DAC is logarithmic, roughly 3dB per step.
  static float dac(uint8_t v) {
    static const float t[16] = {
      0.0000f, 0.0056f, 0.0079f, 0.0112f, 0.0158f, 0.0224f, 0.0316f, 0.0447f,
      0.0631f, 0.0891f, 0.1259f, 0.1778f, 0.2512f, 0.3548f, 0.5012f, 1.0000f
    };
    return t[v & 0x0F];
  }

private:
  void updateEnvOut() {
    uint8_t shape = regs[13] & 0x0F;
    bool cont = shape & 0x08, att = shape & 0x04, alt = shape & 0x02, hold = shape & 0x01;

    uint8_t pos = envStep & 0x0F;
    uint8_t cycle = (envStep >> 4) & 1;

    if (!cont) {                       // shapes 0-7: one pass, then silence
      if (envStep >= 16) { envOut = 0; envHolding = true; return; }
      envOut = att ? pos : (uint8_t)(15 - pos);
      return;
    }
    if (hold) {
      if (envStep >= 16) {             // ramp once, then sit
        bool high = att ? !alt : alt;
        envOut = high ? 15 : 0;
        envHolding = true;
        return;
      }
      envOut = att ? pos : (uint8_t)(15 - pos);
      return;
    }
    // repeating shapes: 8 saw down, 10 triangle, 12 saw up, 14 triangle up
    bool rising = att;
    if (alt && cycle) rising = !rising;
    envOut = rising ? pos : (uint8_t)(15 - pos);
  }

  uint8_t  regs[REG_COUNT];
  uint16_t toneCount[3];
  uint8_t  toneState[3];
  uint16_t noiseCount;
  uint8_t  noiseState;
  uint32_t noiseLfsr;
  uint32_t envCount;
  uint32_t envStep;
  bool     envHolding;
  uint8_t  envOut;
};
