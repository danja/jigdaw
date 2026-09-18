// src/ui/Routing.js
//
// Making and breaking connections, and showing the ones that exist.
//
// The rack has always drawn `project.nodes` in array order with decorative
// dividers between them, so a branched graph was drawn as a flat list and a
// parallel path was a picture of something that was not there. The model has
// been an arbitrary directed graph since it was written; only the interface
// insisted on a chain.
//
// This is not a node canvas with cables. A canvas is the obvious answer and it
// loses on both of this project's stated constraints: a drag between two points
// is very hard to make keyboard-operable, and AGENTS.md puts keyboard before
// pointer; and hit-testing a graph on a phone, with 44px targets and no
// horizontal scrolling, is a fight the layout loses. Picking an output and then
// an input is two ordinary buttons, which a keyboard, a screen reader and a
// thumb all already know how to use.

const MIDI_SIGNAL = 'http://purl.org/stuff/transmissions/Midi'
const AUDIO_SIGNAL = 'http://purl.org/stuff/transmissions/Audio'

const isMidiSignal = signal => typeof signal === 'string' && signal.includes('Midi')

/** What a plugin can be connected from, read from its profile. */
export function outputsOf (profile) {
  const found = []
  for (let i = 0; i < (profile?.audioOutputs ?? 0); i++) {
    found.push({ kind: AUDIO_SIGNAL, portIndex: i, name: `Audio out ${i + 1}` })
  }
  if ((profile?.produces ?? []).some(isMidiSignal)) {
    found.push({ kind: MIDI_SIGNAL, portIndex: 0, name: 'MIDI out' })
  }
  return found
}

/**
 * What a plugin can be connected to.
 *
 * Parameters are targets as well as ports: an endpoint carries either a
 * jig:portIndex or a jig:portSymbol, and the symbol form is modulation. It is
 * listed here because it is now honoured, having been expressible and
 * undelivered for as long as the format has existed.
 */
export function inputsOf (profile) {
  const found = []
  for (let i = 0; i < (profile?.audioInputs ?? 0); i++) {
    found.push({ kind: AUDIO_SIGNAL, portIndex: i, name: `Audio in ${i + 1}` })
  }
  if ((profile?.accepts ?? []).some(isMidiSignal)) {
    found.push({ kind: MIDI_SIGNAL, portIndex: 0, name: 'MIDI in' })
  }
  for (const port of profile?.ports ?? []) {
    found.push({
      kind: AUDIO_SIGNAL,
      portSymbol: port.symbol,
      name: `${port.name || port.symbol} (modulate)`
    })
  }
  return found
}

/** Whether two ends can be joined, so a refusal is visible before it is tried. */
export function compatible (from, to) {
  if (!from || !to) return false
  // A modulation target takes a signal, not a message: a MIDI stream cannot
  // drive an AudioParam, and connecting it would be connecting nothing.
  if (to.portSymbol !== undefined) return from.kind === AUDIO_SIGNAL
  return from.kind === to.kind
}

/**
 * The ports of one node, as buttons.
 *
 * `pending` is the output currently being connected from, anywhere in the rack,
 * so every node's bar can show whether it is a legal destination. Passing the
 * whole selection rather than a boolean is what lets an input say why it is
 * unavailable instead of merely being unavailable.
 */
export function createPortBar (document, { node, profile, pending, onPick, onCancel }) {
  const element = document.createElement('div')
  element.className = 'ports'
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', `${node.label ?? 'Plugin'} connections`)

  const add = (port, direction) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `port port-${direction}`
    button.textContent = port.name

    const isPending = direction === 'out' && pending &&
      pending.node === node.id && pending.portIndex === port.portIndex &&
      pending.kind === port.kind

    if (direction === 'out') {
      button.setAttribute('aria-pressed', String(Boolean(isPending)))
      button.setAttribute('aria-label',
        isPending
          ? `${port.name} of ${node.label}, selected. Choose an input, or press again to cancel.`
          : `Connect from ${port.name} of ${node.label}`)
      button.addEventListener('click', () => {
        if (isPending) onCancel()
        else onPick({ node: node.id, kind: port.kind, portIndex: port.portIndex })
      })
      if (isPending) button.classList.add('pending')
    } else {
      const canTake = pending && compatible(pending, port) && pending.node !== node.id
      // Disabled rather than hidden while something is selected, so the shape of
      // what is possible does not change under the pointer, and said rather than
      // only greyed, because state must not be signalled by colour alone.
      if (pending) {
        button.disabled = !canTake
        button.setAttribute('aria-label', canTake
          ? `Connect to ${port.name} of ${node.label}`
          : `${port.name} of ${node.label}, which cannot take the selected output`)
      } else {
        button.disabled = true
        button.setAttribute('aria-label', `${port.name} of ${node.label}. Choose an output first.`)
      }
      button.addEventListener('click', () => {
        if (canTake) onPick(null, { node: node.id, portIndex: port.portIndex, portSymbol: port.portSymbol })
      })
    }
    element.append(button)
  }

  for (const port of outputsOf(profile)) add(port, 'out')
  for (const port of inputsOf(profile)) add(port, 'in')

  if (element.children.length === 0) {
    const none = document.createElement('span')
    none.className = 'port-none'
    none.textContent = 'No connectable ports'
    element.append(none)
  }
  return element
}

/**
 * Every connection in the project, as a list that can be broken.
 *
 * Derived from the connections rather than from node order, which is the whole
 * point: this is the first thing in the interface that tells the truth about a
 * graph that is not a chain.
 */
export function createConnectionList (document, { connections, labelFor, onRemove }) {
  const element = document.createElement('div')
  element.className = 'connections'
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', 'Connections')

  if (connections.length === 0) {
    const none = document.createElement('p')
    none.className = 'empty'
    none.textContent = 'Nothing is connected. Choose an output, then an input.'
    element.append(none)
    return element
  }

  for (const connection of connections) {
    const row = document.createElement('div')
    row.className = 'connection'

    const kind = isMidiSignal(connection.signalKind) ? 'MIDI' : 'audio'
    const to = connection.to.portSymbol !== undefined
      ? `${labelFor(connection.to.node)} · ${connection.to.portSymbol}`
      : `${labelFor(connection.to.node)} in ${(connection.to.portIndex ?? 0) + 1}`
    const description =
      `${labelFor(connection.from.node)} out ${(connection.from.portIndex ?? 0) + 1} ` +
      `to ${to}`

    const text = document.createElement('span')
    text.className = 'connection-text'
    text.textContent = description

    const badge = document.createElement('span')
    // The kind is named rather than coloured, and it is not decoration: an audio
    // edge and a host-routed MIDI edge are handled by entirely different
    // machinery and cannot be told apart from the endpoints.
    badge.className = `connection-kind ${kind}`
    badge.textContent = kind

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'connection-remove'
    remove.textContent = 'Disconnect'
    remove.setAttribute('aria-label', `Disconnect ${description}`)
    remove.addEventListener('click', () => onRemove(connection.id))

    row.append(badge, text, remove)
    element.append(row)
  }
  return element
}
