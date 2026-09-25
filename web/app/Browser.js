// web/app/Browser.js
//
// The Browser column: searching the catalogue, and opening a collection.
//
// Collections are docs/plugin-collections.md section 3. Opening one checks each
// member's profile and capabilities and fetches no code, so it needs no
// AudioContext and runs before the page has been asked to make a sound. Loading
// a member is the ordinary loadPlugin path, which does the full contract
// section 3.1 again.
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { CollectionLoader } from '../../src/catalogue/CollectionLoader.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities, compact } from '../../src/host/Capabilities.js'

/** The catalogue, as reached from the page: the host's own endpoint, not SPARQL. */
function browserCatalogue (document) {
  const ask = async (path, params) => {
    const response = await fetch(new URL(`catalogue/${path}?${params}`, document.baseURI))
    const isJson = (response.headers.get('content-type') ?? '').includes('json')
    if (!isJson) {
      throw new Error(response.status === 404
        ? `the catalogue endpoint is not there (${response.status}). If the page was just updated, the server needs restarting.`
        : `the catalogue answered ${response.status}`)
    }
    const body = await response.json()
    if (!response.ok) throw new Error(body.error ?? `catalogue returned ${response.status}`)
    return body
  }
  return {
    async search ({ text = '', limit = 25, loadable = true, ...facets } = {}) {
      const params = new URLSearchParams()
      if (text) params.set('q', text)
      for (const [k, v] of Object.entries(facets)) if (v) params.set(k, v)
      params.set('limit', String(limit))
      if (!loadable) params.set('loadable', 'false')
      return ask('search', params)
    },
    async describe (iri) { return ask('describe', new URLSearchParams({ iri })) }
  }
}

export function createBrowser (ctx) {
  const { document, $, log } = ctx

  function renderResults (results, query) {
    const box = $('results')
    box.textContent = ''
    if (results.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'note'
      empty.textContent = `Nothing matched ${query}.`
      box.append(empty)
      return
    }

    const loadable = results.filter(r => r.web).length
    const note = document.createElement('p')
    note.className = 'note'
    note.textContent = loadable === results.length
      ? `${results.length} loadable here.`
      : `${results.length} found, ${loadable} loadable here. The rest are native plugins the catalogue knows about but this host cannot run.`
    box.append(note)

    for (const result of results) {
      const row = document.createElement('div')
      // Dimmed, so the ones that can be loaded read first at a glance.
      row.className = result.web ? 'result' : 'result native'

      const name = document.createElement('div')
      name.className = 'name'
      name.textContent = result.label ?? result.iri
      if (result.web) {
        const badge = document.createElement('span')
        badge.className = 'badge'
        badge.textContent = ' web'
        name.append(' ', badge)
      }
      row.append(name)

      const meta = document.createElement('div')
      meta.className = 'meta'
      meta.textContent = [result.vendor, result.roles.join(', ')].filter(Boolean).join(' · ')
      row.append(meta)

      if (result.web) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = 'Load'
        button.addEventListener('click', () => ctx.loading.loadPlugin(result.homepage ?? result.iri).catch(() => {}))
        row.append(button)
      } else {
        const why = document.createElement('div')
        why.className = 'native'
        why.textContent = 'native only'
        row.append(why)
      }
      box.append(row)
    }
  }

  /**
   * Section 3, without any DOM: fetch the collection, check every member's
   * profile and capabilities, and return what CollectionLoader.load returns.
   * Used by the page's own form below and by the collection_open agent tool,
   * so an agent gets the same check a person opening the form does rather than
   * a second implementation of it (AGENTS.md: one dispatcher, thin adapters).
   */
  async function loadCollection (input) {
    const url = new URL(input, document.baseURI).href
    const validator = await ctx.runtime.shapeValidator()
    const verifier = new PluginLoader({ parse: parseText, validator, capabilities: detectCapabilities(globalThis) })
    return new CollectionLoader({
      parse: parseText,
      validator,
      verify: iri => verifier.loadProfile(iri)
    }).load(url)
  }

  async function openCollection (input) {
    log(`GET ${new URL(input, document.baseURI).href}`)
    const box = $('results')
    box.textContent = ''
    const opened = await loadCollection(input).catch(error => {
      log(`${error.step ? `[${error.step}] ` : ''}${error.message}`, 'error')
      return null
    })
    if (!opened) return
    renderCollection(opened)
  }

  function renderCollection ({ collection, members, warnings }) {
    const box = $('results')
    box.textContent = ''

    const heading = document.createElement('h3')
    heading.className = 'collection-name'
    heading.textContent = collection.label
    box.append(heading)
    if (collection.comment) {
      const about = document.createElement('p')
      about.className = 'note'
      about.textContent = collection.comment
      box.append(about)
    }

    const ready = members.filter(m => m.ok)
    const note = document.createElement('p')
    note.className = 'note'
    note.textContent = ready.length === members.length
      ? `${members.length} plugin(s), all loadable here.`
      : `${members.length} plugin(s), ${ready.length} loadable here. The rest say why below.`
    box.append(note)

    for (const member of members) {
      const row = document.createElement('div')
      row.className = member.ok ? 'result' : 'result native'
      const name = document.createElement('div')
      name.className = 'name'
      // The profile governs the name once it has arrived.
      name.textContent = member.ok ? member.profile.label : (member.listedLabel ?? member.iri)
      row.append(name)

      const meta = document.createElement('div')
      meta.className = 'meta'
      meta.textContent = member.ok
        ? [member.profile.vendor, member.profile.roles.map(compact).join(', ')].filter(Boolean).join(' · ')
        : member.iri
      row.append(meta)

      if (member.ok) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = 'Load'
        button.setAttribute('aria-label', `Load ${member.profile.label}`)
        button.addEventListener('click', () => ctx.loading.loadPlugin(member.iri).catch(() => {}))
        row.append(button)
      } else {
        // No Load button: a control nobody can use is left out, and the reason
        // is written instead, so it is the same information by any means.
        const why = document.createElement('div')
        why.className = 'native'
        why.textContent = `Not loadable here: ${member.step ? `[${member.step}] ` : ''}${member.message}`
        row.append(why)
      }
      box.append(row)
    }

    for (const warning of warnings) log(`${collection.label}: ${warning.message}`)
    const moved = members.filter(m => m.ok && m.notes.length > 0)
    for (const member of moved) console.log(`[jigdaw] ${member.iri}: ${member.notes.join('; ')}`)
    // A plugin naming itself by another IRI (CollectionLoader's "names itself"
    // note) is expected every time this collection is opened from anywhere but
    // its canonical origin, section 3.3's mirror-or-local-checkout case, and is
    // not worth a line in the visible log. A listed name the profile disagrees
    // with usually means the collection is stale, so that one still is.
    const renamed = members.filter(m => m.ok && m.notes.some(n => n.startsWith('listed as')))
    if (renamed.length > 0) {
      log(`${renamed.length} plugin(s) are named differently by their profile than by this collection. ` +
        'The details are in the console.')
    }
    log(`opened ${collection.label}: ${ready.length} of ${members.length} loadable`, ready.length > 0 ? 'ok' : 'error')
  }

  async function search () {
    const text = $('q').value.trim()
    const facet = $('facet').value
    // An empty search lists what this host can run, which is the useful default
    // for a browser: it answers "what have I got" without being asked twice.
    try {
      const body = await browserCatalogue(document).search({
        text, limit: 25,
        loadable: !$('everything').checked,
        ...(facet ? { [facet.split('=')[0]]: facet.split('=')[1] } : {})
      })
      renderResults(body.results, text || facet)

      if (body.upstreamError) {
        // The wider catalogue being down must not hide the plugins held here.
        log(`the wider catalogue is unavailable: ${body.upstreamError}`, 'error')
      }
      if (body.loadableOnly && body.results.length === 0) {
        log('nothing loadable matched. Tick the box to include native plugins.')
      }
      log(`${body.results.length} result(s)`, 'ok')
    } catch (error) {
      log(`search failed: ${error.message}`, 'error')
    }
  }

  return { search, openCollection, loadCollection, catalogue: () => browserCatalogue(document) }
}
