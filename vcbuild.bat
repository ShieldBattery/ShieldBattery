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
cd "%scriptroot%\node-psi"
call npm install
if errorlevel 1 goto install-failed
cd "%scriptroot%\node-bw"
call npm install
if errorlevel 1 goto install-failed
cd "%scriptroot%\forge"
call npm install
if errorlevel 1 goto install-failed
echo JS modules installed.
goto project-gen

:project-gen
@rem Skip project generation if requested.
if defined noprojgen goto msbuild

:find-vs-2012
@rem Look for Visual Studio 2012
if not defined VS110COMNTOOLS goto find-vs-2013
set VSCOMNTOOLS=%VS110COMNTOOLS%
if not exist "%VSCOMNTOOLS%\..\..\vc\vcvarsall.bat" goto find-vs-2013
call "%VSCOMNTOOLS%\..\..\vc\vcvarsall.bat"
if not defined VCINSTALLDIR goto find-vs-2013
set GYP_MSVS_VERSION=2012
goto gen-vs-project

:find-vs-2013
@rem Look for Visual Studio 2013
if not defined VS120COMNTOOLS goto msbuild-not-found
set VSCOMNTOOLS=%VS120COMNTOOLS%
if not exist "%VSCOMNTOOLS%\..\..\vc\vcvarsall.bat" goto msbuild-not-found
call "%VSCOMNTOOLS%\..\..\vc\vcvarsall.bat"
if not defined VCINSTALLDIR goto msbuild-not-found
set GYP_MSVS_VERSION=2013
goto gen-vs-project

:gen-vs-project
@rem Generate the VS project.
SETLOCAL
  if defined VSCOMNTOOLS call "%VSCOMNTOOLS%\VCVarsQueryRegistry.bat"
  call "%scriptroot%\deps\node\vcbuild.bat" ia32 noetw noperfctr nobuild nosign
  if not exist "%scriptroot%\deps\node\config.gypi" goto create-msvs-files-failed
  cd "%scriptroot%"
  call "%scriptroot%\deps\node\tools\gyp\gyp.bat" --depth=. -f msvs --generator-output=. -G msvs_version=auto -Ideps\node\common.gypi -Ideps\node\config.gypi -Ioverrides.gypi -Dlibrary=static_library -Dtarget_arch=ia32 -Dcomponent=static_library shieldbattery.gyp
  if errorlevel 1 goto create-msvs-files-failed
  if not exist shieldbattery.sln goto create-msvs-files-failed
  echo Shieldbattery project files generated.
ENDLOCAL

:msbuild
@rem Skip build if requested.
if defined nobuild goto link-modules
goto do-build

:msbuild-not-found
echo Build skipped. To build, this file needs to run from VS cmd prompt.
goto exit

:do-build
@rem Build the sln with msbuild.
msbuild shieldbattery.sln /m /t:%target% /p:Configuration=%config% /clp:NoSummary;NoItemAndPropertyList;Verbosity=minimal /nologo
if errorlevel 1 goto exit
goto link-modules

:create-msvs-files-failed
echo Failed to create VS project files for Shieldbattery.
goto exit

:link-modules
@rem Link up the native modules inside the js directory
cd "%scriptroot%\node-psi"
call npm link
if errorlevel 1 goto linking-failed
cd "%scriptroot%\node-bw"
call npm link
if errorlevel 1 goto linking-failed
cd "%scriptroot%\forge"
call npm link
if errorlevel 1 goto linking-failed
cd "%scriptroot%\js"
call npm link shieldbattery-psi
if errorlevel 1 goto linking-failed
call npm link shieldbattery-bw
if errorlevel 1 goto linking-failed
call npm link forge-shieldbattery
if errorlevel 1 goto linking-failed
call npm install
if errorlevel 1 goto linking-failed
rmdir "%SHIELDBATTERY_PATH%\js"
mklink /D "%SHIELDBATTERY_PATH%\js" "%scriptroot%\js"
echo JS modules linked.
goto exit

:install-failed
echo Installing JS modules failed, please check output and ensure node/npm are installed and setup on your PATH.
goto exit

:linking-failed
echo Linking JS modules failed, please check command output and ensure node/npm are installed and setup on your PATH.
goto exit

:env-error
echo Necessary environment variables not set! Please set SHIELDBATTERY_PATH and re-run this script.
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
