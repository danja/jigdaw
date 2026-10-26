# Collaboration: several people in one session

**Status:** a design, written 2026-10-26. Nothing here is built. It answers the "Live collaboration" and "Sync between
instances" items in TODO.md, which both asked for a note before any code. The session today is one Turtle file or a zip
([project-format.md](project-format.md)) held by one page, and the only editor besides the person is an agent going through the same
dispatcher ([webmcp.md](webmcp.md)).

## The decision

**The session graph stays the definition of the model and the save format. A CRDT carries it between replicas, through a mapping that
is derived from the shapes and written down here.** Two people, or a person and an agent in another page, each hold a replica of the
project. An edit made on one reaches the others in any order, and every replica ends up with the same session without a server
deciding who was right.

Three things follow, and the rest of this note works them out.

1. **RDF is the meaning, not the wire.** Peers exchange CRDT updates, not Turtle and not triples. A file saved by any peer is the
   ordinary `session.ttl` of [project-format.md](project-format.md), readable by a host that has never heard of collaboration.
2. **The mapping is a table, and the table is checked against `vocabs/shapes.ttl`.** Which merge rule a property gets is
   decided by what the shapes already say about it, so the vocabulary and the merge rules cannot drift apart unnoticed.
3. **The CRDT library is replaceable.** Everything above it talks to a small interface (a replica that takes local changes and remote
   updates). Yjs is the first implementation. Swapping it changes one module.

## What exists for CRDTs over RDF

**There is prior art, none of it is a library we can drop into a browser DAW, and the useful part is the idea, not the code.**

- [SU-Set](https://inderscience.com/offers.php?id=56605) is a CRDT for RDF graphs changed by SPARQL Update, aimed at keeping
  semantic stores in sync. [Co-evolution of RDF Datasets](https://arxiv.org/pdf/1601.05270) is in the same line.
- [crdf](https://docs.rs/crdf/) is a Rust crate that holds an RDF graph as an operation-based graph CRDT, one vertex per term and one
  edge per triple.
- [m-ld](https://m-ld.org) and [NextGraph](https://nextgraph.org) are projects that replicate RDF between peers. We have not
  evaluated either, and they are the first places to look before building anything beyond step 4 below.
- A W3C community group on CRDTs for RDF started in October 2024
  ([list archive](https://lists.w3.org/Archives/Public/public-treecg/2024Oct/0004.html)). We have not checked whether it has
  published anything normative.
- [A Solid demo at ISWC 2023](https://ceur-ws.org/Vol-3632/ISWC2023_paper_495.pdf) puts CRDTs in Solid pods and adds hypermedia
  controls so a client can find the collaboration interface.
- For background on the data types themselves: [Conflict-free Replicated Data Types: An Overview](https://arxiv.org/pdf/1806.10254).

**A CRDT over raw triples is the wrong grain for this project.** The triple-set designs track every quad, add a tombstone for every
removal, and treat all properties alike. Our graph is nothing like an arbitrary graph, and that is the lever. It has no blank nodes
and no `rdf:List`; every addressable thing is a resource with its own IRI; topology is explicit arcs with named ports; and nearly
every property is single valued (a node has one label, a parameter one value). That is a map of maps, and the mature CRDT
libraries are strongest at exactly that shape.

## Why Yjs for the first implementation

**[Yjs](https://yjs.dev) already provides the parts we would otherwise write and get wrong:** nested maps with last-writer-wins
values, a binary update format that merges in any order and any number of times, garbage collection, an awareness channel for
presence, an undo manager that undoes only the local peer's edits, and providers for `BroadcastChannel`, WebRTC and WebSocket.

The alternatives were weighed and not chosen:

| Option | Why not first |
|---|---|
| Automerge or Loro | Both fit the map-of-maps shape. Neither has Yjs's provider and awareness ecosystem for the browser. Either could sit behind the same interface later. |
| A hand-written RDF CRDT (a last-writer-wins register per subject and predicate, an add-wins set per resource) | It is small, and it is what the mapping below describes. We would still write sync, presence, compaction and undo ourselves. Worth doing only if Yjs's size or its binary format becomes the problem. |
| An existing RDF CRDT (SU-Set, crdf, m-ld, NextGraph) | Not evaluated for a browser, and none was designed for a two-graph model with a real-time engine behind it. |
| Syncing changesets, with `expectedRevision` as the conflict check | Revision is optimistic concurrency: it rejects a concurrent edit and does not merge it. Changesets do not commute either (`removeNode` against `setParameter` on the same node). See "What the revision means" below. |

## The mapping from the graph to merge rules

**Every statement in the session falls into one of four classes, and the class decides how two concurrent edits to it merge.**

| Class | Example | Merge rule |
|---|---|---|
| A resource | a track, node, connection, clip, note, marker | Exists or not. Removal wins over a concurrent edit of the same resource. |
| A single-valued property | a node's label, a parameter's value, a clip's start, `jig:bypassed` | Last writer wins, by logical clock, with the peer id as tiebreak. Never wall-clock time. |
| A multi-valued property | a set of values with no resource of their own | Add wins. A value is its own key, so adding it twice is one value. |
| An order | the notes in a clip, the tempo points | Not stored. Derived on read from a sort key the resource already carries (a note's start, a tempo point's beat). |

In the replica a resource is a map keyed by its IRI, and its properties are entries keyed by the predicate IRI. The Yjs value
for a single-valued property is a plain value; for a multi-valued one it is a map from value to `true`. This is the whole mapping.
Nothing in it is specific to music except the table of which predicates are which.

**The class comes from the shapes.** A property with `sh:maxCount 1` is single valued, one without is multi-valued, and a
resource's type is its `rdf:type`. A test reads `vocabs/shapes.ttl` and the mapping table in `src/collab/` and fails if a predicate
in a shape has no class or the table names a predicate no shape has. That is the "two files that must agree" case CLAUDE.md warns
about, bound by a test instead of by care. No new vocabulary term is proposed until that test shows the shapes cannot say something
the mapping needs. The likely first candidate is a plugin's saved state, which is one opaque value that must merge as a whole and
never field by field.

**There is no list anywhere in the replica.** A Yjs array duplicates items when two peers insert at once, and the project already
forbids `rdf:List` for related reasons. The same rule that keeps blank nodes out of the file keeps arrays out of the replica.

### Removal wins, and what that costs

If one person deletes a track while another edits a note on it, the track and its contents are gone and the edit is lost.
That is the usual rule for a nested map, it is easy to explain, and the person who deleted can undo the deletion, which brings
the track back with the contents it had at that moment. The alternative, a deleted track that quietly revives when anyone touches
it, is worse in a session where a person is trying to clear things out.

### Rules that keep a merged state loadable

**A merge can produce a state the model would refuse, so there is a deterministic filter between the replica and the project.** The
replica always converges. What the project is shown is the replica's content after a filter that every peer runs identically, so
peers agree on what is shown without exchanging anything more.

- **A dangling reference hides the thing, it does not delete it.** A connection whose node was removed, or a clip whose track was,
  is left out of the effective snapshot. The data stays in the replica, and a later peer may clean it up with an ordinary delete.
- **A cycle is broken by a fixed order.** Two peers each add one arc and together they close a loop. Arcs are admitted in the order
  of their IRIs, and an arc that would close a cycle is held back and listed as such to the person, not deleted. The test for a cycle
  looks only at the structure of the graph. It never uses plugin latency, because latency depends on which plugins have loaded on
  that peer, and the filter must give every peer the same answer.
- **A value outside its declared range is clamped or refused by the same validators a changeset goes through.** A remote peer is
  untrusted input, like an agent. Properties the model does not know are dropped, and sizes are bounded.

The effective snapshot is then turned into a changeset by the reconciliation that `UndoHistory` already uses to step the project
between snapshots (`clipChange`, `arrangementReconcile`), and applied through `dispatcher.apply`. A remote edit therefore goes model,
then compiler, then engine, exactly as a local one does, and the compiler can still refuse it. If it does, the previous graph keeps
playing and the change is shown as held back.

## Identity: ids must be unique across peers

**An id minted from a per-project counter collides, so a shared session needs ids that carry a peer-unique part.** Two peers adding a
node at once both mint `node-5`. The model already accepts an explicit `change.id` (`noteExplicitId`), so this is a change to what
mints ids and not to the apply path.

- A peer's ids carry a short random peer tag, for example `node-k3f9a-5`. A session saved by a solo peer keeps its plain ids, which
  stay valid, and a peer joining mints with a tag from then on. An id is an opaque fragment of the document IRI either way.
- Notes need ids. Today a clip's notes are an array sorted by start, with no identity for one note, so two peers cannot refer to the
  same note. They become resources with fragment IRIs like every other addressable thing. How the session writer emits them now has
  to be checked before this step, because the file format and its shapes change with it.
- Anything that caches by id has to key by what is behind the id, as the lessons in CLAUDE.md say. A fresh peer's `node-1` and an old
  session's `node-1` are the same string for different things.

## What the revision means

**`jig:revision` stays a local counter and keeps its meaning for the agent surface.** It counts the changesets this replica has
committed, whether they came from this person or arrived from a peer. An agent that names the revision it last saw still gets a
conflict if anything changed, including a remote edit, and re-reads. That is the right behaviour for an agent that needs a
consistent view. It is not the conflict rule between peers, which is the merge above.

A saved file records the revision of the peer that saved it. Two peers saving at the same moment write files with the same
content and possibly different revisions, which is harmless: the revision describes the file, not the room.

## Two replicas, matching the two graphs

**The project and the editor metadata are two replicas, as they are two graphs.** Dragging a node must not touch the document that
holds the audio-relevant state, and the same reason applies to traffic: layout changes are frequent and are never a reason to
recompile. The project replica carries everything that sounds. The editor replica carries positions, colours and track order, is
joined by default, and can be left out by a person who wants their own layout.

## What is shared and what is not

**Shared data is what a saved session holds, plus presence. Nothing about time or audio is shared in the early steps.**

| Concern | Shared | How |
|---|---|---|
| Tracks, nodes, connections, sends, master | Yes | Resources and properties as above. |
| Parameter values | Committed values only | A value is written when a gesture ends or a field is set. During a drag, a throttled preview goes on the awareness channel and is never part of the replica. |
| A plugin's saved state | Yes, as one value | Last writer wins on the whole blob. |
| Clips, notes, automation, markers, tempo and signature maps | Yes | Resources keyed by id, ordered on read. |
| Loaded plugin code | No | Peers share the plugin IRI. Each peer fetches, verifies and loads it under [the contract](host-plugin-contract.md), section 3.1. |
| Audio files | Not in the replica | The replica holds the clip's `media/<sha256>` path. Bytes move peer to peer on request and are checked against the hash ([project-folder.md](project-folder.md)). |
| Transport state: playing, position, loop | No | Shared playback needs clock agreement between machines. That is a separate design and a later step. |
| Audio output, meters | No | Each peer hears its own render. |
| Scripts saved with the session | As text, never run on arrival | A script that arrives from a peer is shown, not executed. |
| Editor metadata | Separate replica | See above. |
| Presence: name, selection, a pointer | Yes, ephemeral | Awareness only. Not saved, not undoable. |

### A remote plugin load can fail, and a person is asked first

A remote `addNode` names a plugin IRI, and loading it means fetching from an address a stranger chose and running its code. Plugin
code is already untrusted and sandboxed, but the fetch is still a request the person did not make, and the page that makes it
shows the person's IP address to that server. The rules:

- A node whose plugin has not loaded is a placeholder in the model: it keeps its place and its settings, outputs silence, and says
  why. This reuses the rule that a failed load leaves the previous graph playing.
- The first time a room asks a peer to load an IRI the peer has not loaded before, the peer is asked. A room can be marked trusted
  for the length of the visit.
- A bundle that exists only on one machine cannot be loaded by the others. The node stays a placeholder and names the missing
  plugin, and sharing bundles is a later step.

## Undo in a shared session

**Undo in a room takes back the local person's last edit and nobody else's.** The present history is a stack of whole-project
snapshots, which is right for one editor and wrong here: restoring a snapshot would erase what a peer did since.

In a room, each local edit records the resources and predicates it wrote and the values they had before. Undo writes those values
back, but only where the current value is still the one this peer wrote. Where a peer has since changed it, that part is skipped and
the person is told which part, rather than overwritten. Yjs's undo manager does the same thing and is the first implementation.

The snapshot history stays for a solo session. Until the selective version exists, undo is off in a room and says so, which is
honest and better than undo that sometimes erases a collaborator's work.

## The envelope: a wrapper around the replica format

**Every message between peers is a small envelope whose payload is opaque to everything except the codec that wrote it.** The
envelope knows nothing about Yjs. That is what makes the engine replaceable, and it is cheap to do on day one and expensive to
retrofit.

```
{ v: 1,                  envelope version
  room: "<room id>",
  from: "<peer id>",
  kind: "hello" | "knock" | "admit" | "deny" | "sync" | "update" | "presence" | "want" | "have" | "chunk" | "leave",
  codec: "yjs-1",        which replica codec wrote the payload, for sync, update and presence
  payload: <bytes> }
```

- **The codec is negotiated, not assumed.** A `hello` lists the codecs a peer speaks, and a connection uses the first one both lists
  hold. If there is none, the connection is refused with a message naming the two lists. A room never silently half-works.
- **Yjs rides inside the payload.** The [y-protocols](https://github.com/yjs/y-protocols) sync messages (state vector, then the
  missing update) are the payload of `sync` and `update`, and awareness is the payload of `presence`. Replacing Yjs means
  adding a codec, not touching the envelope, the admission protocol or the transports.
- **A codec change never loses the session.** RDF is the definition, so the way across is a snapshot: a member saves the session
  as Turtle, and the room is recreated from it under the new codec. Selective undo history is the one thing that does not cross.
- **Media rides the same envelope** as `want`, `have` and `chunk`, keyed by SHA-256, so file transfer is not a second protocol.
- We write the provider ourselves instead of using `y-webrtc`. That package speaks its own wire format and has no admission step,
  so using it would put the codec outside the envelope.

## Joining a room: the protocol for a band

**For three or four people who know each other, a secret link plus a knock that any member can approve is enough.** A link alone
admits whoever holds it, and links get pasted into the wrong chat. The knock costs a few seconds and makes a leaked link
useless on its own. Anything stronger (accounts, an owner who curates a list) is a design for a larger and less familiar room.

**The pieces**

- **A peer identity.** Each browser makes a key pair once (WebCrypto, stored in IndexedDB) and its public key is its peer id. The
  display name is a label the person chooses, and it is not an identity. Use ECDSA P-256, which the
  [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) has everywhere; Ed25519 only after it is
  checked on every browser Jiggy targets.
- **A room secret.** Creating a room makes 128 random bits. A room id and an encryption key are both derived from it, so the
  signalling service sees the id and never the key.
- **An invitation link.** `https://…/#room=<secret>`. The secret is in the fragment, which is never sent to a server. The person
  who made the room sends the link by whatever channel the band already uses.
- **A roster.** The members' public keys and names, held in a small replica of its own beside the project and editor ones, so
  that membership converges like everything else.

**The sequence**

1. **Create.** Alice starts a room from her open session. She becomes the first roster entry, and her session is the room's
   starting state. The page shows the link and, in text, who is present.
2. **Contact.** Bob opens the link. His page derives the room id, and finds Alice through the signalling service. Everything
   sent through signalling, including the connection offers (which carry IP addresses), is encrypted with the room key, so the
   relay learns that a room exists and nothing more.
3. **Hello.** The data channel opens and each side sends `hello`: envelope version, codecs, public key, name, and a signature over
   a fresh challenge from the other side. That proves each holds its key. It authenticates the connection, so no per-update
   signing is needed in the first version.
4. **Knock.** In a room that admits by knock, which is the default, Bob's key is not on the roster, so he sends `knock` and gets nothing else: no state, no presence. Alice sees "Bob
   wants to join", with a short fingerprint of his key as words. If it matters, they read it to each other on the call they are
   already on. She accepts or refuses.
5. **Admit.** Any member can accept. The acceptance adds Bob to the roster, which every member sees, and Alice sends `admit`.
6. **Sync.** Bob confirms that joining replaces his open session, and a recovery copy of it is kept first (the recovery store in
   `web/app/Recovery.js` is where it goes). Then the usual two-step Yjs exchange follows: Bob sends an empty state vector, Alice
   sends everything. After that, edits and presence flow both ways.
7. **Introduction.** Carol and Dave are on the roster too. Alice passes Bob their offers over the channel they already share,
   and he connects to each directly. Signalling through the relay is used once, for first contact, and a room whose relay then
   goes down keeps working. Everyone ends up connected to everyone: at most three links per person, which a data channel mesh
   handles without trouble.
8. **Return.** A member on the roster who comes back, from a dropped connection or tomorrow, is recognised by key and not asked
   again. Each member keeps the replica in IndexedDB, so a returning member sends the state vector it has and receives only what
   it missed. Nothing lives on a server, and the room is simply whoever is present. If nobody is, the session is in every member's
   browser and in any file saved from it.

**Rules the protocol keeps**

- Before admission a connection may send `hello` and `knock` only. Anything else is dropped. Message size, and the rate of
  knocks, are bounded.
- Every member may admit, and every member may remove another. For four people who trust each other this is simpler than an
  owner. A removed member can no longer connect, but they still hold the secret and anything they already received, so removal
  is a courtesy and not a lock. A real lock needs a new secret handed to the remaining members, and that is deferred.
- Everyone is an editor in the first version. Read-only members (a listener who is not playing) are a roster field and an
  enforced rule at each receiving connection, and are added when someone asks.
- The data channels are already encrypted in transit by DTLS. The room key covers what passes through a relay, and nothing is
  encrypted twice.
- The page says, before the first connection, that peers in a WebRTC room can see each other's IP address.

**Open rooms: anyone with the link.** A room has an admission mode, `knock` or `open`, held in the roster replica so every member
sees the same one. The creator chooses it, and any member can change it. In `open` mode a peer that completes `hello` is admitted
at once and added to the roster, with no prompt. Everything else in the sequence is unchanged: the key proof, the sync, the
introduction, and recognition on return.

Open mode is for a quick jam with someone the band has not met, and it changes what the link is worth, so it carries limits:

- **It is visible and it stays open until closed.** The page shows in text, always, that the room is open. Nothing closes it
  but a member, and any member can do so at once. Closing does not remove anyone already admitted. Because nothing expires it,
  the page also shows, in text, how many people joined by link, so a room left open overnight is noticed.
- **The room has a size cap**, eight by default, so a link that has spread cannot grow the mesh without limit.
- **Plugin loads are never pre-approved.** The "trusted for this visit" shortcut in the plugin-load question is not offered in an
  open room. A stranger can name any IRI, so each new one asks every member who would fetch it.
- **Scripts from peers are shown, not run**, as in every room. This matters more here.
- **Members who came in through open mode are marked** in the roster as having joined by link, so another member can see who they
  are and remove them. Removal is a courtesy, as above, because the secret is already out.
- **The page says, at the moment of creating an open room,** that anyone holding the link can edit the whole session and will see
  the IP address of every member they connect to.

An open room is the case that makes read-only members worth building: a visitor who can listen and not edit. That stays deferred
with the other roles, and when it arrives the creator can choose which role link joiners get.

**Transport.** Order of preference, unchanged in spirit:

1. `BroadcastChannel` for two tabs of one browser. No network, so the envelope, the codec and the filter are proved first. It
   closes the "two tabs" item in TODO.md.
2. WebRTC data channels, with signalling over a serverless relay set such as [Trystero](https://github.com/dmotz/trystero)
   (Nostr, MQTT, BitTorrent), used only to carry encrypted offers. A copy-and-paste offer works for a room of two, and a small
   signalling server we run is the fallback. Strict NATs need a TURN relay, which a static site cannot supply. Four people on
   home connections will meet this once in a while, and the page must say what failed.
3. A WebSocket relay for larger rooms. It is not needed for a band.

## A canonical form to compare and to sign

**The session graph has a canonical form we already compute, and a collaboration needs one for three jobs: saying whether two replicas
agree, signing a checkpoint, and proving a codec change kept the session.** `src/rdf/Canonical.js` serialises a profile as N-Triples
sorted in code point order and digests that. It is the blank-node-free subset of [RDFC-1.0](https://www.w3.org/TR/rdf-canon/), the W3C's
RDF dataset canonicalisation, where the algorithm reduces to exactly that. A session has no blank nodes for the same reason a profile
has none, so the same function applies to the effective snapshot of a room (the replica after the filter described above).

What the W3C's [RDFC-1.0 implementation report](https://w3c.github.io/rdf-canon/reports/) says, as read on 2026-10-26 and not checked
by running any of it: it is an informal report dated 24 February 2026 on a suite of 86 tests, covering 11 implementations in Java, Python,
C++, JavaScript, TypeScript, Rust, Elixir and Ruby. Ten pass all 86. The one that does not, RDF-URDNA, passes 84, and its two untested
cases are about N-Quads escaping. The two in JavaScript or TypeScript, `rdf-canonize` and `rdfjs-c14n`, both pass everything. The suite is
mostly blank-node edge cases, including graphs built to defeat a canonicaliser, which matters below.

- **Do replicas agree?** Each peer can digest the canonical form of its effective snapshot and send the digest with its presence, a few
  bytes in place of the state. Equal digests mean the peers show the same session, and a difference is a convergence bug or a message
  still in flight, so the page says "in sync" or "catching up" in words. It is also the strongest convergence test there is: replicas fed the
  same updates in different orders must give the same digest, which is a better assertion than comparing two snapshots field by field.
- **A signed checkpoint.** A member can sign the digest of the session at a moment, and the signature names that exact state, in the way
  a bundle's profile digest does ([plugin-bundles.md](plugin-bundles.md)). A returning member, or one who has just joined, can check a
  checkpoint against the state they were given, and a room has a point to return to that does not depend on trusting whoever sent the
  bytes. It needs no change to the replica format.
- **A codec change.** The way across codecs is a Turtle snapshot. The digest before and after is the proof that the session is the same
  one, apart from undo history, which is the claim the envelope section makes.
- **A second host agrees.** The native adapter computes the same digest if it implements the same form. That the report lists C++ and Rust
  implementations that pass the whole suite is the reason to expect one can be had, and the sorted N-Triples form is simple enough to write
  without a library if not.

**Peers are untrusted, and a blank node from one is refused.** A remote update that brings a blank node into the session is dropped by
the same validators as any other bad value. The report's "poison" graphs exist because canonicalising blank nodes is expensive in the worst
case, so a graph from a stranger that contains them is a way to make a page do a great deal of work. Refusing them at the door keeps the
cheap form the only one the session ever needs, and means we never implement the expensive half of the algorithm. If a future import brings in
a graph with blank nodes (a third party's profile, for example), skolemise it to IRIs as the session format already says, and do that before
the graph reaches the replica.

Open: whether the digest rides in the presence message or in its own `sync` kind of the envelope, how often it is worth taking on a large
session (3000 notes is the size the rest of this note tests at), and whether a checkpoint is signed by one member or by each.

## Agents as peers

**An agent is a peer through the surface it already has.** The WebMCP tools call the dispatcher, so an agent's edit is an ordinary
local edit for the page it runs in and is carried to the room like any other. Nothing in the agent surface changes. Its
`expectedRevision` check keeps its present meaning, and in a busy room it will fail more often and should re-read, as above.

## Rules this has to keep

- **Real time.** Nothing from the network reaches `process()`. A remote parameter value arrives on the message thread and goes
  through the same setter a local change does, then to the engine over the port.
- **Provenance.** The replica is one source. A saved file keeps its named graphs and `prov:` records. Attribution of individual edits
  to the peer that made them (a `prov:wasAttributedTo` on a history graph) is possible later and is not needed to converge.
- **Accessibility.** Presence is never colour alone: a name or initials accompany a colour. A peer joining or leaving, and a remote
  edit that changed something under the person's focus, are announced in a live region. A held-back change is listed as text.
- **Untrusted input.** Every remote value passes the validators an agent's changeset passes. Room keys never go to a server.

## Order of work

**Each step is useful alone and leaves the host working for one person.** The order puts everything that can be proved without a
network first.

1. **Mergeable model and envelope, no network.** The envelope and codec negotiation are written now, with a Yjs codec behind them. Peer-tagged ids. Note ids, with the writer, the reader, the shapes and the round-trip tests
   updated together. The mapping table and its test against `vocabs/shapes.ttl`. A `src/collab/` module that maps a snapshot to and
   from a replica, with the filter. Proved by tests that run two or three replicas in memory.
2. **Two tabs.** The dispatcher wiring: a local `changed` event writes to the replica, a remote update is filtered, reconciled and
   applied unrecorded, with a guard against echo. `BroadcastChannel` provider. Undo is off in a room. Presence is a name and a
   selection.
3. **Selective undo.**
4. **Two machines, then four.** WebRTC with the serverless signalling choice, the join protocol above (identity, knock,
   roster, introduction) and the plugin-load question. Evaluate m-ld and NextGraph here, before committing to carrying our own replica code any further.
5. **Audio files and bundles** between peers, by hash.
6. **Shared transport**, as its own design note, since it needs clock agreement and the tolerances in [latency.md](latency.md).
7. **A history graph** with per-edit attribution, if it turns out to be wanted.

## How it is checked

**The tests are the ones that would catch the two ways a merge goes wrong: replicas that disagree, and a state the model refuses.**

- **Convergence.** Random edits on three replicas, delivered shuffled, duplicated and delayed, then compared by the canonical digest of their effective snapshots (and as snapshots, to say what differs when the digests do not). The fake
  transport must refuse nothing a real one would not, so it drops, reorders and repeats on purpose. A fake that only delivers in
  order passes the cases that were never the problem.
- **One counterexample per rule.** A removal against an edit, a dangling connection, two arcs that make a cycle, an out-of-range
  value from a peer, an unknown predicate, a note sent twice. Each is made to fail once by deleting the rule, and it must fail by
  exactly the test written for it.
- **The default, the first and the empty.** A room opened from an empty session, from a session with no editor graph, and a joiner
  whose local session is replaced.
- **Size.** A clip with thousands of notes, merged within a time limit, as `ProjectRoundTrip` does for reading.
- **Two real windows.** Convergence is checked in a real browser with both windows in front, since a hidden tab gets no user
  activation and a hang there says nothing about the code. The check asserts `ok` on every call.

## Open questions

- **Rekeying on removal.** Removing a member does not lock them out of a secret they hold. A new room secret, handed to the
  remaining members, does. Needed before the room holds anything its members would not want a former member to see.
- **Read-only members and finer roles.** Deferred until a use for them shows up.
- **Should a saved file say it was made in a room?** It would let a reader know the revision is not a straight line.
- **Which signalling relays.** The serverless set needs a trial from four real machines on four real networks before it is
  trusted.
- **The native adapter.** It needs a second codec, a Yjs port (one exists for Rust) or a Turtle snapshot hand-off. The envelope is
  what keeps that choice open.
