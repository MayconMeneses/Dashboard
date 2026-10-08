@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
echo Juntando as 2 partes do instalador completo...
copy /b Instalador-Completo-0.2.0.parte0.bin+Instalador-Completo-0.2.0.parte1.bin "Instalador-Dashboard-Universal-0.2.0.exe" >nul
if errorlevel 1 ( echo Falhou: deixe as 2 partes .bin na mesma pasta deste arquivo. & pause & exit /b 1 )
set "H="
for /f "skip=1 tokens=*" %%h in ('certutil -hashfile "Instalador-Dashboard-Universal-0.2.0.exe" SHA256') do if not defined H set "H=%%h"
set "H=!H: =!"
if /i "!H!"=="877f1fc2b483bfcf2c1697f2d54533501ce019a82f2203f3952766607645359c" ( echo Arquivo conferido com sucesso. ) else ( echo ATENCAO: o arquivo juntado nao confere. Baixe as partes novamente. & pause & exit /b 1 )
echo Pronto: Instalador-Dashboard-Universal-0.2.0.exe
pause
