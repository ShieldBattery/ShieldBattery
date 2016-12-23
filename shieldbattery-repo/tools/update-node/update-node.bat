@echo off

@rem Builds and gathers the necessary files from the Node.js repo for building into our projects.
@rem This should be run automatically by our build script when it detects that the node submodule's
@rem version has changed.

set exitcode=0

@rem Store %~dp0 because it can change after we call things
set scriptroot=%~dp0
set nodepath=%scriptroot%\..\..\deps\node\
set startdir=%CD%

cd "%scriptroot%"
for /f "delims=" %%x in ('git submodule status ../../deps/node') do set nodeversion=%%x
set /p builtversion=<built-node-version.txt
cd "%startdir%"

echo Current node version is "%nodeversion%"
echo Last built node version is "%builtversion%"

if "%1"=="force" goto rebuild
if "%builtversion%"=="%nodeversion%" goto already-built

:rebuild
SETLOCAL
  @rem Config flags for node's configure script
  set config_flags=--enable-static
  @rem Necessary or the "tools" still get built as x64, which causes build failures
  set PROCESSOR_ARCHITECTURE=x86
  set PROCESSOR_ARCHITEW6432=x86

  echo Building node in debug mode...
  cd "%nodepath%"
  call "vcbuild.bat" debug x86 noperfctr noetw nosign
  if errorlevel 1 goto build-failed
ENDLOCAL

SETLOCAL
  @rem Config flags for node's configure script
  set config_flags=--enable-static
  @rem Necessary or the "tools" still get built as x64, which causes build failures
  set PROCESSOR_ARCHITECTURE=x86
  set PROCESSOR_ARCHITEW6432=x86

  echo Building node in release mode...
  cd "%nodepath%"
  call "vcbuild.bat" release x86 noperfctr noetw nosign
  if errorlevel 1 goto build-failed
ENDLOCAL

echo %nodeversion%>%scriptroot%\built-node-version.txt

echo Done!

goto exit

:build-failed
echo Failed to build node
set exitcode=1
goto exit

:already-built
echo Current version of Node is already built
goto exit

:exit
cd "%startdir%"
if exitcode==0 goto :EOF
exit /b %exitcode%
