@rem This script should be called with the current version number of the
@rem server.
@rem
@rem Since it is intended for building deployable artifacts, it requires a clean
@rem git working directory (e.g. no uncommitted changes).
@rem
@rem Example of running it manually:
@rem  - "deploy.bat 6.1.2"
@rem  - "deploy.bat $npm_package_version" (if run from a npm script)
@echo off

SETLOCAL

if "%1"=="" (
  echo Missing required version argument
  goto :exit
)

SET version=%1

@rem Handle changes that are not staged
git diff --exit-code > nul
if errorlevel 1 (
  echo Uncommitted git changes detected. Please commit them and try again.
  goto exit
)

@rem Handle changes that are staged
git diff --cached --exit-code > nul
if errorlevel 1 (
  echo Uncommitted git changes detected. Please commit them and try again.
  goto exit
)


SET gitsha=
FOR /F "tokens=* USEBACKQ" %%F IN (`git rev-parse --verify HEAD`) DO (
  SET gitsha=%%F
)

if errorlevel 1 (
  echo Error retrieving current git SHA
  goto :exit
)
if "%gitsha%" == "" (
  echo Error retrieving current git SHA
  goto :exit
)

SET NAME=shieldbattery/shieldbattery
SET IMG=%NAME%:%gitsha%
SET NPM_TAG=%NAME%:%version%
SET LATEST_TAG=%NAME%:latest


docker buildx build --platform linux/arm64/v8,linux/amd64 -t %IMG% -t %NPM_TAG% -t %LATEST_TAG% --push .
if errorlevel 1 (
  echo Error building the image
  goto exit
)

exit /b 0

:exit
