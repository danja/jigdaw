// src/reel/Examples.js
//
// The example scripts the Reel page offers as starting points. Each one names the bundled piece it was written
// against, because a script addresses the plugins already in a piece by the slug of their label
// (src/reel/Host.js), so an example only means something on its own piece.
//
// tests/reel/Examples.test.js parses and plans every example against that piece's real plugin profiles, so an
// example cannot name a parameter that is not there or a value outside its range, and checks that between
// them the examples use every kind of statement Reel has.

export const EXAMPLES = Object.freeze([
  {
    id: 'open-the-filter',
    title: 'Open the filter',
    piece: 'acid.ttl',
    about: 'The bass starts muffled and sharp, then the filter opens over eight bars.',
    source: `# Acid. "filter" is the Squelch after the bass synth.
# Start it closed with a sharp resonance, then open it slowly.
filter.cutoff = 200Hz
filter.resonance = 80%
ramp filter.cutoff 200Hz -> 6kHz over 8 bars
`
  },
  {
    id: 'random-cutoff',
    title: 'A new cutoff every bar',
    piece: 'acid.ttl',
    about: 'The filter jumps to a different setting on every bar line, and the envelope decay wanders.',
    source: `# "seed" makes the random choices repeat, so the same script plays the same way.
seed 3
every 1 bar: filter.cutoff = pick(300Hz, 500Hz, 900Hz, 1800Hz, 3600Hz)
every 2 bars: filter.decay = rand(60ms, 600ms)
`
  },
  {
    id: 'change-the-drums',
    title: 'Change the drums',
    piece: 'acid.ttl',
    about: 'The drum machine gets busier and sparser bar by bar, and swaps style every four bars.',
    source: `# beats.genre: 0 Rock, 3 Electro, 5 Motorik, 8 Breakbeat.
every 1 bar: beats.density = rand(0.35, 0.9)
every 4 bars: beats.genre = pick(0, 3, 5, 8)
every 4 bars: beats.seed = round(rand(1, 999))
`
  },
  {
    id: 'bass-moods',
    title: 'Bass moods',
    piece: 'acid.ttl',
    about: 'The bass line changes scale every four bars and its note density breathes in and out.',
    source: `# bass_line.scale: 2 Minor, 6 Phrygian, 14 Pentatonic Minor.
# bass_line.genre 1 is Acid.
bass_line.genre = 1
every 4 bars: bass_line.scale = pick(2, 6, 14)
every 2 bars: bass_line.density = rand(0.3, 0.8)
`
  },
  {
    id: 'a-short-set',
    title: 'A short set',
    piece: 'acid.ttl',
    about: 'Twenty bars with a plan: open the filter, close it, switch the drums and bass to Electro, then open it again harder.',
    source: `# A position is BAR:BEAT, counted from 1 at the start of the piece.
# Press Stop, then Play, and run this from the top.
seed 11
let low = 250Hz
let high = 5kHz

at 1:1 filter.resonance = 70%
at 1:1 ramp filter.cutoff low -> high over 8 bars
at 9:1 ramp filter.cutoff high -> low over 4 bars
at 13:1 beats.genre = 3
at 13:1 bass_line.genre = 3
at 17:1 filter.resonance = 90%
at 17:1 ramp filter.cutoff low -> high over 4 bars
`
  },
  {
    id: 'reverb-swell',
    title: 'Reverb swell',
    piece: 'generative-fx.ttl',
    about: 'The plate reverb fades up over four bars, then back down.',
    source: `# "plate" is the first Cascade reverb in this piece.
plate.mix = 0.1
at 1:1 ramp plate.mix 0.1 -> 0.7 over 4 bars
at 5:1 ramp plate.mix 0.7 -> 0.1 over 4 bars
`
  },
  {
    id: 'formant-drift',
    title: 'Formant drift',
    piece: 'generative-fx.ttl',
    about: 'The formant shifter moves the character of the sound up and down every two bars.',
    source: `# Units are checked: st is semitones, and a value in the wrong unit is an error.
every 2 bars: formant_shifter.formant_shift = pick(-7st, -3st, 0st, 4st, 7st)
`
  },
  {
    id: 'tremolo-ramp',
    title: 'Tremolo from slow to fast',
    piece: 'generative-fx.ttl',
    about: 'The tremolo starts as a slow pulse and speeds up into a flutter over eight bars.',
    source: `tremolo.depth = 0.8
ramp tremolo.rate 0.5Hz -> 12Hz over 8 bars
`
  },
  {
    id: 'add-a-plugin',
    title: 'Add a plugin',
    piece: 'generative-fx.ttl',
    about: 'Fetches and checks a second Cascade reverb, adds it as a new track, and sets it up. The script does nothing until the plugin has passed its checks.',
    source: `# The address is written out in full. Everything a script loads is checked before anything else it says runs.
load hall = https://strandz.it/jigdaw/plugins/cascade/
hall.mix = 0.5
hall.size = 40ms
hall.damping = 3kHz
`
  },
  {
    id: 'new-melody',
    title: 'A new melody',
    piece: 'generative-fx.ttl',
    about: 'The melody generator is given a new seed every four bars, and a different scale every eight.',
    source: `# lead_line.scale: 0 Major, 2 Minor, 5 Dorian, 14 Pent Minor.
every 4 bars: lead_line.seed = round(rand(1, 9999))
every 8 bars: lead_line.scale = pick(0, 2, 5, 14)
`
  },
  {
    id: 'chip-lead',
    title: 'Restless chip lead',
    piece: 'chiptune.ttl',
    about: 'The lead line gets denser and sparser, and takes a new seed every eight bars.',
    source: `every 2 bars: lead_line.density = rand(0.25, 0.85)
every 8 bars: lead_line.seed = round(rand(1, 65535))
`
  },
  {
    id: 'square-bass',
    title: 'Square bass filter',
    piece: 'chiptune.ttl',
    about: 'The square bass filter opens over four bars while the waveform changes every two.',
    source: `# square_bass.waveform: 0, 1 and 2 are the three waves Pulse offers.
ramp square_bass.cutoff 400Hz -> 9kHz over 4 bars
every 2 bars: square_bass.waveform = pick(0, 1, 2)
`
  }
])
