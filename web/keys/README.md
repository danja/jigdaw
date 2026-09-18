# Published signing keys

The public half of a JigDAW signing key, served at `https://strandz.it/jigdaw/keys/<name>`
as `text/turtle` with CORS, which is what `bin/verify.js --online` dereferences.

Nothing secret goes here. `bin/keys.js` refuses to write a private key anywhere inside a git
working tree, and `.gitignore` catches `**/keys/*.json` as a second lock.

To publish one:

```sh
node bin/keys.js create https://strandz.it/jigdaw/keys/danja#ed25519
node bin/keys.js publish ~/.config/jigdaw/keys/ed25519.json > web/keys/danja.ttl
```

The IRI has no file extension because the IRI is the identity and `.ttl` is a fact about a
file, and it carries a fragment so that one document can describe several keys: rotating adds
`#ed25519-2027` rather than replacing an IRI that existing signatures already name.

See [docs/plugin-bundles.md](../../docs/plugin-bundles.md) section 6.3.
