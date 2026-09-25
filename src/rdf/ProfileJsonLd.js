// src/rdf/ProfileJsonLd.js
//
// A plugin's profile as JSON-LD, for the `init` message a plugin's own user
// interface receives (docs/messaging.md section 2.2).
//
// Only what an editor draws from: the plugin's identity and its ports. The
// frame is someone else's code, so it gets what it needs to draw controls
// and no more. The context maps every key to the term it came from, so the
// object is a faithful piece of the profile rather than a private format that
// happens to be JSON.
import { vocabulary as v } from './Vocabulary.js'

const CONTEXT = Object.freeze({
  label: v.rdfs.label,
  comment: v.rdfs.comment,
  // A set, not a list: ports are keyed by symbol and have no order.
  port: { '@id': v.lv2.port, '@container': '@set' },
  symbol: v.lv2.symbol,
  name: v.lv2.name,
  minimum: v.lv2.minimum,
  maximum: v.lv2.maximum,
  default: v.lv2.default
})

/** The profile ProfileReader returned, as a JSON-LD object an editor can read. */
export function profileAsJsonLd (profile) {
  if (!profile?.iri) throw new Error('profileAsJsonLd needs a profile with an iri')
  return {
    '@context': CONTEXT,
    '@id': profile.iri,
    label: profile.label ?? null,
    comment: profile.comment ?? null,
    port: (profile.ports ?? []).map(p => ({
      '@id': p.iri,
      symbol: p.symbol,
      name: p.name ?? p.symbol,
      minimum: p.minimum,
      maximum: p.maximum,
      default: p.defaultValue
    }))
  }
}
