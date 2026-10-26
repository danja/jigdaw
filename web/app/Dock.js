// web/app/Dock.js
//
// The dock under the lanes: the editor for whatever is selected. A MIDI clip
// opens the piano roll, an audio clip its numbers, a track its chain. What is
// selected lives in ctx.selection, which the timeline writes and this reads;
// nothing here decides what is selected, so the WebMCP surface can share it.
import { createDock } from '../../src/ui/Dock.js'
import { createAudioClipPanel } from '../../src/ui/AudioClipPanel.js'
import { createChainSummary } from '../../src/ui/ChainSummary.js'
import { createTrackPanel } from '../../src/ui/TrackPanel.js'
import { createBulkTrackPanel } from '../../src/ui/BulkTrackPanel.js'
import { describeBus, placeBus } from '../../src/model/TrackBus.js'
import { describeLevelShift, describePanShift, groupMembers } from '../../src/model/GroupChannel.js'
import { trackHasMidi as hasMidi } from '../../src/model/MidiFile.js'
import { createNodeView } from '../../src/ui/NodeView.js'
import { createSendsPanel } from '../../src/ui/SendsPanel.js'
import { sendTargets, outputTargets } from '../../src/ui/SendsModel.js'
import { inSignalOrder } from '../../src/ops/OpenProject.js'
import { describeMidi } from '../../src/ui/MidiText.js'
import { MASTER_TRACK } from '../../src/model/ArrangementOps.js'

export function createDockPanel (ctx) {
  const { document, window, log } = ctx
  let storage = null
  try { storage = window.localStorage } catch { /* storage unavailable */ }
  const dock = createDock(document, { slots: ['idle', 'midi', 'audio', 'track', 'tracks', 'node'], storage, viewportHeight: () => window.innerHeight })
  window.addEventListener('resize', () => dock.refit())

  const idle = document.createElement('p')
  idle.className = 'dock-hint'
  dock.slot('idle').append(idle)

  const audio = createAudioClipPanel(document, {
    onSet: (id, change) => {
      const result = ctx.dispatcher.apply([{ op: 'setClip', id, ...change }])
      if (!result.ok) log(result.message, 'error')
    },
    onRemove: id => {
      const result = ctx.dispatcher.apply([{ op: 'removeClip', id }])
      if (!result.ok) log(result.message, 'error')
      else ctx.selection.clear()
    }
  })
  dock.slot('audio').append(audio.element)

  // Several tracks at once: one changeset for the channel, so one undo.
  const shift = (describe, amount, ids = ctx.selection.ids) => {
    let changes
    try { changes = describe(ctx.dispatcher.project, ids, amount) } catch (error) { log(error.message, 'error'); return }
    const result = ctx.dispatcher.apply(changes)
    if (!result.ok) log(result.message, 'error')
  }
  // A track's MIDI to a file; the page's exporter is built after the dock, so it is looked up when pressed.
  const exportMidi = trackIds => {
    try { ctx.midiExport.exportMidi({ trackIds }) } catch (error) { log(error.message, 'error') }
  }
  const bulk = createBulkTrackPanel(document, {
    onChannel: change => {
      const ids = ctx.selection.ids
      const result = ctx.dispatcher.apply(ids.map(id => ({ op: 'setTrackChannel', track: id, ...change })))
      if (!result.ok) log(result.message, 'error')
    },
    onLevelShift: decibels => shift(describeLevelShift, decibels),
    onPanShift: amount => shift(describePanShift, amount),
    onColor: color => { for (const id of ctx.selection.ids) layoutOf(id, { color }) },
    onSize: laneSize => { for (const id of ctx.selection.ids) layoutOf(id, { laneSize, laneHeight: null }) },
    onFolder: folder => { for (const id of ctx.selection.ids) layoutOf(id, { folder }) },
    onExportMidi: () => exportMidi(ctx.selection.ids),
    onBus: label => {
      const members = ctx.selection.ids
      let changes
      try { changes = describeBus(ctx.dispatcher.project, members, label === undefined ? {} : { label }) } catch (error) { log(error.message, 'error'); return }
      const result = ctx.dispatcher.apply(changes)
      if (!result.ok) log(result.message, 'error')
      else {
        placeBus(ctx.dispatcher.project, changes[0].id, members)
        ctx.selection.set('track', [changes[0].id])
      }
    }
  })
  dock.slot('tracks').append(bulk.element)

  let nodeTrack = null
  const nodeView = createNodeView(document, {
    onDisconnect: id => {
      const result = ctx.dispatcher.apply([{ op: 'removeConnection', id }])
      if (!result.ok) log(result.message, 'error')
    },
    onRange: (id, change) => {
      const result = ctx.dispatcher.apply([{ op: 'setConnection', id, ...change }])
      if (!result.ok) log(result.message, 'error')
    },
    onConnect: ({ from, to }) => {
      const result = ctx.dispatcher.apply([{
        op: 'addConnection',
        from: { node: from.node, portIndex: from.portIndex },
        to: to.portSymbol !== undefined ? { node: to.node, portSymbol: to.portSymbol } : { node: to.node, portIndex: to.portIndex },
        signalKind: from.kind
      }])
      // A refusal is shown as it came, including a loop with no declared delay.
      if (!result.ok) log(result.message, 'error')
      else {
        const name = id => { const n = ctx.dispatcher.project.node(id); return n?.label ?? ctx.dispatcher.engineNode(id)?.profile?.label ?? id }
        log(`connected ${name(from.node)} to ${name(to.node)}`, 'ok')
      }
    },
    // A lane for one parameter, starting at the value it has now. The lane is drawn under the track.
    onAutomate: (nodeId, symbol) => {
      const { project } = ctx.dispatcher
      const port = ctx.dispatcher.engineNode(nodeId)?.profile?.ports?.find(p => p.symbol === symbol)
      const start = project.node(nodeId)?.settings.get(symbol) ?? port?.defaultValue
      const result = ctx.dispatcher.apply([{ op: 'addEnvelope', target: { node: nodeId, symbol }, points: start === undefined ? [] : [{ atBeat: 0, value: start, curve: 'linear' }] }])
      if (!result.ok) log(result.message, 'error')
      else log(`added an automation lane for ${port?.name ?? symbol}, under the track`, 'ok')
    },
    onShowPlugin: () => {
      ctx.tabs.select('tracks')
      document.getElementById(`track-group-${nodeTrack}`)?.scrollIntoView({ block: 'start' })
      document.getElementById(`track-name-${nodeTrack}`)?.focus({ preventScroll: true })
    }
  })
  dock.slot('node').append(nodeView.element)

  let chainTrack = null
  const chain = createChainSummary(document, {
    onShowPlugins: () => {
      ctx.tabs.select('tracks')
      document.getElementById(`track-group-${chainTrack}`)?.scrollIntoView({ block: 'start' })
      document.getElementById(`track-name-${chainTrack}`)?.focus({ preventScroll: true })
    }
  })
  const layoutOf = (id, patch) => {
    try { ctx.dispatcher.project.setTrackLayout(id, patch) } catch (error) { log(error.message, 'error') }
  }
  /** A track and the plugins on it, in one changeset, so one undo brings all of it back. */
  function deleteTrack (id) {
    const { project } = ctx.dispatcher
    const label = trackLabel(project.track(id))
    const changes = [
      ...project.nodes.filter(n => n.track === id).map(n => ({ op: 'removeNode', id: n.id })),
      { op: 'removeTrack', id }
    ]
    const result = ctx.dispatcher.apply(changes)
    if (result.ok) log(`removed ${label}; Undo brings it back`, 'ok')
    else log(result.message, 'error')
  }
  const trackPanel = createTrackPanel(document, {
    onRename: (id, label) => {
      const result = ctx.dispatcher.apply([{ op: 'setTrack', id, label }])
      if (!result.ok) log(result.message, 'error')
    },
    onColor: (id, color) => layoutOf(id, { color }),
    onFolder: (id, folder) => layoutOf(id, { folder }),
    onGroupLevel: (id, decibels) => shift(describeLevelShift, decibels, groupMembers(ctx.dispatcher.project, id)),
    onGroupPan: (id, amount) => shift(describePanShift, amount, groupMembers(ctx.dispatcher.project, id)),
    onExportMidi: id => exportMidi([id]),
    onMove: (id, delta) => ctx.dispatcher.project.moveTrack(id, delta),
    onFreeze: id => {
      ctx.bounce.freezeTrack(id).catch(error => log(error.message, 'error'))
    },
    onDelete: id => deleteTrack(id)
  })
  // Output and sends of the selected track, as ordinary Ops: the model refuses a loop
  // of tracks, and the reason is logged as it came.
  const apply = changes => {
    const result = ctx.dispatcher.apply(changes)
    if (!result.ok) log(result.message, 'error')
  }
  const sendsPanel = createSendsPanel(document, {
    onOutput: to => apply([{ op: 'setTrack', id: chainTrack, output: to }]),
    onAdd: (to, kind) => apply([kind === 'midi' ? { op: 'addSend', from: chainTrack, to, kind } : { op: 'addSend', from: chainTrack, to, level: 1, tap: 'post' }]),
    onLevel: (id, level) => apply([{ op: 'setSend', id, level }]),
    onTap: (id, tap) => apply([{ op: 'setSend', id, tap }]),
    onRemove: id => apply([{ op: 'removeSend', id }]),
    onRange: (id, change) => apply([{ op: 'setSend', id, ...change }])
  })
  dock.slot('track').append(trackPanel.element, sendsPanel.element, chain.element)

  const trackLabel = track => {
    const { project } = ctx.dispatcher
    return ctx.rack.trackLabel(track, project.tracks.indexOf(track))
  }

  /** Show what the selection calls for. Cheap and idempotent: called on every redraw. */
  function update () {
    const project = ctx.dispatcher?.project
    const { selection, arrangement } = ctx
    const only = selection.size === 1 ? selection.ids[0] : null
    const clip = selection.kind === 'clip' && only ? project?.clip(only) : null
    const track = selection.kind === 'track' && only ? project?.track(only) : null

    if (clip?.kind === 'midi') {
      if (arrangement.rollClipId !== clip.id) arrangement.showInRoll(clip.id)
      dock.show('midi', `Editor: MIDI clip on ${trackLabel(project.track(clip.track))}`)
      return
    }
    // Nothing else is editing a clip, so the roll stops holding one.
    if (arrangement.rollClipId !== null) arrangement.hideRoll()

    const node = selection.kind === 'node' && only ? project?.node(only) : null
    if (node) {
      const labelOf = id => { const n = project.node(id); return n?.label ?? ctx.dispatcher.engineNode(id)?.profile?.label ?? id }
      const tl = id => (id === MASTER_TRACK ? 'Master bus' : trackLabel(project.track(id)))
      nodeTrack = node.track
      nodeView.show({
        node,
        label: labelOf(node.id),
        trackLabel: tl(node.track),
        profile: ctx.dispatcher.engineNode(node.id)?.profile,
        connections: project.connections.filter(c => c.from.node === node.id || c.to.node === node.id),
        others: project.nodes.filter(n => n.id !== node.id).map(n => ({
          node: n, profile: ctx.dispatcher.engineNode(n.id)?.profile, label: labelOf(n.id), trackLabel: tl(n.track)
        })),
        labelFor: labelOf,
        panel: ctx.rack.panelFor(node),
        automated: new Set(project.envelopes.filter(e => e.target.node === node.id).map(e => e.target.symbol)),
        monitor: connectionId => ctx.dispatcher.midiActivity(connectionId).map(e => describeMidi(e.bytes))
      })
      dock.show('node', `Editor: ${labelOf(node.id)}`)
      return
    }

    if (selection.kind === 'track' && selection.size > 1 && project) {
      const tracks = selection.ids.map(id => project.track(id)).filter(Boolean)
      const folderOf = t => project.trackLayout(t.id).folder
      bulk.show({
        tracks,
        labels: tracks.map(trackLabel),
        folders: [...new Set(project.orderedTracks.map(folderOf).filter(Boolean))],
        inFolder: tracks.filter(folderOf).length,
        hasMidi: tracks.some(t => hasMidi(project, t.id))
      })
      dock.show('tracks', `Editor: ${tracks.length} tracks`)
      return
    }

    if (clip?.kind === 'audio') {
      const owner = project.track(clip.track)
      audio.show(clip, {
        beatsPerBar: project.transport.beatsPerBar,
        label: trackLabel(owner),
        unplayable: ctx.clipPlayer?.failure(clip.source)?.message ?? null
      })
      dock.show('audio', `Editor: audio clip on ${trackLabel(owner)}`)
    } else if (track) {
      chainTrack = track.id
      const ordered = project.orderedTracks
      trackPanel.show({
        id: track.id,
        name: track.label,
        // Indexed by the track itself: a copy of it is not in the list, and indexOf would say -1 and name the first track "Track 0".
        defaultName: ctx.rack.trackLabel({ ...track, label: null }, project.tracks.indexOf(track)),
        layout: project.trackLayout(track.id),
        folders: [...new Set(ordered.map(t => project.trackLayout(t.id).folder).filter(Boolean))],
        index: ordered.findIndex(t => t.id === track.id),
        count: ordered.length,
        plugins: project.nodes.filter(n => n.track === track.id).length,
        members: groupMembers(project, track.id).length,
        hasMidi: hasMidi(project, track.id)
      })
      const nodes = inSignalOrder(project.nodes.filter(n => n.track === track.id), project.connections)
      const labelOf = node => node.label ?? ctx.dispatcher.engineNode(node.id)?.profile?.label ?? node.id
      const named = id => { const n = project.node(id); return n ? labelOf(n) : null }
      chain.show({
        label: trackLabel(track),
        nodes,
        labelOf,
        midiInputLabel: track.midiInput ? named(track.midiInput) : null,
        audioInputLabel: track.audioInput ? named(track.audioInput) : null
      })
      const asOption = t => ({ id: t.id, label: trackLabel(t) })
      sendsPanel.show({
        label: trackLabel(track),
        output: track.output,
        outputOptions: outputTargets(project, track.id).map(asOption),
        sends: project.sends.filter(s => s.from === track.id).map(s => ({ id: s.id, toLabel: trackLabel(project.track(s.to)), kind: s.kind ?? 'audio', level: s.level, tap: s.tap, lowNote: s.lowNote, highNote: s.highNote })),
        addOptions: sendTargets(project, track.id).map(asOption),
        // Only where the target has somewhere for MIDI to play, which is its MIDI input.
        midiAddOptions: sendTargets(project, track.id, 'midi').filter(t => t.midiInput).map(asOption)
      })
      dock.show('track', `Editor: ${trackLabel(track)}`)
    } else {
      idle.textContent = selection.size > 1
        ? `${selection.size} ${selection.kind}s selected.`
        : 'Select a clip to edit it, or a track to see its plugins.'
      dock.show('idle', 'Editor')
    }
  }

  // The timeline writes the selection and never calls the dock, so this is what
  // makes a click on a track name or a Shift-click on a clip show anything.
  ctx.selection.subscribe(() => update())

  // The open MIDI watches in the plugin view follow the traffic while it is on screen: twice a second,
  // message thread, nothing from process().
  setInterval(() => { if (dock.shown === 'node') nodeView.refreshMonitors() }, 500)

  return { dock, update, deleteTrack, slot: name => dock.slot(name), get element () { return dock.element } }
}
