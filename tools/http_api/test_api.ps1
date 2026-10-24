# qidian编辑器 本地 AI API 一键测试
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File test_api.ps1
#   powershell -ExecutionPolicy Bypass -File test_api.ps1 -PhoneIp 192.168.3.4
#   powershell -ExecutionPolicy Bypass -File test_api.ps1 -Prompt "讲个笑话"
#
# 会自动从 adb 取手机 IP（手机连着数据线时），取不到就让你手输。

param(
    [string]$PhoneIp = "",
    [int]$Port = 9999,
    [string]$Prompt = "你好，用一句话介绍你自己",
    [int]$TimeoutSec = 120
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Step($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Write-Ok($t)   { Write-Host "  [OK] $t" -ForegroundColor Green }
function Write-Bad($t)  { Write-Host "  [!!] $t" -ForegroundColor Red }
function Write-Info($t) { Write-Host "  $t" -ForegroundColor Gray }

# ---------- 1. 找手机 IP ----------
if (-not $PhoneIp) {
    Write-Step "自动探测手机 IP"
    $adbCandidates = @(
        "$PSScriptRoot\..\..\..\Downloads\qidianmini\platform-tools\adb.exe",
        "C:\Users\$env:USERNAME\Downloads\qidianmini\platform-tools\adb.exe",
        "adb"
    )
    $adb = $null
    foreach ($c in $adbCandidates) {
        if ($c -eq "adb") {
            if (Get-Command adb -ErrorAction SilentlyContinue) { $adb = "adb"; break }
        } elseif (Test-Path $c) { $adb = $c; break }
    }

    if ($adb) {
        try {
            $ip = & $adb shell "ip -4 addr show wlan0 2>/dev/null | grep inet | head -1 | awk '{print `$2}' | cut -d/ -f1" 2>$null
            $ip = ($ip | Out-String).Trim()
            if ($ip -match '^\d+\.\d+\.\d+\.\d+$') {
                $PhoneIp = $ip
                Write-Ok "从 adb 读到手机 IP: $PhoneIp"
            }
        } catch { }
    }

    if (-not $PhoneIp) {
        Write-Info "没读到 adb，或手机没连数据线。"
        Write-Info "也可以看 App 里：右上角头像 -> 关于 -> 局域网 AI API 地址"
        $PhoneIp = Read-Host "请手动输入手机 IP（如 192.168.3.4）"
    }
}

$base = "http://${PhoneIp}:${Port}"
Write-Host "`n目标地址: $base" -ForegroundColor Yellow

# ---------- 2. /health ----------
Write-Step "检查 /health"
try {
    $h = Invoke-RestMethod -Uri "$base/health" -TimeoutSec 8 -ErrorAction Stop
    Write-Ok "服务在线"
    Write-Info "模型就绪: $($h.ai)   模型: $($h.model)   已服务: $($h.chats) 次   运行: $($h.uptime) 秒"
    if (-not $h.ai) {
        Write-Info "模型还在加载，等 3 秒后重试..."
        Start-Sleep -Seconds 3
        $h = Invoke-RestMethod -Uri "$base/health" -TimeoutSec 8
        Write-Info "重试后模型就绪: $($h.ai)"
    }
} catch {
    Write-Bad "连不上 $base/health"
    Write-Info $_.Exception.Message
    Write-Host "`n排查顺序：" -ForegroundColor Yellow
    Write-Info "1) 手机 App 是否在前台/刚打开过？（打开一次会自动恢复服务）"
    Write-Info "2) 电脑和手机是否同一 WiFi？（手机 IP 网段应和电脑一致）"
    Write-Info "3) 路由器是否开了 AP 隔离？（开了设备之间不能互访）"
    Write-Info "4) 手机是否熄屏很久？先解锁亮屏再试。"
    exit 1
}

# ---------- 3. POST /chat ----------
Write-Step "调用 POST /chat"
Write-Info "提问: $Prompt"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $body = @{ prompt = $Prompt } | ConvertTo-Json -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $r = Invoke-RestMethod -Uri "$base/chat" -Method Post `
        -ContentType "application/json; charset=utf-8" `
        -Body $bytes -TimeoutSec $TimeoutSec -ErrorAction Stop
    $sw.Stop()
    Write-Ok "收到回答（客户端耗时 $([math]::Round($sw.Elapsed.TotalSeconds,1)) 秒，服务端 $($r.ms) ms）"
    Write-Host ""
    Write-Host $r.reply -ForegroundColor White
    Write-Host ""
} catch {
    $sw.Stop()
    $resp = $_.Exception.Response
    if ($resp) {
        $code = [int]$resp.StatusCode
        try {
            $stream = $resp.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $text = $reader.ReadToEnd()
            Write-Bad "HTTP $code"
            Write-Host $text -ForegroundColor DarkYellow
            if ($code -eq 503) { Write-Info "模型还在加载，5 秒后再跑一次这个脚本即可。" }
        } catch {
            Write-Bad "HTTP $code（响应体读取失败）"
        }
    } else {
        Write-Bad "请求失败: $($_.Exception.Message)"
        Write-Info "超时时间 ${TimeoutSec}s。1.5B 模型在 CPU 上首次推理可能较慢，可用 -TimeoutSec 300 再试。"
    }
    exit 1
}

Write-Step "完成"
Write-Info "浏览器打开 $base 可以看接口说明页。"
