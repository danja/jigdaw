// web/app/Loading.js
//
// Loading a plugin from the page: by IRI, from search results or from a
// collection, onto the track the Load onto menu names. A foreign plugin is
// asked about first (contract section 12.4).
import { outputsOf, inputsOf, compatible } from '../../src/model/Endpoints.js'

/**
 * Ask about a foreign plugin. Contract section 12.4.
 *
 * A dialog rather than confirm(), because the statements are four lines and the
 * decision is whether to run somebody else's code in this page. Modal, focus
 * moved into it, Escape and the backdrop both count as no, and the default
 * button is the refusal: a person who presses Enter without reading has
 * declined, which is the way round that costs least when it is wrong.
 */
export function askConsent (document, request) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog')
    dialog.className = 'consent'

    const heading = document.createElement('h2')
    heading.textContent = `Run ${request.label}?`
    dialog.append(heading)

    const list = document.createElement('ul')
    for (const statement of request.statements) {
      const item = document.createElement('li')
      item.textContent = statement
      list.append(item)
    }
    dialog.append(list)

    const buttons = document.createElement('div')
    buttons.className = 'consent-buttons'
    const no = document.createElement('button')
    no.type = 'button'
    no.textContent = 'Do not run it'
    const yes = document.createElement('button')
    yes.type = 'button'
    yes.className = 'danger'
    yes.textContent = 'Run it with full access'
    buttons.append(no, yes)
    dialog.append(buttons)

    let answered = false
    const done = answer => {
      if (answered) return
      answered = true
      dialog.close()
      dialog.remove()
      resolve(answer)
    }
    no.addEventListener('click', () => done(false))
    yes.addEventListener('click', () => done(true))
    // Escape fires cancel, and a dialog dismissed any other way is still a no.
    dialog.addEventListener('cancel', () => done(false))
    dialog.addEventListener('close', () => done(false))

    document.body.append(dialog)
    dialog.showModal()
    no.focus()
  })
}


export function createLoading (ctx) {
  const { document, log } = ctx

  async function loadPlugin (input) {
    const d = await ctx.runtime.ensureRunning()
    const iri = new URL(input, document.baseURI).href
    log(`GET ${iri}`)

    // Contract section 12.4: a foreign plugin is never loaded without being asked
    // for, so which kind this is has to be known before anything is loaded. The
    // classification costs one fetch of the profile, and only on a host that
    // supports foreign plugins at all.
    let foreign = false
    const support = d.foreignSupport
    if (support) {
      const seen = await support.classify(iri).catch(() => null)
      foreign = seen?.kind === 'foreign'
    }

    // The Load onto menu. Read before anything is awaited, so a second Load
    // pressed while this one fetches does not change where this one lands.
    const track = ctx.rack.targetTrack()
    const where = { ...(foreign ? { foreign: true } : {}), ...(track ? { track } : {}) }
    let result = await d.addPlugin(iri, where)

    // The dispatcher refuses until this container has been consented to and hands
    // back what a person must be asked. This is the only place in the application
    // that asks, and it renders the statements it was given rather than wording
    // them again, because they are the thing being agreed to.
    if (!result.ok && result.kind === 'consent') {
      if (!await askConsent(document, result.request)) {
        log(`${result.request.label}: not loaded`, 'error')
        return
      }
      d.foreignTrust?.consent(result.request.iri, result.request.digest)
      result = await d.addPlugin(iri, { ...where, foreign: true })
    }

    if (!result.ok) {
      log(`${result.step ? `[${result.step}] ` : ''}${result.message}`, 'error')
      return
    }

    const { nodeId, entry, trackId } = result
    log(`loaded ${entry.profile.label}`, 'ok')
    // Where this one went is where the next Load goes, so an instrument and then
    // an effect build one chain rather than two tracks.
    ctx.rack.loadedOnto(trackId)

    // Chain after the previous plugin on the same track, so loading twice onto
    // one track builds a signal path.
    //
    // Only where there is a port at each end. This used to chain whatever came
    // before to whatever came next, so loading a reverb and then an instrument
    // asked to connect audio into a plugin with no audio input: the dispatcher
    // now refuses that and says so, and before it did the refusal came out of
    // Web Audio as an IndexSizeError in the middle of loading and left the slot
    // half drawn. Not chaining is the ordinary case here rather than a failure,
    // so it is not logged as one.
    const nodes = d.project.nodes.filter(n => n.track === trackId)
    const previous = nodes[nodes.length - 2]
    if (previous) {
      const from = outputsOf(d.engineNode(previous.id)?.profile)[0]
      const to = inputsOf(entry.profile).find(port => port.portSymbol === undefined)
      if (from && to && compatible(from, to)) {
        const chained = d.apply([{
          op: 'addConnection',
          from: { node: previous.id, portIndex: from.portIndex },
          to: { node: nodeId, portIndex: to.portIndex },
          signalKind: from.kind
        }])
        if (!chained.ok) log(chained.message, 'error')
      }
    }

    // Nothing here connects anything to the speakers. The dispatcher links every
    // audio sink to its track's fader, and the fader to the master, which is
    // the path this page used to make itself by reaching past the model, once
    // per node, whether or not the model thought that node was the end of
    // anything.
    ctx.rack.draw()
    ctx.expose()
  }

  return { loadPlugin }
}
