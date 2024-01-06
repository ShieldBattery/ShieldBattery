@rem Runs integration tests locally. Requires Docker to be set up.

SETLOCAL

set startdir=%CD%
set scriptroot=%~dp0
cd "%scriptroot%\integration"

@rem Arguments
set nobuild=
set playwrightargs=

set var=0
:nextarg
set /A var=%var% + 1
for /F "tokens=%var% delims= " %%A in ("%*") do (
    if "%%~A"=="nobuild" set nobuild=true
    if not "%%~A"=="nobuild" set "playwrightargs=%playwrightargs%%%A "
    goto nextarg
)

docker-compose down -v
if "%nobuild%" NEQ "true" (
  docker-compose build
)
if errorlevel 1 goto exit
docker-compose up -V -d
if errorlevel 1 goto exit

cd ..
yarn run wait-on "http-get://localhost:5527" && yarn run test:integration %playwrightargs%

:exit
cd "%startdir%"
