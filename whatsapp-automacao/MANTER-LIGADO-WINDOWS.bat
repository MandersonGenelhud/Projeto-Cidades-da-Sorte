@echo off
chcp 65001 >nul
title Migra Hub - Manter o computador ligado
rem Pede permissao de administrador (o Windows mostra uma janela para confirmar).
net session >nul 2>nul
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
echo.
echo  ==========================================
echo    Migra Hub - manter o sistema no ar
echo  ==========================================
echo.
echo  1) Tela pode apagar, mas o computador NUNCA dorme nem hiberna (na tomada)...
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 15

echo  2) Atualizacao do Windows nao reinicia sozinha com alguem logado...
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" /v NoAutoRebootWithLoggedOnUsers /t REG_DWORD /d 1 /f >nul
reg add "HKLM\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings" /v ActiveHoursStart /t REG_DWORD /d 6 /f >nul
reg add "HKLM\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings" /v ActiveHoursEnd /t REG_DWORD /d 23 /f >nul

echo  3) Se faltar luz e o computador religar, o sistema abre sozinho ao entrar no Windows...
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Migra Hub.lnk'); $s.TargetPath='%~dp0INICIAR-WINDOWS.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"

echo.
echo  Pronto! O que mudou:
echo   - o computador nao entra em suspensao nem hiberna;
echo   - o Windows Update nao reinicia sozinho enquanto voce estiver logado;
echo   - o Migra Hub abre sozinho quando o Windows liga.
echo.
echo  Dica: em Configuracoes do Windows, deixe o usuario entrar sem senha
echo  so se o computador ficar num lugar seguro. Caso contrario, depois de
echo  uma queda de luz, alguem precisa entrar no Windows para o sistema abrir.
echo.
pause
