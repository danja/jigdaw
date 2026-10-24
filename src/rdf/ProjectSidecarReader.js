// src/rdf/ProjectSidecarReader.js
//
// The documents saved beside a project that are not the project: the editor graph (where nodes sit, how tracks are laid out) and the scripts. Neither
// is part of what a revision covers, so neither goes through the model's changeset; each is read into plain data for the page to hand to the
// editor and script state (docs/project-format.md, "Two graphs").
import { vocabulary as v } from './Vocabulary.js'
import { value, number, idOf } from './ReaderKit.js'

const { jig } = v

/**
 * The editor graph: node positions and track layout. Never part of the project
 * itself. A subject that is neither a fragment of the project nor understood is
 * refused, not skipped, so a corrupt file says so.
 */
export function readEditor (dataset, projectIri) {
  const positions = new Map()
  const tracks = new Map()
  const layout = id => tracks.get(id) ?? tracks.set(id, {}).get(id)
  for (const quad of dataset) {
    const p = quad.predicate.value
    if (p === jig.x || p === jig.y) {
      const id = idOf(quad.subject.value, projectIri, 'position')
      const at = positions.get(id) ?? { x: 0, y: 0 }
      at[p === jig.x ? 'x' : 'y'] = Number(quad.object.value)
      positions.set(id, at)
    } else if (p === jig.order) {
      layout(idOf(quad.subject.value, projectIri, 'track layout')).order = number(quad.object, 'order')
    } else if (p === jig.color) {
      layout(idOf(quad.subject.value, projectIri, 'track layout')).color = quad.object.value
    } else if (p === jig.laneSize) {
      layout(idOf(quad.subject.value, projectIri, 'track layout')).laneSize = quad.object.value
    } else if (p === jig.folder) {
      layout(idOf(quad.subject.value, projectIri, 'track layout')).folder = quad.object.value
    } else if (p === jig.folderCollapsed) {
      layout(idOf(quad.subject.value, projectIri, 'track layout')).folderCollapsed = quad.object.value === 'true'
    }
  }
  return { positions, tracks }
}

/**
 * The scripts document: each `jig:Script`, as {id, label, language, source, savedAt}. A subject that is not a
 * fragment of the project is refused, not skipped, so a corrupt file says so; the caller decides that an
 * unreadable scripts document must not stop a session opening (docs/project-format.md).
 */
export function readScripts (dataset, projectIri) {
  const found = new Map()
  const at = id => found.get(id) ?? found.set(id, { id, label: null, language: null, source: null, savedAt: null }).get(id)
  for (const quad of dataset) {
    const p = quad.predicate.value
    if (p === jig.scriptSource || p === jig.scriptLanguage || p === v.rdfs.label || p === v.dcterms.modified) {
      const script = at(idOf(quad.subject.value, projectIri, 'script'))
      if (p === jig.scriptSource) script.source = quad.object.value
      else if (p === jig.scriptLanguage) script.language = quad.object.value
      else if (p === v.dcterms.modified) script.savedAt = quad.object.value
      else script.label = quad.object.value
    }
  }
  const scripts = [...found.values()]
  for (const s of scripts) {
    if (!s.source) throw new Error(`script ${s.id} has no source text`)
    if (!s.language) throw new Error(`script ${s.id} states no language`)
  }
  return scripts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
