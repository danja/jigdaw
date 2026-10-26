// web/app/Help.js
//
// Help for the studio's own controls, for a keyboard. Most controls carry a `title`, which a pointer shows on hover and a screen reader reads as
// the description, and which a keyboard user never sees. When a control takes the focus by keyboard, its title is drawn in a small tip beside it,
// so what the control does is on the screen for someone who is not using a pointer. (A plugin's own controls do this in the panel's help line,
// src/ui/Panel.js; this is the same idea for the page's.)
//
// Only for a keyboard: `:focus-visible` is what a browser sets for focus that did not come from a click, so a pointer press is not given a tip on
// top of the native one. The tip never takes the focus, is hidden from assistive technology (the title is already the control's description),
// and goes when the focus leaves, when Escape is pressed, or when the page scrolls or is resized, which would leave it under the wrong control.
export function createHelp (ctx) {
  const { document, window } = ctx
  let tip = null
  let shownFor = null

  function hide () {
    if (tip) tip.hidden = true
    shownFor = null
  }

  function show (element, text) {
    if (!tip) {
      tip = document.createElement('div')
      tip.className = 'help-tip'
      tip.setAttribute('aria-hidden', 'true')
      document.body.append(tip)
    }
    tip.textContent = text
    tip.hidden = false
    shownFor = element
    const box = element.getBoundingClientRect()
    const width = tip.offsetWidth || 0
    const left = Math.max(8, Math.min(box.left, (window.innerWidth || 0) - width - 8))
    tip.style.left = `${left}px`
    tip.style.top = `${box.bottom + 6}px`
  }

  function mount () {
    document.addEventListener('focusin', event => {
      const focused = event.target
      const element = focused?.closest?.('[title]')
      const text = element?.getAttribute('title')
      // Not a keyboard focus (a click, a script), or nothing to say. It is the element that took the focus that :focus-visible is asked of.
      if (!element || !text || !focused.matches(':focus-visible')) { hide(); return }
      // A title that only says the control's name (a knob called Bars, titled Bars) tells a keyboard user nothing the focus ring does not.
      const name = (element.getAttribute('aria-label') ?? element.labels?.[0]?.textContent ?? '').trim()
      if (name === text.trim()) { hide(); return }
      show(element, text)
    })
    document.addEventListener('focusout', hide)
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && shownFor) hide() })
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
  }

  return { mount, hide }
}
