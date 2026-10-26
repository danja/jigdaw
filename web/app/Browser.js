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
import { MAX_RESULTS } from '../../src/catalogue/limits.js'
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

      const head = document.createElement('div')
      head.className = 'head'
      row.append(head)

      const name = document.createElement('div')
      name.className = 'name'
      name.textContent = result.label ?? result.iri
      head.append(name)

      if (result.web) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = 'Load'
        button.addEventListener('click', () => ctx.loading.loadPlugin(result.homepage ?? result.iri).catch(() => {}))
        head.append(button)
      }

      const meta = document.createElement('div')
      meta.className = 'meta'
      meta.textContent = [result.vendor, result.roles.join(', ')].filter(Boolean).join(' · ')
      row.append(meta)

      if (!result.web) {
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
      verify: iri => verifier.loadListing(iri)
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
      const head = document.createElement('div')
      head.className = 'head'
      row.append(head)
      const name = document.createElement('div')
      name.className = 'name'
      // The profile governs the name once it has arrived.
      name.textContent = member.ok ? member.profile.label : (member.listedLabel ?? member.iri)
      head.append(name)

      if (member.ok) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = 'Load'
        button.setAttribute('aria-label', `Load ${member.profile.label}`)
        button.addEventListener('click', () => ctx.loading.loadPlugin(member.iri).catch(() => {}))
        head.append(button)
      }

      const meta = document.createElement('div')
      meta.className = 'meta'
      meta.textContent = member.ok
        ? [member.profile.vendor, member.profile.roles.map(compact).join(', ')].filter(Boolean).join(' · ')
        : member.iri
      row.append(meta)

      if (!member.ok) {
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

  // Keyboard-first: Enter in the search box runs the search; in the results,
  // ArrowUp/ArrowDown move between loadable plugins and Enter loads the
  // focused one onto the target track (the Load onto menu). A mouse is not
  // required for any of it.
  function focusResult (index) {
    const buttons = [...$('results').querySelectorAll('button')]
    if (buttons.length === 0) return
    const i = Math.max(0, Math.min(buttons.length - 1, index))
    buttons[i].focus()
  }

  // Search as you type, like Reaper's FX browser: a short debounce so a
  // fast typist does not fire a request per keystroke. Enter still runs
  // immediately.
  let debounce = null
  $('q').addEventListener('input', () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => search(), 200)
  })
  $('q').addEventListener('keydown', event => {
    if (event.key === 'Enter') { clearTimeout(debounce); event.preventDefault(); search() }
  })
  $('results').addEventListener('keydown', event => {
    const buttons = [...$('results').querySelectorAll('button')]
    if (buttons.length === 0) return
    const current = buttons.indexOf(document.activeElement)
    if (event.key === 'ArrowDown') { event.preventDefault(); focusResult(current < 0 ? 0 : current + 1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); focusResult(current < 0 ? buttons.length - 1 : current - 1) }
    else if (event.key === 'Enter' && current >= 0) { event.preventDefault(); buttons[current].click() }
  })

  async function search () {
    const text = $('q').value.trim()
    const facet = $('facet').value
    // Only what this host can run: a native plugin the catalogue knows about
    // is nothing a person here can load. An empty search lists all of it,
    // which answers "what have I got" without being asked twice.
    try {
      const body = await browserCatalogue(document).search({
        text, limit: MAX_RESULTS,
        ...(facet ? { [facet.split('=')[0]]: facet.split('=')[1] } : {})
      })
      renderResults(body.results, text || facet)
      // Keep the keyboard flow going: after a search, the first loadable
      // result is focused, so Enter loads it without reaching for the mouse.
      requestAnimationFrame(() => focusResult(0))
      if (body.upstreamError) {
        // The wider catalogue being down must not hide the plugins held here.
        log(`the wider catalogue is unavailable: ${body.upstreamError}`, 'error')
      }
      if (body.loadableOnly && body.results.length === 0) {
        log('nothing loadable matched.')
      }
      log(`${body.results.length} result(s)`, 'ok')
    } catch (error) {
      log(`search failed: ${error.message}`, 'error')
    }
  }

  /**
   * Modal browser: a floating dialog over the page, keyboard-first. Used by the
   * FX button (and anywhere a plugin is wanted without leaving the current
   * view). Selecting a result loads it onto the target track and closes.
   */
  function openModal (trackId) {
    if (trackId !== undefined && trackId !== null) ctx.rack.loadedOnto(trackId)
    const dialog = document.createElement('dialog')
    dialog.className = 'plugin-browser-modal'
    const box = document.createElement('div')
    box.className = 'plugin-browser'
    const input = document.createElement('input')
    input.type = 'search'
    input.placeholder = 'Search plugins'
    input.setAttribute('aria-label', 'Search plugins')
    const results = document.createElement('div')
    results.className = 'results'
    box.append(input, results)
    dialog.append(box)
    document.body.append(dialog)

    async function runSearch () {
      const text = input.value.trim()
      try {
        const body = await browserCatalogue(document).search({ text, limit: MAX_RESULTS })
        results.textContent = ''
        for (const r of body.results) {
          if (!r.web) continue
          const row = document.createElement('div')
          row.className = 'result'
          const name = document.createElement('button')
          name.type = 'button'
          name.textContent = r.label ?? r.iri
          name.addEventListener('click', async () => {
            await ctx.loading.loadPlugin(r.homepage ?? r.iri).catch(() => {})
            dialog.close()
          })
          row.append(name)
          results.append(row)
        }
        if (results.children.length === 0) {
          const empty = document.createElement('p')
          empty.className = 'note'
          empty.textContent = `Nothing matched ${text}.`
          results.append(empty)
        }
      } catch (error) { results.textContent = error.message }
    }
    input.addEventListener('input', () => { clearTimeout(input._t); input._t = setTimeout(runSearch, 200) })
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(input._t); runSearch() } })
    dialog.addEventListener('close', () => dialog.remove())
    dialog.showModal()
    input.focus()
    runSearch()
  }

  return { search, openCollection, loadCollection, openModal, catalogue: () => browserCatalogue(document) }
}
