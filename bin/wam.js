// bin/wam.js
//
// Package a JigDAW plugin as a Web Audio Module, so a WAM 2.0 host can load it.
//
// Same shape as bin/bundle.js: read the profile, refuse a plugin that cannot be
// packaged, write a directory. It changes nothing about the plugin. The same
// wasm, the same processor and the same profile come out the other side; what
// is generated is the packaging a WAM host expects, which JigDAW does not have
// because it answers the same questions in RDF instead.
//
// The profile is resolved here and baked into the output, rather than fetched
// and parsed at run time. That keeps a Turtle parser out of the browser, where
// @zazuko/env reaches node's `stream` and `util` and costs 1.7 MB and two
// shims, and it means the digests travel inside the package.
//
// That last part is the point worth stating. **The WAM API has no concept of
// integrity**: no digest, no hash, nothing, measured across the whole of
// @webaudiomodules/api. A JigDAW plugin packaged this way verifies its own
// module and processor before instantiating them, inside a host that never
// asked for that and cannot express it.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { resolve, join, basename } from 'node:path'
import { parseText } from '../src/rdf/parse.js'
import { readProfile } from '../src/rdf/ProfileReader.js'
import { digestOf } from '../src/host/Integrity.js'
import { detectCapabilities } from '../src/host/Capabilities.js'
import { vocabulary as v, TRN, DOAP, FOAF } from '../src/rdf/Vocabulary.js'
import { shapeValidatorFromFile } from '../src/validate/files.js'

/** The WAM API version this packaging targets. */
export const WAM_API_VERSION = '2.0.0-alpha.6'

// units:unit is an IRI and WamParameterInfo.units is a display string. The same
// four units src/ui/Panel.js knows; a unit outside this set becomes '' rather
// than an IRI, because an IRI printed after a number is worse than nothing.
const UNIT_LABELS = Object.freeze({
  'http://lv2plug.in/ns/extensions/units#hz': 'Hz',
  'http://lv2plug.in/ns/extensions/units#ms': 'ms',
  'http://lv2plug.in/ns/extensions/units#db': 'dB',
  'http://lv2plug.in/ns/extensions/units#s': 's'
})

/**
 * WamParameterType from the shape of the declaration.
 *
 * The same rule as contract section 5.3, which decides a widget the same way:
 * a toggle is a toggle because it declares a toggle's shape.
 *
 * Nothing infers `int` from the bounds happening to be whole numbers. A cutoff
 * declared 100 to 18000 Hz is a continuous parameter whose limits are round,
 * and typing it `int` would quantise it to 1 Hz steps in every WAM host. That
 * was the first version of this function and it was wrong.
 */
const wamType = port =>
  port.toggled ? 'boolean' : port.scalePoints.length > 0 ? 'choice' : 'float'

function wamParameters (ports) {
  return ports.filter(p => p.symbol).map(port => {
    const type = wamType(port)
    return {
      id: port.symbol,
      label: port.name ?? port.symbol,
      type,
      defaultValue: port.defaultValue,
      minValue: port.minimum,
      maxValue: port.maximum,
      discreteStep: type === 'float' ? 0 : 1,
      // No JigDAW equivalent. 1 is linear, which is what every port declares by
      // saying nothing about it.
      exponent: 1,
      choices: port.scalePoints.map(point => point.label ?? String(point.value)),
      units: UNIT_LABELS[port.unit] ?? ''
    }
  })
}

function wamDescriptor (profile, facts) {
  const midiIn = facts.accepts.includes(`${TRN}Midi`)
  const midiOut = facts.produces.includes(`${TRN}Midi`)
  return {
    // The plugin IRI, which is a stronger identifier than WAM asks for: WAM
    // suggests vendor + name, and this is already globally unique and
    // dereferenceable.
    identifier: profile.iri,
    name: profile.label,
    vendor: facts.vendor ?? '',
    version: facts.version,
    apiVersion: WAM_API_VERSION,
    thumbnail: '',
    keywords: facts.genres,
    isInstrument: facts.roles.some(role => /Instrument|Generator/.test(role)),
    description: profile.comment ?? '',
    website: facts.homepage ?? profile.iri,
    hasAudioInput: (profile.audioInputs ?? 0) > 0,
    hasAudioOutput: (profile.audioOutputs ?? 0) > 0,
    hasMidiInput: midiIn,
    hasMidiOutput: midiOut,
    hasAutomationInput: profile.ports.length > 0,
    hasAutomationOutput: false,
    // JigDAW has none of these, so they are false rather than absent. A WAM
    // host reads the booleans to decide what to wire up.
    hasSysexInput: false,
    hasSysexOutput: false,
    hasOscInput: false,
    hasOscOutput: false,
    hasMpeInput: midiIn,
    hasMpeOutput: false
  }
}

/** Only what Instantiate.js reads, so the package carries no more than it uses. */
const bakedProfile = profile => ({
  iri: profile.iri,
  audioInputs: profile.audioInputs ?? 0,
  audioOutputs: profile.audioOutputs ?? 0,
  outputChannels: profile.outputChannels ?? 2,
  renderQuantum: profile.renderQuantum ?? 128,
  ports: profile.ports,
  module: profile.module && {
    location: profile.module.location,
    integrity: profile.module.integrity
  },
  processor: {
    location: profile.processor.location,
    integrity: profile.processor.integrity,
    registeredName: profile.processor.registeredName
  }
})

export async function packageForWam (dir, { validator = null, rebase = null } = {}) {
  const profileText = await readFile(join(dir, 'profile.ttl'), 'utf8')
  const dataset = await parseText(profileText, 'urn:jigdaw:wam')
  const profile = readProfile(dataset)

  if (validator) {
    const report = await validator.validate(dataset)
    if (!report.conforms) {
      const seen = report.violations.map(vi => `${vi.focusNode} ${vi.path ?? '(node)'}`)
      throw new Error(`${profile.iri} does not validate:\n  - ${seen.join('\n  - ')}`)
    }
  }

  const objects = (predicate) => [...dataset]
    .filter(q => q.subject.value === profile.iri && q.predicate.value === predicate)
    .map(q => q.object.value)

  const facts = {
    vendor: objects(v.trn.vendor)[0],
    version: objects(`${DOAP}revision`)[0],
    genres: objects(v.trn.genre),
    roles: objects(v.trn.role),
    accepts: objects(v.trn.accepts),
    produces: objects(v.trn.produces),
    homepage: objects(`${FOAF}homepage`)[0]
  }

  // WamDescriptor.version is required and a profile need not carry one, so this
  // is the one thing that can stop a plugin being packaged. Refused rather than
  // defaulted: a version invented here would be a claim nobody made, written
  // into a file other people's hosts read.
  if (!facts.version) {
    throw new Error(
      `${profile.iri} declares no doap:revision, and WamDescriptor.version is required.\n` +
      '  Add "version": "1.0.0" to profile.json and run bin/write-profile.js.')
  }
  if (!profile.processor?.registeredName) {
    throw new Error(`${profile.iri} declares no jig:registeredName, so no node can be constructed`)
  }

  // The digests must describe the files as they will be fetched. Verified here
  // for the same reason bin/bundle.js verifies before packing: a stale digest
  // is a local problem until the package reaches somebody else.
  const checked = []
  for (const [kind, resource] of [['module', profile.module], ['processor', profile.processor]]) {
    if (!resource) continue
    const relative = resource.location.startsWith(profile.iri)
      ? resource.location.slice(profile.iri.length)
      : null
    if (!relative) { checked.push({ kind, relative: null, bytes: null }); continue }
    let bytes
    try { bytes = await readFile(join(dir, relative)) } catch {
      throw new Error(`the ${kind} names ${relative}, which is not in ${dir}`)
    }
    const actual = await digestOf(new Uint8Array(bytes))
    if (actual !== resource.integrity) {
      throw new Error(
        `the ${kind} (${relative}) does not match its declared digest. ` +
        'Rebuild the plugin so the profile is regenerated.')
    }
    checked.push({ kind, relative, bytes })
  }

  const baked = bakedProfile(profile)
  if (rebase) {
    // A package served from somewhere other than the plugin's own origin still
    // names the plugin by its canonical IRI. Only retrieval moves, which is the
    // rule docs/plugin-bundles.md section 3 already states for a mirror.
    for (const resource of [baked.module, baked.processor]) {
      if (!resource) continue
      if (resource.location.startsWith(profile.iri)) {
        resource.location = rebase + resource.location.slice(profile.iri.length)
      }
    }
  }

  const data = {
    descriptor: wamDescriptor(profile, facts),
    parameters: wamParameters(profile.ports),
    profile: baked,
    ui: profile.ui ? { location: profile.ui.location } : null,
    capabilities: [...detectCapabilities({})]
  }

  return { profile, data, files: checked.filter(f => f.bytes) }
}

/** The generated entry point. Imports the adapter; bin/wam.js bundles the two. */
const entryModule = data => `// GENERATED by bin/wam.js. Do not edit.
//
// ${data.descriptor.name} ${data.descriptor.version}, as a Web Audio Module.
// The plugin itself is unchanged: this is packaging, and everything in it was
// derived from ${data.profile.iri}
import { webAudioModule } from '${new URL('../src/wam/WamModule.js', import.meta.url).pathname}'

export const data = ${JSON.stringify(data, null, 2)}

export default webAudioModule(data)

/** For a host that must supply its own fetch or node class. */
export const withOptions = options => webAudioModule(data, options)
`

export async function writeWamPackage (dir, out, options = {}) {
  const made = await packageForWam(dir, options)
  const { build } = await import('esbuild')

  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })

  await writeFile(join(out, 'descriptor.json'), JSON.stringify(made.data.descriptor, null, 2) + '\n')

  const entry = join(out, '.entry.js')
  await writeFile(entry, entryModule(made.data))
  await build({
    entryPoints: [entry],
    outfile: join(out, 'index.js'),
    bundle: true,
    format: 'esm',
    target: 'es2020',
    logLevel: 'error'
  })
  await rm(entry)

  // Self-contained by default: the package carries the bytes its digests
  // describe, so it works from a static directory with no other origin
  // reachable. Pass --rebase to point it at the canonical origin instead.
  const copied = []
  if (!options.rebase) {
    for (const file of made.files) {
      await writeFile(join(out, file.relative), file.bytes)
      copied.push(file.relative)
    }
  }

  return { ...made, copied, out }
}

// ── Command line ───────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const options = {}
  const positional = []
  for (let i = 0; i < args.length; i++) {
    const flag = /^--(rebase|out)$/.exec(args[i])
    if (flag) { options[flag[1]] = args[++i]; continue }
    positional.push(args[i])
  }

  const [dir] = positional
  if (!dir) {
    console.error([
      'usage: node bin/wam.js <plugin-directory> [options]',
      '',
      '  --out <dir>      where to write the package (default <plugin>/wam)',
      '  --rebase <iri>   serve the module and processor from here rather than',
      '                   copying them into the package'
    ].join('\n'))
    process.exit(2)
  }

  try {
    const root = resolve(import.meta.dirname, '..')
    const plugin = resolve(dir)
    const out = options.out ? resolve(options.out) : join(plugin, 'wam')
    const validator = await shapeValidatorFromFile(join(root, 'vocabs/shapes.ttl'))

    const made = await writeWamPackage(plugin, out, { validator, rebase: options.rebase })
    const { descriptor } = made.data

    console.log(`${descriptor.name} ${descriptor.version}  ${descriptor.identifier}`)
    console.log(`  ${made.data.parameters.length} parameter(s), ` +
      `audio ${descriptor.hasAudioInput ? 'in' : 'no in'}/${descriptor.hasAudioOutput ? 'out' : 'no out'}, ` +
      `midi ${descriptor.hasMidiInput ? 'in' : 'no in'}/${descriptor.hasMidiOutput ? 'out' : 'no out'}`)
    console.log(`  ${join(basename(out), 'descriptor.json')}`)
    console.log(`  ${join(basename(out), 'index.js')}`)
    for (const name of made.copied) console.log(`  ${join(basename(out), name)}`)
    console.log('  the digests from the profile are inside index.js and are checked at load,')
    console.log('  which is more than the WAM API asks for: it has no integrity concept at all.')
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
