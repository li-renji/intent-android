# QD 模拟器 — 开发计划

> 奇点OS 官方模拟器，Windows 端运行，模拟 Linux 内核环境，跑完整奇点OS。
> 仅支持 Windows 10/11 x86_64，不支持安卓/macOS/Linux。

---

## 一、项目定位

### 1.1 是什么

QD 模拟器是一个 Windows 桌面应用，让用户在 Windows PC 上不用刷机就能体验和开发奇点OS。

它在 Windows 上模拟一个完整的计算机环境（CPU/内存/存储/网络/显示/输入），在里面运行 Linux 内核和奇点OS 用户空间。

### 1.2 不是什么

- ❌ 不是安卓模拟器（不跑安卓，跑奇点OS）
- ❌ 不是 WSL2（不是 Windows 子系统，是完整虚拟机）
- ❌ 不是 Docker（不是容器，是完整系统模拟）
- ❌ 不是 QEMU 的简单包装（虽然后端用 QEMU 引擎，但管理界面/配置/共享功能/调试接口全部自研）

### 1.3 技术选型

| 组件 | 选型 | 原因 |
|------|------|------|
| **虚拟化后端** | QEMU 7.x + TCG/HAXM/WHPX | 成熟稳定，支持 x86_64 和 aarch64，开源，跨架构 |
| **硬件加速** | Windows Hypervisor Platform (WHPX) 优先，Intel HAXM 备选 | Windows 原生虚拟化接口，性能好 |
| **CPU 模式** | x86_64 原生（WHPX加速）+ aarch64 模拟（TCG） | x86_64 性能接近原生，aarch64 用于兼容测试 |
| **管理器语言** | Python 3.11（第一阶段）→ C# WPF（第二阶段GUI） | Python 快速原型，C# 做原生 Windows GUI |
| **通信协议** | QEMU QMP（JSON-RPC over Unix socket/TCP） | QEMU 原生管理协议，功能完整 |
| **显示输出** | QEMU GTK/SDL 窗口 → 后期自研渲染窗口 | 第一阶段用 QEMU 自带窗口，第二阶段集成 |
| **共享剪贴板** | SPICE agent + QEMU guest agent | 成熟方案 |
| **共享文件夹** | virtio-fs / 9pfs | 性能好，支持 Linux  guest |
| **文件拖拽** | SPICE 拖拽协议 | 成熟方案 |
| **网络** | 用户模式网络（NAT）+ 可选桥接 | NAT 开箱即用，桥接性能好 |
| **存储** | qcow2 镜像格式（支持快照/压缩/增量） | QEMU 原生格式，功能丰富 |
| **BIOS/UEFI** | SeaBIOS（默认）+ EDK2（可选，UEFI启动） | SeaBIOS 简单快速，EDK2 兼容现代系统 |

---

## 二、分阶段开发计划

### 第一阶段：最小可运行（目标：能启动 Linux）

**目标**：在 Windows 上通过 QD 模拟器启动一个最小 Linux 系统，能看到登录提示符。

**任务清单**：

| # | 任务 | 说明 | 状态 |
|---|------|------|------|
| 1.1 | 项目结构搭建 | 目录、配置、文档 | ✅ |
| 1.2 | 下载 QEMU for Windows | 包含 qemu-system-x86_64.exe、BIOS 固件 | ⏳ |
| 1.3 | 准备 Linux 内核 | 下载预编译内核（第一阶段不用自己编译） | ⏳ |
| 1.4 | 构建最小 rootfs | 用 busybox 构建最小根文件系统 | ⏳ |
| 1.5 | 编写命令行管理器 | Python 脚本：创建VM、启动、停止、查看状态 | ⏳ |
| 1.6 | 第一阶段验证 | 成功启动 Linux，看到登录提示符，能执行简单命令 | ⏳ |

**交付物**：
- `qd.exe`（或 `python qd.py`）命令行工具
- 一个能启动的最小 Linux 虚拟机
- 使用说明文档

---

### 第二阶段：集成奇点OS（目标：跑奇点OS）

**目标**：在 QD 模拟器中运行完整的奇点OS 系统，能进入图形界面。

**任务清单**：

| # | 任务 | 说明 | 状态 |
|---|------|------|------|
| 2.1 | 构建奇点OS rootfs | 基于 Alpine Linux / 自建，包含奇点OS 核心模块 | ⏳ |
| 2.2 | 配置奇点OS 内核 | 启用 virtio、KVM 相关驱动 | ⏳ |
| 2.3 | 集成图形栈 | Wayland + 合成器，能显示图形界面 | ⏳ |
| 2.4 | 集成 AI.qd | MNN 推理引擎，本地 AI 可用 | ⏳ |
| 2.5 | 集成模块系统 | .qd/.qds/.qdai 模块加载器 | ⏳ |
| 2.6 | 第二阶段验证 | 启动奇点OS，进入图形桌面，AI 功能可用 | ⏳ |

**交付物**：
- 奇点OS 虚拟机镜像（.qcow2）
- 一键启动脚本
- 奇点OS 在模拟器中运行的截图/录屏

---

### 第三阶段：共享功能（目标：Windows ↔ 奇点OS 互通）

**目标**：实现 Windows 主机与奇点OS 虚拟机之间的剪贴板同步、文件共享、拖拽。

**任务清单**：

| # | 任务 | 说明 | 状态 |
|---|------|------|------|
| 3.1 | 剪贴板双向同步 | 复制的文本/图片在 Windows 和奇点OS 之间同步 | ⏳ |
| 3.2 | 共享文件夹 | Windows 目录挂载到奇点OS，可读写 | ⏳ |
| 3.3 | 文件拖拽 | 拖拽文件到模拟器窗口，自动复制到奇点OS | ⏳ |
| 3.4 | 共享剪贴板（富文本/图片） | 不只是纯文本，支持图片、HTML | ⏳ |
| 3.5 | 第三阶段验证 | 所有共享功能正常工作 | ⏳ |

**交付物**：
- 共享功能全部可用
- 使用说明

---

### 第四阶段：调试接口（目标：开发者友好）

**目标**：提供 ADB 兼容接口、SSH、串口控制台，方便开发者调试。

**任务清单**：

| # | 任务 | 说明 | 状态 |
|---|------|------|------|
| 4.1 | ADB 兼容接口 | `adb connect 127.0.0.1:5555` 能连接到模拟器 | ⏳ |
| 4.2 | SSH 服务 | 奇点OS 内运行 SSH 服务，可远程登录 | ⏳ |
| 4.3 | 串口控制台 | 通过串口查看内核日志、登录系统 | ⏳ |
| 4.4 | 文件传输工具 | `qd push` / `qd pull` 传输文件 | ⏳ |
| 4.5 | 截图/录屏 | `qd screenshot` / `qd record` | ⏳ |
| 4.6 | 第四阶段验证 | 所有调试接口正常工作 | ⏳ |

**交付物**：
- 完整的调试工具链
- 开发者文档

---

### 第五阶段：图形界面（目标：用户友好）

**目标**：用 C# WPF 做一个原生 Windows 图形界面管理工具。

**任务清单**：

| # | 任务 | 说明 | 状态 |
|---|------|------|------|
| 5.1 | 主界面设计 | 虚拟机列表、创建向导、设置面板 | ⏳ |
| 5.2 | 虚拟机显示窗口 | 集成 QEMU 显示，支持缩放/全屏 | ⏳ |
| 5.3 | 创建向导 | 图形化创建虚拟机（选择系统/配置CPU/内存/磁盘） | ⏳ |
| 5.4 | 设置面板 | 虚拟机设置（硬件/网络/共享/高级） | ⏳ |
| 5.5 | 快照管理 | 图形化快照管理（创建/恢复/删除/快照树） | ⏳ |
| 5.6 | 安装包制作 | MSI/EXE 安装包，一键安装 | ⏳ |
| 5.7 | 第五阶段验证 | GUI 全部功能正常，安装包可正常安装 | ⏳ |

**交付物**：
- QD 模拟器 Windows 安装包（.exe/.msi）
- 用户手册

---

### 第六阶段：高级功能（目标：完善体验）

| # | 任务 | 说明 |
|---|------|------|
| 6.1 | aarch64 模拟模式 | 支持模拟 ARM64 设备，测试 ARM 版奇点OS |
| 6.2 | 多虚拟机管理 | 同时运行多个虚拟机，标签页切换 |
| 6.3 | 虚拟机克隆 | 链接克隆/完整克隆 |
| 6.4 | 性能监控 | CPU/内存/磁盘/网络实时监控图表 |
| 6.5 | 自动更新 | 模拟器和系统镜像自动更新 |
| 6.6 | 插件系统 | 支持第三方插件扩展功能 |
| 6.7 | 命令行完整功能 | `qd create/start/stop/delete/snapshot/clone/...` |

---

## 三、项目结构

```
qd_emulator/
├── README.md                    # 项目说明
├── DEVELOPMENT_PLAN.md          # 本文档
├── USER_GUIDE.md                # 用户手册
├── DEVELOPER_GUIDE.md           # 开发者指南
│
├── src/
│   ├── manager/                  # 模拟器管理器（Python，第一阶段）
│   │   ├── __init__.py
│   │   ├── main.py              # 主程序入口（CLI）
│   │   ├── config.py            # 配置管理
│   │   ├── vm_instance.py       # 虚拟机实例管理
│   │   ├── qmp_client.py        # QEMU QMP 协议客户端
│   │   ├── clipboard_sync.py    # 剪贴板同步
│   │   ├── file_share.py        # 文件共享
│   │   ├── adb_bridge.py        # ADB 桥接
│   │   └── utils.py             # 工具函数
│   ├── gui/                      # 图形界面（C# WPF，第五阶段）
│   │   └── (待创建)
│   └── installer/                # 安装包制作（第五阶段）
│       └── (待创建)
│
├── kernel/                       # Linux 内核
│   ├── config_x86_64            # x86_64 内核配置
│   ├── config_aarch64           # aarch64 内核配置
│   ├── build_kernel.sh          # 内核构建脚本（Linux 环境）
│   └── README.md                # 内核说明
│
├── rootfs/                       # 根文件系统
│   ├── minimal/                  # 最小 rootfs（busybox，第一阶段）
│   │   ├── build_rootfs.sh      # 构建脚本
│   │   └── etc/                 # 配置文件
│   └── qidian_os/               # 奇点OS rootfs（第二阶段）
│       └── (待创建)
│
├── qemu/                         # QEMU for Windows 二进制文件
│   ├── qemu-system-x86_64.exe
│   ├── qemu-system-aarch64.exe
│   ├── qemu-img.exe
│   ├── qemu-ga.exe               # guest agent
│   └── README.md                # QEMU 说明
│
├── bios/                         # BIOS/UEFI 固件
│   ├── bios-256k.bin            # SeaBIOS
│   ├── edk2-x86_64.fd           # UEFI 固件（可选）
│   └── README.md
│
├── images/                       # 虚拟机镜像（运行时生成）
│   └── .gitkeep
│
├── templates/                    # 虚拟机配置模板
│   ├── minimal_linux.json       # 最小 Linux 模板
│   ├── qidian_os.json           # 奇点OS 模板
│   └── README.md
│
├── tools/                        # 工具脚本
│   ├── download_qemu.ps1        # 下载 QEMU
│   ├── download_kernel.ps1      # 下载预编译内核
│   ├── build_minimal_rootfs.sh  # 构建最小 rootfs（WSL/Linux）
│   └── README.md
│
└── docs/                         # 文档
    ├── architecture.md           # 架构设计
    ├── qemu_integration.md       # QEMU 集成说明
    ├── networking.md             # 网络配置
    └── troubleshooting.md        # 故障排查
```

---

## 四、第一阶段详细设计

### 4.1 虚拟机配置格式（JSON）

```json
{
  "name": "minimal-linux",
  "id": "vm-001",
  "os": "linux",
  "arch": "x86_64",
  "cpu": {
    "cores": 2,
    "sockets": 1,
    "threads_per_core": 1
  },
  "memory": {
    "size_mb": 512
  },
  "disk": {
    "path": "images/minimal-linux.qcow2",
    "size_gb": 2,
    "interface": "virtio"
  },
  "kernel": {
    "path": "kernel/bzImage-x86_64",
    "cmdline": "root=/dev/vda console=ttyS0 quiet"
  },
  "initrd": {
    "path": "rootfs/minimal/initramfs.cpio.gz"
  },
  "network": {
    "mode": "user",
    "port_forwards": [
      { "host": 2222, "guest": 22 },
      { "host": 5555, "guest": 5555 }
    ]
  },
  "display": {
    "type": "gtk",
    "graphics": "std"
  },
  "serial": {
    "type": "stdio",
    "port": "tcp:127.0.0.1:4444,server,nowait"
  },
  "shared_folders": [],
  "clipboard_sync": false,
  "autostart": false
}
```

### 4.2 命令行接口

```bash
# 创建虚拟机
qd create --name my-vm --template minimal_linux --cpus 2 --memory 512 --disk 2G

# 启动虚拟机
qd start my-vm
qd start my-vm --headless    # 无图形界面，仅串口

# 停止虚拟机
qd stop my-vm
qd stop my-vm --force        # 强制关机

# 查看状态
qd list                       # 列出所有虚拟机
qd status my-vm               # 查看虚拟机状态
qd info my-vm                 # 查看虚拟机详细信息

# 串口控制台
qd console my-vm              # 连接串口控制台

# 快照
qd snapshot create my-vm --name clean-state
qd snapshot list my-vm
qd snapshot restore my-vm --name clean-state
qd snapshot delete my-vm --name clean-state

# 文件传输
qd push my-vm local.txt /root/remote.txt
qd pull my-vm /root/remote.txt local.txt

# 截图
qd screenshot my-vm --output shot.png

# 删除虚拟机
qd delete my-vm
qd delete my-vm --keep-disk  # 删除配置但保留磁盘
```

### 4.3 QEMU 启动命令（第一阶段最小配置）

```bash
qemu-system-x86_64 \
  -name "minimal-linux" \
  -machine q35,accel=whpx \
  -cpu host \
  -smp 2 \
  -m 512M \
  -kernel kernel/bzImage-x86_64 \
  -initrd rootfs/minimal/initramfs.cpio.gz \
  -append "root=/dev/ram0 console=ttyS0 quiet" \
  -drive file=images/minimal-linux.qcow2,if=virtio,format=qcow2 \
  -netdev user,id=net0,hostfwd=tcp::2222-:22 \
  -device virtio-net-pci,netdev=net0 \
  -display gtk \
  -serial stdio \
  -qmp tcp:127.0.0.1:4444,server,nowait \
  -no-reboot
```

---

## 五、风险与应对

| 风险 | 影响 | 应对方案 |
|------|------|---------|
| WHPX 在某些 Windows 版本不可用 | 无法硬件加速，性能差 | 降级到 TCG 纯软件模拟，或提示用户启用 Hyper-V |
| QEMU for Windows 下载慢 | 第一阶段阻塞 | 提供国内镜像下载，或打包到安装包 |
| aarch64 模拟性能差 | ARM 版测试体验不好 | 明确标注为"兼容测试模式"，主力用 x86_64 原生模式 |
| 图形界面集成复杂 | 第五阶段延期 | 先用 QEMU 自带 GTK 窗口，GUI 管理工具单独做 |
| 奇点OS 内核编译复杂 | 第二阶段延期 | 第一阶段用预编译内核，第二阶段再自己编译 |
| Windows 安全软件拦截 | 用户无法启动 | 代码签名，添加白名单说明 |

---

## 六、里程碑

| 里程碑 | 目标 | 预计时间 |
|--------|------|---------|
| **M1** | 第一阶段完成：能启动最小 Linux | 1-2 天 |
| **M2** | 第二阶段完成：能跑奇点OS | 3-5 天 |
| **M3** | 第三阶段完成：共享功能可用 | 2-3 天 |
| **M4** | 第四阶段完成：调试接口齐全 | 2-3 天 |
| **M5** | 第五阶段完成：GUI + 安装包 | 5-7 天 |
| **M6** | 第六阶段完成：高级功能 | 持续迭代 |

---

> **当前阶段**：第一阶段 — 最小可运行
> **下一步**：下载 QEMU for Windows，准备内核和 rootfs，编写命令行管理器
