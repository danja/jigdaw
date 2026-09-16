// src/rdf/parse.js
//
// Turtle parsing with no filesystem dependency, so the same code runs in a
// browser and in node. The host parses and validates a profile it fetched
// (contract sections 1.2 and 3.1), so this cannot be node-only.
//
// n3's Parser is used directly, synchronously, rather than the streaming
// @rdfjs/parser-n3 wrapper. The wrapper wants a node Readable, and adapting a
// web stream to look like one is a source of hangs for no benefit: a profile is
// a small document that arrives as a string.
import rdf from '@zazuko/env'
import { Parser } from 'n3'

/**
 * Parse Turtle text into a dataset. Throws on malformed input, with the line
 * and column n3 reports, which contract section 10.1 requires to survive into
 * the message a caller sees.
 */
export async function parseText (text, baseIRI) {
  const parser = new Parser({ baseIRI, factory: rdf })
  return rdf.dataset(parser.parse(text))
}
