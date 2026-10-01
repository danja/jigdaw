# The layout of the main view

**Status:** written 2026-10-01, after the view was built. The layout below is what the code does. The reasons
and the rejected alternatives were worked out now from the code and the project's rules, not recovered from the
time, so read them as the case for the layout and not as a record of a meeting.

The main view is one screen with five parts: a transport bar across the top, a plugin browser down the left, a
header column and a lane area for the tracks, a dock under the lanes for whatever is selected, and a row of tabs
that swaps the arrangement for the plugin rack, the routing matrix, the mixer and the script. Each part is
built by one module in `src/ui/`, so the layout can change without the parts changing.

## What was decided

- **A header column and a lane area share one vertical scroll.** The header holds a track's name, level, pan,
  mute, solo and arm. The lane holds its clips. They scroll together because a person reads across a row, and
  they scroll apart horizontally because the header never moves ([Timeline.js](../src/ui/Timeline.js)).
- **The editor for the selection lives in a dock under the lanes.** A piano roll, an audio clip panel or a
  track's chain opens there and the lanes stay visible above it, so the clip being edited and its place in the
  arrangement are on screen together. A splitter sets its height from the keyboard as well as the pointer
  ([Dock.js](../src/ui/Dock.js)).
- **The browser is a side column, closable.** Searching for a plugin and loading one is something a person does
  between edits, so it sits beside the tracks and a visible "Load onto" says where a plugin will land.
- **The transport is a bar across the top.** It is the one control needed from every tab, so it is outside them.
- **Tabs swap the stage for the other views.** Routing, mixer and script are whole-screen views that do not
  need the lanes. The tab row is allowed to wrap, so it cannot scroll the page sideways. The phone padding was set for four tabs, and no one has measured it with the fifth, the Script tab.
- **One column below 760px.** The browser stacks above the stage, the header narrows, and the transport scrolls
  away with the page instead of staying fixed, since wrapped onto several rows it is a third of a phone's height.

## Alternatives, and why not

- **The mixer as a panel docked under the arrangement, as Reaper does.** Keeps level and pan beside the clips
  without a tab switch. Not taken because the track header already carries level, pan, mute and solo, so a
  second strip would show the same controls twice; and the mixer's wider strips (inserts, sends, meters) need a
  width a phone does not have. This is the main open question: [INBOX](../INBOX.md) asks for the arrangement and
  mixer to follow Reaper where possible, and the cost of a docked mixer should be weighed against the tab.
- **Track headers inside the lanes, scrolling sideways with them.** Simpler to build. Rejected because the name
  and the mute of a track would scroll out of view exactly when the arrangement is long, which is when they are
  needed.
- **Floating plugin and clip editors.** Familiar from desktop hosts. Rejected for the rack, because a floating
  window is a second place keyboard focus can be lost and a window cannot be laid out at phone width. A
  plugin's own interface is still a sandboxed frame, and that is a different thing.
- **The browser as a modal or a drawer over the stage.** Saves the 240px. Rejected because adding several
  plugins in a row is common, and a drawer that covers the tracks hides the result of each load.
- **The transport in the dock or in each tab.** Rejected: play and stop must not depend on which tab is open.
- **Separate pages for the arrangement and the mixer.** Rejected: both read one model and one selection, and a
  second page is a second copy of that state to keep in step.

## What this leaves open

- Whether the mixer is a dock or a page ([TODO](../TODO.md), T6), and how close to Reaper's it should be.
- The three tabs the main view is meant to replace: the plugin rack stays as the dock's chain view, and the
  routing matrix needs a decision.
- Measurement at phone width exists for the lanes and the header. It has not been repeated for each new view,
  and the rule in [CLAUDE.md](../CLAUDE.md) is one measured check per view in a real browser.
