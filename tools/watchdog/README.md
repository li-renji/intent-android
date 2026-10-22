# 看门狗（已废弃 —— 实测在非 root 的 Android 16 上不可行）

## 目标

App 被杀后自动拉起，不需要电脑和数据线。

## 为什么不可行

看门狗必须运行在 **shell（uid 2000）** 下才能执行 `am start`，
因为 App 自己的 uid 没有启动 Activity 的权限。

但 Android 16 的 `adbd` 在 **非交互式 `adb shell` 会话结束时，会按 cgroup 清理所有后代进程**：

```
$ adb shell "setsid sleep 300 >/dev/null 2>&1 &"
$ adb shell "ps -A | grep 'sleep 300'"
(空)
```

已经试过并全部失败：

| 方式 | 结果 |
|---|---|
| `nohup cmd &` | 进程消失 |
| `setsid nohup cmd &` | 进程消失 |
| `( setsid sh -c 'cmd' </dev/null >/dev/null 2>&1 & )` | 进程消失 |

连 `sleep 300` 都活不过 1 秒，说明不是脚本问题，是 adbd 的会话清理机制。
非 root 环境无法创建持久守护进程。

## 另一条也走不通的路

即便能拉起，**App 起来后在后台仍会被 cached app freezer 冻结**：

```
熄屏时:  diag.txt 停在 "rootfs ready"，proot 进程根本不存在
回到前台: proot + microsrv 立刻出现
```

App 的 cgroup 在熄屏/后台时进入 frozen 状态，`fork/exec` 直接被阻塞，
容器初始化的第一步就卡死。所以"拉起"本身解决不了问题。

## 保留本目录的原因

- `qd_watchdog.sh` / `stayon.sh` 逻辑本身是对的，若将来设备 root 了，
  把脚本放进 `/system/etc/init.d` 或做成 init 服务即可复用。
- `stayon.sh` 的「屏幕常亮」开关在**不重打包**的场景下仍然有用：
  常亮 → App 一直在前台 → 不会被冻结。

## 最终采用的方案

给 App 加 **dataSync/specialUse 类型的前台服务 + PARTIAL_WAKE_LOCK + 开机自启**
（见 `app/src/main/java/com/qidian/minios/KeepAliveService.kt`）。
前台服务的进程不进 cached 分组，熄屏也不冻结；`START_STICKY` 让系统在内存压力下自动重建。
