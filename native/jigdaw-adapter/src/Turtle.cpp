// native/jigdaw-adapter/src/Turtle.cpp
#include "jigdaw/Turtle.hpp"

#include <cctype>
#include <functional>
#include <map>
#include <stdexcept>

namespace jigdaw::turtle {
namespace {

/// RFC 3986 dot-segment removal, which is the part of resolution people get wrong.
std::string removeDotSegments(std::string path) {
    std::string out;
    while (!path.empty()) {
        if (path.rfind("../", 0) == 0) path.erase(0, 3);
        else if (path.rfind("./", 0) == 0) path.erase(0, 2);
        else if (path.rfind("/./", 0) == 0) path.replace(0, 3, "/");
        else if (path == "/.") path = "/";
        else if (path.rfind("/../", 0) == 0) {
            path.replace(0, 4, "/");
            const auto slash = out.find_last_of('/');
            out.erase(slash == std::string::npos ? 0 : slash);
        } else if (path == "/..") {
            path = "/";
            const auto slash = out.find_last_of('/');
            out.erase(slash == std::string::npos ? 0 : slash);
        } else if (path == "." || path == "..") {
            path.clear();
        } else {
            const auto next = path.find('/', path.front() == '/' ? 1 : 0);
            out.append(path, 0, next == std::string::npos ? path.size() : next);
            path.erase(0, next == std::string::npos ? path.size() : next);
        }
    }
    return out;
}

bool hasScheme(const std::string& s) {
    const auto colon = s.find(':');
    if (colon == std::string::npos || colon == 0) return false;
    if (!std::isalpha(static_cast<unsigned char>(s[0]))) return false;
    for (size_t i = 1; i < colon; ++i) {
        const char c = s[i];
        if (!std::isalnum(static_cast<unsigned char>(c)) && c != '+' && c != '-' && c != '.') return false;
    }
    return true;
}

struct Reader {
    const std::string& text;
    size_t at = 0;

    bool done() const { return at >= text.size(); }
    char peek() const { return at < text.size() ? text[at] : '\0'; }

    void skip() {
        while (at < text.size()) {
            const char c = text[at];
            if (c == '#') {
                while (at < text.size() && text[at] != '\n') ++at;
            } else if (std::isspace(static_cast<unsigned char>(c))) {
                ++at;
            } else {
                break;
            }
        }
    }

    bool literal(const char* word) {
        skip();
        const size_t n = std::char_traits<char>::length(word);
        if (text.compare(at, n, word) != 0) return false;
        at += n;
        return true;
    }
};

[[noreturn]] void fail(const Reader& r, const std::string& what) {
    size_t line = 1;
    for (size_t i = 0; i < r.at && i < r.text.size(); ++i) if (r.text[i] == '\n') ++line;
    throw std::runtime_error("line " + std::to_string(line) + ": " + what);
}

}  // namespace

std::string resolve(const std::string& reference, const std::string& base) {
    if (reference.empty()) return base;
    if (hasScheme(reference)) return reference;
    if (base.empty()) return reference;

    // Split the base into scheme://authority and path, discarding its own
    // query and fragment, which a reference never inherits.
    const auto schemeEnd = base.find("://");
    if (schemeEnd == std::string::npos) return reference;
    const auto authorityEnd = base.find('/', schemeEnd + 3);
    const std::string origin = authorityEnd == std::string::npos ? base : base.substr(0, authorityEnd);
    std::string basePath = authorityEnd == std::string::npos ? "/" : base.substr(authorityEnd);
    basePath = basePath.substr(0, basePath.find_first_of("?#"));

    if (reference[0] == '#') return base.substr(0, base.find('#')) + reference;
    if (reference.rfind("//", 0) == 0) return base.substr(0, schemeEnd + 1) + reference;
    if (reference[0] == '/') return origin + removeDotSegments(reference);

    const auto lastSlash = basePath.find_last_of('/');
    const std::string dir = lastSlash == std::string::npos ? "/" : basePath.substr(0, lastSlash + 1);
    return origin + removeDotSegments(dir + reference);
}

Document parse(const std::string& text, const std::string& documentBase) {
    Document doc;
    doc.base = documentBase;
    Reader r{text};

    std::map<std::string, std::string> prefixes;

    auto readIri = [&]() -> std::string {
        r.skip();
        if (r.peek() != '<') fail(r, "expected an IRI in angle brackets");
        ++r.at;
        std::string value;
        while (!r.done() && r.peek() != '>') value += text[r.at++];
        if (r.done()) fail(r, "unterminated IRI");
        ++r.at;
        return value;
    };

    auto readPrefixedName = [&]() -> std::string {
        r.skip();
        std::string prefix;
        while (!r.done() && r.peek() != ':' && !std::isspace(static_cast<unsigned char>(r.peek()))) {
            prefix += text[r.at++];
        }
        if (r.peek() != ':') fail(r, "expected ':' in a prefixed name");
        ++r.at;
        std::string local;
        while (!r.done()) {
            const char c = r.peek();
            if (std::isalnum(static_cast<unsigned char>(c)) || c == '_' || c == '-' || c == '.') {
                // A trailing dot ends the statement rather than the name.
                if (c == '.' && (r.at + 1 >= text.size() ||
                    !(std::isalnum(static_cast<unsigned char>(text[r.at + 1])) || text[r.at + 1] == '_'))) break;
                local += text[r.at++];
            } else {
                break;
            }
        }
        const auto found = prefixes.find(prefix);
        if (found == prefixes.end()) fail(r, "no such prefix: " + prefix);
        return found->second + local;
    };

    auto readString = [&]() -> std::string {
        // Long strings first, or the opening quote of one is read as an empty
        // string and everything after it becomes garbage.
        const bool longForm = text.compare(r.at, 3, "\"\"\"") == 0;
        const size_t quoteLen = longForm ? 3 : 1;
        r.at += quoteLen;
        std::string value;
        while (!r.done()) {
            if (text[r.at] == '\\' && r.at + 1 < text.size()) {
                const char escape = text[r.at + 1];
                switch (escape) {
                    case 'n': value += '\n'; break;
                    case 't': value += '\t'; break;
                    case 'r': value += '\r'; break;
                    case '"': value += '"'; break;
                    case '\\': value += '\\'; break;
                    default: value += escape;
                }
                r.at += 2;
                continue;
            }
            if (text.compare(r.at, quoteLen, longForm ? "\"\"\"" : "\"") == 0) {
                r.at += quoteLen;
                return value;
            }
            value += text[r.at++];
        }
        fail(r, "unterminated string");
    };

    try {
        std::string subject;
        std::string predicate;
        int blankCount = 0;

        // A blank node is fine for something that is not addressable: a scale
        // point has no identity worth naming, and the format uses one there.
        // The rule the format actually states is that nothing ADDRESSABLE may
        // be a blank node, which is a narrower thing than forbidding them.
        std::function<std::string()> readBlank = [&]() -> std::string {
            const std::string label = "_:b" + std::to_string(++blankCount);
            ++r.at;  // past '['
            r.skip();
            if (r.peek() == ']') { ++r.at; return label; }

            while (true) {
                r.skip();
                std::string innerPredicate;
                if (r.peek() == '<') innerPredicate = resolve(readIri(), doc.base);
                else if (text.compare(r.at, 1, "a") == 0 &&
                         (r.at + 1 >= text.size() || std::isspace(static_cast<unsigned char>(text[r.at + 1])))) {
                    ++r.at;
                    innerPredicate = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
                } else innerPredicate = readPrefixedName();

                r.skip();
                Triple inner{label, innerPredicate, {}, false};
                const char c = r.peek();
                if (c == '"') { inner.object = readString(); inner.objectIsLiteral = true; }
                else if (c == '<') inner.object = resolve(readIri(), doc.base);
                else if (c == '[') inner.object = readBlank();
                else if (std::isdigit(static_cast<unsigned char>(c)) || c == '-' || c == '+') {
                    std::string number;
                    while (!r.done()) {
                        const char d = r.peek();
                        if (std::isdigit(static_cast<unsigned char>(d)) || d == '-' || d == '+' || d == 'e' || d == 'E') { number += text[r.at++]; continue; }
                        if (d == '.' && r.at + 1 < text.size() && std::isdigit(static_cast<unsigned char>(text[r.at + 1]))) { number += text[r.at++]; continue; }
                        break;
                    }
                    inner.object = number;
                    inner.objectIsLiteral = true;
                } else inner.object = readPrefixedName();
                doc.triples.push_back(std::move(inner));

                r.skip();
                if (r.peek() == ';') { ++r.at; r.skip(); if (r.peek() == ']') { ++r.at; break; } continue; }
                if (r.peek() == ']') { ++r.at; break; }
                fail(r, "expected ';' or ']' inside a blank node");
            }
            return label;
        };

        while (true) {
            r.skip();
            if (r.done()) break;

            if (text.compare(r.at, 7, "@prefix") == 0) {
                r.at += 7;
                r.skip();
                std::string prefix;
                while (!r.done() && r.peek() != ':') prefix += text[r.at++];
                ++r.at;
                prefixes[prefix] = readIri();
                if (!r.literal(".")) fail(r, "expected '.' after @prefix");
                continue;
            }
            if (text.compare(r.at, 5, "@base") == 0) {
                r.at += 5;
                doc.base = readIri();
                if (!r.literal(".")) fail(r, "expected '.' after @base");
                continue;
            }

            // Subject.
            r.skip();
            if (r.peek() == '<') subject = resolve(readIri(), doc.base);
            else if (r.peek() == '[') subject = readBlank();
            else subject = readPrefixedName();

            bool morePredicates = true;
            while (morePredicates) {
                r.skip();
                if (text.compare(r.at, 1, "a") == 0 &&
                    (r.at + 1 >= text.size() || std::isspace(static_cast<unsigned char>(text[r.at + 1])))) {
                    ++r.at;
                    predicate = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
                } else if (r.peek() == '<') {
                    predicate = resolve(readIri(), doc.base);
                } else {
                    predicate = readPrefixedName();
                }

                bool moreObjects = true;
                while (moreObjects) {
                    r.skip();
                    Triple triple{subject, predicate, {}, false};
                    const char c = r.peek();
                    if (c == '"') {
                        triple.object = readString();
                        triple.objectIsLiteral = true;
                        // A datatype or language tag is read and discarded: the
                        // values a profile carries are unambiguous without one.
                        r.skip();
                        if (r.peek() == '^') { r.at += 2; if (r.peek() == '<') readIri(); else readPrefixedName(); }
                        else if (r.peek() == '@') { ++r.at; while (!r.done() && !std::isspace(static_cast<unsigned char>(r.peek())) && r.peek() != ',' && r.peek() != ';' && r.peek() != '.') ++r.at; }
                    } else if (c == '<') {
                        triple.object = resolve(readIri(), doc.base);
                    } else if (std::isdigit(static_cast<unsigned char>(c)) || c == '-' || c == '+' || c == '.') {
                        std::string number;
                        while (!r.done()) {
                            const char d = r.peek();
                            if (std::isdigit(static_cast<unsigned char>(d)) || d == '-' || d == '+' || d == 'e' || d == 'E') { number += text[r.at++]; continue; }
                            if (d == '.') {
                                // A dot is part of the number only if a digit follows.
                                if (r.at + 1 < text.size() && std::isdigit(static_cast<unsigned char>(text[r.at + 1]))) { number += text[r.at++]; continue; }
                                break;
                            }
                            break;
                        }
                        triple.object = number;
                        triple.objectIsLiteral = true;
                    } else if (text.compare(r.at, 4, "true") == 0 || text.compare(r.at, 5, "false") == 0) {
                        const bool yes = text[r.at] == 't';
                        r.at += yes ? 4 : 5;
                        triple.object = yes ? "true" : "false";
                        triple.objectIsLiteral = true;
                    } else if (c == '[') {
                        triple.object = readBlank();
                    } else {
                        triple.object = readPrefixedName();
                    }

                    doc.triples.push_back(std::move(triple));

                    r.skip();
                    if (r.peek() == ',') { ++r.at; continue; }
                    moreObjects = false;
                }

                r.skip();
                if (r.peek() == ';') {
                    ++r.at;
                    r.skip();
                    // A trailing `;` before the `.` is legal and means nothing more.
                    if (r.peek() == '.') { ++r.at; morePredicates = false; }
                    continue;
                }
                if (r.peek() == '.') { ++r.at; morePredicates = false; continue; }
                if (r.done()) { morePredicates = false; continue; }
                fail(r, std::string("expected ';' or '.', found '") + r.peek() + "'");
            }
        }
        doc.ok = true;
    } catch (const std::exception& error) {
        doc.ok = false;
        doc.error = error.what();
    }

    return doc;
}

}  // namespace jigdaw::turtle
