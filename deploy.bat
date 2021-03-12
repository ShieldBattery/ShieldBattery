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

docker buildx build --platform linux/arm/v7,linux/arm64/v8,linux/amd64 -t %IMG%
if errorlevel 1 (
  echo Error building the image
  goto exit
)

@rem Give the image the tag for the current NPM version
docker tag %IMG% %NPM_TAG%
if errorlevel 1 (
  echo Error tagging the image with the current NPM version
  goto exit
)

@rem Update the "latest" tag to point to the newest image.
docker tag %IMG% %LATEST_TAG%
if errorlevel 1 (
  echo Error tagging the image with the latest tag
  goto exit
)

echo -------------
CHOICE /C:YN /N /M "Image has been built, push to Docker Hub? [yN]: "
if %ERRORLEVEL% neq 1 (
  echo Not pushing to Docker Hub, workflow complete.
  goto :nopush
)

@rem Log in to the Docker Hub account where the image will be pushed. The console may prompt for
@rem authentication. This account must have access to the shieldbattery organization.
echo Logging into Docker Hub...
docker login
if errorlevel 1 (
  echo Error logging into Docker Hub
  goto exit
)

@rem Push the image to the Docker hub. Docker hub account needs to be setup for this step to work.
docker push %NAME%
if errorlevel 1 (
  echo Error pushing the image
  goto exit
)

exit /b 0

:nopush
exit /b 0

:exit
