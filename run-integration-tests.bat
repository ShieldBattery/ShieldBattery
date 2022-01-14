@rem Runs integration tests locally. Requires Docker to be set up.

SETLOCAL

set startdir=%CD%
set scriptroot=%~dp0
cd "%scriptroot%\integration"

docker-compose down -v
docker-compose build
if errorlevel 1 goto exit
docker-compose up -V -d
if errorlevel 1 goto exit

cd ..
yarn run test:integration

:exit
cd "%startdir%"
