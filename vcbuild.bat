@echo off

@rem Modified version of vcbuild.bat from Node

@rem Ensure environment properly setup
if not defined BROOD_WAR_PATH goto env-error
if not defined SHIELDBATTERY_PATH goto env-error

@rem Process arguments.
set config=Debug
set target=Build

:next-arg
if "%1"=="" goto args-done
if /i "%1"=="debug"         set config=Debug&goto arg-ok
if /i "%1"=="release"       set config=Release&goto arg-ok
if /i "%1"=="clean"         set target=Clean&goto arg-ok
if /i "%1"=="noprojgen"     set noprojgen=1&goto arg-ok
if /i "%1"=="nobuild"       set nobuild=1&goto arg-ok

echo Warning: ignoring invalid command line option `%1`.

:arg-ok
:arg-ok
shift
goto next-arg

:args-done

:project-gen
@rem Skip project generation if requested.
if defined noprojgen goto msbuild

@rem Generate the VS project.
SETLOCAL
  if defined VS110COMNTOOLS call "%VS110COMNTOOLS%\VCVarsQueryRegistry.bat"
  call "%~dp0\deps\node\vcbuild.bat" ia32 noetw noperfctr nobuild nosign
  if not exist "%~dp0\deps\node\config.gypi" goto create-msvs-files-failed
  cd "%~dp0"
  python "deps\node\tools\gyp\gyp" --depth=. -f msvs --generator-output=. -G msvs_version=auto -Ideps\node\common.gypi -Ideps\node\config.gypi -Dlibrary=static_library -Dtarget_arch=ia32 -Dcomponent=static_library shieldbattery.gyp
  if errorlevel 1 goto create-msvs-files-failed
  if not exist shieldbattery.sln goto create-msvs-files-failed
  echo Shieldbattery project files generated.
ENDLOCAL

:msbuild
@rem Skip build if requested.
if defined nobuild goto exit

@rem Look for Visual Studio 2012
if not defined VS110COMNTOOLS goto msbuild-not-found
if not exist "%VS110COMNTOOLS%\..\..\vc\vcvarsall.bat" goto msbuild-not-found
call "%VS110COMNTOOLS%\..\..\vc\vcvarsall.bat"
if not defined VCINSTALLDIR goto msbuild-not-found
set GYP_MSVS_VERSION=2012
goto msbuild-found

:msbuild-not-found
echo Build skipped. To build, this file needs to run from VS cmd prompt.
goto exit

:msbuild-found
@rem Build the sln with msbuild.
msbuild shieldbattery.sln /m /t:%target% /p:Configuration=%config% /clp:NoSummary;NoItemAndPropertyList;Verbosity=minimal /nologo
goto exit

:create-msvs-files-failed
echo Failed to create vc project files for shieldbattery.
goto exit

:env-error
echo Necessary environment variables not set! Please set BROOD_WAR_PATH and SHIELDBATTERY_PATH and re-run this script.
goto exit

:help
echo vcbuild.bat [debug/release] [clean] [noprojgen] [nobuild]
echo Examples:
echo   vcbuild.bat                : builds debug build
echo   vcbuild.bat release        : builds release build
goto exit

:exit
goto :EOF
