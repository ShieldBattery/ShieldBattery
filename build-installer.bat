echo Building installer...

echo Building Release shieldbattery binaries...
call "%~dp0\vcbuild.bat"
if errorlevel 1 goto binary-build-failed
echo "Done!"

echo Bundling JS and building update manifest...
cd "%~dp0\bundler"
cmd.exe /c npm start
cd "%~dp0"

echo Building Release Installer...
if not defined VS140COMNTOOLS goto msbuild-not-found
if not exist "%VS140COMNTOOLS%\..\..\vc\vcvarsall.bat" goto msbuild-not-found
echo Found Visual Studio 2015
if "%VCVARS_VER%" NEQ "140" (
  call "%VS140COMNTOOLS%\..\..\vc\vcvarsall.bat"
  SET VCVARS_VER=140
)
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
