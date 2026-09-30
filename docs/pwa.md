# Jiggy as an installable app

**Status:** a design note, and the shell it describes (manifest, icons, service worker, update
and install notices) and a first version of the simple front page are built. One-button microphone recording is built too. The export button is not.

Jiggy is a web page, so installing it is a manifest and a service worker. This note records the
decisions that were not obvious, and one that was forced on us.

## One service worker, not two

A page has one service worker per scope, and registering a second script at the same scope
replaces the first. Jiggy already has one: `web/foreign/sw.js` serves the container a foreign
plugin runs from (contract section 12.3), at scope `/`. An app worker registered beside it would
silently remove it the first time either registered, and every foreign plugin would stop loading
with an error that names nothing.

So there is one registration, `web/sw.js`. It pulls the container worker in with
`importScripts('foreign/sw.js')`, unchanged, and adds its own listeners. Two `fetch` listeners
can coexist as long as only one of them answers a request, and the app listener never answers a
request under the container's prefix.

The property that makes the container a boundary, that its worker never calls `fetch`, still
holds for `web/foreign/sw.js` and is still asserted on that file's source. The app worker does
call `fetch`, for paths outside the prefix only.

`ForeignOrigin` registers `/sw.js`, the same script the page registers, so both routes land on
one registration.

## What is cached, and how

- **The shell is precached.** The page, the bundle, `host.json`, the manifest and icons, the
  shapes, and the bundled presets. `bin/build-precache.js` writes `web/precache.js` with a
  content hash of each file and a version that is the hash of all of them, and a test fails when
  the committed file is stale. A new version is a new cache; the old one is deleted on activate.
- **Everything else on the same origin is network first.** A successful GET is kept, and offline
  the kept copy is served. Plugins are covered by this, so a plugin opened once works offline.
- **Never cached:** anything that is not a GET, any URL with a query (the catalogue and search
  endpoints), and any response that is not a plain 200, which keeps out the partial responses a
  range request gets.
- **Content negotiation.** A plugin's IRI answers Turtle, JSON-LD or HTML from one URL by the
  `Accept` header. The cache is keyed by the URL and the `Accept` value together, so a copy of
  the Turtle is never handed to a request for the page.

## Integrity is not the worker's job, and the worker must not get in its way

Every plugin resource is checked against its digest by the host when it is instantiated, whether
it came from the network or from the cache. The worker passes each request on with
`fetch(event.request)`, so a request made with an `integrity` attribute keeps it, and a cached
response given to such a request is still checked by the browser. A cached copy that has been
altered fails the digest and the plugin fails to load, which is what should happen. This is
checked by a test that alters a cached file.

## Updating

A new worker activates without waiting, because the container worker already asks for that.
Nothing reloads the page: the running page keeps the bundle it has, and a notice says a new
version is ready and will be used the next time the page is opened. A page never reloads under
a piece that is playing.

## Install

The browser's install offer is kept and shown as an Install button, which the person can ignore.
It is not offered by a dialog and it is not offered before the page has finished loading.

## Where it is served

The manifest uses `./` for `start_url` and `scope`, and the app worker registers with a URL
relative to the page, so the same files work at the root of a host and under a path such as
`strandz.it/jigdaw/`.

**The container worker's paths.** They were absolute, written for a root deployment:
`ForeignOrigin` registered `/sw.js` at scope `/` and `web/foreign/sw.js` answered under
`/foreign/`. Under `/jigdaw/` behind nginx those paths were outside the app, so a foreign plugin
could not have loaded there. Both are now derived from where the worker is registered and from the
page's base: the prefix is `new URL('foreign/', registration.scope).pathname`, and `ForeignOrigin`
registers `sw.js` next to the page with no explicit scope. At the root nothing changes (the prefix
is still `/foreign/`); under a path it is `/jigdaw/foreign/`. A test loads the real worker at both
scopes, installs a container and fetches from it, and fails if either file goes back to a path
written for the root.

## What was checked in a browser

With the window in front, on `127.0.0.1`:

- The worker registers, activates and controls the page, and the browser offers the install
  (the Install button appears).
- With the server stopped, the page loads from the cache, the presets list and a preset file
  are read from it, and the Chiptune preset opens and plays: all ten plugins and their
  WebAssembly come from the cache, and the meter moves.
- A cached WebAssembly file was altered by one byte. Opening the preset then failed those two
  plugins with `integrity mismatch` and loaded the other eight: the digest is checked on cached
  bytes exactly as on fetched ones.
- Served under a path, through a small proxy that strips `/jigdaw/` the way the nginx location
  does: one registration at `/jigdaw/` with script `/jigdaw/sw.js` controlled the page, and
  `ForeignOrigin.start()` joined that same registration and did not add another. A container
  installed through it was served at `/jigdaw/foreign/<id>/index.js` (200), a file it does not hold
  was refused (404), and the old absolute path answered nothing.
- Changing a shell file and rebuilding the precache produced a new cache version, removed the old
  one and showed the "new version is ready" notice without reloading the page.

Not checked: an install on a phone, a real offline network rather than a stopped server, and
`iOS`, which ignores much of the manifest.

## Still to do

- **The simple front page** (`web/simple.html`, built). One codebase with a second entry page over the same Ops is the
  recommendation: the arrangement view is not compromised by the simple one, and a fix to the
  dispatcher reaches both. A simple mode inside the current page was rejected because every
  control of the DAW would then have to be hidden by a flag.
- **Export.** The Export button is the in-page bounce and encoder of Phase E in TODO.md; the app
  gets no renderer of its own.
- **Recovery.** Offline use of a session, and the origin private file system as its store, is
  Phase F.
