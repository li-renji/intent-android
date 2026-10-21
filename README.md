# 起点OS mini APK

非 root 安卓用户态容器（最小实现）。参考 [Cateners/tiny_container（小小容器）](https://github.com/Cateners/tiny_container) 的架构，只保留最核心的部分：

- APK 启动 → 解压 rootfs 到 APP 私有目录；
- JNI 加载 proot 库（`System.loadLibrary("proot")`），用**修改版 proot** 模拟 chroot，创建隔离的 Linux 运行环境；
- 在 proot 隔离环境内启动一个简单 Linux 进程（`/bin/sh -c "uname -a; ls /; ..."`）并回显结果。

**刻意没有**：GUI、VNC、通信、AI、模块系统、qds/qdai 相关代码，没有任何网络权限。

---

## 目录结构

```
起点OS mini APK/
├── app/
│   ├── build.gradle
│   └── src/main/
│       ├── AndroidManifest.xml          # 无任何权限声明
│       ├── java/com/qidian/minios/
│       │   ├── MainActivity.kt          # APK 启动逻辑（解压 → 加载 → 运行 → 读结果）
│       │   ├── NativeProot.kt           # libproot.so 的 JNI 声明
│       │   └── TarExtractor.kt          # 极简 tar.gz 解压器（无第三方库）
│       ├── cpp/proot_jni.c              # 安卓 NDK proot 调用核心代码（JNI 包装）
│       ├── jniLibs/arm64-v8a/           # 由脚本生成：libproot.so
│       └── assets/
│           ├── rootfs.tar.gz            # Alpine 3.24.1 aarch64 minirootfs（已内置）
│           └── libproot_loader.so       # 由脚本生成：proot 的 64 位 loader
├── patch/proot-main-as-library.patch    # 把 proot 的 main 改名为 proot_main
├── scripts/
│   ├── build_proot_android.sh           # NDK 交叉编译 libproot.so + loader
│   └── fetch_rootfs.sh                  # 重新下载 rootfs
└── README.md
```

---

## 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│   APK（com.qidian.minios，无 root、无权限）                   │
│                                                             │
│  MainActivity（后台线程）                                     │
│    1. assets/rootfs.tar.gz ──解压──▶ filesDir/rootfs         │
│    2. assets/libproot_loader.so ──拷贝──▶ filesDir/loader    │
│    3. System.loadLibrary("proot")                           │
│    4. NativeProot.runProot(argv, ...)                       │
│         └─ fork()                                           │
│            ├─ 子进程：setenv(TMPDIR/PROOT_LOADER)            │
│            │     └─ proot_main() ── ptrace 拦截 syscall ──▶  │
│            │         └─ 容器内进程 /bin/sh -c "uname -a..."  │
│            │            （路径翻译：/ → filesDir/rootfs）     │
│            └─ 父进程：waitpid() ◀── 退出码                    │
│    5. 读取 rootfs/container_result.txt → Logcat              │
└─────────────────────────────────────────────────────────────┘
```

proot 是用户态 chroot 实现：它通过 `ptrace` 追踪容器进程，在每次 syscall 进入/退出时把路径从“容器内视角”翻译成“宿主机真实路径”，从而做到**无需 root** 的隔离。`-0` 选项伪造 root 身份，`--link2symlink` 把硬链接退化为符号链接以兼容 Android 文件系统。

---

## 构建步骤

### 0. 准备

- Linux 或 WSL（本仓库所有原生代码都通过脚本交叉编译）
- Android NDK r26+（设置 `ANDROID_NDK_HOME`）
- `make` / `curl` / `tar` / `unzip` / `patch` / `python3`

### 1. 构建 proot 原生库（生成 libproot.so 与 loader）

```bash
ANDROID_NDK_HOME=/path/to/android-ndk-r26 ./scripts/build_proot_android.sh
```

脚本做的事（与 tiny_container / Termux 同一套做法）：

1. 用 waf + cross-answers 交叉编译 **talloc 2.4.3**（proot 的内存分配依赖，Termux 同款配置）；
2. 下载 **proot-termux** fork（固定 commit `e58b34ff...`，即 tiny_container 使用的版本）；
3. 打补丁把 `main` 改名为 `proot_main`（便于链接进共享库）；
4. `make` 编译全部 proot 目标文件（`-fPIC`），并把 loader 的默认目录（`/data/user/0/com.qidian.minios/files`）编入；
5. 与 `app/src/main/cpp/proot_jni.c` 一起链接成 `libproot.so`，输出：

```
app/src/main/jniLibs/arm64-v8a/libproot.so
app/src/main/assets/libproot_loader.so
```

### 2. rootfs（已内置，可跳过）

`app/src/main/assets/rootfs.tar.gz` 已包含 Alpine 3.24.1 aarch64 minirootfs（约 3.8MB）。
如需重新下载：

```bash
./scripts/fetch_rootfs.sh
```

### 3. 构建 APK

用 Android Studio 打开本目录直接 Run；或命令行：

```bash
./gradlew assembleDebug
```

产物：`app/build/outputs/apk/debug/app-debug.apk`

---

## 运行与验证

1. 安装 APK 到 arm64 安卓设备（Android 7.0+），打开“起点OS mini”；
2. 首次启动会先解压 rootfs（几秒），随后自动运行容器；
3. 查看结果：

```bash
adb logcat -s QidianMiniOS
```

应能看到类似输出：

```
QidianMiniOS: 启动 proot: proot -r /data/user/0/com.qidian.minios/files/rootfs -0 ...
QidianMiniOS: proot 已退出，exit=0
QidianMiniOS: ===== 容器内 Linux 进程输出 =====
QidianMiniOS: Linux localhost 5.15.xx-android13-... #1 SMP ... aarch64 GNU/Linux
QidianMiniOS: --- / ---
QidianMiniOS: bin  etc  home  lib  media  mnt  opt  proc  root  run  sbin  ...
QidianMiniOS: hello from qidian-mini-os container
```

`uname` 输出来自**容器内**的 busybox 进程，`/` 目录列表是 rootfs 的内容——说明隔离环境真实可用。

---

## 常见问题

- **只支持 arm64**：proot 按 aarch64 构建，`abiFilters 'arm64-v8a'`。
- **首次启动稍慢**：要解压约 3.8MB rootfs 到私有目录；之后启动会跳过解压。
- **容器是一次性的**：每次打开 APK 运行一个简单命令后 proot 退出；如需常驻服务可自行把启动逻辑从 Activity 迁移到前台服务（本项目刻意不实现）。
- **proot 为什么在子进程里跑**：proot 的 main 会调用 `exit()`，必须 fork 隔离，否则整个 APP 会退出（详见 `proot_jni.c` 注释）。
- **无 root 如何实现隔离**：proot 用 ptrace 做 syscall 路径翻译，本身就是为非 root 场景设计的。

---

## 参考与许可

- 架构参考：[Cateners/tiny_container](https://github.com/Cateners/tiny_container)
- proot 源码（修改版，本工程对其打补丁）：[tiny-computer/proot-termux](https://github.com/tiny-computer/proot-termux)（GPL-2.0）
- 构建方式参考：[termux-packages](https://github.com/termux/termux-packages) 的 proot / libtalloc 包
- rootfs：[Alpine Linux minirootfs](https://alpinelinux.org/)（基于 musl 的静态 busybox）
- talloc：[Samba talloc](https://talloc.samba.org/)（LGPL-3.0）
