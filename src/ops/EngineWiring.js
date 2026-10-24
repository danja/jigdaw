// src/ops/EngineWiring.js
//
// Making the audio graph match the model: after the dispatcher has compiled a project, the engine's links, track strips, sends, master,
// fader links, track delays and MIDI routes are torn down and made again from it, so that after an edit the audio is exactly what the model
// says. The dispatcher owns the order (model, then compile, then engine) and the state; this module is the engine half of that, handed what it
// reads from the dispatcher through `host`:
//
//   engine, project, router    what is wired, and from what (read each time: they may not exist yet)
//   engineIdOf(nodeId)         a model node's engine id, a member's included
//   engineNode(nodeId)         the loaded plugin's entry, or undefined
//   isComposite(nodeId), compositeMidiEnds(nodeId, 'in'|'out')
//   expand(nodes, connections, { bypassed })   composites replaced by their members
//   applyTrackDelays(compiled), audibility()
//   setCompensation(map)       the delays the links were given, by connection id, kept for latency messages
import { isMidi } from '../engine/EventRouter.js'
import { effectiveConnections } from './Bypass.js'

/** The note range of a MIDI connection or send, as the router takes it: only the ends that are set. */
const rangeOf = ({ lowNote, highNote }) => ({
  ...(lowNote === undefined ? {} : { lowNote }),
  ...(highNote === undefined ? {} : { highNote })
})

export class EngineWiring {
  #host

  constructor (host) { this.#host = host }

  /**
   * Make the engine's track strips match the model's tracks: one each, no
   * more. Before the links, because the links end at them.
   */
  #syncTracks () {
    if (!this.#host.engine) return
    const wanted = new Set(this.#host.project.tracks.map(t => t.id))
    for (const id of this.#host.engine.trackIds()) {
      if (!wanted.has(id)) this.#host.engine.removeTrack(id)
    }
    const have = new Set(this.#host.engine.trackIds())
    for (const id of wanted) {
      if (!have.has(id)) this.#host.engine.addTrack(id)
    }
  }

  /** Push every track's channel strip to the engine. */
  /**
   * The model's master, sends and bus outputs, made in the audio graph. Sends are
   * torn down and made again each time, like the links: after an edit the audio
   * is exactly what the model says. An output is set for every track and the
   * engine touches the graph only where it changed.
   */
  #applyRouting () {
    if (!this.#host.engine) return
    this.#host.engine.clearSends()
    for (const send of this.#host.project.sends) {
      // A MIDI send is a route for the router, made with the connections' (#midiSendRoutes), not a gain.
      if (send.kind === 'midi') continue
      this.#host.engine.addSend(send.id, send.from, send.to, { level: send.level, tap: send.tap })
    }
    for (const track of this.#host.project.tracks) {
      this.#host.engine.setTrackOutput(track.id, track.output ?? null)
      this.#host.engine.setTrackArrival(track.id, this.#arrivalEngineId(track.audioInput))
    }
    this.#host.engine.setMasterArrival(this.#arrivalEngineId(this.#host.project.master.audioInput))
    this.#host.engine.setMaster(this.#host.project.master)
  }

  /** The engine node audio arriving at a track or the master goes to, or null for the fader. */
  #arrivalEngineId (nodeId) {
    return (nodeId && this.#host.engineIdOf(nodeId)) || null
  }

  #applyChannels () {
    if (!this.#host.engine) return
    for (const { trackId, gain, pan, silent } of this.#host.audibility()) {
      this.#host.engine.setTrackChannel(trackId, { gain, pan, silent })
    }
  }

  /**
   * Connect everything that produces audio and feeds nothing to its track's
   * fader.
   *
   * A sink is where the signal has arrived, so it is what a person expects to
   * hear. Deriving it from the connections rather than declaring it keeps the
   * rule the project format already states for processing order: the graph
   * answers the question, and a second answer written down beside it would have
   * no rule for which wins.
   *
   * A node with no audio outputs is not a sink for this purpose even when
   * nothing follows it. A MIDI generator ends a path and produces nothing to
   * hear, and connecting it throws.
   */
  #linkSinksToTracks () {
    if (!this.#host.engine) return

    const flat = this.#expandedInUse(this.#stepOverBypassed())
    const feedsSomething = new Set()
    for (const connection of flat.connections) {
      if (isMidi(connection.signalKind)) continue
      feedsSomething.add(connection.from.node)
    }

    for (const node of flat.nodes) {
      if (feedsSomething.has(node.id)) continue
      // A bypassed node is out of the signal: what it would make is not to be heard.
      if (node.bypassed) continue
      const engineId = this.#host.engineIdOf(node.id)
      if (!engineId) continue
      const entry = this.#host.engine.get(engineId)
      if (!(entry?.node?.numberOfOutputs > 0)) continue
      // A member is on the track of the composite it is in.
      this.#host.engine.linkToTrack(engineId, this.#host.project.node(node.path[0]).track)
    }
  }

  /**
   * The project's connections with bypassed nodes stepped over, which is what the engine is given. The
   * model keeps every connection; bypass changes only what is wired.
   */
  #stepOverBypassed () {
    const passes = (nodeId, kind) => {
      const profile = this.#host.engineNode(nodeId)?.profile
      if (!profile) return false
      if (kind === 'audio') return (profile.audioInputs ?? 0) > 0 && (profile.audioOutputs ?? 0) > 0
      return (profile.accepts ?? []).some(isMidi) && (profile.produces ?? []).some(isMidi)
    }
    return effectiveConnections(this.#host.project.connections, {
      bypassed: nodeId => this.#host.project.node(nodeId)?.bypassed === true,
      passes
    })
  }

  /** What the engine is wired from: bypass applied to the project's own connections, then composites expanded. */
  #connectionsInUse () {
    // After bypass, so a bypassed composite is stepped over as one node and its members are left alone.
    return this.#expandedInUse(this.#stepOverBypassed()).connections
  }

  #expandedInUse (connections) {
    return this.#host.expand(this.#host.project.nodes, connections, { bypassed: id => this.#host.project.node(id)?.bypassed === true })
  }

  rebuildLinks (compiled) {
    if (!this.#host.engine) return

    const delayFor = new Map(compiled.compensation.map(c => [c.connection, c.delayFrames]))
    this.#host.setCompensation(delayFor)
    this.#host.engine.clearLinks()
    this.#syncTracks()
    this.#applyRouting()

    const midiRoutes = []

    for (const connection of this.#connectionsInUse()) {
      const from = this.#host.engineIdOf(connection.from.node)
      const to = this.#host.engineIdOf(connection.to.node)
      // A connection between nodes that are not both loaded is in the model
      // but not yet in the audio graph, which is normal while loading.
      if (!from || !to) continue

      // A MIDI connection is not an audio edge. It is the host carrying
      // messages between two ports, so it must not reach connect().
      if (isMidi(connection.signalKind)) {
        midiRoutes.push({ from, to, ...rangeOf(connection) })
        continue
      }

      // An endpoint names its port exactly one way, and a symbol names a
      // parameter rather than an input. Passing portIndex ?? 0 for one of those
      // wired it to audio input zero, which the model allows, the shapes
      // enforce, connection_add exposes as toParameter, and nothing delivered.
      this.#host.engine.link(from, to, {
        fromOutput: connection.from.portIndex ?? 0,
        toInput: connection.to.portIndex ?? 0,
        toParameter: connection.to.portSymbol ?? null,
        delayFrames: delayFor.get(connection.id) ?? 0,
        connection: connection.id
      })
    }

    this.#linkSinksToTracks()
    this.#host.applyTrackDelays(compiled)
    this.#applyChannels()
    this.#host.router?.setRoutes([...midiRoutes, ...this.#midiSendRoutes(midiRoutes)])
  }

  /**
   * The routes a MIDI send makes: from the nodes at the MIDI end of the source track's chain, the ones that
   * make MIDI and pass it nowhere by a connection, to the node the target track's MIDI clips play into. A
   * target with no such node receives nothing, as its clips would play into nothing. A bypassed node is not
   * routed from, as it passes nothing. A composite is read at its boundary: its MIDI output is what leaves
   * it, and its MIDI input is where what arrives goes, as for any connection to it.
   */
  #midiSendRoutes (routes) {
    const routed = new Set(routes.map(r => r.from))
    const out = []
    for (const send of this.#host.project.sends) {
      if (send.kind !== 'midi') continue
      const input = this.#host.project.track(send.to)?.midiInput
      const targets = !input ? [] : this.#host.isComposite(input) ? this.#host.compositeMidiEnds(input, 'in') : [this.#arrivalEngineId(input)].filter(Boolean)
      if (targets.length === 0) continue
      for (const node of this.#host.project.nodes) {
        if (node.track !== send.from || node.bypassed) continue
        const sources = this.#host.isComposite(node.id)
          ? this.#host.compositeMidiEnds(node.id, 'out')
          : (this.#host.engineNode(node.id)?.profile?.produces ?? []).some(isMidi) ? [this.#host.engineIdOf(node.id)].filter(Boolean) : []
        for (const from of sources) {
          if (routed.has(from)) continue
          for (const to of targets) if (to !== from) out.push({ from, to, ...rangeOf(send) })
        }
      }
    }
    return out
  }
}
