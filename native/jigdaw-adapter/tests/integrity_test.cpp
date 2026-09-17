// native/jigdaw-adapter/tests/integrity_test.cpp
#include <iostream>
#include <string>
#include <vector>

#include "jigdaw/Integrity.hpp"

namespace {
int failures = 0;
void check(bool ok, const std::string& what) {
    std::cout << (ok ? "  ok   " : "  FAIL ") << what << "\n";
    if (!ok) ++failures;
}
std::vector<uint8_t> bytesOf(const std::string& s) { return {s.begin(), s.end()}; }
}  // namespace

int main() {
    using namespace jigdaw;
    const auto hello = bytesOf("hello");

    std::cout << "digests\n";
    // Checked against the value the browser host computes for the same bytes,
    // so the two halves of this project agree about what a digest is.
    check(digestOf(hello) == "sha384-WeF0h3dEjGnea4ANejO7+5/xtGPkQ1TDVTvNucZm+pASWjx5+QOXvfX2oT3oKGhP",
          "sha384 of \"hello\" matches the browser host");
    check(digestOf(hello, "sha256").rfind("sha256-", 0) == 0, "sha256 is labelled");
    check(digestOf(hello, "md5").empty(), "an unsupported algorithm yields nothing");

    std::cout << "verifying\n";
    check(verifyIntegrity(hello, digestOf(hello)).empty(), "accepts matching bytes");
    check(!verifyIntegrity(bytesOf("hellp"), digestOf(hello)).empty(), "refuses one changed letter");
    check(verifyIntegrity(hello, "").find("cannot be loaded") != std::string::npos,
          "refuses an absent digest, saying why");
    check(!verifyIntegrity(hello, "md5-abc").empty(), "refuses an unsupported algorithm");
    check(!verifyIntegrity(hello, "garbage").empty(), "refuses a malformed digest");

    const auto mismatch = verifyIntegrity(bytesOf("other"), digestOf(hello));
    check(mismatch.find("declared") != std::string::npos && mismatch.find("got") != std::string::npos,
          "a mismatch reports both digests");

    std::cout << (failures == 0 ? "\nall passed\n" : "\n" + std::to_string(failures) + " failed\n");
    return failures == 0 ? 0 : 1;
}
