// web/reel.js
//
// The Reel page: write a script, run it against a piece while it plays. A third front end over the same model,
// dispatcher, engine, transport and Script tab as the studio and the simple page (docs/pwa.md), not a second
// implementation. It adds what a script writer wants around the editor: the examples to start from, the names a
// script can use in the open piece, and the language reference.
import { createRuntime } from './app/Runtime.js'
import { createTransport } from './app/Transport.js'
import { createSessions } from './app/Sessions.js'
import { createMedia } from './app/Media.js'
import { createPwa } from './app/Pwa.js'
import { createScript } from './app/Script.js'
import { createTabs } from '../src/ui/Tabs.js'
import { createExampleList } from '../src/ui/ExampleList.js'
import { createNamesPanel } from '../src/ui/NamesPanel.js'
import { createReferencePanel } from '../src/ui/ReferencePanel.js'
import { listPresets, fetchPreset } from '../src/ui/Presets.js'
import { existingPlugins } from '../src/reel/Host.js'
import { describeNames } from '../src/reel/Names.js'
import { EXAMPLES } from '../src/reel/Examples.js'

const $ = id => document.getElementById(id)

/** The last thing that happened, in a line under the title. Errors say so in words, not only by colour. */
const log = (message, kind = 'info') => {
  const status = $('status')
  status.textContent = kind === 'error' ? `Something went wrong: ${message}` : message
  status.classList.toggle('error', kind === 'error')
  console.log(`[jiggy reel] ${message}`)
}

let redraw = () => {}

const ctx = {
  document,
  window,
  $,
  log,
  dispatcher: null,
  engine: null,
  analyser: null,
  hostConfig: null,
  hostCapabilities: null,
  clipPlayer: null,
  // Only what the shared modules call. The studio's parts are not here.
  rack: { draw: () => redraw(), reset () {}, trackLabel: (track, index) => track.label ?? `Track ${index + 1}` },
  arrangement: { playhead () {}, reset () {} },
  editors: { parameter () {}, closeAll () {}, keepOnly () {} },
  history: { updateButtons () {} },
  align: { preferred: fromConfig => fromConfig, sync () {} },
  /** For the console and for a check driven from outside the page, as on the other pages. */
  expose () { window.__jigdaw = { dispatcher: ctx.dispatcher, engine: ctx.engine } }
}
ctx.media = createMedia(document)
ctx.runtime = createRuntime(ctx)
ctx.transport = createTransport(ctx)
ctx.sessions = createSessions(ctx)
ctx.pwa = createPwa(ctx)
ctx.script = createScript(ctx)

const panel = ctx.script.panel

// ── the pieces ────────────────────────────────────────────────────────────────

let pieces = []
let current = null

/** The bundled piece with this file name, as the presets index lists it. */
const pieceFor = file => {
  const found = pieces.find(p => p.url.endsWith(`/${file}`))
  if (!found) throw new Error(`no bundled piece called ${file}`)
  return found
}

async function openPiece (piece) {
  // The old script's loops name plugins of the old piece, so they stop with it.
  if (current !== null) ctx.script.stop()
  log(`Opening ${piece.label}...`)
  const text = await fetchPreset({ fetch: url => fetch(url), url: piece.url })
  await ctx.sessions.openSession(text, piece.url)
  if (ctx.dispatcher.project.nodes.length === 0) throw new Error(`${piece.label} did not open`)
  current = piece.url
  $('piece').value = piece.url
  $('piece-now').textContent = `Open: ${piece.label}.`
  showNames()
  panel.status(`${piece.label} is open. Press Play, then run the script.`)
  log(`${piece.label} is ready.`)
}

$('piece-form').addEventListener('submit', event => {
  event.preventDefault()
  const piece = pieces.find(p => p.url === $('piece').value)
  if (piece) openPiece(piece).catch(error => log(error.message, 'error'))
})

listPresets({ fetch: url => fetch(url), index: new URL('presets/index.json', document.baseURI).href })
  .then(found => {
    pieces = found
    $('piece').replaceChildren(...found.map(piece => {
      const option = document.createElement('option')
      option.value = piece.url
      option.textContent = piece.label
      return option
    }))
    examples.draw()
  })
  .catch(error => log(`the pieces could not be listed: ${error.message}`, 'error'))

// ── the tabs ──────────────────────────────────────────────────────────────────

ctx.tabs = createTabs(document, [
  { id: 'script', label: 'Script', panel: $('script-panel') },
  { id: 'examples', label: 'Examples', panel: $('examples-panel') },
  { id: 'names', label: 'This piece', panel: $('names-panel') },
  { id: 'reference', label: 'Reference', panel: $('reference-panel') }
])
$('tabs-mount').append(ctx.tabs.element)

// ── inserting a line ──────────────────────────────────────────────────────────

/** Say a line was added, in words for a screen reader and on the button for everyone else. */
function inserted (text, button) {
  panel.insert(text)
  $('inserted').textContent = `Added to the script: ${text}`
  const label = button.textContent
  button.textContent = 'Added'
  setTimeout(() => { button.textContent = label }, 1500)
}

const names = createNamesPanel(document, { onInsert: inserted })
$('names-mount').append(names.element)
$('reference-mount').append(createReferencePanel(document, { onInsert: inserted }).element)

/** What a script can name now, redrawn when the piece changes by anything, including a script's own `load`. */
function showNames () {
  const d = ctx.dispatcher
  if (!d) { names.draw([]); return }
  const { existing, ids } = existingPlugins(d, { names: new Map() })
  const labelOf = name => {
    const id = ids.get(name)
    return d.project.nodes.find(n => n.id === id)?.label ?? d.engineNode(id)?.profile?.label ?? name
  }
  names.draw(describeNames(existing, labelOf))
}
redraw = showNames
showNames()

// ── the examples ──────────────────────────────────────────────────────────────

/** An example in the editor, on its own piece. Opens the piece only when it is not the one already open. */
async function useExample (example, { play }) {
  const piece = pieceFor(example.piece)
  if (piece.url !== current) await openPiece(piece)
  panel.setSource(example.source)
  panel.problems(null)
  panel.plan(null)
  ctx.tabs.select('script')
  if (!play) {
    panel.status(`${example.title} is in the editor. Press Play, then Run.`)
    panel.focus()
    return
  }
  await ctx.transport.play()
  await ctx.script.run(example.source, { now: true })
}

const examples = (() => {
  const mount = $('examples-mount')
  return {
    draw () {
      const list = createExampleList(document, {
        examples: EXAMPLES,
        pieceLabel: file => pieceFor(file).label,
        onEdit: example => useExample(example, { play: false }).catch(error => log(error.message, 'error')),
        onPlay: example => useExample(example, { play: true }).catch(error => log(error.message, 'error'))
      })
      mount.replaceChildren(list.element)
    }
  }
})()

// ── play ──────────────────────────────────────────────────────────────────────

$('play').addEventListener('click', () => ctx.transport.play().catch(error => log(error.message, 'error')))
$('stop').addEventListener('click', () => ctx.transport.stop())

function showSpeed () {
  const bpm = Number($('tempo').value)
  $('tempo-value').textContent = `${bpm} bpm`
  $('tempo').setAttribute('aria-valuetext', `${bpm} beats a minute`)
}
$('tempo').addEventListener('input', async () => {
  showSpeed()
  const d = await ctx.runtime.ensureRunning()
  const result = d.apply([{ op: 'setTransport', tempoPoints: [{ atBeat: 0, bpm: Number($('tempo').value) }] }])
  if (!result.ok) log(result.message, 'error')
})

// ── script files ──────────────────────────────────────────────────────────────

// A script is text, so a file is the simplest way to keep one outside the browser. Opening one puts it in the
// editor and does not run it: a script from a file is untrusted input, and a person presses Run.
$('script-save').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([panel.source()], { type: 'text/plain' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: 'script.reel' })
  link.click()
  URL.revokeObjectURL(url)
  panel.status('Saved as script.reel.')
})
$('script-open').addEventListener('click', () => $('script-file').click())
$('script-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]
  if (!file) return
  event.target.value = ''
  try {
    panel.setSource(await file.text())
    panel.problems(null)
    panel.plan(null)
    panel.status(`${file.name} is in the editor. It has not been run.`)
  } catch (error) { log(error.message, 'error') }
})

ctx.pwa.mount()
showSpeed()
