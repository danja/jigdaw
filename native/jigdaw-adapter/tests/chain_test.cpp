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
