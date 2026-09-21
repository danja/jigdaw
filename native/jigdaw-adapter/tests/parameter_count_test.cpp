// native/jigdaw-adapter/tests/parameter_count_test.cpp
//
// JIGDAW_PARAMETER_COUNT is a compile-time constant the DPF wrapper declares
// to the host once, before any plugin is loaded, and a chain whose total
// port count exceeds it has parameters the host is never told about: found
// live, loading the 8-Bit 8asterd (42 ports) into a Reaper session that only
// ever asked about the first 16. This binds the constant to the plugin that
// most needs it, so the next plugin that outgrows it fails a build instead
// of a user's session.
#include <iostream>
#include <string>

#include "jigdaw/Chain.hpp"
#include "../src/dpf/DistrhoPluginInfo.h"

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

    std::cout << "fetching from " << base << "\n";

    jigdaw::Profile probe;
    const auto reachable = jigdaw::Chain::fetchProfile(base + "/plugins/8b8/", probe);
    if (reachable.find("could not reach") != std::string::npos) {
        std::cout << "  SKIP  nothing is serving at " << base
                  << "\n        start one with: PORT=6026 node bin/serve.js\n";
        return 77;
    }

    jigdaw::Chain chain;
    const auto error = chain.add(base + "/plugins/8b8/", rate);
    check(error.empty(), error.empty() ? "loaded the 8-Bit 8asterd" : "load failed: " + error);

    if (error.empty()) {
        const auto count = chain.parameters().size();
        std::cout << "  " << count << " parameters, " << JIGDAW_PARAMETER_COUNT
                  << " slots declared to the host\n";
        check(count <= JIGDAW_PARAMETER_COUNT,
              "fits within JIGDAW_PARAMETER_COUNT (" + std::to_string(JIGDAW_PARAMETER_COUNT) +
              "), or the host is never told the rest exist");
    }

    std::cout << (failures == 0 ? "PASS\n" : "FAIL\n");
    return failures == 0 ? 0 : 1;
}
