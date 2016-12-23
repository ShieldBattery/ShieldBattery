echo Building installer...

echo Building Release shieldbattery binaries...
call "%~dp0\vcbuild.bat" %*
if errorlevel 1 goto binary-build-failed
echo "Done!"

echo Bundling JS and building update manifest...
cd "%~dp0\bundler"
cmd.exe /c npm start
cd "%~dp0"

echo Finding Visual Studio files
if not defined VS140COMNTOOLS goto msbuild-not-found
if not exist "%VS140COMNTOOLS%\..\..\vc\vcvarsall.bat" goto msbuild-not-found
echo Found Visual Studio 2015
if "%VCVARS_VER%" NEQ "140" (
  call "%VS140COMNTOOLS%\..\..\vc\vcvarsall.bat"
  SET VCVARS_VER=140
)
if not defined VCINSTALLDIR goto msbuild-not-found

echo Signing binaries
REM This breaks the hashes in the manifest (but we're not currently using it). If we do start using
REM it, fix this problem :)
signtool sign /n "Travis Collins" /d "ShieldBattery Psi Service" /du "https://shieldbattery.net" /t "http://timestamp.comodoca.com/authenticode" "%~dp0\bundler\bundle\psi.exe"
if errorlevel 1 goto sign-failed
signtool sign /n "Travis Collins" /d "ShieldBattery Psi Utility" /du "https://shieldbattery.net" /t "http://timestamp.comodoca.com/authenticode" "%~dp0\bundler\bundle\psi-emitter.exe"
if errorlevel 1 goto sign-failed
signtool sign /n "Travis Collins" /d "ShieldBattery Client" /du "https://shieldbattery.net" /t "http://timestamp.comodoca.com/authenticode" "%~dp0\bundler\bundle\shieldbattery.dll"
if errorlevel 1 goto sign-failed

echo Building Release Installer...
msbuild installer\installer.sln /m /t:Build /p:Configuration=Release /clp:NoSummary;NoItemAndPropertyList;Verbosity=minimal /nologo
if errorlevel 1 goto installer-build-failed

echo Signing Release Installer...
signtool sign /n "Travis Collins" /d "ShieldBattery Installer" /du "https://shieldbattery.net" /t "http://timestamp.comodoca.com/authenticode" "%~dp0\installer\bin\Release\installer.msi"
if errorlevel 1 goto installer-sign-failed
echo Done!
goto exit

:msbuild-not-found
echo Build skipped. To build, this file needs to run from VS cmd prompt.
goto exit

:binary-build-failed
echo Building the binaries failed.
goto exit

:sign-failed
echo Failed signing a binary.
goto exit

:installer-build-failed
echo Building the installer failed.
goto exit

:installer-sign-failed
echo Signing the installer failed.
goto exit

:exit
cd "%~dp0"
goto :EOF
