// tests/native/abi-layout.test.js
//
// The jig:Abi2 byte layouts are written out in four places: the specification
// table in docs/module-abi.md, the C++ structs the native host reads them with,
// the Rust the worked plugin writes them with, and the DataView offsets the
// browser processor uses. Nothing in any of those languages connects them, and
// getting one field four bytes out gives a plugin a tempo where it expected a
// beat and no error anywhere.
//
// So the specification is the source and these check the rest against it.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (...p) => readFileSync(join(root, ...p), 'utf8')

const spec = read('docs', 'module-abi.md')
const abiHeader = read('native', 'jigdaw-adapter', 'include', 'jigdaw', 'Abi.hpp')
const processor = read('plugins', 'bassgen', 'bassgen-processor.js')
const rust = read('plugins', 'bassgen', 'src', 'lib.rs')

/** The transport table in the spec, as { field: offset }. */
function transportFromSpec () {
  const section = spec.slice(spec.indexOf('## Transport'))
  const table = section.slice(0, section.indexOf('## The version 2 calling sequence'))
  const fields = {}
  for (const line of table.split('\n')) {
    // | 0 | `u32` | `playing` | 1 while the transport is rolling, 0 otherwise |
    const match = line.match(/^\|\s*(\d+)\s*\|\s*`(\w+)`\s*\|\s*`(\w+)`\s*\|/)
    if (match) fields[match[3]] = { offset: Number(match[1]), type: match[2] }
  }
  return fields
}

describe('the transport block', () => {
  const fields = transportFromSpec()

  it('is described by the specification at all', () => {
    // If this regex stops matching, every check below passes vacuously.
    expect(Object.keys(fields).length).toBe(12)
    expect(fields.playing.offset).toBe(0)
  })

  it('is 64 bytes, and the spec says so', () => {
    expect(spec).toMatch(/64 byte block/)
    const last = Object.values(fields).reduce((a, f) => Math.max(a, f.offset), 0)
    const width = { u32: 4, i32: 4, f64: 8 }
    const end = Object.values(fields).reduce(
      (a, f) => Math.max(a, f.offset + width[f.type]), 0)
    expect(end, 'the fields should exactly fill the block').toBe(64)
    expect(last).toBe(56)
  })

  it('matches the offsets the native host asserts', () => {
    // Abi.hpp carries static_asserts, which fail the build rather than a test.
    // These check that it asserts the offsets the specification actually states.
    for (const [name, field] of Object.entries(fields)) {
      const asserted = abiHeader.match(
        new RegExp(`offsetof\\(Transport, ${name}\\)\\s*==\\s*(\\d+)`))
      if (!asserted) continue   // not every field needs its own assertion
      expect(Number(asserted[1]), `${name} in Abi.hpp`).toBe(field.offset)
    }
    expect(abiHeader).toMatch(/sizeof\(Transport\)\s*==\s*64/)
  })

  it('declares its C++ members in the specification order', () => {
    const body = abiHeader.slice(abiHeader.indexOf('struct Transport'))
    const declared = [...body.matchAll(/^\s*(?:uint32_t|int32_t|double)\s+(\w+)\s*=/gm)]
      .map(m => m[1])
    const expected = Object.entries(fields)
      .sort((a, b) => a[1].offset - b[1].offset)
      .map(([name]) => name)
    // The member order IS the byte layout, so a reordering is a silent change
    // of every offset after it.
    expect(declared).toEqual(expected)
  })

  it('matches the offsets the browser processor writes', () => {
    // Each is a DataView call at a literal offset, so the numbers are checkable.
    const written = [...processor.matchAll(/view\.set\w+\((\d+),/g)].map(m => Number(m[1]))
    const legal = new Set(Object.values(fields).map(f => f.offset))
    for (const offset of written) {
      expect(legal.has(offset), `the processor writes offset ${offset}, which is not a field`)
        .toBe(true)
    }
    expect(written).toContain(fields.bpm.offset)
    expect(written).toContain(fields.beat.offset)
    expect(written).toContain(fields.valid.offset)
  })

  it('declares its Rust fields in the specification order', () => {
    // From the attributes above the struct, not from its name: repr(C) is what
    // makes the field order a byte layout, and it is written before the struct.
    const at = rust.indexOf('struct Transport')
    const body = rust.slice(Math.max(0, at - 80))
    const declared = [...body.slice(0, body.indexOf('}')).matchAll(/^\s*(\w+):\s*(?:u32|i32|f64),/gm)]
      .map(m => m[1])
    // Rust names are snake_case and the spec is camelCase.
    const expected = Object.entries(fields)
      .sort((a, b) => a[1].offset - b[1].offset)
      .map(([name]) => name.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`))
    expect(declared).toEqual(expected)
    expect(body).toMatch(/#\[repr\(C\)\]|repr\(C\)/)
  })
})

describe('the event record', () => {
  it('is 8 bytes everywhere', () => {
    expect(spec).toMatch(/\*\*8 bytes\*\*/)
    expect(abiHeader).toMatch(/sizeof\(MidiEvent\)\s*==\s*8/)
    expect(processor).toMatch(/EVENT_BYTES\s*=\s*8/)
  })

  it('puts frame, size and data where the specification says', () => {
    const section = spec.slice(spec.indexOf('## Events'))
    const table = section.slice(0, section.indexOf('## MIDI in'))
    expect(table).toMatch(/\|\s*0\s*\|\s*`u32`\s*\|\s*`frame`/)
    expect(table).toMatch(/\|\s*4\s*\|\s*`u8`\s*\|\s*`size`/)
    // The processor reads size at +4 and the bytes from +5.
    expect(processor).toMatch(/getUint8\(base \+ 4\)/)
    expect(processor).toMatch(/getUint8\(base \+ 5/)
    expect(processor).toMatch(/getUint32\(base, true\)/)
  })
})

describe('the valid bits', () => {
  it('mean the same thing in the spec, the host and the processor', () => {
    const section = spec.slice(spec.indexOf('`valid` is a bit field'))
    const table = section.slice(0, section.indexOf('**A module MUST check'))
    const bits = {}
    for (const line of table.split('\n')) {
      const match = line.match(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|/)
      if (match && match[2] !== 'Meaning') bits[Number(match[1])] = match[2]
    }
    expect(Object.keys(bits).length).toBe(5)
    expect(Object.keys(bits).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 4, 8, 16])

    for (const [constant, value] of [['kTransportBpm', 1], ['kTransportBeat', 2],
      ['kTransportBbt', 4], ['kTransportMeter', 8], ['kTransportSeconds', 16]]) {
      expect(abiHeader).toMatch(new RegExp(`${constant}\\s*=\\s*${value}`))
    }
    for (const [constant, value] of [['VALID_BPM', 1], ['VALID_BEAT', 2],
      ['VALID_BBT', 4], ['VALID_METER', 8], ['VALID_SECONDS', 16]]) {
      expect(processor).toMatch(new RegExp(`${constant}\\s*=\\s*${value}`))
    }
  })
})
