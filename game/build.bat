@rem Main ways to call this are "build.bat debug" and "build.bat release".
@rem Builds the 64-bit DLL (what the app injects by default) unless "x86" is
@rem passed to build the 32-bit one instead.
@echo off

SETLOCAL
set startdir=%CD%
set scriptroot=%~dp0

@rem Arguments
set cargoflags=
set target=--target x86_64-pc-windows-msvc
set is64=1

:next-arg
if "%1"=="" goto args-done
if /i "%1"=="debug"         set cargoflags=&goto arg-ok
if /i "%1"=="release"       set cargoflags=--release&goto arg-ok
if /i "%1"=="x86_64"        set target=--target x86_64-pc-windows-msvc&set is64=1&goto arg-ok
if /i "%1"=="x86"           set target=--target i686-pc-windows-msvc&set is64=0&goto arg-ok

echo Warning: ignoring invalid command line option `%1`.

:arg-ok
shift
goto next-arg

:args-done

@rem init dist directory and it's files excluding the Rust DLL
if not exist "%scriptroot%\dist" mkdir "%scriptroot%\dist"
if not exist "%scriptroot%\dist\d3dcompiler_47.dll" (
  if exist "%ProgramFiles(x86)%\Windows Kits\8.1\Redist\D3D\x86\d3dcompiler_47.dll" (
    xcopy "%ProgramFiles(x86)%\Windows Kits\8.1\Redist\D3D\x86\d3dcompiler_47.dll" "%scriptroot%\dist" /y /f /c
  ) else (
    if exist "%ProgramFiles(x86)%\Windows Kits\10\Redist\D3D\x86\d3dcompiler_47.dll" (
      xcopy "%ProgramFiles(x86)%\Windows Kits\10\Redist\D3D\x86\d3dcompiler_47.dll" "%scriptroot%\dist" /y /f /c
    ) else (
      echo Warning: Could not find d3dcompiler_47.dll. Visual Studio / Windows SDK may need to be installed.
    )
  )
)

xcopy "%scriptroot%\..\tools\sb_init.dll" "%scriptroot%\dist" /y /f /c
xcopy "%scriptroot%\..\tools\sb_init_64.dll" "%scriptroot%\dist" /y /f /c

@rem build the DLL
cd "%scriptroot%"
cargo build %target% %cargoflags%
if not errorlevel 0 goto exit

@rem this did xcopy before, but xcopy isn't good for renaming the 64-bit dll,
@rem so mimicking xcopy with echo + copy
if [%is64%]==[1] (
    if [%cargoflags%]==[--release] (
        set copysrc=%scriptroot%\target\x86_64-pc-windows-msvc\release\shieldbattery.dll
    ) else (
        set copysrc=%scriptroot%\target\x86_64-pc-windows-msvc\debug\shieldbattery.dll
    )
    set copytgt=%scriptroot%\dist\shieldbattery_64.dll
) else (
    if [%cargoflags%]==[--release] (
        set copysrc=%scriptroot%\target\i686-pc-windows-msvc\release\shieldbattery.dll
    ) else (
        set copysrc=%scriptroot%\target\i686-pc-windows-msvc\debug\shieldbattery.dll
    )
    set copytgt=%scriptroot%\dist\shieldbattery.dll
)
echo %copysrc% -^> %copytgt%
copy "%copysrc%" "%copytgt%" /y

:exit
set OLDERROR=%ERRORLEVEL%
cd "%startdir%"
exit /b %OLDERROR%
