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
// Two checks. Imports are read from the import section (src/validate/WasmAbi.js).
// memory.grow is found by decoding every instruction (src/validate/WasmCode.js):
// the ABI forbids growing memory after jig_init, because it detaches every view
// the host holds. A grow reached by direct calls from an ABI export fails; one
// reachable only if a table call lands on it is reported as possible and does
// not fail; one under an export outside the ABI is reported and does not fail,
// since that is the plugin's own protocol with its own processor.
import { readFile } from 'node:fs/promises'
import { checkAbiImports } from '../src/validate/WasmAbi.js'
import { checkMemoryGrow } from '../src/validate/WasmCode.js'

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node bin/check-wasm-abi.js FILE.wasm...')
  process.exit(2)
}

let failed = false
for (const file of files) {
  let result
  let growth
  try {
    const bytes = await readFile(file)
    result = checkAbiImports(bytes)
    growth = checkMemoryGrow(bytes)
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
  if (!growth.ok) {
    console.log(`${file}: memory.grow is reachable from an ABI export, which the ABI forbids after jig_init:`)
    for (const g of growth.growers.filter(g => g.fromAbi === 'direct' || g.fromAbi === 'table')) console.log(`  function ${g.func}${g.fromAbi === 'table' ? ' (through a table call)' : ''}`)
    failed = true
  } else if (growth.growers.length === 0) {
    console.log(`${file}: ok, no memory.grow`)
  } else {
    for (const g of growth.growers) {
      const how = g.fromAbi === 'indirect' ? 'reachable from an ABI export only because the table could not be read, so possible' : 'not reachable from an ABI export'
      console.log(`${file}: memory.grow in function ${g.func}, ${how}${g.fromPrivateExport ? '; reached by a plugin-private export' : ''}`)
    }
  }
}

process.exit(failed ? 1 : 0)
