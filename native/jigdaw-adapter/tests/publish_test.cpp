// native/jigdaw-adapter/tests/publish_test.cpp
//
// The publication rule, scripted: the audio thread announces what it runs,
// the message thread retires rather than frees, and reaping frees only what
// is not announced. A retired chain held across a swap must survive the reap
// and go on the next one, once let go.
#include <atomic>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

#include "jigdaw/Chain.hpp"
#include "jigdaw/Publish.hpp"

namespace {
int failures = 0;
void check(bool condition, const std::string& what) {
    std::cout << (condition ? "  ok   " : "  FAIL ") << what << "\n";
    if (!condition) ++failures;
}
}  // namespace

int main() {
    using jigdaw::acquireStable;
    using jigdaw::Chain;
    using jigdaw::reapChains;
    using jigdaw::releaseSlot;
    using jigdaw::retireChain;

    std::atomic<Chain*> published{nullptr};
    std::atomic<Chain*> announced{nullptr};
    std::vector<std::unique_ptr<Chain>> retired;

    std::cout << "nothing published\n";
    check(acquireStable(published, announced) == nullptr, "acquiring emptiness gives nothing");
    releaseSlot(announced);

    std::cout << "publish, run, replace under a held announcement\n";
    auto* first = new Chain();
    published.store(first, std::memory_order_release);
    check(acquireStable(published, announced) == first, "the audio thread holds the first chain");

    auto* second = new Chain();
    Chain* previous = published.exchange(second, std::memory_order_acq_rel);
    retireChain(retired, previous);
    check(retired.size() == 1, "the replaced chain is retired, not freed");
    check(reapChains(retired, announced.load(std::memory_order_acquire)) == 0,
          "reaping while announced frees nothing");
    check(retired.size() == 1, "the announced chain survives the reap");

    releaseSlot(announced);
    check(reapChains(retired, announced.load(std::memory_order_acquire)) == 1,
          "reaping after release frees it");
    check(retired.empty(), "nothing retired remains");

    std::cout << "a swap the audio thread never saw\n";
    check(acquireStable(published, announced) == second, "the audio thread holds the second chain");
    auto* third = new Chain();
    previous = published.exchange(third, std::memory_order_acq_rel);
    retireChain(retired, previous);
    releaseSlot(announced);
    check(reapChains(retired, announced.load(std::memory_order_acquire)) == 1,
          "an unannounced chain is freed on the first reap");

    delete published.load(std::memory_order_acquire);
    published.store(nullptr, std::memory_order_release);

    if (failures > 0) std::cout << failures << " FAILURES\n";
    return failures == 0 ? 0 : 1;
}
