// web/app/Show.js
//
// The step the person is on: Simple, Standard or Advanced (docs/learning-curve.md, src/ui/Show.js).
//
// Mounting puts each control's first step on it as `data-from`, and the step on <html> as `data-step`; a rule in index.html does
// the leaving out. The step is the person's own choice once made, and is remembered in this browser. Until then a phone starts
// on Simple and anything wider on Standard. It is not saved with a session, because it describes how someone likes to look at
// the studio and not the piece.
//
// Tabs are drawn by createTabs (src/ui/Tabs.js), after the markup, so they are given here and not found. Going to a tab that the
// step does not draw does not switch to it; it says which step draws it and offers to show that, since every place in the page
// that sends a person to a tab (a track's name, a plugin in a chain) is the reason they would want it.
import { FROM, STEPS, STEP_LABELS, NARROW_QUERY, drawnAt, asStep, defaultStep, tabsDrawnAt } from '../../src/ui/Show.js'

const KEY = 'jigdaw.show'

export function createShow (ctx) {
  const { document, window, $ } = ctx
  let step = null
  let tabs = null
  let tabList = []

  function stored () {
    try { return asStep(window.localStorage.getItem(KEY)) } catch { return null /* storage unavailable: the default applies */ }
  }

  function remember (next) {
    try { window.localStorage.setItem(KEY, next) } catch { /* private window: kept for this visit only */ }
  }

  function clearNote () { $('show-note').hidden = true }

  /** Whether the tab with this id is drawn at the current step. */
  function allowsTab (id) {
    return drawnAt(step, FROM[`#tab-${id}`])
  }

  /** The tab was asked for from code and the step does not draw it: say which step does. */
  function refuseTab (id) {
    const from = FROM[`#tab-${id}`]
    const label = $(`tab-${id}`).textContent
    $('show-note-text').textContent = `The ${label} tab is drawn in ${STEP_LABELS[from]}.`
    const raise = $('show-note-raise')
    raise.textContent = `Show ${STEP_LABELS[from]}`
    raise.onclick = () => { set(from, { remember: true }); tabs.select(id); clearNote() }
    $('show-note').hidden = false
  }

  /** Draw `next`. A choice by the person is remembered; the start of a visit is not, so a phone is not stuck on Simple for ever. */
  function set (next, { remember: choose = false } = {}) {
    if (!STEPS.includes(next)) throw new Error(`no such step: ${next}`)
    step = next
    document.documentElement.dataset.step = next
    $('show-step').value = next
    if (choose) remember(next)
    clearNote()
    const drawn = tabsDrawnAt(next, tabList)
    // The tab list is no use with one tab, and a person who is on a tab that has just gone is put back on the first.
    tabs.element.hidden = drawn.length < 2
    if (!drawn.includes(tabs.selected())) tabs.select(drawn[0])
  }

  /** `list` is the tabs as createTabs was given them, and `tabsApi` is what it returned. */
  function mount (list, tabsApi) {
    tabList = list
    tabs = tabsApi
    for (const [selector, from] of Object.entries(FROM)) {
      for (const element of document.querySelectorAll(selector)) element.dataset.from = from
    }
    $('show-step').addEventListener('change', () => {
      const chosen = asStep($('show-step').value)
      if (chosen) set(chosen, { remember: true })
    })
    set(stored() ?? defaultStep({ narrow: window.matchMedia(NARROW_QUERY).matches }))
  }

  return { mount, set, allowsTab, refuseTab, get step () { return step } }
}
