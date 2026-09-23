// src/ui/Presets.js
//
// The bundled presets. web/presets/index.json names each file and its label,
// so the menu is drawn from one small request: a preset can embed its
// plugins' state, audio included, and the page must not download all of them
// to show a list. The label is therefore in two places, the index and the
// file's own rdfs:label, and tests/ui/Presets.test.js holds them together.

async function fetchOk (fetch, url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  return response
}

/** The menu: `[{ url, label }]` in index order, from the index alone. */
export async function listPresets ({ fetch, index }) {
  const { presets } = await (await fetchOk(fetch, index)).json()
  return presets.map(({ file, label }) => {
    if (!file || !label) throw new Error(`${index}: every preset needs a file and a label`)
    return { url: new URL(file, index).href, label }
  })
}

/** One preset's Turtle, fetched when it is opened rather than when listed. */
export async function fetchPreset ({ fetch, url }) {
  return (await fetchOk(fetch, url)).text()
}
