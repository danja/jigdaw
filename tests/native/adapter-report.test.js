// tests/native/adapter-report.test.js
//
// The adapter's load report and its parameter defaults are each written in one
// file and used in two others, and nothing in C++ connects them. These bind them.
//
// Why this suite exists, twice over.
//
// The editor originally learned what had loaded from Plugin::updateStateValue.
// DPF wires that callback under CLAP only. It is a null pointer in the VST3,
// VST2 and JACK wrappers, so in the format the adapter is mostly used in the
// editor sat on "Loading" for ever, while the plugin had in fact loaded.
//
// Then the plugin came up silent in a host. A host's generic slots read zero
// until something is loaded, and zero normalised is the bottom of whatever range
// the port turns out to have, so Pulse started with its gain at minimum. Notes
// arrived, voices ran, nothing was heard. See MISTAKES.md.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const adapter = join(root, 'native', 'jigdaw-adapter')
const read = (...p) => readFileSync(join(adapter, ...p), 'utf8')

const report = read('src', 'Report.cpp')
const params = read('src', 'Params.cpp')
const midi = read('src', 'Midi.cpp')
const chainSrc = read('src', 'Chain.cpp')
const plugin = read('src', 'dpf', 'JigdawPlugin.cpp')
const ui = read('src', 'dpf', 'JigdawUI.cpp')
const info = read('src', 'dpf', 'DistrhoPluginInfo.h')
const cmake = read('CMakeLists.txt')
const readme = read('README.md')

describe('the load report has one writer', () => {
  it('is built in Report.cpp and used by both sides', () => {
    // A second loop would be a second answer to the same question, and the one
    // the user reads would be the one nothing plays.
    expect(report).toMatch(/std::vector<LoadedPlugin>\s+buildChain\s*\(/)
    for (const [name, source] of [['the plugin', plugin], ['the editor', ui]]) {
      expect(source, `${name} should call the shared builder`)
        .toMatch(/jigdaw::buildChain\s*\(/)
    }
  })

  it('renders to text in one place, for the host readable state', () => {
    expect(report).toMatch(/std::string\s+describe\s*\(/)
    expect(plugin).toMatch(/jigdaw::describe\s*\(/)
  })

  it('is not parsed back out of text by the editor', () => {
    // The editor holds the structure. Reading the ranges back out of a summary
    // string would be the poorer half of what it already has.
    expect(ui).not.toMatch(/parseReport/)
  })
})

describe('the editor does not wait to be told', () => {
  it('resolves the IRIs itself rather than relying on updateStateValue', () => {
    expect(ui).toMatch(/jigdaw::buildChain/)
  })

  it('collects the worker result on the thread allowed to draw', () => {
    expect(ui).toMatch(/void uiIdle\(\)/)
  })

  it('joins the worker before its members go away', () => {
    // Closing an editor mid-load is an ordinary thing for a person to do.
    expect(ui).toMatch(/~JigdawUI\(\)/)
    expect(ui).toMatch(/worker_\.join\(\)/)
  })
})

describe('an untouched slot runs at the port default', () => {
  it('computes that in one place', () => {
    expect(params).toMatch(/float\s+normalisedDefault\s*\(/)
  })

  it('and both the plugin and the editor use it', () => {
    // The plugin decides what an untouched slot plays, the editor decides what
    // it displays. DPF cannot tell a VST3 host a parameter changed, so neither
    // can be informed of the other's answer and they must compute the same one.
    expect(plugin).toMatch(/jigdaw::applyParameters/)
    expect(ui).toMatch(/jigdaw::normalisedDefault/)
  })

  it('treats only a differing value as a choice, on both sides', () => {
    // A host pushes zero for every slot before anything is loaded. Counting
    // that as an edit is what made the plugin silent.
    for (const [name, source] of [['the plugin', plugin], ['the editor', ui]]) {
      expect(source, `${name} should only mark a slot touched when it differs`)
        .toMatch(/if\s*\(\s*value\s*!=\s*values_\[\s*index\s*\]\s*\)\s*touched_\[\s*index\s*\]\s*=\s*1;/)
    }
  })
})

describe('the panel writes through the host', () => {
  it('sets a host parameter and never the chain directly', () => {
    // Setting the chain would work until the first automation pass overwrote
    // it, and the host's own slider would disagree for as long as the editor
    // stayed open.
    expect(ui).toMatch(/setParameterValue\s*\(/)
    expect(ui).not.toMatch(/->setParameter\s*\(/)
  })

  it('lays out exactly the slots the plugin offers', () => {
    // Two files each holding their own 16 is how they come to disagree.
    expect(info).toMatch(/#define\s+JIGDAW_PARAMETER_COUNT\s+\d+/)
    expect(plugin).toMatch(/kParameterCount\s*=\s*JIGDAW_PARAMETER_COUNT/)
    expect(ui).toMatch(/JIGDAW_PARAMETER_COUNT/)
  })
})

describe('MIDI decoding is reachable by a test', () => {
  it('lives in Midi.cpp rather than inside a wrapper nothing can construct', () => {
    // While it was inline in the DPF wrapper the only way to reach the one part
    // of the adapter a person drives directly was a DAW and a keyboard.
    expect(midi).toMatch(/bool\s+applyMidi\s*\(/)
  })

  it('is decoded once, for both the chain and a single module', () => {
    // A chain routing events to an ABI 1 module has to turn them into notes,
    // and a second copy of that next to this one is how the two come to
    // disagree about whether a note on of velocity zero is a note off.
    expect(midi).toMatch(/Action\s+decode\s*\(/)
    expect(chainSrc).toMatch(/applyMidi\s*\(\s*module/)
  })

  it('treats a note on of velocity zero as a note off', () => {
    // Every MIDI source does this, and a synth that ignores it sustains for ever.
    expect(midi).toMatch(/kNoteOn\s*&&\s*size\s*>\s*2\s*&&\s*data\[2\]\s*==\s*0/)
  })

  it('answers both all notes off and all sound off', () => {
    // A DAW sends 120 on stop, and a synth that only knows 123 keeps ringing.
    expect(midi).toMatch(/kAllNotesOff\s*=\s*123/)
    expect(midi).toMatch(/kAllSoundOff\s*=\s*120/)
  })
})

describe('everything shared is compiled into the core library', () => {
  it('so both the plugin and the editor link one copy', () => {
    for (const file of ['src/Report.cpp', 'src/Midi.cpp', 'src/Params.cpp']) {
      expect(cmake, `${file} should be in jigdaw_core`).toContain(file)
    }
  })
})

describe('reopening the editor still shows the report', () => {
  it('asks DPF to pull current state from the plugin', () => {
    expect(info).toMatch(/#define\s+DISTRHO_PLUGIN_WANT_FULL_STATE\s+1/)
  })

  it('declares an editor at all', () => {
    expect(info).toMatch(/#define\s+DISTRHO_PLUGIN_HAS_UI\s+1/)
  })
})

describe('the README says the same number of slots as the code', () => {
  it('quotes the parameter count rather than remembering it', () => {
    // It said 32 for a while after the code said 16, and a reader had no way
    // to tell which was true.
    const declared = info.match(/#define\s+JIGDAW_PARAMETER_COUNT\s+(\d+)/)
    expect(declared, 'DistrhoPluginInfo.h should declare JIGDAW_PARAMETER_COUNT').not.toBeNull()
    expect(readme).toMatch(new RegExp(`flat list of ${declared[1]} generic slots`))
  })
})
