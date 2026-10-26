@echo off
chcp 65001 >nul
title ZapAuto - Agente de WhatsApp
cd /d "%~dp0"
echo.
echo  ==========================================
echo    ZapAuto - Agente de WhatsApp
echo  ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [!] O Node.js ainda nao esta instalado neste computador.
  echo      Vou abrir o site para voce baixar. Instale e depois
  echo      clique duas vezes neste arquivo de novo.
  start "" https://nodejs.org/pt-br/download
  echo.
  pause
  exit /b
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 22 (
  echo  [!] Seu Node.js e antigo. Instale a versao LTS mais nova:
  start "" https://nodejs.org/pt-br/download
  echo.
  pause
  exit /b
)

if not exist node_modules (
  echo  Instalando os componentes. So acontece na primeira vez
  echo  e pode levar alguns minutos...
  echo.
  call npm install --omit=dev
  if errorlevel 1 (
    echo.
    echo  [!] A instalacao falhou. Verifique a internet e tente de novo.
    pause
    exit /b
  )
)

echo.
echo  Tudo pronto! O painel vai abrir no navegador.
echo  NAO FECHE esta janela enquanto estiver usando o agente.
echo  Para desligar, feche esta janela.
echo.
set OPEN_BROWSER=1
node src/server.js
echo.
pause
