# qidian编辑器 — 微量 HTTP + AI 桥接（融合版 v2，已验证）

目标：给qidian编辑器 装一个**极轻的 HTTP 服务**，让 PC / 局域网设备能调用手机里的本地 AI。

v2 把原来的两代实现**融合成一个 C 程序**（`framework/modules/microsrv.c`）：
同一个进程同时提供 8822 裸状态行（v1 行为）和 9999 完整 HTTP API，AI 推理仍由 `app.js` 桥接。
**2026-10-22 已在真机上端到端跑通。**

## 实测结果

```
POST /chat  "你好，请用一句话介绍你自己"
→ {"response":"我是阿里云的Qwen，一个智能助手，可以帮助你回答问题，提供信息，进行对话等。有什么我可以帮到你的吗？\n"}

GET /health
→ {"status":"ok","service":"qidian-os-mini","model":"qwen2.5-1.5b","version":"2.0",
   "pid":8358,"uptime":119,"mem_kb":188,"heartbeat":2,"chat_ok":1,"chat_fail":0,
   "api_dir":"/tmp","bridge":{"request_pending":false,"response_ready":false}}

# PC 直连手机局域网 IP（无需 adb forward）
curl http://192.168.3.4:9999/health   ✓
```

- 进程常驻内存 **≈188 KB**
- `GET /chat` 返回 405 + 提示（修掉上次用 GET 测试踩的坑）
- AI 挂起期间 `/health` 仍可响应（poll 状态机，v1 的串行阻塞问题已消除）

## 架构

```
PC / 局域网设备
      │  HTTP POST /chat  body = prompt（纯文本或 {"prompt":"..."}）
      ▼
microsrv.qds v2（一个进程，两个端口）
 ├─ 0.0.0.0:9999   HTTP/1.1：GET /health、GET /、POST /chat
 └─ 127.0.0.1:8822 裸 TCP 一行状态（v1 兼容）
      │  /chat → 写 /tmp/api_request，挂起该连接，继续服务其他请求
      ▼
app.js 桥接（WebView 内，1s 轮询 /tmp/api_request）
      │  Qidian.callAI(prompt) → llama.cpp / qwen2.5-1.5b 本地推理
      ▼
     写 /tmp/api_response → microsrv 读到后原样转发给客户端
```

容器与 App 共享 `<APP私有目录>/files/rootfs/`，`/tmp` 即 `rootfs/tmp` —— 唯一通信面。

## 文件清单

| 路径 | 说明 |
|---|---|
| `../framework/modules/microsrv.c` | **融合版源码（v2）**，单文件 ~530 行 |
| `microsrv.qds` | 编译好的 aarch64 静态二进制（zig cc + musl，1.2MB） |
| `patches/microsrv-v2.patch` | v1 → v2 的源码补丁 |
| `patches/app.js-http-api.patch` | app.js 的改动（桥接模块 + 移除旧 shell 服务启动） |
| `legacy/microsrv.v1.qds` | v1 原始二进制备份（只报状态），回滚用 |
| `http_server.sh` / `http_api.sh` | 上一代 shell 实现（被 v2 取代，留作参考） |
| `legacy/` | 更早的实验版本 |
| `tests/` | 手工测试脚本 |
| `device_snapshot/` | 10-17 调试现场的原始日志 |
| `ask.ps1` / `ask_phone_ai.sh` | PC 客户端（文件桥接，不走 HTTP） |
| `toybox-arm64` | 上一代依赖，v2 已不需要 |

## 编译

本机没有 NDK，用 zig 交叉编译（静态链接 musl，产物可直接在 proot Alpine 里跑）：

```bash
zig cc -target aarch64-linux-musl -O2 -static \
    framework/modules/microsrv.c -o tools/http_api/microsrv.qds
```

Windows 下若报缓存目录错误，先设 `ZIG_GLOBAL_CACHE_DIR` / `ZIG_LOCAL_CACHE_DIR` 到可写目录。

## 部署

```bash
ADB=platform-tools/adb.exe
PKG=com.qidian.minios
BASE=/data/user/0/$PKG/files/rootfs/tmp

# 1. 替换容器内的微服务二进制
$ADB push tools/http_api/microsrv.qds /data/local/tmp/
$ADB shell "run-as $PKG cp /data/local/tmp/microsrv.qds 'files/rootfs/系统/微服务.qd/microsrv.qds'"
$ADB shell "run-as $PKG chmod 755 'files/rootfs/系统/微服务.qd/microsrv.qds'"

# 2. 替换界面 JS（UI 不是从 APK 读的，是 files/ui/，所以不用重打包）
$ADB push app/src/main/assets/ui/app.js /data/local/tmp/
$ADB shell "run-as $PKG cp /data/local/tmp/app.js files/ui/app.js"

# 3. 重启 App（屏幕必须亮着，否则 WebView 不执行 JS）
$ADB shell "svc power stayon true"
$ADB shell "am force-stop $PKG"
$ADB shell "input keyevent KEYCODE_WAKEUP"
$ADB shell "monkey -p $PKG -c android.intent.category.LAUNCHER 1"
```

启动顺序：SplashActivity（约 15s 开机动画）→ MainActivity 解压/挂载 rootfs → 拉起 microsrv.qds → WebView 加载 files/ui/app.js → 桥接就绪。

## 验证

```bash
# 方式一：adb 端口转发
$ADB forward tcp:9999 tcp:9999
curl http://127.0.0.1:9999/health

# 方式二：局域网直连（手机与 PC 同网段）
curl http://<手机IP>:9999/health

# 聊天（注意：必须 POST）
curl -X POST http://127.0.0.1:9999/chat -d "你好"

# 8822 裸状态行（telnet / nc 即可）
nc 127.0.0.1 8822
```

`/health` 里的 `bridge.request_pending` / `response_ready` 可直接判断桥接是否活着；
排查日志在容器 `/tmp/bridge_debug.log`、`/tmp/microsrv.log`。

## 上次的坑（已解决，留档）

1. **`nc: Unknown option 'e'`** — toybox nc 不支持 `-e` 跑 CGI → v2 用 C 自己解析 HTTP。
2. **`/chat` 用 GET 测试** → 走 404 分支，误以为服务坏了 → v2 对 GET /chat 返回 405 + 明确提示。
3. **改了 `assets/ui/app.js` 但手机没反应** → APK 里的 assets 改不到；实际 UI 运行目录是 `files/ui/`（首次启动从 assets 复制，版本号一致就跳过），直接替换 `files/ui/app.js` 即可，**无需重打包**。
4. **App 卡在 SplashActivity 不进主界面** → 手机屏幕熄着，VideoView 不播放、15s 超时也不触发跳转 → 先 `KEYCODE_WAKEUP`，调试期间 `svc power stayon true`。
5. **桥接探针文件不存在 ≠ JS 没跑** → 桥接启动时容器可能还没就绪，`execContainer` 静默失败；以轮询循环是否工作为准。

## 已知限制

- **单 AI 请求**：同一时刻只处理一个 `/chat`，第二个并发请求返回 429。
- **无 keep-alive / 无 TLS / 无鉴权**：9999 监听 `0.0.0.0`，同网段任何人都能调。不安全网络请改回 `127.0.0.1`（`--port` 绑定逻辑在 `make_listener`）+ `adb forward`。
- **响应体透传**：`/chat` 的返回体就是 app.js 写的 `{"response":"..."}`，格式由桥接保证。
- **`ai_response` 竞态**：桥接写文件与 microsrv 读文件之间无锁，靠"写完才存在"的文件语义，实测稳定但并发语义弱。

## 回滚

```bash
$ADB push tools/http_api/legacy/microsrv.v1.qds /data/local/tmp/
$ADB shell "run-as $PKG cp /data/local/tmp/microsrv.v1.qds 'files/rootfs/系统/微服务.qd/microsrv.qds'"
# app.js 回滚：git checkout app/src/main/assets/ui/app.js 后重新 push
```

## 已知问题与修复：拔数据线后「[容器未启动]」（2026-10-22）

**现象**：拔掉 USB 线后使用本地 AI，聊天里直接回复 `[容器未启动]`。

**根因链**（vivo V2303A / OriginOS / Android 16）：

1. 拔线后 `stay_on_while_plugged_in=15`（仅充电时常亮）失效，屏幕熄灭，App 退后台；
2. OriginOS 激进清理后台 → App 进程被杀（连 appops `POST_NOTIFICATION` 都是 ignore）；
3. 重新打开 App 时 `MainActivity.startContainerInBackground()` 重跑：shm 初始化 →
   MNN 模型加载（≈1.6s）→ 之后才给 `rootfsDir` 赋值；
4. 这个窗口期内 `Qidian.execContainer()` 返回字符串 `[容器未启动]`
   （`MainActivity.execInContainer`：`rootfsDir ?: return "[容器未启动]"`）；
5. **旧 app.js 把这个字符串直接当成 AI 回答显示** —— 看起来像"坏了"，其实是初始化窗口。

**修复（app.js，已部署真机验证）**：

- 新增 `qdExecWithRetry()`：拿到 `[容器未启动]` 时自动重试（1s→4s 递增退避），
  默认最多等 90 秒，期间在气泡上显示「⏳ 容器启动中… Ns」；
- 90 秒仍失败则显示可操作的建议文案，而不是原始错误串；
- 真机回归：重启 App 后发 `hello` → 正常回复 `[AI(原生 MNN)] hello! How can I assist you today?`；
  Node 单测：连续 3 次 `[容器未启动]` 后恢复 → PASS。

**系统层保活（adb 已做，重置手机后需重做）**：

```bash
adb shell dumpsys deviceidle whitelist +com.qidian.minios   # Doze 白名单
adb shell cmd appops set com.qidian.minios RUN_IN_BACKGROUND allow
```

**仍需用户手动（vivo 特有，adb 无法代劳）**：

- i管家 → 应用管理 → 「qidian编辑器」→ 允许后台运行/自启动；
- 设置 → 电池 → 后台耗电管理 → 允许后台高耗电。

**彻底方案（未做）**：给 App 加前台服务（Foreground Service）。需要改 Kotlin + 重打包 APK，
本机无 JDK/Android SDK，且重打包需原签名，否则覆盖安装失败、卸载会丢 rootfs 和模型。

**注意**：`files/ui/ui_version.txt`（当前 `20260915_01`）必须与已装 APK 内 assets 版本一致，
否则启动时旧 assets 会覆盖 `files/ui/app.js`。将来重打包新 APK 时需同时 bump 版本号。
