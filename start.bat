@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ===============================
echo  KeyStone MacroDesk - starting
echo ===============================
echo.

REM Docker has to be up before anything else, so fail loudly here instead of
REM letting the backend spew connection errors for a minute
docker info >nul 2>&1
if errorlevel 1 (
  echo [X] Docker Desktop is not running.
  echo     Launch it from the Start menu, wait for the whale icon to settle,
  echo     then run this file again.
  echo.
  pause
  exit /b 1
)
echo [1/5] Docker is running.

docker compose up -d
if errorlevel 1 (
  echo [X] docker compose failed. Try: docker compose logs db
  pause
  exit /b 1
)
echo [2/5] Postgres container started.

REM Postgres accepts the container start well before it accepts connections.
REM docker-compose.yml defines a healthcheck, so poll that rather than guessing.
set /a tries=0
:wait
docker inspect -f "{{.State.Health.Status}}" macrodesk-postgres 2>nul | findstr /i "healthy" >nul
if not errorlevel 1 goto ready
set /a tries+=1
if !tries! GEQ 40 (
  echo [X] Postgres never reported healthy. Check: docker compose logs db
  pause
  exit /b 1
)
if !tries!==1 echo       waiting for Postgres to accept connections...
timeout /t 2 /nobreak >nul
goto wait

:ready
echo [3/5] Postgres ready.

REM Schema before the API starts, or sign-in fails against a missing users table
pushd "%~dp0backend"
call node sql\migrate.js
if errorlevel 1 (
  echo [X] Migrations failed. The API will not be able to sign anyone in.
  popd
  pause
  exit /b 1
)
popd
echo [4/5] Schema up to date.

start "MacroDesk API" cmd /k "cd /d "%~dp0backend" && npm run dev"
start "MacroDesk Web" cmd /k "cd /d "%~dp0frontend" && npm run dev"
echo [5/5] API and web servers launched in their own windows.

REM give Next a moment to bind the port before the browser goes looking
timeout /t 7 /nobreak >nul
start "" http://localhost:3000

echo.
echo Running:
echo   web    http://localhost:3000
echo   api    http://localhost:4000/api/health
echo   db     localhost:5433
echo.
echo Close the two server windows to stop, or run stop.bat
echo.
timeout /t 6 /nobreak >nul
endlocal
