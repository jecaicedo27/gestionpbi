@echo off
title Zebra Relay - LIQUIPOPS
color 0A
echo.
echo  ===============================================
echo    ZEBRA ZD230 RELAY - LIQUIPOPS
echo  ===============================================
echo.

:: Verificar Node.js
node -v >nul 2>&1
if errorlevel 1 (
    color 0C
    echo  ERROR: Node.js no esta instalado.
    echo.
    echo  Descarga e instala Node.js desde:
    echo  https://nodejs.org/en/download
    echo.
    pause
    exit /b 1
)

:: Descargar zebra-relay.js si no existe
if not exist "%~dp0zebra-relay.js" (
    echo  Descargando zebra-relay.js desde gestionpbi.lat...
    powershell -Command "Invoke-WebRequest -Uri 'https://gestionpbi.lat/zebra-relay.js' -OutFile '%~dp0zebra-relay.js'" 2>nul
    if errorlevel 1 (
        color 0C
        echo  ERROR: No se pudo descargar. Verifique su conexion a internet.
        pause
        exit /b 1
    )
    echo  Descargado correctamente.
    echo.
)

echo  Buscando impresora Zebra en la red...
echo  (Deje esta ventana minimizada, NO la cierre)
echo.
echo  Para detener: cierre esta ventana o presione Ctrl+C
echo.

:: Iniciar el relay
node "%~dp0zebra-relay.js"

echo.
echo  El relay se detuvo.
pause
