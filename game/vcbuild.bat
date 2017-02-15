@echo off

SETLOCAL

@rem Modified version of vcbuild.bat from Node
if /i "%1"=="help" goto help
if /i "%1"=="--help" goto help
if /i "%1"=="-help" goto help
if /i "%1"=="/help" goto help
if /i "%1"=="?" goto help
if /i "%1"=="-?" goto help
if /i "%1"=="--?" goto help
if /i "%1"=="/?" goto help

@rem Store %~dp0 because it can change after we call things
set scriptroot=%~dp0

@rem Process arguments.
set config=Release
set target=Build
set nobuild=
set noprojgen=
set rebuildnode=

:next-arg
if "%1"=="" goto args-done
if /i "%1"=="debug"         set config=Debug&goto arg-ok
if /i "%1"=="release"       set config=Release&goto arg-ok
if /i "%1"=="noprojgen"     set noprojgen=1&goto arg-ok
if /i "%1"=="nobuild"       set nobuild=1&goto arg-ok
if /i "%1"=="rebuild-node"  set rebuildnode=force&goto arg-ok

echo Warning: ignoring invalid command line option `%1`.

:arg-ok
shift
goto next-arg

:args-done

:install-deps
SETLOCAL
  @rem Install all the node module dependencies
  cd "%scriptroot%"
  call yarn
  if errorlevel 1 goto install-failed
  echo JS modules installed.
ENDLOCAL
goto find-vs-2015

:find-vs-2015
@rem Look for Visual Studio 2015
echo Looking for Visual Studio 2015
if not defined VS140COMNTOOLS goto vs-not-found
if not exist "%VS140COMNTOOLS%\..\..\vc\vcvarsall.bat" goto vs-not-found
echo Found Visual Studio 2015
if "%VCVARS_VER%" NEQ "140" (
  call "%VS140COMNTOOLS%\..\..\vc\vcvarsall.bat"
  SET VCVARS_VER=140
)
if not defined VCINSTALLDIR goto vs-not-found
set GYP_MSVS_VERSION=2015
set PLATFORM_TOOLSET=v140
goto build-node

:build-node
SETLOCAL
  call "%scriptroot%\tools\update-node\update-node.bat" %rebuildnode%
  if errorlevel 1 goto build-node-failed
ENDLOCAL

:project-gen
@rem Skip project generation if requested.
if defined noprojgen goto msbuild

:gen-vs-project
@rem Generate the VS project.
SETLOCAL
  cd "%scriptroot%"
  call "tools\gyp\gyp.bat" --depth=. -f msvs --generator-output=. -G msvs_version=auto -Icommon.gypi game.gyp
  if errorlevel 1 goto create-msvs-files-failed
  if not exist game.sln goto create-msvs-files-failed
  echo Game project files generated.
ENDLOCAL

:msbuild
@rem Skip build if requested.
if defined nobuild goto exit
goto do-build

:do-build
@rem Build the sln with msbuild.
SETLOCAL
  cd "%scriptroot%"
  msbuild game.sln /m /t:%target% /p:Configuration=%config% /clp:NoSummary;NoItemAndPropertyList;Verbosity=minimal /nologo
ENDLOCAL
goto exit

:build-node-failed
echo Failed to build node.
goto exit

:create-msvs-files-failed
echo Failed to create VS project files for Shieldbattery.
goto exit

:install-failed
echo Installing JS modules failed, please check output and ensure node/npm are installed and setup on your PATH.
goto exit

:vs-not-found
echo Visual Studio 2015 could not be found! Please ensure its installed and setup correctly.
goto exit

:help
echo vcbuild.bat [debug/release] [noprojgen] [nobuild] [rebuild-node]
echo Examples:
echo   vcbuild.bat                : builds release build
echo   vcbuild.bat debug          : builds debug build
goto exit

:exit
goto :EOF
