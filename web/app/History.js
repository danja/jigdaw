// web/app/History.js
//
// Undo and Redo, as buttons and as keys. The mechanism is the dispatcher's
// own undo() and redo() (tests/ops/OpDispatcher.test.js), and this only wires
// it, so there is no second implementation of either to drift.

import { createHistoryList } from '../../src/ui/HistoryList.js'

export function createHistory (ctx) {
  const { document, $, log } = ctx

  // The list of steps, drawn again whenever the buttons are: the same moments are when the history has changed.
  const list = createHistoryList(document, { jump: steps => jump(steps) })

  /** Go back or forward that many edits, one undo or redo at a time, stopping at the first that fails. */
  async function jump (steps) {
    for (let i = 0; i < Math.abs(steps); i++) {
      const result = await (steps < 0 ? ctx.dispatcher.undo() : ctx.dispatcher.redo())
      if (!result.ok) { log(result.message, 'error'); break }
    }
  }

  /** Undo and Redo are disabled rather than hidden, so a screen reader always
   * finds the same two controls in the same place and reads which are live. */
  function updateHistoryButtons () {
    $('undo').disabled = !(ctx.dispatcher?.canUndo() ?? false)
    $('redo').disabled = !(ctx.dispatcher?.canRedo() ?? false)
    if (ctx.dispatcher) list.draw(ctx.dispatcher.history())
  }

  async function undo () {
    const { dispatcher } = ctx
    if (!dispatcher?.canUndo()) return
    const result = await dispatcher.undo()
    if (!result.ok) log(result.message, 'error')
  }

  async function redo () {
    const { dispatcher } = ctx
    if (!dispatcher?.canRedo()) return
    const result = await dispatcher.redo()
    if (!result.ok) log(result.message, 'error')
  }

  function mount () {
    $('history-body').append(list.element)
    list.draw({ done: [], undone: [] })
    $('undo').addEventListener('click', () => undo())
    $('redo').addEventListener('click', () => redo())

    // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z or +Y, the two redo conventions, both
    // honoured rather than picking one. Left alone while an input, a textarea or
    // anything contenteditable has focus, so editing the tempo field or an IRI
    // keeps the browser's own text undo rather than reaching past it to the
    // project's.
    document.addEventListener('keydown', event => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' && event.key.toLowerCase() !== 'y') return
      const target = document.activeElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const key = event.key.toLowerCase()
      if (key === 'y') { event.preventDefault(); redo(); return }
      event.preventDefault()
      if (event.shiftKey) redo(); else undo()
    })
  }

  return { updateButtons: updateHistoryButtons, undo, redo, mount }
}
