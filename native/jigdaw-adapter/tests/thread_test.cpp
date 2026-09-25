// native/jigdaw-adapter/tests/thread_test.cpp
//
// A load runs on whichever thread triggers it — an editor worker fetching a
// chain, the message thread restoring a session — and WAMR answers a first
// call from a thread it did not create itself with "thread signal env not
// inited". Module::load() registered no thread, so whether a load worked
// depended on what that thread had done before: found live, Quefrency
// failing its jig_init while every previously loaded plugin had succeeded.
// This loads on the main thread and then on a thread nothing has touched,
// which is the editor worker case exactly.
#include <iostream>
#include <string>
#include <thread>

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
    const std::string iri = base + "/plugins/pulse/";

    {
        jigdaw::Profile probe;
        const auto reachable = jigdaw::Chain::fetchProfile(iri, probe);
        if (reachable.find("could not reach") != std::string::npos) {
            std::cout << "  SKIP  nothing is serving at " << base << "\n";
            return 77;   // ctest reads this as skipped
        }
    }

    std::cout << "loading on this thread\n";
    {
        jigdaw::Chain chain;
        const auto error = chain.add(iri, rate);
        check(error.empty(), error.empty() ? "loaded Pulse here" : "load failed: " + error);
        if (!error.empty()) return 1;
    }

    std::cout << "loading on a thread nothing has touched\n";
    {
        std::string error;
        std::thread worker([&] {
            jigdaw::Chain chain;
            error = chain.add(iri, rate);
        });
        worker.join();
        check(error.empty(), error.empty() ? "loaded Pulse there" : "load failed: " + error);
    }

    if (failures > 0) std::cout << failures << " FAILURES\n";
    return failures == 0 ? 0 : 1;
}
