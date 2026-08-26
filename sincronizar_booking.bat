@echo off
title Sincronizador de Booking.com - Malargue al Sur
color 0b
echo ========================================================
echo   SINCRONIZADOR DE RESERVAS DE BOOKING.COM
echo   MALARGUE AL SUR DEPARTAMENTOS
echo ========================================================
echo.
echo Iniciando proceso de sincronizacion...
echo.
node import_booking.js
echo.
echo Proceso finalizado. Presiona cualquier tecla para salir.
pause > nul
