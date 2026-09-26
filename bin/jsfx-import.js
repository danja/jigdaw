// bin/jsfx-import.js
//
// Convert a REAPER JSFX effect into a JigDAW plugin: parse its header and
// sections (src/jsfx/HeaderParser.js), compile its EEL2 to the bytecode
// plugins/_jsfx-runtime's VM runs (src/jsfx/Compiler.js), and write a plugin
// directory around a copy of that shared runtime.
//
// Usage: node bin/jsfx-import.js <source.jsfx> <plugin-directory-name>
//
// plugins/_jsfx-runtime/build.sh must have been run first: this copies its
// built jsfx-runtime.wasm rather than building one of its own, the same
// artefact for every converted JSFX plugin.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { parseHeader } from '../src/jsfx/HeaderParser.js'
import { compileScript } from '../src/jsfx/Compiler.js'
import { renderProcessor } from '../src/jsfx/ProcessorTemplate.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const [, , sourcePath, pluginName] = process.argv
if (!sourcePath || !pluginName) {
  console.error('usage: node bin/jsfx-import.js <source.jsfx> <plugin-directory-name>')
  process.exit(1)
}
if (!/^[a-z][a-z0-9-]*$/.test(pluginName)) {
  console.error(`plugin-directory-name must be lowercase, digits and hyphens: ${pluginName}`)
  process.exit(1)
}

const runtimeWasm = resolve(root, 'plugins/_jsfx-runtime/jsfx-runtime.wasm')
if (!existsSync(runtimeWasm)) {
  console.error('plugins/_jsfx-runtime/jsfx-runtime.wasm is not built. Run plugins/_jsfx-runtime/build.sh first.')
  process.exit(1)
}

const source = await readFile(resolve(root, sourcePath), 'utf8')
const header = parseHeader(source)

const sliderAliases = {}
for (const s of header.sliders) if (s.name) sliderAliases[s.name] = s.number

const script = compileScript(header.sections, { sliderAliases })

const dir = resolve(root, 'plugins', pluginName)
await mkdir(dir, { recursive: true })

await writeFile(resolve(dir, 'script.jsfxb'), script)
await copyFile(runtimeWasm, resolve(dir, 'jsfx-runtime.wasm'))

const registeredName = pluginName
const ports = header.sliders.map(s => ({
  symbol: `slider${s.number}`,
  name: s.label,
  default: s.default,
  minimum: s.minimum,
  maximum: s.maximum,
  paramIndex: s.number - 1
}))

const processorFile = `${pluginName}-processor.js`
await writeFile(resolve(dir, processorFile),
  renderProcessor({ path: `plugins/${pluginName}/${processorFile}`, registeredName, ports }))

const iri = `https://strandz.it/jigdaw/plugins/${pluginName}/`
const profile = {
  iri,
  label: header.desc || pluginName,
  comment: `Converted by bin/jsfx-import.js from ${sourcePath}, a REAPER JSFX effect, and run under the shared interpreter in plugins/_jsfx-runtime/.`,
  vendor: 'danja',
  developer: 'http://danny.ayers.name',
  version: '1.0.0',
  registeredName,
  roles: ['trn:AudioEffect'],
  accepts: ['trn:Audio'],
  produces: ['trn:Audio'],
  cautions: [
    'Converted from JSFX by a restricted EEL2 subset: no user-defined function, no strings, no gmem, and while()/loop() are bounded so a runaway script goes silent rather than missing the audio thread\'s deadline. See plugins/_jsfx-runtime/README.md.'
  ],
  format: 'trn:Jig , trn:WebAudio',
  licenceId: 'Apache-2.0',
  requires: [],
  prefers: [],
  shape: {
    audioInputs: 1,
    inputChannels: header.inChannels,
    audioOutputs: 1,
    outputChannels: header.outChannels,
    renderQuantum: 128,
    latencyFrames: 0
  },
  resources: {
    module: 'jsfx-runtime.wasm',
    processor: processorFile
  },
  assets: [
    { key: 'script', file: 'script.jsfxb', mediaType: 'application/octet-stream' }
  ],
  ports
}
await writeFile(resolve(dir, 'profile.json'), JSON.stringify(profile, null, 2) + '\n')

execFileSync(process.execPath, [resolve(root, 'bin/write-profile.js'), dir], { stdio: 'inherit' })

console.log(`converted ${sourcePath} -> plugins/${pluginName}/ (${header.sliders.length} slider(s), ` +
  `${header.inChannels} in, ${header.outChannels} out, ${script.length} bytes of bytecode)`)
