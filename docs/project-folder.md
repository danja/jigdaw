# A project as a folder of files that a web server could serve

**Status:** a design, written 2026-10-24 from a decision of the maintainer. Nothing here is built. The session today is one Turtle file or a
zip ([project-format.md](project-format.md), `src/host/SessionArchive.js`), and a recovery copy is bytes in IndexedDB
([pwa.md](pwa.md)). This note says what any local file storage must look like when it comes, so that it is not a format of its own.

## The decision

**Local storage holds the same files a web server would serve, linked by relative IRIs, so a project folder can be copied onto a server and
opened over HTTP unchanged.** The origin private file system, a folder the person picks with the File System Access API, a zip's contents
and a directory on a server are four places for one layout, and the code that reads a project does not know which one it is in.

## The layout

```
tide/
  session.ttl      the project, with @base set to its own folder (docs/project-format.md)
  editor.ttl       the editor graph, only when it says something
  scripts.ttl      scripts, only when there are any
  media.ttl        the manifest of every file under media/
  media/
    3f9a….wav      audio, named by the SHA-256 of its bytes
```

- **Relative links only.** A clip's `jig:source` is `media/3f9a….wav`, resolved against the document that holds it, as it is today
  (`Media.iriFor`). No absolute `file:` or origin-specific IRI is ever written, so moving the folder moves the project. The IRIs of
  plugins stay absolute: they name things that live elsewhere.
- **A manifest in Turtle, not a private index.** `media.ttl` has one resource per file, named by its relative path, saying what a client
  needs without fetching the bytes: its media type, its length in bytes, its SHA-256 (the same digest that is in its name, so a reader can
  check what it got), where it came from (`prov:` and the original file name as a label) and the sample rate and channels once decoded. It
  is its own named graph with its own provenance, as `editor.ttl` and `scripts.ttl` are, and it is regenerated from the files, never the
  only record of them. A file in `media/` that the manifest does not list is still playable; a manifest entry with no file is reported.
- **Content-addressed names.** The same recording imported twice is one file, and a name never changes meaning, so a server can cache
  forever and two projects can share a `media/` folder by relative path.
- **No new namespace.** Terms for the manifest go in `vocabs/` first (`jig:` only where `dcterms:`, `prov:` and `schema:` do not already say
  it: `dcterms:format`, `dcterms:extent` or `schema:contentSize`, and a digest term are the likely reuse). Shapes and a counterexample file
  come with the terms, as for every other document.

## What it means for the code

1. **One reader over a folder interface.** A project is read through `{ read(path) → bytes }` and written through `{ write(path, bytes) }`.
   An in-memory map (the zip, tests), the origin private file system, a picked directory and `fetch` against a base URL are four
   implementations. `ProjectReader` and `SessionArchive` already take bytes by name; the new part is the folder abstraction and the
   manifest.
2. **Over HTTP it is read-only, by the same code.** Opening `https://example.org/tide/session.ttl` fetches `session.ttl`, then what it links
   to, relative to where it came from. Writing back needs a server that accepts `PUT` (a Solid pod or an LDP container fits this layout, and
   nothing here requires one).
3. **A recovery copy and a saved project are different things in the same layout.** The recovery copy can move from one IndexedDB value to
   a folder of its own in the origin private file system (`recovery/`), with the same files. It is still never written over the project.
4. **Writes are whole-document and ordered.** Audio first, then `media.ttl`, then `session.ttl` last, so a crash part way leaves a folder
   whose session still points only at files that exist.
5. **No path from a document leaves the folder.** A relative IRI that climbs out of the base (`../`), or is absolute and not a plugin, is
   refused when reading a project from a folder or a server, the same rule `SERVED_FROM_ROOT` applies to what the site serves.

## Open questions

1. Is the manifest one file for the folder, or one `.ttl` beside each audio file? One file is simpler to fetch and to keep consistent;
   one beside each is how a server with a file listing would serve it. The first is assumed here.
2. Should `session.ttl` also say where its recovery copy was last kept? Probably not: that is the browser's, not the project's.
3. What does Save mean once a folder is open: write in place, with the zip kept as Export? It follows the File System Access decision in
   [TODO.md](../TODO.md) (recent projects), and that item is where it is decided.
