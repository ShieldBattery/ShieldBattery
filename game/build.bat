@rem Main ways to call this are "build.bat debug", "build.bat release" and "build.bat release sign"
@echo off

SETLOCAL
set scriptroot=%~dp0

@rem Arguments
set cargoflags=
set sign=

:next-arg
if "%1"=="" goto args-done
if /i "%1"=="debug"         set cargoflags=&goto arg-ok
if /i "%1"=="release"       set cargoflags=--release&goto arg-ok
if /i "%1"=="sign"          set sign=1&goto arg-ok

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
if not exist %scriptroot%\dist\bspatch.exe xcopy "%scriptroot%\..\tools\bspatch.exe" "%scriptroot%\dist" /y /f /c
if not exist %scriptroot%\dist\ICSharpCode.SharpZipLib.dll xcopy "%scriptroot%\..\tools\ICSharpCode.SharpZipLib.dll" "%scriptroot%\dist" /y /f /c


@rem build the DLL
cargo build %cargoflags%
if errorlevel 1 goto exit

if [%cargoflags%]==[--release] (
  xcopy "%scriptroot%\target\i686-pc-windows-msvc\release\shieldbattery.dll" "%scriptroot%\dist" /y /f /c
) else (
  xcopy "%scriptroot%\target\i686-pc-windows-msvc\debug\shieldbattery.dll" "%scriptroot%\dist" /y /f /c
)

if not defined sign goto skipsign
signtool sign /n "Travis Collins" /d "ShieldBattery Game Client" /du "https://shieldbattery.net" /t "http://timestamp.comodoca.com/authenticode" /fd SHA256 "%scriptroot%\dist\shieldbattery.dll" > %temp%\sign.txt 2>&1
if errorlevel 1 (
  echo Signing the DLL failed.
  goto exit
)
:skipsign

:exit
