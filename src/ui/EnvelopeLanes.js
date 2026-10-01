// src/ui/EnvelopeLanes.js
//
// The automation lanes under one track: one EnvelopeLane per envelope, kept for as long as the
// envelope is, so a redraw updates a lane in place and a point held by a drag or by the keyboard is not
// taken out of the document. Children are replaced only when the set or the order of lanes changes.
import { createEnvelopeLane } from './EnvelopeLane.js'

export function createEnvelopeLanes (document, { onChange, onRemove, view }) {
  const element = document.createElement('div')
  element.className = 'envelope-lanes'
  const lanes = new Map()

  return {
    element,
    /** `list` is the lanes for this track, each as EnvelopeLane.update takes it. */
    update (list, { beatsPerBar, width }) {
      for (const id of [...lanes.keys()]) if (!list.some(l => l.id === id)) lanes.delete(id)
      const wanted = list.map(lane => {
        let entry = lanes.get(lane.id)
        if (!entry) {
          entry = createEnvelopeLane(document, { onChange, onRemove, view })
          lanes.set(lane.id, entry)
        }
        entry.update(lane, { beatsPerBar, width })
        return entry.element
      })
      element.hidden = wanted.length === 0
      const same = wanted.length === element.children.length && wanted.every((e, i) => element.children[i] === e)
      if (!same) element.replaceChildren(...wanted)
    }
  }
}
