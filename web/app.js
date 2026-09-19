// web/app.js
//
// The DAW.
//
// Everything goes through the dispatcher. The page never touches the engine or
// the audio graph directly, which is the rule in architecture.md and the reason
// the agent surface can drive the same session without reimplementing anything.
import { PluginLoader } from '../src/host/PluginLoader.js'
import { parseText } from '../src/rdf/parse.js'
import { ShapeValidator } from '../src/validate/ShapeValidator.js'
import { detectCapabilities, compact } from '../src/host/Capabilities.js'
import { Engine } from '../src/engine/Engine.js'
import { OpDispatcher } from '../src/ops/OpDispatcher.js'
import { createPanel } from '../src/ui/Panel.js'
import { createStrip } from '../src/ui/Strip.js'
import { createPortBar, createConnectionList } from '../src/ui/Routing.js'
import { isMidi } from '../src/engine/EventRouter.js'
import { createKeyboard, octavesForWidth } from '../src/ui/Keyboard.js'
import { preserveFocus } from '../src/ui/Focus.js'
import { registerTools } from '../src/mcp/adapter.js'

import { writeProject } from '../src/rdf/ProjectWriter.js'
import { readProject } from '../src/rdf/ProjectReader.js'

const AUDIO = 'http://purl.org/stuff/transmissions/Audio'
const MIDI = 'http://purl.org/stuff/transmissions/Midi'
const $ = id => document.getElementById(id)

const log = (message, kind = 'info') => {
  const line = document.createElement('div')
  line.className = `log-line log-${kind}`
  line.textContent = message
  $('log').prepend(line)
  console.log(`[jigdaw] ${message}`)
}

let dispatcher = null
let engine = null
let analyser = null
let source = null
let playing = false
let startedAt = 0
const panels = new Map()
const strips = new Map()

// The output a person has chosen, while they choose an input. Held here rather
// than in the rack because every node's ports have to know about it: an input
// can only say whether it may take this output if it knows what the output is.
let pending = null

/** The catalogue, as reached from the page: the host's own endpoint, not SPARQL. */
function browserCatalogue () {
  const ask = async (path, params) => {
    const response = await fetch(new URL(`catalogue/${path}?${params}`, document.baseURI))
    const isJson = (response.headers.get('content-type') ?? '').includes('json')
    if (!isJson) {
      throw new Error(response.status === 404
        ? `the catalogue endpoint is not there (${response.status}). If the page was just updated, the server needs restarting.`
        : `the catalogue answered ${response.status}`)
    }
    const body = await response.json()
    if (!response.ok) throw new Error(body.error ?? `catalogue returned ${response.status}`)
    return body
  }
  return {
    async search ({ text = '', limit = 25, loadable = true, ...facets } = {}) {
      const params = new URLSearchParams()
      if (text) params.set('q', text)
      for (const [k, v] of Object.entries(facets)) if (v) params.set(k, v)
      params.set('limit', String(limit))
      if (!loadable) params.set('loadable', 'false')
      return ask('search', params)
    },
    async describe (iri) { return ask('describe', new URLSearchParams({ iri })) }
  }
}

async function ensureRunning () {
  if (dispatcher) return dispatcher

  const context = new AudioContext()
  await context.resume()

  const response = await fetch(new URL('vocabs/shapes.ttl', document.baseURI))
  const validator = new ShapeValidator(await parseText(await response.text(), 'urn:jigdaw:shapes'))

  // The meter taps the mix, so it is built before the engine and handed to it.
  // The engine connects its master through this on the way to the speakers,
  // which means one meter measures what you actually hear rather than one voice
  // of several.
  analyser = context.createAnalyser()
  analyser.fftSize = 256
  analyser.connect(context.destination)

  const capabilities = detectCapabilities(globalThis)
  engine = new Engine({
    context,
    loader: new PluginLoader({ parse: parseText, validator, capabilities }),
    output: analyser
  })
  // Contract section 12. Built here and nowhere else: a host that never
  // constructs one loads no foreign plugins and conforms, so this line is the
  // whole of the decision to support them.
  const { ForeignSupport } = await import('../src/host/ForeignSupport.js')
  dispatcher = new OpDispatcher({
    engine,
    foreign: new ForeignSupport({ validator })
  })

  dispatcher.subscribe(event => {
    if (event.type === 'changed') {
      $('state').textContent = `rev ${event.revision}, ${dispatcher.project.nodes.length} nodes, ` +
        `${event.compiled.totalLatency} frames latency`
      drawRack()
    }
  })

  const registration = registerTools({
    dispatcher,
    catalogue: browserCatalogue(),
    loadPlugin: iri => dispatcher.addPlugin(iri)
  })
  log(`host offers ${[...capabilities].map(compact).join(', ')}`)
  log(`${registration.count} agent tools via ${registration.bound}`)

  meterLoop()
  positionLoop()
  return dispatcher
}

// ── Transport ──────────────────────────────────────────────────────────────

/** A repeating impulse, so an effect has something to work on. */
function makeSource (context) {
  const length = Math.floor(context.sampleRate * 2)
  const buffer = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) {
      const phase = (i / context.sampleRate) % 1
      data[i] = phase < 0.004 ? (Math.random() * 2 - 1) * Math.exp(-phase * 500) : 0
    }
  }
  const node = context.createBufferSource()
  node.buffer = buffer
  node.loop = true
  return node
}

async function play () {
  const d = await ensureRunning()
  if (playing) return
  playing = true
  startedAt = engine.context.currentTime
  $('play').setAttribute('aria-pressed', 'true')

  // Only run the impulse source if the chain starts with an effect. An
  // instrument makes its own sound and feeding it impulses is noise.
  const first = d.project.nodes[0]
  const startsWithEffect = first && !(dispatcher.engineNode(first.id)?.profile.roles ?? [])
    .some(role => role.includes('Instrument'))

  if (startsWithEffect) {
    source = makeSource(engine.context)
    source.start()
    const entry = dispatcher.engineNode(first.id)
    if (entry) source.connect(entry.node, 0, 0)
  }

  sendTransport()
  log('playing', 'ok')
}

function stop () {
  playing = false
  $('play').setAttribute('aria-pressed', 'false')
  if (source) { try { source.stop() } catch { /* already stopped */ } source.disconnect(); source = null }
  for (const entry of engine?.nodes() ?? []) {
    // All notes off, so nothing is left sounding.
    engine.post(entry.id, { type: 'events', events: [{ frame: 0, bytes: Uint8Array.from([0xb0, 123, 0]) }] })
  }
  sendTransport()
  log('stopped')
}

function elapsedFrames () {
  if (!engine || !playing) return 0
  return Math.max(0, Math.round((engine.context.currentTime - startedAt) * engine.context.sampleRate))
}

function sendTransport () {
  if (!dispatcher) return
  dispatcher.sendTransport(elapsedFrames(), {
    frame: Math.round((engine?.context.currentTime ?? 0) * (engine?.context.sampleRate ?? 48000)),
    playing
  })
}

function positionLoop () {
  const tick = () => {
    if (dispatcher) {
      const position = dispatcher.transport().positionAtElapsed(elapsedFrames())
      const bar = Math.floor(position.bar) + 1
      const beat = Math.floor(position.beatInBar) + 1
      $('position').textContent = `${bar} . ${beat}`
      if (playing) sendTransport()
    }
    setTimeout(tick, 100)
  }
  tick()
}

function meterLoop () {
  const bars = 12
  const meter = $('meter')
  meter.textContent = ''
  for (let i = 0; i < bars; i++) meter.append(document.createElement('i'))
  const data = new Float32Array(analyser.fftSize)

  const frame = () => {
    analyser.getFloatTimeDomainData(data)
    let peak = 0
    for (const v of data) peak = Math.max(peak, Math.abs(v))
    const lit = Math.round(Math.min(1, peak) * bars)
    meter.querySelectorAll('i').forEach((bar, i) => {
      bar.className = i < lit ? (i >= bars - 2 ? 'hot' : 'on') : ''
    })
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

// ── The rack ───────────────────────────────────────────────────────────────

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

function drawRack () {
  // Solo makes a node silent without muting it, so whether each one is heard is
  // computed across the whole graph before any strip is drawn.
  const audible = new Map(
    (dispatcher?.audibility() ?? []).map(a => [a.nodeId, !a.silent]))
  const rack = $('rack')

  // Emptying the rack blurs whatever was focused inside it, and every
  // parameter change redraws the rack, so a control could be nudged once by
  // keyboard and then lost the focus: one arrow key moved a knob one step and
  // the second went to the body. That is WCAG 2.1.1 gone on every generated
  // control, and it predates the knobs. The ids are stable, so the focus is
  // put back on the same control after the rebuild.
  const restoreFocus = preserveFocus(rack)

  rack.textContent = ''

  const nodes = dispatcher?.project.nodes ?? []
  const connections = dispatcher?.project.connections ?? []
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
  if (nodes.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = 'Nothing loaded. Search for a plugin, or press Load to add the synth.'
    rack.append(empty)
    return
  }

  rack.append(slot('Source', 'impulse or keyboard', 'source'))

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
      rack.append(joining
        ? wire(isMidi(joining.signalKind) ? 'MIDI' : 'audio')
        : gap())
    }

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
      else { panels.delete(node.id); strips.delete(node.id); log(`removed ${node.label}`) }
    })
    element.querySelector('header').append(remove)

    // The channel strip, above the plugin's own controls. Not drawn by Panel,
    // because nothing the plugin declares describes it.
    let strip = strips.get(node.id)
    if (!strip) {
      strip = createStrip(document, node.channel, change => {
        const result = dispatcher.setChannel(node.id, change)
        if (!result.ok) log(result.message, 'error')
      }, { label: labelFor(node.id) })
      strips.set(node.id, strip)
    }
    strip.update(node.channel, { silent: audible.get(node.id) === false })
    element.append(strip.element)

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
    rack.append(element)

    if (profile) {
      let panel = panels.get(node.id)
      if (!panel) {
        panel = createPanel(document, profile, (symbol, value) => {
          const applied = dispatcher.setParameter(node.id, symbol, value)
          if (applied.ok) panel.update(symbol, applied.value)
        })
        panels.set(node.id, panel)
      }
      // The generated panel brings its own heading, which the slot already has.
      panel.element.querySelector('h3')?.remove()
      element.append(panel.element)

      // An instrument gets a keyboard, so it can be played.
      if ((profile.accepts ?? []).some(signal => signal.includes('Midi'))) {
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
  }

  rack.append(wire('audio'), slot('Output', 'speakers', 'output'))

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

// ── Loading ────────────────────────────────────────────────────────────────

/**
 * Ask about a foreign plugin. Contract section 12.4.
 *
 * A dialog rather than confirm(), because the statements are four lines and the
 * decision is whether to run somebody else's code in this page. Modal, focus
 * moved into it, Escape and the backdrop both count as no, and the default
 * button is the refusal: a person who presses Enter without reading has
 * declined, which is the way round that costs least when it is wrong.
 */
function askConsent (request) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog')
    dialog.className = 'consent'

    const heading = document.createElement('h2')
    heading.textContent = `Run ${request.label}?`
    dialog.append(heading)

    const list = document.createElement('ul')
    for (const statement of request.statements) {
      const item = document.createElement('li')
      item.textContent = statement
      list.append(item)
    }
    dialog.append(list)

    const buttons = document.createElement('div')
    buttons.className = 'consent-buttons'
    const no = document.createElement('button')
    no.type = 'button'
    no.textContent = 'Do not run it'
    const yes = document.createElement('button')
    yes.type = 'button'
    yes.className = 'danger'
    yes.textContent = 'Run it with full access'
    buttons.append(no, yes)
    dialog.append(buttons)

    let answered = false
    const done = answer => {
      if (answered) return
      answered = true
      dialog.close()
      dialog.remove()
      resolve(answer)
    }
    no.addEventListener('click', () => done(false))
    yes.addEventListener('click', () => done(true))
    // Escape fires cancel, and a dialog dismissed any other way is still a no.
    dialog.addEventListener('cancel', () => done(false))
    dialog.addEventListener('close', () => done(false))

    document.body.append(dialog)
    dialog.showModal()
    no.focus()
  })
}

async function loadPlugin (input) {
  const d = await ensureRunning()
  const iri = new URL(input, document.baseURI).href
  log(`GET ${iri}`)

  // Contract section 12.4: a foreign plugin is never loaded without being asked
  // for, so which kind this is has to be known before anything is loaded. The
  // classification costs one fetch of the profile, and only on a host that
  // supports foreign plugins at all.
  let foreign = false
  const support = d.foreignSupport
  if (support) {
    const seen = await support.classify(iri).catch(() => null)
    foreign = seen?.kind === 'foreign'
  }

  let result = await d.addPlugin(iri, foreign ? { foreign: true } : {})

  // The dispatcher refuses until this container has been consented to and hands
  // back what a person must be asked. This is the only place in the application
  // that asks, and it renders the statements it was given rather than wording
  // them again, because they are the thing being agreed to.
  if (!result.ok && result.kind === 'consent') {
    if (!await askConsent(result.request)) {
      log(`${result.request.label}: not loaded`, 'error')
      return
    }
    d.foreignTrust?.consent(result.request.iri, result.request.digest)
    result = await d.addPlugin(iri, { foreign: true })
  }

  if (!result.ok) {
    log(`${result.step ? `[${result.step}] ` : ''}${result.message}`, 'error')
    return
  }

  const { nodeId, entry } = result
  log(`loaded ${entry.profile.label}`, 'ok')

  // Chain after the previous plugin, so loading twice builds a signal path.
  const nodes = d.project.nodes
  const previous = nodes[nodes.length - 2]
  if (previous) {
    const produces = dispatcher.engineNode(previous.id)?.profile.produces ?? []
    const kind = produces.some(s => s.includes('Midi')) && !produces.includes(AUDIO) ? MIDI : AUDIO
    const chained = d.apply([{
      op: 'addConnection',
      from: { node: previous.id, portIndex: 0 },
      to: { node: nodeId, portIndex: 0 },
      signalKind: kind
    }])
    if (!chained.ok) log(chained.message, 'error')
  }

  // Nothing here connects anything to the speakers. The dispatcher links every
  // audio sink to the engine's master, which is the path this page used to make
  // itself by reaching past the model, once per node, whether or not the model
  // thought that node was the end of anything.
  drawRack()
  window.__jigdaw = { dispatcher: d, engine }
}

// ── Browser ────────────────────────────────────────────────────────────────

function renderResults (results, query) {
  const box = $('results')
  box.textContent = ''
  if (results.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'note'
    empty.textContent = `Nothing matched ${query}.`
    box.append(empty)
    return
  }

  const loadable = results.filter(r => r.web).length
  const note = document.createElement('p')
  note.className = 'note'
  note.textContent = loadable === results.length
    ? `${results.length} loadable here.`
    : `${results.length} found, ${loadable} loadable here. The rest are native plugins the catalogue knows about but this host cannot run.`
  box.append(note)

  for (const result of results) {
    const row = document.createElement('div')
    // Dimmed, so the ones that can be loaded read first at a glance.
    row.className = result.web ? 'result' : 'result native'

    const name = document.createElement('div')
    name.className = 'name'
    name.textContent = result.label ?? result.iri
    if (result.web) {
      const badge = document.createElement('span')
      badge.className = 'badge'
      badge.textContent = ' web'
      name.append(' ', badge)
    }
    row.append(name)

    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.textContent = [result.vendor, result.roles.join(', ')].filter(Boolean).join(' · ')
    row.append(meta)

    if (result.web) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = 'Load'
      button.addEventListener('click', () => loadPlugin(result.homepage ?? result.iri).catch(() => {}))
      row.append(button)
    } else {
      const why = document.createElement('div')
      why.className = 'native'
      why.textContent = 'native only'
      row.append(why)
    }
    box.append(row)
  }
}

async function search () {
  const text = $('q').value.trim()
  const facet = $('facet').value
  const params = new URLSearchParams()
  if (text) params.set('q', text)
  if (facet) { const [k, v] = facet.split('='); params.set(k, v) }
  params.set('limit', '25')
  // An empty search lists what this host can run, which is the useful default
  // for a browser: it answers "what have I got" without being asked twice.


  try {
    const body = await browserCatalogue().search({
      text, limit: 25,
      loadable: !$('everything').checked,
      ...(facet ? { [facet.split('=')[0]]: facet.split('=')[1] } : {})
    })
    renderResults(body.results, text || facet)

    if (body.upstreamError) {
      // The wider catalogue being down must not hide the plugins held here.
      log(`the wider catalogue is unavailable: ${body.upstreamError}`, 'error')
    }
    if (body.loadableOnly && body.results.length === 0) {
      log('nothing loadable matched. Tick the box to include native plugins.')
    }
    log(`${body.results.length} result(s)`, 'ok')
  } catch (error) {
    log(`search failed: ${error.message}`, 'error')
  }
}

// ── Sessions ───────────────────────────────────────────────────────────────
//
// A project is RDF, per docs/project-format.md, and the plugin IRIs in it are
// what make it portable: a session opened on a machine that has never seen these
// plugins carries everything needed to fetch them. That is the premise of the
// whole system applied to its own file format.

/** Where this session lives, for the @base. A saved file is self describing. */
function sessionIri () {
  return new URL(`sessions/${Date.now()}/`, document.baseURI).href
}

function saveSession () {
  if (!dispatcher) { log('nothing to save yet', 'error'); return }
  const turtle = writeProject(dispatcher.project, {
    iri: sessionIri(),
    created: new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  })
  const url = URL.createObjectURL(new Blob([turtle], { type: 'text/turtle' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'session.ttl'
  link.click()
  // Revoked on the next turn: revoking immediately races the download in some
  // browsers and the file arrives empty.
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  log(`saved ${dispatcher.project.nodes.length} nodes as Turtle`, 'ok')
}

/**
 * Reopen a session.
 *
 * Plugins first and connections after, because a connection names nodes that
 * have to exist, and each plugin has to be fetched and instantiated before the
 * node it belongs to means anything. A plugin that cannot be loaded is reported
 * and skipped rather than abandoning the rest: an unreachable origin should cost
 * one node, not the session.
 */
async function openSession (text) {
  const d = await ensureRunning()
  const parsed = await parseText(text, document.baseURI)
  let read
  try { read = readProject(parsed) } catch (error) { log(error.message, 'error'); return }

  // Clear the current session first. removeNode takes the engine node with it,
  // through the dispatcher, so nothing is left playing underneath the one being
  // opened.
  const existing = [...d.project.nodes].map(n => ({ op: 'removeNode', id: n.id }))
  if (existing.length > 0) {
    const cleared = d.apply(existing)
    if (!cleared.ok) { log(cleared.message, 'error'); return }
  }
  panels.clear()
  strips.clear()

  const loaded = new Set()
  for (const change of read.changes.filter(c => c.op === 'addNode')) {
    log(`GET ${change.pluginIri}`)
    // The whole change, not a chosen few of its fields. The reader produces
    // everything a node carries and picking some of them here is how a saved
    // mix came back at unity.
    const { op, pluginIri, ...node } = change
    const result = await d.addPlugin(pluginIri, node)
    if (!result.ok) { log(`${change.id}: ${result.message}`, 'error'); continue }
    loaded.add(change.id)
    for (const [symbol, value] of Object.entries(change.settings ?? {})) {
      const set = d.setParameter(change.id, symbol, value)
      if (!set.ok) log(`${change.id}.${symbol}: ${set.message}`, 'error')
    }
    if (change.state) d.apply([{ op: 'setNodeState', node: change.id, state: change.state }])
  }

  // Only between nodes that actually loaded. A connection to a node that failed
  // would be refused by the model and reported as a second error about the same
  // failure.
  const rest = read.changes.filter(c =>
    c.op !== 'addNode' &&
    (c.op !== 'addConnection' || (loaded.has(c.from.node) && loaded.has(c.to.node))))
  if (rest.length > 0) {
    const applied = d.apply(rest)
    if (!applied.ok) log(applied.message, 'error')
  }

  const bpm = d.project.transport.tempoPoints[0]?.bpm
  if (bpm) $('tempo').value = String(bpm)
  drawRack()
  window.__jigdaw = { dispatcher: d, engine }
  log(`opened ${loaded.size} of ${read.changes.filter(c => c.op === 'addNode').length} nodes`, 'ok')
}

$('searchbar').addEventListener('submit', e => { e.preventDefault(); search() })
$('loadbar').addEventListener('submit', e => { e.preventDefault(); loadPlugin($('iri').value.trim()).catch(() => {}) })
$('play').addEventListener('click', () => play().catch(error => log(error.message, 'error')))
$('stop').addEventListener('click', stop)
$('save').addEventListener('click', saveSession)
$('open').addEventListener('click', () => $('openfile').click())
$('openfile').addEventListener('change', async event => {
  const file = event.target.files?.[0]
  if (!file) return
  // Cleared so that opening the same file twice in a row still fires a change.
  event.target.value = ''
  try { await openSession(await file.text()) } catch (error) { log(error.message, 'error') }
})
$('tempo').addEventListener('change', async () => {
  const d = await ensureRunning()
  const result = d.apply([{ op: 'setTransport', tempoPoints: [{ atBeat: 0, bpm: Number($('tempo').value) }] }])
  if (!result.ok) log(result.message, 'error')
})

// Show the whole IRI, not a path. A plugin is identified by an absolute IRI,
// and the box is the clearest place to say so: what goes in it is the same
// thing that would be published, pasted into another host, or curled. It is
// computed rather than written into the HTML because it depends on where this
// host is served from.
$('iri').value = new URL($('iri').value, document.baseURI).href

drawRack()
log('ready. Load the synth and press a key, or search for a plugin.')
window.__jigdawLoad = loadPlugin
