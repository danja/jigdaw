// bin/write-loops.js
//
// Writes web/loops/index.json, the starter MIDI loops the Loops dialog offers (docs/learning-curve.md, "Loops"). Generated from the patterns
// below, so a loop is read and changed here in a notation a musician can follow, and the data file is never edited by hand.
//
// Every pattern is original and generic: a groove or a progression of the kind that has no author. They are offered under CC0-1.0, which each
// loop says, so a person can use them in a piece they publish without asking. Nothing is sampled from any recording or loop library.
//
// Notation. A drum or a bass pattern is a string of sixteenth-note steps, sixteen to a bar: `x` a hit, `X` an accented hit, `o` a quiet one, `.`
// nothing. A pitched pattern lists `[step, pitch, steps, velocity]`; a chord lists `[beat, [pitches], beats]`. Pitches are MIDI numbers in C
// (minor where it matters), middle C is 60, because the host has no project key to move them to yet; the piano roll transposes a clip. A loop
// says its key when it has one, and a set of loops its tempo.
//
// A pattern made by rules is computed here and written out as notes: the file holds one fixed result, made with a seeded random so that a rule
// that drops a few hits "at random" drops the same hits every time the file is generated.
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { euclid } from '../src/model/Euclidean.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STEP = 0.25
const LICENCE = 'CC0-1.0'

// General MIDI drum notes.
const KICK = 36
const RIM = 37
const SNARE = 38
const CLAP = 39
const HAT = 42
const OPEN_HAT = 46

const VELOCITY = { x: 100, X: 120, o: 64 }

function drums (id, label, about, bars, rows) {
  const notes = []
  for (const [pitch, pattern] of rows) {
    const steps = pattern.replace(/\s+/g, '')
    if (steps.length !== 16 * bars) throw new Error(`${id}: pitch ${pitch} has ${steps.length} steps, wanted ${16 * bars}`)
    ;[...steps].forEach((c, i) => { if (c !== '.') notes.push({ startBeat: i * STEP, lengthBeats: STEP, pitch, velocity: VELOCITY[c] }) })
  }
  return { id, label, kind: 'drums', lengthBeats: 4 * bars, about, licence: LICENCE, notes }
}

function line (id, label, kind, about, bars, parts, key = 'C minor') {
  const notes = parts.map(([step, pitch, steps, velocity = 96]) => ({ startBeat: step * STEP, lengthBeats: steps * STEP, pitch, velocity }))
  return { id, label, kind, key, lengthBeats: 4 * bars, about, licence: LICENCE, notes }
}

function chords (id, label, about, bars, parts, key = 'C minor') {
  const notes = parts.flatMap(([beat, pitches, beats]) => pitches.map(pitch => ({ startBeat: beat, lengthBeats: beats, pitch, velocity: 80 })))
  return { id, label, kind: 'chords', key, lengthBeats: 4 * bars, about, licence: LICENCE, notes }
}

/** A small seeded random number generator (mulberry32): the same seed gives the same run of numbers. */
function seeded (seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Deep house that writes itself: four Euclidean rules and no written notes, over Am7 Fmaj7 Dm7 Em7, a bar each, at 120 BPM. The chords are the one
// thing written; every other part is a rule applied to them. Rules are `E(pulses, 16)` rotated by some steps, the way a sequencer with Euclidean
// rhythms spells them, and a rule that drops hits drops them from a seeded random.
const DEEP_HOUSE = { bpm: 120, key: 'A minor', bars: 4, seed: 120 }
const DEEP_CHORDS = [
  { name: 'Am7', roots: [33, 45], voicing: [57, 60, 64, 67] },
  { name: 'Fmaj7', roots: [29, 41], voicing: [53, 57, 60, 64] },
  { name: 'Dm7', roots: [38, 50], voicing: [53, 57, 60, 62] },
  { name: 'Em7', roots: [40, 52], voicing: [55, 59, 62, 64] }
]

/** The steps a rule fires on in one bar, as the numbers of the sixteenth steps, with each dropped with the chance `drop`. */
function fires (rule, random) {
  const steps = euclid(rule.pulses, 16, rule.rotation ?? 0)
  return steps.flatMap((on, i) => (on && !(rule.drop && random() < rule.drop) ? [i] : []))
}

function deepHouse () {
  const random = seeded(DEEP_HOUSE.seed)
  const beat = (bar, step) => bar * 4 + step * STEP
  // A note near the end of the loop is cut at the end of it, so the loop repeats cleanly and nothing rings into the next pass.
  const room = (start, length) => Math.min(length, 4 * DEEP_HOUSE.bars - start)
  const drumRules = [
    { pitch: KICK, pulses: 4, velocity: 120 },
    { pitch: CLAP, pulses: 2, rotation: 4, velocity: 100 },
    { pitch: OPEN_HAT, pulses: 4, rotation: 2, velocity: 76 },
    { pitch: HAT, pulses: 9, drop: 0.2, velocity: 80 }
  ]
  const drumNotes = []
  const bassNotes = []
  const stabNotes = []
  const padNotes = []
  for (let bar = 0; bar < DEEP_HOUSE.bars; bar++) {
    const chord = DEEP_CHORDS[bar % DEEP_CHORDS.length]
    for (const rule of drumRules) {
      for (const step of fires(rule, random)) drumNotes.push({ startBeat: beat(bar, step), lengthBeats: STEP, pitch: rule.pitch, velocity: rule.velocity })
    }
    // Bass: E(5,16) rotated by 2, the root of the chord on each hit, in either of two octaves, 5% of hits dropped.
    for (const step of fires({ pulses: 5, rotation: 2, drop: 0.05 }, random)) {
      bassNotes.push({ startBeat: beat(bar, step), lengthBeats: room(beat(bar, step), 0.4), pitch: chord.roots[random() < 0.5 ? 0 : 1], velocity: 104 })
    }
    // Stabs: E(4,16) rotated by 3, the whole chord on each hit.
    for (const step of fires({ pulses: 4, rotation: 3 }, random)) {
      for (const pitch of chord.voicing) stabNotes.push({ startBeat: beat(bar, step), lengthBeats: room(beat(bar, step), 0.5), pitch, velocity: 84 })
    }
    // Pad: the only written part, each chord held for its bar.
    for (const pitch of chord.voicing) padNotes.push({ startBeat: beat(bar, 0), lengthBeats: 4, pitch, velocity: 64 })
  }
  const common = { bpm: DEEP_HOUSE.bpm, lengthBeats: 4 * DEEP_HOUSE.bars, licence: LICENCE }
  // Track levels that balance the four parts on the instruments the host gives them and leave the master room to add them, set from measured
  // peaks (docs/learning-curve.md). The first try balanced the parts and clipped the master, because four balanced parts still add.
  const gains = { drums: 0.5, bass: 0.5, stabs: 0.3, pad: 0.22 }
  const loops = [
    { id: 'deep-house-drums', label: 'Deep house drums', kind: 'drums', gain: gains.drums, ...common, about: 'Kick on every beat, clap on two and four, open hat on the offbeats, and a busy hat with a fifth of its hits missing: four rules, no written notes.', notes: drumNotes },
    { id: 'deep-house-bass', label: 'Deep house bass', kind: 'bass', voice: 'quartet', key: DEEP_HOUSE.key, gain: gains.bass, ...common, about: 'Five hits a bar, each the root of the chord of that bar in one of two octaves: a rubbery bass line that follows Am7, Fmaj7, Dm7 and Em7.', notes: bassNotes },
    { id: 'deep-house-stabs', label: 'Deep house stabs', kind: 'chords', key: DEEP_HOUSE.key, gain: gains.stabs, ...common, about: 'The whole chord struck on four offbeat hits a bar, for an electric piano.', notes: stabNotes },
    { id: 'deep-house-pad', label: 'Deep house pad', kind: 'chords', key: DEEP_HOUSE.key, gain: gains.pad, ...common, about: 'Each chord held for its bar, for strings: the one part that is written and not made by a rule.', notes: padNotes }
  ]
  const set = {
    id: 'deep-house',
    label: 'Deep house that writes itself',
    about: 'Four rules and no written notes, over four chords: drums, bass and stabs follow the chords while a pad holds them. Add a delay on the stabs, a ping-pong at a dotted eighth, for the rest of the sound.',
    bpm: DEEP_HOUSE.bpm,
    key: DEEP_HOUSE.key,
    licence: LICENCE,
    loops: loops.map(l => l.id)
  }
  return { loops, set }
}

const written = [
  drums('four-on-the-floor', 'Four on the floor', 'A house beat: a kick on every beat, a clap on two and four, open hats between.', 1, [
    [KICK, 'X...X...X...X...'], [CLAP, '....x.......x...'], [OPEN_HAT, '..o...o...o...o.']
  ]),
  drums('rock-beat', 'Rock beat', 'Kick on one and the and of three, snare on two and four, eighth-note hats.', 1, [
    [KICK, 'X.......x.x.....'], [SNARE, '....X.......X...'], [HAT, 'x.x.x.x.x.x.x.x.']
  ]),
  drums('boom-bap', 'Boom bap', 'A hip hop groove: a lazy kick, a hard snare on two and four, busy hats.', 1, [
    [KICK, 'X.....x...x.....'], [SNARE, '....X.......X...'], [HAT, 'x.x.x.x.x.x.x.xo']
  ]),
  drums('half-time', 'Half time', 'The snare waits for beat three, so everything feels slower than the tempo.', 1, [
    [KICK, 'X...............'], [SNARE, '........X.......'], [HAT, 'x.x.x.x.x.x.x.x.']
  ]),
  drums('breakbeat', 'Breakbeat', 'A syncopated break: kicks and snares fall off the beat.', 1, [
    [KICK, 'X..x..x...x.....'], [SNARE, '....X.......X..o'], [HAT, 'x.x.x.x.x.x.x.x.'], [RIM, '.......o........']
  ]),

  line('root-and-fifth', 'Root and fifth', 'bass', 'Eighth notes on C, with the fifth below the octave lifting the end of each half bar.', 1, [
    [0, 36, 2], [2, 36, 2], [4, 43, 2], [6, 36, 2], [8, 36, 2], [10, 36, 2], [12, 43, 2], [14, 39, 2]
  ]),
  line('walking-line', 'Walking line', 'bass', 'Quarter notes climbing through C minor and back down over two bars.', 2, [
    [0, 36, 4], [4, 39, 4], [8, 41, 4], [12, 43, 4], [16, 44, 4], [20, 43, 4], [24, 41, 4], [28, 39, 4]
  ]),
  line('offbeat-bass', 'Offbeat bass', 'bass', 'A single note on the offbeats, the other half of Four on the floor.', 1, [
    [2, 36, 2], [6, 36, 2], [10, 36, 2], [14, 36, 2]
  ], 'C'),
  line('funk-bass', 'Funk bass', 'bass', 'Short, bouncing notes with gaps, leaning on the one.', 1, [
    [0, 36, 2, 112], [3, 36, 1], [6, 39, 2], [8, 43, 1, 104], [10, 41, 2], [13, 39, 1], [14, 36, 2]
  ]),

  chords('minor-four-chords', 'Minor four chords', 'C minor, A flat, E flat, B flat: a bar of each, the sound of a thousand songs.', 4, [
    [0, [60, 63, 67], 4], [4, [56, 60, 63], 4], [8, [63, 67, 70], 4], [12, [58, 62, 65], 4]
  ]),
  chords('pop-four-chords', 'Pop four chords', 'C, G, A minor, F: a bar of each, bright and familiar.', 4, [
    [0, [60, 64, 67], 4], [4, [55, 59, 62], 4], [8, [57, 60, 64], 4], [12, [53, 57, 60], 4]
  ], 'C major'),
  line('slow-arpeggio', 'Slow arpeggio', 'chords', 'A C minor chord spelled out in eighth notes, up and then down, over two bars.', 2, [
    [0, 60, 2], [2, 63, 2], [4, 67, 2], [6, 72, 2], [8, 67, 2], [10, 63, 2], [12, 60, 2], [14, 55, 2],
    [16, 56, 2], [18, 60, 2], [20, 63, 2], [22, 68, 2], [24, 63, 2], [26, 60, 2], [28, 56, 2], [30, 51, 2]
  ]),

  line('simple-riff', 'Simple riff', 'melody', 'A C minor pentatonic riff that answers itself over two bars.', 2, [
    [0, 67, 2], [2, 70, 2], [4, 72, 4], [8, 70, 2], [10, 67, 2], [12, 63, 4],
    [16, 67, 2], [18, 70, 2], [20, 74, 4], [24, 72, 2], [26, 70, 2], [28, 67, 4]
  ]),
  line('rising-phrase', 'Rising phrase', 'melody', 'Step by step up the C minor scale, then a pause on the top note.', 2, [
    [0, 60, 2], [2, 62, 2], [4, 63, 2], [6, 65, 2], [8, 67, 2], [10, 68, 2], [12, 70, 2], [14, 72, 2], [16, 72, 12]
  ]),
  line('call-and-answer', 'Call and answer', 'melody', 'Four bars: a short question, then the answer that comes home to C.', 4, [
    [0, 67, 2], [2, 70, 2], [4, 72, 6], [12, 70, 2], [14, 67, 2],
    [16, 65, 2], [18, 68, 2], [20, 70, 6], [28, 68, 2], [30, 65, 2],
    [32, 67, 2], [34, 70, 2], [36, 72, 6], [44, 74, 2], [46, 72, 2],
    [48, 70, 4], [52, 67, 4], [56, 63, 4], [60, 60, 4]
  ])
]

const deep = deepHouse()
const loops = [...written, ...deep.loops]
const sets = [deep.set]

const ids = loops.map(l => l.id)
if (new Set(ids).size !== ids.length) throw new Error('two loops share an id')
for (const set of sets) {
  for (const id of set.loops) if (!ids.includes(id)) throw new Error(`set ${set.id} names ${id}, which is not a loop`)
}
for (const loop of loops) {
  for (const note of loop.notes) {
    if (note.startBeat + note.lengthBeats > loop.lengthBeats + 1e-9) throw new Error(`${loop.id}: a note runs past the end of the loop`)
  }
}

mkdirSync(resolve(root, 'web/loops'), { recursive: true })
writeFileSync(resolve(root, 'web/loops/index.json'), `${JSON.stringify({
  generated: 'bin/write-loops.js',
  note: 'Generated from the patterns in bin/write-loops.js. Do not edit; run npm run build:loops. Every loop is original and offered under CC0-1.0.',
  licence: LICENCE,
  loops,
  sets
}, null, 2)}\n`)
console.log(`web/loops/index.json: ${loops.length} loops (${[...new Set(loops.map(l => l.kind))].join(', ')}) and ${sets.length} set${sets.length === 1 ? '' : 's'}`)
