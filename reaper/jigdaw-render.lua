-- reaper/jigdaw-render.lua
--
-- Render a JigDAW plugin chain, by IRI, to audio and drop it into the
-- project as a new track, using REAPER's own scripting (ReaScript) rather
-- than a native adapter. See TODO.md, "A way to load a JigDAW plugin into
-- REAPER without the native adapter": native/jigdaw-adapter/ is a compiled
-- VST3/CLAP/LV2; this is the alternative that needs no build at all.
--
-- What this is: an offline bounce, not a live instrument or effect.
-- bin/host.js, the project's own Node reference host, renders a chain of
-- plugins from silence and MIDI notes to a WAV file; no browser, no DAW
-- binding (docs/for-hosts.md). src/host/ReferenceHost.js is a chain, not a
-- graph, and has no audio input, so this reaches an instrument, or an
-- instrument feeding effects placed after it, but never a bare effect
-- applied to REAPER's own audio. A live, playable JigDAW plugin in REAPER
-- needs something on REAPER's actual audio thread (a JSFX or a persistent
-- external process piped in real time) and is a different, larger piece of
-- work; this script does not attempt it.
--
-- Needs Node 20+ reachable from a shell. REAPER's ExecProcess does not set
-- up a login shell's PATH the way a terminal does (REAPER's own ReaScript
-- documentation says so explicitly), so this runs the command through
-- `/bin/sh -c`, which resolves `node` from ITS OWN inherited PATH. If that
-- still does not find it, set NODE below to a full path such as
-- '/usr/bin/node'. Linux and macOS only as written; Windows REAPER needs a
-- `cmd.exe /c` wrapper instead of `/bin/sh -c`, not written here.
--
-- Install: Actions > Show action list > New action... > Load ReaScript...,
-- and pick this file from inside the jigdaw checkout. Nothing is copied
-- into REAPER's own Scripts folder, so this keeps working exactly as long
-- as the checkout stays where it was when the action was added, and breaks
-- the same way any other missing file would if it is moved.
--
-- Untested against a real REAPER install as of writing: none was available
-- in the environment this was written in. Written against REAPER's own
-- ReaScript API documentation (reaper.fm/sdk/reascript) for ExecProcess,
-- GetUserInputs and InsertMedia. Run it once against something disposable
-- before trusting it with real project audio, and see reaper/README.md.

local NODE = 'node' -- a full path here if `node` is not on ExecProcess's shell PATH

--- The directory this script lives in, and the repository root one above it.
local function script_dir ()
  local info = debug.getinfo(1, 'S')
  local path = info.source:match('^@(.*)$')
  return path:match('^(.*)[/\\][^/\\]+$')
end

local ROOT = script_dir():match('^(.*)[/\\][^/\\]+$')
local HOST_JS = ROOT .. '/bin/host.js'

local function trim (s) return s:match('^%s*(.-)%s*$') end

local function fail (message)
  reaper.ShowMessageBox(message, 'JigDAW render', 0)
end

local ok, iri = reaper.GetUserInputs('JigDAW: render a plugin chain', 1,
  'Plugin IRI(s), comma separated:', '')
if not ok or trim(iri) == '' then return end

local ok2, rest = reaper.GetUserInputs('JigDAW: render a plugin chain', 2,
  'Seconds:,Notes (NOTE@ON[:OFF], comma separated):', '2,69@0:1.5')
if not ok2 then return end

local seconds, notes = rest:match('^([^,]*),?(.*)$')
seconds = trim(seconds or '')
if seconds == '' or not tonumber(seconds) then
  fail('Needs a duration in seconds, e.g. 2.')
  return
end

local proj_path = reaper.GetProjectPath('')
if proj_path == '' then
  fail('Save the project first: this needs somewhere to put the rendered audio.')
  return
end

local parts = { '"' .. HOST_JS .. '"' }
for one in iri:gmatch('[^,]+') do
  table.insert(parts, '"' .. trim(one) .. '"')
end
table.insert(parts, '--seconds ' .. seconds)
for note in (notes or ''):gmatch('[^,]+') do
  table.insert(parts, '--note "' .. trim(note) .. '"')
end

local out = proj_path .. '/jigdaw-render-' .. os.time() .. '.wav'
table.insert(parts, '--out "' .. out .. '"')

local cmd = "/bin/sh -c '" .. NODE .. ' ' .. table.concat(parts, ' ') .. "'"

-- timeoutmsec 0: run and wait for completion, returning "<exit code>\n
-- <stdout and stderr>" (REAPER's ReaScript documentation for ExecProcess).
-- The exit code is checked; a rendered file is not assumed just because
-- something arrived on stdout.
local result = reaper.ExecProcess(cmd, 0)
if result == nil then
  fail('Could not run:\n' .. cmd)
  return
end

local code, output = result:match('^(%-?%d+)\n?(.*)$')
if code ~= '0' then
  fail('bin/host.js failed (exit ' .. tostring(code) .. '):\n' .. (output or result))
  return
end

-- mode 1: add as a new track, so this never depends on what was selected or
-- which track was last touched.
reaper.InsertMedia(out, 1)
reaper.UpdateArrange()
