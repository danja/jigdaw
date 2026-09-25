// src/host/Zip.js
//
// A saved session with audio in it, as one file: session.ttl beside the media
// it refers to, in a zip. Written stored, not compressed, because audio does
// not compress and a stored zip is a hundred lines rather than a dependency.
// Read stored or deflated, because a person may zip a session folder with any
// tool, and the browser inflates for free (DecompressionStream).
//
// Deterministic: every entry carries the same timestamp, the zip epoch, so the
// same session writes the same bytes.
//
// What a zip may not do here is escape. An entry named with an absolute path
// or a ".." segment is refused, not resolved, because its name becomes part
// of an IRI the session is read against.

const LOCAL = 0x04034b50
const CENTRAL = 0x02014b50
const END = 0x06054b50
const UTF8 = 0x0800
// 1980-01-01 00:00, the earliest time a zip can say.
const DOS_DATE = (0 << 9) | (1 << 5) | 1
const DOS_TIME = 0

let crcTable = null
/** CRC-32, the zip polynomial. */
export function crc32 (bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Refuse a name that could point outside the archive. */
function checkName (name) {
  if (typeof name !== 'string' || name === '') throw new Error('a zip entry needs a name')
  if (name.startsWith('/') || name.includes('\\') || /^[a-z]:/i.test(name)) throw new Error(`a zip entry name must be relative: ${name}`)
  if (name.split('/').some(part => part === '..' || part === '.')) throw new Error(`a zip entry name must not step out of the archive: ${name}`)
}

/**
 * Write entries `[{ name, bytes }]` as a stored zip. Names are used as given,
 * in the order given.
 */
export function writeZip (entries) {
  const encoder = new TextEncoder()
  const parts = []
  const central = []
  let offset = 0
  for (const { name, bytes } of entries) {
    checkName(name)
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    if (data.length > 0xfffffffe) throw new Error(`${name} is too large for a zip without zip64`)
    const nameBytes = encoder.encode(name)
    const crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, LOCAL, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, UTF8, true)
    local.setUint16(8, 0, true)
    local.setUint16(10, DOS_TIME, true)
    local.setUint16(12, DOS_DATE, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, nameBytes.length, true)
    local.setUint16(28, 0, true)
    parts.push(new Uint8Array(local.buffer), nameBytes, data)

    const entry = new DataView(new ArrayBuffer(46))
    entry.setUint32(0, CENTRAL, true)
    entry.setUint16(4, 20, true)
    entry.setUint16(6, 20, true)
    entry.setUint16(8, UTF8, true)
    entry.setUint16(10, 0, true)
    entry.setUint16(12, DOS_TIME, true)
    entry.setUint16(14, DOS_DATE, true)
    entry.setUint32(16, crc, true)
    entry.setUint32(20, data.length, true)
    entry.setUint32(24, data.length, true)
    entry.setUint16(28, nameBytes.length, true)
    entry.setUint32(42, offset, true)
    central.push(new Uint8Array(entry.buffer), nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, END, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of all) { out.set(p, at); at += p.length }
  return out
}

/** Inflate raw deflate with the platform's own decompressor. */
async function inflate (bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * Read a zip into `Map name -> Uint8Array`. Directories are skipped. Refuses
 * an encrypted entry, a method other than stored or deflated, a name that
 * escapes, and an entry whose CRC does not match, each by name.
 */
export async function readZip (input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The end record is the last thing in the file, before a comment of at most 64 KiB.
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END) { end = i; break }
  }
  if (end < 0) throw new Error('not a zip: no end of central directory')
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const decoder = new TextDecoder()
  const files = new Map()
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== CENTRAL) throw new Error('not a zip: a central directory entry is damaged')
    const flags = view.getUint16(at + 8, true)
    const method = view.getUint16(at + 10, true)
    const crc = view.getUint32(at + 16, true)
    const compressedSize = view.getUint32(at + 20, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const localOffset = view.getUint32(at + 42, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    at += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue
    checkName(name)
    if (flags & 1) throw new Error(`${name} is encrypted, which this host does not read`)
    if (view.getUint32(localOffset, true) !== LOCAL) throw new Error(`${name}: its local header is damaged`)
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true)
    const raw = bytes.subarray(start, start + compressedSize)
    let data
    if (method === 0) data = raw.slice()
    else if (method === 8) data = await inflate(raw)
    else throw new Error(`${name} is compressed with method ${method}; only stored and deflated are read`)
    if (crc32(data) !== crc) throw new Error(`${name} is damaged: its checksum does not match`)
    files.set(name, data)
  }
  return files
}
