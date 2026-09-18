// src/host/ForeignPlugin.js
//
// Loading a foreign plugin, end to end. Contract section 12.
//
// The pieces existed and nothing joined them: ForeignLoader verifies a
// container, ForeignOrigin serves it, and an adapter turns whatever comes out
// into a node. This is the one path through all three, so that the dispatcher
// has a single call and there is nowhere else in the codebase that runs foreign
// code.
//
// The order is the order section 12 requires and is not rearrangeable. Consent
// comes before the container is fetched, because consent is to a body of code
// and fetching it is the first thing done with it. The container is verified
// before anything is served from it. The virtual origin exists before the entry
// point is imported, because importing it is what runs the plugin.
import { openForeign } from './ForeignLoader.js'
import { ForeignOrigin } from './ForeignOrigin.js'
import { ForeignTrust } from './ForeignTrust.js'
import { LoadError, STEPS } from './LoadError.js'

/**
 * Await one stage of the load, or say which one stopped.
 *
 * Every stage below can hang rather than fail: a fetch with nothing at the
 * other end, an import the service worker never answers, a plugin whose
 * constructor waits on something. Without this the whole load simply never
 * settles, which is what it did the first time it ran outside the probe: no
 * error, no rejection, nothing in the console, and no way to tell which of six
 * stages was the one.
 *
 * A generous timeout, because the point is to name the stage rather than to
 * police it. A slow network should still succeed.
 */
async function stage (name, step, work, ms = 20000) {
  let timer = null
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new LoadError(step,
          `${name} did not finish within ${ms / 1000}s, and did not fail either`)), ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Adapters, by the name ForeignLoader resolves a format to.
 *
 * Injected rather than imported at the top, because src/wam reaches the WAM SDK
 * shape and a host that never loads a WAM should not carry it. A format with no
 * adapter here is refused by openForeign before this is consulted.
 */
const ADAPTER_MODULES = Object.freeze({
  wam: () => import('../wam/WamAdapter.js')
})

/**
 * Load a foreign plugin and return what the engine needs to adopt it.
 *
 * `trust` must already hold consent, or this throws ConsentRequired carrying
 * everything needed to ask. It is not asked for here: a module that could
 * summon a dialog is a module that can be called from anywhere, and section
 * 12.4 wants the asking to happen where a person is.
 */
export async function loadForeignPlugin (profile, context, {
  trust = new ForeignTrust(),
  origin = null,
  fetch: fetchImpl = (...args) => globalThis.fetch(...args),
  adapters = ADAPTER_MODULES
} = {}) {
  // Verifies the container, and refuses before consent. Both inside.
  const opened = await stage('fetching and verifying the container', STEPS.fetchResource,
    openForeign(profile, { trust, fetch: fetchImpl }))

  const load = adapters[opened.adapter]
  if (!load) {
    throw new LoadError(STEPS.constructNode,
      `no adapter module for "${opened.adapter}"`)
  }

  // The virtual origin, so that everything the plugin loads resolves inside the
  // bytes that were verified. Section 12.3.
  const served = origin ?? await stage('starting the container worker', STEPS.registerProcessor,
    ForeignOrigin.start())
  const base = await stage('installing the container', STEPS.registerProcessor,
    served.install(opened.origin, opened.digest))

  const { adoptWamNode, foreignProfile } = await load()

  let module
  try {
    module = await stage(`importing ${opened.entryPoint}`, STEPS.registerProcessor,
      import(/* @vite-ignore */ `${base}${opened.entryPoint}`))
  } catch (cause) {
    if (cause instanceof LoadError) throw cause
    throw new LoadError(STEPS.registerProcessor,
      `${profile.iri} could not be imported from its container: ${cause?.message ?? cause}`,
      { cause })
  }

  const Constructor = module?.default
  if (typeof Constructor !== 'function' || Constructor.isWebAudioModuleConstructor !== true) {
    throw new LoadError(STEPS.constructNode,
      `${opened.entryPoint} does not default-export a Web Audio Module constructor`)
  }

  // The WAM runtime lives in the host's own worklet and is shared by every WAM
  // in this context. Contract section 12.3a: it is the host's code, it is in no
  // container, and a plugin may not supply it.
  const groupId = await stage('installing the WAM runtime in the host worklet',
    STEPS.registerProcessor, hostGroupFor(context, served))

  const wam = await stage(`constructing ${profile.label ?? profile.iri}`, STEPS.constructNode,
    Constructor.createInstance(groupId, context))
  const node = await stage('adapting it to a node', STEPS.constructNode, adoptWamNode(wam))

  return {
    kind: 'foreign',
    iri: profile.iri,
    profile: await foreignProfile(profile, wam),
    node,
    origin: served,
    digest: opened.digest,
    ready: { latencyFrames: await node.getCompensationDelay?.() ?? 0 }
  }
}

/**
 * The WAM group for this AudioContext, initialised once.
 *
 * Kept on the context rather than in a module-level map so that it cannot
 * outlive the context it belongs to, which a closed-over map would.
 */
const GROUP = Symbol.for('jigdaw.wamHostGroup')

async function hostGroupFor (context, origin) {
  if (context[GROUP]) return context[GROUP]
  const { default: initializeWamHost } = await import(
    /* @vite-ignore */ `${origin.runtimeURL ?? '/foreign/wam-host.js'}`)
  const [groupId] = await initializeWamHost(context)
  context[GROUP] = groupId
  return groupId
}
