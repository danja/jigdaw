// web/app/Matrix.js
//
// The Routing tab: every output against every input, across tracks, as one
// table. Pressing a cell makes or breaks the connection through the same Ops as
// the plugin view and the rack, so a loop or a plugin that cannot take the
// signal is refused by the same checks, and the reason is logged as it came.
import { createRoutingMatrix } from '../../src/ui/RoutingMatrix.js'
import { buildMatrix } from '../../src/ui/MatrixModel.js'
import { preserveFocus } from '../../src/ui/Focus.js'

export function createMatrix (ctx) {
  const { $, log } = ctx

  const name = id => {
    const node = ctx.dispatcher.project.node(id)
    return node?.label ?? ctx.dispatcher.engineNode(id)?.profile?.label ?? id
  }

  // What the last press came to, in words, beside the table: a refusal is the
  // reason, and it is said here as well as logged, since this is where the person is looking.
  const status = message => { $('matrix-status').textContent = message }

  const matrix = createRoutingMatrix(ctx.document, {
    onConnect: (row, col) => {
      const result = ctx.dispatcher.apply([{
        op: 'addConnection',
        from: { node: row.node, portIndex: row.port.portIndex },
        to: { node: col.node, portIndex: col.port.portIndex },
        signalKind: row.port.kind
      }])
      if (!result.ok) { log(result.message, 'error'); status(`Not connected: ${result.message}`) } else {
        log(`connected ${name(row.node)} to ${name(col.node)}`, 'ok')
        status(`Connected ${name(row.node)} to ${name(col.node)}.`)
      }
    },
    onDisconnect: id => {
      const result = ctx.dispatcher.apply([{ op: 'removeConnection', id }])
      if (!result.ok) { log(result.message, 'error'); status(`Not disconnected: ${result.message}`) } else status('Disconnected.')
    }
  })

  function draw () {
    const { dispatcher } = ctx
    const restore = preserveFocus(matrix.element)
    if (!dispatcher) {
      matrix.draw({ rows: [], cols: [], possible: () => false, connectionAt: () => null })
    } else {
      const { project } = dispatcher
      matrix.draw(buildMatrix(project, {
        profileOf: id => dispatcher.engineNode(id)?.profile,
        labelOf: name,
        trackLabelOf: id => ctx.rack.trackLabel(project.track(id), project.tracks.indexOf(project.track(id)))
      }))
    }
    restore()
  }

  function mount () { $('matrix-mount').append(matrix.element) }

  return { mount, draw }
}
