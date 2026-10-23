// src/model/MidiRead.js
//
// A Standard MIDI File read into plain data: the notes of each track, the tempo changes and the time signature changes, all in
// ticks. It judges nothing about the project; src/model/MidiImport.js turns it into changes. Format 0 and 1 are read, and a
// file in ticks per quarter note. A file that is cut short, is not a MIDI file, or counts time in frames is refused with the
// reason, never half read.

const DECODER = new TextDecoder('utf-8')

class Reader {
  constructor (bytes) { this.bytes = bytes; this.at = 0 }
  need (n, what) { if (this.at + n > this.bytes.length) throw new Error(`the file ends inside ${what}`) }
  u8 (what) { this.need(1, what); return this.bytes[this.at++] }
  u16 (what) { this.need(2, what); const v = (this.bytes[this.at] << 8) | this.bytes[this.at + 1]; this.at += 2; return v }
  u32 (what) { this.need(4, what); const b = this.bytes; const v = ((b[this.at] << 24) | (b[this.at + 1] << 16) | (b[this.at + 2] << 8) | b[this.at + 3]) >>> 0; this.at += 4; return v }
  text (n, what) { this.need(n, what); const s = String.fromCharCode(...this.bytes.slice(this.at, this.at + n)); this.at += n; return s }
  slice (n, what) { this.need(n, what); const s = this.bytes.slice(this.at, this.at + n); this.at += n; return s }
  vlq (what) {
    let value = 0
    for (let i = 0; i < 4; i++) {
      const b = this.u8(what)
      value = (value * 128) + (b & 0x7f)
      if (!(b & 0x80)) return value
    }
    throw new Error(`a delta time in ${what} is longer than four bytes`)
  }
}

/** The events of one MTrk chunk, with ticks counted from its start. */
function readTrack (bytes, what) {
  const r = new Reader(bytes)
  const notes = []
  const controllers = []
  const tempos = []
  const signatures = []
  let name = null
  let tick = 0
  let status = 0
  const open = new Map()
  const close = (channel, pitch) => {
    const list = open.get(`${channel}:${pitch}`)
    const started = list?.shift()
    if (started) notes.push({ tick: started.tick, ticks: Math.max(1, tick - started.tick), pitch, velocity: started.velocity, channel })
  }
  while (r.at < bytes.length) {
    tick += r.vlq(what)
    let first = r.u8(what)
    if (first & 0x80) { status = first; first = null } else if (!status) throw new Error(`${what} starts without a status byte`)
    if (status === 0xff) {
      const type = r.u8(what)
      const data = r.slice(r.vlq(what), what)
      if (type === 0x03 && name === null) name = DECODER.decode(data)
      else if (type === 0x51 && data.length === 3) tempos.push({ tick, microsPerQuarter: (data[0] << 16) | (data[1] << 8) | data[2] })
      else if (type === 0x58 && data.length >= 2) signatures.push({ tick, numerator: data[0], denominator: 2 ** data[1] })
      else if (type === 0x2f) break
      status = 0
    } else if (status === 0xf0 || status === 0xf7) {
      r.slice(r.vlq(what), what)
      status = 0
    } else {
      const kind = status & 0xf0
      const channel = status & 15
      const one = kind === 0xc0 || kind === 0xd0
      const a = first ?? r.u8(what)
      const b = one ? 0 : r.u8(what)
      if (kind === 0x90 && b > 0) {
        const key = `${channel}:${a}`
        if (!open.has(key)) open.set(key, [])
        open.get(key).push({ tick, velocity: b })
      } else if (kind === 0x80 || (kind === 0x90 && b === 0)) close(channel, a)
      else if (kind === 0xb0) controllers.push({ tick, channel, controller: a, value: b })
      // A bend is two seven bit halves, the lower first, and zero is the wheel at rest in the middle of fourteen bits.
      else if (kind === 0xe0) controllers.push({ tick, channel, controller: 'pitchBend', value: ((b << 7) | a) - 8192 })
    }
  }
  // A note still sounding when the track ends stops there.
  for (const [key, list] of open) {
    const [channel, pitch] = key.split(':').map(Number)
    for (const started of list) notes.push({ tick: started.tick, ticks: Math.max(1, tick - started.tick), pitch, velocity: started.velocity, channel })
  }
  notes.sort((x, y) => x.tick - y.tick || x.pitch - y.pitch)
  return { name, notes, controllers, tempos, signatures, endTick: tick }
}

/**
 * `{ format, division, tracks: [{ name, notes: [{tick, ticks, pitch, velocity, channel}], controllers: [{tick, channel, controller,
 * value}] }], tempos: [{tick, microsPerQuarter}], signatures: [{tick, numerator, denominator}] }`. A controller is a number 0 to
 * 127 or 'pitchBend' (value -8192 to 8191). A format 0 file's one track is split by channel, since each channel is a part;
 * tracks with no notes and no controller events (a conductor) are left out.
 */
export function readMidiFile (bytes) {
  const r = new Reader(bytes)
  if (bytes.length < 14 || r.text(4, 'the header') !== 'MThd') throw new Error('this is not a MIDI file: it does not start with MThd')
  const length = r.u32('the header')
  const format = r.u16('the header')
  const count = r.u16('the header')
  const division = r.u16('the header')
  r.at = 8 + length
  if (format > 1) throw new Error(`a format ${format} MIDI file is not supported; only format 0 and 1 are`)
  if (division & 0x8000) throw new Error('this file counts time in frames, not beats; only ticks per quarter note are supported')
  if (division === 0) throw new Error('this file has no ticks per quarter note')
  const parsed = []
  for (let i = 0; i < count; i++) {
    if (r.at >= bytes.length) break
    const tag = r.text(4, `track ${i + 1}`)
    const size = r.u32(`track ${i + 1}`)
    const body = r.slice(size, `track ${i + 1}`)
    if (tag === 'MTrk') parsed.push(readTrack(body, `track ${i + 1}`))
  }
  if (parsed.length === 0) throw new Error('this MIDI file has no tracks')
  const tempos = parsed.flatMap(t => t.tempos).sort((a, b) => a.tick - b.tick)
  const signatures = parsed.flatMap(t => t.signatures).sort((a, b) => a.tick - b.tick)
  let tracks = parsed
  if (format === 0) {
    const used = [...new Set(parsed.flatMap(t => [...t.notes, ...t.controllers].map(n => n.channel)))].sort((a, b) => a - b)
    tracks = used.map(channel => ({ name: `Channel ${channel + 1}`, notes: parsed.flatMap(t => t.notes).filter(n => n.channel === channel), controllers: parsed.flatMap(t => t.controllers).filter(n => n.channel === channel) }))
  }
  return {
    format,
    division,
    tracks: tracks.filter(t => t.notes.length > 0 || t.controllers.length > 0).map(t => ({ name: t.name, notes: t.notes, controllers: t.controllers })),
    tempos,
    signatures
  }
}
