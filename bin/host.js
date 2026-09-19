// bin/host.js
//
// A minimal, standalone reference host: load a chain of plugins by IRI, or
// by a local directory for one under test before it is published, and
// render real audio to a WAV file. No browser, no DAW, no native audio
// binding: src/host/ReferenceHost.js does the work, this is its CLI.
//
// Usage:
//   node bin/host.js [--root PREFIX=DIR]... [--seconds N] [--note NOTE@TIME[:OFFTIME]]...
//                     [--out FILE.wav] [--no-validate] IRI...
//
// Examples:
//   node bin/host.js https://strandz.it/jigdaw/plugins/cascade/ --out tail.wav
//   node bin/host.js --root https://strandz.it/jigdaw/plugins/pulse/=plugins/pulse \
//     https://strandz.it/jigdaw/plugins/pulse/ --note 69@0 --out note.wav
import { writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderChain } from '../src/host/ReferenceHost.js'
import { encodeWav } from '../src/host/Wav.js'
import { shapeValidatorFromFile } from '../src/validate/files.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs (argv) {
  const iris = []
  const roots = {}
  const notes = []
  let seconds = 2
  let out = 'out.wav'
  let sampleRate = 48000
  let validate = true

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
    } else if (arg === '--out') {
      out = argv[++i]
      if (!out) throw new Error('--out needs a file path')
    } else if (arg === '--no-validate') {
      validate = false
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
  return { iris, roots, notes, seconds, out, sampleRate, validate }
}

function usage () {
  console.error('usage: node bin/host.js [--root PREFIX=DIR]... [--seconds N] ' +
    '[--note NOTE@ONTIME[:OFFTIME]]... [--out FILE.wav] [--no-validate] IRI...')
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

  // A held note becomes an on event and, if given, an off event; a note
  // never told to stop just rings for the rest of the render, which suits
  // hearing a single held note as much as an explicit release does.
  const notes = []
  for (const { note, on, off } of args.notes) {
    notes.push({ frame: Math.round(on * args.sampleRate), note })
    if (off !== null) notes.push({ frame: Math.round(off * args.sampleRate), note, off: true })
  }

  const started = Date.now()
  const { channels, loaded } = await renderChain({
    iris: args.iris,
    roots: args.roots,
    seconds: args.seconds,
    sampleRate: args.sampleRate,
    notes,
    validator
  })

  const wav = encodeWav(channels, args.sampleRate)
  await writeFile(args.out, wav)

  const peak = Math.max(...channels.map(c => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)))
  console.log(
    `${args.out}: ${loaded.map(l => l.label).join(' -> ')}, ` +
    `${args.seconds}s at ${args.sampleRate}Hz, peak ${peak.toFixed(3)}, ` +
    `${Date.now() - started}ms`
  )
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
