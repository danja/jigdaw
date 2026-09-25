// native/jigdaw-adapter/tests/latency_test.cpp
//
// What the host is told about delay: a chain reports the sum of its
// plugins' jig_latency_frames exports, so the host can place the output.
// Found live, Quefrency playing 2047 frames late at 48 kHz with nothing told
// to the host: the module already exports the figure and the adapter never
// passed it on. file:// only: latency does not change with where the profile
// was fetched from.
#include <iostream>
#include <string>

#include "jigdaw/Chain.hpp"

namespace {
int failures = 0;
void check(bool condition, const std::string& what) {
    std::cout << (condition ? "  ok   " : "  FAIL ") << what << "\n";
    if (!condition) ++failures;
}
}  // namespace

int main(int argc, char** argv) {
    const std::string base = argc > 1 ? argv[1] : "http://127.0.0.1:6026";
    const double rate = 48000.0;

    {
        jigdaw::Profile probe;
        const auto reachable = jigdaw::Chain::fetchProfile(base + "/plugins/quefrency/", probe);
        if (reachable.find("could not reach") != std::string::npos) {
            std::cout << "  SKIP  nothing is serving at " << base << "\n";
            return 77;   // ctest reads this as skipped
        }
    }

    std::cout << "latency at 48 kHz\n";
    {
        jigdaw::Chain chain;
        const auto error = chain.add(base + "/plugins/pulse/", rate);
        check(error.empty(), error.empty() ? "loaded Pulse" : "load failed: " + error);
        if (!error.empty()) return 1;
        check(chain.latencyFrames() == 0, "an instrument with no latency reports none");
    }
    {
        jigdaw::Chain chain;
        const auto error = chain.add(base + "/plugins/quefrency/", rate);
        check(error.empty(), error.empty() ? "loaded Quefrency" : "load failed: " + error);
        if (!error.empty()) return 1;
        check(chain.latencyFrames() == 2047,
              "Quefrency reports 2047, the figure its ready message gives the browser");
    }
    {
        jigdaw::Chain chain;
        std::string error = chain.add(base + "/plugins/pulse/", rate);
        if (!error.empty()) { check(false, "load failed: " + error); return 1; }
        error = chain.add(base + "/plugins/quefrency/", rate);
        if (!error.empty()) { check(false, "load failed: " + error); return 1; }
        check(chain.latencyFrames() == 2047, "a chain sums its plugins' latencies");
    }

    if (failures > 0) std::cout << failures << " FAILURES\n";
    return failures == 0 ? 0 : 1;
}
