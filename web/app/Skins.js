// web/app/Skins.js
//
// The page's side of skins (docs/svg-skins.md): fetches a plugin's skin once, however many panels
// show it, and builds each panel its own artwork. The work is src/host/SkinLoader.js; this keeps what
// has been fetched and says when a panel waiting on a skin should be drawn again.
import { parseText } from '../../src/rdf/parse.js'
import { parseSvg } from '../../src/ui/SkinArtwork.js'
import { loadSkin, prepareSkin } from '../../src/host/SkinLoader.js'

export function createSkins (ctx) {
  const { document, log } = ctx
  // By skin location and digest: a different digest is a different skin. { state: 'loading' | 'ready' | 'failed', loaded }
  const loads = new Map()
  let redraw = () => {}

  const keyOf = profile => `${profile.skin.location}|${profile.skin.integrity}`

  function start (profile) {
    const entry = { state: 'loading', loaded: null }
    loads.set(keyOf(profile), entry)
    loadSkin(profile, {
      fetchVerified: (resource, options) => ctx.loader.fetchVerified(resource, options),
      parseTurtle: parseText,
      parseSvg
    }).then(loaded => {
      entry.loaded = loaded
      entry.state = 'ready'
      redraw()
    }).catch(error => {
      entry.state = 'failed'
      // The generated panel stays: a skin that fails is reported, and nothing else changes.
      log(`${profile.label ?? profile.iri} skin: ${error.message}`, 'error')
    })
    return entry
  }

  return {
    /** What to run when a skin that was loading is ready, so a panel drawn without it can be drawn with it. */
    onReady (fn) { redraw = fn },

    /** Whether this profile's skin can be drawn now. Starts the fetch the first time it is asked. */
    ready (profile) {
      if (!profile?.skin || !ctx.loader) return false
      const entry = loads.get(keyOf(profile)) ?? start(profile)
      return entry.state === 'ready'
    },

    /** Artwork nodes of this panel's own, or null (reported) when the artwork breaks the allowlist. */
    prepare (profile, scope) {
      const entry = loads.get(keyOf(profile))
      try {
        const prepared = prepareSkin(entry.loaded, profile, { document, prefix: `skin-${scope.replace(/[^\w-]/g, '_')}-` })
        for (const o of prepared.omitted) log(`${profile.label ?? profile.iri} skin: left out ${o.control}, because ${o.reason}`, 'error')
        return prepared
      } catch (error) {
        entry.state = 'failed'
        log(`${profile.label ?? profile.iri} skin: ${error.message}`, 'error')
        return null
      }
    }
  }
}
