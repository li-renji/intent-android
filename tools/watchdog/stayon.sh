#!/system/bin/sh
# 屏幕常亮开关 —— 让 App 保持前台，避免被 Android freezer 冻结
# 用法: sh stayon.sh on   开启常亮（不自动熄屏）
#       sh stayon.sh off  恢复自动熄屏
#
# 背景：熄屏后 App 进入 cached 状态会被 cgroup 冻结，
#       proot 容器连创建都卡住，HTTP/AI 服务一起停摆。
#       常亮是「不重打包」前提下唯一能让服务持续在线的办法。

MARK=/data/local/tmp/qd_screen_orig.txt

case "$1" in
  on)
    if [ ! -f "$MARK" ]; then
        cur=$(settings get system screen_off_timeout)
        echo "${cur:-30000}" > "$MARK"
    fi
    settings put system screen_off_timeout 2147483647
    svc power stayon true
    echo "常亮已开启（原超时: $(cat "$MARK")）"
    ;;
  off)
    if [ -f "$MARK" ]; then
        orig=$(cat "$MARK")
        settings put system screen_off_timeout "$orig"
        rm -f "$MARK"
        echo "已恢复自动熄屏（${orig}ms）"
    else
        settings put system screen_off_timeout 30000
        echo "已恢复自动熄屏（默认 30000ms）"
    fi
    svc power stayon false
    ;;
  *)
    echo "用法: sh $0 on|off"
    echo "当前超时: $(settings get system screen_off_timeout)"
    ;;
esac
