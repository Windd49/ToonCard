@echo off
chcp 65001 >nul
title 漫劇卡 ToonCard
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
node server.js --open
pause
exit /b

:nonode
echo 找不到 Node.js，改為直接開啟網頁（部分 API 可能因為跨域限制無法連線）。
start "" "%~dp0index.html"
pause
