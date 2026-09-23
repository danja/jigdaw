// bin/juce-params-to-profile.js
//
// Turns a JUCE parameter dump (native/jigdaw-adapter/src/juce/tools/
// DumpParameters.h, run once inside your own JUCE project) into the three
// things a ported plugin needs and would otherwise be hand-transcribed:
// profile.json's `ports` list, the JS processor's PARAM_INDEX and
// parameterDescriptors, and the C++ module's jig_set_param dispatch.
//
// Deliberately mechanical. The dump already carries JUCE's own resolved
// range, default and choice list for each parameter; this only renames the
// fields to the shapes bin/write-profile.js and a processor already read,
// in the same order, so a switch statement written against this file's
// output agrees with the profile written against the same input by
// construction rather than by two people copying numbers carefully.
//
// What this does not do: touch your DSP. Porting the inner loop of
// processBlock to a form with no JUCE types is still yours; see
// docs/for-juce-developers.md.
import { readFile, writeFile } from 'node:fs/promises'

/** A JUCE parameter id, as an lv2:symbol. vocabs/shapes.ttl's pattern is
 * ^[a-zA-Z_][a-zA-Z0-9_]*$; a JUCE id is usually already that shape, and
 * this only touches the id when it is not, rather than reformatting one
 * that already fits. */
export function toSymbol (id) {
  let symbol = String(id).replace(/[^a-zA-Z0-9_]/g, '_')
  if (!/^[a-zA-Z_]/.test(symbol)) symbol = `_${symbol}`
  return symbol
}

/** One dumped parameter, as the `ports` entry bin/write-profile.js reads. */
export function toPort (param, paramIndex) {
  const symbol = toSymbol(param.id)
  const base = { symbol, name: param.name, paramIndex }

  if (param.type === 'choice') {
    return {
      ...base,
      default: param.default,
      minimum: 0,
      maximum: param.choices.length - 1,
      scalePoints: param.choices.map((label, value) => ({ label, value }))
    }
  }
  if (param.type === 'bool') {
    return { ...base, default: param.default ? 1 : 0, minimum: 0, maximum: 1, toggled: true }
  }
  // 'float', 'int', and 'normalised' (no declared range: 0..1) all carry a
  // plain minimum/maximum/default already, the last case's being 0 and 1.
  return {
    ...base,
    default: param.default,
    minimum: param.type === 'normalised' ? 0 : param.minimum,
    maximum: param.type === 'normalised' ? 1 : param.maximum
  }
}

/** The C++ jig_set_param body. Variable names are guesses, the symbol
 * itself: renaming a handful of case bodies to match your own fields is
 * still on you, the same as it would be copying this out of any other
 * plugin's source by hand. */
export function toCppSwitch (params) {
  const cases = params.map((p, i) => {
    const symbol = toSymbol(p.id)
    if (p.type === 'bool') return `    case ${i}: ${symbol} = value >= 0.5f; break;`
    if (p.type === 'choice' || p.type === 'int') return `    case ${i}: ${symbol} = static_cast<int>(value); break;`
    return `    case ${i}: ${symbol} = value; break;`
  })
  return `void jig_set_param(uint32_t index, float value) {\n  switch (index) {\n${cases.join('\n')}\n  }\n}`
}

/** The AudioWorklet processor's PARAM_INDEX and parameterDescriptors, in the
 * shape plugins/boost/boost-processor.js and every other processor here
 * already use. */
export function toProcessorSnippet (params) {
  const index = params.map((p, i) => `${toSymbol(p.id)}: ${i}`).join(', ')
  const descriptors = params.map(p => {
    const min = p.type === 'choice' ? 0 : p.type === 'bool' ? 0 : p.type === 'normalised' ? 0 : p.minimum
    const max = p.type === 'choice' ? p.choices.length - 1 : p.type === 'bool' ? 1 : p.type === 'normalised' ? 1 : p.maximum
    const def = p.type === 'bool' ? (p.default ? 1 : 0) : p.default
    return `      { name: '${toSymbol(p.id)}', defaultValue: ${def}, minValue: ${min}, maxValue: ${max}, automationRate: 'k-rate' }`
  })
  return `const PARAM_INDEX = Object.freeze({ ${index} })\n\n` +
    `  static get parameterDescriptors () {\n    return [\n${descriptors.join(',\n')}\n    ]\n  }`
}

/** Merge the generated ports into an existing profile.json, keeping every
 * other field as it was. Creating one from nothing is a different job:
 * copy plugins/boost/profile.json for the rest of the shape, the same
 * starting point .claude/commands/new-plugin.md points at. */
export async function mergeIntoProfile (profilePath, ports) {
  const text = await readFile(profilePath, 'utf8')
  const profile = JSON.parse(text)
  profile.ports = ports
  await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`)
}

// ── Command line ───────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const [paramsPath, profilePath] = process.argv.slice(2)
  if (!paramsPath) {
    console.error([
      'usage: node bin/juce-params-to-profile.js <params.json> [profile.json]',
      '',
      '  params.json   from native/jigdaw-adapter/src/juce/tools/DumpParameters.h,',
      '                run once inside your own JUCE project',
      '  profile.json  updated in place with the generated `ports`, if given;',
      '                otherwise only the C++ and JS snippets are printed'
    ].join('\n'))
    process.exit(2)
  }

  try {
    const { parameters } = JSON.parse(await readFile(paramsPath, 'utf8'))
    if (!Array.isArray(parameters) || parameters.length === 0) {
      throw new Error(`${paramsPath} has no "parameters" array, or it is empty`)
    }

    const ports = parameters.map((p, i) => toPort(p, i))

    if (profilePath) {
      await mergeIntoProfile(profilePath, ports)
      console.log(`wrote ${parameters.length} port(s) into ${profilePath}`)
      console.log('')
    }

    console.log('// jig_set_param, for the WebAssembly module:')
    console.log(toCppSwitch(parameters))
    console.log('')
    console.log('// PARAM_INDEX and parameterDescriptors, for the AudioWorklet processor:')
    console.log(toProcessorSnippet(parameters))
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
