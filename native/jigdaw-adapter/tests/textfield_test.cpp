// native/jigdaw-adapter/tests/textfield_test.cpp
#include <cassert>
#include <iostream>
#include <string>
#include <vector>

#include "jigdaw/TextField.hpp"

namespace {
int failures = 0;
void check(bool ok, const std::string& what) {
    std::cout << (ok ? "  ok   " : "  FAIL ") << what << "\n";
    if (!ok) ++failures;
}
std::string join(const std::vector<std::string>& parts) {
    std::string out;
    for (size_t i = 0; i < parts.size(); ++i) {
        if (i > 0) out += "|";
        out += parts[i];
    }
    return out;
}
}  // namespace

int main() {
    using jigdaw::fieldLines;
    using jigdaw::normalisePastedText;

    std::cout << "field lines\n";
    // An empty field still takes one caret line: drawing nothing and putting
    // the caret a line above it was the reported cursor bug.
    check(join(fieldLines("")) == "", "empty is one empty line");
    check(fieldLines("").size() == 1, "empty is exactly one line");
    check(join(fieldLines("abc")) == "abc", "a single line");
    // The trailing newline implies an empty second line: the caret after
    // "abc\n" is on line two, and drawing only line one left it a line high.
    check(join(fieldLines("abc\n")) == "abc|", "trailing newline keeps its line");
    check(join(fieldLines("a\nb")) == "a|b", "two lines");
    check(join(fieldLines("a\nb\n")) == "a|b|", "two lines and a trailing newline");
    check(join(fieldLines("\n")) == "|", "a lone newline is two empty lines");
    // The caret line is the last entry, which is what the drawing loop and
    // the caret computation both read.
    check(fieldLines("abc\n").back().empty(), "caret line after a trailing newline is empty");
    check(fieldLines("abc").back() == "abc", "caret line without one holds the text");

    std::cout << "pasted text\n";
    check(normalisePastedText(nullptr, 0).empty(), "no clipboard is no text");
    check(normalisePastedText("abc", 3) == "abc", "plain text passes through");
    check(normalisePastedText("a\r\nb", 4) == "a\nb", "CRLF becomes LF");
    check(normalisePastedText("a\rb", 3) == "a\nb", "a lone CR becomes LF");
    check(normalisePastedText("a\r\nb\r\n", 6) == "a\nb\n", "trailing CRLF keeps its line");

    if (failures > 0) std::cout << failures << " FAILURES\n";
    return failures;
}
