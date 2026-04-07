@echo off
title Instalar inicio automático - Zebra Relay LIQUIPOPS
echo.
echo  ===============================================
echo    INSTALAR INICIO AUTOMATICO - ZEBRA RELAY
echo  ===============================================
echo.

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "BAT_FILE=%~dp0iniciar-zebra.bat"

:: Verificar que iniciar-zebra.bat existe
if not exist "%BAT_FILE%" (
    echo  ERROR: iniciar-zebra.bat no encontrado.
    echo  Asegurese de que ambos archivos esten en la misma carpeta.
    pause
    exit /b 1
)

:: Copiar al inicio de Windows
copy "%BAT_FILE%" "%STARTUP%\zebra-liquipops.bat" >nul

echo  LISTO! El relay se iniciara automaticamente al encender el PC.
echo.
echo  Archivo instalado en:
echo  %STARTUP%\zebra-liquipops.bat
echo.
echo  Para desinstalar, elimine ese archivo o ejecute desinstalar-inicio.bat
echo.
pause
