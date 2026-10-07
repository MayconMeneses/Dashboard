@echo off
rem Inicia o painel sem depender da política de execução do PowerShell.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar-painel.ps1"
pause
