// src/compiler/GraphCompiler.js
//
// Turns a project into what the engine needs to know: which cycles exist and
// whether they are legal, and how much delay to add to which connection so that
// parallel paths arrive aligned.
//
// docs/latency.md is the specification. Two rules from it shape everything
// here.
//
// A cycle must carry at least one render quantum of delay. This is not a
// JigDAW invention and cannot be worked around: the Web Audio API permits a
// cycle only if a DelayNode lies within it, and a cycle without one outputs
// silence. Refusing the graph and naming the cycle is strictly better than the
// platform's own failure mode, which is to go quiet.
//
// Latency inside a cycle is never compensated. The delay in a feedback loop is
// the effect the user asked for: it is the delay time, the comb filter, the
// resonator. To align a cycle with itself is to ask for the signal before it
// exists.

const AUDIO = 'http://purl.org/stuff/transmissions/Audio'

/** Only audio edges create a Web Audio cycle; MIDI is host-routed. */
const isAudio = connection => connection.signalKind === AUDIO

/**
 * Tarjan's strongly connected components.
 *
 * Iterative rather than recursive: a deep graph would otherwise blow the stack,
 * and a stack overflow in graph compilation reads as a crash rather than as the
 * project being too big.
 */
export function stronglyConnected (nodeIds, edgesFrom) {
  const index = new Map()
  const low = new Map()
  const onStack = new Set()
  const stack = []
  const components = []
  let counter = 0

  for (const start of nodeIds) {
    if (index.has(start)) continue
    const work = [{ node: start, edge: 0 }]

    while (work.length > 0) {
      const frame = work[work.length - 1]
      const { node } = frame

      if (frame.edge === 0) {
        index.set(node, counter)
        low.set(node, counter)
        counter += 1
        stack.push(node)
        onStack.add(node)
      }

      const edges = edgesFrom(node)
      if (frame.edge < edges.length) {
        const next = edges[frame.edge]
        frame.edge += 1
        if (!index.has(next)) work.push({ node: next, edge: 0 })
        else if (onStack.has(next)) low.set(node, Math.min(low.get(node), index.get(next)))
        continue
      }

      if (low.get(node) === index.get(node)) {
        const component = []
        let member
        do {
          member = stack.pop()
          onStack.delete(member)
          component.push(member)
        } while (member !== node)
        components.push(component)
      }

      work.pop()
      if (work.length > 0) {
        const parent = work[work.length - 1].node
        low.set(parent, Math.min(low.get(parent), low.get(node)))
      }
    }
  }

  return components
}

/**
 * Analyse a project.
 *
 * `latencyOf(nodeId)` reports a node's declared latency in frames, normally
 * from its profile. Injected rather than read from a profile here so the
 * compiler stays a function of the graph and can be tested without loading
 * anything.
 */
export function compileGraph (project, { latencyOf = () => 0, quantum = 128 } = {}) {
  const nodes = project.nodes.map(n => n.id)
  const connections = project.connections.filter(isAudio)

  const outgoing = new Map(nodes.map(id => [id, []]))
  const incoming = new Map(nodes.map(id => [id, []]))
  for (const connection of connections) {
    outgoing.get(connection.from.node)?.push(connection)
    incoming.get(connection.to.node)?.push(connection)
  }

  const components = stronglyConnected(nodes, id => (outgoing.get(id) ?? []).map(c => c.to.node))

  // A component is a cycle if it has more than one node, or one node that
  // reaches itself.
  const cycles = components.filter(component =>
    component.length > 1 ||
    (outgoing.get(component[0]) ?? []).some(c => c.to.node === component[0]))

  const componentOf = new Map()
  for (const component of components) for (const id of component) componentOf.set(id, component)

  const inCycle = new Set(cycles.flat())
  /** An edge lies on a cycle when both ends are in the same component. */
  const onCycle = connection =>
    inCycle.has(connection.from.node) &&
    componentOf.get(connection.from.node) === componentOf.get(connection.to.node)

  const errors = []
  for (const cycle of cycles) {
    const members = new Set(cycle)
    const nodeDelay = cycle.reduce((total, id) => total + latencyOf(id), 0)
    const edgeDelay = connections
      .filter(c => members.has(c.from.node) && members.has(c.to.node))
      .reduce((total, c) => total + (c.delayFrames ?? 0), 0)

    if (nodeDelay + edgeDelay < quantum) {
      errors.push({
        kind: 'undelayed-cycle',
        nodes: [...cycle],
        message: `feedback loop through ${cycle.join(', ')} carries ${nodeDelay + edgeDelay} frames of delay and needs at least ${quantum}. Web Audio outputs silence for a cycle with no delay in it, so this is refused rather than left to go quiet.`
      })
    }
  }

  // Accumulated latency, over the condensation: each strongly connected
  // component collapsed to a single unit, which makes the graph a DAG.
  //
  // Simply dropping cycle edges was the first attempt and it is wrong. It
  // stops latency propagating forward THROUGH a loop, so a graph with a
  // delay line in a feedback path and a dry signal beside it reports no
  // compensation at all and the two arrive misaligned. Condensing keeps the
  // forward contribution while never trying to accumulate around the loop,
  // which does not terminate.
  //
  // A component's latency is taken as the largest latency of any one member.
  // There is no exact answer: a signal entering a loop and leaving it may take
  // any of several paths through the members, so the true figure depends on a
  // path the graph does not distinguish. The largest single member is the least
  // the signal can traverse, and it is an under-estimate rather than an
  // over-estimate, which errs towards leaving a path slightly early rather than
  // adding delay that was never needed.
  const componentIndex = new Map()
  components.forEach((component, i) => { for (const id of component) componentIndex.set(id, i) })

  const componentLatency = components.map(component =>
    component.reduce((most, id) => Math.max(most, latencyOf(id)), 0))

  const crossing = connections.filter(c => componentIndex.get(c.from.node) !== componentIndex.get(c.to.node))

  const compIncoming = components.map(() => [])
  const compOutgoing = components.map(() => [])
  for (const connection of crossing) {
    compIncoming[componentIndex.get(connection.to.node)].push(connection)
    compOutgoing[componentIndex.get(connection.from.node)].push(connection)
  }

  const remaining = components.map((_, i) => compIncoming[i].length)
  const componentOrder = []
  const queue = components.map((_, i) => i).filter(i => remaining[i] === 0)
  while (queue.length > 0) {
    const i = queue.shift()
    componentOrder.push(i)
    for (const connection of compOutgoing[i]) {
      const target = componentIndex.get(connection.to.node)
      remaining[target] -= 1
      if (remaining[target] === 0) queue.push(target)
    }
  }

  const componentArrival = components.map(() => 0)
  for (const i of componentOrder) {
    let latest = 0
    for (const connection of compIncoming[i]) {
      const source = componentIndex.get(connection.from.node)
      latest = Math.max(latest, componentArrival[source] + componentLatency[source] + (connection.delayFrames ?? 0))
    }
    componentArrival[i] = latest
  }

  // Compensation is delay added to the fast paths. It cannot remove delay from
  // the slow one, and it is never applied to an edge inside a cycle: the delay
  // in a feedback loop is the effect the user asked for.
  const compensation = []
  for (const i of componentOrder) {
    for (const connection of compIncoming[i]) {
      const source = componentIndex.get(connection.from.node)
      const path = componentArrival[source] + componentLatency[source] + (connection.delayFrames ?? 0)
      const needed = componentArrival[i] - path
      if (needed > 0) compensation.push({ connection: connection.id, delayFrames: needed })
    }
  }

  const arrival = new Map(nodes.map(id => [id, componentArrival[componentIndex.get(id)]]))
  const order = componentOrder.flatMap(i => components[i])

  const sinks = componentOrder.filter(i => compOutgoing[i].length === 0)
  const totalLatency = sinks.reduce((max, i) => Math.max(max, componentArrival[i] + componentLatency[i]), 0)

  return {
    order,
    cycles,
    errors,
    ok: errors.length === 0,
    arrival,
    compensation,
    totalLatency
  }
}
