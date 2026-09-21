cmake_minimum_required(VERSION 3.21)

project(shieldbattery-bwapi-bots LANGUAGES CXX)

if(NOT WIN32 OR NOT MSVC)
  message(FATAL_ERROR "The BWAPI bot host requires 32-bit Windows and MSVC.")
endif()

if(NOT CMAKE_SIZEOF_VOID_P EQUAL 4)
  message(FATAL_ERROR "Configure with a 32-bit generator (for Visual Studio, pass -A Win32).")
endif()

set(CMAKE_CONFIGURATION_TYPES Release CACHE STRING "Supported build configurations" FORCE)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreadedDLL")

set(BWAPI_SOURCE_DIR
    "${CMAKE_CURRENT_LIST_DIR}/../../.claude-scratch/bwapi-research"
    CACHE PATH "Path to the BWAPI source checkout")
set(ZZZKBOT_SOURCE_DIR
    "${CMAKE_CURRENT_LIST_DIR}/../../.claude-scratch/ZZZKBot"
    CACHE PATH "Path to the ZZZKBot source checkout")

set(BWAPI_COMMIT "7687da8abc4726f8366401f11ab648d421385793")
set(ZZZKBOT_COMMIT "7183e37b6b416ea53c1040c83e639a3a3c395eed")

function(require_git_commit checkout expected_commit)
  find_package(Git REQUIRED)
  execute_process(
    COMMAND "${GIT_EXECUTABLE}" -C "${checkout}" rev-parse HEAD
    RESULT_VARIABLE git_result
    OUTPUT_VARIABLE actual_commit
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET)
  if(NOT git_result EQUAL 0)
    message(FATAL_ERROR "${checkout} is not a readable Git checkout")
  endif()
  if(NOT actual_commit STREQUAL expected_commit)
    message(FATAL_ERROR
      "Unexpected source revision in ${checkout}: ${actual_commit}; expected ${expected_commit}")
  endif()
endfunction()

require_git_commit("${BWAPI_SOURCE_DIR}" "${BWAPI_COMMIT}")
require_git_commit("${ZZZKBOT_SOURCE_DIR}" "${ZZZKBOT_COMMIT}")

# Build the public BWAPI implementation separately from the injected server.
# The v4.4.0 server CMake source list contains a stale CommandTemp.h path, and
# external clients only need BWAPILib plus UnitCommand.cpp.
set(CMAKE_BUILD_TYPE Release)
file(GLOB BWAPI_LIBRARY_SOURCES CONFIGURE_DEPENDS
  "${BWAPI_SOURCE_DIR}/bwapi/BWAPILib/Source/*.cpp")
list(APPEND BWAPI_LIBRARY_SOURCES
  "${BWAPI_SOURCE_DIR}/bwapi/BWAPILib/UnitCommand.cpp")
file(MAKE_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/generated")
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/generated/svnrev.h"
  "#pragma once\nstatic const int SVN_REV = 5016;\n#include <starcraftver.h>\n")
add_library(BWAPI-Static STATIC ${BWAPI_LIBRARY_SOURCES})
target_include_directories(BWAPI-Static PUBLIC
  "${BWAPI_SOURCE_DIR}/bwapi/include"
  "${CMAKE_CURRENT_BINARY_DIR}/generated")
target_compile_features(BWAPI-Static PUBLIC cxx_std_17)
target_compile_definitions(BWAPI-Static PRIVATE NOMINMAX)

# Keep the stock client transport and shared-memory model from BWAPI 4.4.
add_subdirectory("${BWAPI_SOURCE_DIR}/CMake/Client" "bwapi-client")
target_compile_features(BWAPIClient PUBLIC cxx_std_17)

set(ZZZKBOT_SOURCE_ROOT "${ZZZKBOT_SOURCE_DIR}/ZZZKBot/Source")

add_executable(ZZZKBotClient
  host.cpp
  "${ZZZKBOT_SOURCE_ROOT}/Dll.cpp"
  "${ZZZKBOT_SOURCE_ROOT}/ZZZKBotAIModule.cpp"
  "${ZZZKBOT_SOURCE_ROOT}/ZZZKBotAIModule.h")

target_compile_features(ZZZKBotClient PRIVATE cxx_std_17)
target_compile_definitions(ZZZKBotClient PRIVATE NOMINMAX WIN32 NDEBUG)
target_compile_options(ZZZKBotClient PRIVATE /W3 /MP)
target_include_directories(ZZZKBotClient PRIVATE
  "${BWAPI_SOURCE_DIR}/bwapi/include"
  "${ZZZKBOT_SOURCE_ROOT}")
target_link_libraries(ZZZKBotClient PRIVATE BWAPIClient BWAPI-Static)

set_target_properties(ZZZKBotClient PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin")
