# Mistakes

What happened, root cause, prevention. Newest first. A lesson that applies beyond its one
instance is promoted to [CLAUDE.md](CLAUDE.md) ("Lessons kept from the mistakes log") and its
entry is removed from here; a fix held by a test alone is dropped. Cleared on 2026-10-12 from a
346 line file, and everything it held is in CLAUDE.md.

## 2026-10-21: Add track threw in an empty session

**What happened.** The new `onAddTrack` in `web/app/Arrangement.js` called `edit()`, which reads
`ctx.dispatcher`. That is null until `ctx.runtime.ensureRunning()` has run, which is on the first plugin
load. Every other arrangement handler needs a track, so a dispatcher already exists; this was the first
reachable with none. Both clicks threw `Cannot read properties of null (reading 'apply')` and nothing
happened. 800 unit tests passed, because they hand the toolbar a recorded handler and never build the page.

**Root cause.** A handler wired into a page that can be in a state the others cannot: no session started.
Found by clicking it in Chrome on an empty page.

**Prevention.** A handler reachable with no tracks awaits `ensureRunning()` first. Nothing checks it, since
no test builds `createArrangement` with a null dispatcher; a click in a fresh page is the check.
