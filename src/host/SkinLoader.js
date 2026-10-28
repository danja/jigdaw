// src/host/SkinLoader.js
//
// Fetches, verifies and prepares a plugin's skin (docs/svg-skins.md). Two steps, because the
// fetching is once per plugin and the building is once per panel: two instances of one plugin
// share the files but need artwork nodes, and ids, of their own.
//
// Nothing here touches the audio graph. A skin that fails at any step is reported and the
// generated panel stays (contract section 9.4 and 10.2).
import { readSkin, checkSkin } from '../rdf/SkinReader.js'
import { rebaseLocation } from '../rdf/ProfileReader.js'
import { buildArtwork } from '../ui/SkinArtwork.js'
import { buildHtmlSkin } from '../ui/HtmlSkin.js'

export class SkinLoadError extends Error {
  constructor (message, options) {
    super(message, options)
    this.name = 'SkinLoadError'
  }
}

/**
 * @param {{ skin: { location: string, integrity: string } }} profile from readProfile
 * @param {{ fetchVerified: Function, parseTurtle: Function, parseSvg: Function }} deps
 *   fetchVerified(resource, { kind }) is PluginLoader's: it throws unless the digest matches
 * @returns {Promise<{ skin: object, artwork: { doc: Document, size: number } } | { kind: 'html', document: Document, size: number }>}
 */
export async function loadSkin (profile, { fetchVerified, parseTurtle, parseSvg, parseHtml }) {
  if (!profile.skin) throw new SkinLoadError('the profile declares no skin')
  const decoder = new TextDecoder()

  // An HTML skin is one file and the profile points at it directly (docs/html-skins.md). An SVG skin is a Turtle
  // document that names its artwork. The media type on the profile's own jig:skin node says which.
  if (profile.skin.mediaType === 'text/html') {
    const bytes = await fetchVerified(profile.skin, { kind: 'skin' })
    let document
    try {
      document = parseHtml(decoder.decode(bytes))
    } catch (cause) {
      throw new SkinLoadError(`the skin at ${profile.skin.location}: ${cause.message}`, { cause })
    }
    return { kind: 'html', document, size: bytes.byteLength }
  }

  const skinBytes = await fetchVerified(profile.skin, { kind: 'skin' })
  const skinIri = profile.skin.location
  let skin
  try {
    skin = readSkin(await parseTurtle(decoder.decode(skinBytes), skinIri))
  } catch (cause) {
    throw new SkinLoadError(`the skin at ${skinIri} could not be read: ${cause.message}`, { cause })
  }
  if (!skin.artwork?.location || !skin.artwork.integrity) {
    throw new SkinLoadError(`the skin at ${skinIri} names no artwork with a location and a digest`)
  }

  // The skin states an @base, so its artwork is absolute against the canonical origin, as a profile's
  // files are. Retrieval follows where the skin came from (ProfileReader.rebaseLocation), or a plugin
  // served from a mirror or a local checkout would fetch its artwork from the original site.
  // A skin carried as a data: URI has no directory to follow and keeps the location as written.
  const directory = iri => iri.slice(0, iri.lastIndexOf('/') + 1)
  const artwork = skinIri.startsWith('data:')
    ? skin.artwork
    : { ...skin.artwork, location: rebaseLocation(skin.artwork.location, directory(skin.iri), directory(skinIri)) }
  const artBytes = await fetchVerified(artwork, { kind: 'skin artwork' })
  let doc
  try {
    doc = parseSvg(decoder.decode(artBytes))
  } catch (cause) {
    throw new SkinLoadError(`the artwork at ${artwork.location}: ${cause.message}`, { cause })
  }
  return { skin, artwork: { doc, size: artBytes.byteLength } }
}

/**
 * @param {{ skin: object, artwork: { doc, size } }} loaded from loadSkin
 * @param {{ ports: object[] }} profile
 * @param {{ document: Document, prefix: string }} context prefix makes this panel's ids its own
 * @returns {{ svg, elements, controls, omitted: { control, reason }[] } | { kind: 'html', root, css, controls, omitted }}
 * @throws {SkinError | HtmlSkinError} when the artwork breaks the allowlist
 */
export function prepareSkin (loaded, profile, { document, prefix }) {
  if (loaded.kind === 'html') {
    const built = buildHtmlSkin(loaded.document, profile, { document, prefix, size: loaded.size })
    // The same shape the page logs for an SVG skin's left-out controls.
    return { ...built, kind: 'html', omitted: built.omitted.map(o => ({ control: o.element, reason: o.reason })) }
  }
  const built = buildArtwork(loaded.artwork.doc, { document, prefix, size: loaded.artwork.size })
  const { keep, omitted } = checkSkin(loaded.skin, { ids: built.ids }, profile.ports)
  return { svg: built.svg, elements: built.elements, controls: keep, omitted }
}
