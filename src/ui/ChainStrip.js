// src/ui/ChainStrip.js
//
// A track's plugins drawn under its lane: one button each, in the order the
// signal goes through them, with what it takes and gives and where it sends.
// Text first, per the interface rules and src/ui/Routing.js: a drawn cable
// cannot be reached by keyboard or read by a screen reader, and a name and a
// destination can. A send that reaches another track is marked as one, in
// words, because that is the routing the arrangement alone does not show.
//
// The kind of each signal is written out (MIDI, audio, modulation), never left
// to a colour, and a plugin that failed to load says so on its own button while
// the rest of the chain is drawn as usual.
import { say } from './ChainModel.js'
import { setIcon } from './Icons.js'

export function createChainStrip (document, { onSelect, onBypass, onMove }) {
  if (typeof onSelect !== 'function') throw new Error('createChainStrip needs onSelect')
  if (typeof onBypass !== 'function') throw new Error('createChainStrip needs onBypass')
  if (typeof onMove !== 'function') throw new Error('createChainStrip needs onMove')
  const element = document.createElement('div')
  element.className = 'timeline-chain'
  element.setAttribute('role', 'group')
  const list = document.createElement('ol')
  list.className = 'chain-list'
  element.append(list)

  return {
    element,
    /** `chain` is describeChain's answer; `selected` the node id selected, or null. */
    update (chain, { label, selected = null }) {
      element.hidden = chain.nodes.length === 0
      element.setAttribute('aria-label', `Plugins on ${label}`)
      list.replaceChildren(...chain.nodes.map((node, index) => {
        const item = document.createElement('li')
        item.className = 'chain-item'
        if (node.failed) item.classList.add('failed')
        if (node.bypassed) item.classList.add('bypassed')

        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'chain-node'
        button.id = `chain-${node.id}`
        button.textContent = node.label
        button.setAttribute('aria-pressed', String(selected === node.id))
        button.setAttribute('aria-label', say(node))
        button.addEventListener('click', () => onSelect(node.id))
        // Alt with Left or Right moves the plugin one place in the chain, as the tracks' names move with Alt+Up
        // and Down. Only where there is a neighbour that takes and gives audio as well.
        const before = chain.nodes[index - 1]
        const after = chain.nodes[index + 1]
        const canEarlier = node.passesAudio && before?.passesAudio === true
        const canLater = node.passesAudio && after?.passesAudio === true
        button.addEventListener('keydown', event => {
          if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
          event.preventDefault()
          const delta = event.key === 'ArrowLeft' ? -1 : 1
          if (delta === -1 ? canEarlier : canLater) onMove(node.id, delta)
        })

        const io = document.createElement('span')
        io.className = 'chain-io'
        io.textContent = node.failed ? 'failed to load'
          : !node.loaded ? 'loading'
            : node.bypassed ? 'bypassed: passes what it gets'
            : `${node.takes.join(' + ') || 'nothing'} in, ${node.gives.join(' + ') || 'nothing'} out`

        const links = document.createElement('ul')
        links.className = 'chain-links'
        links.setAttribute('aria-hidden', 'true')
        for (const s of node.sends) {
          const li = document.createElement('li')
          if (s.other) li.className = 'other'
          li.textContent = `${s.kind} to ${s.toLabel}${s.parameter ? ` (${s.parameter})` : ''}${s.other ? ` on ${s.toTrackLabel}` : ''}`
          links.append(li)
        }
        for (const r of node.receives) {
          const li = document.createElement('li')
          li.className = 'other'
          li.textContent = `${r.kind} from ${r.fromLabel} on ${r.fromTrackLabel}`
          links.append(li)
        }
        // A plugin that has not loaded has nothing to bypass, so the button is left out. The state is said
        // in the name and pressed state, and the plugin's own button and line say it in words too.
        if (node.loaded && !node.failed) {
          const bypass = document.createElement('button')
          bypass.type = 'button'
          bypass.className = 'chain-bypass'
          // An id, so the focus can be put back on it after the redraw an edit causes (src/ui/Focus.js).
          bypass.id = `chain-bypass-${node.id}`
          setIcon(document, bypass, 'bypass', `Bypass ${node.label}`)
          bypass.setAttribute('aria-pressed', String(node.bypassed === true))
          bypass.addEventListener('click', () => onBypass(node.id, !node.bypassed))
          // The plugin's button and its Bypass side by side, so Bypass is its own size and not the item's width.
          const head = document.createElement('div')
          head.className = 'chain-head'
          head.append(button, bypass)
          // Left out where there is no neighbour to swap with, not shown disabled.
          for (const [delta, can, icon, text] of [[-1, canEarlier, 'earlier', 'Move earlier'], [1, canLater, 'later', 'Move later']]) {
            if (!can) continue
            const move = document.createElement('button')
            move.type = 'button'
            move.className = 'chain-move'
            move.id = `chain-move-${delta === -1 ? 'earlier' : 'later'}-${node.id}`
            setIcon(document, move, icon, `${text}: ${node.label}`)
            move.addEventListener('click', () => onMove(node.id, delta))
            head.append(move)
          }
          item.append(head, io, links)
        } else {
          item.append(button, io, links)
        }
        return item
      }))
    }
  }
}
