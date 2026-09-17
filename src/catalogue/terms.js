// src/catalogue/terms.js
//
// Formatting values for SPARQL.
//
// AGENTS.md: values passed into a query must already be formatted terms. The
// loader quotes nothing itself, so there is exactly one place where a value
// becomes syntax, and it is this file.

/** An IRI, refused rather than escaped if it could break out of the brackets. */
export function iri (value) {
  const text = String(value)
  if (!/^https?:\/\/[^\s<>"{}|\\^`]+$/.test(text)) {
    throw new Error(`not a usable IRI: ${text}`)
  }
  return `<${text}>`
}

/** A string literal, with the five characters that matter escaped. */
export function literal (value) {
  const text = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `"${text}"`
}

/** A non-negative integer, for a LIMIT. */
export function integer (value) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) throw new Error(`not a non-negative integer: ${value}`)
  return String(n)
}
