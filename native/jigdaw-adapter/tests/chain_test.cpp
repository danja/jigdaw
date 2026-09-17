// native/jigdaw-adapter/tests/chain_test.cpp
//
// The whole path, natively: fetch a plugin by IRI over the network, verify its
// declared digest, instantiate the WebAssembly through jig:Abi1, and make it
// sound. No browser, no JavaScript.
#include <cassert>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>

#include "jigdaw/Chain.hpp"
#include "jigdaw/Midi.hpp"
#include "jigdaw/Abi.hpp"
#include "jigdaw/Params.hpp"

namespace {

int failures = 0;

void check(bool condition, const std::string& what) {
    std::cout << (condition ? "  ok   " : "  FAIL ") << what << "\n";
    if (!condition) ++failures;
}

float rms(const float* data, uint32_t n) {
    double sum = 0.0;
    for (uint32_t i = 0; i < n; ++i) sum += double(data[i]) * data[i];
    return float(std::sqrt(sum / n));
}

}  // namespace

int main(int argc, char** argv) {
    // Where to fetch from. A local server by default so the test does not need
    // the internet; pass a base to point it at the live site.
    const std::string base = argc > 1 ? argv[1] : "http://127.0.0.1:6026";
    const double rate = 48000.0;

    std::cout << "fetching from " << base << "\n";

    // A network test that fails a build because nothing is serving is a test
    // that gets disabled. Skipped instead, loudly, with what to run.
    {
        jigdaw::Profile probe;
        const auto reachable = jigdaw::Chain::fetchProfile(base + "/plugins/pulse/", probe);
        if (reachable.find("could not reach") != std::string::npos) {
            std::cout << "  SKIP  nothing is serving at " << base
                      << "\n        start one with: PORT=6026 node bin/serve.js\n";
            return 77;   // ctest reads this as skipped
        }
    }

    {
        std::cout << "an instrument\n";
        jigdaw::Chain chain;
        const auto error = chain.add(base + "/plugins/pulse/", rate);
        check(error.empty(), error.empty() ? "loaded Pulse over HTTP" : "load failed: " + error);
        if (!error.empty()) return 1;

        check(chain.parameters().size() == 5, "five parameters, flattened");
        check(chain.maxFrames() == 128, "reports a block size");

        const uint32_t n = chain.maxFrames();
        std::vector<float> left(n, 0.0f), right(n, 0.0f);
        float* audio[2] = {left.data(), right.data()};

        chain.process(audio, 2, n);
        check(rms(left.data(), n) == 0.0f, "silent before a note");

        chain.noteOn(69, 100);
        float peak = 0.0f;
        for (int block = 0; block < 40; ++block) {
            std::fill(left.begin(), left.end(), 0.0f);
            chain.process(audio, 2, n);
            peak = std::max(peak, rms(left.data(), n));
        }
        check(peak > 0.01f, "sounds a note: peak " + std::to_string(peak));

        chain.noteOff(69);
        for (int block = 0; block < 400; ++block) chain.process(audio, 2, n);
        check(rms(left.data(), n) < 1e-6f, "silent again after note off");
    }

    {
        // The bytes a DAW actually sends. Until this existed the only way to
        // reach the decoding was a host and a keyboard, so the one part of the
        // adapter a person drives directly was the part nothing checked.
        std::cout << "pulse, driven by MIDI bytes\n";
        jigdaw::Chain chain;
        const auto error = chain.add(base + "/plugins/pulse/", rate);
        check(error.empty(), error.empty() ? "loaded Pulse" : "load failed: " + error);
        if (!error.empty()) return 1;

        const uint32_t n = chain.maxFrames();
        std::vector<float> left(n, 0.0f), right(n, 0.0f);
        float* audio[2] = {left.data(), right.data()};

        auto settle = [&](int blocks) {
            float peak = 0.0f;
            for (int b = 0; b < blocks; ++b) {
                chain.process(audio, 2, n);
                peak = std::max(peak, rms(left.data(), n));
            }
            return peak;
        };

        const uint8_t noteOn[3]      = {0x90, 69, 100};
        const uint8_t noteOnVel0[3]  = {0x90, 69, 0};
        const uint8_t noteOff[3]     = {0x80, 69, 0};
        const uint8_t allNotesOff[3] = {0xb0, 123, 0};
        const uint8_t allSoundOff[3] = {0xb0, 120, 0};

        check(jigdaw::applyMidi(chain, noteOn, 3), "note on is understood");
        check(settle(40) > 0.01f, "note on sounds");

        // A note on with velocity zero is a note off. A synth that misses this
        // sustains for ever, and most keyboards send it in preference to 0x80.
        check(jigdaw::applyMidi(chain, noteOnVel0, 3), "note on velocity 0 is understood");
        settle(400);
        check(rms(left.data(), n) < 1e-6f, "note on velocity 0 stops the note");

        jigdaw::applyMidi(chain, noteOn, 3);
        check(settle(40) > 0.01f, "sounds again");
        check(jigdaw::applyMidi(chain, noteOff, 3), "note off is understood");
        settle(400);
        check(rms(left.data(), n) < 1e-6f, "note off stops the note");

        jigdaw::applyMidi(chain, noteOn, 3);
        settle(40);
        check(jigdaw::applyMidi(chain, allNotesOff, 3), "CC 123 is understood");
        settle(400);
        check(rms(left.data(), n) < 1e-6f, "CC 123 stops everything");

        jigdaw::applyMidi(chain, noteOn, 3);
        settle(40);
        check(jigdaw::applyMidi(chain, allSoundOff, 3), "CC 120 is understood");
        settle(400);
        check(rms(left.data(), n) < 1e-6f, "CC 120 stops everything, which a DAW sends on stop");

        // Velocity has to reach the module, or every note is the same note.
        jigdaw::applyMidi(chain, noteOn, 3);
        const float loud = settle(40);
        jigdaw::applyMidi(chain, noteOff, 3);
        settle(400);
        const uint8_t quiet[3] = {0x90, 69, 20};
        jigdaw::applyMidi(chain, quiet, 3);
        const float soft = settle(40);
        jigdaw::applyMidi(chain, noteOff, 3);
        settle(400);
        check(soft < loud, "velocity changes the level: " + std::to_string(soft)
                           + " against " + std::to_string(loud));

        // Polyphony, because Pulse declares eight voices.
        const uint8_t chord[3][3] = {{0x90, 60, 100}, {0x90, 64, 100}, {0x90, 67, 100}};
        for (const auto& m : chord) jigdaw::applyMidi(chain, m, 3);
        const float three = settle(40);
        check(three > 0.01f, "a chord sounds: " + std::to_string(three));
        jigdaw::applyMidi(chain, allNotesOff, 3);
        settle(400);

        // Anything unrecognised is ignored rather than guessed at.
        const uint8_t pitchBend[3] = {0xe0, 0x00, 0x40};
        const uint8_t truncated[1] = {0x90};
        check(!jigdaw::applyMidi(chain, pitchBend, 3), "pitch bend is not claimed");
        check(!jigdaw::applyMidi(chain, truncated, 1), "a truncated message is refused");
        check(!jigdaw::applyMidi(chain, nullptr, 0), "no bytes at all is refused");
        settle(4);
        check(rms(left.data(), n) < 1e-6f, "and none of them made a sound");
    }

    {
        // The bug this guards against made the adapter silent in a DAW while
        // every other test passed. A host's slots read zero until something is
        // loaded, and zero normalised is the bottom of the port's range.
        std::cout << "parameters on a freshly loaded chain\n";
        jigdaw::Chain chain;
        const auto error = chain.add(base + "/plugins/pulse/", rate);
        check(error.empty(), error.empty() ? "loaded Pulse" : "load failed: " + error);
        if (!error.empty()) return 1;

        const auto& ports = chain.parameters();
        std::vector<float> values(16, 0.0f);
        std::vector<uint8_t> touched(16, 0);

        jigdaw::applyParameters(chain, values, touched);

        // Every untouched slot now reads back as its port's declared default.
        for (size_t i = 0; i < ports.size(); ++i) {
            const float span = ports[i].maximum - ports[i].minimum;
            const float real = ports[i].minimum + values[i] * span;
            check(std::fabs(real - ports[i].defaultValue) < 1e-4f,
                  ports[i].symbol + " sits at its declared default "
                  + std::to_string(ports[i].defaultValue));
        }

        const uint32_t n = chain.maxFrames();
        std::vector<float> left(n, 0.0f), right(n, 0.0f);
        float* audio[2] = {left.data(), right.data()};
        const uint8_t noteOn[3] = {0x90, 69, 100};
        jigdaw::applyMidi(chain, noteOn, 3);
        float peak = 0.0f;
        for (int b = 0; b < 40; ++b) { chain.process(audio, 2, n); peak = std::max(peak, rms(left.data(), n)); }
        check(peak > 0.01f, "and the plugin is audible without touching a control: "
                            + std::to_string(peak));

        // A slot the user moved keeps what they chose, so reloading a project
        // does not throw a mix away.
        std::vector<float> chosen(16, 0.0f);
        std::vector<uint8_t> moved(16, 0);
        chosen[4] = 0.25f;   // gain, Pulse's fifth port
        moved[4] = 1;
        jigdaw::Chain second;
        check(second.add(base + "/plugins/pulse/", rate).empty(), "loaded Pulse again");
        jigdaw::applyParameters(second, chosen, moved);
        check(chosen[4] == 0.25f, "a moved slot is left alone");
        check(std::fabs(chosen[3] - (second.parameters()[3].defaultValue - second.parameters()[3].minimum)
                                   / (second.parameters()[3].maximum - second.parameters()[3].minimum)) < 1e-4f,
              "while its neighbour still takes the default");
    }

    {
        // A panel is generated from these, so a profile that declares a
        // selector and a host that draws a slider is the same bug as a wrong
        // range. The browser panel reads the same statements.
        std::cout << "port metadata a panel needs\n";
        jigdaw::Chain chain;
        const auto error = chain.add(base + "/plugins/pulse/", rate);
        check(error.empty(), error.empty() ? "loaded Pulse" : "load failed: " + error);
        if (!error.empty()) return 1;

        const auto& ports = chain.at(0).ports;
        check(ports.size() == 5, "five ports");

        const jigdaw::Port& waveform = ports[0];
        check(waveform.enumeration, "waveform is declared an enumeration");
        check(waveform.scalePoints.size() == 3,
              "with three named values, not " + std::to_string(waveform.scalePoints.size()));
        check(waveform.labelFor(0.0f) == "Saw", "0 is Saw, got '" + waveform.labelFor(0.0f) + "'");
        check(waveform.labelFor(1.0f) == "Square", "1 is Square");
        check(waveform.labelFor(2.0f) == "Triangle", "2 is Triangle");
        // A value arrives having been round tripped through a normalised host
        // parameter, so it is rarely exactly the integer the profile wrote.
        check(waveform.labelFor(1.02f) == "Square", "1.02 is still Square");

        check(ports[1].unit == "ms", "attack is in ms, got '" + ports[1].unit + "'");
        check(ports[3].unit == "hz", "cutoff is in hz, got '" + ports[3].unit + "'");
        check(!ports[1].enumeration && ports[1].scalePoints.empty(),
              "a plain control names no values");
        check(!ports[1].toggled, "and is not a switch");
    }

    {
        // jig:Abi2 end to end: a plugin with no audio at all, driven by the
        // transport, emitting MIDI. None of this was possible under version 1.
        std::cout << "a MIDI generator\n";
        jigdaw::Chain chain;
        const auto error = chain.add(base + "/plugins/bassgen/", rate);
        check(error.empty(), error.empty() ? "loaded BassGen" : "load failed: " + error);
        if (!error.empty()) return 1;

        check(chain.producesMidi(), "the chain knows it produces MIDI");
        check(chain.parameters().size() == 13, "thirteen parameters, not "
              + std::to_string(chain.parameters().size()));

        const uint32_t n = chain.maxFrames();
        std::vector<float> left(n, 0.0f), right(n, 0.0f);
        float* audio[2] = {left.data(), right.data()};

        auto run = [&](int blocks) {
            int notesOn = 0, notesOff = 0;
            for (int b = 0; b < blocks; ++b) {
                chain.process(audio, 2, n);
                uint32_t produced = 0;
                const auto* events = chain.midiOut(produced);
                for (uint32_t i = 0; i < produced; ++i) {
                    check(events[i].frame < n, "an emitted event lands inside the block");
                    const uint8_t status = events[i].data[0] & 0xf0;
                    if (status == 0x90 && events[i].data[2] > 0) ++notesOn;
                    if (status == 0x80) ++notesOff;
                }
                // Advance the transport by one block, as a host would.
                auto& t = chain.transport();
                t.beat += (t.bpm / 60.0) * (double(n) / rate);
            }
            return std::pair<int, int>{notesOn, notesOff};
        };

        // Stopped: a generator with no idea what time it is produces nothing.
        chain.transport() = jigdaw::Transport{};
        const auto stopped = run(200);
        check(stopped.first == 0, "silent while the transport is stopped");

        // Rolling, with a tempo and a beat position.
        auto& t = chain.transport();
        t = jigdaw::Transport{};
        t.playing = 1;
        t.bpm = 120.0;
        t.beat = 0.0;
        t.numerator = 4;
        t.denominator = 4;
        t.valid = jigdaw::kTransportBpm | jigdaw::kTransportBeat | jigdaw::kTransportMeter;

        // 1000 blocks of 128 frames at 48 kHz is 2.67 seconds. At 120 bpm in
        // sixteenths that is about 21 steps, and the default density of 0.45
        // fills roughly half of them. Taken from the numbers rather than from a
        // feeling about how many notes is a lot.
        const auto rolling = run(1000);
        check(rolling.first >= 6, "generates notes once the transport rolls: "
              + std::to_string(rolling.first));
        // Monophonic by declaration, so every note that started must have ended.
        check(rolling.second >= rolling.first - 1,
              "every note is ended: " + std::to_string(rolling.first) + " on, "
              + std::to_string(rolling.second) + " off");

        // Playing is not a property of having a tempo: clearing it must stop.
        chain.transport().playing = 0;
        const auto after = run(200);
        check(after.first == 0, "stops when the transport stops");

        // The same seed is the same line, which is what a seed control means.
        auto lineFor = [&](float seed) {
            jigdaw::Chain fresh;
            if (!fresh.add(base + "/plugins/bassgen/", rate).empty()) return std::string();
            fresh.setParameter(11, seed);
            auto& tr = fresh.transport();
            tr.playing = 1; tr.bpm = 120.0; tr.beat = 0.0;
            tr.numerator = 4; tr.denominator = 4;
            tr.valid = jigdaw::kTransportBpm | jigdaw::kTransportBeat | jigdaw::kTransportMeter;
            std::string notes;
            std::vector<float> l(n, 0.0f), r(n, 0.0f);
            float* buffers[2] = {l.data(), r.data()};
            for (int b = 0; b < 200; ++b) {
                fresh.process(buffers, 2, n);
                uint32_t produced = 0;
                const auto* events = fresh.midiOut(produced);
                for (uint32_t i = 0; i < produced; ++i) {
                    if ((events[i].data[0] & 0xf0) == 0x90 && events[i].data[2] > 0) {
                        notes += std::to_string(events[i].data[1]) + " ";
                    }
                }
                auto& tr2 = fresh.transport();
                tr2.beat += (tr2.bpm / 60.0) * (double(n) / rate);
            }
            return notes;
        };
        const auto one = lineFor(1.0f);
        const auto again = lineFor(1.0f);
        const auto other = lineFor(7.0f);
        check(!one.empty(), "a seeded line has notes in it");
        check(one == again, "the same seed gives the same line");
        check(one != other, "a different seed gives a different line");
    }

    {
        // The point of routing MIDI between plugins: a generator drives an
        // instrument with no host in the middle. BassGen emits, Pulse sounds,
        // and nothing outside the chain carried a note between them.
        std::cout << "a generator driving an instrument\n";
        jigdaw::Chain chain;
        const auto a = chain.add(base + "/plugins/bassgen/", rate);
        const auto b = chain.add(base + "/plugins/pulse/", rate);
        check(a.empty() && b.empty(), "loaded BassGen into Pulse");
        if (!a.empty() || !b.empty()) return 1;

        const uint32_t n = chain.maxFrames();
        std::vector<float> left(n, 0.0f), right(n, 0.0f);
        float* audio[2] = {left.data(), right.data()};

        auto& t = chain.transport();
        t = jigdaw::Transport{};
        t.playing = 1; t.bpm = 120.0; t.beat = 0.0;
        t.numerator = 4; t.denominator = 4;
        t.valid = jigdaw::kTransportBpm | jigdaw::kTransportBeat | jigdaw::kTransportMeter;

        float peak = 0.0f;
        int emitted = 0;
        for (int block = 0; block < 1000; ++block) {
            std::fill(left.begin(), left.end(), 0.0f);
            std::fill(right.begin(), right.end(), 0.0f);
            chain.process(audio, 2, n);
            uint32_t produced = 0;
            const auto* events = chain.midiOut(produced);
            for (uint32_t i = 0; i < produced; ++i) {
                if ((events[i].data[0] & 0xf0) == 0x90 && events[i].data[2] > 0) ++emitted;
            }
            peak = std::max(peak, rms(left.data(), n));
            auto& tr = chain.transport();
            tr.beat += (tr.bpm / 60.0) * (double(n) / rate);
        }

        check(emitted > 0, "the generator emitted: " + std::to_string(emitted));
        check(peak > 0.01f, "and the instrument after it sounded: " + std::to_string(peak));

        // A generator has no audio output, so what passes through it must be
        // whatever was there. Writing silence instead would mute the chain, and
        // the instrument downstream is the thing that would go quiet.
        jigdaw::Chain quiet;
        check(quiet.add(base + "/plugins/bassgen/", rate).empty(), "loaded BassGen alone");
        for (uint32_t i = 0; i < n; ++i) left[i] = 0.5f;
        const std::vector<float> sent(left.begin(), left.end());
        quiet.process(audio, 2, n);
        float worst = 0.0f;
        for (uint32_t i = 0; i < n; ++i) worst = std::max(worst, std::fabs(left[i] - sent[i]));
        check(worst == 0.0f, "a plugin with no audio output leaves the audio alone");
    }

    {
        std::cout << "an effect\n";
        jigdaw::Chain chain;
        const auto error = chain.add(base + "/plugins/cascade/", rate);
        check(error.empty(), error.empty() ? "loaded Cascade over HTTP" : "load failed: " + error);
        if (!error.empty()) return 1;

        const uint32_t n = chain.maxFrames();
        std::vector<float> left(n, 0.0f), right(n, 0.0f);
        float* audio[2] = {left.data(), right.data()};

        // mix is index 0. At zero the dry signal must pass through untouched.
        chain.setParameter(0, 0.0f);
        for (uint32_t i = 0; i < n; ++i) left[i] = std::sin(i / 8.0f) * 0.5f;
        const std::vector<float> sent = left;
        chain.process(audio, 2, n);

        float worst = 0.0f;
        for (uint32_t i = 0; i < n; ++i) worst = std::max(worst, std::fabs(left[i] - sent[i]));
        check(worst == 0.0f, "passes dry signal through exactly at mix 0");

        chain.setParameter(0, 1.0f);
        std::fill(left.begin(), left.end(), 0.0f);
        left[0] = 1.0f;
        int heard = 0;
        for (int block = 0; block < 200; ++block) {
            chain.process(audio, 2, n);
            if (rms(left.data(), n) > 1e-9f) ++heard;
            std::fill(left.begin(), left.end(), 0.0f);
        }
        check(heard > 50, "produces a reverb tail: " + std::to_string(heard) + " of 200 blocks");
    }

    {
        std::cout << "a chain of both\n";
        jigdaw::Chain chain;
        const auto a = chain.add(base + "/plugins/pulse/", rate);
        const auto b = chain.add(base + "/plugins/cascade/", rate);
        check(a.empty() && b.empty(), "loaded two plugins in order");
        check(chain.size() == 2, "two slots");
        check(chain.parameters().size() == 10, "ten parameters across the chain");

        const uint32_t n = chain.maxFrames();
        std::vector<float> left(n, 0.0f), right(n, 0.0f);
        float* audio[2] = {left.data(), right.data()};

        chain.setParameter(5, 0.9f);   // Cascade's mix, which follows Pulse's five
        chain.noteOn(60, 100);
        float peak = 0.0f;
        for (int block = 0; block < 40; ++block) { chain.process(audio, 2, n); peak = std::max(peak, rms(left.data(), n)); }
        chain.noteOff(60);
        check(peak > 0.001f, "synth through reverb makes sound: peak " + std::to_string(peak));

        for (int block = 0; block < 120; ++block) chain.process(audio, 2, n);
        const float tail = rms(left.data(), n);
        check(tail > 0.0f, "the reverb outlives the note: " + std::to_string(tail));
    }

    {
        std::cout << "refusals\n";
        jigdaw::Chain chain;
        const auto missing = chain.add(base + "/plugins/nosuch/", rate);
        check(!missing.empty(), "refuses a plugin that is not there");

        jigdaw::Profile profile;
        const auto notAProfile = jigdaw::Chain::fetchProfile(base + "/app.bundle.js", profile);
        check(!notAProfile.empty(), "refuses a document that is not a profile");
    }

    std::cout << (failures == 0 ? "\nall passed\n" : "\n" + std::to_string(failures) + " failed\n");
    return failures == 0 ? 0 : 1;
}
