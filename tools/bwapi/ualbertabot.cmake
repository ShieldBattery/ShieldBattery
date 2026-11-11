# Builds the pinned UAlbertaBot external client without modifying its sources.
#
# Required inputs are produced by the main tools/bwapi CMake build:
#   cmake -S tools/bwapi -B .claude-scratch/bwapi-bot-build -A Win32
#   cmake --build .claude-scratch/bwapi-bot-build --config Release --target BWAPI-Static BWAPIClient
#
# Then run:
#   cmake -P tools/bwapi/ualbertabot.cmake

cmake_minimum_required(VERSION 3.21)

if(NOT CMAKE_HOST_WIN32)
  message(FATAL_ERROR "UAlbertaBot's upstream Visual Studio solution requires Windows.")
endif()

set(UAB_COMMIT "558899d8793456f4a6ec4196efbb5235552e24db")
set(BWAPI_COMMIT "7687da8abc4726f8366401f11ab648d421385793")

get_filename_component(REPOSITORY_ROOT "${CMAKE_CURRENT_LIST_DIR}/../.." ABSOLUTE)

if(NOT DEFINED UALBERTABOT_SOURCE_DIR)
  set(UALBERTABOT_SOURCE_DIR "${REPOSITORY_ROOT}/.claude-scratch/ualbertabot-research")
endif()
if(NOT DEFINED BWAPI_SOURCE_DIR)
  set(BWAPI_SOURCE_DIR "${REPOSITORY_ROOT}/.claude-scratch/bwapi-research")
endif()
if(NOT DEFINED BWAPI_BUILD_DIR)
  set(BWAPI_BUILD_DIR "${REPOSITORY_ROOT}/.claude-scratch/bwapi-bot-build")
endif()
if(NOT DEFINED UALBERTABOT_BUILD_DIR)
  set(UALBERTABOT_BUILD_DIR "${REPOSITORY_ROOT}/.claude-scratch/ualbertabot-build")
endif()
if(NOT DEFINED MSVC_PLATFORM_TOOLSET)
  set(MSVC_PLATFORM_TOOLSET "v143")
endif()

foreach(path_var IN ITEMS
    UALBERTABOT_SOURCE_DIR BWAPI_SOURCE_DIR BWAPI_BUILD_DIR UALBERTABOT_BUILD_DIR)
  get_filename_component(${path_var} "${${path_var}}" ABSOLUTE)
endforeach()

find_package(Git REQUIRED)

function(require_git_commit checkout expected_commit)
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

require_git_commit("${UALBERTABOT_SOURCE_DIR}" "${UAB_COMMIT}")
require_git_commit("${BWAPI_SOURCE_DIR}" "${BWAPI_COMMIT}")

set(BWAPI_INCLUDE_DIR "${BWAPI_SOURCE_DIR}/bwapi/include")
set(BWAPI_STATIC_LIBRARY "${BWAPI_BUILD_DIR}/Release/BWAPI-Static.lib")
# BWAPIClient.lib is the generated, token-aware discovery client from CMakeLists.txt.
set(BWAPI_CLIENT_LIBRARY "${BWAPI_SOURCE_DIR}/bwapi/lib/Release/BWAPIClient.lib")
set(BWAPI_CLIENT_PROVENANCE "${BWAPI_BUILD_DIR}/BWAPIClient-instance-discovery.txt")
foreach(required_path IN ITEMS
    "${BWAPI_INCLUDE_DIR}"
    "${BWAPI_STATIC_LIBRARY}"
    "${BWAPI_CLIENT_LIBRARY}"
    "${BWAPI_CLIENT_PROVENANCE}")
  if(NOT EXISTS "${required_path}")
    message(FATAL_ERROR
      "Missing ${required_path}. Build BWAPI-Static and BWAPIClient with the Win32 tools/bwapi CMake configuration first.")
  endif()
endforeach()

if(NOT DEFINED MSBUILD_EXECUTABLE)
  set(VSWHERE "$ENV{SystemDrive}/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe")
  if(EXISTS "${VSWHERE}")
    execute_process(
      COMMAND "${VSWHERE}" -latest -products * -requires Microsoft.Component.MSBuild
        -find "MSBuild\\**\\Bin\\MSBuild.exe"
      RESULT_VARIABLE vswhere_result
      OUTPUT_VARIABLE MSBUILD_EXECUTABLE
      OUTPUT_STRIP_TRAILING_WHITESPACE)
  endif()
endif()
if(NOT MSBUILD_EXECUTABLE OR NOT EXISTS "${MSBUILD_EXECUTABLE}")
  message(FATAL_ERROR
    "MSBuild was not found. Pass -DMSBUILD_EXECUTABLE=<absolute path to MSBuild.exe>.")
endif()

set(EXPORTED_SOURCE_DIR "${UALBERTABOT_BUILD_DIR}/source")
set(SOURCE_STAMP "${EXPORTED_SOURCE_DIR}/.shieldbattery-source-revision")
if(EXISTS "${EXPORTED_SOURCE_DIR}")
  if(NOT EXISTS "${SOURCE_STAMP}")
    message(FATAL_ERROR
      "${EXPORTED_SOURCE_DIR} exists without a revision stamp. Use a new UALBERTABOT_BUILD_DIR.")
  endif()
  file(READ "${SOURCE_STAMP}" exported_commit)
  string(STRIP "${exported_commit}" exported_commit)
  if(NOT exported_commit STREQUAL UAB_COMMIT)
    message(FATAL_ERROR
      "${EXPORTED_SOURCE_DIR} contains ${exported_commit}; use a new UALBERTABOT_BUILD_DIR for ${UAB_COMMIT}.")
  endif()
else()
  file(MAKE_DIRECTORY "${UALBERTABOT_BUILD_DIR}")
  set(SOURCE_ARCHIVE "${UALBERTABOT_BUILD_DIR}/ualbertabot-${UAB_COMMIT}.zip")
  execute_process(
    COMMAND "${GIT_EXECUTABLE}" -C "${UALBERTABOT_SOURCE_DIR}" archive
      --format=zip "--output=${SOURCE_ARCHIVE}" "${UAB_COMMIT}"
    RESULT_VARIABLE archive_result)
  if(NOT archive_result EQUAL 0)
    message(FATAL_ERROR "Failed to export UAlbertaBot ${UAB_COMMIT}")
  endif()
  file(MAKE_DIRECTORY "${EXPORTED_SOURCE_DIR}")
  file(ARCHIVE_EXTRACT INPUT "${SOURCE_ARCHIVE}" DESTINATION "${EXPORTED_SOURCE_DIR}")
  file(WRITE "${SOURCE_STAMP}" "${UAB_COMMIT}\n")
endif()

set(BWAPI_SDK_DIR "${UALBERTABOT_BUILD_DIR}/bwapi-sdk")
file(MAKE_DIRECTORY "${BWAPI_SDK_DIR}/Release")
file(COPY "${BWAPI_INCLUDE_DIR}/" DESTINATION "${BWAPI_SDK_DIR}/include")
file(COPY_FILE "${BWAPI_STATIC_LIBRARY}" "${BWAPI_SDK_DIR}/Release/BWAPILIB.lib" ONLY_IF_DIFFERENT)
file(COPY_FILE "${BWAPI_CLIENT_LIBRARY}" "${BWAPI_SDK_DIR}/Release/BWAPIClient.lib" ONLY_IF_DIFFERENT)

set(UAB_SOLUTION "${EXPORTED_SOURCE_DIR}/UAlbertaBot/VisualStudio/UAlbertaBot.sln")
execute_process(
  COMMAND "${MSBUILD_EXECUTABLE}" "${UAB_SOLUTION}"
    /m
    /t:UAlbertaBot
    /p:Configuration=Release
    /p:Platform=Win32
    /p:PlatformToolset=${MSVC_PLATFORM_TOOLSET}
    /p:BWAPI_DIR=${BWAPI_SDK_DIR}
  RESULT_VARIABLE build_result
  COMMAND_ECHO STDOUT)
if(NOT build_result EQUAL 0)
  message(FATAL_ERROR "UAlbertaBot build failed with exit code ${build_result}")
endif()

set(OUTPUT_DIR "${UALBERTABOT_BUILD_DIR}/bin")
file(MAKE_DIRECTORY
  "${OUTPUT_DIR}"
  "${OUTPUT_DIR}/bwapi-data/AI"
  "${OUTPUT_DIR}/bwapi-data/read"
  "${OUTPUT_DIR}/bwapi-data/write")
file(COPY_FILE
  "${EXPORTED_SOURCE_DIR}/UAlbertaBot/bin/UAlbertaBot.exe"
  "${OUTPUT_DIR}/UAlbertaBot.exe"
  ONLY_IF_DIFFERENT)
file(COPY_FILE
  "${EXPORTED_SOURCE_DIR}/UAlbertaBot/bin/UAlbertaBot_Config.txt"
  "${OUTPUT_DIR}/UAlbertaBot_Config.txt"
  ONLY_IF_DIFFERENT)

message(STATUS "Built unchanged UAlbertaBot source at ${OUTPUT_DIR}/UAlbertaBot.exe")
message(STATUS "Run from ${OUTPUT_DIR} so the stock config and bwapi-data paths resolve.")
