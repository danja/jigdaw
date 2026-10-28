---
name: finish-plugin
description: Finish a Jig plugin so the repository agrees with it. Use when a plugin was just scaffolded with /new-plugin, when a WebAssembly plugin that /new-plugin declines to scaffold was hand-built, or when a plugin's ports, module, processor, skin or editor changed, before calling it done. Covers the three places a parameter is named, the digest rebuild, the index, the document figures a new plugin falsifies, the checks, and what each one proves.
---

# Finishing a plugin

[CLAUDE.md](../../../CLAUDE.md) says it plainly: "A new plugin changes counts in several places", and "a change in one file usually
needs a second file to change with it, and nothing connects them". `/new-plugin` (`.claude/commands/new-plugin.md`) scaffolds a
plain-JavaScript plugin and runs it through validate, the index and a host test. This is what a plugin still owes after that, or
instead of that when it has a WebAssembly module. Start by writing down which tests fail **before** you change anything, so you can
tell yours from the ones that were already failing.

## 1. A parameter is named in three places

A port's `lv2:symbol` and `jig:paramIndex` live in `plugins/<name>/profile.json`, in the processor's `parameterDescriptors` (and the
table that maps names to indexes), and, for a module, in the module's own index. They must agree, and a symbol is what automation
and saved sessions key on, so it never changes without being treated as a new parameter (contract section 5.1).

What binds them is a test, not review: `tests/host/<name>.test.js` for any plugin, and `tests/dsp/<name>.test.js` for a module driven
directly (see `tests/dsp/dynamix.test.js`, "agrees with the processor about its parameters"). Add the symbol to all three, then run
those two files. If you wrote a plugin with no such test, write it: a test that two lists match is worth more than either being
carefully reviewed.

## 2. Rebuild, which writes the digests

```sh
bash plugins/<name>/build.sh
```

`bin/write-profile.js` generates `profile.ttl` from `profile.json` and the digest of every file as it is on disk. Run it after **any**
change to the module, the processor, a skin or an editor: a stale digest is a plugin the host refuses. Never edit `profile.ttl`.
For a module that declares an ABI, `node bin/check-wasm-abi.js plugins/<name>/<name>.wasm` checks its imports against
[docs/module-abi.md](../../../docs/module-abi.md).

## 3. The index and the collection

```sh
npm run build:index
```

It rewrites `plugins/index.json` and `web/collections/jigdaw.ttl` from the profiles on disk. There is no registry to edit: a plugin
exists by having a `profile.ttl`. The catalogue tests (`tests/catalogue/`) check both generated files against the directory.

## 4. The figures a new plugin falsifies

`tests/docs/conventions.test.js` counts the directories that hold a `profile.ttl` and fails any markdown file that says a
different number of "worked plugins". It reads line by line and skips `MISTAKES.md` and `docs/revisions.md`, which record what was
true when written.

It does **not** bind every phrasing, and it cannot see a figure that wraps across two lines:

- "36 plugins" and similar, without "worked" (`docs/jiggy-features.md`, `docs/usp.md`), are not matched. Search for them yourself.
- A figure at the end of a line with "worked plugins" at the start of the next is not matched. `CLAUDE.md` has one of these and it
  is stale. It is the maintainer's file: tell them, do not edit it.

Take the figure from the repository, never from memory: count directories with a `profile.ttl`.

## 5. The interface

A plugin with no skin gets a generated panel from its ports, which is the expected case and needs nothing. Per port, `comment` is one
plain sentence shown as help on hover and focus and read by a screen reader, and `displayPriority` ranks which controls the generated
panel shows first (`bin/write-profile.js` writes both). Decide whether the plugin wants more, and which kind:

- Many controls and labels only: an HTML skin, with the `html-skin` skill.
- A curve, a pad, a meter, a plot: a `jig:ui`, see [docs/plugin-ui.md](../../../docs/plugin-ui.md).
- Neither: leave it.

[docs/ui.md](../../../docs/ui.md) says how to choose.

## 6. Check it

```sh
npm run validate -- plugins/<name>/profile.ttl
npm run check-plugin -- --root https://strandz.it/jigdaw/plugins/<name>/=plugins/<name> https://strandz.it/jigdaw/plugins/<name>/
npx vitest run tests/host/<name>.test.js tests/docs tests/catalogue
npm test
```

What each proves, and does not:

- `validate` checks the profile against the shapes. It says nothing about whether the code works.
- `check-plugin` renders the plugin headless through the real host path and reports whether it **made sound**, stayed within a bound,
  and, for an instrument given notes, responded to them. This is what a module needs that validation cannot say. For an instrument pass
  notes (`--note 69@0:1`). Timing is diagnostic only, since machines differ: record figures, do not assert them.
- `npm test` must move the test count by the number you added. If it did not, your suite did not run. Read the `Test Files` line and the
  exit code, not only the `Tests` count, since a file that cannot be parsed runs nothing and prints none of the failure markers.
- Compare the failures with the list you wrote down at the start.

Then look at it in a browser, with the `browser-check` skill. It cannot show sound. Say "sound not heard" if you did not hear it, and
rely on `check-plugin` for whether audio was produced.

## 7. Documents, and what to leave alone

- Per-plugin documentation is optional (a `plugins/<name>/README.md`, and design notes under `docs/plugins/`, which have no page of their
  own on the site). The plugin list sentences in `README.md` and the docs that name plugins may want the new one.
- A catalogue screenshot exists only if `web/gallery/shots/<name>.png` does, and the catalogue page lists only those that do. **Do not run
  `npm run build:gallery` to make one**: it retakes every shot and rewrites every panel page (it once regrew 69 tracked files from what
  was meant to be a look at the options). Ask first.
- Do not run any `git` operation. Before creating a file, list the directory it is going into.
- Log a mistake you made in `MISTAKES.md`, newest first: what happened, root cause, prevention.

## 8. Done when

The three places agree and their tests pass; `build.sh` was run after the last change; `npm run build:index` was run; the figures in the
documents are right, including the ones the test does not see; `validate` and `check-plugin` pass; the suite moved by what you added and
the only failures are ones that were already there; and you have said what you did not check (sound, touch, a screen reader).
