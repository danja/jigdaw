// web/app/Layout.js
//
// Showing and hiding the Browser column, so the arrangement can have the
// width. A disclosure button, with aria-expanded saying which it is and its
// text saying what pressing it does.
//
// Remembered in this browser only, as a per-viewer convenience: nothing about
// a session depends on it, so a storage that is blocked or cleared only means
// the column comes back.

const KEY = 'jigdaw.browserHidden'

export function createLayout (ctx) {
  const { document, window, $ } = ctx

  function show (visible) {
    $('browser').hidden = !visible
    document.querySelector('main').classList.toggle('no-browser', !visible)
    const button = $('toggle-browser')
    button.setAttribute('aria-expanded', String(visible))
    button.textContent = visible ? 'Hide browser' : 'Show browser'
    try { window.localStorage.setItem(KEY, visible ? '0' : '1') } catch { /* storage unavailable */ }
  }

  function mount () {
    let hidden = false
    try { hidden = window.localStorage.getItem(KEY) === '1' } catch { /* storage unavailable */ }
    show(!hidden)
    $('toggle-browser').addEventListener('click', () => show($('browser').hidden))
  }

  return { mount }
}
