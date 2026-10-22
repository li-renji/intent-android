#!/bin/sh
# 起点OS mini — PC 端调用手机内 AI（sh 版，文件桥接，不经过 HTTP）
# 用法: ./ask_phone_ai.sh "你好"
#
# 与 ask.ps1 等价，适合在 Git Bash / WSL / Linux 下用。

PKG=com.qidian.minios
BASE=/data/user/0/$PKG/files/rootfs/tmp
REQUEST_FILE=$BASE/api_request
RESPONSE_FILE=$BASE/api_response
TIMEOUT=60

PROMPT="$1"
if [ -z "$PROMPT" ]; then
  echo "用法: $0 \"你的问题\""
  exit 1
fi

# ---- 定位 adb ----
ADB=""
if command -v adb >/dev/null 2>&1; then
  ADB=$(command -v adb)
else
  for c in \
    "$ANDROID_HOME/platform-tools/adb.exe" \
    "$HOME/Downloads/qidianmini/platform-tools/adb.exe" \
    "$HOME/Downloads/platform-tools/adb.exe" \
    "$(dirname "$0")/platform-tools/adb.exe"
  do
    if [ -n "$c" ] && [ -f "$c" ]; then ADB="$c"; break; fi
  done
fi
if [ -z "$ADB" ]; then
  echo "未找到 adb，请把 platform-tools 加入 PATH 或设置 ANDROID_HOME" >&2
  exit 1
fi

# ---- 设备检查 ----
if ! "$ADB" devices | grep -q "device$"; then
  echo "没有检测到已连接的设备，检查数据线 / USB 调试授权" >&2
  exit 1
fi

# 清掉上次残留
"$ADB" shell "run-as $PKG rm -f $RESPONSE_FILE"

# prompt 走 base64 传，避免引号被吞
B64=$(printf '%s' "$PROMPT" | base64 | tr -d '\n')
echo "发送: $PROMPT"
"$ADB" shell "run-as $PKG sh -c 'echo $B64 | base64 -d > $REQUEST_FILE'" >/dev/null

echo "等待 AI 回复..."
RESULT="no"
i=0
while [ $i -lt $((TIMEOUT * 2)) ]; do
  RESULT=$("$ADB" shell "run-as $PKG test -f $RESPONSE_FILE && echo yes || echo no" | tr -d '\r')
  [ "$RESULT" = "yes" ] && break
  sleep 0.5
  i=$((i + 1))
done

if [ "$RESULT" = "yes" ]; then
  echo "--- AI 回复 ---"
  "$ADB" shell "run-as $PKG cat $RESPONSE_FILE"
  "$ADB" shell "run-as $PKG rm -f $RESPONSE_FILE"
else
  echo "超时了，AI 没回复"
  echo "排查: App 是否在前台 / 等 AI 加载完 / cat $BASE/bridge_debug.log"
  exit 2
fi
