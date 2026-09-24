// bin/check-wasm-abi.js
//
// A static check of a compiled module against module-abi.md's "Instantiate
// the module with no imports. A module declaring this ABI MUST NOT require
// any." Only meaningful for a module that declares jig:Abi1 or jig:Abi2; a
// module private to its own processor may import whatever its processor
// supplies, and this has no opinion about that case.
//
// Reads the module's own bytes directly rather than a profile or an IRI, so
// it runs against a build output before there is anywhere to publish it:
//
//   node bin/check-wasm-abi.js plugins/pulse/pulse.wasm
//
// See src/validate/WasmAbi.js for what this does and does not check, and
// why: an import count is exact; whether the module ever calls memory.grow
// is not attempted, and TODO.md says why.
import { readFile } from 'node:fs/promises'
import { checkAbiImports } from '../src/validate/WasmAbi.js'

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node bin/check-wasm-abi.js FILE.wasm...')
  process.exit(2)
}

let failed = false
for (const file of files) {
  let result
  try {
    result = checkAbiImports(await readFile(file))
  } catch (error) {
    console.log(`${file}: ${error.message}`)
    failed = true
    continue
  }
  if (result.ok) {
    console.log(`${file}: ok, no imports`)
  } else {
    console.log(`${file}: ${result.imports.length} import(s), which jig:Abi1/jig:Abi2 forbid:`)
    for (const imp of result.imports) console.log(`  ${imp.module}.${imp.name}`)
    failed = true
  }
}

process.exit(failed ? 1 : 0)
