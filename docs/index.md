# JigDAW

A plugin is a URL. Dereference it and it runs in a browser, with no installation step distinct from having fetched it.

JigDAW is a plugin format native to the web. A plugin, called a Jig, is described in RDF served at its own IRI, and its
signal processing is usually WebAssembly running in an AudioWorklet. Identity, catalogue entry and delivery are one
thing instead of three.

```sh
curl -H 'Accept: text/turtle' https://strandz.it/jigdaw/plugins/cascade/
```

## Where to go

- **[Specification](host-plugin-contract.md)**: what a host guarantees and what a plugin must do. Every other normative
  document hangs off it.
- **[Guide for DAW developers](for-hosts.md)**: you are writing a host and want to load other people's plugins.
- **[Guide for plugin developers](for-plugin-authors.md)**: you have some DSP and want it loadable anywhere.
- **[Example plugins](catalogue.html)**: the worked plugins in this repository, with their generated panels.
- **[Demo](https://strandz.it/jigdaw/simple.html)**: Jiggy, the browser host, in its simple version. Pick a tune, press
  Play, change the sound.

For the longer account of what JigDAW is and why it exists, read the [overview](overview.md), or the
[maintainer's version](overview-danny.md). What has changed in the specification is in [revisions](revisions.md).
