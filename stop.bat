@echo off
cd /d "%~dp0"

echo Stopping KeyStone MacroDesk...

REM close by window title so we only kill our own node processes,
REM not whatever else you have running
taskkill /F /FI "WINDOWTITLE eq MacroDesk API*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq MacroDesk Web*" >nul 2>&1
echo   servers stopped

REM stop, not down: `down` would remove the container and you would wait for
REM Postgres to re-initialise next time. The data volume survives either way.
docker compose stop >nul 2>&1
echo   database stopped

echo.
echo Done.
timeout /t 3 /nobreak >nul
