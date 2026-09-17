# Serving the namespace

**Version:** 0.1.0-draft
**Status:** normative for what the namespace serves. The deployment is an operational
decision recorded here because it is nearly made already.

JigDAW's premise is that a significant component is identified by an IRI and that the IRI
dereferences. The vocabulary is a significant component, so the same rule applies to it.
A project that tells plugin authors to publish dereferenceable IRIs and does not dereference
its own has an argument it has not taken seriously.

## What is already true

`purl.org/stuff` is under our control, and measured on 2026-09-16 it behaves like this:

| Request | Lands on | Result |
|---|---|---|
| `purl.org/stuff/plugin-universe/` | `plugin-universe.com/ns/plugin-universe.ttl` | 200, `text/turtle`, 32673 bytes |
| `purl.org/stuff/jigdaw/` | `hyperdata.it/xmlns/jigdaw/` | 404 |
| `purl.org/stuff/valis/` | `hyperdata.it/xmlns/valis/` | 404 |
| `purl.org/stuff/transmissions/` | `hyperdata.it/xmlns/transmissions/` | 404 |
| `hyperdata.it/xmlns/` | itself | 200 |

So there is a wildcard rule mapping `purl.org/stuff/<name>` to
`hyperdata.it/xmlns/<name>`, and `plugin-universe` has a specific override on top of it that
points at its own site.

The configuration that serves this is `deploy/nginx/vocab.conf`, and the files it serves are
generated into `deploy/vocab/` by `npm run build:vocab`. Both are validated by
`deploy/nginx/check.sh`, and a test fails if the deployed copy of the vocabulary drifts from
`vocabs/jigdaw.ttl`. The runbook is `HUMANS.md` item 2.

**JigDAW needs no PURL administration.** `http://purl.org/stuff/jigdaw/` already resolves to
`https://hyperdata.it/xmlns/jigdaw/`. Putting the vocabulary there is the whole job. A
specific override to a jigdaw.org, were there ever one, would be an optimisation and not a
requirement.

## What the namespace must serve

**The namespace IRI**, `http://purl.org/stuff/jigdaw/`, MUST serve the vocabulary,
content-negotiated:

| `Accept` | Response |
|---|---|
| `text/turtle` | `vocabs/jigdaw.ttl` |
| `application/ld+json` | the same vocabulary as JSON-LD |
| `text/html` | a page a person can read |

`text/html` is the default when no preference is expressed, so pasting the namespace into a
browser shows something useful rather than downloading a file.

**Each term**, such as `http://purl.org/stuff/jigdaw/module`, MUST resolve. This is a slash
namespace, so each term is a distinct IRI and a server sees the request. It MUST answer
`303 See Other` to the vocabulary document, following
[Best Practice Recipes for Publishing RDF Vocabularies](https://www.w3.org/TR/swbp-vocab-pub/)
recipe 3.

303 rather than 200 because the term denotes a property or a class, not a document, and
answering 200 would assert that the thing identified is the page returned. It is the one
place where the distinction has a practical consequence, because a reasoner that conflates
the two starts inferring that a property is a document.

Serving the vocabulary with `Access-Control-Allow-Origin` is REQUIRED, for the same reason
it is required of a plugin profile: a browser fetching it cross-origin cannot read a
response without it.

## The gap this exposes

Individual terms dereference for nobody in this family today.
`purl.org/stuff/plugin-universe/supportedPlatform` redirects to
`plugin-universe.com/supportedPlatform` and returns 404, because the override is a prefix
replacement that maps the namespace root correctly and everything below it to the site root.

More seriously, **`trn:` does not dereference at all.** It is the vocabulary all four
projects share and the one JigDAW's profile format is built on, and every IRI in it is a
dead link. `purl.org/stuff/transmissions/` has landed on a 404 for as long as anyone has
been publishing profiles that use it.

That is not a JigDAW defect and it is not JigDAW's to fix unilaterally, but it is worth
stating plainly: profiles published by four projects, and by third parties following the
published guide, identify their roles and signal types with IRIs that resolve to nothing.
See `TODO.md`.

## Where things are served

Two different questions, often confused, and the answer is different for each.

**The vocabulary** is served at `https://hyperdata.it/xmlns/jigdaw/`, which is where the
existing PURL wildcard already points. It needs no PURL administration, and nothing about it
should move to an application host: a vocabulary outlives the applications that use it.

**Plugins and the DAW** are served from `strandz.it`, on the same host as `hyperdata.it` and
`plugin-universe.com`. Plugin IRIs mint under `https://strandz.it/jigdaw/plugins/`.

That is an application host rather than a PURL, which is a deliberate difference from the
vocabulary and from plugin-universe's catalogue IRIs. A plugin IRI is a retrieval address as
well as a name: it has to resolve to the code. Putting it behind a PURL would add a redirect
to every fetch of every resource for no gain, because the profile already separates identity
from retrieval (see the rebasing rule in `docs/plugin-profiles.md`): a plugin mirrored
anywhere keeps its canonical IRI and is fetched from wherever it was found.

## Never mint under the serving domain

An IRI in JigDAW's own vocabulary MUST be minted under `http://purl.org/stuff/jigdaw/` and
never under whatever host currently serves it.

The PURL is the identity and the host is an implementation detail. Minting under the serving
domain means that moving the site breaks every IRI ever published, including those written
into other people's project files, which cannot be corrected by us. This rule is
plugin-universe's and it is the reason its plugin IRIs survive a change of domain.

## Dereferencing it from a browser needs the https form

Measured 2026-09-17, following the redirects as a browser does:

| Hop | Status | `Access-Control-Allow-Origin` |
|---|---|---|
| `http://purl.org/stuff/jigdaw/` | 302 | **absent** |
| `https://purl.org/stuff/jigdaw/` | 307 | `*` |
| `https://purl.archive.org/stuff/jigdaw/` | 302 | `*` |
| `https://hyperdata.it/xmlns/jigdaw/` | 200 | `*` |

Only the opening hop is a problem, and it is enough to stop the fetch: a CORS request must
pass the check on **every** response in a redirect chain, not only the last. From a page
served over `https:` it fails earlier still, because `http:` is mixed content and never
leaves the browser.

So a browser based consumer MUST dereference `https://purl.org/stuff/jigdaw/`. Everything
from that hop onward carries the header and the vocabulary answers correctly.

**This does not change what the IRIs are.** They are minted on `http:` because that is the
identifier, and it is what the sibling projects do. An identifier is not a fetch instruction,
and `http://purl.org/stuff/jigdaw/abi` and `https://purl.org/stuff/jigdaw/abi` are different
IRIs that must not be used interchangeably in data.

It is written down because the project tells plugin authors to dereference these IRIs, and an
author who does it the obvious way from a web page gets a network error and reasonably
concludes the vocabulary is broken. It is not: `purl.org` does not send the header on its
plain `http:` redirect, and that hop is not ours to change.
