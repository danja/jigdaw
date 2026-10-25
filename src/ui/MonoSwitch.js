// src/ui/MonoSwitch.js
//
// "Listen in mono" on the master: a toggle that sums the mix to one channel so a person can hear what a mono speaker, a phone or
// a club system would make of it. A listening aid and nothing else, so it says what it is not: it is not saved with the session
// and is not in an export or a recording. The button is the state (pressed means on), and a line beside it says so in words for
// a reader that does not announce a pressed state, and shows nothing for the ordinary case.
//
// `onChange(on)` may throw or reject, in which case the switch goes back to what it was and says why.

export function createMonoSwitch (document, { onChange }) {
  if (typeof onChange !== 'function') throw new Error('createMonoSwitch needs onChange')
  const element = document.createElement('div')
  element.className = 'mono-switch'
  const button = document.createElement('button')
  button.type = 'button'
  button.id = 'strip-master-mono'
  button.className = 'mono-button'
  button.textContent = 'Mono'
  button.title = 'Listen to the mix summed to one channel, to hear how it folds down. For listening only: it is not saved and is not in an export or a recording.'
  button.setAttribute('aria-label', 'Listen in mono')
  button.setAttribute('aria-pressed', 'false')
  const said = document.createElement('span')
  said.className = 'mono-said'
  said.setAttribute('role', 'status')
  element.append(button, said)

  let on = false
  const show = () => {
    button.setAttribute('aria-pressed', String(on))
    said.textContent = on ? 'Listening in mono' : ''
  }

  async function set (next) {
    const was = on
    on = Boolean(next)
    show()
    try { await onChange(on) } catch (error) {
      on = was
      show()
      said.textContent = error.message
    }
  }
  button.addEventListener('click', () => set(!on))

  return { element, button, set, toggle: () => set(!on), get on () { return on } }
}
