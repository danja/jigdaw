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
export const UNITS = 'http://lv2plug.in/ns/extensions/units#'
export const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
export const RDFS = 'http://www.w3.org/2000/01/rdf-schema#'
export const FOAF = 'http://xmlns.com/foaf/0.1/'
export const DCTERMS = 'http://purl.org/dc/terms/'
export const XSD = 'http://www.w3.org/2001/XMLSchema#'

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
    homepage: `${FOAF}homepage`
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
    Midi: `${TRN}Midi`
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

    // Projects
    Project: `${JIG}Project`,
    Node: `${JIG}Node`,
    Connection: `${JIG}Connection`,
    Endpoint: `${JIG}Endpoint`,
    ParameterSetting: `${JIG}ParameterSetting`,
    Transport: `${JIG}Transport`,
    TempoPoint: `${JIG}TempoPoint`,
    revision: `${JIG}revision`,
    node: `${JIG}node`,
    connection: `${JIG}connection`,
    transport: `${JIG}transport`,
    plugin: `${JIG}plugin`,
    nodeState: `${JIG}nodeState`,
    gain: `${JIG}gain`,
    pan: `${JIG}pan`,
    muted: `${JIG}muted`,
    soloed: `${JIG}soloed`,
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
    y: `${JIG}y`
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

  units: Object.freeze({
    unit: `${UNITS}unit`
  })
})

/** Every jig: IRI this module names. Used by the vocabulary symmetry test. */
export function jigTerms () {
  return Object.values(vocabulary.jig)
}
