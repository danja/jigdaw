// src/host/HostConfig.js
//
// The page's own settings, read from web/host.json.
//
// Every key is required. CLAUDE.md: a value not retrieved from config is an
// error to fix, not a default to fall back on, because a default written into
// the code is a second place the value lives and the two drift. So a missing
// or malformed key throws, naming the key, and the page says so rather than
// running on a number nobody chose.

/** Each key, and what it must be. */
export const HOST_CONFIG_KEYS = Object.freeze({
  // Plugin payloads relayed per second, in each direction, between a plugin's
  // own interface and its processor (docs/messaging.md 2.4).
  relayPerSecond: 'a whole number of messages per second, at least 1',
  // How far ahead of the audio clock the clip scheduler sends notes, and how
  // often it looks. The lookahead must comfortably exceed the tick, or a
  // late timer leaves a gap nothing was scheduled into. src/engine/Scheduler.js.
  schedulerLookaheadMs: 'a whole number of milliseconds, at least 1',
  schedulerTickMs: 'a whole number of milliseconds, at least 1',
  // The local MCP bridge (bin/mcp-bridge.js), which reads this same file: the
  // loopback port it listens on and the page connects to, and how long a tool
  // call waits for the page. A plugin load can take seconds.
  bridgePort: 'a TCP port, 1 to 65535',
  bridgeCallTimeoutMs: 'a whole number of milliseconds, at least 1',
  // Delay each track by however much less latency it has than the slowest, so
  // parallel tracks arrive together (docs/latency.md, "Between tracks"). This is
  // the starting value; a person can change it on the Mixer tab, and that choice
  // is remembered in their browser and wins over this file.
  alignTracks: 'true or false',
  // The longest delay a track can be given to align it, which is the largest
  // latency difference between two tracks the page can put right.
  maxTrackDelayMs: 'a whole number of milliseconds, at least 1',
  // How long a piece carried from one page to the other (src/host/Handoff.js) is offered. After this it is
  // forgotten, so a piece left over from last week is not offered as if it were what was just open.
  handoffMinutes: 'a whole number of minutes, at least 1'
})

const BOOLEAN_KEYS = new Set(['alignTracks'])

/** Check a parsed web/host.json and return the settings, frozen. */
export function readHostConfig (json) {
  if (!json || typeof json !== 'object') throw new Error('web/host.json is not a JSON object')
  const settings = {}
  for (const [key, what] of Object.entries(HOST_CONFIG_KEYS)) {
    const value = json[key]
    if (value === undefined) throw new Error(`web/host.json has no ${key}: it must be ${what}`)
    if (BOOLEAN_KEYS.has(key)) {
      if (typeof value !== 'boolean') throw new Error(`web/host.json ${key} is ${JSON.stringify(value)}: it must be ${what}`)
      settings[key] = value
      continue
    }
    if (!Number.isInteger(value) || value < 1) throw new Error(`web/host.json ${key} is ${JSON.stringify(value)}: it must be ${what}`)
    settings[key] = value
  }
  if (settings.bridgePort > 65535) throw new Error(`web/host.json bridgePort is ${settings.bridgePort}: it must be ${HOST_CONFIG_KEYS.bridgePort}`)
  if (settings.schedulerLookaheadMs <= settings.schedulerTickMs) {
    throw new Error(`web/host.json schedulerLookaheadMs (${settings.schedulerLookaheadMs}) must exceed schedulerTickMs ` +
      `(${settings.schedulerTickMs}), or a tick that runs late leaves a gap no note was scheduled into`)
  }
  return Object.freeze(settings)
}
