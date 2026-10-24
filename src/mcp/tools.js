// src/mcp/tools.js
//
// The agent surface, as specified in docs/webmcp.md.
//
// These are the dispatcher's operations, not a second implementation of them.
// architecture.md: the editor and the agent surface are thin adapters over one
// dispatcher, because two implementations of "add a connection" diverge and the
// first sign is usually an undo that half works.
//
// Nothing here knows how a tool is registered with a user agent. That binding
// is not settled and lives in adapter.js, so when the API moves one file
// changes and this one does not.
//
// The tools are written in groups under src/mcp/tools/, and this file puts them together in the order the
// documentation lists them. It is the front door: callers import createTools, compact and expand from here.
import { compactTerm as compact, expandTerm as expand } from '../catalogue/facets.js'
import { sessionTools } from './tools/sessionTools.js'
import { trackTools } from './tools/trackTools.js'
import { arrangementTools } from './tools/arrangementTools.js'
import { clipTools } from './tools/clipTools.js'
import { graphTools } from './tools/graphTools.js'
import { performanceTools } from './tools/performanceTools.js'

/**
 * Build the tool list.
 *
 * `catalogue` may be null, in which case the discovery tools report that
 * searching is unavailable rather than being silently absent. A tool that
 * vanishes is harder for an agent to reason about than one that explains
 * itself.
 */
export function createTools ({ dispatcher, catalogue = null, loadPlugin = null, openCollection = null, onPlay = null, onStop = null, onPanic = null, launcher = null, reel = null }) {
  if (!dispatcher) throw new Error('the tool surface needs a dispatcher')

  return [
    ...sessionTools({ dispatcher, catalogue, loadPlugin, openCollection }),
    ...trackTools({ dispatcher }),
    ...arrangementTools({ dispatcher }),
    ...clipTools({ dispatcher }),
    ...graphTools({ dispatcher }),
    ...performanceTools({ dispatcher, onPlay, onStop, onPanic, launcher, reel })
  ]
}

export { compact, expand }
