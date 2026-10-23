@echo off
chcp 65001 >nul
title 起点OS mini - 电脑文件桥
echo 正在启动电脑文件桥...
node "%~dp0pc_bridge.js"
pause
