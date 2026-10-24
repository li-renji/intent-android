@echo off
chcp 65001 >nul
title qidian编辑器 - 电脑文件桥
echo 正在启动电脑文件桥...
node "%~dp0pc_bridge.js"
pause
