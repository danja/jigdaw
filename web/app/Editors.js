// web/app/Editors.js
//
// Plugins' own interfaces, open in #editors: contract section 9, through
// src/ui/PluginFrame.js, which owns the boundary.
//
// They live in #editors, which nothing rebuilds, because a frame moved in the
// document reloads and the rack is rebuilt on every edit.
import { createPluginFrame } from '../../src/ui/PluginFrame.js'
import { profileAsJsonLd } from '../../src/rdf/ProfileJsonLd.js'
import { compact } from '../../src/host/Capabilities.js'

export function createEditors (ctx) {
  const { document, window, $, log } = ctx
  // By node id: { wrapper, frame, stopRelay }.
  const open = new Map()

  /**
   * Open a plugin's own interface. A frame that cannot be opened, such as one
   * on this page's own origin, is reported and the generated panel is still
   * there.
   */
  function openEditor (nodeId, profile, label) {
    const { dispatcher } = ctx
    let frame
    try {
      frame = createPluginFrame(document, {
        ui: profile.ui,
        label,
        hostOrigin: window.location.origin,
        window,
        relayLimit: ctx.hostConfig.relayPerSecond,
        init: () => ({
          profile: profileAsJsonLd(profile),
          parameters: Object.fromEntries(dispatcher.project.node(nodeId)?.settings ?? []),
          capabilities: [...ctx.hostCapabilities].map(compact)
        }),
        // A request, which goes through the dispatcher like any other edit and
        // comes back to the frame as the value actually applied.
        onParameter: (symbol, value) => {
          const result = dispatcher.setParameter(nodeId, symbol, value)
          if (!result.ok) log(`${label}: ${result.message}`, 'error')
        },
        onRelay: payload => dispatcher.relayToPlugin(nodeId, payload),
        onRefused: message => log(message, 'error')
      })
    } catch (error) {
      log(`${label} editor: ${error.message}`, 'error')
      return
    }

    const wrapper = document.createElement('section')
    wrapper.className = 'editor'
    wrapper.setAttribute('aria-label', `${label} editor`)
    const header = document.createElement('header')
    const heading = document.createElement('h3')
    heading.textContent = `${label} editor`
    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = 'Close'
    close.setAttribute('aria-label', `Close the ${label} editor`)
    close.addEventListener('click', () => { closeEditor(nodeId); ctx.rack.draw() })
    header.append(heading, close)
    wrapper.append(header, frame.element)

    const stopRelay = dispatcher.onPluginMessage(nodeId, payload => frame.relay(payload))
    open.set(nodeId, { wrapper, frame, stopRelay })
    $('editors').append(wrapper)
    $('editors').hidden = false
  }

  function closeEditor (nodeId) {
    const editor = open.get(nodeId)
    if (!editor) return
    editor.stopRelay?.()
    editor.frame.dispose()
    editor.wrapper.remove()
    open.delete(nodeId)
    $('editors').hidden = open.size === 0
  }

  return {
    open: openEditor,
    close: closeEditor,
    isOpen: nodeId => open.has(nodeId),
    /** Close every editor whose plugin is not in `nodeIds`: removed, or undone. */
    keepOnly (nodeIds) {
      for (const id of [...open.keys()]) if (!nodeIds.has(id)) closeEditor(id)
    },
    closeAll () { for (const id of [...open.keys()]) closeEditor(id) },
    /** Tell an open editor what a parameter now is. */
    parameter (nodeId, symbol, value) { open.get(nodeId)?.frame.parameter(symbol, value) }
  }
}
