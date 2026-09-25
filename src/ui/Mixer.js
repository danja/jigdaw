// src/ui/Mixer.js
//
// The mixer: one channel strip per track, gathered onto their own tab.
//
// A strip belongs to a track, not to a plugin: whatever a track's chain
// produces arrives at its fader, then its pan, then the master
// (docs/project-format.md "Tracks"). So a chain of three plugins is one strip,
// not three, and a track holding only audio clips still has one.
//
// A track that can produce nothing to hear has no strip. That is a track whose
// every node is known to have no audio output, such as one holding only a MIDI
// generator: Level, Pan, Mute and Solo would all move and none would be heard.
// CLAUDE.md: a control nobody can use is left out, not shown disabled.
//
// The channels are cached here, keyed by track id, and a redraw moves nothing
// that does not have to move. Taking a focused element out of the document
// blurs it, so a mixer that emptied itself and filled again on every edit lost
// the focus from the Mute button that had just been pressed: found in a real
// browser, where the unit tests, having no focus to lose, all passed. A track
// that has gone takes its channel with it on the next draw; nothing else has
// to remember to clear the cache.
import { createStrip } from './Strip.js'

/**
 * Whether a track has anything for a fader to act on.
 *
 * `audioOutputsOf(nodeId)` gives a node's declared audio output count, or
 * undefined while its plugin has not loaded. Unknown counts as audio, the
 * same as the rack: the question is only answered once a plugin has loaded.
 */
export function mixable (track, nodes, audioOutputsOf) {
  const onTrack = nodes.filter(n => n.track === track.id)
  // No nodes at all is a track of audio clips, which go straight to the fader.
  if (onTrack.length === 0) return true
  return onTrack.some(n => (audioOutputsOf(n.id) ?? 1) > 0)
}

/**
 * Build a mixer.
 *
 * `onChange(trackId, change)` receives the part of one strip that changed.
 * Returns `{ element, draw }`; `draw` is called with the project's tracks and
 * nodes, what the dispatcher says each track sounds like after solo, and how
 * to read a node's audio outputs.
 */
export function createMixer (document, { onChange }) {
  if (typeof onChange !== 'function') throw new Error('createMixer needs an onChange')
  const element = document.createElement('div')
  element.className = 'mixer'
  const channels = new Map()

  function draw ({ tracks, nodes, audibility, audioOutputsOf, labelFor }) {
    const silent = new Map(audibility.map(a => [a.trackId, a.silent]))
    const shown = tracks.filter(t => mixable(t, nodes, audioOutputsOf))

    for (const id of [...channels.keys()]) {
      if (!shown.some(t => t.id === id)) channels.delete(id)
    }

    if (shown.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = tracks.length === 0
        ? 'No tracks yet. Search for a plugin, or press Load to add the synth.'
        : 'No track here has an audio output to mix.'
      element.replaceChildren(empty)
      return
    }

    const wanted = shown.map(track => {
      const label = labelFor(track)
      let channel = channels.get(track.id)
      if (!channel) {
        const strip = createStrip(document, track.channel, change => onChange(track.id, change),
          { label, id: `strip-${track.id}` })
        // The strip draws no visible heading of its own, so the channel has
        // one: nothing else on this tab says which track a strip belongs to.
        const wrapper = document.createElement('div')
        wrapper.className = 'mixer-channel'
        const heading = document.createElement('h3')
        wrapper.append(heading, strip.element)
        channel = { wrapper, heading, strip }
        channels.set(track.id, channel)
      }
      channel.heading.textContent = label
      channel.strip.update(track.channel, { silent: silent.get(track.id) === true, label })
      return channel.wrapper
    })

    // Only when the list differs: a track added, gone or reordered.
    const current = [...element.children]
    const same = current.length === wanted.length && current.every((child, i) => child === wanted[i])
    if (!same) element.replaceChildren(...wanted)
  }

  return { element, draw }
}
