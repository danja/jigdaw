// native/jigdaw-adapter/include/jigdaw/TextField.hpp
//
// The IRI field's string half: splitting field text into drawn lines, and
// normalising pasted clipboard text. The NanoVG drawing and the DPF event
// wiring stay in src/dpf/JigdawUI.cpp; this is what both ends must agree on,
// which is why it is shared and tested rather than inline in the drawing.
// A caret derived from a different line count than the drawing loop is how
// the cursor came to sit a line too high.
#pragma once

#include <cstddef>
#include <string>
#include <vector>

namespace jigdaw {

/// One entry per drawn line, keeping the empty line a trailing newline
/// implies: the caret after "abc\n" is on line two, and an empty field still
/// takes a caret on line one. The drawing loop and the caret computation
/// both read this list, so the two cannot disagree about which line is last.
inline std::vector<std::string> fieldLines(const std::string& text) {
    // Split by hand rather than by getline: the loop below keeps the empty
    // line a trailing newline implies ("abc\n" is two caret lines), which a
    // getline loop silently drops.
    std::vector<std::string> parts;
    std::string::size_type start = 0;
    while (true) {
        const auto at = text.find('\n', start);
        if (at == std::string::npos) {
            parts.push_back(text.substr(start));
            break;
        }
        parts.push_back(text.substr(start, at - start));
        start = at + 1;
    }
    return parts;
}

/// Clipboard bytes to field text. Line endings are normalised: a Windows
/// \r\n pasted verbatim would leave \r at the end of every IRI and fail
/// every load with no visible cause.
inline std::string normalisePastedText(const char* data, std::size_t size) {
    if (data == nullptr || size == 0) return {};
    std::string out;
    out.reserve(size);
    for (std::size_t i = 0; i < size; ++i) {
        if (data[i] == '\r') {
            if (i + 1 < size && data[i + 1] == '\n') continue;
            out += '\n';
        } else {
            out += data[i];
        }
    }
    return out;
}

}  // namespace jigdaw
