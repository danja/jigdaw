// web/app/RackSlot.js
//
// One plugin's slot on the Plugins tab: its header (reorder, move to another track, open the editor, unpack, remove), its ports, its generated
// panel, and an on-screen keyboard for an instrument. Rebuilt by the rack on every change; the panels and the keyboards are kept by the rack and
// handed in, so a control keeps its element and its focus across a redraw. Also the heading a slot is given, and the wire or gap drawn between two.
import { showAssetText } from '../../src/ui/AssetText.js'
import { createPanel } from '../../src/ui/Panel.js'
import { frameableOrigin } from '../../src/ui/PluginFrame.js'
import { createPortBar } from '../../src/ui/Routing.js'
import { createKeyboard, octavesForWidth, playable } from '../../src/ui/Keyboard.js'
import { compact } from '../../src/host/Capabilities.js'
import { MASTER_TRACK } from '../../src/model/ArrangementOps.js'

/**
 * What a plugin's slot is headed. A node named for its purpose ("Subject")
 * is headed by the plugin in use first ("MelGen: Subject"), because the
 * purpose alone never says what is making the sound. A node still carrying
 * the profile's own name reads unchanged, never "Pulse: Pulse". `name` is the
 * display form, already disambiguated where it is shared; the comparison is
 * against the node's own label, which is what carrying the profile name means.
 */
export function slotTitle (node, profile, name) {
  const plugin = profile?.label ?? null
  if (plugin && node.label && node.label !== plugin) return `${plugin}: ${name}`
  return name
}

/**
 * `panels` (node id to its panel) and `keyboards` are the rack's own; `redraw()` draws the rack again and `forgetNode(id)` drops what is cached
 * for a node. Returns the drawing functions, and the output a person has chosen while they choose an input (held here because every node's ports
 * have to know about it: an input can only say whether it may take this output if it knows what the output is).
 */
export function createSlots (ctx, { panels, keyboards, redraw: slots_redraw, forgetNode }) {
  const { document, window, log } = ctx
  let pending = null
  const slots = { pending: () => pending, setPending: from => { pending = from }, redraw: slots_redraw }

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

  /** One plugin on a track: its header, its ports, its panel and its keyboard. */

  /**
   * A node's control panel, built once per `cache` and brought up to date with what the model holds. The rack keeps one cache and the
   * dock another, since one element cannot be in two places.
   */
  function panelFor (node, profile, cache, scope = `panel-${node.id}`) {
    const { dispatcher } = ctx
    let panel = cache.get(node.id)
    // A panel drawn before its skin arrived is drawn again with it. Asking also starts the fetch.
    const skinReady = ctx.skins.ready(profile)
    if (panel && panel.skinned !== skinReady) panel = null
    if (!panel) {
      const skin = skinReady ? ctx.skins.prepare(profile, scope) : null
      panel = createPanel(document, profile, (symbol, value) => {
        const applied = dispatcher.setParameter(node.id, symbol, value)
        if (applied.ok) panel.update(symbol, applied.value)
      }, async (key, file) => {
        const result = dispatcher.loadAsset(node.id, key, await file.arrayBuffer())
        if (!result.ok) log(`${node.id}.${key}: ${result.message}`, 'error')
        else showAssetText(panel, profile, dispatcher, node.id)
        return result
      }, { scope, skin })
      cache.set(node.id, panel)
      showAssetText(panel, profile, dispatcher, node.id)
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
    return panel
  }

  function drawSlot (node, group, { tracks, labelOfTrack, labelFor, nodes, allNodes, track }) {
    const { dispatcher, engine } = ctx
    const entry = dispatcher.engineNode(node.id)
    const profile = entry?.profile
    const element = slot(slotTitle(node, profile, labelFor(node.id)), (profile?.roles ?? []).map(compact).join(', '), 'plugin')

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
    {
      const move = document.createElement('select')
      move.className = 'move-track'
      move.id = `track-of-${node.id}`
      move.setAttribute('aria-label', `Track for ${labelFor(node.id)}`)
      // The master bus is a place to go as well as a track, so there is always somewhere else to move to.
      const places = [...tracks.map(t => [t.id, labelOfTrack(t)]), [MASTER_TRACK, 'Master bus']]
      for (const [value, text] of places) {
        const option = document.createElement('option')
        option.value = value
        option.textContent = text
        move.append(option)
      }
      move.value = node.track
      move.addEventListener('change', () => {
        const result = dispatcher.apply([{ op: 'moveNodeToTrack', id: node.id, track: move.value }])
        if (!result.ok) log(result.message, 'error')
        else log(`moved ${labelFor(node.id)} to ${places.find(([value]) => value === move.value)[1]}`)
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
        slots_redraw()
      })
      header.append(toggle)
    }

    // A composite plugin can be turned back into the plugins it is made of. Offered only on one: on any other plugin it would be a
    // control that can only ever refuse. The Op joins the members to what the composite was joined to and gives each the value it had.
    if (profile?.composite) {
      const unpack = document.createElement('button')
      unpack.type = 'button'
      unpack.className = 'unpack'
      unpack.id = `unpack-${node.id}`
      unpack.textContent = 'Unpack'
      unpack.setAttribute('aria-label', `Unpack ${labelFor(node.id)} into the plugins it is made of`)
      unpack.addEventListener('click', async () => {
        unpack.disabled = true
        const result = await dispatcher.unpackComposite(node.id)
        if (!result.ok) { unpack.disabled = false; log(result.message, 'error'); return }
        forgetNode(node.id)
        log(`unpacked ${node.label} into ${result.nodeIds.length} plugins`, 'ok')
      })
      header.append(unpack)
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
      pending: slots.pending(),
      onCancel: () => { slots.setPending(null); slots.redraw() },
      onPick: (from, to) => {
        if (from) { slots.setPending(from); slots.redraw(); return }
        const result = dispatcher.apply([{
          op: 'addConnection',
          from: { node: slots.pending().node, portIndex: slots.pending().portIndex },
          to: to.portSymbol !== undefined
            ? { node: to.node, portSymbol: to.portSymbol }
            : { node: to.node, portIndex: to.portIndex },
          signalKind: slots.pending().kind
        }])
        if (!result.ok) log(result.message, 'error')
        else log(`connected ${labelFor(slots.pending().node)} to ${labelFor(to.node)}`, 'ok')
        slots.setPending(null)
        slots.redraw()
      }
    }))

    // Appended before the panel and keyboard are built, because both measure
    // the slot and an element outside the document has a clientWidth of zero.
    // Reading it early fell back to the body width and chose two octaves where
    // one fits, giving keys below the size anyone can reliably press.
    group.append(element)

    if (!profile) return
    const panel = panelFor(node, profile, panels)
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
          ctx.midiRecord.capture(node.id, bytes)
        }
      })
      keyboards.add(keyboard)
      element.append(keyboard.element)
    }
  }

  return { slot, gap, wire, drawSlot, panelFor, ...slots }
}
