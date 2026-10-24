# qidian编辑器 看门狗 —— 一键安装（Windows）
# 用法： powershell -ExecutionPolicy Bypass -File install.ps1
param(
    [string]$Adb = ""
)

$ErrorActionPreference = "Stop"

# ---- 定位 adb ----
if (-not $Adb) {
    $candidates = @(
        "C:\Users\renji\Downloads\qidianmini\platform-tools\adb.exe",
        "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
        "C:\Users\renji\Downloads\platform-tools\adb.exe"
    )
    foreach ($c in $candidates) { if (Test-Path $c) { $Adb = $c; break } }
    if (-not $Adb) { $Adb = "adb" }
}
Write-Host "adb  : $Adb"

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $dir "qd_watchdog.sh"
if (-not (Test-Path $src)) { throw "找不到 qd_watchdog.sh" }

# ---- 确保 LF 换行 + 无 BOM ----
$text = [IO.File]::ReadAllText($src)
$text = $text -replace "`r`n", "`n"
$tmp = Join-Path $env:TEMP "qd_watchdog_lf.sh"
[IO.File]::WriteAllText($tmp, $text, (New-Object System.Text.UTF8Encoding($false)))

# ---- 设备检查 ----
$devices = & $Adb devices
if ($devices -notmatch "\tdevice") {
    throw "没有检测到设备，请先连上数据线并允许 USB 调试"
}

# ---- 推送 + 启动 ----
& $Adb push $tmp /data/local/tmp/qd_watchdog.sh | Out-Null
& $Adb shell "chmod 755 /data/local/tmp/qd_watchdog.sh"
& $Adb shell "sed -i 's/\r$//' /data/local/tmp/qd_watchdog.sh"
& $Adb shell "pkill -f qd_watchdog.sh 2>/dev/null; rm -f /data/local/tmp/qd_watchdog.pid"
& $Adb shell "setsid nohup sh /data/local/tmp/qd_watchdog.sh >/dev/null 2>&1 &"

Start-Sleep -Seconds 2

# ---- 验证 ----
$pidInfo = (& $Adb shell "cat /data/local/tmp/qd_watchdog.pid 2>/dev/null") -replace "`r", ""
$running = (& $Adb shell "pidof sh 2>/dev/null | head -1") -replace "`r", ""
Write-Host ""
Write-Host "看门狗 PID : $pidInfo"
& $Adb shell "tail -n 5 /data/local/tmp/qd_watchdog.log"

Write-Host ""
Write-Host "============================================"
Write-Host " 安装完成。之后 App 被杀会自动拉起。"
Write-Host " 查看日志: adb shell cat /data/local/tmp/qd_watchdog.log"
Write-Host " 卸载    : adb shell pkill -f qd_watchdog.sh"
Write-Host "============================================"
Write-Host "注意: 手机重启后看门狗会消失，需要重新运行本脚本。"
