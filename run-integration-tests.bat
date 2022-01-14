@rem Runs integration tests locally. Requires Docker to be set up.

SETLOCAL

set startdir=%CD%
set scriptroot=%~dp0
cd "%scriptroot%\integration"

@rem Arguments
set nobuild=

:next-arg
if "%1"=="" goto args-done
if /i "%1"=="nobuild"         set nobuild=true&goto arg-ok

echo Warning: ignoring invalid command line option `%1`.

:arg-ok
shift
goto next-arg

:args-done

docker-compose down -v
if "%nobuild%" NEQ "true" (
  docker-compose build
)
if errorlevel 1 goto exit
docker-compose up -V -d
if errorlevel 1 goto exit

cd ..
@rem Wait for the server to be up
timeout /t 10 /nobreak
yarn run test:integration

:exit
cd "%startdir%"
