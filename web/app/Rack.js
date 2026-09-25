// web/app/Rack.js
//
// The Plugins tab: each track, its plugins in order, their ports, panels and
// keyboards, and the connections between them. Also the Mixer tab's strips and
// the Load onto menu, because all three are drawn from the same pass over the
// project, and a second pass drawing any of them would fall out of step.
//
// Rebuilt from the project on every change, with the focus put back, rather
// than diffed: after an edit the page is exactly what the model says.
import { createPanel } from '../../src/ui/Panel.js'
import { createMixer } from '../../src/ui/Mixer.js'
import { frameableOrigin } from '../../src/ui/PluginFrame.js'
import { createPortBar, createConnectionList } from '../../src/ui/Routing.js'
import { createKeyboard, octavesForWidth, playable } from '../../src/ui/Keyboard.js'
import { preserveFocus } from '../../src/ui/Focus.js'
import { isMidi } from '../../src/engine/EventRouter.js'
import { compact } from '../../src/host/Capabilities.js'

// Where Load puts a plugin: a track id, or NEW_TRACK for a track of its own.
export const NEW_TRACK = ''

export function createRack (ctx) {
  const { document, window, $, log } = ctx
  // Each node's generated panel, kept across redraws so a control keeps its
  // element, and so its focus can be put back.
  const panels = new Map()
  // The track last chosen or last loaded onto; null until then, which means
  // the newest track.
  let loadTarget = null
  // The output a person has chosen, while they choose an input. Held here rather
  // than in a slot because every node's ports have to know about it: an input
  // can only say whether it may take this output if it knows what the output is.
  let pending = null

  // One strip per track, on the Mixer tab. The strips are the mixer's own to
  // cache, and a track that has gone takes its strip with it (src/ui/Mixer.js).
  const mixer = createMixer(document, {
    onChange: (trackId, change) => {
      const result = ctx.dispatcher.setTrackChannel(trackId, change)
      if (!result.ok) log(result.message, 'error')
    }
  })

  /** Drop everything cached for one node: its panel. */
  const forgetNode = id => { panels.delete(id) }

  function slot (title, kind, className) {
    const element = document.createElement('div')
    element.className = `slot ${className}`
    const header = document.createElement('header')
    const heading = document.createElement('h3')
    heading.textContent = title
    const kindLabel = document.createElement('span')
    kindLabel.className = 'kind'
    kindLabel.textContent = kind
    header.append(heading, kindLabel)
    element.append(header)
    return element
  }

  /** The space where a wire is not, so a stack does not imply a connection. */
  function gap () {
    const element = document.createElement('div')
    element.className = 'gap'
    element.setAttribute('aria-hidden', 'true')
    return element
  }

  function wire (label) {
    const element = document.createElement('div')
    element.className = 'wire'
    if (label) {
      const span = document.createElement('span')
      span.textContent = label
      element.append(span)
    }
    return element
  }

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
    const tracks = ctx.dispatcher?.project.tracks ?? []
    const options = [
      ...tracks.map((track, i) => ({ value: track.id, label: trackLabel(track, i) })),
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
    const tracks = dispatcher?.project.tracks ?? []
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
    const trackNames = tracks.map((t, i) => trackLabel(t, i))
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
      labelFor: labelOfTrack
    })
    restoreMixerFocus()
    drawTargets()
    ctx.arrangement.draw(tracks, labelOfTrack)

    if (tracks.length === 0) {
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

    // Derived from the connections, and the only place in the interface that can
    // tell the truth about a graph that is not a chain. The stack above shows the
    // nodes in the order they were loaded; this shows what is actually joined.
    const heading = document.createElement('h3')
    heading.className = 'connections-heading'
    heading.textContent = 'Connections'
    rack.append(heading, createConnectionList(document, {
      connections,
      labelFor,
      onRemove: id => {
        const result = dispatcher.apply([{ op: 'removeConnection', id }])
        if (!result.ok) log(result.message, 'error')
        drawRack()
      }
    }))

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
    const takesMidi = nodes.filter(n => (dispatcher.engineNode(n.id)?.profile?.accepts ?? []).some(isMidi))
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
          ? wire(isMidi(joining.signalKind) ? 'MIDI' : 'audio')
          : gap())
      }
      drawSlot(node, group, { tracks, labelOfTrack, labelFor, nodes, allNodes, track })
    }
    return group
  }

  /** One plugin on a track: its header, its ports, its panel and its keyboard. */
  function drawSlot (node, group, { tracks, labelOfTrack, labelFor, nodes, allNodes, track }) {
    const { dispatcher, engine } = ctx
    const entry = dispatcher.engineNode(node.id)
    const profile = entry?.profile
    const element = slot(labelFor(node.id), (profile?.roles ?? []).map(compact).join(', '), 'plugin')

    // Contract section 12.5: a foreign plugin is marked wherever it appears,
    // not only on its panel. Someone who consented last week and came back has
    // no other way to tell, and the rack is where they look first. In words
    // inside the heading, because the mark has to reach assistive technology
    // and must not be carried by colour alone.
    if (profile?.kind === 'foreign') {
      const mark = document.createElement('span')
      mark.className = 'foreign'
      mark.textContent = 'foreign'
      mark.title = 'Runs in this page with this page\'s privileges. It is not sandboxed.'
      element.querySelector('header h3').append(' ', mark)
      element.classList.add('is-foreign')
    }

    // Dragging a plugin in the rack rewires the chain, not only where it is
    // drawn (TODO.md): reorderNode heals the gap it leaves, reconnecting
    // what it stood between. It lands in its new position unwired, same as
    // a freshly added node, for a person to connect deliberately: see
    // Project.js's reorderNode for why it does not also guess a connection
    // there. Move earlier/later buttons are the keyboard equivalent WCAG
    // 2.1.1 requires, ordinary buttons rather than an arrow-key scheme, so
    // nothing beyond Tab and Enter/Space needs learning.
    //
    // Earlier and later are within the track. The model keeps one order for
    // every node, so moving past a neighbour on this track means taking that
    // neighbour's place in the project's order.
    const index = nodes.indexOf(node)
    const reorderTo = neighbour => {
      const target = allNodes.indexOf(neighbour)
      const result = dispatcher.apply([{ op: 'reorderNode', id: node.id, index: target }])
      if (!result.ok) log(result.message, 'error')
      else log(`moved ${labelFor(node.id)}`)
    }

    // A span, not a button: it offers no capability a keyboard user does not
    // already have through Move earlier/later, so it is hidden from
    // assistive technology rather than a focusable control that does
    // nothing when activated by anything but a mouse.
    const grip = document.createElement('span')
    grip.className = 'grip'
    grip.textContent = '≡'
    grip.setAttribute('aria-hidden', 'true')
    grip.draggable = true
    grip.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', node.id)
      e.dataTransfer.effectAllowed = 'move'
    })

    const header = element.querySelector('header')
    // A control nobody can use is left out: the first plugin on a track has
    // nothing to move earlier than, and the last nothing to move later than.
    if (index > 0) {
      const moveEarlier = document.createElement('button')
      moveEarlier.type = 'button'
      moveEarlier.className = 'reorder'
      moveEarlier.id = `earlier-${node.id}`
      moveEarlier.textContent = '◀'
      moveEarlier.setAttribute('aria-label', `Move ${labelFor(node.id)} earlier in the chain`)
      moveEarlier.addEventListener('click', () => reorderTo(nodes[index - 1]))
      header.append(moveEarlier)
    }
    if (index < nodes.length - 1) {
      const moveLater = document.createElement('button')
      moveLater.type = 'button'
      moveLater.className = 'reorder'
      moveLater.id = `later-${node.id}`
      moveLater.textContent = '▶'
      moveLater.setAttribute('aria-label', `Move ${labelFor(node.id)} later in the chain`)
      moveLater.addEventListener('click', () => reorderTo(nodes[index + 1]))
      header.append(moveLater)
    }
    header.prepend(grip)

    element.addEventListener('dragover', e => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      element.classList.add('drag-over')
    })
    element.addEventListener('dragleave', () => element.classList.remove('drag-over'))
    element.addEventListener('drop', e => {
      e.preventDefault()
      element.classList.remove('drag-over')
      const draggedId = e.dataTransfer.getData('text/plain')
      if (!draggedId || draggedId === node.id) return
      const dragged = dispatcher.project.node(draggedId)
      if (!dragged) return
      // Dropped onto a plugin on another track: it joins this track, where it
      // was dropped. Onto one on the same track: it takes that one's place.
      const changes = dragged.track === track.id
        ? [{ op: 'reorderNode', id: draggedId, index: allNodes.indexOf(node) }]
        : [{ op: 'moveNodeToTrack', id: draggedId, track: track.id },
            { op: 'reorderNode', id: draggedId, index: allNodes.indexOf(node) }]
      const result = dispatcher.apply(changes)
      if (!result.ok) log(result.message, 'error')
    })

    // Moving between tracks by keyboard, the equivalent of dragging a plugin
    // onto another track. Only offered when there is another track to go to.
    if (tracks.length > 1) {
      const move = document.createElement('select')
      move.className = 'move-track'
      move.id = `track-of-${node.id}`
      move.setAttribute('aria-label', `Track for ${labelFor(node.id)}`)
      for (const t of tracks) {
        const option = document.createElement('option')
        option.value = t.id
        option.textContent = labelOfTrack(t)
        move.append(option)
      }
      move.value = node.track
      move.addEventListener('change', () => {
        const result = dispatcher.apply([{ op: 'moveNodeToTrack', id: node.id, track: move.value }])
        if (!result.ok) log(result.message, 'error')
        else log(`moved ${labelFor(node.id)} to ${labelOfTrack(dispatcher.project.track(move.value))}`)
      })
      header.append(move)
    }

    // A plugin's own interface, where it has one. Beside the generated panel
    // rather than instead of it, so every plugin has controls this page drew
    // and knows to be accessible, whatever its own editor is like. Not offered
    // for an interface on this page's own origin, which contract 9.1 forbids
    // framing: a button that can only ever refuse is a control nobody can use.
    if (profile?.ui && frameableOrigin(profile.ui.location, window.location.origin).ok) {
      const open = ctx.editors.isOpen(node.id)
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'open-editor'
      toggle.id = `editor-toggle-${node.id}`
      toggle.textContent = open ? 'Close editor' : 'Open editor'
      toggle.setAttribute('aria-expanded', String(open))
      toggle.setAttribute('aria-controls', 'editors')
      toggle.setAttribute('aria-label', `${open ? 'Close' : 'Open'} the ${labelFor(node.id)} editor`)
      toggle.addEventListener('click', () => {
        if (ctx.editors.isOpen(node.id)) ctx.editors.close(node.id)
        else ctx.editors.open(node.id, profile, labelFor(node.id))
        drawRack()
      })
      header.append(toggle)
    }

    const remove = document.createElement('button')
    remove.className = 'remove'
    remove.type = 'button'
    remove.textContent = 'Remove'
    remove.setAttribute('aria-label', `Remove ${labelFor(node.id)}`)
    remove.addEventListener('click', () => {
      // heal: rejoin what this node stood between, so removing from the middle
      // of a chain does not leave two fragments and no way to reconnect them.
      const result = dispatcher.apply([{ op: 'removeNode', id: node.id, heal: true }])
      if (!result.ok) log(result.message, 'error')
      else { forgetNode(node.id); log(`removed ${node.label}`) }
    })
    header.append(remove)

    element.append(createPortBar(document, {
      node: { ...node, label: labelFor(node.id) },
      profile,
      pending,
      onCancel: () => { pending = null; drawRack() },
      onPick: (from, to) => {
        if (from) { pending = from; drawRack(); return }
        const result = dispatcher.apply([{
          op: 'addConnection',
          from: { node: pending.node, portIndex: pending.portIndex },
          to: to.portSymbol !== undefined
            ? { node: to.node, portSymbol: to.portSymbol }
            : { node: to.node, portIndex: to.portIndex },
          signalKind: pending.kind
        }])
        if (!result.ok) log(result.message, 'error')
        else log(`connected ${labelFor(pending.node)} to ${labelFor(to.node)}`, 'ok')
        pending = null
        drawRack()
      }
    }))

    // Appended before the panel and keyboard are built, because both measure
    // the slot and an element outside the document has a clientWidth of zero.
    // Reading it early fell back to the body width and chose two octaves where
    // one fits, giving keys below the size anyone can reliably press.
    group.append(element)

    if (!profile) return
    let panel = panels.get(node.id)
    if (!panel) {
      panel = createPanel(document, profile, (symbol, value) => {
        const applied = dispatcher.setParameter(node.id, symbol, value)
        if (applied.ok) panel.update(symbol, applied.value)
      }, async (key, file) => {
        const result = dispatcher.loadAsset(node.id, key, await file.arrayBuffer())
        if (!result.ok) log(`${node.id}.${key}: ${result.message}`, 'error')
      }, { scope: `panel-${node.id}` })
      panels.set(node.id, panel)
    }
    // node.settings is the model's record of what was actually set, post
    // clamp, and it is the only thing that changes when a parameter is set
    // from outside the panel: WebMCP, a saved project reopening, or another
    // surface entirely. A freshly created panel starts every control at its
    // declared default (createPanel's own doing) and a reused one keeps
    // whatever it last showed, so without this a panel drawn from the cache
    // never learns that anything changed underneath it. Unconditional on
    // every redraw, per messaging.md 2.3: a surface renders what it is told.
    // A port with no setting is at its default, which is what undoing the
    // first change to it leaves: pushing only the settings that exist left the
    // knob at the value being undone.
    for (const [symbol, value] of node.settings) panel.update(symbol, value)
    for (const port of profile.ports ?? []) {
      if (!node.settings.has(port.symbol)) panel.update(port.symbol, port.defaultValue)
    }
    // The generated panel brings its own heading, which the slot already has.
    panel.element.querySelector('h3')?.remove()
    element.append(panel.element)

    // An instrument gets a keyboard, so it can be played. Only an
    // instrument: see playable() for why accepting MIDI is not the same
    // question.
    if (playable(profile)) {
      // Fewer octaves on a narrow screen, so the keys stay big enough to hit.
      //
      // The width that matters is the slot's CONTENT box, not the viewport
      // and not clientWidth: clientWidth includes padding, and counting the
      // slot's 14px each side made a 390px phone look like it had room for
      // two octaves when the keys came out at 22.6px.
      const style = getComputedStyle(element)
      const available = element.clientWidth
        ? element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
        : document.body.clientWidth
      const keyboard = createKeyboard(document, {
        first: 48,
        octaves: octavesForWidth(available),
        onNote: bytes => {
          dispatcher.sendEvents(node.id, [{
            frame: Math.round(engine.context.currentTime * engine.context.sampleRate),
            bytes
          }])
        }
      })
      element.append(keyboard.element)
    }
  }

  return {
    draw: drawRack,
    drawTargets,
    trackLabel,
    forgetNode,
    /** Drop every cache, for reopening a session over whatever was there before. */
    reset () { panels.clear(); loadTarget = null },
    /** The track the Load onto menu names, or null for a new one. */
    targetTrack () { return $('target').value === NEW_TRACK ? null : $('target').value },
    /** Where the next Load goes: where this one went. */
    loadedOnto (trackId) { loadTarget = trackId; drawTargets() },
    /** Put the mixer on the page and listen to the Load onto menu. */
    mount () {
      $('mixer').replaceWith(mixer.element)
      mixer.element.id = 'mixer'
      $('target').addEventListener('change', () => { loadTarget = $('target').value })
    }
  }
}
