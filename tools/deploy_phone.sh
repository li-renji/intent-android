#!/usr/bin/env bash
# 奇点OS mini —— 一键部署到指定设备
#
# 用法:
#   ./tools/deploy_phone.sh <手机IP> [adb端口] [模型目录]
#
# 示例:
#   ./tools/deploy_phone.sh 192.168.3.4 42811 /d/intent/model_cache/qwen2.5-1.5b-mnn
#
# 作用:
#   1) 无线连接设备
#   2) 安装 APK（debug 包直接覆盖；release 包需签名一致）
#   3) 可选：推送本地模型目录，跳过 792MB 下载

set -euo pipefail

PHONE_IP="${1:?用法: deploy_phone.sh <手机IP> [adb端口] [模型目录]}"
ADB_PORT="${2:-}"
MODEL_DIR="${3:-}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADB="${ADB:-}"
if [ -z "$ADB" ]; then
  for cand in "$REPO_ROOT/.toolchain/android-sdk/platform-tools/adb.exe" \
              "$HOME/AppData/Local/Android/Sdk/platform-tools/adb.exe" \
              "$(command -v adb 2>/dev/null || true)"; do
    [ -n "$cand" ] && [ -x "$cand" ] && ADB="$cand" && break
  done
fi
[ -z "$ADB" ] && { echo "找不到 adb，请设置 ADB 环境变量"; exit 1; }

APK="${APK:-$REPO_ROOT/app/build/outputs/apk/debug/app-debug.apk}"
PKG="com.qidian.minios"
MODEL_PATH="/data/data/$PKG/files/models/qwen2.5-1.5b-mnn"

echo "==> adb: $ADB"
echo "==> apk: $APK"

# 1) 连接
if [ -n "$ADB_PORT" ]; then
  "$ADB" connect "$PHONE_IP:$ADB_PORT" || true
else
  echo "!! 未指定 adb 端口。请在手机上「设置 → 开发者选项 → 无线调试 → 使用配对码配对设备」"
  echo "   查看 IP:端口 与 6 位配对码，然后："
  echo "   $ADB pair $PHONE_IP:<配对端口> <配对码>"
  exit 1
fi
sleep 2
"$ADB" devices

# 2) 安装
echo "==> 安装 APK ..."
if ! "$ADB" -s "$PHONE_IP:$ADB_PORT" install -r "$APK"; then
  echo "!! 直接安装失败（国产 ROM 常见拦截）。改用 pm 方式，请在手机上点「继续安装」:"
  "$ADB" -s "$PHONE_IP:$ADB_PORT" push "$APK" /data/local/tmp/qd.apk
  "$ADB" -s "$PHONE_IP:$ADB_PORT" shell "pm install -r /data/local/tmp/qd.apk" || {
    echo "!! 仍失败。请解锁手机并在弹窗上点「继续安装」，然后重跑本脚本。"
    exit 1
  }
fi

# 3) 推送模型（可选，跳过下载）
if [ -n "$MODEL_DIR" ]; then
  if [ ! -d "$MODEL_DIR" ]; then
    echo "!! 模型目录不存在: $MODEL_DIR"; exit 1
  fi
  echo "==> 推送模型到 $MODEL_PATH ..."
  "$ADB" -s "$PHONE_IP:$ADB_PORT" shell "run-as $PKG mkdir -p $MODEL_PATH" 2>/dev/null || true
  for f in "$MODEL_DIR"/*; do
    echo "   - $(basename "$f")"
    "$ADB" -s "$PHONE_IP:$ADB_PORT" push "$f" "/data/local/tmp/$(basename "$f")" >/dev/null
    "$ADB" -s "$PHONE_IP:$ADB_PORT" shell "run-as $PKG cp /data/local/tmp/$(basename "$f") $MODEL_PATH/" 2>/dev/null \
      || "$ADB" -s "$PHONE_IP:$ADB_PORT" shell "cp /data/local/tmp/$(basename "$f") $MODEL_PATH/" 2>/dev/null \
      || echo "   !! 推送失败（可能是权限问题，可手动处理）"
  done
  echo "==> 模型已推送。App 首次启动会检测到模型并直接加载。"
fi

# 4) 重启 App
echo "==> 重启 App ..."
"$ADB" -s "$PHONE_IP:$ADB_PORT" shell "am force-stop $PKG"
"$ADB" -s "$PHONE_IP:$ADB_PORT" shell "am start -n $PKG/.MainActivity" || true

echo
echo "✅ 部署完成。"
echo "   查状态: curl http://$PHONE_IP:9999/health"
echo "   查模型: curl http://$PHONE_IP:9999/model/status"
