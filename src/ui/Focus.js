// src/ui/Focus.js
//
// Keep the keyboard where it was across a redraw.
//
// web/app.js rebuilds the whole rack whenever the project changes, and a
// parameter change is a project change. Emptying a container blurs whatever
// was focused inside it, so a control could be nudged once with an arrow key
// and then the focus was on the body: the second press did nothing. That is
// WCAG 2.1.1 gone on every generated control at once, and it is invisible
// unless somebody puts their hands on the keyboard, because with a pointer
// nothing is wrong.
//
// Rebuilding from scratch rather than diffing is deliberate in that file, for
// the same reason the audio links are rebuilt rather than diffed: after an
// edit the interface is exactly what the model says. So the focus is put back
// instead, which is the small correction rather than the large one.

/**
 * Note what is focused inside `container`, for putting back after a rebuild.
 *
 * Returns a function that restores it. By id, because the element itself will
 * have been discarded and rebuilt by then; the ids of generated controls come
 * from the plugin IRI and the port symbol, so they survive. An element with no
 * id cannot be restored and is not guessed at.
 */
export function preserveFocus (container) {
  const document = container?.ownerDocument
  const active = document?.activeElement
  const id = active && active !== document.body && container.contains(active) ? active.id : null

  return () => {
    if (!id) return null
    const again = document.getElementById(id)
    // preventScroll: the rebuild has already put everything back where it
    // was, and jumping the page is the redraw becoming visible.
    again?.focus?.({ preventScroll: true })
    return again ?? null
  }
}
