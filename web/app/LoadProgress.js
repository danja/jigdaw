// web/app/LoadProgress.js
//
// What a person sees while a session opens: which plugin is being fetched, how many of them there are, and afterwards
// which ones did not load. Opening fetches and compiles every plugin one after another, which on a phone takes long
// enough to look like a hang, and a plugin that fails used to leave only a line in a log that the studio keeps
// collapsed, so a preset with a silent hole in it looked as if it had opened.
//
// One bar fixed to the foot of the page so it is the same on the three pages that open sessions. It is a status
// region: a screen reader announces "Loading Monochord, 2 of 4" as it changes. The progress is words and a bar, not
// the bar alone, and a failure stays until it is dismissed.

/** The name a plugin goes by while loading: the last part of its IRI, as the log already shows it. */
export function pluginName (iri) {
  try {
    const parts = new URL(iri).pathname.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? iri
  } catch { return String(iri) }
}

export function createLoadProgress (doc) {
  const root = doc.createElement('div')
  root.id = 'load-progress'
  root.setAttribute('role', 'status')
  root.hidden = true
  root.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:60;display:flex;flex-wrap:wrap;align-items:center;' +
    'gap:8px 12px;padding:10px 16px;background:var(--panel);color:var(--fg);border-top:1px solid var(--line);font-size:16px'
  const text = doc.createElement('span')
  text.style.cssText = 'flex:1 1 14rem'
  const bar = doc.createElement('progress')
  bar.style.cssText = 'flex:1 1 8rem;min-width:6rem;height:1rem'
  const dismiss = doc.createElement('button')
  dismiss.type = 'button'
  dismiss.textContent = 'Dismiss'
  dismiss.style.cssText = 'min-height:44px;min-width:44px;font:inherit;color:inherit;background:var(--bg);' +
    'border:1px solid var(--line);border-radius:6px;padding:0 14px'
  dismiss.hidden = true
  dismiss.addEventListener('click', () => { root.hidden = true })
  root.append(text, bar, dismiss)
  doc.body.append(root)

  const show = () => { root.hidden = false }

  return {
    element: root,

    /** A plugin is about to be fetched: `index` counts from 1 of `total`. */
    loading (iri, index, total) {
      show()
      dismiss.hidden = true
      bar.hidden = false
      bar.max = total
      bar.value = index - 1
      text.style.color = ''
      const words = `Loading ${pluginName(iri)}, ${index} of ${total}`
      text.textContent = words
      bar.setAttribute('aria-label', words)
    },

    /** Everything has been tried. A clean open goes away; a failure stays, in words, until dismissed. */
    finished ({ loaded, total, errors }) {
      bar.hidden = true
      if (errors.length === 0) { root.hidden = true; return }
      show()
      dismiss.hidden = false
      text.style.color = 'var(--err)'
      text.textContent = `Something went wrong: ${loaded.size} of ${total} plugins loaded. ${errors.join(' ')}`
    }
  }
}
