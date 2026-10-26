# Reaper plugin management, and what Jiggy keeps

Reaper's plugin management is fast and keyboard driven. This note records what it
does, so Jiggy's plugin parts can move toward it without losing Jiggy's
routing-first model.

## What Reaper does

- A single FX browser (`Shift+F`) searches every installed plugin by name, vendor
  and category, and inserts the chosen one onto the selected track or into an
  existing FX chain at the cursor position.
- The FX chain window lists the plugins in signal order. Each row shows the
  plugin name, a bypass toggle, a wet/dry mix and a preset selector. Dragging a
  row reorders. Right-clicking a row gives move, copy, replace, remove and
  properties.
- Presets are per-plugin and per-plugin-format: a VST preset list comes from the
  plugin itself, while Reaper's own presets are stored as `.rfxchain` files that
  can hold a whole chain.
- Track templates (`.RTrackTemplate`) save a whole track, including its plugins
  and their state, for reuse. Applying one inserts a new track with everything
  in place.
- Plugins that fail to load are reported by name in the chain, not silently
  dropped, and the chain keeps playing without them.
- A plugin's UI can be floated or docked; the chain list stays usable either way.

## What Jiggy keeps

- Plugins are dereferenceable IRIs with machine-readable profiles, so the
  browser, the chain and the agent surface all read the same description. No
  per-plugin code is needed in the host.
- Every change is one Op, undoable, and goes model then compiler then engine.
  Reaper's direct edits to a running chain are not the model here.
- Editor metadata (positions, colours) stays separate from execution metadata, so
  moving a node in the editor never invalidates the compiled graph.
- Failed loads stay isolated and the previous graph keeps playing, matching
  Reaper's behaviour but enforced by the engine contract.

## Gaps to close

1. Plugin browser: a keyboard-first search over the catalogue with insert at the
   selected track or at a chosen position in an existing chain, matching
   Reaper's FX browser.
2. FX chain window: per-plugin bypass, wet/dry where the profile supports it,
   preset selector, and drag reorder that already exists in the chain strip.
3. Presets: save and recall a plugin's state as a named preset, and save a
   whole chain as a reusable template (track template).
4. Failed-load reporting: already present in the chain strip and FxList; keep it
   consistent across every surface.
5. Floated or docked plugin UI: the cross-origin frame is already isolated; a
   docked mode beside the chain list is the open part.

## Order of work

Browser first, then chain window additions, then presets, then templates. Each
step is one Op and ships with tests binding the new behaviour to the existing
model.
