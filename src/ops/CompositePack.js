// src/ops/CompositePack.js
//
// What turning a selection of nodes into a composite plugin involves, worked out. docs/nested-plugins.md section 12.
//
// Pure, and read-only: it describes the composite a selection would be and changes nothing. The result is a document for a person to publish,
// because a composite is a plugin at an IRI, and an IRI is somewhere only they can put it.
//
// The boundary is read from what already surrounds the selection. A connection that crosses its edge becomes a boundary port, one for each
// distinct member port it touches, so a rack plugged into a mixer is plugged into it the same way after. Where nothing crosses, an effect's
// first member gets an input and its last gets an output, so the composite can be connected at all. Controls are the parameters the person
// has moved, since those are the ones they care about; everything else stays at the member's default. A control is never also a member
// setting, which the format forbids as two answers to one question.
import { isMidi } from '../engine/EventRouter.js'

const AUDIO = 'http://purl.org/stuff/transmissions/Audio'
const MIDI = 'http://purl.org/stuff/transmissions/Midi'
const trn = name => `http://purl.org/stuff/transmissions/${name}`
const MIDI_EVENTS = 'http://purl.org/stuff/jigdaw/MidiEvents'

const slug = label => {
  const s = String(label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s === '' ? 'member' : s
}
const symbolOf = text => String(text).replace(/[^A-Za-z0-9_]/g, '_').replace(/^([0-9])/, '_$1')

/**
 * @param project   the model: `node(id)`, `connections`, `track(id)`, `envelopes`
 * @param nodeIds   the selection
 * @param profileOf nodeId => the profile the engine holds for it, or null
 * @param expose    'set' makes a control of every parameter the person has moved; 'none' fixes them as the author's voicing
 * @returns {{ members, connections, ports, audioInputs, audioOutputs, roles, accepts, produces, requires, warnings }}
 * @throws a message saying what is wrong with the selection
 */
export function planPack ({ project, nodeIds, profileOf, expose = 'set' }) {
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) throw new Error('select at least one plugin to pack')
  if (new Set(nodeIds).size !== nodeIds.length) throw new Error('a node is selected twice')
  if (!['set', 'none'].includes(expose)) throw new Error(`expose is "set" or "none", not ${JSON.stringify(expose)}`)

  const nodes = nodeIds.map(id => {
    const node = project.node(id)
    if (!node) throw new Error(`no such node: ${id}`)
    if (!profileOf(id)) throw new Error(`${node.label ?? id} is not loaded, so what it takes and gives is not known`)
    return node
  })
  if (new Set(nodes.map(n => n.track)).size > 1) throw new Error('the selection is on more than one track, and a composite is on one')
  const bypassed = nodes.filter(n => n.bypassed === true)
  if (bypassed.length > 0) throw new Error(`${bypassed.map(n => n.label ?? n.id).join(', ')} is bypassed, and a composite has no way to carry that. Take it out of bypass first.`)

  // Member ids: the label as a name, unique within the composite.
  const taken = new Map()
  const idOf = new Map()
  for (const node of nodes) {
    const base = slug(node.label)
    const n = (taken.get(base) ?? 0) + 1
    taken.set(base, n)
    idOf.set(node.id, n === 1 ? base : `${base}-${n}`)
  }
  const selected = new Set(nodeIds)
  const warnings = []

  const connections = []
  const counters = new Map()
  const boundary = new Map()
  const allocate = (direction, kind, key) => {
    const full = `${direction}|${kind}|${key}`
    if (!boundary.has(full)) {
      const index = counters.get(`${direction}|${kind}`) ?? 0
      counters.set(`${direction}|${kind}`, index + 1)
      boundary.set(full, index)
    }
    return { index: boundary.get(full), full }
  }
  const portOf = e => (e.portSymbol !== undefined ? { portSymbol: e.portSymbol } : { portIndex: e.portIndex ?? 0 })

  for (const c of project.connections) {
    const fromIn = selected.has(c.from.node)
    const toIn = selected.has(c.to.node)
    if (fromIn && toIn) {
      connections.push({ from: { node: idOf.get(c.from.node), ...portOf(c.from) }, to: { node: idOf.get(c.to.node), ...portOf(c.to) }, signalKind: c.signalKind })
    } else if (toIn) {
      if (c.to.portSymbol !== undefined) {
        warnings.push(`the connection into ${project.node(c.to.node).label ?? c.to.node}'s parameter "${c.to.portSymbol}" is not carried: a composite offers only the controls it exposes`)
        continue
      }
      const key = `${idOf.get(c.to.node)}:${c.to.portIndex ?? 0}`
      const { index, full } = allocate('in', c.signalKind, key)
      if (!connections.some(x => x._boundary === full)) {
        connections.push({ _boundary: full, from: { node: null, portIndex: index }, to: { node: idOf.get(c.to.node), ...portOf(c.to) }, signalKind: c.signalKind })
      }
    } else if (fromIn) {
      const key = `${idOf.get(c.from.node)}:${c.from.portIndex ?? 0}`
      const { index, full } = allocate('out', c.signalKind, key)
      if (!connections.some(x => x._boundary === full)) {
        connections.push({ _boundary: full, from: { node: idOf.get(c.from.node), ...portOf(c.from) }, to: { node: null, portIndex: index }, signalKind: c.signalKind })
      }
    }
  }

  const has = (direction, audio) => [...boundary.keys()].some(k => k.startsWith(`${direction}|`) && (isMidi(k.split('|')[1]) !== audio))
  const mainAudio = (id, direction) => connections.some(c => c.signalKind === AUDIO && c.from.node !== null && c.to.node !== null &&
    (direction === 'in' ? c.to.node === id && c.to.portIndex === 0 : c.from.node === id && c.from.portIndex === 0))

  // An effect with nothing plugged into it still needs an input, and a chain with nothing plugged out of it an output, or the composite
  // cannot be connected to anything. Its first members take the input and its last members give the output.
  if (!has('in', true)) {
    for (const node of nodes) {
      const id = idOf.get(node.id)
      if ((profileOf(node.id).audioInputs ?? 0) > 0 && !mainAudio(id, 'in')) {
        connections.push({ from: { node: null, portIndex: 0 }, to: { node: id, portIndex: 0 }, signalKind: AUDIO })
        counters.set(`in|${AUDIO}`, 1)
      }
    }
  }
  if (!has('out', true)) {
    for (const node of nodes) {
      const id = idOf.get(node.id)
      if ((profileOf(node.id).audioOutputs ?? 0) > 0 && !mainAudio(id, 'out')) {
        connections.push({ from: { node: id, portIndex: 0 }, to: { node: null, portIndex: 0 }, signalKind: AUDIO })
        counters.set(`out|${AUDIO}`, 1)
      }
    }
  }

  // Notes played into the track reach the instrument in the selection, so the composite takes them in.
  const track = project.track(nodes[0].track)
  if (track?.midiInput && selected.has(track.midiInput) && !has('in', false)) {
    connections.push({ from: { node: null, portIndex: 0 }, to: { node: idOf.get(track.midiInput), portIndex: 0 }, signalKind: MIDI })
    counters.set(`in|${MIDI}`, 1)
  }

  const audioInputs = Math.max(0, ...connections.filter(c => c.from.node === null && !isMidi(c.signalKind)).map(c => c.from.portIndex + 1))
  const audioOutputs = Math.max(0, ...connections.filter(c => c.to.node === null && !isMidi(c.signalKind)).map(c => c.to.portIndex + 1))
  const midiIn = connections.some(c => c.from.node === null && isMidi(c.signalKind))
  const midiOut = connections.some(c => c.to.node === null && isMidi(c.signalKind))
  const midiInside = connections.some(c => c.from.node !== null && c.to.node !== null && isMidi(c.signalKind))

  const members = []
  const ports = []
  for (const node of nodes) {
    const id = idOf.get(node.id)
    const profile = profileOf(node.id)
    const settings = []
    for (const [symbol, value] of node.settings) {
      const port = (profile.ports ?? []).find(p => p.symbol === symbol)
      if (expose === 'set' && port && Number.isFinite(port.minimum) && Number.isFinite(port.maximum)) {
        let name = `${symbolOf(id)}_${symbol}`
        for (let n = 2; ports.some(p => p.symbol === name); n++) name = `${symbolOf(id)}_${symbol}_${n}`
        ports.push({
          symbol: name, name: `${node.label ?? id} ${port.name ?? symbol}`,
          minimum: port.minimum, maximum: port.maximum,
          defaultValue: Math.min(port.maximum, Math.max(port.minimum, value)),
          drives: [{ member: id, symbol }]
        })
      } else {
        if (expose === 'set') warnings.push(`${node.label ?? id}'s parameter "${symbol}" has no declared range, so it is fixed in the composite and not offered as a control`)
        settings.push({ symbol, value })
      }
    }
    if (node.state) warnings.push(`${node.label ?? id} has saved state, which a composite does not carry: it starts from its defaults`)
    if (project.envelopes.some(e => e.target.node === node.id)) warnings.push(`the automation on ${node.label ?? id} is not carried`)
    members.push({ id, plugin: node.pluginIri, settings })
  }

  const effect = audioInputs > 0
  return {
    members,
    connections: connections.map(({ _boundary, ...rest }) => rest),
    ports,
    audioInputs,
    audioOutputs,
    roles: effect ? [trn('AudioEffect')] : (audioOutputs > 0 || midiIn) ? [trn('Instrument'), trn('AudioInstrument')] : [trn('Utility')],
    accepts: [...(effect ? [AUDIO] : []), ...(midiIn ? [MIDI] : [])],
    produces: audioOutputs > 0 || !midiOut ? [AUDIO] : [MIDI],
    requires: midiIn || midiOut || midiInside ? [MIDI_EVENTS] : [],
    warnings
  }
}
