// src/ui/AssetText.js
//
// Fill a panel's text areas with what the plugin has actually loaded. The processor holds the text, and it is also what a
// state request returns under the asset's key (messaging.md section 1.3), so that is where the panel reads it from, and it
// is read again after an Apply: a surface shows what it is told (messaging.md section 2.3), never what it sent.
const decoder = new TextDecoder()

/** Ask the node for its state and show each `text/plain` asset's bytes as text. Nothing to show is not an error. */
export async function showAssetText (panel, profile, dispatcher, nodeId) {
  const keys = (profile.assets ?? []).filter(a => a.userReplaceable && a.mediaType === 'text/plain').map(a => a.iri.split('#').pop())
  if (keys.length === 0) return
  const state = await dispatcher.getNodeState(nodeId)
  for (const key of keys) {
    if (state?.[key] instanceof ArrayBuffer) panel.setAssetText(key, decoder.decode(state[key]))
  }
}
