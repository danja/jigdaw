// src/rdf/Vocabulary.js
//
// The single source of IRI truth. Frozen string constants, no namespace-builder
// machinery.
//
// Only terms the code names directly live here. Terms that are read
// dynamically, such as the objects of trn:role or trn:produces, never need a
// constant: they are carried through as IRIs and compared as data.
//
// tests/rdf/vocabulary.test.js asserts that every jig: term here is declared in
// vocabs/jigdaw.ttl. Adding a constant for a term the ontology does not define
// is a failing test, not a runtime surprise.

export const JIG = 'http://purl.org/stuff/jigdaw/'
export const TRN = 'http://purl.org/stuff/transmissions/'
export const LV2 = 'http://lv2plug.in/ns/lv2core#'
export const MIDI = 'http://lv2plug.in/ns/ext/midi#'
export const UNITS = 'http://lv2plug.in/ns/extensions/units#'
export const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
export const RDFS = 'http://www.w3.org/2000/01/rdf-schema#'
export const FOAF = 'http://xmlns.com/foaf/0.1/'
export const DCTERMS = 'http://purl.org/dc/terms/'
export const XSD = 'http://www.w3.org/2001/XMLSchema#'
export const DOAP = 'http://usefulinc.com/ns/doap#'
export const PROV = 'http://www.w3.org/ns/prov#'
export const SEC = 'https://w3id.org/security#'

export const vocabulary = Object.freeze({
  rdf: Object.freeze({
    type: `${RDF}type`,
    value: `${RDF}value`
  }),

  rdfs: Object.freeze({
    label: `${RDFS}label`,
    comment: `${RDFS}comment`
  }),

  foaf: Object.freeze({
    homepage: `${FOAF}homepage`,
    name: `${FOAF}name`
  }),

  dcterms: Object.freeze({
    created: `${DCTERMS}created`,
    // A collection's members. docs/plugin-collections.md.
    hasPart: `${DCTERMS}hasPart`
  }),

  // A plugin's version and its developer. DOAP rather than jig: terms, because
  // LV2 describes a plugin project with DOAP and this vocabulary already
  // follows LV2. doap:developer is an IRI, never a name, the same rule
  // provenance attribution already follows: a name is not something anything
  // can be checked against.
  doap: Object.freeze({
    revision: `${DOAP}revision`,
    developer: `${DOAP}developer`
  }),

  // Provenance. Reused unchanged: who made a bundle, when, and from what.
  prov: Object.freeze({
    Agent: `${PROV}Agent`,
    SoftwareAgent: `${PROV}SoftwareAgent`,
    used: `${PROV}used`,
    atLocation: `${PROV}atLocation`,
    endedAtTime: `${PROV}endedAtTime`,
    wasDerivedFrom: `${PROV}wasDerivedFrom`,
    wasGeneratedBy: `${PROV}wasGeneratedBy`,
    wasAssociatedWith: `${PROV}wasAssociatedWith`,
    wasAttributedTo: `${PROV}wasAttributedTo`
  }),

  // Signatures. The W3C security vocabulary, which is what Data Integrity
  // proofs and Multikey are already expressed in. Inventing a jig: parallel to
  // sec:proofValue would be a second answer to a question with a standard one.
  sec: Object.freeze({
    DataIntegrityProof: `${SEC}DataIntegrityProof`,
    Multikey: `${SEC}Multikey`,
    proof: `${SEC}proof`,
    proofValue: `${SEC}proofValue`,
    proofPurpose: `${SEC}proofPurpose`,
    assertionMethod: `${SEC}assertionMethod`,
    cryptosuite: `${SEC}cryptosuite`,
    verificationMethod: `${SEC}verificationMethod`,
    publicKeyMultibase: `${SEC}publicKeyMultibase`
  }),

  // Musical semantics. Reused unchanged; never redefined here.
  trn: Object.freeze({
    PluginProfile: `${TRN}PluginProfile`,
    role: `${TRN}role`,
    accepts: `${TRN}accepts`,
    produces: `${TRN}produces`,
    requires: `${TRN}requires`,
    recommendedBefore: `${TRN}recommendedBefore`,
    recommendedAfter: `${TRN}recommendedAfter`,
    companion: `${TRN}companion`,
    genre: `${TRN}genre`,
    caution: `${TRN}caution`,
    vendor: `${TRN}vendor`,
    format: `${TRN}format`,
    HostTransport: `${TRN}HostTransport`,
    Audio: `${TRN}Audio`,
    Midi: `${TRN}Midi`,
    // MIDI that reshapes a plugin rather than playing it. ControlMidi covers
    // CCs and scene notes; MidiCC is the narrower CCs-alone term. Both are
    // upstream-defined in plugin-universe's vocabs/trn-profile.ttl.
    ControlMidi: `${TRN}ControlMidi`,
    MidiCC: `${TRN}MidiCC`,
    // A clip's and a note's placement, and a note itself. transmission's
    // arrangement terms, reused for the same purpose.
    startBeat: `${TRN}startBeat`,
    lengthBeats: `${TRN}lengthBeats`,
    pitch: `${TRN}pitch`,
    velocity: `${TRN}velocity`
  }),

  jig: Object.freeze({
    WebPlugin: `${JIG}WebPlugin`,
    Resource: `${JIG}Resource`,
    Module: `${JIG}Module`,
    Processor: `${JIG}Processor`,
    UserInterface: `${JIG}UserInterface`,

    // Delivery
    module: `${JIG}module`,
    processor: `${JIG}processor`,
    ui: `${JIG}ui`,
    asset: `${JIG}asset`,
    location: `${JIG}location`,
    integrity: `${JIG}integrity`,
    mediaType: `${JIG}mediaType`,
    registeredName: `${JIG}registeredName`,
    wasmFeature: `${JIG}wasmFeature`,
    userReplaceable: `${JIG}userReplaceable`,
    ModuleAbi: `${JIG}ModuleAbi`,
    Abi1: `${JIG}Abi1`,
    Abi2: `${JIG}Abi2`,
    abi: `${JIG}abi`,
    paramIndex: `${JIG}paramIndex`,
    Simd128: `${JIG}Simd128`,
    Threads: `${JIG}Threads`,
    BulkMemory: `${JIG}BulkMemory`,
    ExceptionHandling: `${JIG}ExceptionHandling`,

    // Capabilities
    prefers: `${JIG}prefers`,
    SharedMemory: `${JIG}SharedMemory`,
    CrossOriginIsolation: `${JIG}CrossOriginIsolation`,
    MidiEvents: `${JIG}MidiEvents`,
    MidiOut: `${JIG}MidiOut`,
    OfflineRender: `${JIG}OfflineRender`,
    Persistence: `${JIG}Persistence`,

    // Runtime shape
    audioInputs: `${JIG}audioInputs`,
    audioOutputs: `${JIG}audioOutputs`,
    inputChannels: `${JIG}inputChannels`,
    outputChannels: `${JIG}outputChannels`,
    renderQuantum: `${JIG}renderQuantum`,
    latencyFrames: `${JIG}latencyFrames`,
    tailFrames: `${JIG}tailFrames`,

    // Parameters
    automationRate: `${JIG}automationRate`,
    ARate: `${JIG}ARate`,
    KRate: `${JIG}KRate`,
    // The panel section a control belongs under. A plain label: groups are
    // per-plugin display hints, never addressed across documents.
    controlGroup: `${JIG}controlGroup`,

    // Projects
    Project: `${JIG}Project`,
    Track: `${JIG}Track`,
    Node: `${JIG}Node`,
    Connection: `${JIG}Connection`,
    Endpoint: `${JIG}Endpoint`,
    ParameterSetting: `${JIG}ParameterSetting`,
    Transport: `${JIG}Transport`,
    TempoPoint: `${JIG}TempoPoint`,
    revision: `${JIG}revision`,
    node: `${JIG}node`,
    track: `${JIG}track`,
    connection: `${JIG}connection`,
    transport: `${JIG}transport`,
    plugin: `${JIG}plugin`,
    nodeState: `${JIG}nodeState`,
    gain: `${JIG}gain`,
    pan: `${JIG}pan`,
    muted: `${JIG}muted`,
    soloed: `${JIG}soloed`,
    onTrack: `${JIG}onTrack`,
    midiInput: `${JIG}midiInput`,
    audioInput: `${JIG}audioInput`,
    Clip: `${JIG}Clip`,
    MidiClip: `${JIG}MidiClip`,
    AudioClip: `${JIG}AudioClip`,
    Note: `${JIG}Note`,
    clip: `${JIG}clip`,
    note: `${JIG}note`,
    source: `${JIG}source`,
    offsetSeconds: `${JIG}offsetSeconds`,
    setting: `${JIG}setting`,
    from: `${JIG}from`,
    to: `${JIG}to`,
    signalKind: `${JIG}signalKind`,
    endpointNode: `${JIG}endpointNode`,
    portIndex: `${JIG}portIndex`,
    portSymbol: `${JIG}portSymbol`,
    symbol: `${JIG}symbol`,
    value: `${JIG}value`,
    tempoPoint: `${JIG}tempoPoint`,
    atBeat: `${JIG}atBeat`,
    bpm: `${JIG}bpm`,
    beatsPerBar: `${JIG}beatsPerBar`,
    beatUnit: `${JIG}beatUnit`,
    loopStart: `${JIG}loopStart`,
    loopEnd: `${JIG}loopEnd`,
    loopEnabled: `${JIG}loopEnabled`,
    x: `${JIG}x`,
    y: `${JIG}y`,

    // Foreign plugins. Contract section 12.
    ForeignPlugin: `${JIG}ForeignPlugin`,
    ForeignFormat: `${JIG}ForeignFormat`,
    WebAudioModule: `${JIG}WebAudioModule`,
    foreignFormat: `${JIG}foreignFormat`,
    container: `${JIG}container`,
    entryPoint: `${JIG}entryPoint`,

    // Collections. docs/plugin-collections.md.
    PluginCollection: `${JIG}PluginCollection`,

    // Bundles and provenance
    Bundle: `${JIG}Bundle`,
    Bundling: `${JIG}Bundling`,
    BundleForm: `${JIG}BundleForm`,
    Archive: `${JIG}Archive`,
    FlattenedProfile: `${JIG}FlattenedProfile`,
    bundleForm: `${JIG}bundleForm`,
    canonicalDigest: `${JIG}canonicalDigest`
  }),

  lv2: Object.freeze({
    port: `${LV2}port`,
    symbol: `${LV2}symbol`,
    name: `${LV2}name`,
    default: `${LV2}default`,
    minimum: `${LV2}minimum`,
    maximum: `${LV2}maximum`,
    portProperty: `${LV2}portProperty`,
    scalePoint: `${LV2}scalePoint`,
    toggled: `${LV2}toggled`,
    enumeration: `${LV2}enumeration`,
    InputPort: `${LV2}InputPort`,
    OutputPort: `${LV2}OutputPort`,
    ControlPort: `${LV2}ControlPort`,
    AudioPort: `${LV2}AudioPort`
  }),

  // MIDI controller bindings on ports. LV2's own MIDI extension, reused rather
  // than invented: a port's midi:binding names a midi:Controller carrying the
  // controller number that drives it.
  midi: Object.freeze({
    binding: `${MIDI}binding`,
    Controller: `${MIDI}Controller`,
    controllerNumber: `${MIDI}controllerNumber`
  }),

  units: Object.freeze({
    unit: `${UNITS}unit`
  })
})

/** Every jig: IRI this module names. Used by the vocabulary symmetry test. */
export function jigTerms () {
  return Object.values(vocabulary.jig)
}
