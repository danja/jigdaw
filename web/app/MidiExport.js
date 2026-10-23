// web/app/MidiExport.js
//
// The project's MIDI clips as a Standard MIDI File, handed to the person (src/model/MidiFile.js says what goes in it).
import { writeMidiFile } from '../../src/model/MidiFile.js'
import { defaultDownload } from './Bounce.js'

export function createMidiExport (ctx, { download = defaultDownload } = {}) {
  const log = (...args) => ctx.log(...args)
  /** The whole project, or only `trackIds`, named after the one track when there is one. */
  function exportMidi ({ trackIds = null } = {}) {
    const project = ctx.dispatcher?.project
    if (!project) throw new Error('there is nothing to export yet')
    const { bytes, tracks, notes } = writeMidiFile(project, { trackIds })
    const safe = text => text.replace(/[^\w.-]+/g, '-')
    const only = trackIds?.length === 1 ? `-${safe(project.track(trackIds[0]).label ?? trackIds[0])}` : trackIds ? '-selected' : ''
    const name = `${safe(project.label ?? 'jiggy')}${only}.mid`
    download(bytes, name, 'audio/midi')
    log(`exported ${name}: ${notes} note${notes === 1 ? '' : 's'} on ${tracks} track${tracks === 1 ? '' : 's'}`, 'ok')
    return { bytes, name }
  }
  return { exportMidi }
}
