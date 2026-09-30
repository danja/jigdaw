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
import { inSignalOrder } from '../../src/ops/OpenProject.js'

export function createDockPanel (ctx) {
  const { document, window, log } = ctx
  let storage = null
  try { storage = window.localStorage } catch { /* storage unavailable */ }
  const dock = createDock(document, { slots: ['idle', 'midi', 'audio', 'track', 'tracks'], storage })

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
  const bulk = createBulkTrackPanel(document, {
    onChannel: change => {
      const ids = ctx.selection.ids
      const result = ctx.dispatcher.apply(ids.map(id => ({ op: 'setTrackChannel', track: id, ...change })))
      if (!result.ok) log(result.message, 'error')
    },
    onColor: color => { for (const id of ctx.selection.ids) layoutOf(id, { color }) },
    onSize: laneSize => { for (const id of ctx.selection.ids) layoutOf(id, { laneSize }) }
  })
  dock.slot('tracks').append(bulk.element)

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
  const trackPanel = createTrackPanel(document, {
    onRename: (id, label) => {
      const result = ctx.dispatcher.apply([{ op: 'setTrack', id, label }])
      if (!result.ok) log(result.message, 'error')
    },
    onColor: (id, color) => layoutOf(id, { color }),
    onSize: (id, laneSize) => layoutOf(id, { laneSize }),
    onMove: (id, delta) => ctx.dispatcher.project.moveTrack(id, delta),
    onDelete: id => {
      const { project } = ctx.dispatcher
      const label = trackLabel(project.track(id))
      // The plugins first, in the same changeset, so one undo brings all of it back.
      const changes = [
        ...project.nodes.filter(n => n.track === id).map(n => ({ op: 'removeNode', id: n.id })),
        { op: 'removeTrack', id }
      ]
      const result = ctx.dispatcher.apply(changes)
      if (result.ok) log(`removed ${label}; Undo brings it back`, 'ok')
      else log(result.message, 'error')
    }
  })
  dock.slot('track').append(trackPanel.element, chain.element)

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

    if (selection.kind === 'track' && selection.size > 1 && project) {
      const tracks = selection.ids.map(id => project.track(id)).filter(Boolean)
      bulk.show({ tracks, labels: tracks.map(trackLabel) })
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
        defaultName: trackLabel({ ...track, label: null }),
        layout: project.trackLayout(track.id),
        index: ordered.findIndex(t => t.id === track.id),
        count: ordered.length,
        plugins: project.nodes.filter(n => n.track === track.id).length
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

  return { dock, update, slot: name => dock.slot(name), get element () { return dock.element } }
}
