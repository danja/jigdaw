// bin/keys.js
//
// The signing key for a plugin author: make one, keep it somewhere it will not
// be committed, and hand it to bin/bundle.js.
//
// A private key is the one thing in this repository that would be a real
// incident rather than a bug, and AGENTS.md says a scanner cannot tell an
// invented fixture from a live credential. So two rules are enforced here
// rather than written down and hoped for: a key file is refused if its path is
// inside a git working tree, and it is written with owner-only permissions.
// Tests generate their keys in memory and none is ever committed.
//
// The public half is not secret. It is meant to be published at the IRI the
// proofs name, which is what turns a signature from self consistent into
// attributable. `bin/keys.js publish` prints that document.
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, join, dirname } from 'node:path'
import { generateKeyPair, exportPrivateKey, importPrivateKey } from '../src/host/Signature.js'
import { SEC } from '../src/rdf/Vocabulary.js'

export const DEFAULT_DIRECTORY = join(homedir(), '.config', 'jigdaw', 'keys')

/** True when `path` sits inside a git working tree, at any depth above it. */
export function insideGitTree (path) {
  let at = resolve(path)
  for (;;) {
    if (existsSync(join(at, '.git'))) return at
    const up = dirname(at)
    if (up === at) return null
    at = up
  }
}

/**
 * Write a new key pair, refusing a location a commit could reach.
 *
 * The refusal is the point. Writing a private key next to the plugin it signs
 * is the obvious thing to do and is how it ends up in a public repository.
 */
export async function createKeyFile (path, verificationMethod) {
  if (!verificationMethod) {
    throw new Error('a key needs the IRI it will be published at, so that a proof can name it')
  }
  const tree = insideGitTree(dirname(resolve(path)))
  if (tree) {
    throw new Error(
      `refusing to write a private key to ${resolve(path)}, which is inside the git working ` +
      `tree at ${tree}. Put it somewhere a commit cannot reach it, such as ${DEFAULT_DIRECTORY}.`
    )
  }
  if (existsSync(resolve(path))) {
    throw new Error(`${resolve(path)} already exists. Refusing to overwrite a key.`)
  }

  const pair = await generateKeyPair()
  const file = {
    jigdawKey: 1,
    verificationMethod,
    publicKeyMultibase: pair.publicKeyMultibase,
    privateKeyMultibase: await exportPrivateKey(pair.privateKey)
  }
  await mkdir(dirname(resolve(path)), { recursive: true })
  await writeFile(resolve(path), JSON.stringify(file, null, 2) + '\n')
  await chmod(resolve(path), 0o600)
  return file
}

/** A key file as something bin/bundle.js can sign with. */
export async function loadSigner (path) {
  const file = JSON.parse(await readFile(resolve(path), 'utf8'))
  for (const field of ['verificationMethod', 'publicKeyMultibase', 'privateKeyMultibase']) {
    if (!file[field]) throw new Error(`${path} is not a JigDAW key file: no ${field}`)
  }
  return {
    verificationMethod: file.verificationMethod,
    publicKeyMultibase: file.publicKeyMultibase,
    privateKey: await importPrivateKey(file.privateKeyMultibase)
  }
}

/**
 * The public half, as the document to serve at the verification method IRI.
 *
 * A verifier that dereferences it is checking the key against the authority
 * that published it, which is the difference between a signature that is self
 * consistent and one that is attributable.
 */
export function publicKeyDocument ({ verificationMethod, publicKeyMultibase }) {
  return [
    `# ${verificationMethod}`,
    '#',
    '# The public half of a JigDAW signing key. Serve this at the IRI above,',
    '# as text/turtle, with Access-Control-Allow-Origin: * so a browser can',
    '# read it. Nothing here is secret.',
    '',
    `@prefix sec: <${SEC}> .`,
    '',
    `<${verificationMethod}>`,
    '    a sec:Multikey ;',
    `    sec:publicKeyMultibase ${JSON.stringify(publicKeyMultibase)} .`,
    ''
  ].join('\n')
}

// ── Command line ───────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...rest] = process.argv.slice(2)
  const usage = [
    'usage:',
    '  node bin/keys.js create <verification-method-iri> [key-file]',
    '  node bin/keys.js publish <key-file>',
    '',
    `The verification method IRI is where you will serve the public key. A key file`,
    `defaults to ${join(DEFAULT_DIRECTORY, '<name>.json')} and must not be inside a repository.`
  ].join('\n')

  try {
    if (command === 'create') {
      const [method, given] = rest
      if (!method) throw new Error(usage)
      const name = (method.split(/[#/]/).filter(Boolean).pop() ?? 'jigdaw').replace(/[^\w.-]/g, '_')
      const path = given ?? join(DEFAULT_DIRECTORY, `${name}.json`)
      const file = await createKeyFile(path, method)
      console.log(`key written to ${resolve(path)}, owner readable only. Do not commit it.`)
      console.log('')
      console.log(`Serve this at ${method}:`)
      console.log('')
      console.log(publicKeyDocument(file))
    } else if (command === 'publish') {
      const [path] = rest
      if (!path) throw new Error(usage)
      const file = JSON.parse(await readFile(resolve(path), 'utf8'))
      console.log(publicKeyDocument(file))
    } else {
      throw new Error(usage)
    }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
