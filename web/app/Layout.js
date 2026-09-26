// web/app/Layout.js
//
// Showing and hiding the Browser column, so the arrangement can have the
// width. A small arrow in the sidebar header, with aria-expanded saying which
// it is, its accessible name saying what pressing it does, and its glyph
// pointing at the sidebar it collapses. Collapsed, the sidebar is a 48px rail
// holding only the arrow; the panel's contents are display:none, so they leave
// the accessibility tree exactly as hidden would.
//
// Remembered in this browser only, as a per-viewer convenience: nothing about
// a session depends on it, so a storage that is blocked or cleared only means
// the column comes back.

const KEY = 'jigdaw.browserHidden'

export function createLayout (ctx) {
  const { document, window, $ } = ctx

  function show (visible) {
    $('browser').classList.toggle('rail', !visible)
    document.querySelector('main').classList.toggle('no-browser', !visible)
    const button = $('toggle-browser')
    button.setAttribute('aria-expanded', String(visible))
    button.setAttribute('aria-label', visible ? 'Hide browser panel' : 'Show browser panel')
    button.textContent = visible ? '‹' : '›'
    try { window.localStorage.setItem(KEY, visible ? '0' : '1') } catch { /* storage unavailable */ }
  }

  function mount () {
    let hidden = false
    try { hidden = window.localStorage.getItem(KEY) === '1' } catch { /* storage unavailable */ }
    show(!hidden)
    $('toggle-browser').addEventListener('click', () => show($('browser').classList.contains('rail')))
  }

  return { mount }
}
