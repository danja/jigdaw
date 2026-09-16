// web/shims/util.js
//
// A stub for node's util, imported by rdf-dataset-ext/fromStream, which the
// browser build never reaches. See web/shims/stream.js for why.
export const promisify = fn => (...args) =>
  new Promise((resolve, reject) => fn(...args, (err, value) => (err ? reject(err) : resolve(value))))
export const inherits = () => {}
export const inspect = value => String(value)
export default { promisify, inherits, inspect }
