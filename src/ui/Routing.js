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

// The ports themselves are src/model/Endpoints.js, because the dispatcher has
// to answer the same question when it accepts a connection and answering it
// twice is how the interface comes to offer an edge the model refuses. Re-
// exported here so nothing that draws a port bar has to know that.
export { outputsOf, inputsOf, compatible } from '../model/Endpoints.js'
import { outputsOf, inputsOf, compatible, isMidiSignal } from '../model/Endpoints.js'

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
    // A stable id, so src/ui/Focus.js can put the keyboard back on the same
    // button after the rack is rebuilt. Picking an output rebuilds it, and
    // that is the moment the inputs appear: a keyboard user who lost the
    // focus there would be dropped on the body at the exact point they need
    // to move on to the next button.
    const key = port.portSymbol ?? `p${port.portIndex}`
    button.id = `${node.id}-${direction}-${key}`.replace(/[^\w-]/g, '_')

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

  const outputs = outputsOf(profile)
  const inputs = inputsOf(profile)

  for (const port of outputs) add(port, 'out')

  // Inputs only while a connection is being made.
  //
  // Every input is disabled until an output has been chosen, so at rest they
  // are a row of buttons that cannot be pressed. That is cheap on a reverb
  // with two of them and not on an instrument with forty two parameters,
  // where 44 dead buttons sat between the mixer and the controls and were the
  // largest thing on the panel. They appear at the moment they can be used,
  // which is also the moment a person is looking for them.
  //
  // Disabled rather than hidden still holds inside a gesture: once an output
  // is chosen, every input of every node is drawn and the incompatible ones
  // are disabled and say so, so the shape of what is possible does not change
  // under the pointer while the pointer is moving.
  if (pending) for (const port of inputs) add(port, 'in')

  // From what the plugin has, not from what is drawn. A plugin with inputs
  // and no outputs draws nothing at rest and is not portless.
  if (outputs.length === 0 && inputs.length === 0) {
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
