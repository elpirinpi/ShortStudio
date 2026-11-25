@echo off
setlocal
title Compilador KellyClipAi Studio (.exe Windows) - Kelly Benjamin De La Cruz
cd /d "%~dp0"

echo =========================================================
echo   KellyClipAi Studio - Compilador Local para Windows (.exe)
echo   Desarrollado por: Kelly Benjamin De La Cruz
echo =========================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] No se encontro Node.js instalado en esta PC.
  echo Descarga Node.js LTS desde https://nodejs.org e intentalo de nuevo.
  pause
  exit /b 1
)

echo [1/4] Instalando dependencias principales...
call npm install --no-audit --no-fund --legacy-peer-deps
if errorlevel 1 (
  echo [ERROR] Fallo npm install.
  pause
  exit /b 1
)

echo.
echo [2/4] Compilando interfaz web y servidor local...
call npm run build
if errorlevel 1 (
  echo [ERROR] Fallo npm run build.
  pause
  exit /b 1
)

call npm run build:server
if errorlevel 1 (
  echo [ERROR] Fallo npm run build:server.
  pause
  exit /b 1
)

echo.
echo [3/4] Preparando paquete Electron Desktop...
if exist "electron\dist" rmdir /s /q "electron\dist"
xcopy /E /I /Y "dist" "electron\dist" >nul
call npm --prefix electron install --no-audit --no-fund --legacy-peer-deps
if errorlevel 1 (
  echo [ERROR] Fallo instalacion de Electron.
  pause
  exit /b 1
)

echo.
echo [4/4] Generando .exe para Windows (Instalador + Portable)...
call npm --prefix electron run dist:win
if errorlevel 1 (
  echo [ERROR] Fallo electron-builder.
  pause
  exit /b 1
)

echo.
echo =========================================================
echo   COMPILACION COMPLETADA!
echo   Tus ejecutables .exe estan en la carpeta: release\
echo =========================================================
if exist "release" start "" "release"
pause
