// native/jigdaw-adapter/src/Integrity.cpp
#include "jigdaw/Integrity.hpp"

#include <openssl/evp.h>

#include <algorithm>
#include <array>

namespace jigdaw {
namespace {

std::string toBase64(const unsigned char* data, size_t length) {
    static constexpr char table[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve(((length + 2) / 3) * 4);
    for (size_t i = 0; i < length; i += 3) {
        const unsigned v = (data[i] << 16) |
                           (i + 1 < length ? data[i + 1] << 8 : 0) |
                           (i + 2 < length ? data[i + 2] : 0);
        out += table[(v >> 18) & 0x3f];
        out += table[(v >> 12) & 0x3f];
        out += i + 1 < length ? table[(v >> 6) & 0x3f] : '=';
        out += i + 2 < length ? table[v & 0x3f] : '=';
    }
    return out;
}

const EVP_MD* digestFor(const std::string& algorithm) {
    if (algorithm == "sha256") return EVP_sha256();
    if (algorithm == "sha384") return EVP_sha384();
    if (algorithm == "sha512") return EVP_sha512();
    return nullptr;
}

}  // namespace

std::string digestOf(const std::vector<uint8_t>& bytes, const std::string& algorithm) {
    const EVP_MD* md = digestFor(algorithm);
    if (md == nullptr) return {};

    std::array<unsigned char, EVP_MAX_MD_SIZE> hash{};
    unsigned length = 0;
    EVP_MD_CTX* ctx = EVP_MD_CTX_new();
    EVP_DigestInit_ex(ctx, md, nullptr);
    EVP_DigestUpdate(ctx, bytes.data(), bytes.size());
    EVP_DigestFinal_ex(ctx, hash.data(), &length);
    EVP_MD_CTX_free(ctx);

    return algorithm + "-" + toBase64(hash.data(), length);
}

std::string verifyIntegrity(const std::vector<uint8_t>& bytes, const std::string& declared) {
    if (declared.empty()) {
        return "no integrity digest declared, and a resource without one cannot be loaded";
    }
    const auto dash = declared.find('-');
    if (dash == std::string::npos) return "malformed integrity digest: " + declared;

    const std::string algorithm = declared.substr(0, dash);
    if (digestFor(algorithm) == nullptr) {
        return "unsupported digest algorithm: " + algorithm + ". Expected sha256, sha384 or sha512.";
    }

    const std::string actual = digestOf(bytes, algorithm);
    if (actual != declared) {
        return "integrity mismatch: declared " + declared + ", got " + actual;
    }
    return {};
}

}  // namespace jigdaw
