# native/cmake/FindOrFetchWamr.cmake
#
# WAMR (WebAssembly Micro Runtime), a local checkout rather than fetched: it
# has no shallow-clone-friendly release tag the way wasm3 does (this project
# tracks the git repository directly), and a multi-hundred-MB tree is not
# something to re-clone on every clean build.
#
# Replaces wasm3 (see the removed FindOrFetchWasm3.cmake) for the one reason
# wasm3 could not stay: Ferrite and any future plugin declaring
# jig:wasmFeature jig:Simd128 needs WebAssembly SIMD, which wasm3's
# interpreter does not implement and wasm3 upstream has no plan to add.
#
# Two modes, chosen by JIGDAW_WAMR_MODE. "jit" (the default) is WAMR's LLVM JIT:
# a module is compiled to machine code once, at load, on the message thread,
# before the first block is processed (LAZY_JIT is off, so nothing compiles on
# the audio thread). It needs LLVM development files (apt: llvm-18-dev) and was
# made the default because Mop ran at 1.70x realtime through the interpreter,
# so every realtime block overran (TODO.md, MISTAKES.md). "interp" is the fast
# interpreter with SIMD on: no LLVM and no executable pages, the property wasm3
# was chosen for, at a cost of 10x or more on heavy modules. Module.cpp reads
# JIGDAW_WAMR_JIT and is the only file that knows which mode is in use.
set(WAMR_ROOT "$ENV{HOME}/github/wasm-micro-runtime" CACHE PATH
    "Path to a WAMR (wasm-micro-runtime) checkout")

if(NOT EXISTS "${WAMR_ROOT}/build-scripts/runtime_lib.cmake")
  message(FATAL_ERROR
    "WAMR not found at ${WAMR_ROOT}. Clone "
    "https://github.com/wasm-micro-runtime/wasm-micro-runtime there, or pass "
    "-DWAMR_ROOT=<path>.")
endif()

set(WAMR_BUILD_PLATFORM "linux")
if(NOT DEFINED WAMR_BUILD_TARGET)
  if(CMAKE_SYSTEM_PROCESSOR MATCHES "^(arm64|aarch64)")
    set(WAMR_BUILD_TARGET "AARCH64")
  elseif(CMAKE_SIZEOF_VOID_P EQUAL 8)
    set(WAMR_BUILD_TARGET "X86_64")
  else()
    set(WAMR_BUILD_TARGET "X86_32")
  endif()
endif()

set(WAMR_BUILD_INTERP 1)
set(WAMR_BUILD_FAST_INTERP 1)
set(WAMR_BUILD_SIMD 1)
set(JIGDAW_WAMR_MODE "jit" CACHE STRING "WAMR execution mode: jit (LLVM JIT) or interp")
set_property(CACHE JIGDAW_WAMR_MODE PROPERTY STRINGS jit interp)
if(JIGDAW_WAMR_MODE STREQUAL "jit")
  set(WAMR_BUILD_AOT 1)
  set(WAMR_BUILD_JIT 1)
  # Compile every function when the module is instantiated, not on first call.
  set(WAMR_BUILD_LAZY_JIT 0)
  # WAMR looks for its own LLVM build unless told; use the distribution's.
  if(NOT DEFINED LLVM_DIR)
    file(GLOB _llvm_dirs "/usr/lib/llvm-*/lib/cmake/llvm")
    list(SORT _llvm_dirs)
    list(REVERSE _llvm_dirs)
    list(GET _llvm_dirs 0 _llvm_dir)
    if(NOT _llvm_dir)
      message(FATAL_ERROR "No LLVM development files found for the WAMR JIT. Install llvm-18-dev "
        "(and libedit-dev, libcurl4-openssl-dev), pass -DLLVM_DIR=<.../lib/cmake/llvm>, or "
        "build with -DJIGDAW_WAMR_MODE=interp.")
    endif()
    set(LLVM_DIR "${_llvm_dir}" CACHE PATH "LLVM CMake package directory")
  endif()
elseif(JIGDAW_WAMR_MODE STREQUAL "interp")
  set(WAMR_BUILD_AOT 0)
  set(WAMR_BUILD_JIT 0)
else()
  message(FATAL_ERROR "JIGDAW_WAMR_MODE must be jit or interp, not '${JIGDAW_WAMR_MODE}'")
endif()
set(WAMR_BUILD_FAST_JIT 0)
set(WAMR_BUILD_LIBC_BUILTIN 1)
set(WAMR_BUILD_LIBC_WASI 0)
# Rust's wasm32-unknown-unknown target emits a reference-types section by
# default (funcref/externref in the type/table encoding) even for a module
# that never uses one, as Ferrite's toolchain does. Without this WAMR refuses
# to parse the module at all, before SIMD or anything else about it matters.
set(WAMR_BUILD_REF_TYPES 1)
set(WAMR_BUILD_MULTI_MODULE 0)
set(WAMR_BUILD_LIB_PTHREAD 0)
set(WAMR_BUILD_SHARED_MEMORY 0)
# No native imports: every module here is jig:Abi1/Abi2, a closed set of
# exports and nothing more. Registering a "env" import module the way
# samples/basic does would be for a plugin that imports host functions, which
# the ABI this project speaks does not.

list(APPEND CMAKE_MODULE_PATH "${WAMR_ROOT}/build-scripts")
include("${WAMR_ROOT}/build-scripts/runtime_lib.cmake")

# WAMR's compiler sources append -fno-rtti to the directory's CMAKE_CXX_FLAGS
# so that they match LLVM. Taken back out here and given to wamr_vmlib alone,
# since DPF's dgl uses dynamic_cast and would stop compiling.
string(REPLACE "-fno-rtti" "" CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS}")

add_library(wamr_vmlib STATIC ${WAMR_RUNTIME_LIB_SOURCE})
target_include_directories(wamr_vmlib PUBLIC "${WAMR_ROOT}/core/iwasm/include")
set_target_properties(wamr_vmlib PROPERTIES POSITION_INDEPENDENT_CODE ON)
if(JIGDAW_WAMR_MODE STREQUAL "jit")
  target_compile_options(wamr_vmlib PRIVATE $<$<COMPILE_LANGUAGE:CXX>:-fno-rtti>)
endif()
find_package(Threads REQUIRED)
target_link_libraries(wamr_vmlib PUBLIC Threads::Threads)
if(JIGDAW_WAMR_MODE STREQUAL "jit")
  target_compile_definitions(wamr_vmlib PUBLIC JIGDAW_WAMR_JIT=1)
  # PRIVATE: LLVM's targets carry -fno-exceptions as an interface compile
  # option, and the adapter's Turtle and Profile parsers throw. A static
  # library's PRIVATE link dependencies still reach the final link.
  # Named components, not LLVM_AVAILABLE_LIBS, which on a distribution build
  # lists every library including ones that are not files (omptarget).
  llvm_map_components_to_libnames(JIGDAW_LLVM_LIBS
    core executionengine orcjit native passes analysis target lto irreader bitreader
    instcombine scalaropts transformutils mcdisassembler)
  target_link_libraries(wamr_vmlib PRIVATE ${JIGDAW_LLVM_LIBS})
endif()
