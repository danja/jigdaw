// src/ui/SoundRecipes.js
//
// Curated pairings for "Make notes for me": a generator that writes notes and an instrument that plays them, loaded onto one track
// (src/ui/SoundChooser.js). Curated and not computed, because which instrument suits a bass line is a musical choice and nothing in a profile says
// it; the pairs were each tried in the page (docs/learning-curve.md). A recipe whose generator or instrument is not among the plugins this host can
// run is left out, rather than offered and refused.
//
// Plugins are named by the directory in their address (`/plugins/<name>/`), which is stable where a label is not, and the same key the catalogue
// index is built from.

export const NOTE_MAKERS = Object.freeze([
  { label: 'Bass line', generator: 'bassgen', instrument: 'pulse' },
  { label: 'Melody', generator: 'melgen', instrument: 'canticle' },
  { label: 'Wandering melody', generator: 'markov', instrument: 'moka' },
  { label: 'Growing pattern', generator: 'sprout', instrument: 'monochord' }
])

/** The directory a plugin's address ends in, or null. */
export const directoryOf = iri => (/\/plugins\/([^/]+)\/?$/.exec(iri) ?? [])[1] ?? null

/**
 * Sounds for the chooser, from `instruments` and `generators` as `{ iri, load, label, about }` records: each recipe whose two plugins are both
 * there, as one sound of two parts in the order they are loaded, the generator first so that loading the instrument joins their notes.
 */
export function noteMakersFrom ({ instruments, generators }) {
  const find = (list, directory) => list.find(item => directoryOf(item.iri) === directory)
  return NOTE_MAKERS.flatMap(recipe => {
    const generator = find(generators, recipe.generator)
    const instrument = find(instruments, recipe.instrument)
    if (!generator || !instrument) return []
    return [{
      iri: `${instrument.iri}+${generator.iri}`,
      label: recipe.label,
      about: `${generator.label} writes it and ${instrument.label} plays it. Press Play after adding it.`,
      drums: false,
      generated: true,
      parts: [{ load: generator.load, label: generator.label }, { load: instrument.load, label: instrument.label }]
    }]
  })
}
