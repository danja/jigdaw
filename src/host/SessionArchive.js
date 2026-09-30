// src/host/SessionArchive.js
//
// What a saved session is made of, as files: session.ttl (the project),
// editor.ttl (the editor graph, only when it says something), and the audio
// the project plays. One Turtle file when there is nothing else to carry,
// otherwise a zip. docs/project-format.md, "Two graphs", is the reason
// editor.ttl is a file of its own.
import { writeZip } from './Zip.js'

export const SESSION_FILE = 'session.ttl'
export const EDITOR_FILE = 'editor.ttl'

const encode = text => new TextEncoder().encode(text)

/**
 * `media` is [{ name, bytes }] already named relative to the session.
 * Returns `{ kind: 'turtle', text }` or `{ kind: 'zip', bytes }`.
 */
export function packSession ({ turtle, editor = null, media = [] }) {
  if (editor === null && media.length === 0) return { kind: 'turtle', text: turtle }
  const entries = [{ name: SESSION_FILE, bytes: encode(turtle) }]
  if (editor !== null) entries.push({ name: EDITOR_FILE, bytes: encode(editor) })
  entries.push(...media)
  return { kind: 'zip', bytes: writeZip(entries) }
}

/**
 * Split what `readZip` returned into the two documents and the media.
 * A zip without a session.ttl is refused; one without editor.ttl is a session
 * saved with default layout.
 */
export function unpackSession (files) {
  const session = files.get(SESSION_FILE)
  if (!session) throw new Error(`the archive holds no ${SESSION_FILE}`)
  const decoder = new TextDecoder()
  const editor = files.get(EDITOR_FILE)
  const media = new Map([...files].filter(([name]) => name !== SESSION_FILE && name !== EDITOR_FILE))
  return { turtle: decoder.decode(session), editor: editor ? decoder.decode(editor) : null, media }
}
