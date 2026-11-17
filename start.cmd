@echo off
REM ============================================================================
REM  Chay app Cham thi OMR tren Windows — bam dup file nay la du.
REM  Moi logic nam trong run.mjs (Node.js), file nay chi tim Node roi goi no.
REM ============================================================================
setlocal

cd /d "%~dp0"

echo.
echo   CHAM THI OMR - khoi dong tren Windows
echo   ------------------------------------

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [X] Khong tim thay Node.js.
  echo.
  echo       Cach cai:
  echo         1. Tai ban LTS tai https://nodejs.org  va cai dat
  echo         2. HOAC chay:  winget install OpenJS.NodeJS.LTS
  echo         3. Mo lai Command Prompt roi bam dup file nay lan nua
  echo.
  pause
  exit /b 1
)

REM Chuyen tiep toan bo tham so (--port=..., --dev, ...) cho run.mjs
node "%~dp0run.mjs" %*
set EXITCODE=%errorlevel%

if not "%EXITCODE%"=="0" (
  echo.
  echo   [X] App dung voi loi ^(exit %EXITCODE%^). Xem log phia tren.
  pause
)
exit /b %EXITCODE%
