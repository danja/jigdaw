// src/catalogue/PluginDirectories.js
//
// Which directories under plugins/ are actually a plugin: the ones with a
// profile.ttl. plugins/_jsfx-runtime/ is the shared bytecode VM every
// converted JSFX plugin's own directory copies from (see src/jsfx/), not a
// plugin itself, and has none.
//
// bin/build-plugin-index.js, and every test that independently re-derives the
// plugin list to check the generated index against it, walk plugins/ the same
// way by calling this rather than repeating the rule at each call site. A
// second, slightly different readdir loop is exactly the shape of bug AGENTS.md
// warns about: the population the generator walks and the population a test
// checks it against silently drifting apart.
import { readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Names of the plugin directories under `pluginsRoot`, sorted. */
export async function pluginDirs (pluginsRoot) {
  const found = []
  for (const entry of await readdir(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!existsSync(join(pluginsRoot, entry.name, 'profile.ttl'))) continue
    found.push(entry.name)
  }
  return found.sort()
}
