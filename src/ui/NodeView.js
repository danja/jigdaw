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

export function createNodeView (document, { onDisconnect, onConnect, onShowPlugin, onAutomate }) {
  for (const [name, fn] of Object.entries({ onDisconnect, onConnect, onShowPlugin, onAutomate })) {
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
  // Automate a parameter: adds a lane under the track, where its envelope is drawn and edited.
  const automate = document.createElement('form')
  automate.className = 'node-automate'
  automate.setAttribute('aria-label', 'Automate a parameter of this plugin')
  const automateLabel = document.createElement('label')
  automateLabel.className = 'track-field'
  automateLabel.append(document.createTextNode('Automate '))
  const automateSymbol = document.createElement('select')
  automateSymbol.id = 'automate-symbol'
  automateLabel.append(automateSymbol)
  const automateGo = document.createElement('button')
  automateGo.type = 'submit'
  automateGo.id = 'automate-go'
  automateGo.textContent = 'Add lane'
  automate.append(automateLabel, automateGo)
  let automateNode = null
  let automateChosen = null
  automateSymbol.addEventListener('change', () => { automateChosen = automateSymbol.value })
  automate.addEventListener('submit', event => {
    event.preventDefault()
    if (automateNode && automateChosen) onAutomate(automateNode, automateChosen)
  })
  element.append(heading, ports, show, listMount, form, automate)

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

  let list = null

  return {
    element,
    /** Redraw the open MIDI watches; the page calls this on a timer while the view is showing. */
    refreshMonitors () { list?.refreshMonitors() },
    /**
     * `node` is the model's node, `profile` its profile or undefined,
     * `connections` those that involve it, `others` every other node as
     * `{ node, profile, label, trackLabel }`, `labelFor(id)` a node's name.
     */
    show ({ node, label, trackLabel, profile, connections, others, labelFor, monitor, automated = new Set(), onlyPort = null }) {
      heading.textContent = `${label}, on ${trackLabel}.`
      const ins = inputsOf(profile).filter(p => p.portSymbol === undefined).map(p => p.name)
      const outs = outputsOf(profile).map(p => p.name)
      ports.textContent = profile
        ? `Takes: ${ins.join(', ') || 'nothing'}. Gives: ${outs.join(', ') || 'nothing'}.`
        : 'Not loaded, so its ports are not known.'
      list = createConnectionList(document, {
        connections, labelFor: id => (id === node.id ? label : labelFor(id)), onRemove: onDisconnect, monitor
      })
      listMount.replaceChildren(list)

      // A parameter that has a range and is not automated yet can be given a lane; the form is left out
      // when there is nothing to offer, not shown empty.
      const automatable = (profile?.ports ?? []).filter(p => Number.isFinite(p.minimum) && p.maximum > p.minimum && !automated.has(p.symbol))
      automateNode = node.id
      automateChosen = automatable[0]?.symbol ?? null
      automateSymbol.replaceChildren(...automatable.map(p => {
        const option = document.createElement('option')
        option.value = p.symbol
        option.textContent = p.name || p.symbol
        return option
      }))
      automate.hidden = automatable.length === 0

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
