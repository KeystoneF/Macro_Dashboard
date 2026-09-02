@echo off
setlocal
cd /d "%~dp0"

REM Builds a zip to hand to someone else.
REM
REM This uses git archive rather than zipping the folder, and that is the whole
REM point: git archive can only export files git is tracking, so anything in
REM .gitignore is excluded by construction. backend\.env holds the FMP key, the
REM FRED key, the database password and the JWT secret, and it is gitignored, so
REM it cannot end up in the archive even by accident. Zipping the folder in
REM Explorer would include it.

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [X] Not a git repository, so there is no safe file list to export.
  echo     Run: git init ^&^& git add -A ^&^& git commit -m "initial"
  pause
  exit /b 1
)

REM Uncommitted work is not in the archive, so say so rather than shipping a
REM copy that is quietly behind the working tree.
for /f %%i in ('git status --porcelain') do (
  echo [!] You have uncommitted changes. The archive exports the last commit only.
  echo     Commit first if you want them included.
  echo.
  goto :ask
)
:ask

set STAMP=%DATE:~-4%%DATE:~4,2%%DATE:~7,2%
set OUT=macro-desk-%STAMP%.zip

git archive --format=zip --output="%OUT%" HEAD
if errorlevel 1 (
  echo [X] git archive failed.
  pause
  exit /b 1
)

echo.
echo Wrote %OUT%
echo.
echo Excluded, because they are gitignored:
echo   backend\.env      keys, database password, JWT secret
echo   node_modules\     the recipient runs npm install
echo   .next\            build output
echo.
echo The recipient needs their own backend\.env. Send them backend\.env.example
echo and the values through something other than the archive.
echo.
pause
