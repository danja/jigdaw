// web/shims/stream.js
//
// A stub for node's stream module.
//
// Two dependencies import it: rdf-dataset-ext/fromStream and @zazuko/env's
// serialize. Neither code path is reachable in the browser, because profiles
// are parsed synchronously from a string by src/rdf/parse.js and nothing here
// serialises a dataset. Constructing either class throws rather than returning
// something plausible, so if that assumption is ever wrong it fails loudly at
// the point of use instead of misbehaving quietly.
const unavailable = name => {
  throw new Error(`${name} is not available in the browser build. Nothing should reach node streams here; see web/shims/stream.js.`)
}

export class Readable { constructor () { unavailable('stream.Readable') } }
export class Writable { constructor () { unavailable('stream.Writable') } }
export class Transform { constructor () { unavailable('stream.Transform') } }
export class Duplex { constructor () { unavailable('stream.Duplex') } }
export default { Readable, Writable, Transform, Duplex }
