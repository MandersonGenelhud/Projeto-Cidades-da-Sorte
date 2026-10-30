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
:rodar
node src/server.js
rem Codigo 3 = o painel acabou de se atualizar: abre de novo sozinho.
if %errorlevel%==3 (
  set OPEN_BROWSER=
  echo.
  echo  Atualizado! Reabrindo o agente...
  goto rodar
)
rem Codigo 0 = desligado de proposito (Ctrl+C). Qualquer outro = caiu: reabre sozinho.
if not %errorlevel%==0 (
  set OPEN_BROWSER=
  echo.
  echo  O agente parou por um erro. Reabrindo em 10 segundos...
  timeout /t 10 /nobreak >nul
  goto rodar
)
echo.
pause
