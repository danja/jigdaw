// web/app/Master.js
//
// The master strip on the Mixer tab: level, pan and mute of everything that
// reaches the speakers, as the project's own master (docs/track-view-terms.md).
// The same strip the tracks use, without Solo, which has nothing to act on here.
import { createStrip } from '../../src/ui/Strip.js'

export function createMaster (ctx) {
  const { $, log } = ctx
  const strip = createStrip(ctx.document, { gain: 1, pan: 0, muted: false }, change => {
    const result = ctx.dispatcher?.apply([{ op: 'setMaster', ...change }])
    if (result && !result.ok) log(result.message, 'error')
  }, { label: 'Master', id: 'strip-master', solo: false })

  return {
    mount () {
      const heading = ctx.document.createElement('h3')
      heading.textContent = 'Master'
      const wrapper = ctx.document.createElement('div')
      wrapper.className = 'mixer-channel master-channel'
      wrapper.append(heading, strip.element)
      $('master-mount').append(wrapper)
    },
    /** Show the project's master, whoever changed it. */
    update () {
      const master = ctx.dispatcher?.project.master
      if (master) strip.update(master, { label: 'Master' })
    }
  }
}
