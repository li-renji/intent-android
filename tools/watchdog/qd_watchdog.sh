#!/system/bin/sh
# ============================================================
# 起点OS mini 看门狗 (qd_watchdog)
#
# 作用：App 进程消失时自动拉起，恢复 proot 容器 + microsrv HTTP 服务。
#       不依赖电脑、不依赖数据线 —— 装一次，之后手机自己恢复。
#
# 运行身份：adb shell (uid 2000)
#   这是关键 —— shell 有 am start / input keyevent 权限，
#   而 App 自己（uid 10502）没有，所以看门狗必须跑在 shell 下。
#
# 设计原则：不打扰用户
#   - 只在「屏幕亮 + 前台是桌面/锁屏刚解锁」时拉起
#   - 用户正在用微信/游戏时不动，等回到桌面再说
#   - 熄屏时不拉起（拉起也会被系统冻结，白费电）
# ============================================================

PKG=com.qidian.minios
ACT="$PKG/.SplashActivity"
LOG=/data/local/tmp/qd_watchdog.log
PIDF=/data/local/tmp/qd_watchdog.pid
POLL=8
LAUNCH_GRACE=25

log() { echo "$(date '+%m-%d %H:%M:%S') $*" >> "$LOG"; }

rotate_log() {
    if [ -f "$LOG" ]; then
        sz=$(stat -c%s "$LOG" 2>/dev/null || echo 0)
        [ "$sz" -gt 65536 ] && mv -f "$LOG" "$LOG.1"
    fi
}

# ---- 单实例 ----
if [ -f "$PIDF" ]; then
    OLD=$(cat "$PIDF" 2>/dev/null)
    if [ -n "$OLD" ] && kill -0 "$OLD" 2>/dev/null; then
        echo "qd_watchdog already running (pid=$OLD)"
        exit 0
    fi
fi
echo $$ > "$PIDF"
# 尽量降低被 LMK 回收的概率（shell 允许的范围内）
echo -900 > /proc/$$/oom_score_adj 2>/dev/null

log "=== watchdog start pid=$$ poll=${POLL}s ==="

is_running() { pidof "$PKG" >/dev/null 2>&1; }

foreground_pkg() {
    dumpsys activity activities 2>/dev/null \
        | grep -m1 'topResumedActivity' \
        | sed -n 's/.*u0 \([^ /]*\)\/.*/\1/p'
}

screen_on() {
    dumpsys power 2>/dev/null | grep -m1 mWakefulness | grep -q Awake
}

launch() {
    log "launch -> $ACT"
    am start -n "$ACT" >> "$LOG" 2>&1
}

LAST_STATE=""
while true; do
    rotate_log
    if ! is_running; then
        fg=$(foreground_pkg)
        if screen_on; then
            case "$fg" in
                ""|*launcher*|*Launcher*|com.qidian.minios)
                    log "app gone (fg=${fg:-none}) -> launch"
                    launch
                    sleep $LAUNCH_GRACE
                    ;;
                *)
                    [ "$LAST_STATE" != "busy:$fg" ] && log "app gone but user busy (fg=$fg), wait"
                    LAST_STATE="busy:$fg"
                    ;;
            esac
        else
            [ "$LAST_STATE" != "screenoff" ] && log "app gone while screen off, wait for unlock"
            LAST_STATE="screenoff"
        fi
    else
        if [ -n "$LAST_STATE" ] && [ "$LAST_STATE" != "ok" ]; then
            log "app back (state was $LAST_STATE)"
        fi
        LAST_STATE="ok"
    fi
    sleep $POLL
done
