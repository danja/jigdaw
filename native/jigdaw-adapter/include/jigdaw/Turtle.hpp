// native/jigdaw-adapter/include/jigdaw/Turtle.hpp
#pragma once

#include <string>
#include <vector>

namespace jigdaw::turtle {

/// One statement, with every term already expanded to an absolute form.
struct Triple {
    std::string subject;
    std::string predicate;
    std::string object;
    bool objectIsLiteral = false;
};

struct Document {
    bool ok = false;
    std::string error;
    std::string base;
    std::vector<Triple> triples;
};

/// Parse the subset of Turtle that a JigDAW profile uses.
///
/// Not a general parser, and it says so where it stops. A profile is a small
/// generated document: prefixes, a base, IRIs, string literals, numbers,
/// booleans, and the `;` and `,` shorthands. It has no blank nodes, because the
/// format forbids them for anything addressable, and no collections.
///
/// Written rather than vendored because the alternatives are a dependency of
/// their own, and this is about four hundred lines that can be read in one
/// sitting. If a profile ever needs more Turtle than this, that is a signal
/// worth having: it means the format has grown something it should not have.
Document parse(const std::string& text, const std::string& documentBase);

/// Resolve a possibly relative IRI against a base, as RFC 3986 does.
std::string resolve(const std::string& reference, const std::string& base);

}  // namespace jigdaw::turtle
