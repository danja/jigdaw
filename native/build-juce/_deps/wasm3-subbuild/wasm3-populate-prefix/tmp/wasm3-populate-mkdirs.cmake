# Distributed under the OSI-approved BSD 3-Clause License.  See accompanying
# file Copyright.txt or https://cmake.org/licensing for details.

cmake_minimum_required(VERSION 3.5)

file(MAKE_DIRECTORY
  "/home/danny/github/jigdaw/native/build-juce/_deps/wasm3-src"
  "/home/danny/github/jigdaw/native/build-juce/_deps/wasm3-build"
  "/chalet/github/jigdaw/native/build-juce/_deps/wasm3-subbuild/wasm3-populate-prefix"
  "/chalet/github/jigdaw/native/build-juce/_deps/wasm3-subbuild/wasm3-populate-prefix/tmp"
  "/chalet/github/jigdaw/native/build-juce/_deps/wasm3-subbuild/wasm3-populate-prefix/src/wasm3-populate-stamp"
  "/chalet/github/jigdaw/native/build-juce/_deps/wasm3-subbuild/wasm3-populate-prefix/src"
  "/chalet/github/jigdaw/native/build-juce/_deps/wasm3-subbuild/wasm3-populate-prefix/src/wasm3-populate-stamp"
)

set(configSubDirs )
foreach(subDir IN LISTS configSubDirs)
    file(MAKE_DIRECTORY "/chalet/github/jigdaw/native/build-juce/_deps/wasm3-subbuild/wasm3-populate-prefix/src/wasm3-populate-stamp/${subDir}")
endforeach()
if(cfgdir)
  file(MAKE_DIRECTORY "/chalet/github/jigdaw/native/build-juce/_deps/wasm3-subbuild/wasm3-populate-prefix/src/wasm3-populate-stamp${cfgdir}") # cfgdir has leading slash
endif()
