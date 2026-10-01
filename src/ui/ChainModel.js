// src/ui/ChainModel.js
//
// What a track's chain is, as data a view can draw: its plugins in the order the
// signal goes through them, what each takes and gives, where each sends and
// receives from, and which of those reach across to another track.
//
// Pure: it reads the project and is handed the things only the page knows (a
// plugin's profile, whether it failed to load). Drawing it as a strip and
// speaking it in words are both done from this, so they cannot disagree.
import { outputsOf, inputsOf, isMidiSignal } from '../model/Endpoints.js'
import { inSignalOrder } from '../ops/OpenProject.js'

/** 'MIDI', 'audio', or 'modulation' for a connection to a parameter. */
export function kindOf (connection) {
  if (isMidiSignal(connection.signalKind)) return 'MIDI'
  return connection.to.portSymbol !== undefined && connection.to.portSymbol !== null ? 'modulation' : 'audio'
}

const kindsOf = ports => [...new Set(ports.filter(p => p.portSymbol === undefined).map(p => (isMidiSignal(p.kind) ? 'MIDI' : 'audio')))]

const join = list => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`)

/**
 * `profileOf(nodeId)` gives a node's profile or undefined while it has not
 * loaded; `labelOf(nodeId)` its display name; `failedOf(nodeId)` why it failed
 * or null; `trackLabelOf(trackId)` a track's display name.
 */
export function describeChain (project, trackId, { profileOf, labelOf, failedOf, trackLabelOf }) {
  const track = project.track(trackId)
  const onTrack = project.nodes.filter(n => n.track === trackId)
  const ids = new Set(onTrack.map(n => n.id))
  const ordered = inSignalOrder(onTrack, project.connections)

  const nodes = ordered.map(node => {
    const profile = profileOf(node.id)
    const sends = project.connections
      .filter(c => c.from.node === node.id)
      .map(c => {
        const target = project.node(c.to.node)
        return {
          id: c.id, kind: kindOf(c), toNode: c.to.node, toLabel: labelOf(c.to.node),
          toTrack: target?.track ?? null, toTrackLabel: target ? trackLabelOf(target.track) : null,
          other: Boolean(target) && target.track !== trackId, parameter: c.to.portSymbol ?? null
        }
      })
    const receives = project.connections
      .filter(c => c.to.node === node.id && !ids.has(c.from.node))
      .map(c => {
        const source = project.node(c.from.node)
        return {
          id: c.id, kind: kindOf(c), fromNode: c.from.node, fromLabel: labelOf(c.from.node),
          fromTrack: source?.track ?? null, fromTrackLabel: source ? trackLabelOf(source.track) : null
        }
      })
    return {
      id: node.id,
      label: labelOf(node.id),
      loaded: profile !== undefined,
      failed: failedOf(node.id) ?? null,
      bypassed: node.bypassed === true,
      passesAudio: kindsOf(inputsOf(profile)).includes('audio') && kindsOf(outputsOf(profile)).includes('audio'),
      takes: kindsOf(inputsOf(profile)),
      gives: kindsOf(outputsOf(profile)),
      takesMidiFromTrack: track?.midiInput === node.id,
      takesAudioFromTrack: track?.audioInput === node.id,
      sends,
      receives
    }
  })
  return { trackId, nodes }
}

/** One node in words, for a screen reader and for a title. */
export function say (node) {
  const parts = [node.label]
  if (node.bypassed) parts.push('bypassed')
  if (node.failed) parts.push(`failed to load: ${node.failed}`)
  else if (!node.loaded) parts.push('not loaded yet')
  else {
    parts.push(node.takes.length ? `takes ${join(node.takes)}` : 'takes no signal')
    parts.push(node.gives.length ? `gives ${join(node.gives)}` : 'gives no signal')
  }
  if (node.takesMidiFromTrack) parts.push("the track's MIDI clips play into it")
  if (node.takesAudioFromTrack) parts.push("the track's audio clips play into it")
  for (const s of node.sends) {
    parts.push(`sends ${s.kind} to ${s.toLabel}${s.parameter ? ` (${s.parameter})` : ''}${s.other ? ` on ${s.toTrackLabel}` : ''}`)
  }
  for (const r of node.receives) parts.push(`receives ${r.kind} from ${r.fromLabel} on ${r.fromTrackLabel}`)
  return parts.join('; ')
}
