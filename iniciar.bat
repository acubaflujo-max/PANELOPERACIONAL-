@echo off
cd /d "%~dp0"
where node >nul 2>&1 || (
  echo No encuentro Node.js. Instalalo desde https://nodejs.org y vuelve a abrir este archivo.
  pause
  exit /b 1
)
rem Abre el navegador 2 segundos despues, cuando el servidor ya esta listo.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3030"
echo Panel en http://localhost:3030  (cierra esta ventana para detenerlo)
node server.js
echo.
echo El servidor se detuvo. Si hay un error arriba, copialo y mandamelo.
pause
