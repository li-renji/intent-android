# 起点OS mini — PC 端调用手机内 AI（文件桥接，不经过 HTTP）
# 用法: .\ask.ps1 "你好"
#
# 原理: 通过 adb run-as 往 App 私有目录写 /tmp/api_request，
#       app.js 的桥接线程读到后调用本地 AI，把结果写到 /tmp/api_response。
# 相比 HTTP 方式，这条通道不依赖 toybox/nc，适合确认「AI 本身是否正常」。

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Prompt,

    [int]$TimeoutSec = 60
)

$ErrorActionPreference = 'Stop'

function Find-Adb {
    $candidates = @()

    $cmd = Get-Command adb -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }
    if ($env:ANDROID_HOME) { $candidates += (Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe') }
    if ($env:ANDROID_SDK_ROOT) { $candidates += (Join-Path $env:ANDROID_SDK_ROOT 'platform-tools\adb.exe') }
    # 本机实际存放位置（上次调试用的那套 platform-tools）
    $candidates += (Join-Path $env:USERPROFILE 'Downloads\qidianmini\platform-tools\adb.exe')
    $candidates += (Join-Path $env:USERPROFILE 'Downloads\platform-tools\adb.exe')

    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { return (Resolve-Path $c).Path }
    }
    throw '未找到 adb.exe。请把 platform-tools 放到 PATH，或设置 ANDROID_HOME。'
}

$adb = Find-Adb
$pkg = 'com.qidian.minios'
$requestFile = "/data/user/0/$pkg/files/rootfs/tmp/api_request"
$responseFile = "/data/user/0/$pkg/files/rootfs/tmp/api_response"

# 前置检查：设备是否在线
$devices = & $adb devices | Select-String 'device$'
if (-not $devices) { throw '没有检测到已连接的设备，检查数据线/USB 调试授权。' }

# App 是否在跑（不在跑 AI 不会响应）
$pidOut = & $adb shell "pidof $pkg" 2>$null
if (-not $pidOut) {
    Write-Host '警告: 起点OS mini 似乎没在运行，AI 不会响应。' -ForegroundColor Yellow
}

# 清掉上一次的残留响应
& $adb shell "run-as $pkg rm -f $responseFile"

# prompt 走 base64 传，避免引号/换行被 shell 吞掉
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Prompt))
Write-Host "发送: $Prompt" -ForegroundColor Cyan
& $adb shell "run-as $pkg sh -c 'echo $b64 | base64 -d > $requestFile'" | Out-Null

Write-Host '等待 AI 回复...' -ForegroundColor Yellow
$found = $false
$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
    $r = (& $adb shell "run-as $pkg test -f $responseFile && echo yes || echo no") -join ''
    if ($r.Trim() -eq 'yes') { $found = $true; break }
    Start-Sleep -Milliseconds 500
}

if ($found) {
    $resp = (& $adb shell "run-as $pkg cat $responseFile") -join "`n"
    Write-Host "`n--- AI 回复 ---" -ForegroundColor Green
    Write-Host $resp
    & $adb shell "run-as $pkg rm -f $responseFile"
}
else {
    Write-Host '超时，AI 没回复。' -ForegroundColor Red
    Write-Host '排查: 1) App 是否在前台  2) 等 AI 加载完（约 5s）  3) adb shell run-as com.qidian.minios cat files/rootfs/tmp/bridge_debug.log' -ForegroundColor Gray
}
