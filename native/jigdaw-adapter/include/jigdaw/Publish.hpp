// native/jigdaw-adapter/include/jigdaw/Publish.hpp
//
// One chain at a time, shared between the thread that builds chains and the
// thread that runs them. Publishing by atomic swap and freeing the retired
// chain on the spot is a use-after-free the moment the audio thread is
// mid-process on it: found live, crashing Reaper on plugin load. So the
// audio thread announces the chain it is about to run, the message thread
// retires rather than frees, and reaping frees only what is not announced.
//
// One audio thread is assumed, which both wrappers already assume everywhere
// else: a single announcement slot. The message thread never waits on the
// audio thread, so nothing here can deadlock; the audio thread takes only a
// few atomics, so nothing here can stall it either. A retired chain the
// audio thread holds onto across many loads waits until it lets go, which
// bounds the leak to one chain per load in the pathological case and frees
// everything at teardown regardless.
#pragma once

#include <atomic>
#include <cstddef>
#include <memory>
#include <vector>

#include "jigdaw/Chain.hpp"

namespace jigdaw {

/// The chain to run, guaranteed stable: announced before the second load and
/// re-acquired while the announcement disagrees, so a swap landing mid-read
/// retries rather than handing back a chain already retired. May be nullptr
/// when nothing is published yet.
inline Chain* acquireStable(std::atomic<Chain*>& published, std::atomic<Chain*>& announced) {
    Chain* current = published.load(std::memory_order_acquire);
    for (;;) {
        announced.store(current, std::memory_order_release);
        Chain* fresh = published.load(std::memory_order_acquire);
        if (fresh == current) return current;
        current = fresh;
    }
}

/// Done running: withdraw the announcement. The chain itself is untouched;
/// freeing is the reaper's job, on the message thread.
inline void releaseSlot(std::atomic<Chain*>& announced) {
    announced.store(nullptr, std::memory_order_release);
}

/// Take ownership of a chain the publication no longer points at. The chain
/// is not freed here: the audio thread may still be running it, announced
/// above, and only the reaper below may decide it is done.
inline void retireChain(std::vector<std::unique_ptr<Chain>>& retired, Chain* old) {
    if (old != nullptr) retired.emplace_back(old);
}

/// Free every retired chain the audio thread is not announcing. Returns how
/// many went, so a test can say what survived and what did not.
inline std::size_t reapChains(std::vector<std::unique_ptr<Chain>>& retired, Chain* announced) {
    std::size_t freed = 0;
    for (auto it = retired.begin(); it != retired.end();) {
        if (it->get() == announced) {
            ++it;
            continue;
        }
        it = retired.erase(it);
        ++freed;
    }
    return freed;
}

}  // namespace jigdaw
