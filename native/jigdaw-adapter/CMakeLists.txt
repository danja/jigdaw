# native/jigdaw-adapter/CMakeLists.txt
include(FindOrFetchWamr)
find_package(OpenSSL REQUIRED)

# The portable core: everything except the plugin format wrapper. Testable on
# its own, and the only part that knows what a JigDAW plugin is.
add_library(jigdaw_core STATIC
  src/Turtle.cpp
  src/Profile.cpp
  src/Integrity.cpp
  src/Module.cpp
  src/Fetch.cpp
  src/Chain.cpp
  src/Report.cpp
  src/Midi.cpp
  src/Params.cpp
)
# The core is linked into a shared module, so it must be position independent.
# Without this the VST3 fails to link with a relocation error naming a symbol
# from deep inside a dependency, which says nothing about the cause.
set_target_properties(jigdaw_core PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_include_directories(jigdaw_core PUBLIC include)
target_include_directories(jigdaw_core PRIVATE ${JIGDAW_HTTPLIB_DIR})
target_compile_definitions(jigdaw_core PRIVATE CPPHTTPLIB_OPENSSL_SUPPORT)
# Threads because the editor builds its report on a worker: a load fetches
# over the network and an editor that stops repainting looks like a hung DAW.
find_package(Threads REQUIRED)
target_link_libraries(jigdaw_core PUBLIC wamr_vmlib Threads::Threads PRIVATE OpenSSL::SSL OpenSSL::Crypto)

if(JIGDAW_BUILD_TESTS)
  # turtle, integrity and fetch need nothing. profile reads the worked plugins
  # from the repository. chain fetches over HTTP and skips when nothing is
  # serving; chain_file runs the same test over file:// against this checkout,
  # so the whole native path is covered with nothing running.
  foreach(name turtle integrity fetch textfield)
    add_executable(test_${name} tests/${name}_test.cpp)
    target_link_libraries(test_${name} PRIVATE jigdaw_core)
    add_test(NAME ${name} COMMAND test_${name})
  endforeach()

  get_filename_component(JIGDAW_REPO "${CMAKE_CURRENT_LIST_DIR}/../.." ABSOLUTE)

  add_executable(test_profile tests/profile_test.cpp)
  target_link_libraries(test_profile PRIVATE jigdaw_core)
  add_test(NAME profile COMMAND test_profile ${JIGDAW_REPO})

  set(JIGDAW_TEST_BASE "http://127.0.0.1:6026" CACHE STRING "Where the chain test fetches from")
  add_executable(test_chain tests/chain_test.cpp)
  target_link_libraries(test_chain PRIVATE jigdaw_core)
  add_test(NAME chain COMMAND test_chain ${JIGDAW_TEST_BASE})
  set_tests_properties(chain PROPERTIES SKIP_RETURN_CODE 77)

  add_test(NAME chain_file COMMAND test_chain "file://${JIGDAW_REPO}")
  set_tests_properties(chain_file PROPERTIES SKIP_RETURN_CODE 77)

  # Binds JIGDAW_PARAMETER_COUNT, declared once in src/dpf/DistrhoPluginInfo.h,
  # to the plugin with the most ports. file:// only: the count does not
  # change with where the profile was fetched from.
  add_executable(test_parameter_count tests/parameter_count_test.cpp)
  target_link_libraries(test_parameter_count PRIVATE jigdaw_core)
  add_test(NAME parameter_count COMMAND test_parameter_count "file://${JIGDAW_REPO}")
  set_tests_properties(parameter_count PROPERTIES SKIP_RETURN_CODE 77)

  # Loads on a thread the runtime did not create, the editor worker case:
  # WAMR answers that with "thread signal env not inited" unless the load
  # registers the thread first. file:// only, for the same reason as above.
  add_executable(test_thread tests/thread_test.cpp)
  target_link_libraries(test_thread PRIVATE jigdaw_core)
  add_test(NAME thread COMMAND test_thread "file://${JIGDAW_REPO}")
  set_tests_properties(thread PROPERTIES SKIP_RETURN_CODE 77)
endif()

if(JIGDAW_BUILD_PLUGIN)
  if(NOT EXISTS "${JIGDAW_DPF_DIR}/CMakeLists.txt")
    message(WARNING "DPF not found at ${JIGDAW_DPF_DIR}; skipping the VST3. "
                    "Set -DJIGDAW_DPF_DIR=/path/to/DPF to build it.")
  else()
    add_subdirectory(${JIGDAW_DPF_DIR} ${CMAKE_BINARY_DIR}/dpf EXCLUDE_FROM_ALL)
    dpf_add_plugin(jigdaw-adapter
      # A JACK standalone as well: it is the quickest way to see the editor
      # without a DAW, and the quickest way to try a plugin IRI.
      TARGETS vst3 clap lv2 jack
      FILES_DSP src/dpf/JigdawPlugin.cpp
      FILES_UI src/dpf/JigdawUI.cpp)
    target_include_directories(jigdaw-adapter PUBLIC include src/dpf)
    target_link_libraries(jigdaw-adapter PUBLIC jigdaw_core)

    # The three formats are not the same shape, and a loop over them is wrong.
    # A .vst3 and a .lv2 are directories; a .clap is a single shared object.
    # install(DIRECTORY) given the .clap fails with "given non-directory", and
    # only on a RECONFIGURE, because on a first run the file does not exist yet
    # and OPTIONAL covers it. So a clean build works and the second one breaks.
    #
    # USE_SOURCE_PERMISSIONS on the bundles because install(DIRECTORY) otherwise
    # drops the execute bit, and a host that cannot dlopen the shared object
    # reports the plugin as missing rather than as unreadable.
    install(DIRECTORY "${CMAKE_BINARY_DIR}/bin/jigdaw-adapter.vst3"
            DESTINATION vst3 USE_SOURCE_PERMISSIONS OPTIONAL)
    install(DIRECTORY "${CMAKE_BINARY_DIR}/bin/jigdaw-adapter.lv2"
            DESTINATION lv2 USE_SOURCE_PERMISSIONS OPTIONAL)
    install(PROGRAMS "${CMAKE_BINARY_DIR}/bin/jigdaw-adapter.clap"
            DESTINATION clap OPTIONAL)
  endif()
endif()

if(JIGDAW_BUILD_JUCE_PLUGIN)
  if(NOT EXISTS "${JIGDAW_JUCE_DIR}/CMakeLists.txt")
    message(WARNING "JUCE not found at ${JIGDAW_JUCE_DIR}; skipping the JUCE-hosted adapter. "
                    "Set -DJIGDAW_JUCE_DIR=/path/to/JUCE to build it.")
  else()
    add_subdirectory(${JIGDAW_JUCE_DIR} ${CMAKE_BINARY_DIR}/juce EXCLUDE_FROM_ALL)

    juce_add_plugin(jigdaw-juce-adapter
      COMPANY_NAME "danja"
      # No parentheses: JUCE's post-build step passes this through /bin/sh
      # unquoted somewhere along the way, and "(" is a syntax error there.
      # Measured, not guessed: the build failed with exactly that error the
      # one time this was "JigDAW Adapter (JUCE)".
      PRODUCT_NAME "JigDAW JUCE Adapter"
      PLUGIN_MANUFACTURER_CODE Jgdw
      PLUGIN_CODE JgAJ
      FORMATS VST3 Standalone
      IS_SYNTH FALSE
      NEEDS_MIDI_INPUT TRUE
      NEEDS_MIDI_OUTPUT TRUE
      NEEDS_WEB_BROWSER FALSE
      NEEDS_CURL FALSE)

    target_sources(jigdaw-juce-adapter PRIVATE
      src/juce/PluginProcessor.cpp
      src/juce/PluginEditor.cpp)
    target_include_directories(jigdaw-juce-adapter PUBLIC include)
    target_compile_definitions(jigdaw-juce-adapter PUBLIC
      JUCE_WEB_BROWSER=0
      JUCE_USE_CURL=0
      JUCE_VST3_CAN_REPLACE_VST2=0)
    target_link_libraries(jigdaw-juce-adapter
      PRIVATE
        jigdaw_core
        juce::juce_audio_utils
      PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags)
  endif()
endif()
