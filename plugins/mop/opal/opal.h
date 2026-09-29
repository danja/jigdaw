/*
    Copyright (c) 2026 Bitdancer (github.com/RealBitdancer).
    SPDX-License-Identifier: MIT

    Opal OPL3 emulator (public API).

    Core by Shayde/Reality. Public domain. See PUBLIC_DOMAIN_PROOF.txt.
    C11 port, C API, resampling, and pan by Bitdancer. See LICENSE and THIRD_PARTY_LICENSES.md.

    Covers full OPL2/OPL3. Stereo output matches YMF262 reference behavior. 2/4 op FM, 8
    waveforms, LFOs, rhythm, timers, status via opalReadStatus. Register 08 bit 7 is unused on
    the YMF262, as on the real chip. Bank 1, four-operator pairing, waveforms 4-7, and CHA/CHB
    take effect only while NEW (register 105h bit 0) is set.

    The Opal struct holds no pointers: all internal references are indices, so an instance is
    a plain value. Copy, memcpy, or relocate it freely. A copy is a complete save state.
*/

#ifndef OPAL_OPAL_H_INCLUDED
#define OPAL_OPAL_H_INCLUDED

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C"
{
#endif

typedef struct OpalChannel OpalChannel;
typedef struct OpalOperator OpalOperator;
typedef struct Opal Opal;

// clang-format off
#define OPAL_VERSION_MAJOR 2
#define OPAL_VERSION_MINOR 0
#define OPAL_VERSION_PATCH 2

#define OPAL_VERSION ((OPAL_VERSION_MAJOR) * 10000 + (OPAL_VERSION_MINOR) * 100 + (OPAL_VERSION_PATCH))

/* Various constants */
#define OPAL_OPL3_SAMPLE_RATE 49716
#define OPAL_CHANNEL_COUNT    18
#define OPAL_OPERATOR_COUNT   36

#define OPAL_WRITEBUF_SIZE  4096
#define OPAL_WRITEBUF_DELAY 2

/* Sentinel values for the index fields below */
#define OPAL_OP_NONE        0xFF    /* no operator: the source reads as silence */
#define OPAL_MOD_OWN_FB     0xFE    /* modSource: the operator's own feedback value */
#define OPAL_CH_NONE        0xFF    /* no paired channel */

/* OpalOperator::envelopeStage values */
#define OPAL_ENVELOPE_STAGE_OFF     (-1) /* never written by the core */
#define OPAL_ENVELOPE_STAGE_ATTACK  0
#define OPAL_ENVELOPE_STAGE_DECAY   1
#define OPAL_ENVELOPE_STAGE_SUSTAIN 2
#define OPAL_ENVELOPE_STAGE_RELEASE 3

/* OpalChannel::chanType values */
#define OPAL_CHANNEL_TYPE_2OP   0   /* two-operator melodic channel */
#define OPAL_CHANNEL_TYPE_4OP   1   /* primary half of a four-operator pair */
#define OPAL_CHANNEL_TYPE_4OP2  2   /* secondary half of a four-operator pair */
#define OPAL_CHANNEL_TYPE_DRUM  3   /* rhythm-mode percussion channel */

typedef struct OpalWriteBuf
{
    uint64_t time;
    uint16_t reg;
    uint8_t  data;
} OpalWriteBuf;

/*
    A single FM operator (maps to one OPL3 slot).

    Slot layout: melodic channel ch (0-8 = bank 0, 9-17 = bank 1) uses op[slot] as its modulator
    and op[slot + 3] as its carrier, where

        slot = { 0,1,2, 6,7,8, 12,13,14, 18,19,20, 24,25,26, 30,31,32 }[ch]

    In 4-op mode the paired channel contributes op[slot + 6] and op[slot + 9]. The same operators
    are reachable through OpalChannel::opSlot[]. All cross references are indices into Opal::op
    and Opal::chan, so a copied instance is fully self-contained.

    Fields useful for visualizers:
        envelopeStage   ATTACK, DECAY, SUSTAIN, or RELEASE. OPAL_ENVELOPE_STAGE_OFF is defined
                        for visualizers. The core never writes it: idle operators sit in RELEASE
                        with egOut >= 511
        egOut           current total attenuation (envelope + output level + KSL + tremolo) in
                        0.1875 dB steps where 0 is loudest and >= 511 is silence
        key             nonzero while keyed on (bit 0 = normal key on, bit 1 = rhythm key on)
        modSource       phase modulation input: an index into Opal::op whose out is read,
                        OPAL_MOD_OWN_FB for the operator's own feedback, OPAL_OP_NONE for none
*/
struct OpalOperator
{
    uint8_t         slotIndex;
    uint8_t         chanIndex;
    uint8_t         modSource;
    uint32_t        phase;
    uint16_t        phaseOut;
    bool            phaseReset;
    uint16_t        waveform;
    uint16_t        freqMultTimes2;
    int             envelopeStage;
    uint16_t        envelopeLevel;
    uint16_t        egOut;
    uint8_t         egKsl;
    uint16_t        outputLevel;
    uint16_t        attackRate;
    uint16_t        decayRate;
    uint16_t        sustainLevel;
    uint16_t        releaseRate;
    uint8_t         keyScaleReg;
    uint8_t         key;
    int16_t         out;
    int16_t         prevOut;
    int16_t         fbMod;
    bool            keyScaleRate;
    bool            sustainMode;
    bool            tremoloEnable;
    bool            vibratoEnable;
};

/*
    A single channel, which can contain two or more operators.

    opSlot[] holds the indices of the channel's operators in Opal::op (OPAL_OP_NONE when absent).
    pairIndex is the physical 4-op partner (0+3, 1+4, 2+5 and the same on bank 1). Init pre-wires
    those pairs. Channels that cannot pair (6-8, 15-17) use OPAL_CH_NONE. Whether 4-op is active
    is chanType, not pairIndex. outSource[] lists up to four operator indices whose out values
    sum into the channel output, describing the active FM algorithm routing.
*/
struct OpalChannel
{
    uint8_t         opSlot[4];
    uint8_t         chanIndex;
    uint8_t         pairIndex;
    uint8_t         outSource[4];
    int             chanType;
    uint16_t        freq;
    uint16_t        octave;
    uint16_t        keyScaleNumber;
    uint16_t        feedbackShift;
    uint16_t        modulationType;
    uint16_t        alg;
    uint16_t        cha;
    uint16_t        chb;
    uint16_t        chc;
    uint16_t        chd;
    uint16_t        leftPan;
    uint16_t        rightPan;
};


/*==================================================================================================
            Opal instance.

            A plain value with no internal pointers: every cross reference is an index. Copying
            or relocating an instance (assignment, memcpy, reallocating containers) yields a
            fully working chip, so a copy doubles as a save state or a snapshot for a
            visualizer.
 ==================================================================================================*/
struct Opal
{
    int32_t             sampleRate;
    int32_t             sampleAccum;
    int16_t             lastOutput[2], currOutput[2];
    int32_t             mixBuffRight;
    OpalChannel         chan[OPAL_CHANNEL_COUNT];
    OpalOperator        op[OPAL_OPERATOR_COUNT];
    uint16_t            chipTimer;
    uint8_t             tremoloPos;
    uint8_t             tremoloLevel;
    uint8_t             tremoloShift;
    uint8_t             vibPos;
    uint8_t             vibShift;
    uint64_t            egTimer;
    uint8_t             egState;
    uint8_t             egAdd;
    uint8_t             egTimerLo;
    uint8_t             egTimerRem;
    bool                noteSel;
    bool                opl3Enabled;
    bool                rhythmMode;
    bool                waveformSelect;
    bool                compositeSineWave;
    uint32_t            noise;
    uint8_t             rmHhBit2;
    uint8_t             rmHhBit3;
    uint8_t             rmHhBit7;
    uint8_t             rmHhBit8;
    uint8_t             rmTcBit3;
    uint8_t             rmTcBit5;
    uint8_t             rhythmReg;
    uint8_t             timer[2];
    uint8_t             timerControl;
    uint16_t            timerCount[2];
    uint8_t             status;
    OpalWriteBuf        writeBuf[OPAL_WRITEBUF_SIZE];
    uint64_t            writeBufSampleCount;
    uint32_t            writeBufCur;
    uint32_t            writeBufLast;
    uint64_t            writeBufLastTime;
};
// clang-format on

/*==================================================================================================
            Public API.
 ==================================================================================================*/
/*!
 * \brief Initialize Opal with a given output sample rate, resetting all chip state
 * \param self Pointer to the Opal instance
 * \param sampleRate Desired output sample rate
 */
void opalInit(Opal* self, int sampleRate);

/*!
 * \brief Change the output sample rate of an existing initialized instance
 * \param self Pointer to the Opal instance
 * \param sampleRate Desired output sample rate
 */
void opalSetSampleRate(Opal* self, int sampleRate);

/*!
 * \brief Write a register immediately (same sample as the call)
 * \param self Pointer to the Opal instance
 * \param regNum OPL3 Register address
 * \param val Value to write
 */
void opalWriteReg(Opal* self, uint16_t regNum, uint8_t val);

/*!
 * \brief Queue a register write, spaced OPAL_WRITEBUF_DELAY chip samples apart (chip-accurate timing)
 * \param self Pointer to the Opal instance
 * \param regNum OPL3 Register address
 * \param val Value to write
 */
void opalWriteRegBuffered(Opal* self, uint16_t regNum, uint8_t val);

/*!
 * \brief Apply any queued register writes immediately
 * \param self Pointer to the Opal instance
 */
void opalFlushWriteBuf(Opal* self);

/*!
 * \brief Set panning level per channel
 * \param self Pointer to the Opal instance
 * \param channel Channel index 0 to 17, or 0 to 8 with bit 8 set for the second bank
 * \param pan Panning level (0 left, 64 middle, 127 right)
 */
void opalPan(Opal* self, uint16_t channel, uint8_t pan);

/*!
 * \brief Generate one stereo 16-bit PCM sample (writes two integers)
 * \param self Pointer to the Opal instance
 * \param left Sample for the left channel
 * \param right Sample for the right channel
 */
void opalSample(Opal* self, int16_t* left, int16_t* right);

/*!
 * \brief Read the chip status register (bit 7 = IRQ, bit 6 = Timer 1 overflow, bit 5 = Timer 2
 *        overflow). Flags stay set until a reset write (bit 7 of register 4), as on real
 *        hardware.
 * \param self Pointer to the Opal instance
 * \return The status byte, as a real OPL would return on a status-port read
 */
uint8_t opalReadStatus(Opal* self);

#ifdef __cplusplus
}
#endif

#endif /* OPAL_OPAL_H_INCLUDED */
