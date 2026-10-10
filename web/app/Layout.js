// web/app/Layout.js
//
// Showing and hiding the Browser, so the arrangement has the width. The
// Browser is closed when the page opens: a first look at a DAW is the tracks,
// and the empty arrangement offers a button that opens it.
//
// A button in the transport bar opens and closes it, with aria-expanded saying
// which and aria-controls naming the panel; a Close button at the top of the
// panel does the same. Closed, the panel is `hidden`, so it leaves the tab order
// and the accessibility tree and takes no width: there is no rail. Opening moves
// the focus to the search box, and closing puts it back on the button that
// opened it, so a keyboard user is never left on something that has gone.
//
// Not remembered. It was, and a person who had opened it once to load a preset got it open on every visit after,
// squeezing the arrangement they came to look at; the page now starts the way a first look wants, and opening it
// is one press when it is wanted.

export function createLayout (ctx) {
  const { document, window, $ } = ctx

  function show (open, { focus = false } = {}) {
    $('browser').hidden = !open
    document.querySelector('main').classList.toggle('no-browser', !open)
    const button = $('toggle-browser')
    button.setAttribute('aria-expanded', String(open))
    if (focus) { if (open) $('q').focus(); else button.focus() }
  }

  /** Open or close the Browser from elsewhere on the page, moving the focus with it. */
  function showBrowser (open) { show(open, { focus: true }) }

  function mount () {
    show(false)
    $('toggle-browser').addEventListener('click', () => show($('browser').hidden, { focus: true }))
    $('close-browser').addEventListener('click', () => show(false, { focus: true }))
    $('browser').addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); show(false, { focus: true }) }
    })
  }

  return { mount, showBrowser }
}
