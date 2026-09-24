// bin/check-plugin.js
//
// Does a plugin's code actually do anything, rather than merely validate?
// Renders it through src/host/PluginCheck.js and reports whether it
// produced audio, stayed within a peak bound, and, for an instrument given
// notes, actually responded to them. See TODO.md, "more ways of verifying
// a plugin": jig:integrity and SHACL check what a plugin is; this checks
// what it does.
//
// --measure-budget adds checkRenderBudget's coarse real-time sanity check,
// off by default because it renders the chain twice more, purely to time
// it. See PluginCheck.js for what it can and cannot tell you.
//
// Usage:
//   node bin/check-plugin.js [--root PREFIX=DIR]... [--seconds N]
//                             [--note NOTE@ONTIME[:OFFTIME]]... [--peak-bound N]
//                             [--measure-budget] [--no-validate] IRI...
//
// Examples:
//   node bin/check-plugin.js https://strandz.it/jigdaw/plugins/cascade/
//   node bin/check-plugin.js --root https://strandz.it/jigdaw/plugins/pulse/=plugins/pulse \
//     https://strandz.it/jigdaw/plugins/pulse/ --note 69@0:1
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPlugin, checkRenderBudget } from '../src/host/PluginCheck.js'
import { shapeValidatorFromFile } from '../src/validate/files.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs (argv) {
  const iris = []
  const roots = {}
  const notes = []
  let seconds = 2
  let sampleRate = 48000
  let peakBound = 1
  let validate = true
  let measureBudget = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--root') {
      const value = argv[++i]
      const eq = value?.indexOf('=') ?? -1
      if (!value || eq < 1) throw new Error('--root needs PREFIX=DIR')
      roots[value.slice(0, eq)] = resolve(value.slice(eq + 1))
    } else if (arg === '--seconds') {
      seconds = Number(argv[++i])
      if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('--seconds needs a positive number')
    } else if (arg === '--sample-rate') {
      sampleRate = Number(argv[++i])
    } else if (arg === '--peak-bound') {
      peakBound = Number(argv[++i])
      if (!Number.isFinite(peakBound) || peakBound <= 0) throw new Error('--peak-bound needs a positive number')
    } else if (arg === '--no-validate') {
      validate = false
    } else if (arg === '--measure-budget') {
      measureBudget = true
    } else if (arg === '--note') {
      const value = argv[++i]
      const match = /^(\d+)@([\d.]+)(?::([\d.]+))?$/.exec(value ?? '')
      if (!match) throw new Error('--note needs NOTE@ONTIME[:OFFTIME], e.g. 69@0.5 or 69@0:1.2')
      notes.push({ note: Number(match[1]), on: Number(match[2]), off: match[3] ? Number(match[3]) : null })
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`)
    } else {
      iris.push(arg)
    }
  }
  return { iris, roots, notes, seconds, sampleRate, peakBound, validate, measureBudget }
}

function usage () {
  console.error('usage: node bin/check-plugin.js [--root PREFIX=DIR]... [--seconds N] ' +
    '[--note NOTE@ONTIME[:OFFTIME]]... [--peak-bound N] [--measure-budget] [--no-validate] IRI...')
}

async function main () {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    usage()
    process.exit(2)
  }

  if (args.iris.length === 0) {
    usage()
    process.exit(2)
  }

  const validator = args.validate
    ? await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    : null

  // Same conversion as bin/host.js: a held note becomes an on event and, if
  // given, an off event.
  const notes = []
  for (const { note, on, off } of args.notes) {
    notes.push({ frame: Math.round(on * args.sampleRate), note })
    if (off !== null) notes.push({ frame: Math.round(off * args.sampleRate), note, off: true })
  }

  let result
  try {
    result = await checkPlugin({
      iris: args.iris,
      roots: args.roots,
      seconds: args.seconds,
      sampleRate: args.sampleRate,
      notes,
      validator,
      peakBound: args.peakBound
    })
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }

  const chain = result.loaded.map(l => l.label).join(' -> ')
  console.log(`${chain}: peak ${result.peak.toFixed(3)}${result.silentPeak !== null ? ` (silent ${result.silentPeak.toFixed(3)})` : ''}`)

  const report = check => check === null ? 'n/a' : (check ? 'ok' : 'FAILED')
  console.log(`  produces audio:    ${report(result.checks.producesAudio)}`)
  console.log(`  within peak bound: ${report(result.checks.withinPeakBound)} (bound ${args.peakBound})`)
  console.log(`  responds to MIDI:  ${report(result.checks.respondsToMidi)}`)

  let ok = result.ok
  if (args.measureBudget) {
    const budget = await checkRenderBudget({
      iris: args.iris, roots: args.roots, sampleRate: args.sampleRate, notes, validator
    })
    console.log(`  render budget:     ${report(budget.ok)} ` +
      `(${budget.realTimeMultiple.toFixed(1)}x real time, ${budget.millisecondsPerSecond.toFixed(1)}ms per second of audio)`)
    ok = ok && budget.ok
  }

  process.exit(ok ? 0 : 1)
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
