// web/app/Master.js
//
// The master strip on the Mixer tab: level, pan and mute of everything that
// reaches the speakers, as the project's own master (docs/track-view-terms.md).
// The same strip the tracks use, without Solo, which has nothing to act on here.
//
// Under it, what is on the master: its plugins in signal order and the one the
// mix arrives at, with the way to their controls on the Tracks tab. Left out
// when nothing is on the master, as there is then nothing to say.
import { createStrip } from '../../src/ui/Strip.js'
import { createChainSummary } from '../../src/ui/ChainSummary.js'
import { createMeter } from '../../src/ui/Meter.js'
import { inSignalOrder } from '../../src/ops/OpenProject.js'
import { MASTER_TRACK } from '../../src/model/ArrangementOps.js'

export function createMaster (ctx) {
  const { $, log } = ctx
  const strip = createStrip(ctx.document, { gain: 1, pan: 0, muted: false }, change => {
    const result = ctx.dispatcher?.apply([{ op: 'setMaster', ...change }])
    if (result && !result.ok) log(result.message, 'error')
  }, { label: 'Master', id: 'strip-master', solo: false, fader: true })

  const summary = createChainSummary(ctx.document, {
    onShowPlugins: () => {
      ctx.tabs.select('tracks')
      ctx.document.getElementById(`track-group-${MASTER_TRACK}`)?.scrollIntoView({ block: 'start' })
      ctx.document.getElementById(`audio-input-${MASTER_TRACK}`)?.focus({ preventScroll: true })
    }
  })
  summary.element.hidden = true
  // The level of the whole mix, from the same analyser as the transport bar's (web/app/Meters.js feeds it).
  const meter = createMeter(ctx.document, { label: 'the master' })

  return {
    meter,
    mount () {
      const heading = ctx.document.createElement('h3')
      heading.textContent = 'Master'
      const wrapper = ctx.document.createElement('div')
      wrapper.className = 'mixer-channel master-channel'
      wrapper.append(heading, strip.element, meter.element, summary.element)
      $('master-mount').append(wrapper)
    },
    /** Show the project's master, whoever changed it. */
    update () {
      const { project } = ctx.dispatcher ?? {}
      if (!project) return
      strip.update(project.master, { label: 'Master' })
      const nodes = inSignalOrder(project.nodes.filter(n => n.track === MASTER_TRACK), project.connections)
      summary.element.hidden = nodes.length === 0
      if (nodes.length === 0) return
      const labelOf = node => node.label ?? ctx.dispatcher.engineNode(node.id)?.profile?.label ?? node.id
      const input = project.master.audioInput ? project.node(project.master.audioInput) : null
      summary.show({ label: 'Master', nodes, labelOf, mixInputLabel: input ? labelOf(input) : null })
    }
  }
}
