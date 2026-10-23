// web/app/MidiImport.js
//
// A Standard MIDI File brought in as new tracks with their clips, in one edit (src/model/MidiImport.js says how time is
// treated). The file is read and checked before anything changes, so a file that fails leaves the project as it was.
import { readMidiFile } from '../../src/model/MidiRead.js'
import { describeMidiImport } from '../../src/model/MidiImport.js'

/** A MIDI file is small; a megabytes-long one is more likely the wrong file than a piece to import. */
export const MAX_MIDI_BYTES = 8 * 1024 * 1024

export function createMidiImport (ctx) {
  const log = (...args) => ctx.log(...args)
  async function importFile (file) {
    if (file.size > MAX_MIDI_BYTES) throw new Error(`${file.name} is ${(file.size / 1048576).toFixed(1)} MB; a MIDI file over ${MAX_MIDI_BYTES / 1048576} MB is not imported`)
    const midi = readMidiFile(new Uint8Array(await file.arrayBuffer()))
    // The dispatcher exists once the page has started (the first plugin or track); an import is a way to start.
    await ctx.runtime.ensureRunning()
    const result = describeMidiImport(ctx.dispatcher.project, midi)
    const applied = ctx.dispatcher.apply(result.changes)
    if (!applied.ok) throw new Error(applied.message)
    for (const warning of result.warnings) log(warning)
    log(`imported ${file.name}: ${result.notes} note${result.notes === 1 ? '' : 's'} on ${result.tracks} new track${result.tracks === 1 ? '' : 's'}${result.appliedTiming ? ', with its tempo and time signature' : ''}`, 'ok')
    return result
  }
  return { importFile }
}
