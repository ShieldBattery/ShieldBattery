@rem Runs integration tests locally. Requires Docker to be set up.

SETLOCAL

set startdir=%CD%
set scriptroot=%~dp0
cd "%scriptroot%\integration"

docker-compose down -v
docker-compose up -V -d

cd ..
yarn run test:integration

cd "%startdir%"
