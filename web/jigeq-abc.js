// web/jigeq-abc.js
//
// A small browser host for comparing the JigEQ presentation variants.
import { PluginLoader } from '../src/host/PluginLoader.js'
import { detectCapabilities, compact } from '../src/host/Capabilities.js'
import { loadSkin, prepareSkin } from '../src/host/SkinLoader.js'
import { parseText } from '../src/rdf/parse.js'
import { profileAsJsonLd } from '../src/rdf/ProfileJsonLd.js'
import { createPluginFrame } from '../src/ui/PluginFrame.js'
import { parseSvg } from '../src/ui/SkinArtwork.js'
import { parseHtml } from '../src/ui/HtmlSkin.js'
import { createPanel } from '../src/ui/Panel.js'
import { ShapeValidator } from '../src/validate/ShapeValidator.js'
import { readHostConfig } from '../src/host/HostConfig.js'

const PLUGINS = Object.freeze([
  { key: 'a', name: 'JigEQa' },
  { key: 'b', name: 'JigEQb' },
  { key: 'c', name: 'JigEQc' }
])
const $ = selector => document.querySelector(selector)
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const entries = new Map(PLUGINS.map(spec => [spec.key, { ...spec, values: new Map() }]))
const status = $('#status')
const startButton = $('#audio-toggle')

let loader
let capabilities
let relayLimit
let activeKey = 'a'
let context = null
let inputGain = null
let monitorGain = null
let switchGain = null
let source = null
let playingEntry = null
let playing = false
let switchRequest = 0

function say (message, state = 'info') {
  status.textContent = message
  status.dataset.state = state
}

function setNote (entry, message, state = 'info') {
  const note = $(`#panel-${entry.key} .plugin-note`)
  note.textContent = message
  note.dataset.state = state
}

function gainFromDb (db) {
  return 10 ** (db / 20)
}

function parameterChanged (entry, symbol, requested) {
  const port = entry.profile?.ports.find(item => item.symbol === symbol)
  if (!port || !Number.isFinite(requested)) {
    setNote(entry, `${entry.name}: refused invalid parameter update for "${symbol}".`, 'error')
    return
  }
  const value = Math.min(port.maximum, Math.max(port.minimum, requested))
  const parameter = entry.node?.parameters.get(symbol)
  if (entry.node && !parameter) {
    setNote(entry, `${entry.name}: the processor has no AudioParam named "${symbol}".`, 'error')
    return
  }

  entry.values.set(symbol, value)
  parameter?.setValueAtTime(value, context.currentTime)
  entry.panel?.update(symbol, value)
  entry.frame?.parameter(symbol, value)
}

async function loadEntry (entry) {
  try {
    const iri = new URL(`/plugins/jigeq${entry.key}/`, document.baseURI).href
    const loaded = await loader.loadProfile(iri)
    entry.profile = loaded.profile
    entry.granted = loaded.granted
    for (const port of entry.profile.ports) entry.values.set(port.symbol, port.defaultValue)

    let skin = null
    if (entry.profile.skin) {
      try {
        const fetched = await loadSkin(entry.profile, {
          fetchVerified: (resource, options) => loader.fetchVerified(resource, options),
          parseTurtle: parseText,
          parseSvg,
          parseHtml
        })
        skin = prepareSkin(fetched, entry.profile, {
          document,
          prefix: `jigeq-harness-${entry.key}-`
        })
      } catch (error) {
        setNote(entry, `${entry.name} skin failed; showing generated controls instead. ${error.message}`, 'error')
      }
    }

    entry.panel = createPanel(
      document,
      entry.profile,
      (symbol, value) => parameterChanged(entry, symbol, value),
      null,
      { scope: `jigeq-harness-${entry.key}`, skin }
    )
    $(`#surface-${entry.key}`).append(entry.panel.element)

    if (entry.profile.ui) {
      entry.frame = createPluginFrame(document, {
        ui: entry.profile.ui,
        label: entry.name,
        hostOrigin: window.location.origin,
        window,
        relayLimit,
        init: () => ({
          profile: profileAsJsonLd(entry.profile),
          parameters: Object.fromEntries(entry.values),
          capabilities: [...capabilities].map(compact)
        }),
        onParameter: (symbol, value) => parameterChanged(entry, symbol, value),
        onRefused: message => setNote(entry, message, 'error')
      })
      entry.frame.element.style.height = '340px'
      const editor = document.createElement('div')
      const heading = document.createElement('h2')
      heading.className = 'editor-title'
      heading.textContent = 'Plugin HTML editor'
      editor.append(heading, entry.frame.element)
      $(`#surface-${entry.key}`).append(editor)
    }

    if (entry.key === activeKey) entry.panel.skinView?.fit()
    if (!entry.profile.skin || skin) setNote(entry, entry.profile.ui ? 'Generated panel and HTML editor' : entry.profile.skin ? 'SVG skin' : 'Generated panel')
  } catch (error) {
    setNote(entry, `${entry.name} could not be loaded: ${error.message}`, 'error')
  }
}

async function prepareHost () {
  const [shapesResponse, configResponse] = await Promise.all([
    fetch('/vocabs/shapes.ttl'),
    fetch('/host.json')
  ])
  if (!shapesResponse.ok) throw new Error(`vocabs/shapes.ttl returned ${shapesResponse.status}`)
  if (!configResponse.ok) throw new Error(`host.json returned ${configResponse.status}`)
  const [shapesText, configJson] = await Promise.all([shapesResponse.text(), configResponse.json()])
  const shapes = await parseText(shapesText, new URL('/vocabs/shapes.ttl', document.baseURI).href)
  const validator = new ShapeValidator(shapes)
  const config = readHostConfig(configJson)
  capabilities = detectCapabilities(globalThis)
  relayLimit = config.relayPerSecond
  loader = new PluginLoader({ parse: parseText, validator, capabilities })

  for (const entry of entries.values()) await loadEntry(entry)
  startButton.disabled = false
  say('Profiles verified. Start white noise to hear the selected EQ.')
}

function makeNoiseSource () {
  const frames = context.sampleRate
  const buffer = context.createBuffer(2, frames, context.sampleRate)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let frame = 0; frame < data.length; frame++) data[frame] = Math.random() * 2 - 1
  }
  const noise = context.createBufferSource()
  noise.buffer = buffer
  noise.loop = true
  return noise
}

function ensureContext () {
  if (!context) {
    context = new AudioContext()
    inputGain = context.createGain()
    inputGain.gain.value = gainFromDb(Number($('#noise-level').value))
    switchGain = context.createGain()
    switchGain.gain.value = 0
    monitorGain = context.createGain()
    monitorGain.gain.value = gainFromDb(Number($('#output-level').value))
    switchGain.connect(monitorGain)
    monitorGain.connect(context.destination)
  }
  return context.resume()
}

async function ensureNode (entry) {
  if (entry.node) return entry.node
  entry.nodePromise ??= loader.instantiate(entry.profile, entry.granted, context).then(({ node }) => {
    for (const [symbol, value] of entry.values) {
      const parameter = node.parameters.get(symbol)
      if (!parameter) throw new Error(`${entry.name}: the processor has no AudioParam named "${symbol}"`)
      parameter.setValueAtTime(value, context.currentTime)
    }
    entry.node = node
    return node
  }).catch(error => {
    entry.nodePromise = null
    throw error
  })
  return entry.nodePromise
}

function setSwitchGain (value) {
  const now = context.currentTime
  switchGain.gain.cancelScheduledValues(now)
  switchGain.gain.setTargetAtTime(value, now, 0.01)
}

async function routeTo (entry, request) {
  const node = await ensureNode(entry)
  if (!playing || request !== switchRequest || activeKey !== entry.key) return
  if (playingEntry === entry) {
    setSwitchGain(1)
    return
  }

  const previous = playingEntry
  if (previous) {
    setSwitchGain(0)
    await wait(35)
    if (!playing || request !== switchRequest || activeKey !== entry.key) return
    inputGain.disconnect(previous.node)
    previous.node.disconnect(switchGain)
  }

  node.connect(switchGain)
  inputGain.connect(node)
  playingEntry = entry
  setSwitchGain(1)
  say(`White noise is playing through ${entry.name} to the default audio output.`)
}

function stopNoise (announce = true) {
  switchRequest++
  if (source) {
    source.stop()
    source.disconnect()
    source = null
  }
  if (playingEntry) {
    inputGain.disconnect(playingEntry.node)
    playingEntry.node.disconnect(switchGain)
    playingEntry = null
  }
  playing = false
  if (switchGain) setSwitchGain(0)
  startButton.textContent = 'Start white noise'
  if (announce) say('White noise stopped.')
}

async function startNoise () {
  startButton.disabled = true
  try {
    await ensureContext()
    const entry = entries.get(activeKey)
    if (!entry?.profile) throw new Error(`${entry?.name ?? activeKey} profile is not ready`)
    source = makeNoiseSource()
    source.connect(inputGain)
    source.start()
    playing = true
    startButton.textContent = 'Stop white noise'
    await routeTo(entry, ++switchRequest)
  } catch (error) {
    stopNoise(false)
    say(`Audio could not start: ${error.message}`, 'error')
  } finally {
    startButton.disabled = false
  }
}

function selectTab (key) {
  activeKey = key
  for (const entry of entries.values()) {
    const selected = entry.key === key
    const tab = $(`#tab-${entry.key}`)
    tab.setAttribute('aria-selected', String(selected))
    tab.tabIndex = selected ? 0 : -1
    $(`#panel-${entry.key}`).hidden = !selected
  }
  entries.get(key).panel?.skinView?.fit()
  if (playing) void routeTo(entries.get(key), ++switchRequest).catch(error => say(`Could not switch EQ: ${error.message}`, 'error'))
}

for (const entry of entries.values()) {
  $(`#tab-${entry.key}`).addEventListener('click', () => selectTab(entry.key))
}

$('#tabs').addEventListener('keydown', event => {
  const keys = [...entries.keys()]
  const index = keys.indexOf(activeKey)
  const next = event.key === 'ArrowRight' ? keys[(index + 1) % keys.length]
    : event.key === 'ArrowLeft' ? keys[(index + keys.length - 1) % keys.length]
      : event.key === 'Home' ? keys[0]
        : event.key === 'End' ? keys.at(-1)
          : null
  if (!next) return
  event.preventDefault()
  $(`#tab-${next}`).focus()
  selectTab(next)
})

startButton.addEventListener('click', () => {
  if (playing) stopNoise()
  else void startNoise()
})

$('#noise-level').addEventListener('input', event => {
  const value = Number(event.currentTarget.value)
  $('#noise-level-value').textContent = `${value} dB`
  if (inputGain) inputGain.gain.setValueAtTime(gainFromDb(value), context.currentTime)
})

$('#output-level').addEventListener('input', event => {
  const value = Number(event.currentTarget.value)
  $('#output-level-value').textContent = `${value} dB`
  if (monitorGain) monitorGain.gain.setValueAtTime(gainFromDb(value), context.currentTime)
})

prepareHost().catch(error => {
  startButton.disabled = true
  say(`Harness setup failed: ${error.message}`, 'error')
})
