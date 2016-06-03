@echo off

@rem Modified version of vcbuild.bat from Node
if /i "%1"=="help" goto help
if /i "%1"=="--help" goto help
if /i "%1"=="-help" goto help
if /i "%1"=="/help" goto help
if /i "%1"=="?" goto help
if /i "%1"=="-?" goto help
if /i "%1"=="--?" goto help
if /i "%1"=="/?" goto help

@rem Ensure environment properly setup
if not defined SHIELDBATTERY_PATH goto env-error

@rem Store %~dp0 because it can change after we call things
set scriptroot=%~dp0

@rem Process arguments.
set config=Release
set target=Build
set nobuild=
set noprojgen=

:next-arg
if "%1"=="" goto args-done
if /i "%1"=="debug"         set config=Debug&goto arg-ok
if /i "%1"=="release"       set config=Release&goto arg-ok
if /i "%1"=="noprojgen"     set noprojgen=1&goto arg-ok
if /i "%1"=="nobuild"       set nobuild=1&goto arg-ok

echo Warning: ignoring invalid command line option `%1`.

:arg-ok
shift
goto next-arg

:args-done

:install-deps
@rem Install all the node module dependencies
cd "%scriptroot%\nan"
call npm install
call npm update
if errorlevel 1 goto install-failed
cd "%scriptroot%\bundler"
call npm install
if errorlevel 1 goto install-failed
echo JS modules installed.
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
goto project-gen

:project-gen
@rem Skip project generation if requested.
if defined noprojgen goto msbuild

:gen-vs-project
@rem Generate the VS project.
SETLOCAL
  @rem Config flags for node's configure script
  set config_flags=--enable-static
  call "%scriptroot%\deps\node\vcbuild.bat" ia32 noetw noperfctr nobuild nosign
  if not exist "%scriptroot%\deps\node\config.gypi" goto create-msvs-files-failed
  cd "%scriptroot%"
  call "%scriptroot%\deps\node\tools\gyp\gyp.bat" --depth=. -f msvs --generator-output=. -G msvs_version=auto -Ideps\node\common.gypi -Ideps\node\config.gypi -Ideps\node\icu_config.gypi -Ioverrides.gypi shieldbattery.gyp
  if errorlevel 1 goto create-msvs-files-failed
  if not exist shieldbattery.sln goto create-msvs-files-failed
  echo Shieldbattery project files generated.
ENDLOCAL

:msbuild
@rem Skip build if requested.
if defined nobuild goto install-js-deps
goto do-build

:do-build
@rem Build the sln with msbuild.
cd "%scriptroot%"
msbuild shieldbattery.sln /m /t:%target% /p:Configuration=%config% /clp:NoSummary;NoItemAndPropertyList;Verbosity=minimal /nologo
if errorlevel 1 goto exit
goto install-js-deps


:install-js-deps
@rem Link up the native modules inside the js directory
cd "%scriptroot%\js"
call npm install
if errorlevel 1 goto install-js-deps-failed
rmdir "%SHIELDBATTERY_PATH%\js"
mklink /D "%SHIELDBATTERY_PATH%\js" "%scriptroot%\js"
echo JS modules linked.
goto exit

:create-msvs-files-failed
echo Failed to create VS project files for Shieldbattery.
goto exit

:install-failed
echo Installing JS modules failed, please check output and ensure node/npm are installed and setup on your PATH.
goto exit

:install-js-deps-failed
echo Installing dependencies for JS modules failed, please check command output and ensure node/npm are installed and setup on your PATH.
goto exit

:env-error
echo Necessary environment variables not set! Please set SHIELDBATTERY_PATH and re-run this script.
goto exit

:vs-not-found
echo Visual Studio 2015 could not be found! Please ensure its installed and setup correctly.
goto exit

:help
echo vcbuild.bat [debug/release] [noprojgen] [nobuild]
echo Examples:
echo   vcbuild.bat                : builds release build
echo   vcbuild.bat debug          : builds debug build
goto exit

:exit
cd "%scriptroot%"
goto :EOF
