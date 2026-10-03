// src/reel/Reference.js
//
// The Reel language reference the Reel page shows, as data. It states what src/reel/Parser.js, Values.js and
// Planner.js do; docs/livecoding.md is the design and this is the lookup table. tests/reel/Reference.test.js
// binds it to the code: every statement the parser can produce, every unit it reads and every function the
// evaluator knows must have an entry here, and every example in a statement entry must parse.

import { MAX_STATEMENTS } from './Planner.js'
import { MAX_EXPRESSION_DEPTH } from './Parser.js'
import { TICK_BUDGET } from './Runner.js'

/** The statement types the parser produces, in the order a person meets them. `type` is the parser's own name. */
export const STATEMENTS = Object.freeze([
  {
    type: 'set',
    form: 'NAME.parameter = VALUE',
    what: 'Set a parameter now. NAME is a plugin, parameter is its symbol, and the value is checked against the parameter\'s range and unit before anything runs.',
    example: 'filter.cutoff = 800Hz'
  },
  {
    type: 'ramp',
    form: 'ramp NAME.parameter FROM -> TO over LENGTH',
    what: 'Move a parameter smoothly from one value to another. It starts on the next bar line, or at the position given by at. A ramp cannot sit inside every.',
    example: 'ramp filter.cutoff 200Hz -> 6kHz over 8 bars'
  },
  {
    type: 'at',
    form: 'at BAR:BEAT STATEMENT',
    what: 'Do a set or a ramp when the transport reaches a position. Bars and beats count from 1, and the beat can be fractional, as 3:2.5. A position already passed fires once and is not repeated.',
    example: 'at 5:1 beats.genre = 3'
  },
  {
    type: 'every',
    form: 'every LENGTH: NAME.parameter = VALUE',
    what: 'Set a parameter again at every length, starting at the next one. pick and rand give a different value each time.',
    example: 'every 2 bars: filter.cutoff = pick(300Hz, 900Hz, 2kHz)'
  },
  {
    type: 'let',
    form: 'let NAME = VALUE',
    what: 'Give a value a name to use in the lines below. A name can be defined once.',
    example: 'let high = 5kHz'
  },
  {
    type: 'seed',
    form: 'seed N',
    what: 'Fix the random generator, so pick and rand make the same choices every run. N is a whole number.',
    example: 'seed 7'
  },
  {
    type: 'load',
    form: 'load NAME = ADDRESS',
    what: 'Fetch, check and load a plugin, and call it NAME. The address is written out in full, starts with http or https, and is never computed. Every plugin a script loads is checked before the script does anything, and the new plugin gets a track of its own.',
    example: 'load hall = https://strandz.it/jigdaw/plugins/cascade/'
  },
  {
    type: 'connect',
    form: 'connect A -> B',
    what: 'Connect the audio output of one plugin to the audio input of another. MIDI connections are not available to a script yet.',
    example: 'connect filter -> hall'
  }
])

/** One entry for each unit the parser reads: what it means and which parameters take it. */
export const UNITS_REFERENCE = Object.freeze({
  Hz: { means: 'hertz, a frequency', example: '440Hz' },
  kHz: { means: 'kilohertz, 1000 hertz', example: '8kHz' },
  ms: { means: 'milliseconds', example: '250ms' },
  s: { means: 'seconds', example: '1.5s' },
  dB: { means: 'decibels', example: '-6dB' },
  st: { means: 'semitones', example: '7st' },
  '%': { means: 'percent, for a parameter whose range is in percent', example: '35%' },
  cents: { means: 'hundredths of a semitone', example: '-20cents' }
})

export const FUNCTIONS_REFERENCE = Object.freeze({
  pick: { form: 'pick(a, b, c, ...)', what: 'One of the values, chosen at random each time it is evaluated. All must be in the same unit.', example: 'pick(300Hz, 900Hz, 2kHz)' },
  rand: { form: 'rand(low, high)', what: 'A random value between the two, in the same unit.', example: 'rand(60ms, 600ms)' },
  round: { form: 'round(value)', what: 'The nearest whole number. Use it for a seed or a choice from a list.', example: 'round(rand(1, 999))' }
})

/**
 * The plain-language sections, each a heading that says what it decides and a paragraph that answers it first.
 * `items` are short bullet lines.
 */
export const NOTES = Object.freeze([
  {
    heading: 'How a script runs',
    text: 'A script is lines of text, one statement per line, run by the Run buttons. Run at the next bar waits for the bar line so the music does not stutter, and Run now takes over at once. Check only reads the script and says what it would do, and changes nothing.',
    items: [
      'A comment starts with # at the start of a line or after a space.',
      'Running a script replaces the one before it: its every loops stop and the new ones start together.',
      'A script with any problem changes nothing and the music carries on. All the problems are listed together, each with a Go to line button.',
      'Stop script halts its loops. The parameters stay where they were left.',
      'Control+Enter runs at the next bar, and Control+Shift+Enter runs now.'
    ]
  },
  {
    heading: 'Naming plugins',
    text: 'A plugin in the open piece is named by its label in lower case, with anything that is not a letter or a digit turned into an underscore. "Chip drums" is chip_drums. The This piece tab lists every name a script can use, and its Insert buttons write a line for you.',
    items: [
      'Two plugins with the same label have no name, because guessing which is how a script changes the wrong one.',
      'A plugin the script loads is named by the script: load hall = ...'
    ]
  },
  {
    heading: 'Values and units',
    text: 'A number can carry a unit, and the unit is checked against the parameter. 8kHz can be written to a parameter in hertz, and -6dB cannot. A plain number is taken in the parameter\'s own units.',
    items: [
      'Values can be added and subtracted if they have the same unit, and multiplied or divided by a plain number.',
      'Any value that could fall outside the parameter\'s range, including every result a pick or rand could give, is an error before anything runs.'
    ]
  },
  {
    heading: 'Lengths and positions',
    text: 'A length is a number then bar, bars, beat or beats, as 2 bars. A position is BAR:BEAT, counted from 1, so 1:1 is the start of the piece. Time follows the transport, so a script stays in step if the speed changes.',
    items: []
  },
  {
    heading: 'Limits',
    text: 'The interpreter has no network, storage or clock of its own, and cannot reach anything but the plugins and the transport. Its limits are part of the language.',
    items: [
      `A script can have ${MAX_STATEMENTS} statements.`,
      `An expression can nest ${MAX_EXPRESSION_DEPTH} deep.`,
      `A repeated statement can do ${TICK_BUDGET} steps each time it fires, so one that would run away stops with an error and the music carries on.`,
      'A statement that fails while the music plays is reported in the log, and the others carry on.'
    ]
  }
])
