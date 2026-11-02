@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo === Copiar os contratos do sistema antigo para o Migra Hub ===
echo.
where node >nul 2>nul || (echo Instale o Node.js em nodejs.org e rode de novo. & pause & exit /b 1)
if not exist node_modules (echo Preparando a ferramenta, so na primeira vez... & call npm install --no-audit --no-fund)
node capturar.mjs
echo.
pause
