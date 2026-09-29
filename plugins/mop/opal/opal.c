/*
    Copyright (c) 2026 Bitdancer (github.com/RealBitdancer).
    SPDX-License-Identifier: MIT

    Opal OPL3 emulator.

    Emulation core by Shayde/Reality (Reality Adlib Tracker 2). Public domain. See PUBLIC_DOMAIN_PROOF.txt.
    C11 port from OpenMPT soundlib/opal.h. C API, resampling, pan, rhythm, timers, and accuracy
    work by Bitdancer. See LICENSE and THIRD_PARTY_LICENSES.md.

    Stereo output matches YMF262 reference emulator behavior.
*/

#include "opal.h"

#include <stdint.h>
#include <string.h>

enum
{
    OPAL_KEY_NORMAL = 0x01,
    OPAL_KEY_DRUM = 0x02
};

// clang-format off
static const int8_t adSlot[0x20] =
{
    0,  1,  2,  3,  4,  5,  -1, -1, 6,  7,  8,  9,  10, 11, -1, -1,
    12, 13, 14, 15, 16, 17, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
};

// The slot layout is documented for consumers in opal.h (OpalOperator notes). Keep them in sync.
static const uint8_t chSlot[18] =
{
    0, 1, 2, 6, 7, 8, 12, 13, 14, 18, 19, 20, 24, 25, 26, 30, 31, 32,
};

static const uint16_t mulTimes2[16] =
{
    1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 20, 24, 24, 30, 30,
};

static const uint8_t kslShift[4] =
{
    8, 1, 2, 0
};

static const uint8_t kslRom[16] =
{
    0, 32, 40, 45, 48, 51, 53, 55, 56, 58, 59, 60, 61, 62, 63, 64
};

static const uint8_t egIncStep[4][4] = 
{
    {0, 0, 0, 0},
    {1, 0, 0, 0},
    {1, 0, 1, 0},
    {1, 1, 1, 0},
};

/* Decapped OPL2/OPL3 chip ROM. Hardware constants; see THIRD_PARTY_LICENSES.md. */
static const uint16_t expTable[0x100] =
{
    0x7FA, 0x7F5, 0x7EF, 0x7EA, 0x7E4, 0x7DF, 0x7DA, 0x7D4,
    0x7CF, 0x7C9, 0x7C4, 0x7BF, 0x7B9, 0x7B4, 0x7AE, 0x7A9,
    0x7A4, 0x79F, 0x799, 0x794, 0x78F, 0x78A, 0x784, 0x77F,
    0x77A, 0x775, 0x770, 0x76A, 0x765, 0x760, 0x75B, 0x756,
    0x751, 0x74C, 0x747, 0x742, 0x73D, 0x738, 0x733, 0x72E,
    0x729, 0x724, 0x71F, 0x71A, 0x715, 0x710, 0x70B, 0x706,
    0x702, 0x6FD, 0x6F8, 0x6F3, 0x6EE, 0x6E9, 0x6E5, 0x6E0,
    0x6DB, 0x6D6, 0x6D2, 0x6CD, 0x6C8, 0x6C4, 0x6BF, 0x6BA,
    0x6B5, 0x6B1, 0x6AC, 0x6A8, 0x6A3, 0x69E, 0x69A, 0x695,
    0x691, 0x68C, 0x688, 0x683, 0x67F, 0x67A, 0x676, 0x671,
    0x66D, 0x668, 0x664, 0x65F, 0x65B, 0x657, 0x652, 0x64E,
    0x649, 0x645, 0x641, 0x63C, 0x638, 0x634, 0x630, 0x62B,
    0x627, 0x623, 0x61E, 0x61A, 0x616, 0x612, 0x60E, 0x609,
    0x605, 0x601, 0x5FD, 0x5F9, 0x5F5, 0x5F0, 0x5EC, 0x5E8,
    0x5E4, 0x5E0, 0x5DC, 0x5D8, 0x5D4, 0x5D0, 0x5CC, 0x5C8,
    0x5C4, 0x5C0, 0x5BC, 0x5B8, 0x5B4, 0x5B0, 0x5AC, 0x5A8,
    0x5A4, 0x5A0, 0x59C, 0x599, 0x595, 0x591, 0x58D, 0x589,
    0x585, 0x581, 0x57E, 0x57A, 0x576, 0x572, 0x56F, 0x56B,
    0x567, 0x563, 0x560, 0x55C, 0x558, 0x554, 0x551, 0x54D,
    0x549, 0x546, 0x542, 0x53E, 0x53B, 0x537, 0x534, 0x530,
    0x52C, 0x529, 0x525, 0x522, 0x51E, 0x51B, 0x517, 0x514,
    0x510, 0x50C, 0x509, 0x506, 0x502, 0x4FF, 0x4FB, 0x4F8,
    0x4F4, 0x4F1, 0x4ED, 0x4EA, 0x4E7, 0x4E3, 0x4E0, 0x4DC,
    0x4D9, 0x4D6, 0x4D2, 0x4CF, 0x4CC, 0x4C8, 0x4C5, 0x4C2,
    0x4BE, 0x4BB, 0x4B8, 0x4B5, 0x4B1, 0x4AE, 0x4AB, 0x4A8,
    0x4A4, 0x4A1, 0x49E, 0x49B, 0x498, 0x494, 0x491, 0x48E,
    0x48B, 0x488, 0x485, 0x482, 0x47E, 0x47B, 0x478, 0x475,
    0x472, 0x46F, 0x46C, 0x469, 0x466, 0x463, 0x460, 0x45D,
    0x45A, 0x457, 0x454, 0x451, 0x44E, 0x44B, 0x448, 0x445,
    0x442, 0x43F, 0x43C, 0x439, 0x436, 0x433, 0x430, 0x42D,
    0x42A, 0x428, 0x425, 0x422, 0x41F, 0x41C, 0x419, 0x416,
    0x414, 0x411, 0x40E, 0x40B, 0x408, 0x406, 0x403, 0x400,
};

static const uint16_t logSinTable[0x100] =
{
    2137, 1731, 1543, 1419, 1326, 1252, 1190, 1137, 1091, 1050, 1013,  979,  949,  920,  894,  869,
     846,  825,  804,  785,  767,  749,  732,  717,  701,  687,  672,  659,  646,  633,  621,  609,
     598,  587,  576,  566,  556,  546,  536,  527,  518,  509,  501,  492,  484,  476,  468,  461,
     453,  446,  439,  432,  425,  418,  411,  405,  399,  392,  386,  380,  375,  369,  363,  358,
     352,  347,  341,  336,  331,  326,  321,  316,  311,  307,  302,  297,  293,  289,  284,  280,
     276,  271,  267,  263,  259,  255,  251,  248,  244,  240,  236,  233,  229,  226,  222,  219,
     215,  212,  209,  205,  202,  199,  196,  193,  190,  187,  184,  181,  178,  175,  172,  169,
     167,  164,  161,  159,  156,  153,  151,  148,  146,  143,  141,  138,  136,  134,  131,  129,
     127,  125,  122,  120,  118,  116,  114,  112,  110,  108,  106,  104,  102,  100,   98,   96,
      94,   92,   91,   89,   87,   85,   83,   82,   80,   78,   77,   75,   74,   72,   70,   69,
      67,   66,   64,   63,   62,   60,   59,   57,   56,   55,   53,   52,   51,   49,   48,   47,
      46,   45,   43,   42,   41,   40,   39,   38,   37,   36,   35,   34,   33,   32,   31,   30,
      29,   28,   27,   26,   25,   24,   23,   23,   22,   21,   20,   20,   19,   18,   17,   17,
      16,   15,   15,   14,   13,   13,   12,   12,   11,   10,   10,    9,    9,    8,    8,    7,
       7,    7,    6,    6,    5,    5,    5,    4,    4,    4,    3,    3,    3,    2,    2,    2,
       2,    1,    1,    1,    1,    1,    1,    1,    0,    0,    0,    0,    0,    0,    0,    0,
};
// clang-format on

static int16_t opalClipSample(int32_t sample)
{
    if (sample > 32767)
    {
        return 32767;
    }
    if (sample < -32768)
    {
        return -32768;
    }
    return (int16_t)sample;
}

static int16_t opalInterpolate(int16_t last, int16_t curr, int32_t fract)
{
    return (int16_t)(last + (int32_t)(((int64_t)fract * (curr - last)) / 65536));
}

static void operatorUpdateKsl(const Opal* chip, OpalOperator* op)
{
    const OpalChannel* chan = &chip->chan[op->chanIndex];
    int16_t ksl = (int16_t)((kslRom[chan->freq >> 6] << 2) - ((int16_t)(0x08 - chan->octave) << 5));
    if (ksl < 0)
    {
        ksl = 0;
    }
    op->egKsl = (uint8_t)ksl;
}

static int16_t operatorExpCalc(uint32_t level)
{
    if (level > 0x1FFF)
    {
        level = 0x1FFF;
    }
    return (int16_t)((expTable[level & 0xFF] << 1) >> (level >> 8));
}

static int16_t operatorWave(const Opal* chip, const OpalOperator* op, uint16_t phase, uint16_t envelope)
{
    uint16_t out = 0;
    uint16_t neg = 0;
    uint16_t waveform = op->waveform;

    if (!chip->opl3Enabled)
    {
        waveform &= 0x03;
    }

    phase &= 0x3FF;

    switch (waveform)
    {
        case 0:
        {
            if (phase & 0x200)
            {
                neg = 0xFFFF;
            }
            if (phase & 0x100)
            {
                out = logSinTable[(phase & 0xFF) ^ 0xFF];
            }
            else
            {
                out = logSinTable[phase & 0xFF];
            }
            break;
        }
        case 1:
        {
            if (phase & 0x200)
            {
                out = 0x1000;
            }
            else if (phase & 0x100)
            {
                out = logSinTable[(phase & 0xFF) ^ 0xFF];
            }
            else
            {
                out = logSinTable[phase & 0xFF];
            }
            break;
        }
        case 2:
        {
            if (phase & 0x100)
            {
                out = logSinTable[(phase & 0xFF) ^ 0xFF];
            }
            else
            {
                out = logSinTable[phase & 0xFF];
            }
            break;
        }
        case 3:
        {
            if (phase & 0x100)
            {
                out = 0x1000;
            }
            else
            {
                out = logSinTable[phase & 0xFF];
            }
            break;
        }
        case 4:
        {
            if ((phase & 0x300) == 0x100)
            {
                neg = 0xFFFF;
            }
            if (phase & 0x200)
            {
                out = 0x1000;
            }
            else if (phase & 0x80)
            {
                out = logSinTable[((phase ^ 0xFF) << 1) & 0xFF];
            }
            else
            {
                out = logSinTable[(phase << 1) & 0xFF];
            }
            break;
        }
        case 5:
        {
            if (phase & 0x200)
            {
                out = 0x1000;
            }
            else if (phase & 0x80)
            {
                out = logSinTable[((phase ^ 0xFF) << 1) & 0xFF];
            }
            else
            {
                out = logSinTable[(phase << 1) & 0xFF];
            }
            break;
        }
        case 6:
        {
            if (phase & 0x200)
            {
                neg = 0xFFFF;
            }
            break;
        }
        default:
        {
            if (phase & 0x200)
            {
                neg = 0xFFFF;
                phase = (uint16_t)((phase & 0x1FF) ^ 0x1FF);
            }
            out = (uint16_t)(phase << 3);
            break;
        }
    }

    return (int16_t)(operatorExpCalc(out + ((uint32_t)envelope << 3)) ^ neg);
}

static void operatorEnvelopeCalc(const Opal* chip, OpalOperator* op)
{
    uint8_t trem = op->tremoloEnable ? chip->tremoloLevel : 0;
    op->egOut = (uint16_t)(op->envelopeLevel + op->outputLevel + (op->egKsl >> kslShift[op->keyScaleReg]) + trem);

    uint8_t regRate = 0;
    uint8_t reset = 0;

    if (op->key && op->envelopeStage == OPAL_ENVELOPE_STAGE_RELEASE)
    {
        reset = 1;
        regRate = (uint8_t)op->attackRate;
    }
    else
    {
        switch (op->envelopeStage)
        {
            case OPAL_ENVELOPE_STAGE_ATTACK:
            {
                regRate = (uint8_t)op->attackRate;
                break;
            }
            case OPAL_ENVELOPE_STAGE_DECAY:
            {
                regRate = (uint8_t)op->decayRate;
                break;
            }
            case OPAL_ENVELOPE_STAGE_SUSTAIN:
            {
                if (!op->sustainMode)
                {
                    regRate = (uint8_t)op->releaseRate;
                }
                break;
            }
            case OPAL_ENVELOPE_STAGE_RELEASE:
            {
                regRate = (uint8_t)op->releaseRate;
                break;
            }
            default:
            {
                break;
            }
        }
    }

    op->phaseReset = reset;

    uint8_t ks = (uint8_t)(chip->chan[op->chanIndex].keyScaleNumber >> ((op->keyScaleRate ^ 1) << 1));
    uint8_t rate = (uint8_t)(ks + (regRate << 2));
    uint8_t rateHi = (uint8_t)(rate >> 2);
    uint8_t rateLo = (uint8_t)(rate & 3);
    if (rateHi & 0x10)
    {
        rateHi = 0x0F;
    }

    uint8_t egShift = (uint8_t)(rateHi + chip->egAdd);
    uint8_t shift = 0;
    if (regRate != 0)
    {
        if (rateHi < 12)
        {
            if (chip->egState)
            {
                switch (egShift)
                {
                    case 12:
                    {
                        shift = 1;
                        break;
                    }
                    case 13:
                    {
                        shift = (uint8_t)((rateLo >> 1) & 1);
                        break;
                    }
                    case 14:
                    {
                        shift = (uint8_t)(rateLo & 1);
                        break;
                    }
                    default:
                    {
                        break;
                    }
                }
            }
        }
        else
        {
            shift = (uint8_t)((rateHi & 3) + egIncStep[rateLo][chip->egTimerLo]);
            if (shift & 0x04)
            {
                shift = 0x03;
            }
            if (!shift)
            {
                shift = chip->egState;
            }
        }
    }

    uint16_t egRout = op->envelopeLevel;
    int16_t egInc = 0;
    uint8_t egOff = 0;

    if (reset && rateHi == 0x0F)
    {
        egRout = 0;
    }

    if ((op->envelopeLevel & 0x1F8) == 0x1F8)
    {
        egOff = 1;
    }

    if (op->envelopeStage != OPAL_ENVELOPE_STAGE_ATTACK && !reset && egOff)
    {
        egRout = 0x1FF;
    }

    switch (op->envelopeStage)
    {
        case OPAL_ENVELOPE_STAGE_ATTACK:
        {
            if (!egRout)
            {
                op->envelopeStage = OPAL_ENVELOPE_STAGE_DECAY;
            }
            else if (op->key && shift > 0 && rateHi != 0x0F)
            {
                egInc = (int16_t)(~egRout >> (4 - shift));
            }
            break;
        }
        case OPAL_ENVELOPE_STAGE_DECAY:
        {
            if ((egRout >> 4) == (op->sustainLevel >> 4))
            {
                op->envelopeStage = OPAL_ENVELOPE_STAGE_SUSTAIN;
            }
            else if (!egOff && !reset && shift > 0)
            {
                egInc = (int16_t)(1 << (shift - 1));
            }
            break;
        }
        case OPAL_ENVELOPE_STAGE_SUSTAIN:
        case OPAL_ENVELOPE_STAGE_RELEASE:
        {
            if (!egOff && !reset && shift > 0)
            {
                egInc = (int16_t)(1 << (shift - 1));
            }
            break;
        }
        default:
        {
            break;
        }
    }

    op->envelopeLevel = (uint16_t)((egRout + egInc) & 0x1FF);

    if (reset)
    {
        op->envelopeStage = OPAL_ENVELOPE_STAGE_ATTACK;
    }

    if (!op->key)
    {
        op->envelopeStage = OPAL_ENVELOPE_STAGE_RELEASE;
    }
}

static void operatorPhaseGenerate(Opal* chip, OpalOperator* op)
{
    const OpalChannel* chan = &chip->chan[op->chanIndex];
    uint16_t fNum = chan->freq;

    if (op->vibratoEnable)
    {
        int8_t range = (int8_t)((fNum >> 7) & 7);
        uint8_t vibPos = chip->vibPos;

        if (!(vibPos & 3))
        {
            range = 0;
        }
        else if (vibPos & 1)
        {
            range = (int8_t)(range >> 1);
        }
        range = (int8_t)(range >> chip->vibShift);

        if (vibPos & 4)
        {
            range = (int8_t)-range;
        }

        fNum = (uint16_t)(fNum + range);
    }

    uint32_t baseFreq = ((uint32_t)fNum << chan->octave) >> 1;
    uint16_t phase = (uint16_t)(op->phase >> 9);

    if (op->phaseReset)
    {
        op->phase = 0;
    }

    op->phase += (baseFreq * op->freqMultTimes2) >> 1;
    op->phaseOut = phase;

    if (op->slotIndex == 13)
    {
        chip->rmHhBit2 = (uint8_t)((phase >> 2) & 1);
        chip->rmHhBit3 = (uint8_t)((phase >> 3) & 1);
        chip->rmHhBit7 = (uint8_t)((phase >> 7) & 1);
        chip->rmHhBit8 = (uint8_t)((phase >> 8) & 1);
    }

    if (op->slotIndex == 17 && (chip->rhythmReg & 0x20))
    {
        chip->rmTcBit3 = (uint8_t)((phase >> 3) & 1);
        chip->rmTcBit5 = (uint8_t)((phase >> 5) & 1);
    }

    if (chip->rhythmReg & 0x20)
    {
        // clang-format off
        uint8_t rmXor = (uint8_t)((chip->rmHhBit2 ^ chip->rmHhBit7)
                                 | (chip->rmHhBit3 ^ chip->rmTcBit5)
                                 | (chip->rmTcBit3 ^ chip->rmTcBit5));
        // clang-format on
        uint32_t noise = chip->noise;

        switch (op->slotIndex)
        {
            case 13:
            {
                op->phaseOut = (uint16_t)(rmXor << 9);
                if (rmXor ^ (noise & 1))
                {
                    op->phaseOut |= 0xD0;
                }
                else
                {
                    op->phaseOut |= 0x34;
                }
                break;
            }
            case 16:
            {
                op->phaseOut = (uint16_t)((chip->rmHhBit8 << 9) | ((chip->rmHhBit8 ^ (noise & 1)) << 8));
                break;
            }
            case 17:
            {
                op->phaseOut = (uint16_t)((rmXor << 9) | 0x80);
                break;
            }
            default:
            {
                break;
            }
        }
    }

    uint32_t nBit = ((chip->noise >> 14) ^ chip->noise) & 1u;
    chip->noise = (chip->noise >> 1) | (nBit << 22);
}

static void operatorCalcFb(const Opal* chip, OpalOperator* op)
{
    uint16_t feedbackShift = chip->chan[op->chanIndex].feedbackShift;
    if (feedbackShift)
    {
        op->fbMod = (int16_t)((op->prevOut + op->out) >> feedbackShift);
    }
    else
    {
        op->fbMod = 0;
    }
    op->prevOut = op->out;
}

static void operatorGenerate(const Opal* chip, OpalOperator* op)
{
    int16_t mod = 0;
    if (op->modSource < OPAL_OPERATOR_COUNT)
    {
        mod = chip->op[op->modSource].out;
    }
    else if (op->modSource == OPAL_MOD_OWN_FB)
    {
        mod = op->fbMod;
    }
    uint16_t phase = (uint16_t)(op->phaseOut + mod);
    op->out = operatorWave(chip, op, phase, op->egOut);
}

static void operatorProcess(Opal* chip, OpalOperator* op)
{
    operatorCalcFb(chip, op);
    operatorEnvelopeCalc(chip, op);
    operatorPhaseGenerate(chip, op);
    operatorGenerate(chip, op);
}

static void operatorKeyOn(OpalOperator* op, uint8_t type)
{
    op->key |= type;
}

static void operatorKeyOff(OpalOperator* op, uint8_t type)
{
    op->key &= (uint8_t)~type;
}

static void channelUpdateOpsKsl(Opal* chip, const OpalChannel* chan)
{
    for (int i = 0; i < 2; i++)
    {
        if (chan->opSlot[i] != OPAL_OP_NONE)
        {
            operatorUpdateKsl(chip, &chip->op[chan->opSlot[i]]);
        }
    }
}

static void channelComputeKeyScaleNumber(Opal* chip, OpalChannel* chan)
{
    uint16_t lsb = chip->noteSel ? (uint16_t)((chan->freq >> 8) & 1) : (uint16_t)(chan->freq >> 9);
    chan->keyScaleNumber = (uint16_t)(chan->octave << 1 | lsb);
    channelUpdateOpsKsl(chip, chan);
}

static void channelSetupAlg(Opal* chip, OpalChannel* chan);

static void channelUpdateRhythm(Opal* self, uint8_t data)
{
    self->rhythmReg = (uint8_t)(data & 0x3F);
    self->rhythmMode = (data & 0x20) != 0;

    if (self->rhythmReg & 0x20)
    {
        OpalChannel* ch6 = &self->chan[6];
        OpalChannel* ch7 = &self->chan[7];
        OpalChannel* ch8 = &self->chan[8];

        ch6->outSource[0] = ch6->opSlot[1];
        ch6->outSource[1] = ch6->opSlot[1];
        ch6->outSource[2] = OPAL_OP_NONE;
        ch6->outSource[3] = OPAL_OP_NONE;
        ch7->outSource[0] = ch7->opSlot[0];
        ch7->outSource[1] = ch7->opSlot[0];
        ch7->outSource[2] = ch7->opSlot[1];
        ch7->outSource[3] = ch7->opSlot[1];
        ch8->outSource[0] = ch8->opSlot[0];
        ch8->outSource[1] = ch8->opSlot[0];
        ch8->outSource[2] = ch8->opSlot[1];
        ch8->outSource[3] = ch8->opSlot[1];

        for (int ch = 6; ch < 9; ch++)
        {
            self->chan[ch].chanType = OPAL_CHANNEL_TYPE_DRUM;
            channelSetupAlg(self, &self->chan[ch]);
        }

        if (self->rhythmReg & 0x01)
        {
            operatorKeyOn(&self->op[ch7->opSlot[0]], OPAL_KEY_DRUM);
        }
        else
        {
            operatorKeyOff(&self->op[ch7->opSlot[0]], OPAL_KEY_DRUM);
        }

        if (self->rhythmReg & 0x02)
        {
            operatorKeyOn(&self->op[ch8->opSlot[1]], OPAL_KEY_DRUM);
        }
        else
        {
            operatorKeyOff(&self->op[ch8->opSlot[1]], OPAL_KEY_DRUM);
        }

        if (self->rhythmReg & 0x04)
        {
            operatorKeyOn(&self->op[ch8->opSlot[0]], OPAL_KEY_DRUM);
        }
        else
        {
            operatorKeyOff(&self->op[ch8->opSlot[0]], OPAL_KEY_DRUM);
        }

        if (self->rhythmReg & 0x08)
        {
            operatorKeyOn(&self->op[ch7->opSlot[1]], OPAL_KEY_DRUM);
        }
        else
        {
            operatorKeyOff(&self->op[ch7->opSlot[1]], OPAL_KEY_DRUM);
        }

        if (self->rhythmReg & 0x10)
        {
            operatorKeyOn(&self->op[ch6->opSlot[0]], OPAL_KEY_DRUM);
            operatorKeyOn(&self->op[ch6->opSlot[1]], OPAL_KEY_DRUM);
        }
        else
        {
            operatorKeyOff(&self->op[ch6->opSlot[0]], OPAL_KEY_DRUM);
            operatorKeyOff(&self->op[ch6->opSlot[1]], OPAL_KEY_DRUM);
        }
    }
    else
    {
        for (int ch = 6; ch < 9; ch++)
        {
            OpalChannel* chan = &self->chan[ch];
            chan->chanType = OPAL_CHANNEL_TYPE_2OP;
            channelSetupAlg(self, chan);
            operatorKeyOff(&self->op[chan->opSlot[0]], OPAL_KEY_DRUM);
            operatorKeyOff(&self->op[chan->opSlot[1]], OPAL_KEY_DRUM);
        }
    }
}

static void channelWriteA0(Opal* chip, OpalChannel* chan, uint8_t data)
{
    if (chip->opl3Enabled && chan->chanType == OPAL_CHANNEL_TYPE_4OP2)
    {
        return;
    }

    chan->freq = (uint16_t)((chan->freq & 0x300) | data);
    channelComputeKeyScaleNumber(chip, chan);

    if (chip->opl3Enabled && chan->chanType == OPAL_CHANNEL_TYPE_4OP && chan->pairIndex != OPAL_CH_NONE)
    {
        OpalChannel* pair = &chip->chan[chan->pairIndex];
        pair->freq = chan->freq;
        pair->keyScaleNumber = chan->keyScaleNumber;
        channelUpdateOpsKsl(chip, pair);
    }
}

static void channelWriteB0(Opal* chip, OpalChannel* chan, uint8_t data)
{
    if (chip->opl3Enabled && chan->chanType == OPAL_CHANNEL_TYPE_4OP2)
    {
        return;
    }

    chan->freq = (uint16_t)((chan->freq & 0xFF) | ((data & 3) << 8));
    chan->octave = (uint16_t)((data >> 2) & 7);
    channelComputeKeyScaleNumber(chip, chan);

    if (chip->opl3Enabled && chan->chanType == OPAL_CHANNEL_TYPE_4OP && chan->pairIndex != OPAL_CH_NONE)
    {
        OpalChannel* pair = &chip->chan[chan->pairIndex];
        pair->freq = chan->freq;
        pair->octave = chan->octave;
        pair->keyScaleNumber = chan->keyScaleNumber;
        channelUpdateOpsKsl(chip, pair);
    }
}

static void channelSetupAlg(Opal* chip, OpalChannel* chan)
{
    OpalOperator* op0 = &chip->op[chan->opSlot[0]];
    OpalOperator* op1 = &chip->op[chan->opSlot[1]];

    if (chan->chanType == OPAL_CHANNEL_TYPE_DRUM)
    {
        if (chan->chanIndex == 7 || chan->chanIndex == 8)
        {
            op0->modSource = OPAL_OP_NONE;
            op1->modSource = OPAL_OP_NONE;
            return;
        }

        if ((chan->modulationType & 1) == 0)
        {
            op0->modSource = OPAL_MOD_OWN_FB;
            op1->modSource = chan->opSlot[0];
        }
        else
        {
            op0->modSource = OPAL_MOD_OWN_FB;
            op1->modSource = OPAL_OP_NONE;
        }
        return;
    }

    if (chan->alg & 0x08)
    {
        return;
    }

    if (chan->alg & 0x04)
    {
        OpalChannel* pair = &chip->chan[chan->pairIndex];
        OpalOperator* pairOp0 = &chip->op[pair->opSlot[0]];
        OpalOperator* pairOp1 = &chip->op[pair->opSlot[1]];
        pair->outSource[0] = OPAL_OP_NONE;
        pair->outSource[1] = OPAL_OP_NONE;
        pair->outSource[2] = OPAL_OP_NONE;
        pair->outSource[3] = OPAL_OP_NONE;

        switch (chan->alg & 0x03)
        {
            case 0:
            {
                pairOp0->modSource = OPAL_MOD_OWN_FB;
                pairOp1->modSource = pair->opSlot[0];
                op0->modSource = pair->opSlot[1];
                op1->modSource = chan->opSlot[0];
                chan->outSource[0] = chan->opSlot[1];
                chan->outSource[1] = OPAL_OP_NONE;
                chan->outSource[2] = OPAL_OP_NONE;
                chan->outSource[3] = OPAL_OP_NONE;
                break;
            }
            case 1:
            {
                pairOp0->modSource = OPAL_MOD_OWN_FB;
                pairOp1->modSource = pair->opSlot[0];
                op0->modSource = OPAL_OP_NONE;
                op1->modSource = chan->opSlot[0];
                chan->outSource[0] = pair->opSlot[1];
                chan->outSource[1] = chan->opSlot[1];
                chan->outSource[2] = OPAL_OP_NONE;
                chan->outSource[3] = OPAL_OP_NONE;
                break;
            }
            case 2:
            {
                pairOp0->modSource = OPAL_MOD_OWN_FB;
                pairOp1->modSource = OPAL_OP_NONE;
                op0->modSource = pair->opSlot[1];
                op1->modSource = chan->opSlot[0];
                chan->outSource[0] = pair->opSlot[0];
                chan->outSource[1] = chan->opSlot[1];
                chan->outSource[2] = OPAL_OP_NONE;
                chan->outSource[3] = OPAL_OP_NONE;
                break;
            }
            default:
            {
                pairOp0->modSource = OPAL_MOD_OWN_FB;
                pairOp1->modSource = OPAL_OP_NONE;
                op0->modSource = pair->opSlot[1];
                op1->modSource = OPAL_OP_NONE;
                chan->outSource[0] = pair->opSlot[0];
                chan->outSource[1] = chan->opSlot[0];
                chan->outSource[2] = chan->opSlot[1];
                chan->outSource[3] = OPAL_OP_NONE;
                break;
            }
        }
        return;
    }

    switch (chan->alg & 0x01)
    {
        case 0:
        {
            op0->modSource = OPAL_MOD_OWN_FB;
            op1->modSource = chan->opSlot[0];
            chan->outSource[0] = chan->opSlot[1];
            chan->outSource[1] = OPAL_OP_NONE;
            chan->outSource[2] = OPAL_OP_NONE;
            chan->outSource[3] = OPAL_OP_NONE;
            break;
        }
        default:
        {
            op0->modSource = OPAL_MOD_OWN_FB;
            op1->modSource = OPAL_OP_NONE;
            chan->outSource[0] = chan->opSlot[0];
            chan->outSource[1] = chan->opSlot[1];
            chan->outSource[2] = OPAL_OP_NONE;
            chan->outSource[3] = OPAL_OP_NONE;
            break;
        }
    }
}

static void channelUpdateAlg(Opal* chip, OpalChannel* chan)
{
    chan->alg = chan->modulationType;
    if (chip->opl3Enabled)
    {
        if (chan->chanType == OPAL_CHANNEL_TYPE_4OP)
        {
            OpalChannel* pair = &chip->chan[chan->pairIndex];
            pair->alg = (uint16_t)(0x04 | (chan->modulationType << 1) | pair->modulationType);
            chan->alg = (uint16_t)(0x08);
            channelSetupAlg(chip, pair);
        }
        else if (chan->chanType == OPAL_CHANNEL_TYPE_4OP2)
        {
            OpalChannel* pair = &chip->chan[chan->pairIndex];
            chan->alg = (uint16_t)(0x04 | (pair->modulationType << 1) | chan->modulationType);
            pair->alg = 0x08;
            channelSetupAlg(chip, chan);
        }
        else
        {
            channelSetupAlg(chip, chan);
        }
    }
    else
    {
        channelSetupAlg(chip, chan);
    }
}

static void channelWriteC0(Opal* chip, OpalChannel* chan, uint8_t data)
{
    chan->feedbackShift = (uint16_t)(((data & 0x0E) >> 1) ? (9 - ((data & 0x0E) >> 1)) : 0);
    chan->modulationType = (uint16_t)(data & 1);
    channelUpdateAlg(chip, chan);

    chan->cha = ((data >> 4) & 1) ? 0xFFFF : 0;
    chan->chb = ((data >> 5) & 1) ? 0xFFFF : 0;
    chan->chc = ((data >> 6) & 1) ? 0xFFFF : 0;
    chan->chd = ((data >> 7) & 1) ? 0xFFFF : 0;
}

static void channelKeyOn(Opal* chip, const OpalChannel* chan)
{
    if (chip->opl3Enabled)
    {
        if (chan->chanType == OPAL_CHANNEL_TYPE_4OP)
        {
            const OpalChannel* pair = &chip->chan[chan->pairIndex];
            operatorKeyOn(&chip->op[chan->opSlot[0]], OPAL_KEY_NORMAL);
            operatorKeyOn(&chip->op[chan->opSlot[1]], OPAL_KEY_NORMAL);
            operatorKeyOn(&chip->op[pair->opSlot[0]], OPAL_KEY_NORMAL);
            operatorKeyOn(&chip->op[pair->opSlot[1]], OPAL_KEY_NORMAL);
        }
        else if (chan->chanType == OPAL_CHANNEL_TYPE_2OP || chan->chanType == OPAL_CHANNEL_TYPE_DRUM)
        {
            operatorKeyOn(&chip->op[chan->opSlot[0]], OPAL_KEY_NORMAL);
            operatorKeyOn(&chip->op[chan->opSlot[1]], OPAL_KEY_NORMAL);
        }
    }
    else
    {
        operatorKeyOn(&chip->op[chan->opSlot[0]], OPAL_KEY_NORMAL);
        operatorKeyOn(&chip->op[chan->opSlot[1]], OPAL_KEY_NORMAL);
    }
}

static void channelKeyOff(Opal* chip, const OpalChannel* chan)
{
    if (chip->opl3Enabled)
    {
        if (chan->chanType == OPAL_CHANNEL_TYPE_4OP)
        {
            const OpalChannel* pair = &chip->chan[chan->pairIndex];
            operatorKeyOff(&chip->op[chan->opSlot[0]], OPAL_KEY_NORMAL);
            operatorKeyOff(&chip->op[chan->opSlot[1]], OPAL_KEY_NORMAL);
            operatorKeyOff(&chip->op[pair->opSlot[0]], OPAL_KEY_NORMAL);
            operatorKeyOff(&chip->op[pair->opSlot[1]], OPAL_KEY_NORMAL);
        }
        else if (chan->chanType == OPAL_CHANNEL_TYPE_2OP || chan->chanType == OPAL_CHANNEL_TYPE_DRUM)
        {
            operatorKeyOff(&chip->op[chan->opSlot[0]], OPAL_KEY_NORMAL);
            operatorKeyOff(&chip->op[chan->opSlot[1]], OPAL_KEY_NORMAL);
        }
    }
    else
    {
        operatorKeyOff(&chip->op[chan->opSlot[0]], OPAL_KEY_NORMAL);
        operatorKeyOff(&chip->op[chan->opSlot[1]], OPAL_KEY_NORMAL);
    }
}

static void channelSet4Op(Opal* self, uint8_t data)
{
    for (uint8_t bit = 0; bit < 6; bit++)
    {
        uint8_t chNum = bit;
        if (bit >= 3)
        {
            chNum = (uint8_t)(bit + 9 - 3);
        }

        OpalChannel* primary = &self->chan[chNum];
        OpalChannel* secondary = &self->chan[chNum + 3];

        if ((data >> bit) & 1)
        {
            primary->chanType = OPAL_CHANNEL_TYPE_4OP;
            secondary->chanType = OPAL_CHANNEL_TYPE_4OP2;
            primary->pairIndex = (uint8_t)(chNum + 3);
            channelUpdateAlg(self, primary);
        }
        else
        {
            primary->chanType = OPAL_CHANNEL_TYPE_2OP;
            secondary->chanType = OPAL_CHANNEL_TYPE_2OP;
            channelUpdateAlg(self, primary);
            channelUpdateAlg(self, secondary);
        }
    }
}

static int32_t channelAccumOutput(const Opal* chip, const OpalChannel* chan)
{
    int32_t accm = 0;
    for (int i = 0; i < 4; i++)
    {
        if (chan->outSource[i] != OPAL_OP_NONE)
        {
            accm += chip->op[chan->outSource[i]].out;
        }
    }
    return accm;
}

static int32_t channelMix(const Opal* chip, const OpalChannel* chan, uint16_t enable)
{
    if (!chip->opl3Enabled)
    {
        if (chan->chanIndex >= 9)
        {
            return 0;
        }
        enable = 0xFFFF;
    }

    int32_t accm = channelAccumOutput(chip, chan);
    return (int32_t)((int16_t)(accm & (int16_t)enable));
}

static void opalRefreshNew(Opal* self)
{
    for (int i = 0; i < OPAL_CHANNEL_COUNT; i++)
    {
        channelUpdateAlg(self, &self->chan[i]);
    }
}

static void opalTickTimer(Opal* self, int t)
{
    if (!(self->timerControl & (1u << t)))
    {
        return;
    }
    if (++self->timerCount[t] > 0xFF)
    {
        self->timerCount[t] = self->timer[t];
        self->status |= (uint8_t)(0x40 >> t);
        if (!(self->timerControl & (uint8_t)(0x40 >> t)))
        {
            self->status |= 0x80;
        }
    }
}

static void opalAdvanceLfos(Opal* self)
{
    if ((self->chipTimer & 0x3F) == 0x3F)
    {
        self->tremoloPos = (uint8_t)((self->tremoloPos + 1) % 210);
    }

    if (self->tremoloPos < 105)
    {
        self->tremoloLevel = (uint8_t)(self->tremoloPos >> self->tremoloShift);
    }
    else
    {
        self->tremoloLevel = (uint8_t)((210 - self->tremoloPos) >> self->tremoloShift);
    }

    if ((self->chipTimer & 0x3FF) == 0x3FF)
    {
        self->vibPos = (uint8_t)((self->vibPos + 1) & 7);
    }

    self->chipTimer++;

    if (self->egState)
    {
        uint8_t shift = 0;
        while (shift < 13 && ((self->egTimer >> shift) & 1) == 0)
        {
            shift++;
        }
        self->egAdd = (uint8_t)(shift > 12 ? 0 : shift + 1);
        self->egTimerLo = (uint8_t)(self->egTimer & 3u);
    }

    if (self->egTimerRem || self->egState)
    {
        if (self->egTimer == UINT64_C(0xFFFFFFFFF))
        {
            self->egTimer = 0;
            self->egTimerRem = 1;
        }
        else
        {
            self->egTimer++;
            self->egTimerRem = 0;
        }
    }

    self->egState ^= 1;
}

static void opalOutput(Opal* self, int16_t* left, int16_t* right)
{
    int32_t leftMix = 0;
    int32_t rightMix = 0;
    int i;

    /* YMF262 right channel is one sample behind left (mixbuff quirk). */
    *right = opalClipSample(self->mixBuffRight);

    // YMF262 slot pipeline: slots 0-14, mix left (cha), slots 15-32, mix right (chb), slots 33-35.
    for (i = 0; i < 15; i++)
    {
        operatorProcess(self, &self->op[i]);
    }

    for (i = 0; i < OPAL_CHANNEL_COUNT; i++)
    {
        OpalChannel* chan = &self->chan[i];
        int32_t cha = channelMix(self, chan, chan->cha);
        leftMix += (cha * chan->leftPan) >> 8;
    }

    for (i = 15; i < 18; i++)
    {
        operatorProcess(self, &self->op[i]);
    }

    for (i = 18; i < 33; i++)
    {
        operatorProcess(self, &self->op[i]);
    }

    for (i = 0; i < OPAL_CHANNEL_COUNT; i++)
    {
        OpalChannel* chan = &self->chan[i];
        int32_t chb = channelMix(self, chan, chan->chb);
        rightMix += (chb * chan->rightPan) >> 8;
    }

    for (i = 33; i < OPAL_OPERATOR_COUNT; i++)
    {
        operatorProcess(self, &self->op[i]);
    }

    *left = opalClipSample(leftMix);
    self->mixBuffRight = rightMix;

    opalAdvanceLfos(self);

    if ((self->chipTimer & 3) == 0)
    {
        opalTickTimer(self, 0);
    }
    if ((self->chipTimer & 15) == 0)
    {
        opalTickTimer(self, 1);
    }

    OpalWriteBuf* wb;
    while ((wb = &self->writeBuf[self->writeBufCur]), (wb->reg & 0x200) && wb->time <= self->writeBufSampleCount)
    {
        opalWriteReg(self, wb->reg & 0x1FF, wb->data);
        wb->reg = 0;
        self->writeBufCur = (self->writeBufCur + 1) % OPAL_WRITEBUF_SIZE;
    }
    self->writeBufSampleCount++;
}

void opalSample(Opal* self, int16_t* left, int16_t* right)
{
    while (self->sampleAccum >= self->sampleRate)
    {
        self->lastOutput[0] = self->currOutput[0];
        self->lastOutput[1] = self->currOutput[1];
        opalOutput(self, &self->currOutput[0], &self->currOutput[1]);
        self->sampleAccum -= self->sampleRate;
    }

    int32_t fract = (int32_t)(((int64_t)self->sampleAccum * 65536 + self->sampleRate / 2) / self->sampleRate);
    *left = opalInterpolate(self->lastOutput[0], self->currOutput[0], fract);
    *right = opalInterpolate(self->lastOutput[1], self->currOutput[1], fract);

    self->sampleAccum += OPAL_OPL3_SAMPLE_RATE;
}

void opalSetSampleRate(Opal* self, int sampleRate)
{
    if (sampleRate <= 0)
    {
        sampleRate = OPAL_OPL3_SAMPLE_RATE;
    }

    self->sampleRate = sampleRate;
    self->sampleAccum = 0;
    self->lastOutput[0] = self->lastOutput[1] = 0;
    self->currOutput[0] = self->currOutput[1] = 0;
    self->mixBuffRight = 0;
    self->writeBufSampleCount = 0;
    self->writeBufCur = 0;
    self->writeBufLast = 0;
    self->writeBufLastTime = 0;

    for (uint32_t i = 0; i < OPAL_WRITEBUF_SIZE; i++)
    {
        self->writeBuf[i].reg = 0;
    }
}

uint8_t opalReadStatus(Opal* self)
{
    return self->status;
}

void opalInit(Opal* self, int sampleRate)
{
    memset(self, 0, sizeof *self);

    for (int i = 0; i < OPAL_OPERATOR_COUNT; i++)
    {
        OpalOperator* op = &self->op[i];
        op->slotIndex = (uint8_t)i;
        op->freqMultTimes2 = 1;
        op->envelopeStage = OPAL_ENVELOPE_STAGE_RELEASE;
        op->envelopeLevel = 0x1FF;
        op->egOut = 0x1FF;
        op->modSource = OPAL_OP_NONE;
    }

    for (int i = 0; i < OPAL_CHANNEL_COUNT; i++)
    {
        OpalChannel* chan = &self->chan[i];
        chan->chanIndex = (uint8_t)i;
        chan->chanType = OPAL_CHANNEL_TYPE_2OP;
        chan->leftPan = 256;
        chan->rightPan = 256;

        if ((i % 9) < 3)
        {
            chan->pairIndex = (uint8_t)(i + 3);
        }
        else if ((i % 9) < 6)
        {
            chan->pairIndex = (uint8_t)(i - 3);
        }
        else
        {
            chan->pairIndex = OPAL_CH_NONE;
        }

        uint8_t slot = chSlot[i];
        chan->opSlot[0] = slot;
        chan->opSlot[1] = (uint8_t)(slot + 3);
        self->op[slot].chanIndex = (uint8_t)i;
        self->op[slot + 3].chanIndex = (uint8_t)i;

        if (i < 3 || (i >= 9 && i < 12))
        {
            chan->opSlot[2] = (uint8_t)(slot + 6);
            chan->opSlot[3] = (uint8_t)(slot + 9);
            self->op[slot + 6].chanIndex = (uint8_t)i;
            self->op[slot + 9].chanIndex = (uint8_t)i;
        }
        else
        {
            chan->opSlot[2] = OPAL_OP_NONE;
            chan->opSlot[3] = OPAL_OP_NONE;
        }

        channelSetupAlg(self, chan);
    }

    self->noise = 1;
    self->tremoloShift = 4;
    self->vibShift = 1;

    opalSetSampleRate(self, sampleRate);
}

void opalWriteRegBuffered(Opal* self, uint16_t regNum, uint8_t val)
{
    uint32_t writeBufLast = self->writeBufLast;
    uint32_t next = (writeBufLast + 1) % OPAL_WRITEBUF_SIZE;

    if (next == self->writeBufCur)
    {
        opalFlushWriteBuf(self);
        writeBufLast = self->writeBufLast;
        next = (writeBufLast + 1) % OPAL_WRITEBUF_SIZE;
    }

    OpalWriteBuf* wb = &self->writeBuf[writeBufLast];

    if (wb->reg & 0x200)
    {
        opalWriteReg(self, wb->reg & 0x1FF, wb->data);
        self->writeBufCur = (writeBufLast + 1) % OPAL_WRITEBUF_SIZE;
        self->writeBufSampleCount = wb->time;
    }

    wb->reg = (uint16_t)(regNum | 0x200);
    wb->data = val;

    uint64_t time1 = self->writeBufLastTime + OPAL_WRITEBUF_DELAY;
    uint64_t time2 = self->writeBufSampleCount;
    if (time1 < time2)
    {
        time1 = time2;
    }

    wb->time = time1;
    self->writeBufLastTime = time1;
    self->writeBufLast = (writeBufLast + 1) % OPAL_WRITEBUF_SIZE;
}

void opalFlushWriteBuf(Opal* self)
{
    uint32_t idx = self->writeBufCur;
    while (idx != self->writeBufLast)
    {
        OpalWriteBuf* wb = &self->writeBuf[idx];
        if (wb->reg & 0x200)
        {
            opalWriteReg(self, wb->reg & 0x1FF, wb->data);
            wb->reg = 0;
        }
        idx = (idx + 1) % OPAL_WRITEBUF_SIZE;
    }
    self->writeBufCur = self->writeBufLast;
    self->writeBufLastTime = self->writeBufSampleCount;
}

void opalWriteReg(Opal* self, uint16_t regNum, uint8_t val)
{
    if (!self->opl3Enabled && (regNum & 0x100) != 0 && (regNum & 0x1FF) != 0x105)
    {
        /* YMF262: NEW=0 ignores A1 except register 105h. */
        regNum &= 0xFF;
    }

    uint8_t high = (uint8_t)((regNum >> 8) & 1);
    uint8_t regm = (uint8_t)(regNum & 0xFF);

    if (regm == 0xBD && !high)
    {
        self->tremoloShift = (uint8_t)((((val >> 7) ^ 1) << 1) + 2);
        self->vibShift = (uint8_t)(((val >> 6) & 1) ^ 1);
        channelUpdateRhythm(self, val);
        return;
    }

    switch (regm & 0xF0)
    {
        case 0x00:
        {
            if (high)
            {
                switch (regm & 0x0F)
                {
                    case 0x04:
                    {
                        channelSet4Op(self, val);
                        break;
                    }
                    case 0x05:
                    {
                        bool enabled = (val & 1) != 0;
                        if (self->opl3Enabled != enabled)
                        {
                            self->opl3Enabled = enabled;
                            opalRefreshNew(self);
                        }
                        break;
                    }
                }
            }
            else
            {
                switch (regm & 0x0F)
                {
                    case 0x01:
                    {
                        self->waveformSelect = (val & 0x20) != 0;
                        break;
                    }
                    case 0x02:
                    {
                        self->timer[0] = val;
                        break;
                    }
                    case 0x03:
                    {
                        self->timer[1] = val;
                        break;
                    }
                    case 0x04:
                    {
                        if (val & 0x80)
                        {
                            self->status = 0;
                        }
                        else
                        {
                            uint8_t prev = self->timerControl;
                            self->timerControl = val;
                            if ((val & 1) && !(prev & 1))
                            {
                                self->timerCount[0] = self->timer[0];
                            }
                            if ((val & 2) && !(prev & 2))
                            {
                                self->timerCount[1] = self->timer[1];
                            }
                        }
                        break;
                    }
                    case 0x08:
                    {
                        self->noteSel = (val & 0x40) != 0;
                        self->compositeSineWave = (val & 0x80) != 0;
                        break;
                    }
                }
            }
            break;
        }
        case 0x20:
        case 0x30:
        {
            int8_t slot = adSlot[regm & 0x1F];
            if (slot < 0)
            {
                break;
            }
            OpalOperator* op = &self->op[18 * high + slot];
            op->tremoloEnable = (val & 0x80) != 0;
            op->vibratoEnable = (val & 0x40) != 0;
            op->sustainMode = (val & 0x20) != 0;
            op->keyScaleRate = (val & 0x10) != 0;
            op->freqMultTimes2 = mulTimes2[val & 15];
            break;
        }
        case 0x40:
        case 0x50:
        {
            int8_t slot = adSlot[regm & 0x1F];
            if (slot < 0)
            {
                break;
            }
            OpalOperator* op = &self->op[18 * high + slot];
            op->keyScaleReg = (uint8_t)((val >> 6) & 3);
            op->outputLevel = (uint16_t)((val & 0x3F) << 2);
            operatorUpdateKsl(self, op);
            break;
        }
        case 0x60:
        case 0x70:
        {
            int8_t slot = adSlot[regm & 0x1F];
            if (slot < 0)
            {
                break;
            }
            OpalOperator* op = &self->op[18 * high + slot];
            op->attackRate = (uint16_t)(val >> 4);
            op->decayRate = (uint16_t)(val & 15);
            break;
        }
        case 0x80:
        case 0x90:
        {
            int8_t slot = adSlot[regm & 0x1F];
            if (slot < 0)
            {
                break;
            }
            OpalOperator* op = &self->op[18 * high + slot];
            op->sustainLevel = (uint16_t)(((val >> 4) < 15 ? (val >> 4) : 31) << 4);
            op->releaseRate = (uint16_t)(val & 15);
            break;
        }
        case 0xE0:
        case 0xF0:
        {
            int8_t slot = adSlot[regm & 0x1F];
            if (slot < 0)
            {
                break;
            }
            OpalOperator* op = &self->op[18 * high + slot];
            op->waveform = (uint16_t)(val & 7);
            break;
        }
        case 0xA0:
        {
            if ((regm & 0x0F) < 9)
            {
                channelWriteA0(self, &self->chan[9 * high + (regm & 0x0F)], val);
            }
            break;
        }
        case 0xB0:
        {
            if ((regm & 0x0F) < 9)
            {
                OpalChannel* chan = &self->chan[9 * high + (regm & 0x0F)];
                channelWriteB0(self, chan, val);
                if (val & 0x20)
                {
                    channelKeyOn(self, chan);
                }
                else
                {
                    channelKeyOff(self, chan);
                }
            }
            break;
        }
        case 0xC0:
        {
            if ((regm & 0x0F) < 9)
            {
                channelWriteC0(self, &self->chan[9 * high + (regm & 0x0F)], val);
            }
            break;
        }
    }
}

void opalPan(Opal* self, uint16_t channel, uint8_t pan)
{
    uint16_t chanNum = (uint16_t)((channel & 0xFF) + ((channel & 0x100) ? 9 : 0));
    if (chanNum >= OPAL_CHANNEL_COUNT)
    {
        return;
    }

    OpalChannel* chan = &self->chan[chanNum];
    chan->leftPan = (uint16_t)(pan <= 64 ? 256 : (256 * (127 - pan)) / 63);
    chan->rightPan = (uint16_t)(pan >= 64 ? 256 : (256 * pan) / 64);
}
