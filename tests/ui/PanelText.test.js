// tests/ui/PanelText.test.js
//
// A user replaceable asset of media type text/plain is drawn as a text area (contract section 5.5). It is the generated
// panel, so it is on every page and needs no plugin code, and it has to be as usable as a knob: named, with its limit said in
// words, reachable by keyboard, and honest about what the plugin did with what was typed.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createPanel } from '../../src/ui/Panel.js'
import { showAssetText } from '../../src/ui/AssetText.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })

const asset = over => ({ iri: 'https://x.test/plugins/sam/#text', userReplaceable: true, mediaType: 'text/plain', maxBytes: 20, ...over })
const attach = panel => { document.body.append(panel.element); return panel }
const profile = assets => ({ iri: 'https://x.test/plugins/sam/', label: 'Sam', ports: [], assets })
const type = (area, value) => { area.value = value; area.dispatchEvent(new window.Event('input', { bubbles: true })) }
const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }))
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('a text asset in the generated panel', () => {
  it('draws a labelled text area with Apply, beside the file picker, for a text/plain user replaceable asset', () => {
    const panel = createPanel(document, profile([asset()]), () => {}, () => {})
    const area = panel.element.querySelector('textarea')
    expect(area).not.toBeNull()
    expect(panel.element.querySelector(`label[for="${area.id}"]`).textContent).toBe('text')
    expect([...panel.element.querySelectorAll('button')].map(b => b.textContent)).toContain('Apply')
    expect(panel.element.querySelector('input[type=file]')).not.toBeNull()
    expect(area.getAttribute('aria-describedby')).toBe(`${area.id}-hint`)
  })

  it('draws nothing for an asset that is not text, or not replaceable', () => {
    const none = createPanel(document, profile([asset({ mediaType: 'audio/wav' }), asset({ userReplaceable: false, iri: 'https://x.test/#b' })]), () => {}, () => {})
    expect(none.element.querySelector('textarea')).toBeNull()
  })

  it('says how much of the limit is used, in words, and counts bytes rather than characters', () => {
    const panel = attach(createPanel(document, profile([asset()]), () => {}, () => {}))
    const area = panel.element.querySelector('textarea')
    const hint = document.getElementById(area.getAttribute('aria-describedby'))
    expect(hint.textContent).toBe('0 of 20 bytes')
    type(area, 'héllo')
    expect(hint.textContent).toBe('6 of 20 bytes')
  })

  it('says only the size when the profile declares no limit', () => {
    const panel = attach(createPanel(document, profile([asset({ maxBytes: null })]), () => {}, () => {}))
    const area = panel.element.querySelector('textarea')
    type(area, 'abc')
    expect(document.getElementById(`${area.id}-hint`).textContent).toBe('3 bytes')
  })

  it('sends the typed text, as bytes, to onLoadAsset, and says it was applied', async () => {
    const sent = []
    const panel = createPanel(document, profile([asset()]), () => {}, async (key, blob) => { sent.push([key, new TextDecoder().decode(await blob.arrayBuffer())]); return { ok: true } })
    const area = panel.element.querySelector('textarea')
    type(area, 'hello world')
    click([...panel.element.querySelectorAll('button')].find(b => b.textContent === 'Apply'))
    await settle()
    expect(sent).toEqual([['text', 'hello world']])
    expect(panel.element.querySelector('[role=status]').textContent).toBe('Applied.')
  })

  it('applies from the keyboard with Ctrl+Enter and not with Enter alone', async () => {
    const sent = []
    const panel = createPanel(document, profile([asset()]), () => {}, async (key, blob) => { sent.push(key); return { ok: true } })
    const area = panel.element.querySelector('textarea')
    type(area, 'hi')
    const key = props => { const e = new window.Event('keydown', { bubbles: true, cancelable: true }); for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v }); area.dispatchEvent(e) }
    key({ key: 'Enter' })
    await settle()
    expect(sent).toEqual([])
    key({ key: 'Enter', ctrlKey: true })
    await settle()
    expect(sent).toEqual(['text'])
  })

  it('refuses text over the limit, in words, and does not send it', async () => {
    const sent = []
    const panel = attach(createPanel(document, profile([asset({ maxBytes: 5 })]), () => {}, async (key) => { sent.push(key); return { ok: true } }))
    const area = panel.element.querySelector('textarea')
    type(area, 'too long for it')
    click([...panel.element.querySelectorAll('button')].find(b => b.textContent === 'Apply'))
    await settle()
    expect(sent).toEqual([])
    expect(panel.element.querySelector('[role=status]').textContent).toBe('Not applied: 15 bytes is over the limit of 5.')
    expect(document.getElementById(`${area.id}-hint`).classList.contains('over')).toBe(true)
  })

  it('says so when the host refuses it', async () => {
    const panel = createPanel(document, profile([asset()]), () => {}, async () => ({ ok: false, message: 'no such node' }))
    type(panel.element.querySelector('textarea'), 'x')
    click([...panel.element.querySelectorAll('button')].find(b => b.textContent === 'Apply'))
    await settle()
    expect(panel.element.querySelector('[role=status]').textContent).toBe('Not applied: no such node')
  })

  it('shows the text the plugin has loaded, and keeps unsent typing when it changes underneath', () => {
    const panel = createPanel(document, profile([asset()]), () => {}, () => {})
    const area = panel.element.querySelector('textarea')
    panel.setAssetText('text', 'from the plugin')
    expect(area.value).toBe('from the plugin')
    type(area, 'my edit')
    panel.setAssetText('text', 'changed elsewhere')
    expect(area.value).toBe('my edit')
    expect(panel.element.querySelector('[role=status]').textContent).toMatch(/Your edits are kept/)
    // Nothing unsent: it follows.
    type(area, 'from the plugin')
    panel.setAssetText('text', 'later')
    expect(area.value).toBe('later')
  })
})

describe('showAssetText', () => {
  const dispatcher = state => ({ getNodeState: async () => state })

  it('reads the asset\'s bytes from the node\'s state under its key and shows them as text', async () => {
    const panel = createPanel(document, profile([asset()]), () => {}, () => {})
    const bytes = new TextEncoder().encode('Hello world').buffer
    await showAssetText(panel, profile([asset()]), dispatcher({ text: bytes }), 'node-1')
    expect(panel.element.querySelector('textarea').value).toBe('Hello world')
  })

  it('shows nothing, without failing, when the plugin gives no state or none for the key', async () => {
    const panel = createPanel(document, profile([asset()]), () => {}, () => {})
    await showAssetText(panel, profile([asset()]), dispatcher(null), 'node-1')
    await showAssetText(panel, profile([asset()]), dispatcher({ other: new ArrayBuffer(1) }), 'node-1')
    expect(panel.element.querySelector('textarea').value).toBe('')
  })

  it('does not ask a plugin with no text asset for its state', async () => {
    let asked = 0
    const none = profile([asset({ mediaType: 'audio/wav' })])
    await showAssetText({ setAssetText () {} }, none, { getNodeState: async () => { asked++ } }, 'node-1')
    expect(asked).toBe(0)
  })
})
