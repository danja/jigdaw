// web/app/Rack.js
//
// The Plugins tab: each track, its plugins in order, their ports, panels and
// keyboards, and the connections between them. Also the Mixer tab's strips and
// the Load onto menu, because all three are drawn from the same pass over the
// project, and a second pass drawing any of them would fall out of step.
//
// Rebuilt from the project on every change, with the focus put back, rather
// than diffed: after an edit the page is exactly what the model says.
import { createMixer } from '../../src/ui/Mixer.js'
import { createSlots } from './RackSlot.js'
import { createConnectionList } from '../../src/ui/Routing.js'
import { preserveFocus } from '../../src/ui/Focus.js'
import { isMidi, carriesNotes } from '../../src/engine/EventRouter.js'
import { describeMidi } from '../../src/ui/MidiText.js'
import { MASTER_TRACK } from '../../src/model/ArrangementOps.js'
import { chainSwapChanges } from '../../src/ops/ChainReorder.js'
import { fxPluginsOf as describeFx } from '../../src/ui/FxModel.js'

export { slotTitle } from './RackSlot.js'

// Where Load puts a plugin: a track id, or NEW_TRACK for a track of its own.
export const NEW_TRACK = ''
// The master bus is a place a plugin can go, and its id is the model's (src/model/ArrangementOps.js).
export const MASTER_TARGET = MASTER_TRACK

export function createRack (ctx) {
  const { document, window, $, log } = ctx
  // Each node's generated panel, kept across redraws so a control keeps its
  // element, and so its focus can be put back.
  const panels = new Map()
  // Every on-screen keyboard drawn, so Panic can release what they hold.
  const keyboards = new Set()
  // The track last chosen or last loaded onto; null until then, which means
  // the newest track.
  let loadTarget = null
  // The connection list on the page now, so its open MIDI watches can be redrawn on a timer.
  let watching = null

  // What each channel's FX list does beyond Add and Remove: the same things the chain strip does, as the same Ops.
  const fxActions = {
    onBypass: (nodeId, bypassed) => editNode([{ op: 'setNode', id: nodeId, bypassed }]),
    onMove: (nodeId, delta) => movePlugin(nodeId, delta),
    onReplace: nodeId => ctx.swap.begin(nodeId),
    onShow: nodeId => showPlugin(nodeId)
  }

  // One strip per track, on the Mixer tab. The strips are the mixer's own to
  // cache, and a track that has gone takes its strip with it (src/ui/Mixer.js).
  const mixer = createMixer(document, {
    onChange: (trackId, change) => {
      const result = ctx.dispatcher.setTrackChannel(trackId, change)
      if (!result.ok) log(result.message, 'error')
    },
    menu: ctx.menu,
    onAddPlugin: trackId => addPluginTo(trackId),
    onRemovePlugin: nodeId => removePlugin(nodeId),
    fxActions
  })

  const editNode = changes => {
    const result = ctx.dispatcher.apply(changes)
    if (!result.ok) log(result.message, 'error')
    return result
  }

  /** The FX list's Move earlier and Move later: the same swap as the chain strip's, one changeset, one undo. */
  function movePlugin (nodeId, delta) {
    try {
      const passesAudio = id => {
        const profile = ctx.dispatcher.engineNode(id)?.profile
        return (profile?.audioInputs ?? 0) > 0 && (profile?.audioOutputs ?? 0) > 0
      }
      editNode(chainSwapChanges(ctx.dispatcher.project, nodeId, delta, { passesAudio }))
    } catch (error) { log(error.message, 'error') }
  }

  /** The FX list's Controls: the Plugins tab, at the plugin's track. */
  function showPlugin (nodeId) {
    ctx.tabs.select('tracks')
    const track = ctx.dispatcher.project.node(nodeId)?.track
    document.getElementById(`track-group-${track}`)?.scrollIntoView({ block: 'start' })
  }

  /** The plugins on a track, or the master, as the FX list draws them (src/ui/FxModel.js). */
  function fxPluginsOf (trackId) {
    const { project } = ctx.dispatcher
    return describeFx(project, trackId, {
      profileOf: id => ctx.dispatcher.engineNode(id)?.profile,
      labelOf: id => { const n = project.node(id); return n?.label ?? ctx.dispatcher.engineNode(id)?.profile?.label ?? id },
      failedOf: id => ctx.dispatcher.engineNode(id)?.failed ?? null,
      trackLabelOf: id => trackLabel(project.track(id), project.tracks.indexOf(project.track(id)))
    })
  }

  /** The FX list's Add: the next Load goes onto this track, and the Browser opens to choose it. */
  function addPluginTo (trackId) {
    loadTarget = trackId
    drawTargets()
    ctx.layout.showBrowser(true)
  }

  /** The FX list's Remove: the same Op as Remove on the Plugins tab, healing the chain where it stood. */
  function removePlugin (nodeId) {
    const node = ctx.dispatcher.project.node(nodeId)
    const result = ctx.dispatcher.apply([{ op: 'removeNode', id: nodeId, heal: true }])
    if (!result.ok) log(result.message, 'error')
    else { forgetNode(nodeId); log(`removed ${node?.label ?? nodeId}`) }
  }

  /** Drop everything cached for one node: its panel. */
  const forgetNode = id => { panels.delete(id) }
  // Each plugin's slot, and the wire or gap between two (RackSlot.js).
  const slots = createSlots(ctx, { panels, keyboards, redraw: () => drawRack(), forgetNode })

  /** What a track is called, for a heading or a control's name. */
  function trackLabel (track, index) {
    return track.label ?? `Track ${index + 1}`
  }

  /**
   * The Load onto menu: every track, and a new one. Shows the track last chosen
   * or last loaded onto while it is still there, and otherwise the newest, so
   * loading an instrument and then an effect puts the effect after the
   * instrument rather than on a track of its own.
   */
  function drawTargets () {
    const select = $('target')
    const made = ctx.dispatcher?.project.tracks ?? []
    const tracks = ctx.dispatcher?.project.orderedTracks ?? []
    const options = [
      ...tracks.map(track => ({ value: track.id, label: trackLabel(track, made.indexOf(track)) })),
      { value: MASTER_TARGET, label: 'The master bus' },
      { value: NEW_TRACK, label: 'A new track' }
    ]
    select.replaceChildren(...options.map(({ value, label }) => {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      return option
    }))
    select.value = loadTarget !== null && options.some(o => o.value === loadTarget)
      ? loadTarget
      : (tracks.at(-1)?.id ?? NEW_TRACK)
  }

  function drawRack () {
    const rack = $('rack')

    // Emptying the rack blurs whatever was focused inside it, and every
    // parameter change redraws the rack, so a control could be nudged once by
    // keyboard and then lost the focus: one arrow key moved a knob one step and
    // the second went to the body. That is WCAG 2.1.1 gone on every generated
    // control, and it predates the knobs. The ids are stable, so the focus is
    // put back on the same control after the rebuild.
    const restoreFocus = preserveFocus(rack)

    rack.textContent = ''

    const { dispatcher } = ctx
    // In the order the arrangement shows them. A default name is numbered by the
    // order tracks were made, so moving one never renames another.
    const tracks = dispatcher?.project.orderedTracks ?? []
    const made = dispatcher?.project.tracks ?? []
    const nodes = dispatcher?.project.nodes ?? []
    const connections = dispatcher?.project.connections ?? []
    // An editor whose plugin has gone, by removal or undo, goes with it.
    ctx.editors.keepOnly(new Set(nodes.map(n => n.id)))
    // Two instances of one plugin are two nodes with the same label, which is
    // ordinary and which made the connection list read "Pulse out 1 to Cascade
    // in 1" twice for two different edges. A person cannot tell those apart and
    // neither can a screen reader, which announces the disconnect buttons by the
    // same name. Numbered only where a name is shared, so the common case stays
    // "Cascade" rather than becoming "Cascade 1".
    const seen = new Map()
    const names = new Map()
    for (const node of nodes) {
      const base = node.label ?? node.pluginIri
      const count = (seen.get(base) ?? 0) + 1
      seen.set(base, count)
      names.set(node.id, { base, count })
    }
    const labelFor = id => {
      const found = names.get(id)
      if (!found) return id
      return seen.get(found.base) > 1 ? `${found.base} ${found.count}` : found.base
    }
    // The same rule for tracks: a plugin loaded twice onto new tracks names both
    // after itself, and two mixer channels both headed "Pulse" cannot be told
    // apart. Numbered only where the name is shared.
    const trackNames = tracks.map(t => trackLabel(t, made.indexOf(t)))
    const labelOfTrack = track => {
      const i = tracks.indexOf(track)
      const name = trackNames[i]
      const sharing = trackNames.filter(n => n === name).length
      return sharing > 1 ? `${name} ${trackNames.slice(0, i + 1).filter(n => n === name).length}` : name
    }

    // Drawn from here rather than from a second call site, so the Mixer tab
    // cannot fall out of step with the Tracks tab. Before the empty check below,
    // because the mixer answers its own empty case.
    const restoreMixerFocus = preserveFocus(mixer.element)
    mixer.draw({
      tracks,
      nodes,
      audibility: dispatcher?.audibility() ?? [],
      audioOutputsOf: id => dispatcher.engineNode(id)?.profile?.audioOutputs,
      labelFor: labelOfTrack,
      pluginsOf: trackId => fxPluginsOf(trackId).map(plugin => ({ ...plugin, label: labelFor(plugin.id) }))
    })
    restoreMixerFocus()
    drawTargets()
    ctx.arrangement.draw(tracks, labelOfTrack)
    ctx.matrix.draw()
    ctx.master.update()
    ctx.launcher?.draw()

    const masterNodes = nodes.filter(n => n.track === MASTER_TRACK)
    if (tracks.length === 0 && masterNodes.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = 'Nothing loaded. Search for a plugin, or press Load to add the synth.'
      rack.append(empty)
      return
    }

    for (const track of tracks) {
      rack.append(drawTrack(track, {
        tracks, labelOfTrack, labelFor, connections,
        nodes: nodes.filter(n => n.track === track.id),
        allNodes: nodes
      }))
    }
    // Where the mix of every track goes through, after the tracks that feed it. Drawn only when a plugin is
    // on it: an empty master has nothing to show but a way to put one there, which Load onto already is.
    if (masterNodes.length > 0) {
      rack.append(drawMaster({ tracks, labelOfTrack, labelFor, connections, nodes: masterNodes, allNodes: nodes }))
    }

    // Derived from the connections, and the only place in the interface that can
    // tell the truth about a graph that is not a chain. The stack above shows the
    // nodes in the order they were loaded; this shows what is actually joined.
    const heading = document.createElement('h3')
    heading.className = 'connections-heading'
    heading.textContent = 'Connections'
    const connectionList = createConnectionList(document, {
      connections,
      labelFor,
      monitor: id => dispatcher.midiActivity(id).map(e => describeMidi(e.bytes)),
      onRange: (id, change) => {
        const result = dispatcher.apply([{ op: 'setConnection', id, ...change }])
        if (!result.ok) log(result.message, 'error')
        drawRack()
      },
      onRemove: id => {
        const result = dispatcher.apply([{ op: 'removeConnection', id }])
        if (!result.ok) log(result.message, 'error')
        drawRack()
      }
    })
    rack.append(heading, connectionList)
    watching = connectionList

    restoreFocus()
  }

  /**
   * One track: a header naming it, then its plugins in order.
   *
   * The header's controls are the track's own: rename it, and remove it once it
   * is empty. Remove is left out while plugins are on it rather than disabled,
   * because the model refuses it then (CLAUDE.md: a control nobody can use is
   * left out), and removing a track's plugins is a deliberate act of its own.
   */
  function drawTrack (track, { tracks, labelOfTrack, labelFor, connections, nodes, allNodes }) {
    const { dispatcher } = ctx
    const group = document.createElement('section')
    group.className = 'track'
    group.id = `track-group-${track.id}`
    const title = labelOfTrack(track)
    group.setAttribute('aria-label', `Track ${title}`)

    const header = document.createElement('div')
    header.className = 'track-header'
    const heading = document.createElement('h3')
    heading.textContent = title
    header.append(heading)

    const rename = document.createElement('input')
    rename.type = 'text'
    rename.id = `track-name-${track.id}`
    rename.value = track.label ?? ''
    rename.placeholder = title
    rename.setAttribute('aria-label', `Name of track ${title}`)
    // On change, not on input: a rename is one edit, not one per keystroke.
    rename.addEventListener('change', () => {
      const label = rename.value.trim() || null
      const result = dispatcher.apply([{ op: 'setTrack', id: track.id, label }])
      if (!result.ok) log(result.message, 'error')
    })
    header.append(rename)

    // Which plugin this track's MIDI clips play into. Only where a plugin on it
    // accepts MIDI: a menu with nothing to choose is a control nobody can use.
    const takesMidi = nodes.filter(n => (dispatcher.engineNode(n.id)?.profile?.accepts ?? []).some(carriesNotes))
    if (takesMidi.length > 0) {
      const midi = document.createElement('select')
      midi.id = `midi-input-${track.id}`
      midi.setAttribute('aria-label', `Which plugin ${title}'s MIDI clips play into`)
      for (const [value, text] of [['', 'Clips play into nothing'], ...takesMidi.map(n => [n.id, `Clips play into ${labelFor(n.id)}`])]) {
        const option = document.createElement('option')
        option.value = value
        option.textContent = text
        midi.append(option)
      }
      midi.value = track.midiInput ?? ''
      midi.addEventListener('change', () => {
        const result = dispatcher.apply([{ op: 'setTrack', id: track.id, midiInput: midi.value || null }])
        if (!result.ok) log(result.message, 'error')
      })
      header.append(midi)
    }

    // Where audio that arrives at this track goes: its audio clips, a send, a bus output. Only where a plugin
    // on it takes audio in, for the same reason as the MIDI menu above.
    const takesAudio = nodes.filter(n => (dispatcher.engineNode(n.id)?.profile?.audioInputs ?? 0) > 0)
    if (takesAudio.length > 0) header.append(audioInputSelect({ id: track.id, title, nodes: takesAudio, current: track.audioInput, labelFor }))

    if (nodes.length === 0) {
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.id = `track-remove-${track.id}`
      remove.textContent = 'Remove track'
      remove.setAttribute('aria-label', `Remove track ${title}`)
      remove.addEventListener('click', () => {
        const result = dispatcher.apply([{ op: 'removeTrack', id: track.id }])
        if (!result.ok) log(result.message, 'error')
        else log(`removed track ${title}`)
      })
      header.append(remove)
    }
    group.append(header)

    if (nodes.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = 'No plugins on this track. Choose it under Load onto, then load one.'
      group.append(empty)
      return group
    }

    drawChain(group, { tracks, labelOfTrack, labelFor, connections, nodes, allNodes, track })
    return group
  }

  /** The plugins of a track or of the master, in order, with a wire between two that are joined. */
  function drawChain (group, { tracks, labelOfTrack, labelFor, connections, nodes, allNodes, track }) {
    for (const node of nodes) {
      // The wire is drawn only where a connection actually runs between these two
      // in the order they are listed. It used to be drawn unconditionally, which
      // made a branch, a parallel path and two unconnected plugins all look like a
      // chain. Everything else is in the connection list, which is where a graph
      // that is not a chain can be told the truth about.
      const previous = nodes[nodes.indexOf(node) - 1]
      const joining = previous && connections.find(c =>
        c.from.node === previous.id && c.to.node === node.id)
      if (previous) {
        group.append(joining
          ? slots.wire(isMidi(joining.signalKind) ? 'MIDI' : 'audio')
          : slots.gap())
      }
      slots.drawSlot(node, group, { tracks, labelOfTrack, labelFor, nodes, allNodes, track })
    }
  }

  /**
   * The master bus: a header, then its plugins. Its controls are the ones that make sense for it, which
   * is only where the mix arrives. It has no name to change and cannot be removed.
   */
  function drawMaster ({ tracks, labelOfTrack, labelFor, connections, nodes, allNodes }) {
    const { dispatcher } = ctx
    const group = document.createElement('section')
    group.className = 'track master'
    group.id = `track-group-${MASTER_TRACK}`
    group.setAttribute('aria-label', 'Master bus')
    const header = document.createElement('div')
    header.className = 'track-header'
    const heading = document.createElement('h3')
    heading.textContent = 'Master bus'
    header.append(heading)
    const takesAudio = nodes.filter(n => (dispatcher.engineNode(n.id)?.profile?.audioInputs ?? 0) > 0)
    if (takesAudio.length > 0) {
      header.append(audioInputSelect({ id: MASTER_TRACK, title: 'the master bus', nodes: takesAudio, current: dispatcher.project.master.audioInput, labelFor }))
    }
    group.append(header)
    drawChain(group, { tracks, labelOfTrack, labelFor, connections, nodes, allNodes, track: { id: MASTER_TRACK } })
    return group
  }

  /** The menu naming the plugin audio arriving at a track, or at the master, goes into. */
  function audioInputSelect ({ id, title, nodes, current, labelFor }) {
    const { dispatcher } = ctx
    const select = document.createElement('select')
    select.id = `audio-input-${id}`
    select.setAttribute('aria-label', `Where audio arriving at ${title} goes: its clips, sends and buses`)
    const where = id === MASTER_TRACK ? 'The mix arrives at' : 'Audio arrives at'
    for (const [value, text] of [['', 'Audio goes to the fader'], ...nodes.map(n => [n.id, `${where} ${labelFor(n.id)}`])]) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = text
      select.append(option)
    }
    select.value = current ?? ''
    select.addEventListener('change', () => {
      const audioInput = select.value || null
      const change = id === MASTER_TRACK ? { op: 'setMaster', audioInput } : { op: 'setTrack', id, audioInput }
      const result = dispatcher.apply([change])
      if (!result.ok) log(result.message, 'error')
    })
    return select
  }

  return {
    draw: drawRack,
    /** Let go of every note held on an on-screen keyboard, each as a note off to its own plugin. */
    releaseKeys () { for (const keyboard of keyboards) keyboard.allNotesOff() },
    drawTargets,
    addPluginTo,
    removePlugin,
    fxPluginsOf,
    fxActions,
    trackLabel,
    forgetNode,
    /** Drop every cache, for reopening a session over whatever was there before. */
    reset () { panels.clear(); loadTarget = null },
    /** The track the Load onto menu names, or null for a new one. */
    targetTrack () { return $('target').value === NEW_TRACK ? null : $('target').value },
    /** Where the next Load goes: where this one went. */
    loadedOnto (trackId) { loadTarget = trackId; drawTargets() },
    /** The meter of each track strip on the Mixer tab, by track id. */
    meters: () => mixer.meters(),
    /** Put the mixer on the page and listen to the Load onto menu. */
    mount () {
      $('mixer').replaceWith(mixer.element)
      mixer.element.id = 'mixer'
      $('target').addEventListener('change', () => { loadTarget = $('target').value })
      // Open MIDI watches on the Plugins tab follow the traffic, on the message thread.
      setInterval(() => watching?.refreshMonitors(), 500)
    }
  }
}
