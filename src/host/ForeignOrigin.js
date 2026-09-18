// src/host/ForeignOrigin.js
//
// The page side of the virtual origin. Contract section 12.3.
//
// ForeignLoader.js verifies a container and unpacks it; this hands those bytes
// to web/foreign/sw.js and returns the base URL the plugin is loaded from.
// Everything the plugin then reaches resolves inside the container or is
// refused by the worker, which never calls fetch.
//
// Why a worker and not blob URLs, which would need no registration and no
// scope: a WAM locates itself with `new URL('.', import.meta.url)` and a blob
// URL has no directory. Measured across webaudiomodules/wam-examples, 22 of 23
// plugins do this, so the cheap option breaks almost all of them.
//
// The base path is the container's digest. That is not a security measure, the
// verification already happened, but it means two containers can never collide
// and a plugin's URLs name the exact bytes it was loaded from.

const SCOPE = '/foreign/'

/** A digest as a path segment: base64 has characters a URL should not carry. */
const idFor = digest => digest.replace(/^sha\d+-/, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 32).toLowerCase()

export class ForeignOrigin {
  #registration
  #refusals = []

  constructor (registration, { scope = SCOPE } = {}) {
    this.#registration = registration
    this.scope = scope
    navigator.serviceWorker?.addEventListener('message', event => {
      if (event.data?.type === 'jigdaw-container-refusal') {
        this.#refusals.push({ id: event.data.id, path: event.data.path })
      }
    })
  }

  /** Paths a plugin asked for that were not in its container. */
  get refusals () { return [...this.#refusals] }

  /**
   * Register the worker.
   *
   * Throws where service workers are unavailable rather than falling back to
   * something weaker. A host that cannot impose the boundary must not load a
   * foreign plugin at all, because the consent in section 12.4 was given on the
   * understanding that the boundary exists.
   */
  static async start ({ scope = SCOPE, scriptURL = `${SCOPE}sw.js` } = {}) {
    if (!globalThis.isSecureContext) {
      throw new Error(
        'a foreign plugin needs a secure context. Serve the host over TLS, or use localhost.')
    }
    if (!navigator.serviceWorker) {
      throw new Error(
        'this browser has no service workers, so the container boundary contract section 12.3 ' +
        'requires cannot be imposed, and a foreign plugin must not be loaded without it.')
    }
    const registration = await navigator.serviceWorker.register(scriptURL, { scope, type: 'classic' })
    await navigator.serviceWorker.ready
    return new ForeignOrigin(registration, { scope })
  }

  /**
   * Hand a verified container to the worker and return where it lives.
   *
   * `origin` is the ContainerOrigin from openForeign, which is the only thing
   * that has ever held these bytes.
   */
  async install (containerOrigin, digest) {
    const id = idFor(digest)
    const files = new Map()
    for (const name of containerOrigin.names) {
      const file = containerOrigin.resolve(name)
      files.set(name, { bytes: file.bytes, mediaType: file.mediaType })
    }

    const worker = this.#registration.active ?? navigator.serviceWorker.controller
    if (!worker) throw new Error('the container worker is registered but not active yet')

    await new Promise((resolve, reject) => {
      const channel = new MessageChannel()
      const timeout = setTimeout(() => reject(new Error('the container worker did not acknowledge the container')), 5000)
      channel.port1.onmessage = event => {
        clearTimeout(timeout)
        event.data?.ok ? resolve(event.data) : reject(new Error('the container worker refused the container'))
      }
      worker.postMessage({ type: 'jigdaw-install-container', id, files }, [channel.port2])
    })

    return `${this.scope}${id}/`
  }

  /** Stop serving a container. */
  async remove (digest) {
    this.#registration.active?.postMessage({ type: 'jigdaw-install-container', id: idFor(digest), files: new Map() })
  }
}

export { idFor }
