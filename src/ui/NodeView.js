// src/ui/NodeView.js
//
// The dock's view of one plugin: what it is, its ports, what it is connected to
// on any track, and a way to connect it to something on another. Two selects
// and a button, not a drag, for the reason src/ui/Routing.js gives: a drag
// between two points cannot be done by keyboard or read by a screen reader.
//
// The destinations offered are only those that can take the chosen output, the
// same `compatible` the dispatcher checks, so it does not offer what would be
// refused. A connection that would make a feedback loop with no declared delay
// is still refused by the dispatcher, and that reason is shown, not hidden.
import { outputsOf, inputsOf, compatible } from '../model/Endpoints.js'
import { createConnectionList } from './Routing.js'

export function createNodeView (document, { onDisconnect, onConnect, onShowPlugin }) {
  for (const [name, fn] of Object.entries({ onDisconnect, onConnect, onShowPlugin })) {
    if (typeof fn !== 'function') throw new Error(`createNodeView needs ${name}`)
  }
  const element = document.createElement('div')
  element.className = 'node-view'
  const heading = document.createElement('p')
  heading.className = 'node-heading'
  const ports = document.createElement('p')
  ports.className = 'node-ports'
  const show = document.createElement('button')
  show.type = 'button'
  show.textContent = 'Show plugin panel'
  show.addEventListener('click', () => onShowPlugin())
  const listMount = document.createElement('div')
  const form = document.createElement('form')
  form.className = 'node-connect'
  form.setAttribute('aria-label', 'Connect this plugin to another')

  const fromLabel = document.createElement('label')
  fromLabel.className = 'track-field'
  fromLabel.append(document.createTextNode('Send '))
  const from = document.createElement('select')
  from.id = 'connect-from'
  fromLabel.append(from)
  const toLabel = document.createElement('label')
  toLabel.className = 'track-field'
  toLabel.append(document.createTextNode('to '))
  const to = document.createElement('select')
  to.id = 'connect-to'
  toLabel.append(to)
  const go = document.createElement('button')
  go.type = 'submit'
  go.id = 'connect-go'
  go.textContent = 'Connect'
  const none = document.createElement('p')
  none.className = 'node-none'
  form.append(fromLabel, toLabel, go, none)
  element.append(heading, ports, show, listMount, form)

  let sources = []
  let targets = []
  // What is chosen in each select, kept here and set from its change event, so the
  // first option counts as chosen before anyone touches it.
  let fromIndex = 0
  let toIndex = null

  function fillTargets () {
    const port = sources[fromIndex]
    const options = port ? targets.filter(t => compatible(port, t.port)) : []
    to.replaceChildren(...options.map(t => {
      const option = document.createElement('option')
      option.value = String(targets.indexOf(t))
      option.textContent = t.text
      return option
    }))
    toIndex = options.length ? targets.indexOf(options[0]) : null
    go.hidden = options.length === 0
    toLabel.hidden = options.length === 0
    none.textContent = options.length === 0 && port ? `Nothing on any track can take ${port.name}.` : ''
  }
  from.addEventListener('change', () => { fromIndex = Number(from.value); fillTargets() })
  to.addEventListener('change', () => { toIndex = Number(to.value) })

  form.addEventListener('submit', event => {
    event.preventDefault()
    const port = sources[fromIndex]
    const target = targets[toIndex]
    if (port && target) onConnect({ from: port, to: target.port, toNode: target.node })
  })

  return {
    element,
    /**
     * `node` is the model's node, `profile` its profile or undefined,
     * `connections` those that involve it, `others` every other node as
     * `{ node, profile, label, trackLabel }`, `labelFor(id)` a node's name.
     */
    show ({ node, label, trackLabel, profile, connections, others, labelFor, onlyPort = null }) {
      heading.textContent = `${label}, on ${trackLabel}.`
      const ins = inputsOf(profile).filter(p => p.portSymbol === undefined).map(p => p.name)
      const outs = outputsOf(profile).map(p => p.name)
      ports.textContent = profile
        ? `Takes: ${ins.join(', ') || 'nothing'}. Gives: ${outs.join(', ') || 'nothing'}.`
        : 'Not loaded, so its ports are not known.'
      listMount.replaceChildren(createConnectionList(document, {
        connections, labelFor: id => (id === node.id ? label : labelFor(id)), onRemove: onDisconnect
      }))

      sources = outputsOf(profile).map(p => ({ node: node.id, portIndex: p.portIndex, kind: p.kind, name: p.name }))
      targets = others.flatMap(other => inputsOf(other.profile).map(port => ({
        node: other.node.id,
        port: { ...port, node: other.node.id },
        text: `${other.label} on ${other.trackLabel}: ${port.name}`
      })))
      form.hidden = sources.length === 0
      from.replaceChildren(...sources.map((p, i) => {
        const option = document.createElement('option')
        option.value = String(i)
        option.textContent = p.name
        return option
      }))
      fromIndex = 0
      fillTargets()
    }
  }
}
