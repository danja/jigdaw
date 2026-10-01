// native/jigdaw-adapter/tools/wamr_time.cpp
//
// Times a plugin through the adapter's real Chain, which runs it in WAMR's pure
// interpreter, against the audio it renders. It exists because the render budget
// in node runs under the JIT and a plugin that is cheap there can overrun on
// every block here (MISTAKES.md, the Mop entry). Diagnostic, not an assertion:
// machines differ, so the figures are recorded with the date and not tested.
//
// Not built by CMake. From native/build, after the adapter has been built:
//   c++ -O3 -DNDEBUG -std=gnu++20 -mindirect-branch-register $(sed -n 7p \
//     jigdaw-adapter/CMakeFiles/test_chain.dir/flags.make | sed 's/CXX_INCLUDES = //') \
//     ../jigdaw-adapter/tools/wamr_time.cpp -o wamr_time \
//     jigdaw-adapter/libjigdaw_core.a jigdaw-adapter/libwamr_vmlib.a -lssl -lcrypto -lpthread
// Serve the plugins with PORT=6026 node bin/serve.js, then:
//   ./wamr_time http://127.0.0.1:6026 keyframe 512 time_rate=80 pitch_shift=3 quality=2
// Arguments after the block size are symbol=value, set before timing. The input is
// seven seconds of dense stereo after one untimed second.
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>
#include "jigdaw/Chain.hpp"

int main(int argc, char** argv) {
    const std::string base = argv[1], name = argv[2];
    const double rate = 48000.0, seconds = 8.0;
    const int block = argc > 3 ? atoi(argv[3]) : 512;
    // each remaining arg is symbol=value
    jigdaw::Chain chain;
    const auto err = chain.add(base + "/plugins/" + name + "/", rate);
    if (!err.empty()) { fprintf(stderr, "load failed: %s\n", err.c_str()); return 2; }
    for (int i = 4; i < argc; ++i) {
        std::string a = argv[i]; auto eq = a.find('=');
        const std::string sym = a.substr(0, eq); const float v = atof(a.c_str() + eq + 1);
        bool found = false;
        for (size_t p = 0; p < chain.parameters().size(); ++p)
            if (chain.parameters()[p].symbol == sym) { chain.setParameter(p, v); found = true; }
        if (!found) { fprintf(stderr, "no parameter %s\n", sym.c_str()); return 3; }
    }
    const size_t total = size_t(seconds * rate);
    std::vector<float> l(total), r(total);
    unsigned s = 1;
    for (size_t i = 0; i < total; ++i) {
        s = s * 1103515245u + 12345u;
        const float n = ((s >> 8) & 0xffff) / 32768.0f - 1.0f;
        const float x = 0.3f * std::sin(i * 0.013f) + 0.2f * std::sin(i * 0.11f) + 0.1f * std::sin(i * 0.9f) + 0.05f * n;
        l[i] = x; r[i] = x;
    }
    // Warm: one second, not timed.
    auto run = [&](size_t from, size_t to) {
        for (size_t at = from; at < to; at += block) {
            const uint32_t n = uint32_t(std::min<size_t>(block, to - at));
            float* ch[2] = { l.data() + at, r.data() + at };
            chain.process(ch, 2, n);
        }
    };
    run(0, size_t(rate));
    const auto t0 = std::chrono::steady_clock::now();
    run(size_t(rate), total);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    double peak = 0; for (size_t i = size_t(rate); i < total; ++i) peak = std::max(peak, double(std::fabs(l[i])));
    printf("%.4f x realtime  (%.3f s wall for %.1f s)  peak %.3f\n", wall / (seconds - 1.0), wall, seconds - 1.0, peak);
    return 0;
}
