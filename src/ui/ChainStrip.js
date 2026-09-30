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

export function createChainStrip (document, { onSelect }) {
  if (typeof onSelect !== 'function') throw new Error('createChainStrip needs onSelect')
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
      list.replaceChildren(...chain.nodes.map(node => {
        const item = document.createElement('li')
        item.className = 'chain-item'
        if (node.failed) item.classList.add('failed')

        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'chain-node'
        button.id = `chain-${node.id}`
        button.textContent = node.label
        button.setAttribute('aria-pressed', String(selected === node.id))
        button.setAttribute('aria-label', say(node))
        button.addEventListener('click', () => onSelect(node.id))

        const io = document.createElement('span')
        io.className = 'chain-io'
        io.textContent = node.failed ? 'failed to load'
          : !node.loaded ? 'loading'
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
        item.append(button, io, links)
        return item
      }))
    }
  }
}
