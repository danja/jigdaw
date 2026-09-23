# Install script for directory: /chalet/github/JUCE

# Set the install prefix
if(NOT DEFINED CMAKE_INSTALL_PREFIX)
  set(CMAKE_INSTALL_PREFIX "/usr/local")
endif()
string(REGEX REPLACE "/$" "" CMAKE_INSTALL_PREFIX "${CMAKE_INSTALL_PREFIX}")

# Set the install configuration name.
if(NOT DEFINED CMAKE_INSTALL_CONFIG_NAME)
  if(BUILD_TYPE)
    string(REGEX REPLACE "^[^A-Za-z0-9_]+" ""
           CMAKE_INSTALL_CONFIG_NAME "${BUILD_TYPE}")
  else()
    set(CMAKE_INSTALL_CONFIG_NAME "Custom")
  endif()
  message(STATUS "Install configuration: \"${CMAKE_INSTALL_CONFIG_NAME}\"")
endif()

# Set the component getting installed.
if(NOT CMAKE_INSTALL_COMPONENT)
  if(COMPONENT)
    message(STATUS "Install component: \"${COMPONENT}\"")
    set(CMAKE_INSTALL_COMPONENT "${COMPONENT}")
  else()
    set(CMAKE_INSTALL_COMPONENT)
  endif()
endif()

# Install shared libraries without execute permission?
if(NOT DEFINED CMAKE_INSTALL_SO_NO_EXE)
  set(CMAKE_INSTALL_SO_NO_EXE "1")
endif()

# Is this installation the result of a crosscompile?
if(NOT DEFINED CMAKE_CROSSCOMPILING)
  set(CMAKE_CROSSCOMPILING "FALSE")
endif()

# Set default install directory permissions.
if(NOT DEFINED CMAKE_OBJDUMP)
  set(CMAKE_OBJDUMP "/usr/bin/objdump")
endif()

if(NOT CMAKE_INSTALL_LOCAL_ONLY)
  # Include the install script for the subdirectory.
  include("/home/danny/github/jigdaw/native/build-juce/juce/tools/modules/cmake_install.cmake")
endif()

if(NOT CMAKE_INSTALL_LOCAL_ONLY)
  # Include the install script for the subdirectory.
  include("/home/danny/github/jigdaw/native/build-juce/juce/tools/extras/Build/cmake_install.cmake")
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "Unspecified" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib/cmake/JUCE-9.0.1" TYPE FILE FILES
    "/home/danny/github/jigdaw/native/build-juce/juce/tools/JUCEConfigVersion.cmake"
    "/home/danny/github/jigdaw/native/build-juce/juce/tools/JUCEConfig.cmake"
    "/chalet/github/JUCE/extras/Build/CMake/FindCppwinrt.cmake"
    "/chalet/github/JUCE/extras/Build/CMake/FindWebView2.cmake"
    "/chalet/github/JUCE/extras/Build/CMake/FindWindowsMIDIServices.cmake"
    "/chalet/github/JUCE/extras/Build/CMake/JUCECheckAtomic.cmake"
    "/chalet/github/JUCE/extras/Build/CMake/JUCEHelperTargets.cmake"
    "/chalet/github/JUCE/extras/Build/CMake/JUCEModuleSupport.cmake"
    "/chalet/github/JUCE/extras/Build/CMake/JUCEUtils.cmake"
    "/chalet/github/JUCE/extras/Build/CMake/JuceLV2Defines.h.in"
    "/chalet/github/JUCE/extras/Build/CMake/LaunchScreen.storyboard"
    "/chalet/github/JUCE/extras/Build/CMake/PIPAudioProcessor.cpp.in"
    "/chalet/github/JUCE/extras/Build/CMake/PIPAudioProcessorWithARA.cpp.in"
    "/chalet/github/JUCE/extras/Build/CMake/PIPComponent.cpp.in"
    "/chalet/github/JUCE/extras/Build/CMake/PIPConsole.cpp.in"
    "/chalet/github/JUCE/extras/Build/CMake/RecentFilesMenuTemplate.nib"
    "/chalet/github/JUCE/extras/Build/CMake/UnityPluginGUIScript.cs.in"
    "/chalet/github/JUCE/extras/Build/CMake/bundleplaceholder.mm"
    "/chalet/github/JUCE/extras/Build/CMake/checkBundleSigning.cmake"
    "/chalet/github/JUCE/extras/Build/CMake/copyDir.cmake"
    "/chalet/github/JUCE/extras/Build/CMake/juce_LinuxSubprocessHelper.cpp"
    "/chalet/github/JUCE/extras/Build/CMake/juce_runtime_arch_detection.cpp"
    )
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "Unspecified" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib/cmake/JUCE-9.0.1" TYPE DIRECTORY FILES "/chalet/github/JUCE/extras/Build/CMake/juce_vst3_helper")
endif()

if(CMAKE_INSTALL_COMPONENT)
  set(CMAKE_INSTALL_MANIFEST "install_manifest_${CMAKE_INSTALL_COMPONENT}.txt")
else()
  set(CMAKE_INSTALL_MANIFEST "install_manifest.txt")
endif()

string(REPLACE ";" "\n" CMAKE_INSTALL_MANIFEST_CONTENT
       "${CMAKE_INSTALL_MANIFEST_FILES}")
file(WRITE "/home/danny/github/jigdaw/native/build-juce/juce/tools/${CMAKE_INSTALL_MANIFEST}"
     "${CMAKE_INSTALL_MANIFEST_CONTENT}")
