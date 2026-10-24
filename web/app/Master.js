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
import { createFxList } from '../../src/ui/FxList.js'
import { attachMenu } from '../../src/ui/ContextMenu.js'
import { inSignalOrder } from '../../src/ops/OpenProject.js'
import { MASTER_TRACK } from '../../src/model/ArrangementOps.js'

export function createMaster (ctx) {
  const { $, log } = ctx
  // The level of the whole mix, from the same analyser as the transport bar's (web/app/Meters.js feeds it). Beside the fader.
  const meter = createMeter(ctx.document, { label: 'the master' })
  const strip = createStrip(ctx.document, { gain: 1, pan: 0, muted: false }, change => {
    const result = ctx.dispatcher?.apply([{ op: 'setMaster', ...change }])
    if (result && !result.ok) log(result.message, 'error')
  }, { label: 'Master', id: 'strip-master', solo: false, fader: true, beside: meter.element })

  const summary = createChainSummary(ctx.document, {
    onShowPlugins: () => {
      ctx.tabs.select('tracks')
      ctx.document.getElementById(`track-group-${MASTER_TRACK}`)?.scrollIntoView({ block: 'start' })
      ctx.document.getElementById(`audio-input-${MASTER_TRACK}`)?.focus({ preventScroll: true })
    }
  })
  summary.element.hidden = true
  const fx = createFxList(ctx.document, {
    id: 'strip-master',
    onAdd: () => ctx.rack.addPluginTo(MASTER_TRACK),
    onRemove: nodeId => ctx.rack.removePlugin(nodeId)
  })
  return {
    meter,
    mount () {
      const heading = ctx.document.createElement('h3')
      heading.textContent = 'Master'
      const wrapper = ctx.document.createElement('div')
      wrapper.className = 'mixer-channel master-channel'
      wrapper.append(heading, strip.element, fx.element, summary.element)
      // The same kind of menu as a track's channel (src/ui/Mixer.js).
      attachMenu(wrapper, ctx.menu, event => {
        if (event.target.closest?.('input')) return null
        const { master } = ctx.dispatcher.project
        return [
          { label: 'Mute', checked: Boolean(master.muted), run: () => ctx.dispatcher.apply([{ op: 'setMaster', muted: !master.muted }]) },
          { label: 'Reset level and pan', run: () => ctx.dispatcher.apply([{ op: 'setMaster', gain: 1, pan: 0 }]) },
          '-',
          { label: 'Add a plugin', run: () => ctx.rack.addPluginTo(MASTER_TRACK) }
        ]
      })
      $('master-mount').append(wrapper)
    },
    /** Show the project's master, whoever changed it. */
    update () {
      const { project } = ctx.dispatcher ?? {}
      if (!project) return
      strip.update(project.master, { label: 'Master' })
      const nodes = inSignalOrder(project.nodes.filter(n => n.track === MASTER_TRACK), project.connections)
      const labelOf = node => node.label ?? ctx.dispatcher.engineNode(node.id)?.profile?.label ?? node.id
      fx.update({ label: 'Master', plugins: nodes.map(node => ({ id: node.id, label: labelOf(node) })) })
      summary.element.hidden = nodes.length === 0
      if (nodes.length === 0) return
      const input = project.master.audioInput ? project.node(project.master.audioInput) : null
      summary.show({ label: 'Master', nodes, labelOf, mixInputLabel: input ? labelOf(input) : null })
    }
  }
}
