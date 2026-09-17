// native/jigdaw-adapter/tests/turtle_test.cpp
#include <cassert>
#include <iostream>
#include <string>

#include "jigdaw/Turtle.hpp"

namespace {
int failures = 0;
void check(bool ok, const std::string& what) {
    std::cout << (ok ? "  ok   " : "  FAIL ") << what << "\n";
    if (!ok) ++failures;
}
bool has(const jigdaw::turtle::Document& d, const std::string& s, const std::string& p, const std::string& o) {
    for (const auto& t : d.triples) if (t.subject == s && t.predicate == p && t.object == o) return true;
    return false;
}
}  // namespace

int main() {
    using jigdaw::turtle::parse;
    using jigdaw::turtle::resolve;

    std::cout << "resolving references\n";
    check(resolve("b.wasm", "https://x.example/p/a/") == "https://x.example/p/a/b.wasm", "relative");
    check(resolve("/b.wasm", "https://x.example/p/a/") == "https://x.example/b.wasm", "rooted");
    check(resolve("https://y.example/b", "https://x.example/p/") == "https://y.example/b", "absolute is left alone");
    check(resolve("../b", "https://x.example/p/a/") == "https://x.example/p/b", "dot segments");
    check(resolve("", "https://x.example/p/") == "https://x.example/p/", "empty is the base itself");

    std::cout << "parsing\n";
    const auto doc = parse(R"(
@base <https://x.example/p/> .
@prefix jig: <http://purl.org/stuff/jigdaw/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

<> a jig:WebPlugin ;
   rdfs:label "Thing" ;
   jig:audioOutputs 1 ;
   jig:module <#m> ;
   jig:tag "a" , "b" .

<#m> jig:location <thing.wasm> ; jig:abi jig:Abi1 .
)", "https://x.example/p/");

    check(doc.ok, doc.ok ? "a profile parses" : "parse failed: " + doc.error);
    check(has(doc, "https://x.example/p/", "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
              "http://purl.org/stuff/jigdaw/WebPlugin"), "'a' is rdf:type");
    check(has(doc, "https://x.example/p/", "http://www.w3.org/2000/01/rdf-schema#label", "Thing"), "a literal");
    check(has(doc, "https://x.example/p/", "http://purl.org/stuff/jigdaw/audioOutputs", "1"), "a number");
    check(has(doc, "https://x.example/p/#m", "http://purl.org/stuff/jigdaw/location",
              "https://x.example/p/thing.wasm"), "a relative IRI resolves against @base");
    check(has(doc, "https://x.example/p/", "http://purl.org/stuff/jigdaw/tag", "a") &&
          has(doc, "https://x.example/p/", "http://purl.org/stuff/jigdaw/tag", "b"), "a comma list");

    std::cout << "blank nodes, which a profile uses for scale points\n";
    const auto points = parse(R"(
@prefix lv2: <http://lv2plug.in/ns/lv2core#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
<https://x.example/p#mode> lv2:scalePoint
  [ rdfs:label "Plate" ; rdf:value 0 ] ,
  [ rdfs:label "Hall" ; rdf:value 1 ] .
)", "https://x.example/");
    check(points.ok, points.ok ? "a blank node parses" : "failed: " + points.error);
    int labels = 0;
    for (const auto& t : points.triples) {
        if (t.predicate == "http://www.w3.org/2000/01/rdf-schema#label") ++labels;
    }
    check(labels == 2, "both scale points are there");

    std::cout << "reporting a problem\n";
    const auto broken = parse("@prefix jig: <http://x/> .\n<a> jig:b \"unterminated\n", "https://x.example/");
    check(!broken.ok, "an unterminated string is refused");
    check(broken.error.find("line") != std::string::npos, "the error names a line: " + broken.error);

    const auto noPrefix = parse("<https://a/> nope:thing <https://b/> .", "https://x.example/");
    check(!noPrefix.ok && noPrefix.error.find("nope") != std::string::npos,
          "an undeclared prefix is named: " + noPrefix.error);

    std::cout << (failures == 0 ? "\nall passed\n" : "\n" + std::to_string(failures) + " failed\n");
    return failures == 0 ? 0 : 1;
}
