@echo off
title Desinstalar inicio automático - Zebra Relay
echo.
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET=%STARTUP%\zebra-liquipops.bat"

if exist "%TARGET%" (
    del "%TARGET%"
    echo  Inicio automatico eliminado correctamente.
) else (
    echo  El relay no estaba configurado para inicio automatico.
)
echo.
pause
