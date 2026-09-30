// src/ui/Dock.js
//
// The dock: one region under the lanes that shows the editor for whatever is
// selected. It owns the frame and the splitter and knows nothing about what
// goes in it; the caller hands it named slots (a piano roll, an audio clip
// panel, a track's chain) and says which to show.
//
// The splitter is a WAI-ARIA window splitter: a focusable separator with a
// value. Up and Down move it by a step, Home and End go to either limit, and a
// pointer drag follows from the document, not the handle, because a drag that
// ends outside the handle would otherwise never finish (CLAUDE.md).

export const DOCK_MIN = 160
export const DOCK_MAX = 720
export const DOCK_DEFAULT = 320
export const DOCK_STEP = 24
const KEY = 'jigdaw.dockHeight'

const clamp = n => Math.min(DOCK_MAX, Math.max(DOCK_MIN, Math.round(n)))

/**
 * `slots` is the list of slot names. `storage` is anything with getItem and
 * setItem, or null: a remembered height is a convenience of this browser and
 * nothing depends on it.
 */
export function createDock (document, { slots, storage = null }) {
  if (!Array.isArray(slots) || slots.length === 0) throw new Error('a dock needs at least one slot')
  const element = document.createElement('section')
  element.className = 'dock'
  element.id = 'dock'
  const heading = document.createElement('h2')
  heading.id = 'dock-title'
  element.setAttribute('aria-labelledby', heading.id)

  const splitter = document.createElement('div')
  splitter.className = 'dock-splitter'
  splitter.id = 'dock-splitter'
  splitter.setAttribute('tabindex', '0')
  splitter.setAttribute('role', 'separator')
  splitter.setAttribute('aria-orientation', 'horizontal')
  splitter.setAttribute('aria-label', 'Resize the editor')
  splitter.setAttribute('aria-valuemin', String(DOCK_MIN))
  splitter.setAttribute('aria-valuemax', String(DOCK_MAX))

  const body = document.createElement('div')
  body.className = 'dock-body'
  const slot = new Map()
  for (const name of slots) {
    const s = document.createElement('div')
    s.className = `dock-slot dock-${name}`
    s.hidden = true
    slot.set(name, s)
    body.append(s)
  }
  element.append(splitter, heading, body)

  let height = DOCK_DEFAULT
  try {
    const saved = Number(storage?.getItem(KEY))
    if (Number.isFinite(saved) && saved > 0) height = clamp(saved)
  } catch { /* storage unavailable */ }

  function setHeight (next, { remember = true } = {}) {
    height = clamp(next)
    body.style.height = `${height}px`
    splitter.setAttribute('aria-valuenow', String(height))
    splitter.setAttribute('aria-valuetext', `${height} pixels tall`)
    if (remember) { try { storage?.setItem(KEY, String(height)) } catch { /* storage unavailable */ } }
  }
  setHeight(height, { remember: false })

  splitter.addEventListener('keydown', event => {
    const next = { ArrowUp: height + DOCK_STEP, ArrowDown: height - DOCK_STEP, Home: DOCK_MIN, End: DOCK_MAX }[event.key]
    if (next === undefined) return
    event.preventDefault()
    setHeight(next)
  })
  splitter.addEventListener('pointerdown', event => {
    if (event.button !== 0) return
    event.preventDefault()
    const originY = event.clientY
    const originHeight = height
    const move = e => setHeight(originHeight + (originY - e.clientY), { remember: false })
    const up = e => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      setHeight(originHeight + (originY - e.clientY))
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  })

  return {
    element,
    get height () { return height },
    slot: name => {
      if (!slot.has(name)) throw new Error(`the dock has no slot ${name}`)
      return slot.get(name)
    },
    /** Show one slot, with a title that says what is in it. */
    show (name, title) {
      if (!slot.has(name)) throw new Error(`the dock has no slot ${name}`)
      for (const [n, s] of slot) s.hidden = n !== name
      // The first slot is the resting one. Nothing in it to resize, so the
      // splitter is left out and the body is as tall as its text.
      const resting = name === slots[0]
      splitter.hidden = resting
      body.classList.toggle('idle', resting)
      heading.textContent = title
    },
    get shown () { return [...slot].find(([, s]) => !s.hidden)?.[0] ?? null }
  }
}
