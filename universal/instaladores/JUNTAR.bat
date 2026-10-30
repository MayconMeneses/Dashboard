@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
echo Juntando as 2 partes do instalador completo 0.4.0...
copy /b Instalador-Completo-0.4.0.parte0.bin+Instalador-Completo-0.4.0.parte1.bin "Instalador-Dashboard-Universal-0.4.0.exe" >nul
if errorlevel 1 ( echo Falhou: deixe as 2 partes .bin na mesma pasta deste arquivo. & pause & exit /b 1 )
set "H="
for /f "skip=1 tokens=*" %%h in ('certutil -hashfile "Instalador-Dashboard-Universal-0.4.0.exe" SHA256') do if not defined H set "H=%%h"
set "H=!H: =!"
if /i "!H!"=="2933ec692978f6aea9ed62d6e2b720a0a3036c45de30745a4fb1516879f84c06" ( echo Arquivo conferido com sucesso. ) else ( echo ATENCAO: o arquivo juntado nao confere. Baixe as partes novamente. & del "Instalador-Dashboard-Universal-0.4.0.exe" & pause & exit /b 1 )
echo Pronto: Instalador-Dashboard-Universal-0.4.0.exe
pause
