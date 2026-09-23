# Distributed under the OSI-approved BSD 3-Clause License.  See accompanying
# file Copyright.txt or https://cmake.org/licensing for details.

cmake_minimum_required(VERSION 3.5)

if(EXISTS "/chalet/github/jigdaw/native/build-default/_deps/wasm3-subbuild/wasm3-populate-prefix/src/wasm3-populate-stamp/wasm3-populate-gitclone-lastrun.txt" AND EXISTS "/chalet/github/jigdaw/native/build-default/_deps/wasm3-subbuild/wasm3-populate-prefix/src/wasm3-populate-stamp/wasm3-populate-gitinfo.txt" AND
  "/chalet/github/jigdaw/native/build-default/_deps/wasm3-subbuild/wasm3-populate-prefix/src/wasm3-populate-stamp/wasm3-populate-gitclone-lastrun.txt" IS_NEWER_THAN "/chalet/github/jigdaw/native/build-default/_deps/wasm3-subbuild/wasm3-populate-prefix/src/wasm3-populate-stamp/wasm3-populate-gitinfo.txt")
  message(STATUS
    "Avoiding repeated git clone, stamp file is up to date: "
    "'/chalet/github/jigdaw/native/build-default/_deps/wasm3-subbuild/wasm3-populate-prefix/src/wasm3-populate-stamp/wasm3-populate-gitclone-lastrun.txt'"
  )
  return()
endif()

execute_process(
  COMMAND ${CMAKE_COMMAND} -E rm -rf "/home/danny/github/jigdaw/native/build-default/_deps/wasm3-src"
  RESULT_VARIABLE error_code
)
if(error_code)
  message(FATAL_ERROR "Failed to remove directory: '/home/danny/github/jigdaw/native/build-default/_deps/wasm3-src'")
endif()

# try the clone 3 times in case there is an odd git clone issue
set(error_code 1)
set(number_of_tries 0)
while(error_code AND number_of_tries LESS 3)
  execute_process(
    COMMAND "/usr/bin/git"
            clone --no-checkout --depth 1 --no-single-branch --config "advice.detachedHead=false" "https://github.com/wasm3/wasm3.git" "wasm3-src"
    WORKING_DIRECTORY "/home/danny/github/jigdaw/native/build-default/_deps"
    RESULT_VARIABLE error_code
  )
  math(EXPR number_of_tries "${number_of_tries} + 1")
endwhile()
if(number_of_tries GREATER 1)
  message(STATUS "Had to git clone more than once: ${number_of_tries} times.")
endif()
if(error_code)
  message(FATAL_ERROR "Failed to clone repository: 'https://github.com/wasm3/wasm3.git'")
endif()

execute_process(
  COMMAND "/usr/bin/git"
          checkout "v0.5.0" --
  WORKING_DIRECTORY "/home/danny/github/jigdaw/native/build-default/_deps/wasm3-src"
  RESULT_VARIABLE error_code
)
if(error_code)
  message(FATAL_ERROR "Failed to checkout tag: 'v0.5.0'")
endif()

set(init_submodules TRUE)
if(init_submodules)
  execute_process(
    COMMAND "/usr/bin/git" 
            submodule update --recursive --init 
    WORKING_DIRECTORY "/home/danny/github/jigdaw/native/build-default/_deps/wasm3-src"
    RESULT_VARIABLE error_code
  )
endif()
if(error_code)
  message(FATAL_ERROR "Failed to update submodules in: '/home/danny/github/jigdaw/native/build-default/_deps/wasm3-src'")
endif()

# Complete success, update the script-last-run stamp file:
#
execute_process(
  COMMAND ${CMAKE_COMMAND} -E copy "/chalet/github/jigdaw/native/build-default/_deps/wasm3-subbuild/wasm3-populate-prefix/src/wasm3-populate-stamp/wasm3-populate-gitinfo.txt" "/chalet/github/jigdaw/native/build-default/_deps/wasm3-subbuild/wasm3-populate-prefix/src/wasm3-populate-stamp/wasm3-populate-gitclone-lastrun.txt"
  RESULT_VARIABLE error_code
)
if(error_code)
  message(FATAL_ERROR "Failed to copy script-last-run stamp file: '/chalet/github/jigdaw/native/build-default/_deps/wasm3-subbuild/wasm3-populate-prefix/src/wasm3-populate-stamp/wasm3-populate-gitclone-lastrun.txt'")
endif()
