// web/app/Sessions.js
//
// A project is RDF, per docs/project-format.md, and the plugin IRIs in it are
// what make it portable: a session opened on a machine that has never seen these
// plugins carries everything needed to fetch them. That is the premise of the
// whole system applied to its own file format.
//
// A session whose audio clips play files this page holds, or whose editor
// layout is not the default, saves as a zip with editor.ttl and those files
// beside session.ttl; anything else is one Turtle file.
import { parseText } from '../../src/rdf/parse.js'
import { writeProject, writeEditor } from '../../src/rdf/ProjectWriter.js'
import { readProject, readEditor } from '../../src/rdf/ProjectReader.js'
import { openProject } from '../../src/ops/OpenProject.js'
import { listPresets, fetchPreset } from '../../src/ui/Presets.js'
import { encodeState } from '../../src/host/StateCodec.js'
import { clipAudio } from '../../src/engine/Scheduler.js'
import { readZip } from '../../src/host/Zip.js'
import { packSession, unpackSession } from '../../src/host/SessionArchive.js'

export function createSessions (ctx) {
  const { document, $, log } = ctx
  let openPresetByLabel = () => Promise.resolve()

  async function saveSession () {
    const { dispatcher, media } = ctx
    if (!dispatcher) { log('nothing to save yet', 'error'); return }
    // The model's own node.state is whatever was last restored or never set;
    // a stateful plugin's actual current state only lives in its own running
    // processor. Asked for, live, per node, before writing: contract section
    // 8 is what this is for, and skipping it would silently save whichever
    // asset a session started with rather than whatever a person loaded since.
    for (const node of dispatcher.project.nodes) {
      const state = await dispatcher.getNodeState(node.id)
      if (state !== null) dispatcher.apply([{ op: 'setNodeState', node: node.id, state: encodeState(state) }])
    }
    const turtle = writeProject(dispatcher.project, {
      iri: media.base,
      created: new Date().toISOString().replace(/\.\d+Z$/, 'Z')
    })
    const held = media.heldUnderBase([...new Set(clipAudio(dispatcher.project).map(c => c.source))])
    const packed = packSession({
      turtle,
      editor: dispatcher.project.hasEditorState ? writeEditor(dispatcher.project, { iri: media.base }) : null,
      media: held.map(iri => ({ name: iri.slice(media.base.length), bytes: media.get(iri).bytes }))
    })
    const blob = packed.kind === 'turtle'
      ? new Blob([packed.text], { type: 'text/turtle' })
      : new Blob([packed.bytes], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = packed.kind === 'turtle' ? 'session.ttl' : 'session.zip'
    link.click()
    // Revoked on the next turn: revoking immediately races the download in some
    // browsers and the file arrives empty.
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    log(packed.kind === 'turtle'
      ? `saved ${dispatcher.project.nodes.length} nodes as Turtle`
      : `saved ${dispatcher.project.nodes.length} nodes, ${held.length} audio file(s) and the editor layout as a zip`, 'ok')
  }

  /**
   * Replace the current session with one read from Turtle. `base` resolves any
   * relative IRI in it: a saved file carries its own @base, and a bundled preset
   * deliberately does not, so that its plugins are the ones served beside it.
   */
  async function openSession (text, base = document.baseURI, { files = new Map(), editor = null } = {}) {
    const d = await ctx.runtime.ensureRunning()
    const parsed = await parseText(text, base)
    let read
    try { read = readProject(parsed) } catch (error) { log(error.message, 'error'); return }
    // The session's own IRI is where its relative media resolve, so what came
    // in the zip beside it is filed under that.
    ctx.media.rebase(read.iri)
    for (const [name, bytes] of files) {
      ctx.media.put(new URL(name, ctx.media.base).href, bytes)
    }

    const opened = await openProject(d, read, {
      onLoading: iri => log(`GET ${iri}`),
      onCleared: () => { ctx.rack.reset(); ctx.editors.closeAll(); ctx.arrangement.reset() }
    })
    for (const message of opened.errors) log(message, 'error')
    if (!opened.ok) return

    // After the nodes exist: editor metadata naming nothing is dropped. Always
    // replaced, even when the session has none, because ids are reused and the
    // previous session's layout would otherwise land on this one's tracks.
    try {
      d.project.loadEditor(editor === null
        ? { positions: new Map(), tracks: new Map() }
        : readEditor(await parseText(editor, read.iri), read.iri))
    } catch (error) { log(`editor layout ignored: ${error.message}`, 'error') }

    ctx.transport.showTransport()
    ctx.rack.draw()
    ctx.history.updateButtons()
    ctx.expose()
    log(`opened ${opened.loaded.size} of ${opened.total} nodes`, 'ok')
  }


  /** Wire Save, Open and the presets menu. */
  function mount () {
    $('save').addEventListener('click', () => saveSession().catch(error => log(error.message, 'error')))
    $('open').addEventListener('click', () => $('openfile').click())
    $('openfile').addEventListener('change', async event => {
      const file = event.target.files?.[0]
      if (!file) return
      // Cleared so that opening the same file twice in a row still fires a change.
      event.target.value = ''
      try {
        // A zip is a session with its media beside it; anything else is Turtle.
        const bytes = new Uint8Array(await file.arrayBuffer())
        if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
          const { turtle, editor, media } = unpackSession(await readZip(bytes))
          await openSession(turtle, document.baseURI, { files: media, editor })
        } else {
          await openSession(new TextDecoder().decode(bytes))
        }
      } catch (error) { log(error.message, 'error') }
    })

    // Opened by a button rather than on change: choosing from a select must not
    // replace the whole session by itself (WCAG 3.2.2), and a keyboard user moving
    // through the options would otherwise open every one they passed.
    let presets = []
    $('presetbar').addEventListener('submit', event => {
      event.preventDefault()
      openPreset(presets[Number($('preset').value)])
    })
    /** Open one preset, from the menu or from the empty arrangement's own button. */
    function openPreset (preset) {
      log(`opening preset ${preset.label}`)
      return fetchPreset({ fetch: url => fetch(url), url: preset.url })
        .then(text => openSession(text, preset.url))
        .catch(error => log(error.message, 'error'))
    }
    openPresetByLabel = label => {
      const preset = presets.find(p => p.label === label)
      if (!preset) { log(`no preset called ${label}`, 'error'); return Promise.resolve() }
      return openPreset(preset)
    }
    listPresets({
      fetch: url => fetch(url),
      index: new URL('presets/index.json', document.baseURI).href
    }).then(found => {
      presets = found
      $('preset').replaceChildren(...found.map(({ label }, i) => {
        const option = document.createElement('option')
        option.value = String(i)
        option.textContent = label
        return option
      }))
      $('presets').hidden = found.length === 0
    }).catch(error => log(`presets: ${error.message}`, 'error'))
  }

  return { saveSession, openSession, mount, openPreset: label => openPresetByLabel(label) }
}
