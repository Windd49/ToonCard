@echo off
chcp 65001 >nul
title 漫劇卡 ToonCard（區網模式）
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 需要先安裝 Node.js：https://nodejs.org
  pause
  exit /b
)
echo 手機請連到和電腦同一個 Wi-Fi，再用手機瀏覽器打開下面顯示的「手機」網址。
echo 第一次執行時 Windows 防火牆可能會詢問，請允許「私人網路」。
node server.js --lan --open
pause
