echo Building installer...

echo Building Release shieldbattery binaries...
call "%~dp0\vcbuild.bat"
if errorlevel 1 goto binary-build-failed
echo "Done!"

echo Building Release Installer...
if not defined VS110COMNTOOLS goto msbuild-not-found
if not exist "%VS110COMNTOOLS%\..\..\vc\vcvarsall.bat" goto msbuild-not-found
call "%VS110COMNTOOLS%\..\..\vc\vcvarsall.bat"
if not defined VCINSTALLDIR goto msbuild-not-found

msbuild installer\installer.sln /m /t:Build /p:Configuration=Release /clp:NoSummary;NoItemAndPropertyList;Verbosity=minimal /nologo
if errorlevel 1 goto installer-build-failed
echo Done!
goto exit

:msbuild-not-found
echo Build skipped. To build, this file needs to run from VS cmd prompt.
goto exit

:binary-build-failed
echo Building the binaries failed.
goto exit

:installer-build-failed
echo Building the installer failed.
goto exit

:exit
cd "%~dp0"
goto :EOF
