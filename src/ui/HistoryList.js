// src/ui/HistoryList.js
//
// The undo history as a list a person can step through: every state the project has been in, from how it started to the last
// edit, and the edits that were undone after it. One item is now, marked in words and with aria-current as well as by its
// look. Choosing another asks the caller to go there, which is a run of undos or redos, so nothing here keeps a second history.
//
// The steps are only what `history()` says, the words for each edit (src/ops/StepLabel.js); the list has no other knowledge.

/**
 * `jump(steps)` is asked to go back (negative) or forward (positive) that many edits. `history()` is `{ done, undone }`.
 */
export function createHistoryList (document, { jump }) {
  const element = document.createElement('div')
  element.className = 'history-list'
  const summary = document.createElement('p')
  summary.className = 'note'
  summary.setAttribute('role', 'status')
  const list = document.createElement('ol')
  list.setAttribute('aria-label', 'Undo history, oldest first')
  element.append(summary, list)

  return {
    element,
    /** Draw the list for `{ done, undone }`. A step the person was on is kept in focus across the redraw it causes. */
    draw ({ done, undone }) {
      const focused = list.contains(document.activeElement) ? [...list.children].indexOf(document.activeElement.parentNode) : -1
      const states = ['The start', ...done, ...undone]
      const now = done.length
      summary.textContent = states.length === 1 ? 'Nothing has been done yet.' : `${done.length} edit${done.length === 1 ? '' : 's'} done, ${undone.length} undone.`
      list.replaceChildren(...states.map((label, i) => {
        const item = document.createElement('li')
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'history-step'
        const where = i === now ? ', now' : i < now ? ', before now' : ', undone'
        button.textContent = i === 0 ? label : `${i}. ${label}`
        button.setAttribute('aria-label', `${i === 0 ? 'The start' : `${i}. ${label}`}${where}`)
        if (i === now) button.setAttribute('aria-current', 'step')
        if (i > now) button.classList.add('undone')
        button.addEventListener('click', () => { if (i !== now) jump(i - now) })
        item.append(button)
        return item
      }))
      if (focused >= 0) list.children[focused]?.firstChild?.focus?.()
    }
  }
}
