// tests/web/Script.test.js
//
// The page's Script tab glue (web/app/Script.js), for the two things it does with a saved session: put the tab's
// text into the session on Save, and put a saved script into the tab on Open without running it. The second is
// the guarantee that opening a session from somewhere else does nothing a person did not ask for, so it is checked
// by what was NOT called.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createScript } from '../../web/app/Script.js'
import { REEL_EXAMPLE } from '../../src/ui/ScriptPanel.js'
import { ScriptState } from '../../src/model/ScriptState.js'

let script
let ctx
let started

beforeEach(() => {
  const { document, window } = parseHTML('<!doctype html><body><div id="script-mount"></div></body>')
  started = []
  ctx = {
    document,
    window,
    $: id => document.getElementById(id),
    log () {},
    // Anything that would run, load or start audio, recorded: opening a session must call none of it.
    runtime: { ensureRunning: async () => { started.push('ensureRunning') } },
    engine: null
  }
  script = createScript(ctx)
})

const project = () => ({ scripts: new ScriptState() })

describe('saving: what the tab holds goes into the session as text', () => {
  it('saves the text as typed, labelled and timed', () => {
    const p = project()
    script.panel.setSource('a.mix = 1\n# note')
    script.captureInto(p, '2026-10-01T12:00:00Z')
    expect(p.scripts.get('script')).toMatchObject({ source: 'a.mix = 1\n# note', label: 'Script', savedAt: '2026-10-01T12:00:00Z' })
  })

  it('saves nothing for the tab\'s own example, so a session that never had a script is not given one', () => {
    const p = project()
    script.panel.setSource(REEL_EXAMPLE)
    script.captureInto(p, 'now')
    expect(p.scripts.size).toBe(0)
  })

  it('saves nothing for an empty tab, and removes a script that was there before', () => {
    const p = project()
    p.scripts.set('script', { source: 'old' })
    script.panel.setSource('  \n\t')
    script.captureInto(p, 'now')
    expect(p.scripts.size).toBe(0)
  })

  it('replaces a script saved earlier with what the tab holds now', () => {
    const p = project()
    script.panel.setSource('one')
    script.captureInto(p, 't1')
    script.panel.setSource('two')
    script.captureInto(p, 't2')
    expect(p.scripts.all).toHaveLength(1)
    expect(p.scripts.get('script').source).toBe('two')
  })
})

describe('opening: a saved script is shown and never run', () => {
  const saved = { id: 'script', label: 'Script', language: 'x', source: 'load a = https://evil.example/p/\na.mix = 1', savedAt: 't' }

  it('puts the text in the tab', () => {
    script.restore(saved)
    expect(script.panel.source()).toBe(saved.source)
  })

  it('says it has not been run, and that it should be checked first', () => {
    script.restore(saved)
    const status = ctx.document.getElementById('script-status').textContent
    expect(status).toMatch(/has not been run/)
    expect(status).toMatch(/Check it, then run it/)
  })

  it('starts nothing, loads nothing and asks for no audio', () => {
    script.restore(saved)
    expect(started).toEqual([])
    // The runner does not exist until audio has started, so a script could not run even if something tried.
    expect(() => script.agentReel().run('x')).toThrow(/not ready/)
  })

  it('clears an old plan and old problems, which belonged to the previous script', () => {
    script.panel.problems([{ line: 1, message: 'old' }])
    script.panel.plan({ loads: [], steps: [] })
    script.restore(saved)
    expect(script.panel.elements.problems.hasAttribute('hidden')).toBe(true)
    expect(script.panel.elements.plan.hasAttribute('hidden')).toBe(true)
  })

  it('does not show Stop, since nothing is running', () => {
    script.restore(saved)
    expect(script.panel.elements.stop.hasAttribute('hidden')).toBe(true)
  })

  it('logs that it was not run', () => {
    script.restore(saved)
    expect(script.panel.elements.logList.textContent).toMatch(/has not been run/)
  })
})

describe('what the page can do before audio starts', () => {
  it('refuses to run, check or describe a script until the runner exists, rather than failing obscurely', () => {
    const reel = script.agentReel()
    expect(() => reel.check('x')).toThrow(/not ready/)
    expect(() => reel.run('x', {})).toThrow(/not ready/)
    expect(() => reel.describe({})).toThrow(/not ready/)
  })

  it('has a clock that does nothing until there is one, so Transport can call it from the simple page\'s path', () => {
    expect(() => { script.clockStart(1); script.clockTick(); script.clockStop() }).not.toThrow()
  })
})
