// web/app/Swap.js
//
// Replacing a plugin: the Replace button on a chain item opens the Browser and says which plugin the next Load will take the place of
// (a banner with a Cancel button, said to a screen reader as a status). The next Load swaps instead of adding (web/app/Loading.js) and
// ends the mode, whether it worked or not, so nothing stays armed that the person has forgotten. The swap itself is one dispatcher call,
// `swapPlugin`, one undo step.
export function createSwap (ctx) {
  const { $ } = ctx
  let nodeId = null

  function show () {
    const banner = $('replacing')
    banner.hidden = nodeId === null
    if (nodeId === null) return
    const node = ctx.dispatcher.project.node(nodeId)
    $('replacing-text').textContent = `Replacing ${node?.label ?? nodeId}: Load a plugin to put it in its place.`
  }

  /** Start replacing `id`: open the Browser, say so. */
  function begin (id) {
    nodeId = id
    show()
    ctx.layout.showBrowser(true)
  }

  function end () {
    nodeId = null
    show()
  }

  return {
    begin,
    end,
    /** The node the next Load will replace, or null. */
    target: () => nodeId,
    mount () { $('cancel-replace').addEventListener('click', () => { end(); $('q').focus() }) }
  }
}
