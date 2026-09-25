// web/app/Media.js
//
// The session's own IRI, and the audio files the page holds under it.
//
// The IRI is the session's @base when saved. Media a person imports lives
// under it, at media/<sha-256>.<ext>, so a saved session refers to it
// relatively and a zip carries it (project-format.md "Clips"). A session
// opened from a file takes that file's directory instead.
//
// Imported and unzipped files are kept by IRI and looked in before the
// network, because an imported file has nowhere else to come from.

export function createMedia (document) {
  let base = new URL(`sessions/${Date.now()}/`, document.baseURI).href
  const files = new Map()

  return {
    get base () { return base },

    /**
     * Move to the session at `iri`: its directory, not the file, because a
     * preset's IRI is the preset file and media imported afterwards goes
     * beside it, under the base the session saves with.
     */
    rebase (iri) { base = new URL('./', iri).href },

    has (iri) { return files.has(iri) },
    get (iri) { return files.get(iri) ?? null },

    /** Keep a file's bytes under its IRI. */
    put (iri, bytes, mediaType = null) { files.set(iri, { bytes, mediaType }) },

    /** Where an imported file lives, named by its content. */
    iriFor (hex, extension) { return new URL(`media/${hex}.${extension}`, base).href },

    /** The files a saved session carries: held here, and under its base. */
    heldUnderBase (iris) { return iris.filter(iri => files.has(iri) && iri.startsWith(base)) },

    /** A file's bytes, from what is held or else the network. */
    async fetchBytes (iri) {
      // A copy: decoding takes the buffer it is given.
      if (files.has(iri)) return files.get(iri).bytes.slice().buffer
      const response = await fetch(iri)
      if (!response.ok) throw new Error(`${iri} answered ${response.status}`)
      return response.arrayBuffer()
    }
  }
}
