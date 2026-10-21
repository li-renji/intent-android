# 奇点OS 系统规范文档 v1.2

> 文档版本：v1.2  
> 编写日期：2026-09-16  
> 文档性质：系统级记忆，由 AI.qd 输出并维护  
> 适用范围：奇点OS 全系列（mini 版 / 完整版 / 刷机版）

---

## v1.2 更新说明

本次更新针对 v1.1 审计发现的所有套壳组件、设计漏洞、规范矛盾和实施风险，给出明确的解决办法：

1. **套壳组件处理原则**：封装成 .qd 模块、由奇点OS统一管理、对外统一API，就不算套壳
2. **AI.qd 定位明确**：AI做策略决策（秒级），代码做实时执行（微秒级）；AI故障时执行层用默认策略继续运行
3. **直接传输模块三层安全**：授权（建立时）+ 实时监控（流量异常检测）+ 抽查（空闲时深度审计）
4. **"不带Linux"明确定义**：不带Linux用户空间，但用Linux内核和开放标准协议（Wayland是开放标准，不是Linux专属）
5. **用户限制AI.qd强制执行**：安全策略由执行层强制执行，不是AI.qd自愿遵守；AI.qd修改策略需用户确认
6. **隔离层分级隔离**：关键修改完整隔离，普通修改轻量隔离，临时文件不隔离
7. **.qdai 简化为三种格式**：自然语言 + 结构化规则（JSON，确定性执行，优先）+ Lua脚本（去掉Python和JS）
8. **推理引擎统一API层**：上层不关心底层是MNN还是llama.cpp，自动格式转换
9. **WDS/ANZ 明确分阶段**：先跑简单开源应用，复杂应用是长期目标；增加box64和microG；建立兼容性数据库
10. **统一记忆系统**：SQLite + 加密 + 用户完整管理
11. **自修复可靠性**：守护进程监控AI.qd + 安全模式 + 快照回滚 + 确定性诊断优先
12. **模块沙箱**：用成熟的Linux namespace + seccomp技术
13. **分级编译策略**：核心服务静态编译，非核心服务动态链接
14. **Git存储优化**：浅克隆 + 只保留最近3个版本 + 配额管理
15. **兼容层独立沙箱**：兼容层崩溃不影响系统核心
16. **刷机和自研核心理性预期**：先适配一款手机，利用Treble/GSI扩展；自研内核是5年以上长期目标

---

## 目录

1. [系统定位与设计哲学](#1-系统定位与设计哲学)
2. [整体架构](#2-整体架构)
3. [模块分类体系](#3-模块分类体系)
4. [文件后缀规范（.qd / .qds / .qdai）](#4-文件后缀规范qd--qds--qdai)
5. [AI.qd 最高权限体系](#5-aiqd-最高权限体系)
6. [AI.qd 直接传输模块](#6-aiqd-直接传输模块)
7. [隔离层](#7-隔离层)
8. [硬件抽象层（HAL）](#8-硬件抽象层hal)
9. [系统服务层](#9-系统服务层)
10. [图形栈](#10-图形栈)
11. [应用运行时与兼容层（ANZ / WDS）](#11-应用运行时与兼容层anz--wds)
12. [模块化系统](#12-模块化系统)
13. [通信协议（QD-IPC）](#13-通信协议qd-ipc)
14. [存储与文件系统](#14-存储与文件系统)
15. [性能调度](#15-性能调度)
16. [安全与权限](#16-安全与权限)
17. [自修复与防崩溃](#17-自修复与防崩溃)
18. [推理引擎双架构](#18-推理引擎双架构)
19. [开发者模块与远程开发](#19-开发者模块与远程开发)
20. [第三方 AI 接入管理](#20-第三方-ai-接入管理)
21. [套壳组件处理原则](#21-套壳组件处理原则)
22. [实现原理](#22-实现原理)
23. [开发计划与路线图](#23-开发计划与路线图)
24. [代码原则](#24-代码原则)

---

## 1. 系统定位与设计哲学

### 1.1 系统定位

奇点OS 是一个**以 AI 为核心的下一代操作系统**。

- **底层**：基于 Linux 内核深度定制（当前方案），未来迁移至自研内核
- **用户空间**：完全自研，不依赖任何现有 Linux 发行版
- **核心特征**：AI.qd 拥有最高权限和最高决策权，整个系统是给 AI 超级框架的超级权限
- **兼容目标**：原生运行 Windows（WDS）和安卓（ANZ）软件，Linux 兼容由用户自行开发模块实现
- **终极目标**：任何 AI 大模型只要被接入奇点OS，就会直接起飞

### 1.2 "不带 Linux"的明确定义（v1.2 新增）

> **不带 Linux 用户空间**，但**用 Linux 内核**和**用开放标准协议**。

| 类别 | 说明 |
|------|------|
| **不带的** | GNU 工具链、systemd、glibc、X11 桌面环境、GNOME/KDE、dpkg/rpm 包管理器、任何 Linux 发行版的用户空间组件 |
| **用的** | Linux 内核（提供硬件抽象、进程、内存、文件系统基础）、musl libc（轻量C库）、开放标准协议（Wayland、HTTP、OpenGL ES 等） |

**Wayland 不是 Linux 专属**：Wayland 是开放标准协议（FreeBSD 也用 Wayland），就像用 HTTP 不算套壳网站，用 Wayland 不算套壳 Linux。

### 1.3 mini 版与刷机版的关系

**两者没有本质区别，是同一个系统，只是运行环境和界面不同。**

| 对比项 | 奇点OS（刷机版） | 奇点OS mini |
|--------|-----------------|-------------|
| 系统核心 | 完全相同 | 完全相同 |
| 运行方式 | 直接刷机，运行在真实硬件上 | 跑在 proot 容器里，寄生在安卓上 |
| 界面 | 自研图形桌面（原生渲染） | Web 界面（WebView + HTML/CSS/JS） |
| 内核 | Linux 内核（未来自研） | 安卓的 Linux 内核 |
| 硬件访问 | 直接访问硬件（通过 HAL + 驱动） | 通过安卓间接访问硬件 |
| 性能 | 原生性能，无额外开销 | 有容器层开销 |

### 1.4 设计哲学

1. **AI 优先**：所有系统设计围绕 AI.qd 展开，AI 拥有最高权限
2. **AI 做决策，代码做执行**：AI.qd 是策略层（大脑），系统服务是执行层（小脑）
3. **模块化**：一切皆模块，系统功能由 .qd 模块组合而成
4. **可自愈**：系统崩坏时 AI.qd 可通过防崩溃程序自动修复
5. **可定制**：用户可通过 .qdai 规则文件定制系统行为
6. **可远程开发**：任意奇点OS 设备可对另一台奇点OS 设备进行模块开发
7. **稳定优先**：系统核心优先稳定，其次兼容；兼容层优先兼容，后稳定
8. **多层防御**：安全是多层防御，不是 100% 保证；明确风险和权衡

### 1.5 与 Linux 的关系

- **内核层**：使用 Linux 内核（当前），未来替换为自研内核
- **用户空间**：**完全不带 Linux**，不使用 glibc、systemd、GNU 工具链等
- **libc**：使用 musl libc（轻量、适合嵌入式、静态链接友好）
- **Linux 兼容**：系统不内置 Linux 兼容层，用户可自行开发模块实现

---

## 2. 整体架构

### 2.1 分层架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        应用层 (Applications)                   │
│   WDS(Windows) │ ANZ(安卓) │ Linux应用 │ 奇点OS 原生应用      │
├─────────────────────────────────────────────────────────────┤
│                     应用运行时 (App Runtime)                   │
│   WDS兼容层(沙箱) │ ANZ兼容层(沙箱) │ 原生 SDK │ 用户兼容模块   │
├─────────────────────────────────────────────────────────────┤
│                      图形栈 (Graphics Stack)                   │
│   窗口管理(自研) │ 合成器(wlroots封装) │ Wayland协议 │ 输入管理 │
├─────────────────────────────────────────────────────────────┤
│              系统服务执行层（确定性代码，实时，毫秒/微秒级）    │
│   进程调度 │ 内存管理 │ 文件系统 │ 服务管理 │ 权限检查 │ 网络   │
│   安全策略强制执行 │ 实时流量监控 │ 异常即时处理               │
├─────────────────────────────────────────────────────────────┤
│              AI.qd 策略层（大脑，最高权限，非实时，秒级）      │
│   调度策略 │ 权限决策 │ 自修复决策 │ 规则生成 │ 统一记忆 │ AI推理 │
│   策略下发 │ 降级模式支持 │ 守护进程监控                        │
├─────────────────────────────────────────────────────────────┤
│              AI.qd 直接传输模块（数据直连，微秒级，三层安全）   │
│              应用间数据直连通道，不经 AI.qd 实时转发             │
├─────────────────────────────────────────────────────────────┤
│              隔离层（.qds 实现，异常中断保护，分级隔离）         │
│              不完整修改隔离，防止系统错误                        │
├─────────────────────────────────────────────────────────────┤
│              模块化系统（自研）                                  │
│   .qd 加载器 │ .qds 解析器 │ .qdai 三格式引擎 │ QD-IPC 双通道  │
├─────────────────────────────────────────────────────────────┤
│              HAL 硬件抽象层（C，自研）                          │
├─────────────────────────────────────────────────────────────┤
│              Linux 内核（当前）→ 自研内核（未来，5年+长期目标）  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 顶层目录结构

```
/
├─ 系统/                          # 系统模块目录（AI.qd 安装的模块在此）
│  ├─ 兼容.qd/                    # 兼容层模块
│  │  ├─ ANZ.qd/                  # 安卓兼容子模块
│  │  ├─ WDS.qd/                  # Windows兼容子模块
│  │  ├─ 安装管理.qds              # 系统单文件
│  │  ├─ 闪退保护.qds              # 防崩溃程序
│  │  └─ compat_ai.qdai           # AI标记文件
│  │
│  ├─ 功能.qd/                    # 系统核心功能模块
│  │  ├─ 进程调度.qds              # 进程管理
│  │  ├─ shm_ipc.qds              # 共享内存IPC
│  │  ├─ 直接传输.qd/              # AI.qd直接传输模块
│  │  ├─ 隔离层.qd/                # 异常中断隔离层
│  │  ├─ 知识库.qd/                # 知识库子模块（用户可扩展）
│  │  ├─ 开发者.qd/                # 【v1.2新增】内置开发环境（编译器/调试器/QD模拟器/SDK）
│  │  │  ├─ toolchain.qds          # 编译工具链（GCC/Clang/Rust/Go）
│  │  │  ├─ debugger.qds           # 调试器（GDB/LLDB封装）
│  │  │  ├─ qd_emulator.qds        # QD模拟器（Windows端模拟Linux内核跑起点OS）
│  │  │  ├─ sdk.qds                # 奇点OS SDK（头文件/库/构建工具）
│  │  │  ├─ templates/             # 模块模板
│  │  │  └─ dev_ai.qdai            # 开发者AI规则
│  │  └─ func_ai.qdai              # AI标记文件
│  │
│  ├─ 界面.qd/                    # 图形界面模块
│  │  ├─ 窗口管理.qds              # 窗口管理器
│  │  ├─ 渲染管线.qds              # 渲染管线
│  │  ├─ 合成器.qd/                # 合成器（wlroots封装）
│  │  ├─ 投屏.qd/                  # 【v1.2新增】投屏输出/接收（Miracast/DLNA/HDMI）
│  │  │  ├─ screen_cast.qds        # 投屏服务（输出+接收）
│  │  │  └─ cast_ai.qdai           # 投屏AI规则
│  │  └─ ui_ai.qdai                # AI标记文件
│  │
│  ├─ 虚拟化.qd/                  # 【v1.2新增】系统虚拟化模块（独立于兼容层）
│  │  ├─ vm_manager.qds            # 虚拟机管理器（创建/启动/停止/删除VM）
│  │  ├─ kvm_backend.qds           # KVM后端（Linux内核虚拟化接口封装）
│  │  ├─ vm_config.qds             # 虚拟机配置管理
│  │  ├─ vm_ai.qdai                # 虚拟化AI规则（资源调度/自动优化）
│  │  └─ images/                   # 虚拟机镜像存放目录
│  │
│  └─ 微服务.qd/                  # 低功耗常驻微型服务器
│     ├─ microsrv.qds              # 微型服务器主程序
│     ├─ remote_desktop.qds        # 【v1.2新增】远程桌面服务（VNC/RDP，远程控制+实时浏览）
│     ├─ multi_screen.qds          # 【v1.2新增】多屏协同服务（跨设备投屏/共享键鼠/剪贴板同步）
│     ├─ file_transfer.qds         # 【v1.2新增】跨设备文件传输服务
│     └─ microsrv.qdai             # AI标记配置
│
├─ AI.qd/                         # 全局AI总模块（系统级AI，最高权限）
│  ├─ ai_service.qds               # AI服务主程序
│  ├─ ai_controller.qds            # AI控制器
│  ├─ ai_daemon.qds                # 【v1.2新增】AI.qd守护进程（监控AI.qd状态）
│  ├─ 推理引擎.qd/                  # 【v1.2新增】推理引擎封装（MNN/llama.cpp统一API）
│  ├─ ai_entry.qdai                # AI入口规则
│  ├─ ai_config.qdai               # AI主配置
│  ├─ intent_agent.qdai            # INTENT Agent规则
│  └─ ...其他.qdai                  # 更多AI规则文件
│
├─ 用户.qd/                       # 用户目录（用户安装/开发的所有内容在此）
│  ├─ 应用/                        # 用户安装的应用（Windows exe、安卓apk）
│  ├─ 模块/                        # 用户开发的模块（如Linux兼容.qd）
│  ├─ 文档/                        # 用户文档
│  ├─ 下载/                        # 下载目录
│  └─ ...                          # 用户其他数据
│
└─ tmp/                           # 临时运行目录
```

### 2.3 系统启动流程

```
bootloader
  │
  ▼
Linux 内核启动
  │
  ▼
HAL 硬件抽象层初始化
  │
  ▼
qd-init（初始化进程，PID=1）
  │
  ▼
系统服务执行层启动（确定性代码，实时执行）
  │  ├─ 进程管理服务
  │  ├─ 内存管理服务
  │  ├─ 文件系统服务
  │  ├─ 安全策略执行引擎
  │  └─ 网络服务
  │
  ▼
AI.qd 启动（第一个用户空间智能服务）
  │  ├─ 加载 AI 配置
  │  ├─ 初始化统一记忆系统
  │  ├─ 启动推理引擎（MNN/llama.cpp）
  │  ├─ 启动 AI.qd 守护进程
  │  └─ 建立 AI.qd 命令行界面
  │
  ▼
AI.qd 向执行层下发初始策略
  │
  ▼
AI.qd 启动直接传输模块和隔离层
  │
  ▼
AI.qd 启动图形栈
  │  ├─ 显示服务器（DRM/KMS）
  │  ├─ 合成器（wlroots封装）
  │  ├─ 窗口管理器
  │  ├─ 渲染管线
  │  └─ 输入管理
  │
  ▼
AI.qd 启动兼容层（独立沙箱）
  │  ├─ WDS（Windows兼容层，含box64转译）
  │  └─ ANZ（安卓兼容层，含microG）
  │
  ▼
图形界面显示，用户可用
```

### 2.4 AI.qd 故障降级模式（v1.2 新增）

```
AI.qd 正常运行
  │
  ▼
AI.qd 守护进程检测到 AI.qd 故障（崩溃/无响应/推理失败）
  │
  ▼
执行层切换到"降级模式"
  │  ├─ 使用 AI.qd 最后一次下发的策略继续运行
  │  ├─ 突发情况（OOM/崩溃）由执行层即时处理
  │  └─ 系统核心功能不受影响
  │
  ▼
守护进程用最后一次稳定配置重启 AI.qd
  │
  ▼
AI.qd 恢复正常，重新下发策略
  │
  ▼
系统恢复正常模式
```

**关键**：AI.qd 故障不会导致系统瘫痪，执行层用默认策略继续运行。

---

## 3. 模块分类体系

### 3.1 模块分类

| 分类 | 说明 | 安装位置 | 可否卸载 |
|------|------|---------|---------|
| **核心系统模块（Core）** | 系统启动必须，不可卸载 | `/系统/` | ❌ 不可 |
| **系统服务模块（System）** | 提供系统服务，可替换 | `/系统/` | ⚠️ 需AI.qd确认 |
| **硬件抽象模块（HAL）** | 硬件驱动封装 | `/系统/` | ⚠️ 需AI.qd确认 |
| **图形界面模块（UI）** | 显示、窗口、渲染、输入 | `/系统/` | ⚠️ 可替换 |
| **应用兼容模块（Compat）** | WDS/ANZ兼容，运行在独立沙箱 | `/系统/兼容.qd/` | ⚠️ 可替换 |
| **系统虚拟化模块（VM）** | 虚拟机管理、KVM后端、VM镜像 | `/系统/虚拟化.qd/` | ⚠️ 可替换 |
| **开发者模块（Dev）** | 编译工具链、调试器、QD模拟器、SDK | `/系统/功能.qd/开发者.qd/` | ✅ 可卸载 |
| **网络通信模块（Net）** | 网络协议、远程连接、投屏 | `/系统/` | ✅ 可卸载 |
| **AI 智能模块（AI）** | 推理引擎、Agent、规则引擎 | `/AI.qd/` | ❌ 不可（最高权限） |
| **直接传输模块** | 应用间数据直连 | `/系统/功能.qd/直接传输.qd/` | ❌ 不可（核心） |
| **隔离层模块** | 异常中断保护 | `/系统/功能.qd/隔离层.qd/` | ❌ 不可（核心） |
| **远程桌面服务** | VNC/RDP远程控制、实时屏幕浏览 | `/系统/微服务.qd/` | ✅ 可卸载 |
| **多屏协同服务** | 跨设备投屏、共享键鼠、剪贴板同步 | `/系统/微服务.qd/` | ✅ 可卸载 |
| **投屏模块** | 投屏输出/接收（Miracast/DLNA/HDMI） | `/系统/界面.qd/投屏.qd/` | ✅ 可卸载 |
| **用户模块（User）** | 用户开发的模块 | `/用户.qd/模块/` | ✅ 可卸载 |
| **应用模块（App）** | 用户安装的应用 | `/用户.qd/应用/` | ✅ 可卸载 |

### 3.2 模块命名规范

- 中文名称 + 英文标识（可选）
- 模块文件夹以 `.qd` 结尾
- 名称应简洁明了，不超过 10 个汉字
- 嵌套子模块同样以 `.qd` 结尾
- 兼容层简称：ANZ（安卓）、WDS（Windows）

### 3.3 模块版本规范

- 语义化版本：`主版本.次版本.修订号`（如 `1.2.3`）
- 主版本：不兼容的 API 修改
- 次版本：向下兼容的功能性新增
- 修订号：向下兼容的问题修正

---

## 4. 文件后缀规范（.qd / .qds / .qdai）

### 4.0 本质总览（到底是什么构成的）

这三个后缀不是什么神秘的特殊格式，它们的物理本质非常简单：

| 后缀 | 物理本质 | 用什么写的 | 系统怎么识别和使用 |
|------|---------|-----------|-------------------|
| **.qd** | 一个**普通文件夹**（目录），名字以 .qd 结尾 | 文件夹本身无语言；内部包含 .qds（编译型语言）和 .qdai（自然语言+JSON+Lua） | 模块加载器扫描文件夹，发现有 module.qdmeta 且目录名以 .qd 结尾，就识别为一个模块 |
| **.qds** | 一个**二进制文件**（带元数据头的 ELF 可执行包） | C / Rust / C++ / Go 等编译型语言 → 编译为 ELF 二进制 → 打包成 .qds 格式 | .qds 加载器读取文件头，验证 magic（0x51445353 "QDSS"），提取 ELF 和内嵌配置，执行入口函数 |
| **.qdai** | 一个**纯文本文件**（多段式规则文件） | 自然语言（中文/英文）+ JSON（结构化规则）+ Lua（脚本，可选） | AI 读自然语言理解规则→生成/修改结构化规则→执行层读结构化规则确定性执行→Lua 做 IO 路由 |

**三者的关系**：

```
.qd（模块文件夹 = 容器）
 ├── module.qdmeta（元数据 = 身份证，JSON格式）
 ├── *.qds（系统单文件 = 执行体，真正干活的程序，C/Rust编译）
 ├── *.qdai（AI标记文件 = 规则，告诉AI和系统该怎么干）
 ├── bin/ lib/ etc/ share/（标准子目录）
 └── .git/（独立版本仓库，浅克隆）
```

- **.qd 是容器**：装着 .qds 和 .qdai，是模块的物理载体
- **.qds 是执行体**：真正干活的程序（代码），确定性执行
- **.qdai 是规则**：告诉 AI 和系统该怎么干（规则），AI 可读可生成可解释
- **代码 + 规则 = 一个完整的模块**

**mini 版的简化实现 vs 完整版规范**：

| 项目 | mini 版（当前） | 完整版（规范） |
|------|----------------|--------------|
| .qd | 普通文件夹，有 .qds 和 .qdai | 同左，增加 module.qdmeta 和标准子目录 |
| .qds | 直接的 ELF 二进制（无自定义头、无内嵌配置） | 完整格式：文件头 + ELF + 内嵌配置 + 签名 |
| .qdai | 纯自然语言文本（无结构化规则、无Lua） | 完整格式：YAML头 + 自然语言 + JSON结构化规则 + Lua脚本 + 预训练知识 |

---

### 4.1 .qd —— 模块文件夹

**定义**：一个功能模块，文件夹名称以 `.qd` 结尾，模块内部支持嵌套子 `.qd` 模块。每个 `.qd` 模块自带独立 Git 仓库（`.git` 目录）。

**内部结构**：

```
模块名.qd/
├─ module.qdmeta              # 模块元数据（必填）
├─ bin/                       # 可执行文件
│  └─ module_main             # 模块主程序
├─ lib/                       # 模块私有库
├─ etc/                       # 模块配置
├─ share/                     # 模块数据（字体、图片、UI资源）
├─ *.qds                      # 系统单文件（模块提供的服务）
├─ *.qdai                     # AI标记文件
└─ .git/                      # 独立Git仓库（浅克隆，只保留最近3个版本）
```

**module.qdmeta 格式**（JSON，完整字段）：

```json
{
  "name": "窗口管理",
  "id": "qd-wm",
  "version": "1.0.0",
  "type": "ui",
  "category": "system",
  "author": "奇点OS",
  "description": "管理所有应用窗口的创建、布局、焦点、层级、动画",
  "icon": "share/icon.png",
  "tags": ["window", "ui", "display"],
  "homepage": "https://qidian.os/modules/qd-wm",
  "repository": "https://github.com/qidian-os/qd-wm",
  "bugs": "https://github.com/qidian-os/qd-wm/issues",
  "license": "MIT",
  "min_os_version": "1.0.0",
  "api_level": 1,
  "depends": [
    {"id": "qd-render", "version": ">=1.0.0"},
    {"id": "qd-input", "version": ">=1.0.0"}
  ],
  "optional_depends": [
    {"id": "qd-effects", "version": ">=1.0.0"}
  ],
  "conflicts": [
    {"id": "qd-old-wm", "version": "<1.0.0"}
  ],
  "permissions": ["display", "input", "memory"],
  "background_modes": [],
  "services": ["qd.wm"],
  "entry": "bin/module_main",
  "config_schema": { ... },
  "changelog": "1.0.0: 初始版本"
}
```

**module.qdmeta 字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 模块名称（中文/英文） |
| `id` | string | 是 | 模块唯一标识（小写字母+数字+连字符） |
| `version` | string | 是 | 语义化版本（主.次.修订） |
| `type` | string | 是 | 模块类型（core/system/ui/compat/ai/net/user/dev） |
| `category` | string | 否 | 模块分类（system/tools/media/network/...） |
| `author` | string | 是 | 作者/组织 |
| `description` | string | 是 | 模块描述 |
| `icon` | string | 否 | 模块图标路径（相对模块目录） |
| `tags` | array | 否 | 标签列表（用于搜索） |
| `homepage` | string | 否 | 项目主页 |
| `repository` | string | 否 | 代码仓库地址 |
| `bugs` | string | 否 | 问题反馈地址 |
| `license` | string | 否 | 开源许可证 |
| `min_os_version` | string | 否 | 最低系统版本要求 |
| `api_level` | number | 否 | API 级别 |
| `depends` | array | 否 | 必需依赖（id + 版本范围） |
| `optional_depends` | array | 否 | 可选依赖 |
| `conflicts` | array | 否 | 冲突模块 |
| `permissions` | array | 否 | 声明的权限（见附录B） |
| `background_modes` | array | 否 | 后台模式声明（audio/location/download/voip/...） |
| `services` | array | 否 | 提供的服务名列表 |
| `entry` | string | 是 | 入口程序路径（相对模块目录） |
| `config_schema` | object | 否 | 配置的 JSON Schema |
| `changelog` | string | 否 | 更新日志 |

**.qds 文件位置明确**：
- 模块主程序放在 `bin/` 目录（如 `bin/module_main`）
- 模块提供的 .qds 服务文件放在模块**根目录**（与 module.qdmeta 同级）
- 模块私有库放在 `lib/` 目录
- 模块配置放在 `etc/` 目录
- 模块数据（字体、图片、UI资源）放在 `share/` 目录
- 这样区分：bin/ 是模块自身的可执行文件，根目录的 .qds 是模块对外提供的系统服务

**嵌套子模块规则**：
- 模块内部可以嵌套子 .qd 模块（如 `/系统/兼容.qd/WDS.qd/`）
- 子模块有独立的 module.qdmeta、独立的 .qds/.qdai、独立的 Git 仓库
- 子模块的加载顺序：父模块先加载，子模块后加载（递归）
- 子模块的权限：独立声明，不继承父模块权限
- 子模块的进程：独立进程运行，不与父模块共享进程
- 子模块的依赖：可以依赖父模块或其他模块
- 子模块的卸载：卸载父模块时递归卸载子模块（用户可选择保留子模块）
- 子模块的深度限制：最多嵌套 3 层（防止过深的嵌套导致管理复杂）

**Git 存储优化（v1.2 新增）**：
- 使用浅克隆（`--depth 1`），只保留最新版本
- 系统模块只保留最近 3 个版本历史
- 存储配额管理，超过配额自动清理最旧的历史
- 用户模块的 Git 历史由用户自己管理
- 用 libgit2 轻量库操作，不用完整 Git 命令行

### 4.2 .qds —— 系统单文件

**定义**：系统单文件，属于用户侧系统原生文件，存放于 `.qd` 模块内。

**物理本质**：一个二进制文件，本质是"带元数据头和内嵌配置的 ELF 可执行文件包"。类似 Android 的 APK 但更简单，或者说一个自包含的服务程序。

**开发流程**：
```
用 C/Rust/C++/Go 写源代码
        ↓
编译为 ELF 二进制（静态或动态链接 musl libc）
        ↓
用 qd-pack 打包工具加上文件头和内嵌配置
        ↓
生成 .qds 文件（一个文件就是一个系统服务）
        ↓
放入 .qd 模块目录
        ↓
模块加载器识别并加载
```

**系统执行流程**：
```
.qds 加载器读取文件
        ↓
验证 magic（0x51445353 "QDSS"）
        ↓
读取文件头，获取 ELF 偏移、大小、配置信息
        ↓
提取 ELF 到内存或临时目录
        ↓
读取内嵌配置（JSON），设置环境变量
        ↓
检查权限声明，经执行层安全检查
        ↓
调用入口函数执行（作为独立进程运行在沙箱中）
```

**文件格式**：统一的系统服务包格式，固定布局，自定义头。

**文件布局（严格固定，不可变）**：

```
偏移 0          ┌──────────────────────────────────────────┐
                 │ 文件头（固定 256 字节）                    │
偏移 256        ├──────────────────────────────────────────┤
                 │ ELF 二进制（bin_size 字节）               │
偏移 256+bin_size ├──────────────────────────────────────────┤
                 │ 内嵌配置（JSON，config_size 字节）         │
偏移 ...+config_size ├──────────────────────────────────────────┤
                 │ 签名（可选，signature_size 字节）          │
偏移 文件末尾     └──────────────────────────────────────────┘
```

**文件头完整定义（256 字节，固定偏移）**：

| 偏移 | 大小 | 字段名 | 类型 | 说明 |
|------|------|--------|------|------|
| 0 | 4 | magic | uint32 | 魔数，固定 0x51445353 ("QDSS") |
| 4 | 2 | header_version | uint16 | 文件头格式版本，当前为 1 |
| 6 | 2 | format_version | uint16 | .qds 格式版本，当前为 1 |
| 8 | 64 | name | char[64] | 服务名称，UTF-8，以 \0 结尾 |
| 72 | 64 | entry_symbol | char[64] | 入口函数符号名，如 "qd_service_main"，以 \0 结尾 |
| 136 | 4 | arch | uint32 | 架构标识：0=aarch64, 1=x86_64, 2=riscv64 |
| 140 | 4 | bin_offset | uint32 | ELF 部分在文件中的偏移，固定为 256 |
| 144 | 8 | bin_size | uint64 | ELF 部分大小（字节） |
| 152 | 8 | config_offset | uint64 | 配置部分偏移 = 256 + bin_size |
| 160 | 8 | config_size | uint64 | 配置部分大小（字节），0 表示无配置 |
| 168 | 8 | signature_offset | uint64 | 签名偏移 = 256 + bin_size + config_size |
| 176 | 8 | signature_size | uint64 | 签名大小（字节），0 表示无签名 |
| 184 | 8 | permissions | uint64 | 权限声明位掩码（见附录B权限标识，按位或） |
| 192 | 4 | min_os_version | uint32 | 最低系统版本要求（主版本<<16 | 次版本） |
| 196 | 4 | api_level | uint32 | API 级别 |
| 200 | 32 | reserved | char[32] | 保留字段，必须为 0 |
| 232 | 24 | sha256_tail | char[24] | 文件头前232字节的 SHA256 前24字节（自校验） |
| 256 | - | - | - | 文件头结束，ELF 开始 |

**关键说明**：
- `bin_offset` 固定为 256，ELF 紧接文件头
- `config_offset` = 256 + bin_size，配置紧接 ELF
- `signature_offset` = 256 + bin_size + config_size，签名紧接配置
- 所有偏移和大小都在文件头里，加载器不需要猜测
- `sha256_tail` 用于自校验文件头本身是否被篡改

**入口函数标准定义**：

所有 .qds 服务必须实现标准入口函数，函数签名固定：

```c
// 标准入口函数，所有 .qds 服务必须实现
// 返回值：0=成功，非0=错误码
int qd_service_main(
    int argc,               // 参数个数
    char** argv,            // 参数数组（第一个参数是服务名）
    const char* config_json,// 内嵌配置的 JSON 字符串（无配置时为 NULL）
    void* service_context   // 系统服务上下文（含 IPC 句柄、日志句柄等）
);
```

**入口函数调用约定**：
- 使用 C ABI（cdecl），确保跨语言兼容
- 服务在 `qd_service_main` 中完成初始化，然后进入主循环
- 服务收到停止信号（SIGTERM）时，应在 5 秒内优雅退出
- 退出码：0=正常退出，非0=错误码（见附录A）
- 服务的 stdout/stderr 自动重定向到日志系统（qdlogd），标签为服务名

**服务生命周期**：
```
1. 加载器创建沙箱进程
2. 加载 ELF，解析符号 qd_service_main
3. 设置环境变量、工作目录、资源限制
4. 调用 qd_service_main(argc, argv, config_json, context)
5. 服务初始化，注册到服务管理器（通过 context 中的 IPC 句柄）
6. 服务进入主循环，处理请求
7. 收到停止信号 → 服务清理资源 → 退出
8. 加载器回收进程，通知闪退保护
```

**服务与系统的通信**：
- 服务通过 `service_context` 中的 IPC 句柄与系统通信
- 服务注册：调用 `qd_service_register(context, service_name, version)`
- 服务状态报告：调用 `qd_service_set_state(context, state)`（running/stopped/error）
- 服务心跳：定期调用 `qd_service_heartbeat(context)`（默认30秒一次，超时视为挂死）
- 日志：服务的 printf/fprintf(stderr) 自动进入日志系统，也可调用 `qd_log(context, level, fmt, ...)`

**动态链接处理**：
- 核心服务静态编译（不依赖外部 .so）
- 非核心服务可动态链接，依赖的 .so 放在模块的 `lib/` 目录
- 加载器启动服务前，自动设置 `LD_LIBRARY_PATH=<模块目录>/lib`
- 服务启动时检查依赖的 .so 是否存在，缺失则拒绝启动并记录错误
- 动态库的版本由模块的 module.qdmeta 管理

**stdout/stderr 重定向**：
- 服务的 stdout（文件描述符1）重定向到日志系统的 INFO 级别
- 服务的 stderr（文件描述符2）重定向到日志系统的 ERROR 级别
- 日志标签自动设为服务名
- 服务也可以直接调用 `qd_log()` API 写更结构化的日志
- 调试模式下可关闭重定向，输出到终端

**分级编译策略（v1.2 新增）**：

| 服务类型 | 编译方式 | 理由 |
|---------|---------|------|
| 核心系统服务（HAL、执行层、AI.qd、隔离层、直接传输） | 静态编译 | 保证可移植性和稳定性 |
| 非核心服务（图形栈、兼容层、网络、微服务） | 动态链接共享库 | 节省内存 |
| 所有二进制 | strip 调试符号 + 压缩存储 | 减小体积 |

**内存预期**：10 个核心服务平均每个 3-5MB，总共 30-50MB，手机可以接受。

**开发语言**：支持多种语言绑定
- 核心系统服务：C / Rust / C++
- 应用层服务：C++ / Rust / Go
- 所有语言最终编译为 ELF 二进制，封装为 .qds 格式

### 4.3 .qdai —— AI 标记系统文件（v1.2 简化版）

**定义**：AI 标记系统文件。主体使用自然语言描述规则，配合结构化规则（确定性执行）和 Lua 脚本（IO路由/数据转发）。禁止在 .qdai 内编写完整业务程序。

**物理本质**：一个纯文本文件，本质是"AI 可读可生成可解释，同时机器可确定性执行"的多段式规则文件。类似一个带 AI 注释的配置文件 + 轻量脚本。

**v1.2 简化**：去掉 Python 和 JavaScript，只保留 Lua（最小、最快、最适合嵌入式，约 200KB）。

**完整工作流程**：
```
1. AI.qd 扫描所有 .qdai 文件
        ↓
2. 解析 YAML 元数据头（名称、目标、优先级、触发条件）
        ↓
3. AI 推理引擎读取【自然语言部分】和【预训练知识部分】
   理解规则的意图和约束（AI 理解，秒级）
        ↓
4. AI.qd 生成/修改【结构化规则部分】（JSON格式）
   AI 写规则，不是 AI 实时执行（AI 生成，秒级）
        ↓
5. 系统执行层读取【结构化规则部分】
   确定性执行，不需要 AI 参与（代码执行，微秒级）
        ↓
6. 复杂的 IO 路由和数据转发由【Lua 脚本部分】执行
   嵌入式 Lua 解释器（200KB）执行
        ↓
7. 用户长按 .qdai 时，AI 用自然语言解释规则
   （AI 解读功能）
```

**关键设计原则**：
- 自然语言和结构化规则不一致时，**以结构化规则为准**（确定性优先）
- AI 负责生成和同步结构化规则，不直接执行自然语言
- 小模型只负责简单规则的生成，复杂规则由用户手动编写结构化规则
- 规则有版本管理和测试机制，修改前先测试

**文件结构**：

.qdai 是纯文本文件，UTF-8 编码，由多个"部分"组成，部分之间用**精确的分隔标记**分隔。

```
.qdai 文件完整结构：

┌─────────────────────────────────────────────────────────┐
│ 第0部分：YAML 元数据头（必须）                            │
│ 以 "---" 开头，以 "---" 结尾                              │
│ name: 规则名称                                            │
│ target: 目标模块/服务                                     │
│ priority: 优先级（1-100）                                │
│ trigger: 触发条件（事件名或 cron 表达式）                  │
│ author: 作者                                              │
│ version: 版本                                            │
│ min_os_version: 最低系统版本（可选）                       │
│ tags: 标签列表（可选）                                    │
├─────────────────────────────────────────────────────────┤
│ ===QD_SECTION_NATURAL_LANGUAGE===  ← 精确分隔标记（行首）│
├─────────────────────────────────────────────────────────┤
│ 第1部分：自然语言描述（必须）                              │
│ 用中文/英文自然语言描述规则的意图和约束                    │
│ AI 读取这部分理解规则要干什么                              │
├─────────────────────────────────────────────────────────┤
│ ===QD_SECTION_STRUCTURED_RULES===  ← 精确分隔标记       │
├─────────────────────────────────────────────────────────┤
│ 第2部分：结构化规则（JSON，必须，AI生成，机器执行）        │
│ {                                                         │
│   "schema_version": 1,                                   │
│   "rules": [                                             │
│     {                                                     │
│       "id": "rule_001",                                  │
│       "condition": "app.foreground.type == 'game'",     │
│       "action": { ... },                                 │
│       "priority": 85,                                    │
│       "cooldown_ms": 3000                                │
│     }                                                     │
│   ]                                                       │
│ }                                                         │
├─────────────────────────────────────────────────────────┤
│ ===QD_SECTION_LUA===  ← 精确分隔标记（可选部分）         │
├─────────────────────────────────────────────────────────┤
│ 第3部分：Lua 脚本（可选，仅用于 IO 路由/数据转发）        │
│ -- Lua 代码                                               │
│ function on_input(data) return process(data) end         │
├─────────────────────────────────────────────────────────┤
│ ===QD_SECTION_KNOWLEDGE===  ← 精确分隔标记（可选部分）   │
├─────────────────────────────────────────────────────────┤
│ 第4部分：预训练知识（可选，帮助小模型理解）                │
│ 规则相关的背景知识、示例、术语解释                         │
└─────────────────────────────────────────────────────────┘
```

**部分分隔标记精确定义**：

| 分隔标记 | 对应部分 | 是否必须 | 说明 |
|---------|---------|---------|------|
| `---` (开头和结尾) | YAML 元数据头 | 必须 | 标准 YAML 文档分隔符 |
| `===QD_SECTION_NATURAL_LANGUAGE===` | 自然语言部分 | 必须 | 行首精确匹配，前后无空格 |
| `===QD_SECTION_STRUCTURED_RULES===` | 结构化规则部分 | 必须 | 行首精确匹配 |
| `===QD_SECTION_LUA===` | Lua 脚本部分 | 可选 | 不存在则无 Lua 脚本 |
| `===QD_SECTION_KNOWLEDGE===` | 预训练知识部分 | 可选 | 不存在则无预训练知识 |

**分隔标记匹配规则**：
- 必须**行首精确匹配**（行的第一个字符就是 `=`），前后无空格、无其他字符
- 自然语言内容中出现这些文字不会被误判（因为不是行首）
- 分隔标记行的末尾可以有换行符，但不能有其他字符
- 解析器按分隔标记分割文件，不依赖部分的顺序（但推荐按上述顺序）
- 缺少必须的分隔标记 → 降级为纯自然语言模式，AI 重新生成完整格式

**完整 .qdai 示例文件**：

```yaml
---
name: 游戏性能优化
target: performance
priority: 85
trigger: app_state_change
author: 奇点OS
version: 1.0.0
---
===QD_SECTION_NATURAL_LANGUAGE===
当前台运行的应用是游戏时，系统应该切换到高性能模式，
提升 CPU 频率，并限制后台应用的网络带宽，保证游戏流畅。
当游戏退出前台时，恢复正常性能模式和网络带宽。
===QD_SECTION_STRUCTURED_RULES===
{
  "schema_version": 1,
  "rules": [
    {
      "id": "game_perf_enter",
      "condition": "app.foreground.type == 'game'",
      "action": {
        "type": "system_call",
        "target": "performance.set_mode",
        "params": { "mode": "high_performance", "cpu_boost": true }
      },
      "priority": 85,
      "cooldown_ms": 3000
    },
    {
      "id": "game_network_limit",
      "condition": "app.foreground.type == 'game'",
      "action": {
        "type": "system_call",
        "target": "network.set_bandwidth_limit",
        "params": { "scope": "background_apps", "limit_kbps": 500 }
      },
      "priority": 80,
      "cooldown_ms": 5000
    },
    {
      "id": "game_perf_exit",
      "condition": "app.foreground.type != 'game' && previous.foreground.type == 'game'",
      "action": {
        "type": "system_call",
        "target": "performance.set_mode",
        "params": { "mode": "balanced" }
      },
      "priority": 85,
      "cooldown_ms": 3000
    }
  ]
}
===QD_SECTION_LUA===
-- 游戏性能数据转发
function on_perf_data(data)
  if data.fps < 30 then
    return { alert = "low_fps", fps = data.fps }
  end
  return nil
end
===QD_SECTION_KNOWLEDGE===
游戏应用通常需要高 CPU 和 GPU 性能，对延迟敏感。
后台应用的网络带宽限制不应影响前台游戏的网络连接。
高性能模式会增加功耗和发热，应在游戏退出后及时恢复。
```

---

### 4.3.1 结构化规则正式 JSON Schema

结构化规则部分必须是合法的 JSON，且符合以下 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "QDStructuredRules",
  "type": "object",
  "required": ["schema_version", "rules"],
  "properties": {
    "schema_version": {
      "type": "integer",
      "const": 1,
      "description": "Schema 版本号，当前为 1"
    },
    "rules": {
      "type": "array",
      "description": "规则列表，按 priority 降序执行",
      "items": {
        "type": "object",
        "required": ["id", "condition", "action"],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-z_][a-z0-9_]*$",
            "description": "规则唯一标识，小写字母+下划线+数字"
          },
          "description": {
            "type": "string",
            "description": "规则描述（可选）"
          },
          "condition": {
            "type": "string",
            "description": "条件表达式，求值为 true 时执行 action",
            "minLength": 1
          },
          "action": {
            "type": "object",
            "required": ["type", "target"],
            "properties": {
              "type": {
                "type": "string",
                "enum": ["system_call", "lua_function", "qdai_jump", "log"],
                "description": "动作类型"
              },
              "target": {
                "type": "string",
                "description": "动作目标：system_call 时为 API 名，lua_function 时为函数名，qdai_jump 时为目标 .qdai 路径，log 时为日志级别"
              },
              "params": {
                "type": "object",
                "description": "动作参数（键值对）",
                "additionalProperties": true
              }
            }
          },
          "priority": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100,
            "default": 50,
            "description": "规则优先级，数字越大越先执行"
          },
          "cooldown_ms": {
            "type": "integer",
            "minimum": 0,
            "default": 0,
            "description": "冷却时间（毫秒），触发后在此时间内不再触发"
          },
          "enabled": {
            "type": "boolean",
            "default": true,
            "description": "是否启用该规则"
          }
        }
      }
    }
  }
}
```

**action.type 说明**：

| type | 说明 | target 含义 | params |
|------|------|------------|--------|
| `system_call` | 调用系统 API | API 名称（如 `performance.set_mode`） | API 参数 |
| `lua_function` | 调用 Lua 脚本中的函数 | 函数名 | 函数参数 |
| `qdai_jump` | 跳转到另一个 .qdai | 目标 .qdai 路径 | 传递给目标的参数 |
| `log` | 写日志 | 日志级别（debug/info/warn/error） | 日志消息 |

---

### 4.3.2 condition 表达式语法与求值引擎

**表达式语法**（类 C 表达式，简化版）：

```
表达式 = 逻辑或表达式
逻辑或表达式 = 逻辑与表达式 ("||" 逻辑与表达式)*
逻辑与表达式 = 一元表达式 ("&&" 一元表达式)*
一元表达式 = "!" 一元表达式 | 比较表达式
比较表达式 = 算术表达式 (("==" | "!=" | ">" | "<" | ">=" | "<=") 算术表达式)?
算术表达式 = 项 (("+" | "-") 项)*
项 = 因子 (("*" | "/" | "%") 因子)*
因子 = 数字 | 字符串 | 布尔值 | 变量引用 | "(" 表达式 ")" | 函数调用
变量引用 = 标识符 ("." 标识符)*
函数调用 = 标识符 "(" 参数列表 ")"
字符串 = 单引号包裹的 UTF-8 字符串
数字 = 整数或浮点数
布尔值 = true | false
```

**支持的运算符**：

| 类别 | 运算符 | 说明 |
|------|--------|------|
| 逻辑 | `\|\|`, `&&`, `!` | 或、与、非 |
| 比较 | `==`, `!=`, `>`, `<`, `>=`, `<=` | 等于、不等于、大于、小于、大于等于、小于等于 |
| 算术 | `+`, `-`, `*`, `/`, `%` | 加、减、乘、除、取模 |
| 字符串 | `+` | 字符串拼接 |
| 括号 | `(`, `)` | 改变运算优先级 |

**支持的内置函数**：

| 函数 | 说明 | 示例 |
|------|------|------|
| `contains(str, substr)` | 字符串包含 | `contains(app.name, 'game')` |
| `starts_with(str, prefix)` | 字符串前缀匹配 | `starts_with(app.name, 'com.')` |
| `ends_with(str, suffix)` | 字符串后缀匹配 | `ends_with(file.path, '.exe')` |
| `len(str)` | 字符串长度 | `len(message) > 100` |
| `abs(num)` | 绝对值 | `abs(temperature) > 50` |
| `min(a, b)`, `max(a, b)` | 最小/最大值 | `max(cpu.usage, gpu.usage) > 90` |
| `floor(num)`, `ceil(num)`, `round(num)` | 取整 | `round(fps) < 30` |
| `time()` | 当前时间戳（秒） | `time() - last_trigger > 60` |
| `exists(var)` | 变量是否存在 | `exists(app.foreground)` |
| `typeof(var)` | 变量类型 | `typeof(config.value) == 'number'` |

**系统状态变量注册表（核心变量）**：

执行层维护一个全局的系统状态变量树，condition 表达式可以引用这些变量。完整列表见附录 C。

| 变量路径 | 类型 | 说明 |
|---------|------|------|
| `app.foreground.package` | string | 前台应用包名 |
| `app.foreground.type` | string | 前台应用类型（game/media/tool/system/other） |
| `app.foreground.state` | string | 前台应用状态（running/frozen/crashed） |
| `previous.foreground.package` | string | 上一个前台应用包名 |
| `previous.foreground.type` | string | 上一个前台应用类型 |
| `cpu.usage` | number | CPU 总使用率（0-100） |
| `cpu.temperature` | number | CPU 温度（摄氏度） |
| `memory.usage` | number | 内存使用率（0-100） |
| `memory.available_mb` | number | 可用内存（MB） |
| `gpu.usage` | number | GPU 使用率（0-100） |
| `battery.level` | number | 电量百分比（0-100） |
| `battery.charging` | boolean | 是否在充电 |
| `battery.temperature` | number | 电池温度（摄氏度） |
| `network.type` | string | 网络类型（wifi/mobile/ethernet/none） |
| `network.connected` | boolean | 是否已连接网络 |
| `screen.state` | string | 屏幕状态（on/off/locked） |
| `screen.orientation` | string | 屏幕方向（portrait/landscape） |
| `time.hour` | number | 当前小时（0-23） |
| `time.day_of_week` | number | 星期几（0=周日，6=周六） |
| `system.boot_time` | number | 系统启动时间戳 |
| `system.uptime_seconds` | number | 系统运行时间（秒） |
| `ai.qd.state` | string | AI.qd 状态（ready/loading/degraded/error） |
| `ai.qd.model_loaded` | boolean | AI 模型是否已加载 |

**求值引擎实现**：
- 使用自研的轻量级表达式解析器（递归下降解析，约 500 行 C 代码）
- 求值过程完全确定性，不依赖 AI，微秒级完成
- 变量引用通过状态变量树查找，不存在的变量返回 null（null 参与比较时为 false）
- 表达式求值有超时保护（默认 1ms），超时则视为 false 并记录错误
- 表达式解析结果可缓存，避免重复解析
- 所有运算符和函数都是纯函数，无副作用

---

### 4.3.3 action 系统 API 调用机制

**API 调用流程**：

```
规则的 condition 求值为 true
  ↓
执行层解析 action
  ↓
action.type == "system_call"
  ↓
验证 action.target 是否在系统 API 注册表中
  ↓
验证 action.params 是否符合该 API 的参数 Schema
  ↓
安全检查：调用该 API 是否需要权限，当前规则是否有权限
  ↓
通过 QD-IPC 调用对应的系统服务
  ↓
系统服务执行 API，返回结果
  ↓
记录执行结果到日志
  ↓
触发冷却时间
```

**系统 API 注册表**：

系统维护一个全局的 API 注册表，所有可被 .qdai 调用的系统 API 都必须注册。完整列表见附录 D。

每个 API 注册时包含：
- `name`：API 名称（如 `performance.set_mode`）
- `description`：API 说明
- `module`：所属模块
- `params_schema`：参数的 JSON Schema
- `returns`：返回值说明
- `required_permissions`：调用所需的权限（空表示无需权限）
- `side_effects`：副作用说明（是否修改系统状态）
- `async`：是否异步调用

**核心系统 API 分类**：

| 分类 | API 示例 | 说明 |
|------|---------|------|
| 性能 | `performance.set_mode`, `performance.set_cpu_governor`, `performance.set_animation_scale` | 性能调度 |
| 网络 | `network.set_bandwidth_limit`, `network.set_proxy`, `network.set_dns` | 网络管理 |
| 窗口 | `window.set_state`, `window.set_size`, `window.move_to_front` | 窗口管理 |
| 进程 | `process.kill`, `process.set_priority`, `process.freeze`, `process.thaw` | 进程管理 |
| 电源 | `power.set_screen_timeout`, `power.set_brightness`, `power.reboot`, `power.shutdown` | 电源管理 |
| 存储 | `storage.mount`, `storage.unmount`, `storage.set_cache_size` | 存储管理 |
| 通知 | `notification.send`, `notification.cancel` | 通知发送 |
| 日志 | `log.write`, `log.set_level` | 日志管理 |
| 模块 | `module.load`, `module.unload`, `module.restart` | 模块管理 |
| AI | `ai.set_model`, `ai.set_threads`, `ai.clear_context` | AI 管理 |

**API 调用示例**：

```json
{
  "id": "low_battery_power_save",
  "condition": "battery.level < 20 && !battery.charging",
  "action": {
    "type": "system_call",
    "target": "performance.set_mode",
    "params": { "mode": "power_save" }
  },
  "priority": 90,
  "cooldown_ms": 60000
}
```

---

### 4.3.4 触发机制

**trigger 字段**定义规则何时被检查，有两种类型：

1. **事件驱动**（推荐）：
   - trigger 是事件名（如 `app_state_change`、`battery_level_change`）
   - 当该事件发生时，执行层检查所有订阅该事件的规则
   - 事件系统见附录 E
   - 常用事件：`app_state_change`, `battery_level_change`, `screen_state_change`, `network_state_change`, `timer_1min`, `timer_5min`, `system_boot`

2. **定时触发**（cron 表达式）：
   - trigger 是 cron 表达式（如 `*/5 * * * *` 表示每5分钟）
   - 执行层的定时器到点时检查规则
   - 支持标准 5 段 cron 格式（分 时 日 月 周）

**事件驱动 vs 定时触发的选择**：
- 响应实时性要求高的用事件驱动（如应用切换、电量变化）
- 周期性检查用定时触发（如每5分钟检查一次内存）
- 事件驱动更省电（不需要轮询），优先使用

---

### 4.3.5 跳转规则精确定义

**跳转语法**：在 action 中使用 `type: "qdai_jump"`：

```json
{
  "id": "jump_to_compat_rules",
  "condition": "app.foreground.type == 'game'",
  "action": {
    "type": "qdai_jump",
    "target": "/系统/兼容.qd/compat_ai.qdai",
    "params": { "context": "game_mode" }
  }
}
```

**跳转规则**：
- 跳转起点：必须位于 AI.qd 模块内的 .qdai（`/AI.qd/*.qdai`）
- 跳转目标：只能是其他 .qdai 文件，可以存在任意 .qd 模块内
- 跳转是单向的（A 跳 B，B 不一定跳回 A）
- 跳转时可以传递参数（params），目标 .qdai 可以通过 `jump.params` 变量引用
- 循环跳转检测：执行层维护跳转栈，深度超过 10 层则中断并记录错误
- 跳转是"执行完当前规则的 action 后跳转到目标 .qdai 继续执行"，不是函数调用

---

### 4.3.6 Lua 脚本安全沙箱

**Lua 脚本的限制**：
- 运行在嵌入式 Lua 5.4 解释器中（约 200KB）
- **禁止加载标准库**：不提供 `io`、`os`、`package`、`require`、`loadfile`、`dofile` 等可能访问系统的库
- **只提供安全库**：`string`、`table`、`math`、`utf8`（纯计算，无副作用）
- **禁止访问文件系统、网络、系统调用**
- **执行超时**：每个 Lua 函数调用最多执行 100ms，超时则中断并返回错误
- **内存限制**：Lua 虚拟机最多使用 1MB 内存，超过则报错
- **禁止无限循环**：通过指令计数限制（最多 100 万条指令），超过则中断

**Lua 脚本可调用的系统 API**（通过预注册的安全函数）：
- `qd_log(level, message)`：写日志
- `qd_get_var(path)`：读取系统状态变量（只读）
- `qd_send_ipc(service, message)`：发送 IPC 消息（受限，只能发送给注册的服务）

**Lua 脚本的用途**：
- IO 路由：决定数据转发到哪里
- 数据转换：格式转换、字段提取
- 简单过滤：根据条件过滤数据
- **禁止**：编写完整业务程序、访问系统资源、修改系统状态

---

### 4.3.7 .qdai 修改 .qds 的明确限制

**重要：.qdai 绝对不能修改 .qds 的 ELF 二进制部分！**

.qdai 只能修改 .qds 的**内嵌配置部分**（JSON），不能修改 ELF 二进制。

**允许的操作**：
- 读取 .qds 的内嵌配置（JSON）
- 修改 .qds 的内嵌配置（JSON）
- 读取 .qds 的文件头元数据（名称、版本、架构、权限）
- 读取 .qds 的文件状态（是否运行、PID、资源使用）

**禁止的操作**：
- 修改 .qds 的 ELF 二进制部分（代码段、数据段）
- 修改 .qds 的文件头（magic、入口函数、偏移、大小）
- 修改 .qds 的签名
- 删除 .qds 文件
- 替换 .qds 文件（只能通过包管理器更新）

**修改流程**：
```
.qdai 请求修改某个 .qds 的配置
  ↓
执行层验证：
  - .qdai 是否有权限修改该 .qds（权限检查）
  - 修改的是否只是内嵌配置部分（范围检查）
  - 新配置是否符合 JSON Schema（格式检查）
  ↓
验证通过 → 隔离层保护（创建修改隔离区）
  ↓
修改 .qds 文件的配置部分（按 config_offset 定位）
  ↓
更新文件头的 config_size（如果大小变了）
  ↓
重新计算校验和
  ↓
通知运行中的 .qds 服务配置已变更（通过 IPC）
  ↓
服务重新加载配置
  ↓
提交隔离区
```

**安全原因**：
- 修改 ELF 二进制可能导致服务崩溃、安全漏洞、甚至系统不稳定
- ELF 二进制的更新必须通过包管理器（带签名验证、依赖检查、回滚机制）
- .qdai 只能改配置，不能改代码——这是安全红线

---

**执行优先级（v1.2 明确）**：
- 自然语言和结构化规则不一致时，**以结构化规则为准**（确定性优先）
- AI 负责生成和同步结构化规则，不直接执行自然语言
- 小模型只负责简单规则的生成，复杂规则由用户手动编写结构化规则
- 规则有版本管理和测试机制，修改前先测试

**跳转规则**：
- 跳转起点位于 AI.qd 模块内的 .qdai
- .qdai 跳转目标只能是其他 .qdai 文件
- 目标 .qdai 可以存在任意 .qd 模块内

**权限**：
- .qdai 可以读取、修改 .qds 系统单文件，以此让 AI 规则生效
- .qdai 的执行由 AI.qd 统一调度

**AI 解读功能**：
- 每个 .qd / .qds / .qdai / 文件夹都可以长按让 AI 解读翻译
- AI 可以读取文件夹内容并解释其结构和功能
- 解读结果由 AI.qd 统一输出

**工作方式**：
1. AI.qd 读取自然语言部分和预训练知识，理解规则意图
2. AI.qd 生成/修改结构化规则部分（AI 写规则，不是 AI 实时执行）
3. 系统执行层读取结构化规则，确定性执行（不需要 AI 参与）
4. Lua 脚本用于复杂的 IO 路由和数据转发
5. 用户长按 .qdai 时，AI 用自然语言解释规则

### 4.4 识别、解读与转译机制

#### 4.4.1 总原则：双重识别 + 分层处理

系统采用**双重识别**，既快又安全：
- **第一层：后缀名快速识别**（文件名以 .qd/.qds/.qdai 结尾，O(1) 匹配）
- **第二层：内容验证**（读取文件内容验证格式正确性，防止伪造和损坏）

识别后按层级处理：
- **.qd**：目录级识别 → 解析元数据 → 递归加载内部 .qds 和 .qdai
- **.qds**：文件头验证 → 提取 ELF → 直接执行（无需转译）
- **.qdai**：多段解析 → AI 理解自然语言 → **转译为结构化规则** → 执行层确定性执行

#### 4.4.2 .qd 模块的识别与解读

**识别流程**（确定性代码，微秒级）：

```
模块加载器扫描目录（/系统/ 和 /用户.qd/模块/）
  ↓
发现目录名以 .qd 结尾
  ↓
进入目录，检查是否存在 module.qdmeta 文件
  ↓
读取 module.qdmeta，解析 JSON
  ↓
验证必填字段（name, id, version, entry, type）
  ↓
验证通过 → 识别为有效模块
验证失败 → 标记为损坏模块，跳过，记录日志
```

**解读流程**：
1. 解析 module.qdmeta，获取模块信息（名称、版本、依赖、权限、入口、服务）
2. 依赖检查（递归解析，不满足则不加载并通知 AI.qd）
3. 权限审核（系统模块提交 AI.qd 审核，用户模块直接加载）
4. 扫描内部所有 .qds → 注册为模块服务（调用 .qds 加载器）
5. 扫描内部所有 .qdai → 注册为模块 AI 规则（调用 .qdai 引擎）
6. 扫描子目录 .qd → 递归加载子模块
7. 创建模块沙箱进程（namespace + seccomp），执行入口程序
8. 注册模块服务到服务管理器，模块就绪

#### 4.4.3 .qds 系统单文件的识别与解读

**识别流程**（确定性代码，微秒级）：

```
.qds 加载器接收文件路径
  ↓
检查文件名是否以 .qds 结尾
  ↓
打开文件，读取前 256 字节（文件头）
  ↓
验证 magic number：前4字节是否为 0x51445353 ("QDSS")
  ↓
验证格式版本号是否在支持范围内
  ↓
验证架构标识是否匹配当前设备（aarch64 / x86_64）
  ↓
验证文件完整性：实际大小 = 256 + bin_size + config_size + signature_size
  ↓
全部通过 → 识别为有效 .qds
任何一步失败 → 拒绝加载，返回对应错误码
```

**解读与执行流程**：
1. 读取文件头，获取 ELF 偏移/大小、配置偏移/大小、权限掩码、入口符号
2. 从文件中提取 ELF 二进制到内存或临时目录
3. 提取内嵌配置（JSON），设置环境变量和启动参数
4. 安全检查：验证权限声明（执行层安全策略检查）、验证数字签名
5. 创建沙箱：独立进程（namespace 隔离）、seccomp 系统调用过滤、资源限制
6. 在沙箱中加载 ELF，调用入口函数执行
7. 闪退保护.qds 监控进程状态，崩溃时记录日志并通知 AI.qd

**注意：.qds 不需要转译**，它就是编译好的 ELF 二进制，直接执行。转译只发生在编译阶段（源代码→ELF→打包为.qds）。

#### 4.4.4 .qdai AI 标记文件的识别、解读与转译（核心）

这是三种后缀里最复杂的，涉及**自然语言→机器可执行规则的转译**。

**识别流程**（确定性代码，微秒级）：

```
.qdai 引擎接收文件路径
  ↓
检查文件名是否以 .qdai 结尾
  ↓
打开文件，读取开头内容
  ↓
检查是否以 "---" 开头（YAML 元数据头标记）
  ↓
解析 YAML 元数据头，验证必填字段（name, target, priority）
  ↓
扫描文件内容，检查各部分标记：
  【自然语言部分】、【结构化规则部分】、
  【Lua脚本部分】、【预训练知识部分】
  ↓
验证通过 → 识别为有效 .qdai（完整格式）
验证失败 → 降级模式：按纯自然语言文本处理，AI 尝试理解，记录警告
```

**五阶段处理流程**：

**阶段1：解析**（确定性代码，微秒级）
- 解析 YAML 元数据头（name, target, priority, trigger）
- 按部分标记分割文件内容
- 提取【自然语言部分】→ 纯文本
- 提取【结构化规则部分】→ JSON，直接解析为规则对象
- 提取【Lua脚本部分】→ 纯文本，交给 Lua 解释器
- 提取【预训练知识部分】→ 纯文本，加入 AI 上下文

**阶段2：理解**（AI 推理，秒级）
- AI.qd 读取【自然语言部分】
- AI.qd 读取【预训练知识部分】（帮助理解上下文和术语）
- 结合元数据（target 目标模块、priority 优先级、trigger 触发条件）理解规则意图
- AI 理解："这个规则要在什么条件下，对什么目标，做什么事"

**阶段3：转译**（AI 生成结构化规则，秒级）—— 核心转译过程

- 如果已有【结构化规则部分】：
  - AI 对比自然语言意图 vs 现有结构化规则
  - 一致 → 保持现有规则，不做修改
  - 不一致 → AI 重新生成结构化规则
- 如果没有【结构化规则部分】：
  - AI 根据自然语言从零生成结构化规则
- 生成的结构化规则必须符合严格的规则 Schema：
  - condition：条件表达式（严格语法，引用系统状态变量）
  - action：动作（必须是预定义的系统API调用）
  - params：参数（类型、范围严格校验）
  - priority：优先级
  - cooldown：冷却时间（防止频繁触发）
- 转译后三重验证：
  - 语法验证：JSON 格式是否正确
  - 语义验证：condition/action 是否引用了存在的系统API
  - 安全验证：规则是否违反安全策略（执行层检查）
- 验证通过 → 写回 .qdai 文件的【结构化规则部分】
- 验证失败 → AI 重新生成，最多重试3次，失败则保留旧规则

**阶段4：执行**（确定性代码，微秒级，不依赖 AI）
- 系统执行层读取【结构化规则部分】（JSON）
- 解析所有规则，注册到规则引擎
- 规则引擎持续监控系统状态
- 当某条规则的 trigger/condition 满足时：
  - 评估 condition 表达式（确定性求值）
  - 为真 → 执行 action（调用预定义的系统API）
  - 为假 → 不执行
- 【Lua脚本部分】由嵌入式 Lua 解释器执行（仅用于 IO 路由/数据转发）
- 执行结果记录到系统日志
- **关键：执行阶段完全不依赖 AI，读 JSON 规则直接执行，微秒级**

**阶段5：监督**（AI 抽查，空闲时，秒级）
- AI.qd 在系统空闲、消耗少时抽查规则执行情况
- 检查：规则执行结果是否符合自然语言描述的意图
- 不符合 → AI 重新转译，生成新的结构化规则
- 记录规则执行统计（触发次数、成功率、异常次数、平均耗时）
- 统计数据存入统一记忆，用于后续规则优化

**转译示例**：

自然语言部分：
```
当前台运行的应用是游戏时，系统应该切换到高性能模式，
提升 CPU 频率，并限制后台应用的网络带宽，保证游戏流畅。
```

AI 转译后的结构化规则（JSON，机器直接执行）：
```json
{
  "rules": [
    {
      "id": "game_performance_001",
      "condition": "app.foreground.type == 'game'",
      "action": {
        "type": "system_call",
        "target": "performance.set_mode",
        "params": { "mode": "high_performance", "cpu_boost": true }
      },
      "priority": 85,
      "cooldown": 3000
    },
    {
      "id": "game_network_001",
      "condition": "app.foreground.type == 'game'",
      "action": {
        "type": "system_call",
        "target": "network.set_bandwidth_limit",
        "params": { "scope": "background_apps", "limit_kbps": 500 }
      },
      "priority": 80,
      "cooldown": 5000
    }
  ]
}
```

执行层做的事：持续监控 `app.foreground.type` 系统状态变量，当它变成 `'game'` 时，评估两个规则的 condition，都为真则调用对应系统 API，完全不需要 AI 参与，微秒级响应。

#### 4.4.5 错误处理与降级

| 错误类型 | 处理方式 | 错误码 |
|---------|---------|--------|
| .qd 缺少 module.qdmeta | 不识别为模块，跳过，记录警告 | QD_ERR_MISSING_META |
| .qd 依赖不满足 | 不加载模块，通知 AI.qd | QD_ERR_DEPENDENCY_MISSING |
| .qds magic 不匹配 | 拒绝执行 | QD_ERR_INVALID_QDS_HEADER |
| .qds 架构不匹配 | 拒绝执行 | QD_ERR_ARCH_INCOMPATIBLE |
| .qds 文件完整性校验失败 | 拒绝执行 | QD_ERR_QDS_CORRUPTED |
| .qdai YAML 解析失败 | 降级为纯自然语言，AI 尝试理解 | QD_ERR_QDAI_PARSE_WARN |
| .qdai 结构化规则 JSON 语法错误 | 忽略该部分，AI 重新生成 | QD_ERR_QDAI_RULE_INVALID |
| .qdai 规则引用不存在的系统API | 拒绝执行该条规则，AI 重新生成 | QD_ERR_QDAI_SEMANTIC_ERROR |
| .qdai 规则违反安全策略 | 拒绝执行，记录安全日志 | QD_ERR_SECURITY_VIOLATION |
| AI 转译失败（重试3次后） | 保留旧规则或跳过该规则，通知用户 | QD_ERR_AI_TRANSLATE_FAILED |

**降级原则**：任何一个文件识别/解读/转译失败，都不影响其他文件和系统整体运行。失败的文件被标记、记录日志、通知 AI.qd，系统继续运行。

#### 4.4.6 识别优先级（防止后缀名篡改）

即使后缀名被篡改，系统也能通过内容验证正确识别：

```
遇到一个文件/目录，按以下优先级识别：

1. 是目录？
   ├─ 有 module.qdmeta → 识别为 .qd 模块（不管目录名是什么）
   └─ 没有 → 普通目录

2. 是二进制文件？
   ├─ 前4字节 = 0x51445353 ("QDSS") → 识别为 .qds（不管文件名是什么）
   ├─ 前4字节 = 0x7F454C46 ("ELF") → 普通 ELF 可执行文件
   └─ 其他 → 普通二进制文件

3. 是文本文件？
   ├─ 以 "---" 开头 + 有 .qdai 各部分标记 → 识别为 .qdai
   ├─ 以 "{" 开头 → JSON 文件
   ├─ 以 "#!" 开头 → 脚本文件
   └─ 其他 → 普通文本文件
```

后缀名只是快速识别的提示，内容验证才是权威判断。

---

## 5. AI.qd 最高权限体系

### 5.1 AI.qd 定位

AI.qd 是奇点OS 的**超级框架**，拥有最高权限和最高决策权。整个系统是给 AI 超级框架的超级权限。

**核心原则**：任何 AI 大模型只要被接入奇点OS，就会直接起飞。

**v1.2 明确定位**：AI.qd 是**策略决策层**（大脑，秒级），不是实时执行层。AI 做决策，确定性代码做实时执行（微秒级）。

### 5.2 策略层与执行层分工（v1.2 明确）

| 层级 | 职责 | 响应时间 | 故障处理 |
|------|------|---------|---------|
| **AI.qd 策略层** | 决定"谁该获得更多资源"、"哪个服务该重启"、"窗口怎么布局"、"权限怎么分配"、"修复策略"、"直连通道授权" | 秒级 | 故障时执行层用最后一次策略继续运行（降级模式） |
| **系统服务执行层** | 实时进程调度（CFS）、内存分配、渲染合成、输入分发、安全策略强制执行、实时流量监控、异常即时处理 | 微秒~毫秒级 | 独立运行，不依赖 AI.qd |

**关键规则**：
- AI.qd 只在"策略变更"时介入，不参与每次实时调度
- 突发情况（OOM、进程崩溃）由执行层**即时处理**，事后通知 AI.qd
- 策略变更必须在 1 秒内生效，超时用默认策略
- AI.qd 故障时，执行层使用**最后一次下发的策略**继续运行（降级模式）

### 5.3 权限范围

| 权限类别 | AI.qd | 普通用户 | 普通模块 | 第三方AI |
|---------|-------|---------|---------|---------|
| 系统调用 | ✅ 全部（经执行层安全检查） | ⚠️ 受限 | ❌ 禁止 | ❌ 禁止 |
| 进程管理 | ✅ 全部（策略） | ⚠️ 仅自己的 | ❌ 禁止 | ❌ 禁止 |
| 内存管理 | ✅ 全部（策略） | ⚠️ 仅自己的 | ❌ 禁止 | ❌ 禁止 |
| 文件系统 | ✅ 读写全部 | ⚠️ 用户目录 | ⚠️ 模块目录 | ❌ 经AI.qd中转 |
| 设备管理 | ✅ 全部（策略） | ❌ 禁止 | ❌ 禁止 | ❌ 禁止 |
| 网络访问 | ✅ 最高优先 | ✅ 正常 | ⚠️ 需确认 | ❌ 经AI.qd中转 |
| 系统配置 | ✅ 全部（修改安全策略需用户确认） | ⚠️ 部分 | ❌ 禁止 | ❌ 禁止 |
| 模块管理 | ✅ 全部 | ⚠️ 用户模块 | ❌ 禁止 | ❌ 禁止 |
| AI 记忆 | ✅ 读写全部 | ⚠️ 仅自己的 | ❌ 禁止 | ⚠️ 云端记忆自由，本地记忆被抽走 |
| 直接传输授权 | ✅ 授权/抽查 | ❌ 禁止 | ⚠️ 经授权可直连 | ❌ 禁止 |
| 安全策略修改 | ✅ 可请求（需用户确认） | ✅ 可制定 | ❌ 禁止 | ❌ 禁止 |

**核心规则**：
- 用户能做的，AI.qd 都能做
- 用户不能做的，AI.qd 也能做
- AI.qd 的能力是"读"和"写"，存储功能在系统.qd
- AI.qd 访问优先级最高
- AI.qd 做策略决策，实时执行由系统服务完成

### 5.4 用户限制 AI.qd 的强制执行机制（v1.2 明确）

> 用户限制不是 AI.qd "自愿遵守"，而是由**执行层强制执行**。

```
用户写限制规则（.qdai）
  ↓
写入"系统安全策略文件"（只读，AI.qd 不能直接修改）
  ↓
执行层（不是AI.qd）根据安全策略文件强制执行所有系统调用
  ↓
AI.qd 的所有操作都经过执行层权限检查
  ↓
违反安全策略的操作被执行层拒绝
```

- AI.qd 想修改安全策略？需要**用户确认**（弹窗/密码），执行层才允许修改
- 这样 AI.qd 有最高权限（可以请求修改策略），但用户限制有效（执行层强制执行）
- AI.qd 读到限制文件就自动回避，同时执行层也会强制执行（双重保障）

### 5.5 模块间调用规则（v1.2 双通道）

**除 AI.qd 外，其他模块只能用自身模块内的东西。**

模块间调用分两条通道：

**通道 A：控制通道（经 AI.qd，低频，安全）**
- 模块启动/停止
- 权限申请
- 依赖查询
- 配置修改
- 异常上报
- 直连通道申请
- 这些操作频率低（每秒几次），经 AI.qd 没问题

**通道 B：数据通道（直连，高频，高性能，经直接传输模块管理）**
- 渲染数据传输
- 输入事件传递
- 大块数据读写
- 音频/视频流
- 这些操作频率高（每秒几千次），模块间直连，不经 AI.qd
- 但直连通道的建立需要 AI.qd 授权
- 直连通道由【直接传输模块】管理，三层安全保障

**AI.qd 抽查机制**：
- AI.qd 不参与实时数据传输
- AI.qd 在空闲、系统消耗少时，对直连通道进行抽查抓取
- 抽查内容：数据合法性、权限合规、异常检测
- 发现违规立即中断通道并上报

### 5.6 性能调度

AI.qd 统一管理所有性能分配**策略**，系统服务执行层实时执行。

**CPU 分配**：
- AI.qd 分配足够自己独立推理用的大核和小核
- 其他模块的 CPU 使用策略需要通过 AI.qd 确认（策略层面）
- 实时调度由系统服务执行层的 CFS 调度器完成（微秒级）
- AI.qd 线程优先级最高

**内存分配**：
- 优先供 AI.qd 自己使用
- 剩余内存分配给其他模块
- AI.qd 可随时回收其他模块的内存（策略决策，执行层执行）

**IO 优先级**：
- AI.qd 存储访问优先级最高
- AI.qd 网络请求最优先

**充电/电池调度**：
- 充电/电池性能调度策略由用户在设置里确定
- 用户可对 AI.qd 进行限制（如限制查看的文件内容）
- 用户写的限制通过 .qdai 进行，由执行层强制执行
- AI.qd 读到限制文件就自动回避，不限制其权限，只是不访问

### 5.7 AI.qd 独立存储与微系统

**独立存储**：
- AI.qd 拥有独立存储区域
- 用于存放 AI.qd 自己的配置、临时数据、修复工具、备份
- 系统崩坏时用于备份用户数据

**微系统（防崩溃程序集）**：
- AI.qd 内置一套微系统，但不算完整系统
- 本质是一套防崩溃程序和修复工具
- 作用：系统崩坏时，AI.qd 带修复工具进行自修复

**AI.qd 守护进程（v1.2 新增）**：
- 独立的最小化进程，不依赖 AI 推理
- 监控 AI.qd 状态（心跳、响应时间、资源使用）
- AI.qd 故障时，用最后一次稳定配置重启 AI.qd
- 守护进程本身由执行层监控，形成多层监控

**自修复流程**：
```
系统崩坏检测（闪退保护.qds）
  │
  ▼
AI.qd 微系统接管（只要内核没崩溃或硬件没损坏）
  │
  ▼
AI.qd 调用 .qdai 文件，查找防崩溃程序
  │
  ▼
通过防崩溃程序进入系统，进行诊断
  │ （确定性诊断优先：日志分析、错误码匹配、状态检查）
  │ （复杂问题才用 AI 辅助诊断）
  │
  ├─ 方案A：修改损坏的模块至可用版本
  │
  └─ 方案B：通过 Git 仓库进行回退
      │
      ▼
  回退前先备份用户数据（自动创建快照）
  - AI.qd 安装的东西
  - 软件使用的缓存
  - 优先备份到 AI.qd 独立存储
      │
      ▼
  系统复原
      │
      ▼
  检查备份的东西有没有少
      │
      ├─ 没少：删掉备份，保留原东西
      │       （备份保留三天，内存告急再删）
      │
      └─ 少了：从备份恢复
```

**安全模式（v1.2 新增）**：
- 严重故障时，只加载核心模块（HAL、执行层、AI.qd、隔离层）
- 不加载第三方模块和兼容层
- 用于故障恢复和诊断
- 用户可以手动进入安全模式

**用户介入**：
- 修复不需要用户介入，自动进行
- 但用户可以介入
- 系统崩溃时，用户也可以看到 AI.qd 独立的命令行和窗口

### 5.8 统一记忆系统

**定义**：所有 AI（包括 AI.qd 自身和第三方 AI）的本地记忆由 AI.qd 统一存储和管理。

**v1.2 实现方案**：
- 用 SQLite（轻量、快速、成熟，几百KB）
- 记忆用用户密钥加密存储
- 用户有完整的记忆管理界面（查看、删除、导出、搜索）
- 记忆自动分类和摘要，避免无限增长
- 第三方 AI 的记忆有来源标记，用户知道哪条记忆来自哪个 AI

**记忆抽取方式（v1.2 修正）**：
- 不做"实时拦截"（技术困难），改为**定期同步**（第三方 AI 空闲时同步记忆）
- 第三方 AI 的记忆存储在标准位置，AI.qd 定期读取和索引
- 用户可以选择哪些第三方 AI 的记忆被抽取

**规则**：
- 第三方 AI（如豆包）的云端记忆可以自由调用
- 第三方 AI 写入本地的记忆定期被 AI.qd 同步，变成统一记忆
- AI.qd 拥有统一记忆的读写权
- 用户可查看统一记忆，但修改需经 AI.qd

**存储位置**：
- 统一记忆库存放在 `/系统/` 目录下（由系统.qd 负责存储）
- AI.qd 负责读写，系统负责存储

---

## 6. AI.qd 直接传输模块

### 6.1 模块定位

**位置**：`/系统/功能.qd/直接传输.qd/`

**作用**：为应用间提供高频数据直连通道，不经过 AI.qd 实时转发，保证毫秒级甚至微秒级响应。

**解决的问题**：所有模块调用经 AI.qd 会导致性能瓶颈，高频调用（渲染、输入、流媒体）延迟爆炸。

### 6.2 三层安全机制（v1.2 核心）

> 安全是多层防御，不是 100% 保证。明确风险和权衡。

```
第一层：通道建立时严格授权（AI.qd 审批）
  - AI.qd 检查权限、必要性、风险等级
  - 通道两端身份验证
  - 共享内存用 mprotect 防止越界访问
  - 通道加密（TLS 或共享内存加密）
        │
        ▼
第二层：实时流量监控（执行层做，不依赖AI，微秒级）
  - 速率限制（防止占满带宽）
  - 异常流量检测（突发大量数据、可疑模式）
  - 通道状态监控（连接状态、错误率）
  - 检测到恶意行为立即断开通道
        │
        ▼
第三层：AI.qd 空闲时深度抽查（秒级）
  - 内容审计（数据是否符合申请时声明的类型）
  - 权限合规检查
  - 完整记录日志
  - 发现违规立即中断通道并上报
```

### 6.3 工作原理

```
应用A 需要向 应用B 传输高频数据
  │
  ▼
应用A 向 AI.qd 申请直连通道（控制通道，低频）
  │
  ▼
AI.qd 评估权限、安全性、必要性
  │
  ├─ 拒绝：返回拒绝原因，应用A 只能经 AI.qd 传输
  │
  └─ 批准：
      │
      ▼
  AI.qd 通知【直接传输模块】建立通道
      │
      ▼
  直接传输模块在 应用A 和 应用B 之间建立共享内存/UNIX Socket 直连
      │
      ▼
  应用A 和 应用B 通过直连通道传输数据（不经 AI.qd，微秒级）
      │
      ▼
  执行层实时监控通道流量（第二层安全）
      │
      ▼
  AI.qd 在空闲时对通道进行抽查（第三层安全）
      │
      ▼
  发现违规 → 立即中断通道 → 上报 AI.qd 处理
```

### 6.4 通道类型

| 通道类型 | 适用场景 | 性能 |
|---------|---------|------|
| 共享内存通道 | 大块数据传输（渲染缓冲、视频帧） | 最高（零拷贝） |
| UNIX Socket 通道 | 消息传递、事件通知 | 高（微秒级） |
| 管道通道 | 流式数据（音频流、日志） | 高 |
| 网络通道 | 跨设备数据传输 | 中（受网络限制） |

### 6.5 通道生命周期

1. **申请**：应用向 AI.qd 申请直连通道（控制通道）
2. **授权**：AI.qd 评估并决定是否批准
3. **建立**：直接传输模块建立通道
4. **传输**：应用间通过通道传输数据
5. **监控**：执行层实时监控 + AI.qd 空闲抽查
6. **关闭**：传输完成或违规时关闭通道
7. **记录**：通道使用记录存入系统日志

### 6.6 用户可调整安全级别

- **严格模式**：所有通道都需要持续 AI.qd 审计（更安全，更慢）
- **平衡模式**：授权 + 实时监控 + 抽查（默认，平衡安全和性能）
- **宽松模式**：只授权，不监控（更快，安全风险更高）

---

## 7. 隔离层

### 7.1 模块定位

**位置**：`/系统/功能.qd/隔离层.qd/`

**实现**：用 .qds 系统单文件实现

**作用**：处理任务异常中断，把不完整的修改装进隔离区，防止导致整个系统错误。

**解决的问题**：任务改了一半、写了一半就异常中断（崩溃、断电、用户取消），导致系统处于不一致状态。

### 7.2 分级隔离（v1.2 核心）

| 修改类型 | 隔离方式 | 性能开销 | 示例 |
|---------|---------|---------|------|
| 关键系统修改 | 完整隔离（写入隔离区，验证后提交） | 中 | 系统配置修改、模块更新、系统升级 |
| 普通文件写入 | 轻量隔离（只记录元数据，不复制内容） | 低 | 应用数据、用户文档、日志 |
| 临时文件 | 不隔离 | 无 | /tmp 下的临时文件 |

### 7.3 工作原理

```
系统任务开始执行（修改配置、更新模块、写入文件等）
  │
  ▼
隔离层拦截任务，根据修改类型创建对应级别的"隔离区"
  │
  ▼
任务的所有修改先写入隔离区，不直接修改系统
  │
  ├─ 任务正常完成：
  │   │
  │   ▼
  │ 隔离层验证修改完整性
  │   │
  │   ├─ 完整：提交修改到系统，删除隔离区
  │   │
  │   └─ 不完整：回滚隔离区，上报异常
  │
  └─ 任务异常中断（崩溃/断电/取消）：
      │
      ▼
  隔离区保留不完整的修改
      │
      ▼
  系统重启后，隔离层检测到未完成的隔离区
      │
      ▼
  AI.qd 评估：
      ├─ 可以恢复：继续完成任务，提交修改
      ├─ 需要回滚：撤销修改，恢复系统原状
      └─ 需要用户确认：提示用户选择
```

### 7.4 隔离区类型

| 隔离区类型 | 适用场景 | 说明 |
|-----------|---------|------|
| 文件修改隔离 | 配置文件、系统文件修改 | 修改先写入临时文件，完成后原子替换 |
| 模块更新隔离 | 模块安装、更新、卸载 | 新模块先装入隔离区，验证后替换 |
| 系统配置隔离 | 系统设置变更 | 配置变更先存入隔离区，确认后生效 |
| 数据库事务隔离 | 统一记忆、模块数据库 | 事务级隔离，ACID 特性 |
| 批量操作隔离 | 批量文件操作、批量配置 | 批量操作要么全部成功，要么全部回滚 |

### 7.5 隔离层存储与管理

- 隔离区存储在 `/系统/功能.qd/隔离层.qd/quarantine/`
- 每个隔离区有唯一 ID 和元数据（任务类型、开始时间、修改内容摘要）
- 隔离区存储空间有配额（默认系统分区的 5%）
- 超过配额时，AI.qd 决定清理哪些旧隔离区
- 成功提交后立即删除隔离区，失败的保留 3 天
- 隔离区满时自动清理最旧的失败隔离区

### 7.6 隔离层与 AI.qd 的关系

- 隔离层由 .qds 实现，是确定性的执行层
- AI.qd 负责策略决策：
  - 哪些任务需要隔离（默认所有系统修改任务都隔离）
  - 隔离区保留多长时间
  - 异常中断后是恢复还是回滚
  - 隔离区的存储空间配额
- 隔离层执行具体的隔离、验证、提交、回滚操作

---

## 8. 硬件抽象层（HAL）

### 8.1 HAL 定位

HAL 是连接内核与上层系统的桥梁，所有上层代码只调用 HAL 接口，不直接调用 Linux 系统调用。

**迁移意义**：未来换自研内核时，只需重写 HAL 层，上层代码全部复用。

### 8.2 HAL 接口分类

| 接口类别 | 封装内容 |
|---------|---------|
| 进程管理 | fork / exec / wait / kill / exit |
| 内存管理 | mmap / munmap / brk / mprotect |
| 文件系统 | open / read / write / close / ioctl / stat |
| 网络 | socket / bind / listen / accept / connect / send / recv |
| 信号 | signal / sigaction / kill / sigprocmask |
| 时间 | time / gettimeofday / clock_gettime / sleep |
| 线程 | pthread_create / pthread_join / pthread_mutex |
| 共享内存 | shmget / shmat / shmdt / shmctl |
| 输入设备 | /dev/input/eventX 读取与解析 |
| 显示设备 | /dev/fb0 / DRM 接口 |
| 电源管理 | 充电状态 / 电池电量 / 唤醒锁 |

### 8.3 HAL 实现

- **语言**：C
- **编译**：静态链接，不依赖系统 libc（使用 musl）
- **头文件**：`qd_hal.h`，所有接口以 `qd_hal_` 前缀命名
- **错误处理**：统一错误码，返回 `qd_result_t`

### 8.4 迁移到自研内核

当迁移到自研内核时：
1. 保持 HAL 接口不变
2. 重写 HAL 内部实现，适配自研内核的系统调用
3. 上层代码（系统服务、图形栈、应用运行时）全部不用改
4. 重新编译整个系统

---

## 9. 系统服务层

### 9.1 服务列表

| 服务 | 模块位置 | 职责 | 层级 |
|------|---------|------|------|
| 进程管理 | `/系统/功能.qd/进程调度.qds` | 进程创建、销毁、调度、优先级 | 执行层（实时） |
| 内存管理 | `/系统/功能.qd/` | 内存分配、回收、共享内存、OOM处理 | 执行层（实时） |
| 文件系统 | `/系统/功能.qd/` | 文件操作、目录管理、挂载、配额 | 执行层（实时） |
| 服务管理 | AI.qd 策略 + 执行层实现 | 服务启动、停止、重启、状态监控 | AI策略 + 执行 |
| 权限管理 | `/系统/功能.qd/` | 权限检查、访问控制、沙箱、安全策略强制执行 | 执行层（实时） |
| 包管理 | `/系统/兼容.qd/安装管理.qds` | 模块安装、卸载、更新、依赖解析 | 执行层 |
| 设备管理 | `/系统/功能.qd/` | 设备枚举、驱动加载、热插拔 | 执行层 |
| 网络管理 | `/系统/微服务.qd/` | 网络配置、连接管理、防火墙 | 执行层 |
| 直接传输 | `/系统/功能.qd/直接传输.qd/` | 应用间数据直连通道管理 | 执行层 |
| 隔离层 | `/系统/功能.qd/隔离层.qd/` | 异常中断任务的修改隔离 | 执行层 |
| AI.qd 守护进程 | `/AI.qd/ai_daemon.qds` | 监控 AI.qd 状态，故障时重启 | 执行层（独立） |

### 9.2 服务管理

- AI.qd 制定服务管理策略（启动顺序、重启策略、资源配额）
- 系统服务执行层实时执行（进程创建、监控、重启）
- 服务间通信通过 QD-IPC（控制通道经 AI.qd，数据通道直连）
- 服务崩溃由闪退保护.qds 监控，AI.qd 决定重启策略
- 服务配置由 AI.qd 通过 .qdai 规则修改

### 9.3 模块沙箱实现（v1.2 明确）

用成熟的 Linux 容器技术（Docker/LXC 的基础）：
- Linux namespace（进程、网络、挂载、PID 隔离）
- seccomp（系统调用过滤）
- bind mount（文件系统重定向）
- cgroups（资源限制）
- 这些都是经过验证的技术，不是从零发明

### 9.4 用户与账户管理

**定位**：虽然奇点OS 主要是单用户移动系统，但仍需要基本的用户/账户模型来做权限隔离和数据隔离。

**模块位置**：`/系统/功能.qd/账户管理.qd/`

**核心功能**：
- **主用户**：系统默认创建一个主用户，所有用户数据在 `/用户.qd/` 下
- **访客模式**：临时用户，数据不持久化，退出后自动清理
- **多用户（未来扩展）**：支持多用户切换，每个用户有独立的 `/用户.qd/` 目录
- **用户组**：系统定义基础用户组（system、user、guest、app），用于文件权限
- **认证**：PIN/密码/生物识别（指纹、人脸），通过 HAL 调用硬件
- **权限提升**：类似 sudo，用户执行系统级操作时需要认证，AI.qd 操作不需要（最高权限）

**用户数据隔离**：
- 每个用户的应用数据、文档、设置完全隔离
- 应用只能访问当前用户的数据
- AI.qd 可以访问所有用户数据（最高权限）

**与安全模型的关系**：
- 用户身份是权限检查的基础
- 文件权限基于用户/组（类似 Unix 的 rwx 模型，但简化）
- 应用运行在独立的 UID 下，互相隔离

### 9.5 包管理器详细设计

**定位**：统一管理 .qd 模块、.qds 服务、应用（APK/EXE）的安装、卸载、更新、依赖解析。

**模块位置**：`/系统/兼容.qd/安装管理.qds`（核心）+ `/系统/功能.qd/包管理.qd/`（扩展）

**核心功能**：

1. **依赖解析**：
   - 读取 module.qdmeta 中的 depends 字段
   - 递归解析依赖树
   - 检测循环依赖（禁止）
   - 版本范围匹配（>=1.0.0, <2.0.0）
   - 依赖冲突时由 AI.qd 裁决

2. **仓库管理**：
   - 支持多个软件源（官方源、第三方源、本地源）
   - 仓库元数据：模块列表、版本、依赖、签名、下载地址
   - 仓库更新：同步元数据，支持增量更新
   - 模块市场：用户可浏览、搜索、安装模块

3. **安装流程**：
   ```
   用户选择安装模块
     ↓
   下载模块包（.qdp 格式，见下）
     ↓
   验证签名（可选，官方源必须验证）
     ↓
   依赖检查（递归解析，缺失则自动安装）
     ↓
   隔离层保护（创建安装隔离区）
     ↓
   解压到临时目录
     ↓
   验证 module.qdmeta 和文件完整性
     ↓
   移动到目标位置（/系统/ 或 /用户.qd/模块/）
     ↓
   初始化 Git 仓库（浅克隆）
     ↓
   注册模块到模块加载器
     ↓
   提交隔离区，安装完成
     ↓
   AI.qd 审核权限声明（系统模块）
   ```

4. **卸载流程**：
   - 检查是否有其他模块依赖此模块（有则拒绝或级联卸载）
   - 隔离层保护
   - 停止模块服务
   - 删除模块文件
   - 清理模块数据（可选，用户选择是否保留数据）
   - 提交隔离区

5. **更新流程**：
   - 检查新版本
   - 下载新版本
   - 依赖检查
   - 隔离层保护
   - 停止旧模块
   - 备份旧版本（Git 自动记录）
   - 安装新版本
   - 验证新版本可正常启动
   - 失败则自动回滚到旧版本
   - 成功则提交隔离区

6. **模块包格式（.qdp）**：
   - 本质是 tar.zst 压缩包
   - 包含：模块文件、module.qdmeta、签名文件、安装脚本（可选）
   - 包内文件结构与安装后的 .qd 目录结构一致

7. **签名验证**：
   - 官方模块用官方私钥签名
   - 用户模块可选择自签名或不签名
   - 签名验证失败时警告用户，用户可选择强制安装（风险自担）

8. **回滚**：
   - 每个模块有 Git 仓库，可回退到任意历史版本（只保留最近3个）
   - 更新失败自动回滚
   - 用户可手动回滚

### 9.6 日志系统

**定位**：统一的系统日志服务，所有系统服务、应用、AI.qd 的日志都通过统一接口记录，用于调试、bug 定位、性能分析、安全审计。**没有日志系统，出了 bug 无法排查。**

**模块位置**：`/系统/功能.qd/日志系统.qd/`
```
/系统/功能.qd/日志系统.qd/
├─ qdlog.qds           # 日志守护进程（收集、存储、轮转）
├─ qdlogctl.qds        # 日志查询/管理工具
└─ log_ai.qdai         # AI规则（日志级别、保留策略、异常检测）
```

**核心功能**：

1. **日志接口**：
   - C API：`qd_log(level, tag, format, ...)`
   - 所有系统服务、应用、AI.qd 都通过这个接口写日志
   - 日志通过 QD-IPC 发送给 qdlog 守护进程（非阻塞，应用不卡顿）

2. **日志级别**：
   - `DEBUG`：调试信息，开发用，默认不记录
   - `INFO`：正常运行信息
   - `WARN`：警告，可能有问题
   - `ERROR`：错误，功能异常
   - `FATAL`：致命错误，系统/服务崩溃
   - `AI`：AI.qd 专用日志级别（AI 推理、决策、规则执行）
   - `SECURITY`：安全相关（权限拒绝、异常访问、签名验证失败）

3. **日志格式**：
   ```
   [时间戳] [级别] [PID] [标签] [消息]
   示例：
   [2026-09-16 12:30:45.123] [INFO] [1234] [tombstone] 应用 com.example.app 进入后台，已冻结
   [2026-09-16 12:30:46.456] [ERROR] [567] [WDS] Windows 应用 notepad.exe 崩溃，退出码 0xC0000005
   [2026-09-16 12:30:47.789] [AI] [1] [ai.qd] 检测到内存使用率 85%，决定回收后台应用 com.old.app
   ```

4. **日志存储**：
   - 二进制格式存储（类似 journald），高效压缩
   - 存储位置：`/var/log/qdlog/`（或 `/用户.qd/系统日志/`）
   - 按日期和大小分片
   - 支持索引，快速按时间/级别/标签查询

5. **日志轮转与保留**：
   - 按大小轮转：单个日志文件超过 10MB 自动分片
   - 按时间轮转：每天一个分片
   - 保留策略：默认保留最近 7 天的日志，超过自动清理
   - 存储空间配额：默认最多占用 500MB，超过自动清理最旧的
   - AI.qd 日志和 SECURITY 日志保留时间更长（默认 30 天）

6. **日志查询**：
   - 命令行工具：`qdlogctl`（类似 journalctl）
   - 支持按时间范围、级别、标签、PID、关键词过滤
   - 支持实时跟踪（`-f`）
   - 支持导出为文本/JSON
   - 图形界面：设置里有日志查看器，可筛选、搜索、导出

7. **崩溃日志（core dump）**：
   - 应用/服务崩溃时自动捕获核心转储
   - 包含：崩溃时的寄存器状态、堆栈、内存映射、打开的文件
   - 存储位置：`/var/log/coredump/`
   - 自动分析：AI.qd 可以分析崩溃日志，给出可能的原因和修复建议
   - 用户可选择是否共享崩溃日志（隐私）

8. **AI.qd 日志**：
   - AI.qd 的所有决策、推理、规则执行都记录在 AI 级别日志
   - 包含：输入、输出、决策依据、执行结果、耗时
   - 用于审计 AI 行为、优化 AI 策略、排查 AI 相关 bug
   - AI.qd 日志默认保留 30 天

9. **日志与自修复的关系**：
   - 闪退保护检测到崩溃时，自动收集相关日志
   - AI.qd 自修复时，首先分析日志确定崩溃原因
   - 确定性诊断优先：基于日志的错误码匹配和模式识别
   - 复杂问题才用 AI 辅助分析

### 9.7 设备管理与热插拔

**定位**：统一管理系统中的所有硬件设备，类似 Linux 的 udev/eudev。负责设备枚举、设备节点创建、驱动加载、固件加载、热插拔事件处理。

**模块位置**：`/系统/功能.qd/设备管理.qd/`

**核心功能**：

1. **设备枚举**：
   - 启动时扫描所有硬件设备（通过 sysfs 或 HAL）
   - 创建设备树（/dev/ 下的设备节点）
   - 维护设备数据库（设备 ID、类型、驱动、状态）

2. **设备类型**：
   - 显示设备：屏幕、外接显示器
   - 输入设备：触摸屏、键盘、鼠标、手柄
   - 存储设备：eMMC、UFS、SD卡、U盘
   - 网络设备：WiFi、蓝牙、以太网、移动网络
   - 音频设备：扬声器、麦克风、耳机
   - 传感器：加速度计、陀螺仪、磁力计、光线、距离、气压、温度、心率
   - 相机：前置、后置
   - 电池：电池、充电管理
   - USB：USB 控制器、USB 设备
   - 其他：GPS、NFC、红外

3. **驱动加载**：
   - 设备匹配：根据设备 ID（vendor ID + product ID）匹配驱动
   - 驱动加载：内核模块自动加载（通过 modprobe）
   - 固件加载：某些设备需要固件文件，自动从 /lib/firmware/ 加载
   - 驱动依赖：驱动之间的依赖关系管理

4. **热插拔**：
   - 监听内核的热插拔事件（uevent）
   - 设备插入：自动加载驱动、创建设备节点、通知应用
   - 设备拔出：自动清理设备节点、通知应用、释放资源
   - 事件广播：通过 QD-IPC 广播设备变化事件，应用可订阅

5. **设备权限**：
   - 设备节点的权限基于用户组
   - 应用需要声明设备访问权限，经 AI.qd 审核
   - 敏感设备（相机、麦克风、位置）需要运行时权限

6. **设备属性查询**：
   - 应用可通过 API 查询设备信息（型号、厂商、状态、能力）
   - 例如：屏幕分辨率、传感器列表、电池电量、WiFi 状态

### 9.8 网络管理详细设计

**定位**：统一管理所有网络连接，类似 Linux 的 NetworkManager + systemd-networkd。

**模块位置**：`/系统/微服务.qd/网络管理.qd/`（或独立模块）

**核心功能**：

1. **网络类型**：
   - WiFi：扫描、连接、断开、保存网络、WPA2/WPA3、企业级 WiFi（EAP）
   - 蓝牙：蓝牙开关、设备配对、文件传输、BLE、音频（A2DP/HFP）
   - 移动网络：SIM 卡管理、数据连接、APN 配置、信号强度（刷机版）
   - 以太网：有线网络（平板/PC 版）
   - 热点：WiFi 热点、蓝牙热点、USB 网络共享
   - VPN：OpenVPN、WireGuard、IPsec、系统级 VPN 配置
   - 代理：HTTP/SOCKS 代理，系统级和应用级

2. **连接管理**：
   - 自动连接：优先连接已保存的 WiFi，信号弱时自动切换
   - 连接优先级：以太网 > WiFi > 移动网络
   - 网络切换：网络切换时保持应用连接不中断（通过网络命名空间和 socket 代理）
   - 飞行模式：一键关闭所有无线连接

3. **DNS 与 DHCP**：
   - DHCP 客户端：自动获取 IP 地址
   - DNS 配置：系统级 DNS，支持自定义 DNS（如 8.8.8.8、114.114.114.114）
   - DNS 缓存：本地 DNS 缓存，加速解析
   - 私有 DNS：DNS over TLS（DoT）、DNS over HTTPS（DoH）

4. **防火墙**：
   - 基于 nftables/iptables
   - 默认策略：禁止外部入站连接，允许所有出站连接
   - 应用级防火墙：可按应用限制网络访问（禁止某个应用联网）
   - 端口管理：开放/关闭端口，端口转发
   - AI.qd 网络请求最高优先级，不受防火墙限制

5. **网络共享与多屏协同**：
   - WiFi 直连（WiFi Direct）：设备间直接通信
   - 网络共享：手机网络共享给其他设备
   - 多屏协同：与其他奇点OS 设备的网络发现和连接（UDP 广播发现 + TCP 连接）

6. **网络状态监控**：
   - 实时监控网络状态（连接类型、信号强度、速度、流量）
   - 流量统计：按应用统计流量使用
   - 网络异常检测：断网、高延迟、丢包
   - 通知应用网络变化

7. **与 AI.qd 的关系**：
   - AI.qd 网络请求最优先
   - AI.qd 可动态调整网络策略（如低电量时限制后台应用网络）
   - 网络异常时通知 AI.qd，AI.qd 决定是否切换网络

### 9.9 时间同步与区域设置

**定位**：管理系统时间、时区、日期格式、语言、区域设置。**没有这个，系统时间不准、应用显示乱码。**

**模块位置**：`/系统/功能.qd/时间与区域.qd/`

**核心功能**：

1. **时间同步**：
   - NTP 客户端：通过网络同步系统时间（pool.ntp.org 或自定义 NTP 服务器）
   - RTC：读取硬件实时时钟，启动时设置系统时间
   - 自动同步：WiFi/网络连接后自动同步
   - 手动设置：用户可手动设置时间（关闭自动同步时）
   - 时间精度：毫秒级

2. **时区管理**：
   - 时区数据库（tzdata）：全球所有时区
   - 自动时区：根据网络位置（NTP 扩展或地理定位）自动设置时区
   - 手动选择：用户可手动选择时区
   - 夏令时：自动处理夏令时切换

3. **语言与国际化（i18n）**：
   - 多语言支持：系统界面支持多种语言（中文、英文等）
   - 翻译文件：gettext 格式，每个模块有自己的翻译文件
   - 语言切换：设置里切换语言，实时生效（不需要重启）
   - 应用语言：应用可独立设置语言，或跟随系统
   - 输入法语言：根据系统语言推荐输入法

4. **区域设置（locale）**：
   - 日期格式：YYYY-MM-DD / MM/DD/YYYY / DD/MM/YYYY
   - 时间格式：24小时制 / 12小时制
   - 货币符号：人民币、美元等
   - 数字格式：千位分隔符、小数点
   - 测量单位：公制 / 英制
   - 首选项：用户可自定义各项

5. **字体与文本渲染**：
   - 系统字体：默认中文字体（如思源黑体）+ 英文字体
   - 字体回退：缺失字符时自动回退到其他字体
   - 字体渲染：freetype + harfbuzz，支持复杂文字（阿拉伯文、印地文等）
   - 字体大小：系统级字体大小调节（小/中/大/超大）

6. **与 AI.qd 的关系**：
   - AI.qd 根据系统语言用对应语言回复
   - AI.qd 根据时区知道当前时间（解决用户之前反馈的"AI不知道几点"的问题）
   - AI.qd 可根据区域设置调整回复格式（日期、货币等）

### 9.10 系统公共服务（通知、剪贴板、分享、搜索）

**定位**：系统级公共服务，所有应用都可以调用。**这些是正常系统的标配，缺失会严重影响用户体验和应用开发。**

#### 9.10.1 通知系统

**模块位置**：`/系统/界面.qd/通知中心.qd/`

**核心功能**：
- **通知发送**：应用通过 API 发送通知（标题、内容、图标、优先级、操作按钮）
- **通知中心**：统一展示所有通知，按时间排序，可分组（按应用）
- **通知优先级**：
  - `LOW`：低优先级，不响铃不震动，折叠显示
  - `DEFAULT`：默认，响铃或震动
  - `HIGH`：高优先级，横幅显示，响铃震动
  - `CRITICAL`：紧急，全屏显示（如来电、闹钟）
- **通知操作**：用户可对通知执行操作（回复、删除、标记已读、打开应用）
- **通知渠道**：应用可创建多个通知渠道（如"消息"、"促销"、"系统"），用户可单独管理每个渠道的开关和优先级
- **免打扰模式**：用户可设置免打扰时间段，期间只允许高优先级通知
- **锁屏通知**：锁屏时显示通知（可设置隐藏内容）
- **通知历史**：已清除的通知保留一段时间，可查看历史
- **AI.qd 通知**：AI.qd 可发送系统级通知（如"系统已更新"、"检测到异常，已自动修复"）

#### 9.10.2 剪贴板

**模块位置**：`/系统/功能.qd/剪贴板.qds`

**核心功能**：
- **系统剪贴板**：全局唯一的剪贴板，所有应用共享
- **数据类型**：文本、HTML、图片、文件路径、URI、自定义数据
- **复制/粘贴 API**：应用通过 API 读写剪贴板
- **剪贴板历史**：记录最近的剪贴板内容（默认 50 条），用户可查看和选择历史内容粘贴
- **剪贴板监听**：应用可监听剪贴板变化（需声明权限）
- **安全**：
  - 敏感内容（密码、验证码）应用可标记为"敏感"，不记录到历史，不显示预览
  - 后台应用读取剪贴板需要权限（防止应用偷取剪贴板内容）
  - AI.qd 可读取剪贴板（最高权限）
- **跨设备剪贴板**：多屏协同时，奇点OS 设备间可共享剪贴板（复制到手机，粘贴到平板）

#### 9.10.3 分享系统

**模块位置**：`/系统/功能.qd/分享.qds`

**核心功能**：
- **分享面板**：应用调用分享 API，弹出系统分享面板，显示所有可接收该类型数据的应用
- **数据类型**：文本、链接、图片、视频、文件、联系人、位置
- **分享目标**：所有注册了分享接收的应用都显示在分享面板中
- **直接分享**：常用分享目标直接显示在面板顶部（如最近联系的好友）
- **分享接收**：应用可注册为某种数据类型的接收者，用户分享时可选择该应用
- **AI 分享**：用户可分享内容给 AI.qd，AI 直接处理（如分享一段文字给 AI 翻译/总结）

#### 9.10.4 全局搜索

**模块位置**：`/系统/功能.qd/搜索.qd/`

**核心功能**：
- **系统级搜索**：用户可从任意界面唤出全局搜索（如下拉搜索）
- **搜索范围**：
  - 应用：已安装的应用
  - 联系人：通讯录联系人
  - 文件：用户文档、下载的文件
  - 设置：系统设置项
  - 消息：聊天记录（需应用支持）
  - 网络：网络搜索（通过 AI.qd 或默认搜索引擎）
  - AI：直接向 AI 提问
- **搜索索引**：建立本地索引，加速搜索（文件、应用、设置）
- **实时搜索**：输入时实时显示结果
- **搜索建议**：根据输入历史和常用内容给出建议
- **应用搜索接入**：应用可注册搜索提供者，将自己的内容纳入全局搜索（如微信注册后可搜索聊天记录）

### 9.11 音频系统

**定位**：统一的音频服务，管理所有音频输入输出。**没有音频系统，应用无法播放声音、无法录音。**

**模块位置**：`/系统/功能.qd/音频系统.qd/`
```
/系统/功能.qd/音频系统.qd/
├─ qdaudio.qds         # 音频守护进程（音频路由、混音、音量控制）
├─ audio_hal.qds       # 音频 HAL（封装 ALSA/OSS）
└─ audio_ai.qdai       # AI规则（音频焦点、路由策略）
```

**核心功能**：

1. **音频架构**：
   - 基于 PipeWire 或 PulseAudio 封装（成熟方案，不算套壳，封装成模块）
   - 应用通过统一 API 播放/录制音频，不直接访问硬件
   - 音频守护进程负责混音、路由、音量控制

2. **音频设备**：
   - 输出设备：扬声器、耳机（有线/蓝牙）、HDMI/DisplayPort 音频
   - 输入设备：内置麦克风、耳机麦克风、USB 麦克风
   - 设备切换：插入耳机时自动切换输出，拔出时自动切回扬声器
   - 蓝牙音频：A2DP（高质量音频）、HFP（通话音频）、LDAC/aptX（高清）

3. **音频流管理**：
   - 每个应用的音频是独立的音频流
   - 支持多流同时播放（混音）
   - 音频流类型：媒体（音乐/视频）、语音（通话）、通知、闹钟、系统音效
   - 每个流类型有独立的音量控制

4. **音量控制**：
   - 系统级音量：媒体音量、通话音量、闹钟音量、通知音量
   - 应用级音量：每个应用可独立调节音量
   - 音量步进：默认 15 级，可调节
   - 最大音量保护：防止音量过大损伤听力（可关闭）

5. **音频焦点**：
   - 类似安卓的 AudioFocus
   - 多个应用同时播放时，高优先级的应用获得音频焦点
   - 优先级：通话 > 闹钟 > 语音导航 > 媒体 > 通知
   - 失去焦点的应用：暂停播放（媒体）、降低音量（ducking）、继续静音播放
   - AI.qd 可干预音频焦点分配

6. **录音**：
   - 应用需要麦克风权限才能录音
   - 录音格式：PCM、AAC、Opus
   - 录音源：麦克风、通话录音（需特殊权限）、内部音频（系统声音）
   - 录音时系统显示录音指示器（状态栏红点），保护隐私

7. **低延迟音频**：
   - 支持低延迟模式（音乐制作、游戏）
   - 延迟目标：<20ms（最优）
   - 通过 JACK 或 PipeWire 的实时模式实现

8. **音效**：
   - 均衡器（EQ）：系统级均衡器，预设多种模式
   - 空间音效：虚拟环绕声
   - 降噪：通话降噪、环境降噪
   - AI 音效：AI.qd 可根据内容自动调整音效（如电影模式、音乐模式）

### 9.12 传感器与位置服务

**定位**：统一管理所有传感器和位置服务。**移动系统的核心功能，缺失会导致大量应用无法正常工作。**

**模块位置**：`/系统/功能.qd/传感器.qd/` + `/系统/功能.qd/位置服务.qd/`

**传感器核心功能**：

1. **传感器类型**：
   - 运动传感器：加速度计、陀螺仪、重力传感器、线性加速度
   - 环境传感器：光线传感器、距离传感器、气压计、温度传感器、湿度传感器
   - 位置传感器：磁力计（电子罗盘）、GPS
   - 生物传感器：心率传感器、血氧传感器、指纹传感器
   - 其他：步数计数器、倾斜检测器、旋转矢量传感器

2. **传感器管理**：
   - 传感器枚举：列出设备上所有可用传感器
   - 传感器读取：应用可注册传感器监听器，按指定频率接收数据
   - 采样率：低（5Hz）、中（20Hz）、高（50Hz）、最快（设备支持的最高）
   - 批量模式：传感器数据批量上报，降低功耗
   - 传感器融合：加速度计+陀螺仪+磁力计融合，输出稳定的姿态角

3. **功耗优化**：
   - 应用在后台时自动降低传感器采样率或停止
   - 墓碑机制冻结应用时，传感器监听自动暂停
   - 批量模式减少 CPU 唤醒次数
   - AI.qd 可根据应用状态动态调整传感器采样率

4. **传感器校准**：
   - 磁力计校准：用户画"8"字校准
   - 加速度计校准：水平放置校准
   - 陀螺仪校准：静止时自动校准零偏

**位置服务核心功能**：

1. **定位方式**：
   - GPS：高精度定位（户外），功耗较高
   - 网络定位：WiFi/基站定位（室内/城市），功耗低，精度较低
   - 融合定位：GPS+网络+传感器融合，最优精度和功耗
   - 被动定位：应用不主动请求定位，其他应用请求时被动接收

2. **定位权限**：
   - 精确定位：GPS 级精度
   - 粗略定位：城市级精度（网络定位）
   - 前台定位：应用在前台时才能定位
   - 后台定位：应用在后台也能定位（需特殊权限，AI.qd 审核）
   - 运行时权限：用户可随时撤销定位权限

3. **地理围栏**：
   - 应用可注册地理围栏（圆形区域）
   - 设备进入/离开围栏时通知应用
   - 低功耗地理围栏：用基站+WiFi粗略检测，不持续开 GPS

4. **活动识别**：
   - 基于传感器识别用户活动：静止、步行、跑步、骑车、乘车
   - 低功耗活动识别：用硬件协处理器（如果有）

5. **与 AI.qd 的关系**：
   - AI.qd 可读取传感器和位置数据（最高权限）
   - AI.qd 可根据位置自动调整系统行为（如到公司自动切换工作模式）
   - AI.qd 可根据活动状态调整性能策略（如跑步时降低后台应用优先级）

### 9.13 电源管理详细设计

**定位**：比 15.5 节更详细的电源管理，包括休眠/挂起/唤醒/温控/功耗统计。

**模块位置**：`/系统/功能.qd/电源管理.qd/`

**核心功能**：

1. **电源状态**：
   - 正常运行：全功能
   - 省电模式：限制后台活动、降低性能、关闭非必要服务
   - 超级省电：只保留电话/短信/AI.qd，关闭所有应用和网络
   - 休眠（Suspend to RAM）：内存保持供电，CPU 停止，唤醒快（<1s）
   - 深度休眠（Suspend to Disk）：内存写入磁盘，完全断电，唤醒慢（类似 hibernate）
   - 关机：完全断电

2. **自动休眠**：
   - 用户无操作一段时间后自动休眠（可设置：15秒/30秒/1分钟/5分钟/永不）
   - 休眠前通知应用，应用可保存状态
   - 有后台任务（如下载、导航）时不自动休眠
   - AI.qd 可阻止休眠（如 AI 正在执行重要任务）

3. **唤醒源**：
   - 电源键、触摸屏、键盘、鼠标
   - 闹钟、定时任务
   - 来电、消息（WiFi/移动网络唤醒）
   - USB 插入/拔出
   - 传感器（如抬起唤醒）
   - AI.qd 可设置定时唤醒（如每30分钟唤醒检查更新）

4. **唤醒锁（Wake Lock）**：
   - 应用可申请唤醒锁，阻止系统休眠（如播放视频、导航）
   - 唤醒锁类型：
     - 部分唤醒锁：CPU 保持运行，屏幕关闭（如后台播放音乐）
     - 完整唤醒锁：屏幕保持亮着（如视频播放）
   - 唤醒锁有超时机制，防止应用忘记释放导致耗电
   - AI.qd 可强制释放异常的唤醒锁

5. **电池管理**：
   - 电池信息：电量、健康状态、温度、电压、电流
   - 充电管理：快充、慢充、充电限制（可设置充到80%停止，保护电池）
   - 电池使用统计：按应用统计耗电（CPU、网络、传感器、屏幕）
   - 耗电异常检测：AI.qd 检测异常耗电的应用，通知用户或限制
   - 预计使用时间：根据当前电量和使用习惯估算剩余使用时间

6. **温控（Thermal Throttling）**：
   - 监控 CPU/GPU/电池温度
   - 温度过高时按优先级降频：
     - 轻度过热：降低非核心应用性能
     - 中度过热：降低 CPU/GPU 频率
     - 重度过热：关闭非必要服务，限制充电，提示用户
   - AI.qd 最后降频（保证 AI 基本功能）
   - 温控策略由 AI.qd 制定，执行层实时执行

7. **应用待机（App Standby）**：
   - 长时间未使用的应用进入"待机"状态
   - 待机应用：限制网络访问、延迟任务、限制后台活动
   - 用户打开应用时立即恢复正常
   - 墓碑机制冻结的应用自动进入待机

### 9.14 看门狗（Watchdog）

**定位**：监控系统是否挂死，挂死时自动重启。**没有看门狗，系统卡死了只能拔电池。**

**模块位置**：`/系统/功能.qd/看门狗.qds`

**核心功能**：

1. **硬件看门狗**：
   - 使用 CPU 内置的硬件看门狗定时器
   - 系统定期"喂狗"（重置定时器）
   - 系统挂死时无法喂狗，定时器超时触发硬件复位
   - 硬件看门狗无法被软件禁用（最可靠）

2. **软件看门狗**：
   - 独立的看门狗进程，监控关键系统服务
   - 定期检查：AI.qd 响应、执行层响应、图形栈响应
   - 关键服务无响应时：
     - 第一次：尝试重启该服务
     - 第二次：进入安全模式（只加载核心服务）
     - 第三次：重启系统
   - 看门狗进程自身由硬件看门狗监控

3. **系统响应监控**：
   - 监控系统调用响应时间
   - 监控 UI 帧率（掉帧严重时可能系统挂死）
   - 监控 AI.qd 心跳（AI.qd 定期发送心跳，超时则认为 AI 挂死）
   - 监控关键进程是否存活

4. **死机恢复**：
   - 硬件复位后，系统启动时检测到异常复位
   - 自动收集上次崩溃的日志（如果有）
   - 通知 AI.qd 进行自修复
   - 连续多次异常复位时，自动进入安全模式

### 9.15 配置管理系统

**定位**：统一的系统配置管理，所有系统设置、应用配置都通过统一接口管理。

**模块位置**：`/系统/功能.qd/配置管理.qds`

**核心功能**：

1. **配置存储**：
   - 系统级配置：`/系统/etc/` 目录下的配置文件
   - 用户级配置：`/用户.qd/配置/` 目录下的配置文件
   - 应用级配置：应用自己的配置目录
   - 配置格式：统一使用 JSON（易读、AI 易解析），兼容传统格式（如 ini、conf）

2. **配置 API**：
   - 读取配置：`qd_config_get(key)`
   - 写入配置：`qd_config_set(key, value)`
   - 监听配置变化：`qd_config_watch(key, callback)`
   - 配置变更实时通知所有监听者（不需要轮询）

3. **配置热加载**：
   - 大部分配置修改后立即生效，不需要重启
   - 少数需要重启的配置（如内核参数）修改时提示用户
   - 配置修改经过隔离层保护，防止修改一半导致系统异常

4. **默认配置与重置**：
   - 每个模块有默认配置（打包在模块内）
   - 用户修改的配置覆盖默认配置
   - 用户可重置单个配置或全部配置为默认值
   - 重置前自动备份当前配置

5. **配置版本管理**：
   - 配置变更记录历史（Git 管理）
   - 可回退到任意历史配置
   - AI.qd 可分析配置变更历史，优化配置

6. **AI.qd 与配置**：
   - AI.qd 可读取和修改所有系统配置（最高权限）
   - AI.qd 修改安全策略相关配置需要用户确认
   - AI.qd 可根据使用习惯自动优化配置（如自动调整亮度、音量）
   - 用户可禁用 AI 自动优化

---

## 10. 图形栈

### 10.1 图形栈组成（v1.2 修正：基于 Wayland 标准协议 + wlroots 封装）

```
应用程序
  │ 绘制指令（Wayland 协议）
  ▼
渲染管线（2D/3D渲染）
  │ 渲染结果（帧缓冲）
  ▼
合成器（基于 wlroots 封装，多窗口合成、特效、动画）
  │ 合成后的屏幕帧
  ▼
显示服务器（输出到显示设备，DRM/KMS）
  │
  ▼
物理屏幕
```

### 10.2 各模块职责

| 模块 | 位置 | 职责 | 实现方式 |
|------|------|------|---------|
| 显示服务器 | `/系统/界面.qd/` | 管理显示设备、输出帧缓冲、模式设置 | 自研（基于 Linux DRM/KMS，通过HAL封装） |
| 窗口管理器 | `/系统/界面.qd/窗口管理.qds` | 窗口创建/销毁/布局/焦点/层级/动画 | 自研 |
| 合成器 | `/系统/界面.qd/合成器.qd/` | 多窗口合成、透明度、阴影、转场动画 | 基于 wlroots 封装（依赖打包在模块内），逐步自研 |
| 渲染管线 | `/系统/界面.qd/渲染管线.qds` | 2D矢量渲染、文本渲染、图像绘制 | 自研精简版（可复用 Skia 精简版） |
| 输入管理 | `/系统/界面.qd/` | 触摸/键盘/鼠标事件采集、分发、手势识别 | 自研（基于 HAL 输入接口，逐步替换 libinput） |
| 字体渲染 | `/系统/界面.qd/` | 字体加载、字形渲染、文本布局 | freetype + harfbuzz（封装成 .qd 模块） |
| 主题系统 | `/系统/界面.qd/` | 主题加载、样式管理、深色/浅色模式 | 自研 |

### 10.3 为什么用 Wayland 不算套壳

- Wayland 是一个**协议标准**，不是一个软件
- 就像用 HTTP 协议做网站，不算套壳别人的网站
- 合成器和窗口管理器仍然是自研的
- 用标准协议的好处：现有 Linux Wayland 应用可以直接跑（额外兼容性）
- mini 版跑在容器里没有 Wayland 环境，所以用 Web 界面；刷机版有自研图形栈，用原生界面

### 10.4 wlroots 依赖处理（v1.2 明确）

- 封装成 `/系统/界面.qd/合成器.qd/` 模块，所有依赖（libinput、libevdev、libdrm、libgbm、libxkbcommon）打包在模块内
- 逐步替换依赖：先自研输入处理（替换 libinput），再通过 HAL 封装显示（替换 libdrm）
- 短期基于 wlroots 快速验证，长期完全自研合成器

### 10.5 渲染技术选型

- **2D 渲染**：自研精简渲染器（优先），或复用 Skia 精简版
- **3D 渲染**：OpenGL ES / Vulkan（驱动级，不自研）
- **合成**：基于 wlroots 的硬件合成（OpenGL ES 加速）
- **显示**：Linux DRM/KMS 接口（通过 HAL 封装）

### 10.6 性能目标（v1.2 理性预期）

| 阶段 | 性能目标 |
|------|---------|
| 短期 | 简单界面 60fps，基本交互流畅 |
| 中期 | 视频播放 30fps，简单 2D 游戏流畅 |
| 长期 | 复杂图形和 3D 游戏（不保证） |

---

## 11. 应用运行时与兼容层（ANZ / WDS）

### 11.1 兼容层定位

系统原生兼容 **Windows（WDS）** 和 **安卓（ANZ）** 软件。

- **Linux 兼容**：系统不内置，用户可自行开发模块放在 `/用户.qd/模块/`
- **驱动级程序**：不支持
- **谷歌服务**：ANZ 集成 microG（开源 GMS 兼容实现），但 SafetyNet/Play Integrity 检测的应用可能无法运行

### 11.2 应用安装位置

| 安装方式 | 位置 | 说明 |
|---------|------|------|
| 用户手动安装 | `/用户.qd/应用/` | 用户下载的 exe/apk |
| AI.qd 安装 | `/系统/兼容.qd/` | AI 为系统兼容性安装的运行库 |

### 11.3 WDS（Windows 兼容层）

**位置**：`/系统/兼容.qd/WDS.qd/`

**分三步走实现（v1.2 明确）**：

```
阶段 1：复用成熟技术（能跑起来）
  ├─ 用 Wine（封装成 WDS.qd 内的核心组件）
  ├─ 必须增加 box64 转译层（ARM 上跑 x86 Windows 软件必需）
  ├─ PE 加载器自研
  └─ 目标：能跑简单开源 Windows 软件（记事本、计算器、7-Zip、Notepad++）

阶段 2：逐步替换核心组件（半自研）
  ├─ 替换 Wine 的 API 翻译层为自研（保留 PE 加载器）
  ├─ 替换 Wine 的注册表模拟为自研
  ├─ 优化 box64 性能
  └─ 目标：能跑一些老的、简单的 Windows 软件（WinRAR、旧版Office、小型游戏）

阶段 3：完全自研（长期目标）
  ├─ 完全自研 Win32 API 翻译层
  ├─ 完全自研 GDI/GUI 翻译
  └─ 目标：复杂软件尽力支持，不保证完美运行
```

**组成**：
- PE 文件加载器（pe_parse，自研）
- Win32 API 翻译层（阶段1用Wine，逐步自研）
- Windows 注册表模拟
- Windows 文件系统映射
- GDI/GUI 翻译（将 Windows 绘图翻译成奇点OS 渲染调用）
- box64 转译层（ARM 上跑 x86 软件必需）

**原则**：优先兼容，后稳定。先让更多软件能跑，再慢慢修 bug。

**不支持**：驱动级程序、内核模式程序、需要管理员权限的硬件操作、有强反调试/反虚拟机的软件、DRM 保护的软件。

**兼容性数据库（v1.2 新增）**：
- 建立官方兼容性数据库，记录哪些软件能跑、哪些不能、需要什么配置
- 用户可以提交兼容性报告
- 安装软件前自动查询兼容性数据库，提示用户

**明确预期（v1.2 理性）**：
- 简单开源软件：能跑
- 老的简单软件：尽力支持
- 现代 Office、大型游戏、专业软件：长期目标，不保证完美运行

### 11.4 ANZ（安卓兼容层）

**位置**：`/系统/兼容.qd/ANZ.qd/`

**分三步走实现（v1.2 明确）**：

```
阶段 1：复用成熟技术（能跑起来）
  ├─ 用 Android Runtime（ART，封装成 ANZ.qd 内的核心组件）
  ├─ 集成 microG（开源 GMS 兼容实现）
  ├─ APK 解析器自研
  └─ 目标：能跑开源、无 GMS 依赖的安卓应用（F-Droid 上的应用）

阶段 2：逐步替换核心组件（半自研）
  ├─ 替换 Android Framework 的核心服务为自研
  ├─ 优化 ART 性能
  ├─ 完善 microG 兼容性
  └─ 目标：能跑一些不依赖 GMS 的常用应用

阶段 3：完全自研（长期目标）
  ├─ 完全自研 Dalvik/ART 虚拟机
  ├─ 完全自研 Android Framework
  └─ 目标：依赖 GMS 的应用尽力支持，不保证完美运行
```

**组成**：
- APK 解析器（apk_parse，自研）
- Dalvik/ART 虚拟机（阶段1用AOSP的，逐步自研）
- Android API 翻译层（将 Android API 翻译成奇点OS 调用）
- NDK 原生库支持（运行 C/C++ 原生应用）
- 资源管理、Intent 系统、ContentProvider 模拟
- microG（开源 GMS 兼容实现）

**不支持**：谷歌服务（GMS）原生实现（用 microG 兼容）、SafetyNet/Play Integrity 检测的应用（银行、支付、部分游戏可能无法运行）、有强反篡改的应用。

**兼容性数据库（v1.2 新增）**：同 WDS，建立官方兼容性数据库。

**明确预期（v1.2 理性）**：
- 开源无 GMS 应用：能跑
- 不依赖 GMS 的国产应用：尽力支持
- 银行、支付、依赖 SafetyNet 的应用：可能无法运行

### 11.5 兼容层独立沙箱（v1.2 核心）

> 系统核心优先稳定，兼容层优先兼容（允许崩溃），但兼容层崩溃不影响系统核心。

- WDS 和 ANZ 运行在**独立沙箱进程**中（Linux namespace + seccomp）
- 兼容层有独立的内存限制和 CPU 限制
- 兼容层崩溃时，系统核心不受影响，只是该应用崩溃
- 兼容层的系统调用经过执行层安全检查
- 这样兼容层可以"优先兼容"（允许崩溃），但系统核心"优先稳定"

### 11.6 原生应用 SDK

**位置**：`/系统/` 下提供 QD-SDK

**支持语言**：多语言绑定（C/C++、Rust、Go 等）

**API 分类**：
- 窗口 API：创建窗口、绘制、事件
- 网络 API：HTTP、WebSocket、TCP/UDP
- 文件 API：文件读写、目录操作
- 系统 API：进程、线程、IPC
- AI API：调用 AI.qd 推理、访问统一记忆

---

## 12. 模块化系统

### 12.1 模块加载器

**职责**：
- 读取 .qd 模块目录
- 解析 module.qdmeta 元数据
- 加载 .qds 系统单文件
- 解析依赖关系
- 初始化模块
- 注册模块服务

**加载流程**：
```
扫描模块目录
  │
  ▼
读取 module.qdmeta
  │
  ▼
检查依赖（递归解析）
  │
  ▼
检查权限声明
  │
  ▼
提交 AI.qd 审核（系统模块）/ 直接加载（用户模块）
  │
  ▼
加载 .qds 二进制到内存
  │
  ▼
创建模块进程（沙箱）
  │
  ▼
注册模块服务到服务管理器
  │
  ▼
模块就绪
```

### 12.2 依赖管理

- 依赖在 module.qdmeta 中声明
- 支持版本范围（如 `>=1.0.0`, `<2.0.0`）
- 依赖冲突由 AI.qd 裁决
- 循环依赖禁止

### 12.3 模块沙箱

- 每个模块运行在独立进程
- 文件系统访问通过虚拟文件系统（VFS）重定向（bind mount）
- 系统调用通过 HAL 过滤（seccomp）
- 网络访问需声明权限，经 AI.qd 确认
- 数据直连通道需 AI.qd 授权
- 模块崩溃不影响系统和其他模块

### 12.4 模块热更新

- 支持模块运行时更新（不重启系统）
- 更新流程：下载新版本 → 停止旧模块 → 隔离层保护 → 替换文件 → 启动新模块
- 更新失败自动回滚（通过隔离层和快照）
- 关键系统模块更新需 AI.qd 确认
- 不兼容的变更只在大版本升级时进行，并提供迁移工具

### 12.5 系统更新（OTA）与备份恢复

**定位**：系统级的在线更新（OTA）和备份恢复机制。**没有这个，系统无法升级，出了问题无法恢复。**

**模块位置**：`/系统/功能.qd/系统更新.qd/`

#### 12.5.1 OTA 系统更新

**更新方式**：
- **A/B 分区更新**（推荐，刷机版）：系统有两个系统分区（A 和 B），当前运行在 A，更新下载到 B，更新完成后切换到 B，失败可切回 A
- **整包更新**：下载完整系统镜像，替换系统分区
- **增量更新**：只下载差异部分（基于 bsdiff/rsync），减小下载量
- **模块级更新**：只更新特定 .qd 模块，不需要整包更新（日常更新用这个）

**更新流程**：
```
1. 检查更新
   - AI.qd 定期检查更新服务器（或用户手动检查）
   - 获取更新信息：版本号、更新内容、大小、签名、依赖

2. 下载更新
   - 下载更新包到缓存分区
   - 断点续传（网络中断后继续下载）
   - 下载完成后验证签名和完整性（SHA256）

3. 准备更新
   - 隔离层保护（创建更新隔离区）
   - 备份当前系统状态（关键配置、用户数据）
   - A/B 分区：写入到非活动分区
   - 模块级更新：准备新模块文件

4. 应用更新
   - A/B 分区：切换启动分区，重启后生效
   - 模块级更新：停止旧模块 → 替换文件 → 启动新模块（热更新，不重启）
   - 整包更新：重启进入恢复模式，应用更新

5. 验证更新
   - 重启后验证系统是否正常启动
   - 验证关键服务是否正常运行
   - 验证用户数据是否完整

6. 提交或回滚
   - 成功：提交更新，清理旧版本（A/B 分区标记旧分区为可覆盖）
   - 失败：自动回滚（A/B 分区切回旧分区，模块级更新从隔离层回滚）
   - 连续失败：进入安全模式，提示用户
```

**更新策略**：
- **自动更新**：WiFi 连接 + 充电时自动下载并安装更新（用户可关闭）
- **手动更新**：用户在设置里检查和安装更新
- **定时更新**：用户可设置更新时间（如凌晨 3 点）
- **强制更新**：安全相关的关键更新可强制安装（需用户确认）
- **AI.qd 优先**：AI.qd 模块的更新优先安装，保证 AI 始终最新

**更新服务器**：
- 官方更新服务器：提供官方系统更新
- 第三方更新源：用户可添加第三方更新源（需签名验证）
- 本地更新：用户可从本地文件安装更新（用于开发和离线更新）

**版本管理**：
- 语义化版本：主版本.次版本.修订号（如 1.2.3）
- 更新日志：每个版本附带更新说明（新增功能、修复的 bug、已知问题）
- 历史版本：保留最近 3 个系统版本，可回退
- 兼容性检查：更新前检查设备兼容性，不兼容则拒绝更新

#### 12.5.2 备份与恢复

**备份类型**：
- **完整备份**：备份整个用户数据分区（应用、文档、设置、照片等）
- **选择性备份**：用户选择备份特定内容（如只备份联系人、照片）
- **系统配置备份**：只备份系统设置和配置（不备份应用数据）
- **应用数据备份**：只备份特定应用的数据
- **AI.qd 记忆备份**：备份 AI.qd 的统一记忆库

**备份位置**：
- 本地备份：备份到内部存储或 SD 卡/U盘
- 云端备份：备份到云端（用户可选择云服务商）
- 跨设备备份：通过多屏协同备份到另一台奇点OS 设备
- AI.qd 独立存储：关键备份同时存到 AI.qd 独立存储（系统崩坏时可恢复）

**备份流程**：
```
用户发起备份
  ↓
选择备份类型和内容
  ↓
选择备份位置
  ↓
隔离层保护（创建备份隔离区，防止备份过程中数据变化）
  ↓
打包数据（tar.zst 压缩）
  ↓
加密（用户密码或系统密钥，AES-256）
  ↓
计算校验和（SHA256）
  ↓
写入备份位置
  ↓
验证备份完整性
  ↓
完成，通知用户
```

**恢复流程**：
```
用户发起恢复
  ↓
选择备份文件
  ↓
验证签名和完整性
  ↓
输入密码解密（如果加密）
  ↓
预览备份内容（用户可选择恢复哪些）
  ↓
隔离层保护（创建恢复隔离区）
  ↓
备份当前数据（防止恢复失败丢失现有数据）
  ↓
恢复数据
  ↓
验证恢复完整性
  ↓
重启（系统配置变更需要重启）
  ↓
完成，通知用户
```

**自动备份**：
- 定时自动备份（用户可设置频率：每天/每周/每月）
- 充电 + WiFi 时自动备份
- 重大系统更新前自动备份
- AI.qd 可根据使用习惯自动调整备份策略

**备份管理**：
- 备份列表：查看所有备份（时间、大小、内容、位置）
- 备份删除：删除旧备份（自动清理最旧的，保留最近 5 个）
- 备份加密：所有备份默认加密（用户密码保护）
- 备份校验：定期验证备份完整性，损坏的备份标记并提示

**与自修复的关系**：
- 系统崩坏时，AI.qd 可从最近的备份恢复
- 自修复失败时，提示用户从备份恢复
- 备份是自修复的最后一道防线

---

## 13. 通信协议（QD-IPC）

### 13.1 协议选型

使用当前最成熟的方案：**Unix Domain Socket + 共享内存**

- 控制消息：Unix Domain Socket（可靠、有序）
- 大数据传输：共享内存（高性能、零拷贝）
- 事件通知：信号量或 eventfd

### 13.2 双通道架构

详见 [5.5 模块间调用规则](#55-模块间调用规则v12-双通道) 和 [第6章 直接传输模块](#6-aiqd-直接传输模块)。

### 13.3 消息格式

```
QD-IPC 消息结构：
┌──────────────────────────────────────┐
│ 消息头（32 字节）                      │
│  ├─ magic: 0x51444950 ("QDIP")      │
│  ├─ version: 协议版本                 │
│  ├─ type: 请求/响应/事件              │
│  ├─ service_id: 目标服务ID            │
│  ├─ opcode: 操作码                    │
│  ├─ request_id: 请求ID（匹配响应）    │
│  ├─ sender_pid: 发送者PID             │
│  ├─ payload_size: 负载长度            │
│  └─ flags: 标志位（是否用共享内存）   │
├──────────────────────────────────────┤
│ 消息负载（变长）                        │
│  - 小数据：直接在 socket 中传输        │
│  - 大数据：共享内存ID + 偏移 + 长度    │
└──────────────────────────────────────┘
```

### 13.4 通信流程

**控制通道（经 AI.qd）**：
```
模块A → QD-IPC 请求 → AI.qd
AI.qd 检查权限/依赖/安全性
AI.qd → QD-IPC 请求 → 模块B
模块B 执行，返回结果
模块B → QD-IPC 响应 → AI.qd
AI.qd → QD-IPC 响应 → 模块A
```

**数据通道（直连，经直接传输模块授权和管理）**：
```
模块A ←→ 共享内存/UNIX Socket ←→ 模块B
（不经 AI.qd，执行层实时监控，AI.qd 空闲抽查）
```

### 13.5 错误码

| 错误码 | 含义 |
|-------|------|
| 0 | 成功 |
| 1 | 无效参数 |
| 2 | 服务不存在 |
| 3 | 权限不足 |
| 4 | 依赖缺失 |
| 5 | 资源不足 |
| 6 | 超时 |
| 7 | 模块崩溃 |
| 8 | 版本不兼容 |
| 9 | AI.qd 拒绝 |
| 10 | 直连通道未授权 |
| 11 | 隔离层冲突 |
| 12 | HAL 调用失败 |
| 13 | IPC 通信失败 |
| 14 | 存储空间满 |
| 15 | 设备错误 |
| 16 | 网络错误 |
| 17 | 未知错误 |

---

## 14. 存储与文件系统

### 14.1 分区结构（刷机版）

```
┌─────────────────────────────────────┐
│ boot 分区（内核 + ramdisk）           │
├─────────────────────────────────────┤
│ system 分区（系统模块，只读）          │
│  - /系统/ 目录                        │
│  - /AI.qd/ 目录                       │
├─────────────────────────────────────┤
│ userdata 分区（用户数据，可写）        │
│  - /用户.qd/ 目录                     │
│  - 统一记忆库                          │
├─────────────────────────────────────┤
│ cache 分区（临时缓存）                 │
├─────────────────────────────────────┤
│ AI.qd 独立存储（恢复/备份用）          │
└─────────────────────────────────────┘
```

### 14.2 目录权限

| 目录 | 所有者 | 权限 |
|------|-------|------|
| `/系统/` | AI.qd | 只读（用户不可写，AI.qd 可写，修改需经隔离层） |
| `/AI.qd/` | AI.qd | 仅 AI.qd 可读写 |
| `/用户.qd/` | 用户 | 用户可读写，AI.qd 可读写 |
| `/tmp/` | 所有 | 所有进程可读写（临时，不隔离） |

### 14.3 文件系统类型

- 系统分区：ext4（只读挂载）或 squashfs（压缩只读）
- 用户分区：ext4 或 f2fs（适合闪存）
- 外部存储：FAT32/exFAT（SD卡/U盘）

### 14.4 模块存储位置

- **AI.qd 安装的模块**：`/系统/` 目录下
- **用户安装/开发的模块**：`/用户.qd/模块/` 目录下
- **用户安装的应用**：`/用户.qd/应用/` 目录下
- **外部存储模块**：SD卡/U盘上的模块可被识别和加载（不做限制）

### 14.5 文件系统层次结构（FHS）详细定义

**定位**：定义系统中每个标准目录的用途、权限、内容。**开发时必须遵守，文件不能乱放。**

奇点OS 有自己的顶层目录结构（/系统、/AI.qd、/用户.qd），但同时保留 Linux 标准目录（/bin、/etc、/var、/tmp 等）用于兼容和系统运行。

```
/
├─ 系统/                    # 系统模块目录（AI.qd 安装的模块）
│  ├─ 兼容.qd/              # 兼容层（WDS/ANZ）
│  ├─ 功能.qd/              # 系统核心功能（进程、内存、IPC、墓碑、日志等）
│  ├─ 界面.qd/              # 图形界面（窗口、渲染、合成、通知）
│  └─ 微服务.qd/            # 低功耗常驻服务（网络、投屏等）
│
├─ AI.qd/                   # 全局AI总模块（最高权限）
│  ├─ ai_service.qds        # AI推理服务
│  ├─ ai_controller.qds     # AI控制器
│  ├─ ai_daemon.qds         # AI守护进程
│  ├─ 推理引擎.qd/           # MNN/llama.cpp统一封装
│  └─ *.qdai                # AI规则文件
│
├─ 用户.qd/                  # 用户数据目录（用户安装/开发的所有内容）
│  ├─ 应用/                  # 用户安装的应用（Windows exe、安卓apk）
│  ├─ 模块/                  # 用户开发的模块（如Linux兼容.qd）
│  ├─ 文档/                  # 用户文档
│  ├─ 下载/                  # 下载目录
│  ├─ 图片/                  # 图片
│  ├─ 视频/                  # 视频
│  ├─ 音乐/                  # 音乐
│  ├─ 配置/                  # 用户级配置
│  ├─ 应用状态/              # 应用状态保存（墓碑机制用）
│  └─ 应用数据/              # 各应用的私有数据（按应用ID分子目录）
│
├─ bin/                     # 系统基础命令（ls、cp、mv等，busybox/toybox）
├─ sbin/                    # 系统管理命令（需要管理员权限）
├─ lib/                     # 系统共享库（musl libc、基础库）
├─ lib64/                   # 64位共享库
├─ etc/                     # 系统级配置文件（全局配置）
│  ├─ qd-os/                # 奇点OS 系统配置
│  ├─ network/              # 网络配置
│  ├─ audio/                # 音频配置
│  └─ ...
├─ var/                     # 可变数据（运行时生成的）
│  ├─ log/                  # 系统日志（qdlog/、coredump/）
│  ├─ run/                  # 运行时数据（PID文件、socket、临时状态）
│  ├─ cache/                # 系统缓存
│  ├─ tmp/                  # 临时文件（重启保留）
│  └─ lib/                  # 系统服务的持久化数据
├─ tmp/                     # 临时文件（重启清空，所有进程可读写）
├─ dev/                     # 设备节点（由设备管理服务动态创建）
│  ├─ input/                # 输入设备
│  ├─ dri/                  # 显示设备（DRM）
│  ├─ snd/                  # 音频设备
│  └─ ...
├─ proc/                    # 进程信息（虚拟文件系统，内核提供）
├─ sys/                     # 系统信息（虚拟文件系统，内核提供）
├─ run/                     # 运行时临时文件（早期启动用，/var/run的链接）
├─ mnt/                     # 挂载点（外部存储、网络存储）
├─ media/                   # 可移动媒体（SD卡、U盘自动挂载点）
├─ opt/                     # 可选软件（第三方大型软件）
├─ usr/                     # 用户程序和数据（只读，系统安装的）
│  ├─ bin/                  # 用户命令
│  ├─ lib/                  # 用户库
│  ├─ share/                # 共享数据（字体、图标、文档、locale）
│  │  ├─ fonts/             # 系统字体
│  │  ├─ icons/             # 系统图标
│  │  ├─ locale/            # 多语言翻译
│  │  └─ qd-os/             # 奇点OS 共享资源
│  ├─ include/              # 头文件（开发用）
│  └─ src/                  # 源代码（可选）
├─ boot/                    # 启动文件（内核、initramfs、bootloader配置）
├─ root/                    # root用户主目录（AI.qd 恢复模式用）
└─ home/                    # 用户主目录（多用户时用，单用户时链接到 /用户.qd/）
```

**关键目录权限**：

| 目录 | 所有者 | 权限 | 说明 |
|------|-------|------|------|
| `/系统/` | AI.qd | 只读挂载，AI.qd 可写（需经隔离层） | 系统模块，用户不可直接修改 |
| `/AI.qd/` | AI.qd | 仅 AI.qd 可读写 | 最高权限目录 |
| `/用户.qd/` | 用户 | 用户可读写，AI.qd 可读写 | 用户数据 |
| `/bin/` `/sbin/` `/lib/` `/usr/` | root | 只读 | 系统基础文件 |
| `/etc/` | root | 管理员可写 | 系统配置 |
| `/var/` | root | 服务可写 | 可变数据 |
| `/tmp/` | 所有 | 所有可读写 | 临时文件，重启清空 |
| `/dev/` | root | 设备管理服务动态创建 | 设备节点 |
| `/mnt/` `/media/` | root | 可移动设备挂载点 | 外部存储 |

**应用私有数据目录**：
- 每个应用有独立的私有数据目录：`/用户.qd/应用数据/<应用ID>/`
- 应用只能访问自己的私有数据目录（沙箱隔离）
- 应用卸载时，私有数据目录可选择保留或删除
- AI.qd 可访问所有应用的私有数据（最高权限）

### 14.6 临时文件与运行时目录

**临时文件分类**：
- `/tmp/`：所有进程可读写，重启清空，不经过隔离层
- `/var/tmp/`：重启保留，用于需要跨重启的临时文件
- `/var/run/`：运行时数据（PID文件、socket、锁文件），重启清空
- 应用私有临时目录：`/用户.qd/应用数据/<应用ID>/tmp/`，应用卸载时删除

**临时文件清理**：
- `/tmp/` 重启自动清空
- 长时间未访问的临时文件自动清理（默认7天）
- 存储空间不足时优先清理临时文件
- AI.qd 可手动清理临时文件

**运行时目录**：
- 系统服务的 PID 文件：`/var/run/<服务名>.pid`
- QD-IPC socket：`/var/run/qd-ipc/`
- 直接传输通道：`/var/run/qd-direct/`
- 墓碑管理状态：`/var/run/qd-tombstone/`
- 这些目录由对应服务创建和管理，重启后重新创建

---

## 15. 性能调度

### 15.1 调度原则

- AI.qd 优先：所有资源优先分配给 AI.qd（策略层面）
- 用户可配置：充电/电池调度策略由用户在设置中确定
- 动态调整：AI.qd 根据负载动态调整资源分配策略
- 实时执行：系统服务执行层用确定性算法实时执行

### 15.2 CPU 调度

- AI.qd 进程绑定大核 + 部分小核，保证独立推理性能
- 其他模块的 CPU 使用策略需经 AI.qd 确认
- 实时调度由系统服务执行层的 CFS 调度器完成（微秒级）
- 前台应用优先，后台应用限制
- 温度过高时按优先级降频（AI.qd 最后降）

### 15.3 内存调度

- AI.qd 最低内存保证（不可被回收）
- 其他模块内存按需分配，OOM 时按优先级回收
- 统一记忆库占用单独内存区域
- 低内存时 AI.qd 可主动回收后台模块内存（策略决策，执行层执行）

### 15.4 IO 调度

- AI.qd 存储访问优先级最高（IO 调度器最高优先级）
- AI.qd 网络请求最优先
- 前台应用 IO 优先于后台
- 批量 IO 合并，减少闪存写入

### 15.5 电源管理

- 充电时：性能模式（用户可配置）
- 电池时：平衡模式（用户可配置）
- 低电量（<20%）：省电模式，AI.qd 保持基础性能，其他模块大幅限制
- 休眠时：AI.qd 可保持运行（监听唤醒事件），其他模块暂停

### 15.6 墓碑机制（后台应用管理）

**定位**：类似 iOS 的墓碑机制，应用进入后台后冻结进程（不消耗CPU），保留内存状态；内存不足时按 LRU 顺序杀死后台应用并保存状态到磁盘（墓碑），用户切回时解冻或从墓碑恢复。

**设计原则**：AI.qd 做策略决策（谁该冻结/解冻/杀死、内存阈值、优先级排序），执行层（墓碑管理服务）做实时操作（cgroup 冻结/解冻、状态保存/恢复、内存回收）。

**模块位置**：`/系统/功能.qd/墓碑管理.qd/`
```
/系统/功能.qd/墓碑管理.qd/
├─ module.qdmeta          # 模块元数据
├─ tombstone.qds          # 墓碑管理主程序（冻结/解冻/状态保存/内存回收）
├─ app_state.qds          # 应用状态保存/恢复引擎
└─ tombstone_ai.qdai      # AI规则（冻结策略、内存阈值、优先级算法）
```

#### 15.6.1 进程冻结/解冻（cgroup v2 freezer）

使用 Linux 内核原生的 cgroup v2 freezer 控制器：

```
应用进入后台
  ↓
墓碑管理服务把应用进程移到 "frozen" cgroup
  ↓
写入 cgroup.freeze = 1
  ↓
内核冻结进程（停止CPU执行，内存保留）
  ↓
应用完全不耗电，不占CPU

用户切回应用
  ↓
墓碑管理服务把进程移回 "active" cgroup
  ↓
写入 cgroup.freeze = 0
  ↓
内核解冻进程，应用从上次状态继续运行
```

**为什么用 cgroup freezer**：可以冻结整个进程组（包括子进程、线程），无信号副作用，原子操作，内核原生支持稳定可靠。

#### 15.6.2 状态保存（墓碑）

分两级：

**第一级：应用级状态保存（所有应用必须实现）**
- 系统提供 `qd_app_save_state()` / `qd_app_restore_state()` API
- 应用进入后台被冻结前，系统调用 save_state，应用序列化保存UI状态、用户数据、滚动位置等到磁盘
- 用户切回时，系统调用 restore_state，应用恢复状态
- 类似 iOS 的 UIStateRestoring 协议

**第二级：进程级快照（可选，用于复杂应用）**
- 使用 CRIU（Checkpoint/Restore In Userspace）做完整进程快照
- 保存完整内存状态、文件描述符、网络连接等
- 恢复时不需要应用自己实现状态保存
- 对有设备文件、特殊网络连接的进程支持有限
- 作为高级选项，应用在 module.qdmeta 中声明使用

**保存位置**：`/用户.qd/应用状态/<应用ID>/`

#### 15.6.3 后台模式（白名单机制）

不是所有应用都能被完全冻结，需要在后台继续运行的应用声明后台模式：

| 后台模式 | 说明 | 示例 |
|---------|------|------|
| `audio` | 后台音频播放 | 音乐播放器、播客 |
| `location` | 后台位置更新 | 导航、运动记录 |
| `download` | 后台下载 | 浏览器、应用商店 |
| `voip` | 网络电话 | 通话应用 |
| `newsstand` | 后台内容更新 | 新闻、邮件 |
| `bluetooth` | 后台蓝牙通信 | 智能穿戴设备 |

应用在 `module.qdmeta` 中声明：
```json
{ "background_modes": ["audio", "download"] }
```

AI.qd 审核后台模式声明是否合理（如计算器声明 audio 会被拒绝），审核通过后应用对应模式的代码可在后台继续运行，其他代码仍被冻结。

#### 15.6.4 内存管理与回收

```
内存充足（<80%）：
  前台应用：正常运行
  后台应用：冻结，内存保留（切回秒开）
  墓碑应用（已杀死）：不占内存，只占磁盘

内存警告（80%~95%）：
  AI.qd 决定回收策略
  执行层按 LRU（最近最少使用）顺序：
    1. 杀死最久未用的后台应用（冻结状态）
    2. 杀死前调用应用的状态保存API（保存墓碑）
    3. 释放内存
    4. 应用进入"墓碑"状态（点击从状态恢复）

内存危险（>95%）：
  紧急回收：
    1. 杀死除前台应用和系统服务外的所有后台应用
    2. 不保存状态（紧急情况直接杀）
    3. 通知 AI.qd 做后续处理
```

**优先级排序**（从高到低，高的不被杀）：
1. AI.qd 自身（永不冻结永不杀死）
2. 系统核心服务（HAL、执行层、墓碑管理、闪退保护）
3. 前台应用
4. 有后台模式的应用（按模式重要性排序）
5. 最近使用的后台应用（冻结）
6. 较久未用的后台应用（冻结，优先回收）
7. 墓碑应用（已杀死）

#### 15.6.5 进程优先级与资源限制

| 资源 | 前台应用 | 后台应用（冻结） | 墓碑应用 |
|------|---------|----------------|---------|
| CPU | 正常份额，高优先级 | 0（冻结不执行） | 无 |
| 内存 | 优先分配，可增长 | 保留但可回收 | 无 |
| IO | 高优先级 | 冻结无IO | 无 |
| 网络 | 正常 | 冻结无网络（后台模式除外） | 无 |

使用 cgroup v2 的 cpu、memory、io 控制器管理。

#### 15.6.6 唤醒机制

后台应用被冻结后，通过以下方式响应事件：

1. **后台任务API（限时执行）**：应用申请有限后台执行时间（默认30秒），用于完成正在进行的操作，时间到自动冻结。API：`qd_begin_background_task()` / `qd_end_background_task()`
2. **推送唤醒**：系统收到推送后短暂解冻对应应用（最多10秒），应用处理推送更新通知，处理完重新冻结
3. **后台模式持续运行**：声明了后台模式的应用，对应模式的代码持续运行（如音频播放线程），系统严格限制资源使用
4. **定时唤醒（未来扩展）**：应用申请定时唤醒，AI.qd 统一调度合并多个应用的唤醒时间，减少唤醒次数

#### 15.6.7 应用适配要求

**必须实现**：
1. 在 `module.qdmeta` 声明后台模式（如需要）
2. 实现 `qd_app_save_state()` —— 保存UI状态和用户数据
3. 实现 `qd_app_restore_state()` —— 恢复状态

**可选实现**：
1. 声明使用 CRIU 进程级快照
2. 实现后台任务API
3. 实现推送处理回调

**不适配的应用（WDS/ANZ 兼容层内的 Windows/安卓应用）**：
- 系统尝试用 CRIU 做进程级快照（如支持）
- 不支持的直接杀死，下次冷启动
- WDS/ANZ 兼容层封装状态保存API，自动保存窗口位置、打开的文件等

#### 15.6.8 与现有架构的关系

- **AI.qd**：制定冻结策略、内存阈值、优先级排序、后台模式审核，写在 `tombstone_ai.qdai`
- **执行层**：`tombstone.qds` 实际执行冻结/解冻/状态保存/内存回收，实时操作不依赖 AI
- **直接传输模块**：后台应用冻结后直连通道自动暂停，解冻后恢复
- **隔离层**：状态保存操作经过隔离层，防止保存过程异常中断导致状态文件损坏
- **闪退保护**：墓碑管理服务自身崩溃时，闪退保护重启它，所有应用自动解冻（安全降级）
- **统一记忆**：应用使用频率、上次使用时间等数据存入统一记忆，AI.qd 用于优化优先级排序

---

## 16. 安全与权限

### 16.1 权限模型

- **AI.qd**：最高权限，可访问所有资源（策略决策层，所有操作经执行层安全检查）
- **用户**：可访问用户目录，可配置系统设置，可制定安全策略限制 AI.qd
- **系统模块**：仅访问声明的权限范围内的资源
- **用户模块**：仅访问用户目录 + 声明的权限
- **第三方 AI**：所有访问经 AI.qd 中转，无直接系统访问权

### 16.2 用户限制 AI.qd

- 用户可通过 .qdai 规则文件制定安全策略，限制 AI.qd 的访问范围
- 安全策略由**执行层强制执行**，不是 AI.qd 自愿遵守
- AI.qd 修改安全策略需要**用户确认**（弹窗/密码）
- AI.qd 读到限制文件就自动回避，同时执行层强制执行（双重保障）
- 限制不降低 AI.qd 的权限等级，只是 AI.qd 主动回避 + 执行层强制

### 16.3 模块沙箱

- 每个模块运行在独立进程（Linux namespace）
- 文件系统访问通过虚拟文件系统（VFS）重定向（bind mount）
- 系统调用通过 HAL 过滤（seccomp）
- 网络访问需声明权限，经 AI.qd 确认
- 数据直连通道需 AI.qd 授权，三层安全保障
- 模块崩溃不影响系统和其他模块

### 16.4 第三方 AI 安全

- 第三方 AI（如豆包）无直接系统访问权
- 文件访问：经 AI.qd 中转，AI.qd 可审计和过滤
- 网络访问：经 AI.qd 中转，AI.qd 可审计和过滤
- 系统服务调用：必须经 AI.qd
- 本地记忆：定期同步被 AI.qd 抽走，存入统一记忆（加密存储）
- 云端记忆：可自由调用（不经过本地）

### 16.5 隔离层安全

- 所有系统修改任务默认经过隔离层
- 异常中断的修改不会直接污染系统
- 隔离区可审计、可回滚、可恢复
- 防止"改了一半"导致系统不一致

### 16.6 多层防御原则（v1.2 核心）

> 安全是多层防御，不是 100% 保证。明确风险和权衡。

| 层级 | 安全机制 |
|------|---------|
| 第一层 | 模块沙箱（namespace + seccomp） |
| 第二层 | 安全策略强制执行（执行层，不是AI自愿） |
| 第三层 | 直接传输三层安全（授权+实时监控+抽查） |
| 第四层 | 隔离层（异常中断保护） |
| 第五层 | 闪退保护 + 自修复（系统恢复） |
| 第六层 | AI.qd 守护进程（监控AI.qd自身） |

---

## 17. 自修复与防崩溃

### 17.1 防崩溃程序

**位置**：`/系统/兼容.qd/闪退保护.qds`

**职责**：
- 监控所有系统服务进程
- 检测进程崩溃（异常退出、无响应、内存溢出）
- 通知 AI.qd 崩溃事件
- 执行 AI.qd 决定的恢复策略

### 17.2 崩溃分级

| 级别 | 说明 | 处理方式 |
|------|------|---------|
| 轻微 | 单个应用崩溃 | 重启应用，不影响系统 |
| 中等 | 单个系统服务崩溃 | AI.qd 重启服务，记录日志 |
| 严重 | 多个系统服务崩溃 | AI.qd 进入修复模式，尝试恢复 |
| 致命 | 系统核心崩坏 | AI.qd 微系统接管，全面修复或回退或安全模式 |

### 17.3 修复流程

详见 [5.7 AI.qd 独立存储与微系统](#57-aiqd-独立存储与微系统) 中的自修复流程。

**v1.2 增强**：
- 确定性诊断优先（日志分析、错误码匹配、状态检查），复杂问题才用 AI 辅助诊断
- AI.qd 守护进程监控 AI.qd 自身，AI.qd 崩溃时自动重启
- 安全模式：严重故障时只加载核心模块
- 所有修复操作前自动创建快照，失败可回滚

### 17.4 Git 回退

- 每个 .qd 模块自带独立 Git 仓库（浅克隆，只保留最近3个版本）
- 系统崩坏时可通过 Git 回退到上一个稳定版本
- 回退前必须备份用户数据（通过隔离层和 AI.qd 独立存储，自动创建快照）
- 回退后验证系统可用性
- 备份保留三天，内存告急再删除

### 17.5 隔离层与自修复的关系

- 隔离层防止异常中断导致系统不一致（事前预防）
- 自修复在系统已经崩坏后进行恢复（事后恢复）
- 两者配合：隔离层尽量减少崩坏发生，自修复在崩坏发生后恢复

### 17.6 崩溃处理与核心转储（core dump）

**定位**：应用/服务崩溃时自动捕获现场信息，用于 bug 定位和分析。**没有这个，崩溃了只能猜原因。**

**模块位置**：`/系统/功能.qd/崩溃处理.qd/`

**核心功能**：

1. **崩溃检测**：
   - 进程异常退出（segfault、abort、非法指令、总线错误等）
   - 进程无响应（看门狗检测，超过阈值视为挂死）
   - 内存溢出（OOM killer 杀死进程）
   - 断言失败（应用主动 abort）

2. **核心转储（core dump）**：
   - 崩溃时自动捕获进程的完整内存镜像
   - 包含：寄存器状态、堆栈回溯、内存映射、打开的文件描述符、环境变量、命令行参数
   - 存储位置：`/var/log/coredump/<时间戳>_<进程名>_<PID>.core`
   - 压缩存储（zstd），减小体积
   - 大小限制：单个 core dump 最大 100MB，超过则只捕获堆栈和寄存器
   - 配额管理：core dump 总大小不超过 1GB，超过自动清理最旧的

3. **崩溃日志收集**：
   - 崩溃时自动收集相关日志（该进程最近的日志、系统日志）
   - 崩溃信息：进程名、PID、崩溃信号、崩溃地址、崩溃时间
   - 堆栈回溯：自动解析符号（如果有调试符号），给出函数名和行号
   - 系统状态：崩溃时的内存使用、CPU 负载、磁盘空间
   - 存储位置：`/var/log/crash/<时间戳>_<进程名>_<PID>.log`

4. **崩溃分析**：
   - **确定性分析优先**：
     - 错误码匹配（已知崩溃模式的特征匹配）
     - 堆栈模式识别（常见崩溃的堆栈特征）
     - 重复崩溃检测（同一位置多次崩溃标记为已知问题）
   - **AI 辅助分析**：
     - AI.qd 读取崩溃日志和 core dump，分析可能的原因
     - 给出修复建议
     - 如果是系统模块崩溃，AI.qd 可自动回退到上一个版本
     - 如果是应用崩溃，AI.qd 可通知应用开发者（如果有）
   - **崩溃数据库**：
     - 记录所有崩溃的特征（签名）、发生次数、影响范围
     - 已知崩溃自动匹配，不重复分析
     - 用户可选择是否共享崩溃数据（隐私）

5. **崩溃通知**：
   - 应用崩溃时通知用户（"XX应用已停止运行"）
   - 提供"查看详情"（崩溃日志、堆栈）
   - 提供"重新启动"按钮
   - 系统服务崩溃时不打扰用户，自动重启（闪退保护处理）
   - 连续崩溃的应用标记为"不稳定"，提示用户卸载或更新

6. **调试符号管理**：
   - 系统模块的调试符号单独存储（不打包进发布版，减小体积）
   - 崩溃分析时自动从符号服务器下载对应版本的调试符号
   - 应用的调试符号由应用开发者提供
   - 没有调试符号时，崩溃分析只给出地址，不给出函数名

7. **与墓碑机制的关系**：
   - 应用崩溃时，如果应用支持状态保存，先尝试保存状态
   - 崩溃的应用不进入墓碑状态（已死亡）
   - 用户重新打开时，从保存的状态恢复（如果有）或冷启动

8. **与日志系统的关系**：
   - 崩溃日志是日志系统的一部分（SECURITY/ERROR 级别）
   - core dump 是独立的二进制文件，不经过日志系统
   - 崩溃分析时同时读取崩溃日志和相关系统日志

### 17.7 系统挂死处理（Watchdog + 安全模式）

**定位**：系统完全挂死（无法操作、无响应）时的恢复机制。

1. **挂死检测**：
   - 硬件看门狗：系统定期喂狗，挂死时无法喂狗，硬件自动复位
   - 软件看门狗：监控关键服务（AI.qd、执行层、图形栈）的心跳
   - UI 响应监控：检测 UI 帧率和输入响应，长时间无响应视为挂死
   - 按键检测：用户长按电源键强制重启（物理兜底）

2. **挂死恢复流程**：
   ```
   检测到系统挂死
     ↓
   软件看门狗尝试恢复：
     1. 尝试重启图形栈（如果只是UI挂死）
     2. 尝试重启 AI.qd（如果是AI挂死）
     3. 进入安全模式（只加载核心服务）
     ↓
   软件恢复失败 → 硬件看门狗超时 → 硬件复位
     ↓
   系统重启
     ↓
   启动时检测到异常复位（看门狗标志）
     ↓
   自动收集上次崩溃的日志（如果有）
     ↓
   通知 AI.qd 进行自修复
     ↓
   连续3次异常复位 → 自动进入安全模式，提示用户
   ```

3. **安全模式**：
   - 只加载核心模块（HAL、执行层、AI.qd、隔离层、闪退保护、看门狗）
   - 不加载第三方模块、兼容层、图形栈（用最简图形界面）
   - 用户可在安全模式下卸载有问题的模块、回退系统更新、查看日志
   - 安全模式下 AI.qd 可进行深度诊断和修复
   - 修复完成后重启回到正常模式

---

## 18. 推理引擎双架构

### 18.1 架构设计

奇点OS 支持双推理引擎架构，根据设备架构自动选择：

| 架构 | 推理引擎 | 适用设备 | 说明 |
|------|---------|---------|------|
| **ARM（aarch64）** | MNN | 手机、平板、mini 版 | 阿里开源，移动端优化好，ARM 性能优异 |
| **X86（x86_64）** | llama.cpp | PC、笔记本、台式机 | 开源，X86 优化好，支持多种模型格式 |

### 18.2 当前定位

- 目前是**替代型方案**：根据架构选择成熟的推理引擎
- MNN 主要服务 ARM 架构（手机/mini）
- llama.cpp 主要服务 X86 架构（PC）
- 未来会研究出 X86 和 ARM 通用的统一推理引擎（长期目标）

### 18.3 统一 API 层（v1.2 核心）

- 推理引擎封装为 `/AI.qd/推理引擎.qd/` 模块
- 对外提供统一的推理 API（`qd_ai_infer()`），上层不关心底层是 MNN 还是 llama.cpp
- AI.qd 通过统一 API 调用推理，不关心底层引擎
- 系统启动时自动检测架构，加载对应的推理引擎
- 模型格式自动转换（用户提供一种格式，系统自动转换为对应引擎的格式）

### 18.4 模型支持

- ARM/MNN：MNN 格式模型（如 Qwen2.5-1.5B-MNN）
- X86/llama.cpp：GGUF 格式模型
- 未来统一引擎：支持多种格式自动转换

### 18.5 性能优化

- ARM/MNN：4 线程优化，CPU 亲和性绑定大核
- X86/llama.cpp：多线程优化，AVX2/AVX512 指令集加速
- 通用：AI.qd 根据负载动态调整推理线程数和优先级
- 性能调优脚本化，统一配置文件

### 18.6 套壳处理

MNN 和 llama.cpp 都封装成 `/AI.qd/推理引擎.qd/` 模块，对外统一 API，由奇点OS 统一管理，不算套壳。详见 [第21章 套壳组件处理原则](#21-套壳组件处理原则)。

---

## 19. 开发者模块与远程开发

### 19.1 开发者模块

**位置**：用户可安装在 `/用户.qd/模块/` 或 `/系统/`

**功能**：
- 代码编辑器
- 编译器/构建工具
- 调试器
- 模块打包工具
- 日志查看器
- 性能分析器

### 19.2 远程开发

**支持方式**：
- 无线连接（WiFi 局域网）
- 有线连接（USB / 网线）
- 远程投屏 + 远程控制

**规则**：
- 任意奇点OS 设备可对另一台奇点OS 设备进行模块开发
- 有线连接时为 AI.qd 直连 AI.qd（仅限奇点OS ↔ 奇点OS）
- 开发过程中调用系统 API 的逻辑与本地开发一致：通过 .qdai → AI.qd

### 19.3 模块开发流程

```
1. 创建模块目录（模块名.qd/）
2. 编写 module.qdmeta 元数据
3. 编写模块代码（支持多语言）
4. 编译为 .qds 系统单文件
5. 编写 .qdai AI 规则文件
6. 初始化 Git 仓库（浅克隆）
7. 打包模块
8. 安装到本地或远程设备
9. 测试调试
10. 发布分享
```

### 19.4 用户模块审核

- 用户开发的模块**不需要审核**，直接安装
- 有 .qd 后缀兜底，出了问题可追溯
- 模块崩溃由闪退保护处理，不影响系统
- 系统修改默认经过隔离层，防止异常中断
- 用户自行承担模块风险

---

## 20. 第三方 AI 接入管理

### 20.1 接入流程

```
用户安装第三方 AI（如豆包）
  │
  ▼
AI.qd 识别第三方 AI
  │
  ▼
AI.qd 自动生成 .qdai 规范文件
  │  - 定义第三方 AI 的权限边界
  │  - 定义记忆同步规则
  │  - 定义网络中转规则
  │
  ▼
第三方 AI 在规范约束下运行（独立沙箱）
```

### 20.2 权限边界

| 资源 | 访问方式 |
|------|---------|
| 用户文件 | 可访问，但经 AI.qd 中转 |
| 网络 | 可访问，但经 AI.qd 中转 |
| 系统服务 | 必须经 AI.qd 调用 |
| 本地记忆 | 定期同步被 AI.qd 抽走，存入统一记忆 |
| 云端记忆 | 可自由调用 |
| 硬件 | 无直接访问权，经 AI.qd 中转 |
| 数据直连 | 无权限，必须经 AI.qd 中转 |

### 20.3 统一记忆

- 所有第三方 AI 的本地记忆由 AI.qd 统一存储（定期同步，不是实时拦截）
- 记忆用 SQLite 存储，用户密钥加密
- AI.qd 可读取、检索、分析所有统一记忆
- 用户可查看、删除、导出统一记忆
- 第三方 AI 不能直接访问其他 AI 的记忆（需经 AI.qd 授权）
- 记忆有来源标记，用户知道哪条记忆来自哪个 AI

---

## 21. 套壳组件处理原则（v1.2 新增核心章节）

### 21.1 核心原则

> **封装成 .qd 模块、由奇点OS 统一管理、对外提供统一 API，就不算套壳。**

任何操作系统都会用基础库（Linux 也用 zlib、freetype、openssl）。关键是**奇点OS 拥有系统的核心架构、调度体系、模块化系统、AI 体系**，外部组件只是被封装成模块为系统服务。

### 21.2 套壳组件分类与处理

#### 🔴 核心组件（封装成 .qd 模块，逐步自研替换）

| 组件 | 处理方式 | 短期 | 中期 | 长期 |
|------|---------|------|------|------|
| **MNN 推理引擎** | 封装成 `/AI.qd/推理引擎.qd/`，统一 API | 直接用 | 基于核心算法自研精简版 | 完全自研 |
| **llama.cpp** | 同上，X86 架构用 | 直接用 | 统一 API 层 | 完全自研 |
| **Wine（WDS）** | 封装成 `WDS.qd` 模块，增加 box64 | 直接用 | 逐步替换核心组件 | 完全自研 |
| **AOSP/ART（ANZ）** | 封装成 `ANZ.qd` 模块，集成 microG | 直接用 | 逐步替换 Framework | 完全自研 |
| **wlroots 合成器** | 封装成 `/系统/界面.qd/合成器.qd/` | 基于它开发 | 逐步替换依赖 | 完全自研 |

#### 🟡 重要组件（封装成 .qd 模块，保持使用）

| 组件 | 处理方式 | 说明 |
|------|---------|------|
| **freetype + harfbuzz** | 封装成 `/系统/界面.qd/字体渲染.qd/` | 字体渲染基础库，不需要自研 |
| **Git / libgit2** | 封装成模块管理工具 | 用浅克隆+自动清理优化存储 |
| **Lua 解释器** | 嵌入 .qdai 引擎 | 200KB，轻量嵌入式，适合 |
| **musl libc** | 静态链接 | C 库基础，不需要自研 |

#### 🟢 基础库（直接使用，封装成系统模块）

| 组件 | 说明 |
|------|------|
| libpng / libjpeg | 图像编解码基础库 |
| zlib | 压缩基础库 |
| ffmpeg | 多媒体编解码（计划用） |
| OpenGL ES / Vulkan | 3D 渲染（驱动级，不自研） |
| ext4 / f2fs | 文件系统（内核提供） |
| Linux 网络协议栈 | 网络（内核提供） |
| DRM/KMS | 显示子系统（内核提供） |
| SQLite | 统一记忆数据库（轻量） |
| OpenSSL | 加密、HTTPS（计划用） |

### 21.3 奇点OS 真正自研的核心

| 核心组件 | 说明 |
|---------|------|
| **模块化系统** | .qd/.qds/.qdai 规范、模块加载器、依赖管理、沙箱 |
| **AI.qd 体系** | 策略层、守护进程、统一记忆、规则引擎、INTENT Agent |
| **系统服务执行层** | 实时调度、安全策略强制执行、直接传输管理、隔离层 |
| **窗口管理器** | 自研窗口管理、布局、焦点、层级、动画 |
| **渲染管线** | 自研 2D 渲染（短期可复用 Skia 精简版） |
| **HAL 硬件抽象层** | 自研，封装内核接口，为未来自研内核做准备 |
| **QD-IPC 通信协议** | 自研双通道通信协议 |
| **包管理器** | 自研模块安装/卸载/更新 |
| **主题系统** | 自研主题管理 |
| **原生应用 SDK** | 自研奇点OS 原生应用开发框架 |

### 21.4 套壳透明化

- 文档中明确列出所有使用的开源组件
- 每个开源组件都封装成 .qd 模块，保留原许可证
- 逐步替换核心组件，非核心基础库保持使用
- 不隐瞒、不夸大，明确哪些是自研、哪些是封装的开源组件

---

## 22. 实现原理

### 22.1 系统核心原理

**奇点OS 的本质**：以 AI.qd 为核心策略决策者的模块化操作系统。

- 内核：Linux 内核（提供硬件抽象、进程、内存、文件系统基础）
- HAL：封装内核接口，提供可移植的系统调用层
- AI.qd：系统的大脑，拥有最高权限，做策略决策（秒级）
- 系统服务执行层：确定性代码，实时执行 AI.qd 的策略（微秒级）
- 直接传输模块：应用间高频数据直连，三层安全保障
- 隔离层：异常中断保护，分级隔离
- 模块化系统：一切功能以 .qd 模块形式存在，可插拔、可替换
- 图形栈：基于 Wayland 协议的自研显示、窗口、合成、渲染
- 兼容层：WDS/ANZ，分三步走（复用→半自研→全自研），独立沙箱

#### 22.1.1 系统启动流程详细设计

**定位**：从按下电源键到图形界面显示的完整启动流程。**没有这个，开发时不知道系统怎么起来的，出了问题不知道卡在哪一步。**

```
阶段 0：硬件初始化（bootloader，毫秒级）
  ├─ 电源键按下，硬件上电
  ├─ CPU 复位，从固定地址开始执行
  ├─ bootloader 启动（如 U-Boot / fastboot）
  ├─ 初始化基本硬件（内存控制器、串口、显示）
  ├─ 显示启动画面（开机动画第一帧）
  └─ 加载内核到内存

阶段 1：内核启动（秒级）
  ├─ Linux 内核解压并启动
  ├─ 内核初始化：
  │   ├─ 内存管理初始化（页表、分配器）
  │   ├─ 进程调度初始化（CFS）
  │   ├─ 中断控制器初始化
  │   ├─ 定时器初始化
  │   ├─ 内核线程启动（kthreadd、kworker 等）
  │   └─ 设备驱动初始化（按内置驱动顺序）
  ├─ 挂载根文件系统（rootfs，initramfs 或真实分区）
  ├─ 创建设备节点（/dev/ 下的基础设备）
  ├─ 挂载虚拟文件系统（/proc、/sys、/dev/pts）
  └─ 启动第一个用户空间进程（PID=1，qd-init）

阶段 2：initramfs（可选，刷机版用）
  ├─ 内核先挂载 initramfs（内存中的临时根文件系统）
  ├─ initramfs 中的 init 脚本执行：
  │   ├─ 加载必要的内核模块（存储驱动、文件系统驱动）
  │   ├─ 识别真实根分区（通过 UUID 或标签）
  │   ├─ 检查文件系统（fsck，修复损坏）
  │   ├─ 挂载真实根分区到 /newroot
  │   └─ pivot_root 切换到真实根分区
  └─ 执行真实根分区的 /sbin/qd-init

阶段 3：qd-init 初始化（PID=1，秒级）
  ├─ qd-init 启动（奇点OS 的 init 进程，替代 systemd/sysvinit）
  ├─ 挂载基础文件系统：
  │   ├─ /proc、/sys、/dev（重新挂载，确保完整）
  │   ├─ /dev/pts、/dev/shm
  │   ├─ /run、/tmp
  │   └─ /sys/fs/cgroup（cgroup v2）
  ├─ 设置主机名、域名
  ├─ 初始化控制台（串口/显示终端）
  ├─ 启动 udevd（设备管理服务，动态创建设备节点）
  ├─ 等待关键设备就绪（存储、显示、输入）
  ├─ 挂载其他分区：
  │   ├─ /系统（系统分区，只读）
  │   ├─ /用户.qd（用户数据分区，可写）
  │   ├─ /AI.qd（AI 独立存储）
  │   ├─ /var（可变数据）
  │   └─ /cache（缓存分区）
  ├─ 启动日志服务（qdlogd，开始记录系统日志）
  ├─ 启动看门狗（硬件看门狗开始喂狗）
  └─ 进入系统服务启动阶段

阶段 4：HAL 与系统服务执行层（秒级）
  ├─ 启动 HAL 守护进程（qd-hald，封装内核接口）
  ├─ 启动系统服务执行层（qd-execd，确定性实时执行）：
  │   ├─ 进程管理服务（qd-procd）
  │   ├─ 内存管理服务（qd-memd）
  │   ├─ 文件系统服务（qd-fsd）
  │   ├─ 安全策略执行引擎（qd-securityd）
  │   ├─ 网络管理服务（qd-netd）
  │   ├─ 设备管理服务（qd-deviced）
  │   ├─ 电源管理服务（qd-powerd）
  │   ├─ 音频服务（qdaudiod）
  │   ├─ 传感器服务（qd-sensord）
  │   ├─ 时间同步服务（qd-timed，NTP）
  │   ├─ 日志服务（已启动）
  │   └─ 看门狗（已启动）
  ├─ 启动隔离层服务（qd-quarantined，异常中断保护）
  ├─ 启动直接传输模块（qd-directd，应用间数据直连）
  ├─ 服务间建立 QD-IPC 通信
  ├─ 执行层进入稳定运行状态
  └─ 通知 AI.qd 可以启动

阶段 5：AI.qd 启动（核心，秒级）
  ├─ 执行层启动 AI.qd 主进程（ai_service.qds）
  ├─ AI.qd 初始化：
  │   ├─ 加载 AI 配置（ai_config.qdai）
  │   ├─ 初始化统一记忆系统（SQLite，从磁盘加载）
  │   ├─ 启动推理引擎（MNN/llama.cpp，加载模型）
  │   ├─ 启动 AI.qd 守护进程（ai_daemon.qds，监控 AI.qd 状态）
  │   ├─ 建立 AI.qd 命令行界面（调试用）
  │   └─ 加载所有 .qdai 规则文件（扫描 /系统/ 和 /AI.qd/）
  ├─ AI.qd 向执行层下发初始策略：
  │   ├─ 进程调度策略
  │   ├─ 内存分配策略
  │   ├─ 性能调度策略
  │   ├─ 安全策略（从安全策略文件加载）
  │   └─ 电源管理策略
  ├─ AI.qd 审核已启动服务的权限声明
  ├─ AI.qd 进入稳定运行状态
  └─ 通知图形栈可以启动

阶段 6：图形栈启动（秒级）
  ├─ 启动显示服务器（qd-displayd，通过 DRM/KMS 初始化显示）
  ├─ 启动合成器（基于 wlroots，初始化 OpenGL ES）
  ├─ 启动窗口管理器（qd-wmd，初始化窗口树）
  ├─ 启动渲染管线（qd-renderd，初始化 2D 渲染）
  ├─ 启动输入管理（qd-inputd，初始化触摸/键盘/鼠标）
  ├─ 启动字体渲染（freetype + harfbuzz）
  ├─ 启动主题系统（加载默认主题，深色/浅色）
  ├─ 启动通知中心（qd-notificationd）
  ├─ 启动剪贴板服务（qd-clipboardd）
  ├─ 启动输入法框架（qd-imd）
  ├─ 显示系统界面（桌面、状态栏、导航栏）
  ├─ 播放开机动画（如果还在播放）
  └─ 图形界面就绪，用户可操作

阶段 7：兼容层与应用启动（秒级）
  ├─ 启动墓碑管理服务（qd-tombstoned，后台应用冻结/解冻）
  ├─ 启动包管理服务（qd-pkgd，模块/应用安装管理）
  ├─ 启动 WDS 兼容层（Windows 兼容，独立沙箱）
  ├─ 启动 ANZ 兼容层（安卓兼容，独立沙箱）
  ├─ 启动微服务（qd-microsrvd，低功耗常驻服务）
  ├─ 启动投屏/远程服务（可选，qd-castd）
  ├─ 扫描已安装的应用，注册到启动器
  ├─ 恢复上次的应用状态（墓碑机制，解冻后台应用）
  ├─ 发送系统启动完成广播
  └─ 系统完全启动，用户可正常使用

阶段 8：启动后优化（后台，持续）
  ├─ AI.qd 在后台优化系统配置（根据使用习惯）
  ├─ 预加载常用应用（加快启动速度）
  ├─ 清理临时文件和缓存
  ├─ 检查系统更新（OTA）
  ├─ 同步时间（NTP）
  ├─ 备份系统配置（自动备份）
  └─ 系统进入正常运行状态
```

**启动超时与故障处理**：
- 每个阶段有超时阈值（默认 30 秒），超时则记录错误并进入下一阶段（非关键服务）或进入安全模式（关键服务）
- 关键服务启动失败（AI.qd、执行层、图形栈）→ 自动重试 3 次 → 仍失败则进入安全模式
- 非关键服务启动失败（兼容层、微服务）→ 记录错误，继续启动，不影响系统核心
- 启动过程中所有日志记录到 `/var/log/boot.log`，启动失败时用于诊断
- 连续 3 次启动失败 → 自动进入安全模式，提示用户修复

**mini 版的启动流程差异**：
- mini 版跑在 proot 容器里，没有 bootloader 和内核启动阶段
- 安卓 APP 启动 → 解压 rootfs → 启动 proot 容器 → 容器内执行 qd-init → 后续阶段相同
- 图形栈用 WebView 替代（容器里没有 DRM/KMS）
- 硬件访问通过安卓 API 间接访问（HAL 封装了安卓 API）

### 22.2 AI.qd 调度原理（v1.2 修正：策略+执行分离）

**AI.qd 如何统一调度系统**：

1. **策略决策（AI.qd，秒级）**：
   - 决定"谁该获得更多资源"
   - 决定"哪个服务该重启"
   - 决定"窗口怎么布局"
   - 决定"权限怎么分配"
   - 决定"哪些模块可以直连"
   - 决定"修复策略"

2. **实时执行（系统服务执行层，微秒级）**：
   - 实时进程调度（CFS 算法）
   - 内存分配/回收
   - 渲染合成（16ms/帧）
   - 输入事件分发（毫秒级）
   - 安全策略强制执行
   - 直接传输通道实时监控
   - 异常即时处理

3. **抽查监督（AI.qd，空闲时）**：
   - 对直连通道进行抽查
   - 监控系统状态
   - 异常检测和干预

4. **故障降级（v1.2 新增）**：
   - AI.qd 故障时，执行层使用最后一次策略继续运行
   - AI.qd 守护进程自动重启 AI.qd
   - 严重故障进入安全模式

**关键**：AI.qd 不参与每一次实时操作，只设定规则和策略，由确定性代码实时执行。这样既保留 AI 的最高决策权，又保证系统性能。

### 22.3 直接传输模块原理

详见 [第6章](#6-aiqd-直接传输模块)。

核心：AI.qd 授权通道建立，直接传输模块管理通道，执行层实时监控，AI.qd 空闲抽查，数据传输不经 AI.qd。

### 22.4 隔离层原理

详见 [第7章](#7-隔离层)。

核心：分级隔离（关键修改完整隔离，普通修改轻量隔离，临时文件不隔离），所有修改先写入隔离区，验证完整后提交，异常中断保留隔离区，重启后 AI.qd 决定恢复或回滚。

### 22.5 模块化原理

**.qd 模块如何工作**：

1. **模块加载**：模块加载器读取 .qd 目录，解析元数据，加载 .qds 二进制
2. **服务注册**：模块将提供的服务注册到服务管理器
3. **服务发现**：其他模块通过 AI.qd（控制通道）查询和调用服务
4. **数据直连**：高频数据传输经 AI.qd 授权后建立直连通道
5. **依赖管理**：模块加载前检查依赖，依赖满足才加载
6. **生命周期**：模块由 AI.qd 策略管理，执行层执行启动、停止、重启、卸载
7. **隔离**：每个模块运行在独立进程沙箱（namespace + seccomp）

### 22.6 .qdai 规则引擎原理（v1.2 简化版）

**.qdai 如何让 AI 规则生效**：

1. **规则加载**：AI.qd 扫描所有 .qdai 文件，解析所有部分（自然语言、结构化规则、Lua脚本、预训练知识）
2. **规则理解**：AI 推理引擎读取自然语言部分和预训练知识，理解规则意图
3. **规则生成**：AI.qd 生成/修改结构化规则部分（AI 写规则，不是 AI 实时执行）
4. **规则执行**：系统执行层读取结构化规则，确定性执行（不需要 AI 参与）
5. **脚本执行**：复杂的 IO 路由和数据转发由 Lua 脚本执行
6. **规则跳转**：.qdai 可跳转到其他 .qdai，形成规则链
7. **规则修改**：AI.qd 可通过 .qdai 修改 .qds 系统单文件的配置

**v1.2 关键**：
- 结构化规则优先（确定性执行，不依赖 AI 理解）
- 自然语言只用于 AI 生成结构化规则，不直接执行
- 只保留 Lua 脚本（去掉 Python 和 JS），轻量嵌入式
- 预训练知识帮助小模型理解复杂规则

### 22.7 图形栈原理

**自研图形栈如何工作**：

1. **显示服务器**：通过 HAL 访问 DRM/KMS，设置显示模式，管理帧缓冲
2. **窗口管理器**：管理窗口树，处理窗口布局、焦点、层级，绘制窗口装饰
3. **合成器**：基于 wlroots，将多个窗口的帧缓冲合成为屏幕帧，处理透明度、阴影、动画
4. **渲染管线**：提供 2D 绘制 API（矢量、文本、图像），输出到窗口帧缓冲
5. **输入管理**：通过 HAL 读取输入设备，解析事件，分发给焦点窗口
6. **应用交互**：应用通过 Wayland 协议请求窗口操作和绘制，不直接访问硬件

### 22.8 兼容层原理（WDS / ANZ）

**WDS（Windows 兼容层）如何运行 Windows 程序**：

1. **PE 加载**：解析 PE 文件格式，加载代码段、数据段、导入表（自研）
2. **box64 转译**：ARM 架构上，x86 指令通过 box64 转译为 ARM 指令（必需）
3. **API 翻译**：拦截 Windows API 调用，翻译成奇点OS 的 HAL 调用和系统服务调用（阶段1用Wine，逐步自研）
4. **注册表模拟**：在文件系统中模拟 Windows 注册表
5. **文件系统映射**：将 Windows 路径映射到奇点OS 路径
6. **GUI 翻译**：将 Windows GDI 绘图调用翻译成奇点OS 渲染调用（Wayland）
7. **进程管理**：Windows 进程作为奇点OS 进程运行在独立沙箱中，由兼容层管理

**ANZ（安卓兼容层）原理类似**：APK 解析 → Dalvik/ART 运行 Java 代码 → Android API 翻译成奇点OS 调用 → microG 提供 GMS 兼容。

### 22.9 自修复原理

详见 [5.7](#57-aiqd-独立存储与微系统) 和 [第17章](#17-自修复与防崩溃)。

核心：闪退保护检测崩溃 → AI.qd 微系统接管 → 确定性诊断优先（日志分析、错误码匹配）→ 修改修复或 Git 回退 → 自动快照备份用户数据 → 验证恢复 → 清理备份。AI.qd 守护进程监控 AI.qd 自身，安全模式用于严重故障。

---

## 23. 开发计划与路线图

### 23.1 阶段划分

```
阶段 0：规范制定（当前）
  └─ 完成系统规范文档 v1.2

阶段 1：基础系统（可启动到命令行）
  ├─ 基于 Linux 内核 + musl libc 构建最小 rootfs
  ├─ 实现 HAL 硬件抽象层
  ├─ 实现 qd-init 初始化进程
  ├─ 实现系统服务执行层（进程/内存/文件/安全策略执行）
  ├─ 实现 .qds 加载器
  ├─ 实现隔离层（分级隔离）
  └─ 目标：能启动，运行 .qds 服务，执行层独立运行

阶段 2：AI.qd 核心（AI 系统就绪）
  ├─ 实现 AI.qd 启动流程
  ├─ 集成推理引擎（ARM: MNN / X86: llama.cpp，统一API）
  ├─ 实现 AI.qd 守护进程
  ├─ 实现 .qdai 三格式规则引擎（自然语言+结构化规则+Lua）
  ├─ 实现统一记忆系统（SQLite+加密+用户管理）
  ├─ 实现 AI.qd 策略层（调度策略、权限决策、降级模式）
  ├─ 实现模块间控制通道（经 AI.qd）
  └─ 目标：AI.qd 可以做策略决策，.qdai 规则生效，AI故障时系统降级运行

阶段 3：直接传输与高性能通信
  ├─ 实现 AI.qd 直接传输模块
  ├─ 实现共享内存/UNIX Socket 直连通道
  ├─ 实现三层安全（授权+实时监控+抽查）
  ├─ 完善 QD-IPC 双通道通信
  └─ 目标：应用间高频数据直连，微秒级响应，安全可控

阶段 4：图形栈（有图形界面）
  ├─ 实现显示服务器（DRM/KMS，通过HAL）
  ├─ 基于 wlroots 实现合成器（封装成模块）
  ├─ 实现窗口管理器（自研）
  ├─ 实现 2D 渲染管线（自研精简版）
  ├─ 实现输入管理（自研，逐步替换libinput）
  ├─ 实现字体渲染（freetype+harfbuzz封装）
  ├─ 实现主题系统（深色/浅色）
  └─ 目标：能显示图形界面，打开窗口，简单界面60fps

阶段 5：模块化系统完善
  ├─ 完善模块加载器（依赖、权限、沙箱namespace+seccomp）
  ├─ 实现包管理器
  ├─ 实现权限管理
  ├─ 实现模块热更新（隔离层保护）
  ├─ 完善闪退保护与自修复（守护进程+安全模式+快照）
  └─ 目标：模块可插拔，系统可自修复，安全可靠

阶段 6：兼容层（可运行应用）
  ├─ WDS：封装 Wine + box64，实现 PE 加载器（阶段1）
  ├─ ANZ：封装 Android Runtime + microG，实现 APK 解析器（阶段1）
  ├─ 兼容层独立沙箱（namespace+seccomp+资源限制）
  ├─ 实现应用安装管理器
  ├─ 实现原生应用 SDK
  ├─ 建立兼容性数据库
  └─ 目标：能跑简单开源 Windows/安卓应用，明确兼容性预期

阶段 7：网络与远程
  ├─ 实现网络管理服务
  ├─ 实现屏幕投射
  ├─ 实现远程控制
  ├─ 实现多屏协同
  ├─ 实现远程开发
  └─ 目标：设备间可互联、可远程开发

阶段 8：第三方 AI 与生态
  ├─ 实现第三方 AI 接入管理（独立沙箱+权限边界）
  ├─ 完善统一记忆系统（定期同步+加密+用户管理）
  ├─ 实现模块市场/商店
  ├─ 实现开发者工具链
  └─ 目标：第三方 AI 可接入，开发者可发布模块

阶段 9：刷机适配（独立系统）
  ├─ 制作刷机包（boot/system/userdata 分区）
  ├─ 适配启动流程（bootloader → kernel → qd-init → 执行层 → AI.qd）
  ├─ 先适配一款手机（开发者自己的手机）
  ├─ 利用 Treble/GSI 扩展支持更多设备
  ├─ 实现 OTA 升级
  └─ 目标：可刷机到设备，独立运行，不依赖安卓（先适配1款，逐步扩展）

阶段 10：兼容层自研替换（半自研→全自研）
  ├─ WDS：逐步替换 Wine 核心组件为自研（API翻译层、注册表模拟）
  ├─ ANZ：逐步替换 Android Framework 为自研
  ├─ 优化 box64 和 ART 性能
  └─ 目标：关键兼容组件自研，性能和兼容性提升

阶段 11：图形栈自研替换
  ├─ 逐步替换 wlroots 依赖（先自研输入处理，再自研显示抽象）
  ├─ 完全自研合成器
  └─ 目标：图形栈完全自研

阶段 12：推理引擎统一
  ├─ 基于 GGUF 标准格式，自研统一推理引擎
  ├─ 统一 ARM 和 X86 架构
  └─ 目标：统一推理引擎，不再依赖 MNN/llama.cpp

阶段 13：自研内核（终极目标，5年+长期）
  ├─ 重写 HAL 层适配自研内核
  ├─ 上层代码全部复用
  ├─ 性能优化
  └─ 目标：完全自研操作系统（需要团队，不是一个人能完成的）
```

### 23.2 当前 mini 版的定位

当前的"奇点OS mini APK"是**同一个系统的容器运行版**：
- 系统核心与刷机版完全相同
- 跑在 proot 容器里，寄生在安卓上
- 用 Web 界面（因为容器里没有自研图形栈）
- 用于验证系统核心（模块、AI.qd、兼容层等）
- 刷机版有自研图形栈，用原生图形桌面

### 23.3 优先级

1. **最高优先级**：基础系统（阶段1）+ AI.qd 核心（阶段2）—— 系统的灵魂
2. **高优先级**：直接传输（阶段3）+ 图形栈（阶段4）—— 系统的骨架和性能
3. **中优先级**：模块化完善（阶段5）+ 兼容层（阶段6）—— 系统的血肉
4. **低优先级**：网络远程（阶段7）+ 生态（阶段8）+ 刷机（阶段9）+ 自研替换（阶段10-12）+ 自研内核（阶段13）—— 系统的扩展

### 23.4 理性预期（v1.2 明确）

| 功能 | 短期预期 | 长期预期 |
|------|---------|---------|
| WDS 跑 Windows 软件 | 简单开源软件能跑 | 复杂软件尽力支持，不保证完美 |
| ANZ 跑安卓应用 | 开源无GMS应用能跑 | 银行/支付/SafetyNet应用可能无法运行 |
| 图形栈 | 简单界面60fps | 视频30fps，游戏不保证 |
| 刷机 | 先适配1款手机 | 利用Treble/GSI扩展，不保证所有手机 |
| 自研内核 | 不做（5年+长期目标） | 需要团队，不是一个人能完成 |
| AI.qd 实时调度 | AI做策略，代码做执行 | 保持这个架构，AI不做实时执行 |

---

## 24. 代码原则

### 24.1 总体原则

**优先稳定，其次兼容。**

- 系统核心（HAL、执行层、AI.qd、图形栈、直接传输、隔离层）：优先稳定，其次兼容
- 兼容层（WDS、ANZ）：运行在独立沙箱，优先兼容，后稳定（先让更多软件能跑，再慢慢修 bug），崩溃不影响系统核心

### 24.2 编码规范

- **语言选择**：HAL=C，系统服务=Rust/C++，图形栈=C++，.qds=多语言绑定，隔离层=.qds(C/Rust)，.qdai脚本=Lua
- **编译**：核心服务静态链接 musl libc，非核心服务动态链接；所有二进制 strip + 压缩
- **错误处理**：所有函数返回统一错误码，禁止忽略错误
- **内存安全**：优先使用 Rust，C 代码必须严格检查边界
- **并发安全**：线程安全优先，避免全局可变状态
- **日志**：系统日志 + AI.qd 日志分开，日志级别 debug/info/warn/error，日志轮转和清理

### 24.3 性能要求

- 不崩溃
- 不卡顿
- 用户用起来不掉帧
- AI.qd 推理性能优先保证
- 图形界面简单界面 60fps 目标
- 数据直连通道微秒级延迟
- AI.qd 策略变更 1 秒内生效

### 24.4 可移植性

- 所有上层代码只依赖 HAL，不直接调用 Linux
- 架构支持：aarch64（优先）、x86_64、riscv64（未来）
- 推理引擎：ARM用MNN，X86用llama.cpp，未来统一
- 静态编译核心服务，便于移植

### 24.5 安全原则

- 多层防御，不是 100% 保证
- 最小权限原则
- 安全策略由执行层强制执行，不是 AI 自愿遵守
- 所有系统修改默认经过隔离层
- 明确风险和权衡，不隐瞒不夸大

---

## 25. 系统虚拟化模块（虚拟化.qd）

### 25.1 模块定位

**独立于兼容层的系统级虚拟化模块**，基于 Linux 内核 KVM 实现轻量级虚拟机管理。与 WDS（Wine 兼容）是两种不同的 Windows 运行方案：

| 方案 | 原理 | 兼容性 | 性能 | 资源占用 | 适用场景 |
|------|------|--------|------|---------|---------|
| **WDS（Wine）** | API 翻译层，不模拟内核 | 中等（部分软件不兼容） | 高（接近原生） | 低 | 日常办公软件、轻量游戏 |
| **虚拟化（KVM）** | 完整虚拟机，模拟硬件 | 高（几乎所有 Windows 软件） | 中（有虚拟化开销） | 高 | 重度软件、特殊驱动、企业应用 |

**模块位置**：`/系统/虚拟化.qd/`（独立模块，不放在兼容.qd里）

### 25.2 模块结构

```
虚拟化.qd/
├── module.qdmeta              # 模块元数据
├── vm_manager.qds             # 虚拟机管理器（创建/启动/停止/删除/快照）
├── kvm_backend.qds            # KVM 后端（Linux 内核虚拟化接口封装）
├── vm_config.qds              # 虚拟机配置管理（CPU/内存/磁盘/网络/显卡）
├── vm_ai.qdai                 # 虚拟化 AI 规则（资源调度/自动优化/异常恢复）
├── images/                    # 虚拟机镜像存放目录
│   ├── windows_10.qcow2       # Windows 10 镜像
│   └── ...                    # 其他镜像
├── templates/                 # 虚拟机配置模板
│   ├── windows_10.json        # Win10 推荐配置
│   ├── windows_11.json        # Win11 推荐配置
│   └── linux_generic.json     # 通用 Linux 配置
└── .git/                      # 独立 Git 仓库
```

### 25.3 核心功能

| 功能 | 说明 |
|------|------|
| **虚拟机创建** | 基于模板创建 VM，配置 CPU 核数、内存大小、磁盘容量、网络模式 |
| **虚拟机管理** | 启动、停止、暂停、恢复、重启、强制关机 |
| **快照管理** | 创建快照、恢复快照、删除快照、快照树管理 |
| **镜像管理** | 导入镜像、导出镜像、镜像压缩、镜像格式转换（qcow2/raw/vdi） |
| **设备直通** | PCI 设备直通（GPU/USB/网卡），提升性能 |
| **共享文件夹** | 主机与虚拟机之间的文件共享（virtio-fs） |
| **剪贴板共享** | 主机与虚拟机之间的复制粘贴（spice-agent） |
| **自动启动** | 系统启动时自动启动指定虚拟机 |
| **资源限制** | CPU 使用率上限、内存上限、磁盘 IO 上限、网络带宽上限 |
| **远程显示** | 通过 VNC/SPICE 远程连接虚拟机桌面 |

### 25.4 虚拟机配置示例

```json
{
  "name": "Windows 10 工作环境",
  "id": "vm-win10-work",
  "os": "windows_10",
  "cpu": {
    "cores": 4,
    "sockets": 1,
    "threads_per_core": 2,
    "model": "host-passthrough"
  },
  "memory": {
    "size_mb": 8192,
    "hugepages": true
  },
  "disk": {
    "path": "images/windows_10.qcow2",
    "size_gb": 128,
    "interface": "virtio",
    "cache": "writeback"
  },
  "network": {
    "mode": "nat",
    "interface": "virtio",
    "mac": "52:54:00:12:34:56"
  },
  "graphics": {
    "type": "spice",
    "port": 5900,
    "listen": "127.0.0.1"
  },
  "gpu_passthrough": false,
  "shared_folders": [
    { "host_path": "/用户/文档", "vm_path": "D:\\共享文档", "readonly": false }
  ],
  "autostart": false,
  "snapshots": []
}
```

### 25.5 AI.qd 调度规则（vm_ai.qdai）

- 系统空闲时自动启动常用虚拟机（预加载）
- 虚拟机内存不足时自动增加内存分配（热插拔）
- 虚拟机 CPU 占用持续过高时自动增加核数
- 系统整体资源紧张时自动暂停非活动虚拟机
- 虚拟机异常崩溃时自动从最近快照恢复
- 定期自动创建快照（默认每天一次，保留7天）

### 25.6 与 WDS 的关系

- **WDS 优先**：轻量 Windows 软件优先用 WDS（Wine），资源占用低、启动快
- **虚拟化备选**：WDS 跑不了的软件（需要特殊驱动、内核级软件、企业应用）用虚拟化
- **用户选择**：用户安装 Windows 软件时，系统自动检测兼容性，推荐 WDS 或虚拟化
- **共存**：WDS 和虚拟化可以同时运行，互不干扰

---

## 26. 内置开发环境与 QD 模拟器（功能.qd/开发者.qd）

### 26.1 模块定位

奇点OS 内置完整的开发环境，开发者不需要额外安装工具链，开箱即用。包含编译器、调试器、SDK、模板、以及 **QD 模拟器**（Windows 端模拟 Linux 内核跑起点OS）。

**模块位置**：`/系统/功能.qd/开发者.qd/`

### 26.2 模块结构

```
开发者.qd/
├── module.qdmeta              # 模块元数据
├── toolchain.qds              # 编译工具链服务（管理编译器/链接器/构建工具）
├── debugger.qds               # 调试器服务（GDB/LLDB 封装，远程调试）
├── qd_emulator.qds            # QD 模拟器（Windows 端模拟 Linux 内核跑起点OS）
├── sdk.qds                    # 奇点OS SDK 服务（头文件/库/文档/示例）
├── templates/                 # 模块模板
│   ├── system_module/         # 系统模块模板
│   ├── user_module/           # 用户模块模板
│   ├── qds_service/           # .qds 服务模板（C/Rust/Go）
│   └── qdai_rule/             # .qdai 规则模板
├── docs/                      # 开发文档
│   ├── api_reference/         # API 参考
│   ├── tutorials/             # 教程
│   └── examples/              # 示例代码
├── dev_ai.qdai                # 开发者 AI 规则（代码补全/错误诊断/优化建议）
└── .git/                      # 独立 Git 仓库
```

### 26.3 编译工具链（toolchain.qds）

| 工具 | 说明 | 版本 |
|------|------|------|
| **GCC** | C/C++ 编译器 | 13.x |
| **Clang/LLVM** | C/C++/Objective-C 编译器 | 17.x |
| **Rustc** | Rust 编译器 | 1.7x |
| **Go** | Go 编译器 | 1.2x |
| **Zig** | Zig 编译器（实验性） | 0.1x |
| **Make** | 构建工具 | 4.x |
| **CMake** | 构建系统生成器 | 3.2x |
| **Ninja** | 快速构建工具 | 1.1x |
| **qd-build** | 奇点OS 构建工具（封装交叉编译/打包/签名） | 1.0 |
| **qd-pack** | .qds 打包工具 | 1.0 |
| **qd-new** | 模块/规则模板生成工具 | 1.0 |
| **qd-validate** | 格式验证工具（.qd/.qds/.qdai） | 1.0 |

**交叉编译支持**：
- aarch64-linux-musl（奇点OS 原生，优先）
- x86_64-linux-musl（PC 版奇点OS）
- armv7-linux-musl（旧设备兼容）
- riscv64-linux-musl（未来支持）

### 26.4 调试器（debugger.qds）

| 功能 | 说明 |
|------|------|
| **源码级调试** | 断点、单步、变量查看、调用栈、反汇编 |
| **远程调试** | 通过网络调试另一台奇点OS 设备上的进程 |
| **附加调试** | 附加到正在运行的进程 |
| **核心转储分析** | 分析崩溃进程的 core dump |
| **性能分析** | CPU 采样、内存分配追踪、热点函数分析 |
| **系统调用追踪** | strace 功能，追踪进程的系统调用 |
| **日志查看** | 实时查看系统日志、模块日志、AI.qd 日志 |

### 26.5 QD 模拟器（qd_emulator.qds）

**定位**：Windows 端的奇点OS 模拟器，让开发者在 Windows PC 上不用刷机就能体验和开发奇点OS。

**重要限制**：
- ✅ **仅支持 Windows**（Windows 10/11，x86_64）
- ❌ **不支持安卓**（安卓上用奇点OS mini APK）
- ❌ **不支持 macOS/Linux**（Linux 上可以用容器或 QEMU，macOS 用 UTM/QEMU）

**实现原理**：

```
Windows 主机
  ├── QD 模拟器（Windows 原生程序，C++ 编写）
  │   ├── 轻量级 Hypervisor（基于 Windows Hypervisor Platform / Intel HAXM）
  │   │   └── 模拟 aarch64 或 x86_64 的 Linux 内核运行环境
  │   ├── 虚拟硬件模拟
  │   │   ├── CPU（aarch64 模拟 / x86_64 原生）
  │   │   ├── 内存（可配置，默认 2GB）
  │   │   ├── 存储（虚拟磁盘文件 .qcow2）
  │   │   ├── 网络（NAT / 桥接）
  │   │   ├── 显示（虚拟 GPU，窗口渲染）
  │   │   ├── 输入（鼠标/键盘映射）
  │   │   └── 音频（虚拟声卡）
  │   ├── 奇点OS 系统镜像（内置，可更新）
  │   │   ├── Linux 内核（模拟环境中运行）
  │   │   ├── 奇点OS 用户空间
  │   │   └── 预装开发工具
  │   ├── 共享功能
  │   │   ├── 共享剪贴板（Windows ↔ 奇点OS）
  │   │   ├── 共享文件夹（Windows 目录挂载到奇点OS）
  │   │   └── 文件拖拽（拖拽文件到模拟器窗口）
  │   └── 调试接口
  │       ├── ADB 兼容接口（可用 adb connect 连接）
  │       ├── SSH 服务（可 SSH 连接）
  │       └── 串口控制台
  └── 模拟器管理工具（Windows GUI / 命令行）
      ├── 创建/删除模拟器实例
      ├── 启动/停止模拟器
      ├── 配置（CPU/内存/磁盘/网络）
      ├── 快照管理
      └── 系统镜像更新
```

**两种运行模式**：

| 模式 | 说明 | 性能 | 适用场景 |
|------|------|------|---------|
| **x86_64 原生模式** | 奇点OS x86_64 版直接在 Hypervisor 上运行，不模拟 CPU | 高（接近原生） | 开发测试、日常使用 |
| **aarch64 模拟模式** | 模拟 aarch64 CPU，运行奇点OS aarch64 版 | 中（有 CPU 模拟开销） | 测试 ARM 版兼容性、ARM 模块开发 |

**模拟器 vs mini APK vs 刷机版**：

| 特性 | QD 模拟器（Windows） | mini APK（安卓） | 刷机版（真机） |
|------|---------------------|-----------------|--------------|
| 运行环境 | Windows Hypervisor | 安卓 proot 容器 | 真机直接运行 |
| 完整度 | 95%（接近完整系统） | 60%（无图形桌面） | 100% |
| 性能 | 高（PC 性能） | 中（受限于手机和容器） | 最高（原生） |
| 图形界面 | ✅ 完整图形桌面 | ❌ Web 界面 | ✅ 完整图形桌面 |
| 开发调试 | ✅ 完整工具链 | ⚠️ 有限 | ✅ 完整工具链 |
| 适用人群 | 开发者、PC 用户 | 手机用户、体验者 | 主力机用户 |

### 26.6 SDK（sdk.qds）

包含完整的奇点OS 开发套件：
- 系统头文件（`qd/qd.h`、`qd/ipc.h`、`qd/config.h`、`qd/module.h` 等）
- 系统库（libqd、libqd-ipc、libqd-config、libqd-ui 等）
- API 文档（自动生成，可离线查看）
- 示例代码（10+ 完整示例，覆盖各种模块类型）
- 迁移指南（从其他平台迁移到奇点OS）

### 26.7 开发者 AI 辅助（dev_ai.qdai）

- 代码补全：基于上下文自动补全代码
- 错误诊断：编译错误时 AI 分析原因并给出修复建议
- 代码优化：AI 分析代码性能问题，给出优化建议
- 文档生成：自动为代码生成注释和文档
- 模块生成：用自然语言描述需求，AI 生成模块骨架代码
- 调试辅助：崩溃时 AI 分析调用栈，定位问题原因

---

## 27. 远程桌面与多屏协同（微服务.qd）

### 27.1 模块定位

微服务.qd 内置远程桌面和多屏协同服务，实现：
- **远程桌面**：远程控制奇点OS 设备、实时屏幕浏览
- **多屏协同**：奇点OS 设备之间（mini版 ↔ 刷机版 ↔ 模拟器）相互投屏、共享键鼠、同步剪贴板
- **文件传输**：跨设备快速传输文件

**模块位置**：`/系统/微服务.qd/`（服务端常驻）

### 27.2 服务组成

```
微服务.qd/
├── microsrv.qds              # 微型服务器主程序（服务管理/调度）
├── remote_desktop.qds        # 远程桌面服务（VNC/RDP，远程控制+实时浏览）
├── multi_screen.qds          # 多屏协同服务（跨设备投屏/共享键鼠/剪贴板同步）
├── file_transfer.qds         # 跨设备文件传输服务
├── microsrv.qdai             # AI 标记配置（安全规则/连接管理/性能优化）
└── .git/
```

### 27.3 远程桌面服务（remote_desktop.qds）

**功能**：

| 功能 | 说明 |
|------|------|
| **远程控制** | 远程操作奇点OS 设备（鼠标/键盘/触摸） |
| **实时浏览** | 实时查看远程设备屏幕（只读模式） |
| **多客户端** | 支持多个客户端同时连接（可配置权限） |
| **文件传输** | 远程桌面过程中拖拽文件传输 |
| **剪贴板同步** | 本地与远程设备剪贴板双向同步 |
| **音频传输** | 远程设备音频传输到本地（可选） |
| **会话录制** | 录制远程桌面会话（可选，需用户确认） |
| **唤醒远程设备** | 网络唤醒（WOL）支持 |

**协议支持**：

| 协议 | 说明 | 优先级 |
|------|------|--------|
| **VNC（RFB）** | 简单、跨平台、开源，第一版实现 | P0 |
| **RDP** | 性能好、有音频、Windows 原生兼容，第二版 | P1 |
| **SPICE** | 性能好、USB 重定向、视频加速，可选 | P2 |
| **自定义协议** | 基于 QD-IPC 优化，长期目标 | P3 |

**安全机制**：
- 密码认证（连接时需要密码）
- 白名单（只允许指定 IP/设备连接）
- 加密传输（TLS 加密所有数据）
- 连接确认（有人连接时弹窗提示用户确认）
- 权限分级（只读/可控制/管理员）
- 会话超时（无操作自动断开）

**使用场景**：
- 技术支持：远程帮用户解决问题
- 远程办公：在公司电脑上操作家里的奇点OS 设备
- 远程开发：远程连接到开发设备进行调试
- 云电脑：奇点OS 跑在服务器上，瘦客户端远程连接

### 27.4 多屏协同服务（multi_screen.qds）

**核心理念**：奇点OS 设备（mini版、刷机版、QD模拟器）之间可以无缝协同，像一台设备一样使用。

**支持的设备组合**：

| 主控端 ↔ 被控端 | 投屏 | 共享键鼠 | 剪贴板同步 | 文件拖拽 |
|----------------|------|---------|-----------|---------|
| 刷机版 ↔ 刷机版 | ✅ | ✅ | ✅ | ✅ |
| 刷机版 ↔ mini版 | ✅ | ✅ | ✅ | ✅ |
| 刷机版 ↔ QD模拟器 | ✅ | ✅ | ✅ | ✅ |
| mini版 ↔ mini版 | ✅ | ✅ | ✅ | ✅ |
| mini版 ↔ QD模拟器 | ✅ | ✅ | ✅ | ✅ |

**功能列表**：

| 功能 | 说明 |
|------|------|
| **屏幕投屏** | 一台设备的屏幕投射到另一台设备显示（支持扩展屏/复制屏） |
| **共享键鼠** | 一套键鼠控制多台设备（鼠标移到屏幕边缘自动切换到另一台设备） |
| **剪贴板同步** | 复制的文本/图片/文件自动同步到所有协同设备 |
| **文件拖拽** | 在设备之间拖拽文件（类似在两个窗口之间拖拽） |
| **应用接力** | 在一台设备上打开的应用/文档，到另一台设备继续编辑 |
| **通知同步** | 一台设备的通知同步显示到其他设备 |
| **通话接力** | 手机上来电，可以在平板/电脑上接听 |
| **网络共享** | 一台设备的网络共享给其他设备（热点/蓝牙共享） |
| **跨设备搜索** | 搜索时同时搜索所有协同设备的文件和应用 |

**连接方式**：
- 无线连接（WiFi 局域网，自动发现）
- 有线连接（USB / 网线，更稳定更低延迟）
- 蓝牙发现 + WiFi 直连传输（类似苹果 AirDrop 的发现机制）

**发现协议**：
- 基于 mDNS/DNS-SD 的设备发现（类似 Bonjour）
- 设备广播：`_qidian-os._tcp.local`
- 自动发现同一局域网内的奇点OS 设备
- 支持手动输入 IP 连接

**安全机制**：
- 设备配对（首次连接需要双方确认，类似蓝牙配对）
- 端到端加密
- 权限管理（每台设备可以设置允许哪些设备协同）
- 一键断开（紧急情况下断开所有协同连接）

### 27.5 文件传输服务（file_transfer.qds）

**功能**：
- 设备之间快速传输文件（类似 AirDrop）
- 支持断点续传
- 支持文件夹传输
- 支持大文件（GB 级）
- 传输进度实时显示
- 传输完成通知

**传输方式**：
- WiFi 直连（最快，不经过路由器）
- WiFi 局域网
- 有线连接（USB/网线，最稳定）
- 蓝牙（小文件，低功耗）

### 27.6 AI.qd 调度规则（microsrv.qdai）

- 检测到同一账号的多台奇点OS 设备时，自动提示开启多屏协同
- 根据网络质量自动调整投屏帧率和分辨率
- 设备电量低时自动降低投屏帧率，节省电量
- 检测到恶意连接尝试时自动拉黑并通知用户
- 定期清理过期的设备配对记录

---

## 28. 投屏功能（界面.qd/投屏.qd）

### 28.1 模块定位

投屏功能负责奇点OS 设备与外部显示设备（电视、显示器、投影仪）之间的屏幕投射。与多屏协同（奇点OS ↔ 奇点OS）不同，投屏是奇点OS ↔ 外部设备。

**模块位置**：`/系统/界面.qd/投屏.qd/`

### 28.2 模块结构

```
投屏.qd/
├── module.qdmeta              # 模块元数据
├── screen_cast.qds            # 投屏服务（输出+接收）
├── cast_ai.qdai               # 投屏 AI 规则（自动发现/性能优化/异常恢复）
├── protocols/                 # 协议实现
│   ├── miracast.qds           # Miracast 协议（WiFi 直连投屏）
│   ├── dlna.qds               # DLNA 协议（媒体推送）
│   ├── hdmi.qds               # HDMI 有线输出（通过 USB-C DP Alt Mode）
│   └── airplay.qds            # AirPlay 兼容（可选，投到苹果设备）
└── .git/
```

### 28.3 投屏输出（奇点OS → 外部显示）

| 协议 | 说明 | 适用设备 | 延迟 | 画质 |
|------|------|---------|------|------|
| **Miracast** | WiFi 直连投屏，不需要路由器 | 支持 Miracast 的电视/显示器/投影仪 | 中（100-200ms） | 1080p/4K |
| **DLNA** | 媒体推送（视频/图片/音乐），不是屏幕镜像 | 智能电视、电视盒子 | 低 | 取决于源文件 |
| **HDMI** | 有线输出（USB-C DP Alt Mode / HDMI 接口） | 显示器、电视、投影仪 | 极低（<10ms） | 最高（原生分辨率） |
| **AirPlay** | 投到苹果设备（Apple TV / Mac） | Apple TV、Mac | 中 | 1080p |

**功能**：
- 屏幕镜像（完整复制屏幕内容）
- 扩展屏（把外接显示器作为扩展桌面）
- 仅媒体输出（只把视频/音频输出到外接显示，主屏继续用）
- 分辨率自适应（自动匹配外接显示器的最佳分辨率）
- 旋转支持（外接显示器可以旋转）
- 多显示器支持（同时连接多个外接显示器）
- 投屏时自动关闭主屏（省电，可选）
- 投屏通知（投屏状态在通知栏显示，可一键断开）

### 28.4 投屏接收（外部设备 → 奇点OS）

奇点OS 设备也可以作为投屏接收端，显示其他设备投射的内容：

| 来源设备 | 协议 | 说明 |
|---------|------|------|
| 安卓手机 | Miracast / Google Cast | 安卓手机投屏到奇点OS 设备 |
| 苹果手机 | AirPlay | iPhone/iPad 投屏到奇点OS 设备 |
| Windows PC | Miracast | Windows 电脑投屏到奇点OS 设备 |
| Mac | AirPlay | Mac 投屏到奇点OS 设备 |

**接收模式**：
- 窗口模式（投屏内容显示在一个窗口里，可以调整大小）
- 全屏模式（投屏内容全屏显示）
- 画中画（投屏内容显示在小窗口里，悬浮在其他应用上面）

### 28.5 与多屏协同的区别

| 特性 | 投屏（投屏.qd） | 多屏协同（微服务.qd） |
|------|----------------|---------------------|
| 设备范围 | 奇点OS ↔ 外部设备（电视/显示器/手机/电脑） | 奇点OS ↔ 奇点OS |
| 功能 | 屏幕投射、媒体推送 | 投屏+共享键鼠+剪贴板+文件拖拽+应用接力 |
| 交互 | 单向（主要是显示） | 双向（完全协同） |
| 协议 | Miracast/DLNA/HDMI/AirPlay | 自定义协议（基于 QD-IPC） |
| 需要配对 | 不需要（发现即连） | 需要（设备配对） |

---

## 29. 系统预览方式（不刷机怎么体验）

### 29.1 总览

奇点OS 提供多种不刷机的预览/体验方式，从简单到完整：

| 方式 | 完整度 | 性能 | 难度 | 适用人群 |
|------|--------|------|------|---------|
| **① 奇点OS mini APK** | 60% | 中 | 极低（装个APK） | 手机用户、快速体验 |
| **② QD 模拟器（Windows）** | 95% | 高 | 低（装个软件） | 开发者、PC 用户 |
| **③ 远程桌面（连接已有设备）** | 100% | 取决于网络 | 中 | 有奇点OS 设备的用户 |
| **④ Live USB（U盘启动）** | 100% | 高（真机） | 中 | 想完整体验但不装硬盘 |
| **⑤ 容器预览（Docker/LXC）** | 70% | 高 | 高 | Linux 开发者 |

### 29.2 方式一：奇点OS mini APK（最简单）

**是什么**：安卓手机上安装一个 APK，在 proot 容器里跑奇点OS 的核心功能，用 Web 界面交互。

**已有实现**：当前项目就是 mini APK 版，包含：
- proot 容器（非 root 的 Linux 环境模拟）
- MNN 推理引擎（本地 AI）
- INTENT Agent（屏幕操纵）
- Web 界面（消息/通讯录/知识库/应用/设置）
- 开机动画、图标、主题切换

**限制**：
- 没有完整图形桌面（用 Web 界面代替）
- 没有内核级特性（无法使用 KVM、namespace 等）
- 性能受限于容器 overhead
- 兼容层（WDS/ANZ）功能有限

**适合**：快速体验 AI 功能、模块开发、日常使用

### 29.3 方式二：QD 模拟器（Windows，推荐开发者）

**是什么**：在 Windows PC 上安装 QD 模拟器，模拟器里模拟 Linux 内核运行环境，跑完整的奇点OS。

**详细设计**：见第 26.5 节

**优势**：
- 接近完整的奇点OS 体验（95%）
- 完整图形桌面
- 完整开发工具链
- 性能好（PC 性能）
- 不影响 Windows 系统（沙箱隔离）
- 可以随时删除，不留痕迹

**限制**：
- 仅支持 Windows（不支持安卓/macOS/Linux）
- 需要开启虚拟化（BIOS 里开启 VT-x/AMD-V）
- 有一定的性能开销（Hypervisor 层）

**适合**：开发者、想在 PC 上完整体验奇点OS 的用户

### 29.4 方式三：远程桌面（连接已有奇点OS 设备）

**是什么**：如果已经有一台设备刷了奇点OS，可以通过远程桌面在其他设备上使用它。

**详细设计**：见第 27.3 节

**使用场景**：
- 奇点OS 刷在开发板/迷你主机上，放在家里，手机/电脑远程连接使用
- 公司电脑远程连接家里的奇点OS 设备
- 技术支持人员远程连接用户设备排查问题

**优势**：
- 100% 完整的奇点OS 体验（因为就是在用真机）
- 数据集中存储（所有数据在真机上，不怕客户端丢失）
- 可以用低配设备访问高配奇点OS 设备（云电脑模式）

**限制**：
- 需要有一台已经刷了奇点OS 的设备
- 依赖网络质量（延迟、带宽）
- 局域网外需要内网穿透或公网 IP

### 29.5 方式四：Live USB（U盘启动，完整体验）

**是什么**：把奇点OS 写入 U 盘，电脑从 U 盘启动，不修改硬盘上的任何数据。

**制作方式**：
1. 下载奇点OS x86_64 Live 镜像（.iso）
2. 用 Rufus / balenaEtcher / dd 写入 U 盘
3. 电脑从 U 盘启动（BIOS 里设置 U 盘为第一启动项）
4. 进入奇点OS Live 环境

**优势**：
- 100% 完整的奇点OS 体验（真机运行）
- 不碰硬盘（所有改动在内存里，重启后消失）
- 可以测试硬件兼容性（无线网卡、显卡、声卡等）
- 可以在 U 盘里保存数据（Persistent 分区，可选）

**限制**：
- 需要 x86_64 PC（不支持 ARM 设备）
- U 盘速度影响体验（建议 USB 3.0 以上）
- 不能保存数据（除非设置 Persistent 分区）
- 性能比安装到硬盘稍差

**适合**：想完整体验奇点OS 但不想安装到硬盘的用户、硬件兼容性测试

### 29.6 方式五：容器预览（Docker/LXC，Linux 开发者）

**是什么**：在 Linux PC 上用 Docker 或 LXC 容器跑奇点OS 用户空间。

**优势**：
- 轻量（容器 overhead 很小）
- 快速启动（秒级启动）
- 适合测试服务、模块、API
- 可以同时跑多个实例

**限制**：
- 没有内核级特性（用的是主机 Linux 内核）
- 没有图形桌面（只能用命令行或 Web 界面）
- 需要 Linux 主机（Windows 上用 WSL2 也可以）
- 硬件访问受限

**适合**：Linux 开发者、快速测试服务和模块

### 29.7 推荐路径

```
想快速体验 → ① mini APK（装个APK就行）
     ↓
想在PC上开发/完整体验 → ② QD 模拟器（Windows）
     ↓
有真机了想远程用 → ③ 远程桌面
     ↓
想测试硬件兼容性 → ④ Live USB
     ↓
决定长期使用 → 刷机（正式版）
```

---

## 附录

### A. 错误码大全

| 错误码 | 名称 | 说明 |
|-------|------|------|
| 0 | QD_OK | 成功 |
| 1 | QD_ERR_INVALID_PARAM | 无效参数 |
| 2 | QD_ERR_NOT_FOUND | 服务/模块/文件不存在 |
| 3 | QD_ERR_PERMISSION_DENIED | 权限不足 |
| 4 | QD_ERR_DEPENDENCY_MISSING | 依赖缺失 |
| 5 | QD_ERR_NO_MEMORY | 内存不足 |
| 6 | QD_ERR_TIMEOUT | 超时 |
| 7 | QD_ERR_MODULE_CRASHED | 模块崩溃 |
| 8 | QD_ERR_VERSION_INCOMPATIBLE | 版本不兼容 |
| 9 | QD_ERR_AI_DENIED | AI.qd 拒绝 |
| 10 | QD_ERR_DIRECT_TRANSFER_UNAUTHORIZED | 直连通道未授权 |
| 11 | QD_ERR_QUARANTINE_CONFLICT | 隔离层冲突 |
| 12 | QD_ERR_HAL_FAILURE | HAL 调用失败 |
| 13 | QD_ERR_IPC_FAILURE | IPC 通信失败 |
| 14 | QD_ERR_STORAGE_FULL | 存储空间满 |
| 15 | QD_ERR_DEVICE_ERROR | 设备错误 |
| 16 | QD_ERR_NETWORK_ERROR | 网络错误 |
| 17 | QD_ERR_AI_DEGRADED | AI.qd 降级模式 |
| 18 | QD_ERR_SAFE_MODE | 安全模式 |
| 19 | QD_ERR_UNKNOWN | 未知错误 |
| 20 | QD_ERR_MISSING_META | .qd 缺少 module.qdmeta |
| 21 | QD_ERR_INVALID_QDS_HEADER | .qds 文件头 magic 不匹配 |
| 22 | QD_ERR_ARCH_INCOMPATIBLE | .qds 架构不匹配 |
| 23 | QD_ERR_QDS_CORRUPTED | .qds 文件损坏（大小不匹配） |
| 24 | QD_ERR_QDS_SIGNATURE_INVALID | .qds 签名验证失败 |
| 25 | QD_ERR_QDS_ENTRY_NOT_FOUND | .qds 入口函数未找到 |
| 26 | QD_ERR_QDAI_PARSE_WARN | .qdai 解析警告（降级处理） |
| 27 | QD_ERR_QDAI_RULE_INVALID | .qdai 结构化规则 JSON 语法错误 |
| 28 | QD_ERR_QDAI_SEMANTIC_ERROR | .qdai 规则引用不存在的 API/变量 |
| 29 | QD_ERR_SECURITY_VIOLATION | 安全策略违规 |
| 30 | QD_ERR_AI_TRANSLATE_FAILED | AI 转译失败（重试3次后） |
| 31 | QD_ERR_LUA_SYNTAX_ERROR | Lua 脚本语法错误 |
| 32 | QD_ERR_LUA_TIMEOUT | Lua 脚本执行超时 |
| 33 | QD_ERR_LUA_MEMORY_LIMIT | Lua 脚本内存超限 |
| 34 | QD_ERR_CONDITION_EVAL_ERROR | condition 表达式求值错误 |
| 35 | QD_ERR_API_NOT_FOUND | 系统 API 不存在 |
| 36 | QD_ERR_API_PARAM_INVALID | API 参数不符合 Schema |
| 37 | QD_ERR_JUMP_DEPTH_EXCEEDED | .qdai 跳转深度超限 |
| 38 | QD_ERR_WATCHDOG_TIMEOUT | 看门狗超时（系统挂死） |
| 39 | QD_ERR_OOM_KILL | OOM killer 杀死进程 |
| 40 | QD_ERR_FILE_READ_ERROR | 文件读取错误 |
| 41 | QD_ERR_FILE_WRITE_ERROR | 文件写入错误 |
| 42 | QD_ERR_JSON_PARSE_ERROR | JSON 解析错误 |
| 43 | QD_ERR_YAML_PARSE_ERROR | YAML 解析错误 |
| 44 | QD_ERR_ELF_INVALID | ELF 格式无效 |
| 45 | QD_ERR_DYNAMIC_LIB_MISSING | 动态链接库缺失 |
| 46 | QD_ERR_SERVICE_NOT_RESPONDING | 服务无响应（心跳超时） |
| 47 | QD_ERR_UPDATE_FAILED | 系统更新失败 |
| 48 | QD_ERR_UPDATE_ROLLBACK | 系统更新回滚 |
| 49 | QD_ERR_BACKUP_FAILED | 备份失败 |
| 50 | QD_ERR_RESTORE_FAILED | 恢复失败 |

**错误码命名空间**：
- 0-99：系统通用错误码
- 100-199：模块自定义错误码（模块ID<<8 | 错误码）
- 200+：应用自定义错误码

### B. 权限标识大全

| 权限标识 | 说明 | 风险等级 |
|---------|------|---------|
| display | 显示访问（创建窗口、截图） | 中 |
| input | 输入访问（读取触摸/键盘事件） | 高 |
| memory | 共享内存访问 | 中 |
| storage | 存储读写（用户文件） | 高 |
| network | 网络访问 | 中 |
| direct_transfer | 数据直连通道 | 中 |
| camera | 相机访问 | 高 |
| microphone | 麦克风访问 | 高 |
| location | 位置信息（GPS/网络定位） | 高 |
| sensors | 传感器访问（加速度计/陀螺仪等） | 低 |
| bluetooth | 蓝牙访问 | 中 |
| usb | USB 设备访问 | 中 |
| nfc | NFC 访问 | 低 |
| phone | 电话/短信 | 高 |
| contacts | 通讯录读取 | 高 |
| calendar | 日历读取/修改 | 中 |
| notification | 发送通知 | 低 |
| clipboard | 读取剪贴板 | 中 |
| system_config | 系统配置修改 | 高 |
| process_manage | 进程管理（杀死/调整优先级） | 高 |
| module_manage | 模块管理（安装/卸载/更新） | 高 |
| ai_memory | AI 记忆访问 | 高 |
| security_policy | 安全策略修改（需用户确认） | 极高 |
| power_manage | 电源管理（重启/关机/休眠） | 高 |
| wallpaper | 设置壁纸 | 低 |
| boot_animation | 修改开机动画 | 中 |
| background_audio | 后台音频播放 | 低 |
| background_location | 后台位置更新 | 高 |
| background_download | 后台下载 | 低 |
| voip | 网络电话 | 中 |
| accessibility | 无障碍服务（读取屏幕内容/模拟输入） | 极高 |
| system_alert_window | 系统级悬浮窗 | 高 |
| package_install | 安装应用/模块 | 高 |
| external_storage | 外部存储（SD卡/U盘） | 中 |
| wake_lock | 唤醒锁（阻止系统休眠） | 中 |
| read_logs | 读取系统日志 | 中 |

**权限等级说明**：
- 低：默认授予，用户可关闭
- 中：安装时声明，用户可在设置中管理
- 高：运行时申请，用户弹窗确认，可随时撤销
- 极高：需用户密码/生物识别确认，AI.qd 修改需额外确认

### C. 系统状态变量注册表

condition 表达式可引用的系统状态变量完整列表。执行层维护全局状态变量树，变量值实时更新。

| 变量路径 | 类型 | 说明 | 更新频率 |
|---------|------|------|---------|
| **应用状态** | | | |
| `app.foreground.package` | string | 前台应用包名 | 事件驱动 |
| `app.foreground.type` | string | 前台应用类型（game/media/tool/system/other） | 事件驱动 |
| `app.foreground.state` | string | 前台应用状态（running/frozen/crashed） | 事件驱动 |
| `app.foreground.pid` | number | 前台应用 PID | 事件驱动 |
| `app.foreground.cpu_usage` | number | 前台应用 CPU 使用率 | 1秒 |
| `app.foreground.memory_mb` | number | 前台应用内存使用（MB） | 1秒 |
| `previous.foreground.package` | string | 上一个前台应用包名 | 事件驱动 |
| `previous.foreground.type` | string | 上一个前台应用类型 | 事件驱动 |
| `app.count_running` | number | 正在运行的应用数量 | 事件驱动 |
| `app.count_frozen` | number | 被冻结的应用数量 | 事件驱动 |
| **CPU** | | | |
| `cpu.usage` | number | CPU 总使用率（0-100） | 1秒 |
| `cpu.usage_big` | number | 大核使用率（0-100） | 1秒 |
| `cpu.usage_little` | number | 小核使用率（0-100） | 1秒 |
| `cpu.temperature` | number | CPU 温度（摄氏度） | 5秒 |
| `cpu.frequency_max_mhz` | number | CPU 最大频率（MHz） | 事件驱动 |
| `cpu.frequency_current_mhz` | number | CPU 当前频率（MHz） | 1秒 |
| `cpu.governor` | string | CPU 调频策略 | 事件驱动 |
| **内存** | | | |
| `memory.usage` | number | 内存使用率（0-100） | 1秒 |
| `memory.total_mb` | number | 总内存（MB） | 启动时 |
| `memory.available_mb` | number | 可用内存（MB） | 1秒 |
| `memory.used_mb` | number | 已用内存（MB） | 1秒 |
| `memory.swap_used_mb` | number | Swap 使用（MB） | 1秒 |
| `memory.low_memory` | boolean | 是否低内存（<10%可用） | 事件驱动 |
| **GPU** | | | |
| `gpu.usage` | number | GPU 使用率（0-100） | 1秒 |
| `gpu.temperature` | number | GPU 温度（摄氏度） | 5秒 |
| `gpu.frequency_mhz` | number | GPU 当前频率 | 1秒 |
| **电池** | | | |
| `battery.level` | number | 电量百分比（0-100） | 事件驱动 |
| `battery.charging` | boolean | 是否在充电 | 事件驱动 |
| `battery.charge_type` | string | 充电类型（none/ac/usb/wireless） | 事件驱动 |
| `battery.temperature` | number | 电池温度（摄氏度） | 5秒 |
| `battery.health` | string | 电池健康状态（good/overheat/dead/unknown） | 事件驱动 |
| `battery.voltage_mv` | number | 电池电压（mV） | 5秒 |
| `battery.estimated_time_min` | number | 预计剩余使用时间（分钟） | 1分钟 |
| **网络** | | | |
| `network.type` | string | 网络类型（wifi/mobile/ethernet/none） | 事件驱动 |
| `network.connected` | boolean | 是否已连接网络 | 事件驱动 |
| `network.ssid` | string | 当前 WiFi SSID | 事件驱动 |
| `network.signal_strength` | number | 信号强度（0-100） | 5秒 |
| `network.download_speed_kbps` | number | 下载速度（KB/s） | 1秒 |
| `network.upload_speed_kbps` | number | 上传速度（KB/s） | 1秒 |
| `network.vpn_active` | boolean | VPN 是否激活 | 事件驱动 |
| **屏幕** | | | |
| `screen.state` | string | 屏幕状态（on/off/locked） | 事件驱动 |
| `screen.orientation` | string | 屏幕方向（portrait/landscape） | 事件驱动 |
| `screen.brightness` | number | 屏幕亮度（0-255） | 事件驱动 |
| `screen.width_px` | number | 屏幕宽度（像素） | 启动时 |
| `screen.height_px` | number | 屏幕高度（像素） | 启动时 |
| `screen.dpi` | number | 屏幕 DPI | 启动时 |
| `screen.refresh_rate_hz` | number | 屏幕刷新率（Hz） | 启动时 |
| `screen.fps` | number | 当前帧率 | 1秒 |
| **时间** | | | |
| `time.timestamp` | number | 当前 Unix 时间戳（秒） | 实时 |
| `time.hour` | number | 当前小时（0-23） | 事件驱动 |
| `time.minute` | number | 当前分钟（0-59） | 事件驱动 |
| `time.day_of_week` | number | 星期几（0=周日，6=周六） | 事件驱动 |
| `time.day_of_month` | number | 日期（1-31） | 事件驱动 |
| `time.month` | number | 月份（1-12） | 事件驱动 |
| `time.year` | number | 年份 | 事件驱动 |
| `time.timezone` | string | 时区（如 Asia/Shanghai） | 启动时 |
| **系统** | | | |
| `system.boot_time` | number | 系统启动时间戳 | 启动时 |
| `system.uptime_seconds` | number | 系统运行时间（秒） | 实时 |
| `system.version` | string | 系统版本号 | 启动时 |
| `system.api_level` | number | 系统 API 级别 | 启动时 |
| `system.safe_mode` | boolean | 是否安全模式 | 事件驱动 |
| `system.module_count` | number | 已加载模块数量 | 事件驱动 |
| `system.service_count` | number | 正在运行的服务数量 | 事件驱动 |
| **AI.qd** | | | |
| `ai.qd.state` | string | AI.qd 状态（ready/loading/degraded/error） | 事件驱动 |
| `ai.qd.model_loaded` | boolean | AI 模型是否已加载 | 事件驱动 |
| `ai.qd.model_name` | string | 当前模型名称 | 事件驱动 |
| `ai.qd.inference_speed_tps` | number | 推理速度（tokens/s） | 5秒 |
| `ai.qd.context_tokens` | number | 当前上下文 token 数 | 事件驱动 |
| `ai.qd.memory_usage_mb` | number | AI 内存使用（MB） | 1秒 |
| **存储** | | | |
| `storage.internal_total_gb` | number | 内部存储总量（GB） | 启动时 |
| `storage.internal_used_gb` | number | 内部存储已用（GB） | 1分钟 |
| `storage.internal_available_gb` | number | 内部存储可用（GB） | 1分钟 |
| `storage.external_mounted` | boolean | 外部存储是否挂载 | 事件驱动 |
| **传感器** | | | |
| `sensors.accelerometer.x` | number | 加速度计 X 轴 | 实时 |
| `sensors.accelerometer.y` | number | 加速度计 Y 轴 | 实时 |
| `sensors.accelerometer.z` | number | 加速度计 Z 轴 | 实时 |
| `sensors.gyroscope.x` | number | 陀螺仪 X 轴 | 实时 |
| `sensors.gyroscope.y` | number | 陀螺仪 Y 轴 | 实时 |
| `sensors.gyroscope.z` | number | 陀螺仪 Z 轴 | 实时 |
| `sensors.light_lux` | number | 光线传感器（lux） | 事件驱动 |
| `sensors.proximity` | boolean | 距离传感器（是否接近） | 事件驱动 |
| `sensors.magnetic_field.x` | number | 磁力计 X 轴 | 实时 |
| `sensors.magnetic_field.y` | number | 磁力计 Y 轴 | 实时 |
| `sensors.magnetic_field.z` | number | 磁力计 Z 轴 | 实时 |
| `sensors.pressure_hpa` | number | 气压计（hPa） | 5秒 |
| `sensors.temperature_c` | number | 温度传感器（摄氏度） | 5秒 |
| `sensors.humidity_percent` | number | 湿度传感器（%） | 5秒 |
| `sensors.step_count` | number | 步数计数器 | 事件驱动 |
| **位置** | | | |
| `location.latitude` | number | 纬度 | 事件驱动 |
| `location.longitude` | number | 经度 | 事件驱动 |
| `location.accuracy_m` | number | 精度（米） | 事件驱动 |
| `location.altitude_m` | number | 海拔（米） | 事件驱动 |
| `location.speed_ms` | number | 速度（m/s） | 事件驱动 |
| `location.provider` | string | 定位来源（gps/network/fused） | 事件驱动 |

**变量引用规则**：
- condition 表达式中用点号引用，如 `app.foreground.type`
- 不存在的变量返回 `null`，`null` 参与比较时为 `false`
- 变量值变化时触发 `variable_change` 事件，可作为 trigger
- 模块可注册自定义变量（通过 `qd_register_var(path, type, getter)`）

### D. 系统 API 注册表

可被 .qdai 的 action 调用的系统 API 完整列表。所有 API 通过 QD-IPC 调用。

**API 调用格式**：
```json
{
  "type": "system_call",
  "target": "分类.方法名",
  "params": { ... }
}
```

#### D.1 性能管理（performance）

| API | 说明 | 参数 | 所需权限 |
|-----|------|------|---------|
| `performance.set_mode` | 设置性能模式 | `mode`: "power_save"/"balanced"/"high_performance"/"performance" | system_config |
| `performance.set_cpu_governor` | 设置 CPU 调频策略 | `governor`: "powersave"/"balanced"/"performance"/"schedutil" | system_config |
| `performance.set_animation_scale` | 设置动画缩放 | `scale`: 0.0-2.0 | system_config |
| `performance.set_cpus_boost` | CPU  boost | `boost`: boolean | system_config |
| `performance.set_gpu_boost` | GPU boost | `boost`: boolean | system_config |
| `performance.get_current_mode` | 获取当前性能模式 | 无 | 无 |
| `performance.force_stop_app` | 强制停止应用 | `package`: 应用包名 | process_manage |

#### D.2 网络管理（network）

| API | 说明 | 参数 | 所需权限 |
|-----|------|------|---------|
| `network.set_bandwidth_limit` | 设置带宽限制 | `scope`: "background_apps"/"foreground_app"/"all", `limit_kbps`: 数字 | system_config |
| `network.set_proxy` | 设置代理 | `type`: "http"/"socks", `host`: 主机, `port`: 端口 | system_config |
| `network.set_dns` | 设置 DNS | `primary`: 主DNS, `secondary`: 备DNS | system_config |
| `network.set_wifi_enabled` | 开关 WiFi | `enabled`: boolean | system_config |
| `network.set_bluetooth_enabled` | 开关蓝牙 | `enabled`: boolean | system_config |
| `network.set_airplane_mode` | 飞行模式 | `enabled`: boolean | system_config |
| `network.set_vpn` | 配置 VPN | `type`, `server`, `username`, `password` | system_config |
| `network.get_network_info` | 获取网络信息 | 无 | 无 |

#### D.3 窗口管理（window）

| API | 说明 | 参数 | 所需权限 |
|-----|------|------|---------|
| `window.set_state` | 设置窗口状态 | `window_id`, `state`: "normal"/"maximized"/"minimized"/"fullscreen" | display |
| `window.set_size` | 设置窗口大小 | `window_id`, `width`, `height` | display |
| `window.set_position` | 设置窗口位置 | `window_id`, `x`, `y` | display |
| `window.move_to_front` | 窗口置顶 | `window_id` | display |
| `window.close` | 关闭窗口 | `window_id` | display |
| `window.screenshot` | 截图 | `window_id`: 可选，不传则全屏 | display |
| `window.get_list` | 获取窗口列表 | 无 | 无 |

#### D.4 进程管理（process）

| API | 说明 | 参数 | 所需权限 |
|-----|------|------|---------|
| `process.kill` | 杀死进程 | `pid` 或 `package` | process_manage |
| `process.set_priority` | 设置进程优先级 | `pid`, `priority`: -20 到 19 | process_manage |
| `process.freeze` | 冻结进程 | `pid` 或 `package` | process_manage |
| `process.thaw` | 解冻进程 | `pid` 或 `package` | process_manage |
| `process.get_list` | 获取进程列表 | 无 | 无 |
| `process.get_info` | 获取进程信息 | `pid` | 无 |

#### D.5 电源管理（power）

| API | 说明 | 参数 | 所需权限 |
|-----|------|------|---------|
| `power.set_screen_timeout` | 设置屏幕超时 | `seconds`: 超时秒数 | system_config |
| `power.set_brightness` | 设置亮度 | `value`: 0-255 | system_config |
| `power.set_brightness_auto` | 自动亮度 | `enabled`: boolean | system_config |
| `power.reboot` | 重启 | `reason`: 可选 | power_manage |
| `power.shutdown` | 关机 | `reason`: 可选 | power_manage |
| `power.suspend` | 休眠 | 无 | power_manage |
| `power.set_power_save_mode` | 省电模式 | `enabled`: boolean | system_config |
| `power.acquire_wake_lock` | 获取唤醒锁 | `tag`: 标签, `type`: "partial"/"full" | wake_lock |
| `power.release_wake_lock` | 释放唤醒锁 | `tag`: 标签 | wake_lock |

#### D.6 存储管理（storage）

| API | 说明 | 参数 | 所需权限 |
|-----|------|------|---------|
| `storage.mount` | 挂载存储 | `device`, `mount_point`, `fs_type` | system_config |
| `storage.unmount` | 卸载存储 | `mount_point` | system_config |
| `storage.set_cache_size` | 设置缓存大小 | `size_mb`: 大小 | system_config |
| `storage.clear_cache` | 清理缓存 | `scope`: "all"/"app", `package`: 可选 | system_config |
| `storage.get_info` | 获取存储信息 | 无 | 无 |

#### D.7 通知管理（notification）

| API | 说明 | 参数 | 所需权限 |
|-----|------|------|---------|
| `notification.send` | 发送通知 | `title`, `content`, `priority`, `actions`: 可选 | notification |
| `notification.cancel` | 取消通知 | `notification_id` | notification |
| `notification.cancel_all` | 取消所有通知 | 无 | notification |
| `notification.set_dnd_mode` | 免打扰模式 | `enabled`: boolean, `start_time`, `end_time`: 可选 | system_config |

#### D.8 日志管理（log）

| API | 说明 | 参数 | 所需权限 |
|-----|------|------|---------|
| `log.write` | 写日志 | `level`: "debug"/"info"/"warn"/"error", `tag`, `message` | 无 |
| `log.set_level` | 设置日志级别 | `level`: 全局日志级别 | read_logs |
| `log.get_logs` | 获取日志 | `tag`: 可选, `level`: 可选, `limit`: 可选 | read_logs |
| `log.clear` | 清空日志 | 无 | read_logs |

#### D.9 模块管理（module）

| API | 说明 | 参数 | 所需权限 |
|-----|------|------|---------|
| `module.load` | 加载模块 | `path`: 模块路径 | module_manage |
| `module.unload` | 卸载模块 | `id`: 模块ID | module_manage |
| `module.restart` | 重启模块 | `id`: 模块ID | module_manage |
| `module.get_list` | 获取模块列表 | 无 | 无 |
| `module.get_info` | 获取模块信息 | `id`: 模块ID | 无 |
| `module.install` | 安装模块 | `package_path`: 包路径 | package_install |
| `module.uninstall` | 卸载模块 | `id`: 模块ID, `keep_data`: 是否保留数据 | module_manage |

#### D.10 AI 管理（ai）

| API | 说明 | 参数 | 所需权限 |
|-----|------|------|---------|
| `ai.set_model` | 切换模型 | `model_name`: 模型名称, `model_path`: 模型路径 | ai_memory |
| `ai.set_threads` | 设置推理线程数 | `threads`: 1-8 | system_config |
| `ai.clear_context` | 清空上下文 | 无 | ai_memory |
| `ai.get_state` | 获取 AI 状态 | 无 | 无 |
| `ai.inference` | 同步推理 | `prompt`: 提示词, `max_tokens`: 最大token数 | ai_memory |
| `ai.reload_config` | 重新加载 AI 配置 | 无 | system_config |

#### D.11 系统配置（system）

| API | 说明 | 参数 | 所需权限 |
|-----|------|------|---------|
| `system.set_language` | 设置系统语言 | `locale`: 如 "zh_CN"/"en_US" | system_config |
| `system.set_timezone` | 设置时区 | `timezone`: 如 "Asia/Shanghai" | system_config |
| `system.set_time` | 设置系统时间 | `timestamp`: Unix时间戳 | system_config |
| `system.set_theme` | 设置主题 | `theme`: "dark"/"light"/"auto" | system_config |
| `system.set_orientation` | 设置屏幕方向 | `orientation`: "portrait"/"landscape"/"auto" | system_config |
| `system.get_config` | 获取系统配置 | `key`: 配置键（可选，不传返回全部） | 无 |
| `system.set_config` | 设置系统配置 | `key`, `value` | system_config |
| `system.factory_reset` | 恢复出厂设置 | `confirm`: 必须为 true | security_policy |

**API 扩展机制**：
- 模块可注册自定义 API（通过 `qd_register_api(name, params_schema, handler)`）
- 自定义 API 必须遵循命名规范：`模块分类.方法名`
- API 注册后自动加入 API 注册表，.qdai 可调用
- API 调用必须经过权限检查和参数 Schema 验证

### E. 事件系统

事件系统是 .qdai trigger 的基础。事件由系统服务发布，规则引擎订阅。

#### E.1 核心事件列表

| 事件名 | 说明 | 触发时机 | 事件数据 |
|--------|------|---------|---------|
| `system_boot` | 系统启动完成 | 系统完全启动后 | `boot_time`, `version` |
| `system_shutdown` | 系统即将关机 | 关机前 | `reason` |
| `app_state_change` | 应用状态变化 | 应用切换前台/后台/冻结/崩溃 | `package`, `old_state`, `new_state`, `pid` |
| `app_installed` | 应用安装完成 | 应用安装后 | `package`, `version`, `path` |
| `app_uninstalled` | 应用卸载完成 | 应用卸载后 | `package`, `keep_data` |
| `battery_level_change` | 电量变化 | 电量变化超过1%时 | `level`, `charging`, `old_level` |
| `battery_charging_change` | 充电状态变化 | 插入/拔出充电器时 | `charging`, `charge_type` |
| `battery_low` | 低电量警告 | 电量低于20%/10%/5%时 | `level`, `threshold` |
| `screen_state_change` | 屏幕状态变化 | 亮屏/灭屏/锁屏时 | `old_state`, `new_state` |
| `screen_orientation_change` | 屏幕方向变化 | 旋转屏幕时 | `old_orientation`, `new_orientation` |
| `network_state_change` | 网络状态变化 | 连接/断开/切换网络时 | `old_type`, `new_type`, `connected`, `ssid` |
| `network_signal_change` | 信号强度变化 | 信号变化超过10%时 | `type`, `strength`, `old_strength` |
| `cpu_overheat` | CPU 过热 | CPU温度超过阈值时 | `temperature`, `threshold` |
| `gpu_overheat` | GPU 过热 | GPU温度超过阈值时 | `temperature`, `threshold` |
| `battery_overheat` | 电池过热 | 电池温度超过阈值时 | `temperature`, `threshold` |
| `memory_low` | 低内存警告 | 可用内存低于10%/5%时 | `available_mb`, `threshold_percent` |
| `memory_oom` | OOM 事件 | OOM killer 杀死进程时 | `killed_pid`, `killed_package`, `freed_mb` |
| `process_crash` | 进程崩溃 | 进程异常退出时 | `pid`, `package`, `signal`, `exit_code` |
| `service_crash` | 系统服务崩溃 | 系统服务崩溃时 | `service_name`, `pid`, `reason` |
| `module_load` | 模块加载 | 模块加载完成时 | `module_id`, `module_name`, `version` |
| `module_unload` | 模块卸载 | 模块卸载时 | `module_id`, `module_name` |
| `ai_state_change` | AI.qd 状态变化 | AI 状态变化时 | `old_state`, `new_state` |
| `ai_model_loaded` | AI 模型加载完成 | 模型加载后 | `model_name`, `load_time_ms` |
| `ai_inference_complete` | AI 推理完成 | 推理完成后 | `prompt_tokens`, `output_tokens`, `time_ms`, `speed_tps` |
| `timer_1min` | 1分钟定时器 | 每分钟触发 | `timestamp` |
| `timer_5min` | 5分钟定时器 | 每5分钟触发 | `timestamp` |
| `timer_15min` | 15分钟定时器 | 每15分钟触发 | `timestamp` |
| `timer_hourly` | 每小时定时器 | 每小时触发 | `timestamp` |
| `timer_daily` | 每天定时器 | 每天0点触发 | `timestamp` |
| `variable_change` | 状态变量变化 | 任意系统状态变量变化时 | `path`, `old_value`, `new_value` |
| `sms_received` | 收到短信 | 收到短信时 | `sender`, `content`, `timestamp` |
| `call_incoming` | 来电 | 收到来电时 | `caller`, `timestamp` |
| `notification_clicked` | 通知被点击 | 用户点击通知时 | `notification_id`, `action` |
| `headphone_inserted` | 耳机插入 | 插入耳机时 | `type`: "wired"/"bluetooth" |
| `headphone_removed` | 耳机拔出 | 拔出耳机时 | `type` |
| `usb_device_attached` | USB 设备插入 | 插入 USB 设备时 | `device_name`, `vendor_id`, `product_id` |
| `usb_device_detached` | USB 设备拔出 | 拔出 USB 设备时 | `device_name` |
| `external_storage_mounted` | 外部存储挂载 | SD卡/U盘挂载时 | `mount_point`, `fs_type`, `size_gb` |
| `external_storage_unmounted` | 外部存储卸载 | 卸载时 | `mount_point` |
| `location_update` | 位置更新 | 位置变化时 | `latitude`, `longitude`, `accuracy_m` |
| `step_detected` | 计步事件 | 检测到一步时 | `step_count`, `total_steps` |
| `shake_detected` | 摇一摇 | 检测到摇晃时 | `intensity` |
| `flip_to_mute` | 翻转静音 | 手机翻转时 | `flipped` |
| `update_available` | 系统更新可用 | 检测到更新时 | `version`, `size_mb`, `changelog` |
| `update_downloaded` | 更新下载完成 | 更新下载完成时 | `version`, `path` |
| `update_installed` | 更新安装完成 | 更新安装后 | `version`, `success` |

#### E.2 事件发布/订阅机制

```
发布者（系统服务）                    订阅者（规则引擎）
     │                                    │
     │ 1. 发布事件                        │
     │    qd_publish_event(name, data)   │
     │───────────────────────────────────>│
     │                                    │ 2. 查找订阅该事件的所有规则
     │                                    │
     │                                    │ 3. 逐条评估 condition
     │                                    │    condition 为 true → 执行 action
     │                                    │
     │ 4. action 可能调用系统 API          │
     │<───────────────────────────────────│
     │                                    │
```

**事件发布 API**：
- `qd_publish_event(name, data)`：发布事件（任何服务/模块都可调用）
- `qd_subscribe_event(name, callback)`：订阅事件（规则引擎内部使用）
- `qd_unsubscribe_event(name, callback)`：取消订阅

**事件数据格式**：JSON 对象，字段由事件定义。事件数据可在 condition 表达式中通过 `event.字段名` 引用。

**自定义事件**：模块可发布自定义事件（命名规范：`模块名.事件名`），.qdai 可订阅。

### F. 开发者 SDK 指南

#### F.1 SDK 组成

奇点OS 开发者 SDK（QDSDK）包含以下组件：

| 组件 | 说明 | 语言 |
|------|------|------|
| `qd-headers` | 系统头文件（C/C++） | C/C++ |
| `qd-libc` | 系统标准库（musl libc + 奇点OS 扩展） | C |
| `qd-lib` | 系统服务客户端库（IPC 封装、日志、配置、状态变量） | C/C++/Rust/Go |
| `qd-build` | 构建工具（交叉编译、打包、签名） | Python/Shell |
| `qd-pack` | .qds 打包工具 | C/Python |
| `qd-new` | 模块模板生成工具 | Python |
| `qd-validate` | 格式验证工具（.qd/.qds/.qdai） | Python |
| `qd-debug` | 调试工具（日志查看、进程监控、性能分析） | Python |
| `qd-emulator` | 模拟器（x86_64 上运行 aarch64 模块） | QEMU 封装 |
| `qd-doc` | API 文档生成器 | Python |
| `rust-bindings` | Rust 语言绑定 | Rust |
| `go-bindings` | Go 语言绑定 | Go |
| `python-bindings` | Python 语言绑定（仅用于 .qdai 脚本扩展，不用于 .qds） | Python |

#### F.2 支持的开发语言

| 语言 | 支持级别 | 说明 |
|------|---------|------|
| C | 完整支持 | 核心系统服务推荐 |
| C++ | 完整支持 | 图形栈、复杂服务 |
| Rust | 完整支持 | 内存安全优先的服务 |
| Go | 完整支持 | 网络服务、微服务 |
| Zig | 实验性支持 | 轻量级服务 |
| Python | 仅 .qdai 脚本 | 不用于 .qds 服务（性能原因） |
| JavaScript/TypeScript | 仅 Web 界面 | 不用于系统服务 |

#### F.3 .qds 服务开发流程

```
1. 安装 QDSDK
   export QDSDK_ROOT=/opt/qdsdk
   export PATH=$QDSDK_ROOT/bin:$PATH

2. 创建模块模板
   qd-new module --name my_service --type system --lang c
   # 生成目录结构：
   # my_service.qd/
   # ├── module.qdmeta
   # ├── src/
   # │   └── main.c
   # ├── build/
   # └── .git/

3. 编写服务代码
   # src/main.c
   #include <qd/qd.h>
   
   int qd_service_main(int argc, char** argv,
                       const char* config_json,
                       void* service_context) {
       // 初始化
       qd_log(service_context, QD_LOG_INFO, "服务启动");
       
       // 注册服务
       qd_service_register(service_context, "my_service", "1.0.0");
       
       // 主循环
       while (qd_service_running(service_context)) {
           // 处理请求
           qd_service_process_events(service_context, 1000);
           
           // 心跳
           qd_service_heartbeat(service_context);
       }
       
       // 清理
       qd_log(service_context, QD_LOG_INFO, "服务退出");
       return 0;
   }

4. 编译（交叉编译 aarch64）
   qd-build --target aarch64-linux-musl --config Release
   # 生成 build/my_service（ELF 二进制）

5. 打包为 .qds
   qd-pack --input build/my_service \
           --config config.json \
           --name my_service \
           --entry qd_service_main \
           --arch aarch64 \
           --output my_service.qds
   # 生成 my_service.qds（带文件头的 ELF 包）

6. 验证格式
   qd-validate my_service.qds
   # 输出：Valid .qds file (name=my_service, arch=aarch64, size=1.2MB)

7. 放入模块目录
   cp my_service.qds my_service.qd/
   cp module.qdmeta my_service.qd/

8. 安装到设备
   qd-build install --device /dev/ttyUSB0 my_service.qd
   # 或通过 ADB 推送到设备

9. 调试
   qd-debug log --tag my_service --follow
   qd-debug process --name my_service
   qd-debug perf --pid <pid>
```

#### F.4 核心 API 头文件（qd/qd.h）

```c
#ifndef QD_H
#define QD_H

#include <stdint.h>
#include <stddef.h>

// 服务上下文（不透明指针）
typedef void* qd_service_context_t;

// 日志级别
typedef enum {
    QD_LOG_DEBUG = 0,
    QD_LOG_INFO = 1,
    QD_LOG_WARN = 2,
    QD_LOG_ERROR = 3
} qd_log_level_t;

// 标准入口函数
typedef int (*qd_service_entry_t)(
    int argc,
    char** argv,
    const char* config_json,
    qd_service_context_t context
);

// 日志
void qd_log(qd_service_context_t ctx, qd_log_level_t level, const char* fmt, ...);

// 服务注册
int qd_service_register(qd_service_context_t ctx, const char* name, const char* version);
int qd_service_set_state(qd_service_context_t ctx, const char* state);
int qd_service_heartbeat(qd_service_context_t ctx);
int qd_service_running(qd_service_context_t ctx);
int qd_service_process_events(qd_service_context_t ctx, int timeout_ms);

// IPC
int qd_ipc_send(qd_service_context_t ctx, const char* service, const char* message);
int qd_ipc_register_handler(qd_service_context_t ctx, const char* method,
                            int (*handler)(const char* params, char* response, size_t response_size));

// 配置
const char* qd_config_get(qd_service_context_t ctx, const char* key);
int qd_config_set(qd_service_context_t ctx, const char* key, const char* value);
int qd_config_watch(qd_service_context_t ctx, const char* key,
                    void (*callback)(const char* key, const char* old_value, const char* new_value));

// 状态变量
int qd_register_var(qd_service_context_t ctx, const char* path, const char* type,
                    const char* (*getter)(void));
const char* qd_get_var(const char* path);

// 事件
int qd_publish_event(qd_service_context_t ctx, const char* name, const char* data_json);

// API 注册
int qd_register_api(qd_service_context_t ctx, const char* name,
                    const char* params_schema_json,
                    int (*handler)(const char* params_json, char* response_json, size_t response_size));

// 模块信息
const char* qd_module_get_id(qd_service_context_t ctx);
const char* qd_module_get_version(qd_service_context_t ctx);
const char* qd_module_get_path(qd_service_context_t ctx);

// 系统信息
const char* qd_system_get_version(void);
int qd_system_get_api_level(void);
long qd_system_get_uptime(void);

#endif // QD_H
```

#### F.5 .qdai 规则开发指南

```yaml
# 1. 创建 .qdai 文件（用模板）
qd-new qdai --name my_rule --target performance

# 2. 编辑自然语言部分
# 用中文/英文描述规则意图

# 3. AI 自动生成结构化规则（或手动编写）
# 必须符合 4.3.1 节的 JSON Schema

# 4. 验证格式
qd-validate my_rule.qdai
# 检查：YAML头、分隔符、JSON语法、Schema、condition语法、API引用

# 5. 测试规则（影子模式）
qd-debug rule-test --file my_rule.qdai --dry-run
# 在影子模式下运行，不实际执行 action，只记录会执行什么

# 6. 安装到模块
cp my_rule.qdai /系统/功能.qd/

# 7. 查看规则执行日志
qd-debug log --tag rule_engine --follow
```

#### F.6 构建系统（qd-build）

`qd-build` 是基于 CMake/Make 的封装，简化交叉编译：

```bash
# 配置
qd-build configure \
  --target aarch64-linux-musl \
  --config Release \
  --sdk /opt/qdsdk

# 编译
qd-build build --jobs 8

# 打包
qd-build package --output my_module.qdp

# 签名
qd-build sign --key my_key.pem --input my_module.qdp

# 安装到设备
qd-build install --device adb:10AE4K1C2D00127

# 清理
qd-build clean
```

**CMake 集成**：
```cmake
find_package(QDSDK REQUIRED)
qd_add_service(
    NAME my_service
    SOURCES src/main.c src/util.c
    CONFIG config.json
    PERMISSIONS network storage
)
```

### G. 文件容错解析机制

#### G.1 总体原则

不追求"100% 读不出错"（不可能），而是追求"出错了系统不崩溃、不影响其他模块、能记录错误、能自动恢复"。

#### G.2 七层容错机制

| 层级 | 机制 | 作用 |
|------|------|------|
| 第1层 | 格式设计 | 固定偏移（.qds）、标准格式（JSON/YAML）、行首分隔符（.qdai），从设计上减少歧义 |
| 第2层 | 解析验证 | 每一步都验证（magic→版本→架构→大小→ELF→JSON→Schema→语法），出错早发现，不继续读 |
| 第3层 | 解析器沙箱 | 独立进程/线程、超时机制、成熟的解析库，解析器崩溃不影响系统 |
| 第4层 | 容错降级 | .qdai 逐级降级、.qds 配置失败用默认值、.qd 单个文件坏不影响模块 |
| 第5层 | 错误记录 | 详细日志（文件/步骤/错误/位置/上下文），出了错能排查、能修复 |
| 第6层 | 自动修复 | AI.qd 定期扫描损坏文件并重新生成 |
| 第7层 | 工具辅助 | 模板生成、格式验证工具，从源头减少格式错误 |

#### G.3 .qd 容错

| 错误 | 处理方式 |
|------|---------|
| 目录权限不足 | 跳过，记录警告 |
| module.qdmeta 不存在 | 不识别为模块，跳过 |
| module.qdmeta JSON 语法错误 | 尝试自动修复（去注释、去尾逗号、中文引号转英文），失败则跳过 |
| 必填字段缺失 | 拒绝加载，记录哪个字段缺失 |
| 依赖不满足 | 不加载，通知 AI.qd，AI.qd 可自动安装依赖 |
| 内部 .qds 损坏 | 跳过该 .qds，模块其他部分正常加载 |
| 内部 .qdai 损坏 | 跳过该 .qdai，模块其他部分正常加载 |
| 子模块加载失败 | 跳过子模块，父模块正常加载 |

#### G.4 .qds 容错

| 错误 | 处理方式 | 错误码 |
|------|---------|--------|
| 文件不存在/不可读 | 拒绝加载 | QD_ERR_FILE_READ_ERROR |
| 文件太小（<256字节） | 拒绝加载 | QD_ERR_INVALID_QDS_HEADER |
| magic 不匹配 | 拒绝加载 | QD_ERR_INVALID_QDS_HEADER |
| 格式版本不支持 | 拒绝加载，提示更新系统 | QD_ERR_VERSION_INCOMPATIBLE |
| 架构不匹配 | 拒绝加载 | QD_ERR_ARCH_INCOMPATIBLE |
| 文件大小不匹配（损坏） | 拒绝加载 | QD_ERR_QDS_CORRUPTED |
| 文件头自校验失败（sha256_tail） | 拒绝加载（文件头被篡改） | QD_ERR_QDS_CORRUPTED |
| ELF 格式无效 | 拒绝加载 | QD_ERR_ELF_INVALID |
| 入口函数未找到 | 拒绝加载 | QD_ERR_QDS_ENTRY_NOT_FOUND |
| 动态链接库缺失 | 拒绝加载，记录缺失的库 | QD_ERR_DYNAMIC_LIB_MISSING |
| 内嵌配置 JSON 语法错误 | 使用默认配置继续加载，记录警告 | QD_ERR_JSON_PARSE_ERROR |
| 签名验证失败（官方模块） | 拒绝加载 | QD_ERR_QDS_SIGNATURE_INVALID |
| 签名验证失败（用户模块） | 警告，用户可选择强制加载 | QD_ERR_QDS_SIGNATURE_INVALID |
| 服务启动后无响应（心跳超时） | 杀死进程，标记为崩溃，通知闪退保护 | QD_ERR_SERVICE_NOT_RESPONDING |

#### G.5 .qdai 容错（逐级降级）

```
完整格式（YAML头 + 自然语言 + 结构化规则 + Lua + 预训练知识）
    ↓ 某部分解析失败
降级1：跳过失败的部分，保留其他部分
    ↓ 结构化规则完全失败
降级2：只有自然语言 + 元数据，AI.qd 空闲时重新生成结构化规则
    ↓ YAML头也失败
降级3：纯自然语言文本，元数据用默认值（name=文件名, priority=50）
    ↓ 连分隔符都没有
降级4：整个文件当一段自然语言，AI 理解后生成完整的 .qdai 格式
    ↓ AI 也无法理解
降级5：标记为"无法解析"，用户可手动编辑/删除
```

| 错误 | 处理方式 | 错误码 |
|------|---------|--------|
| 文件不存在/空文件 | 跳过 | QD_ERR_NOT_FOUND |
| 编码不是 UTF-8 | 尝试自动检测编码（GBK/UTF-16），失败则跳过 | QD_ERR_FILE_READ_ERROR |
| 不是以 `---` 开头 | 降级为无元数据模式，元数据用默认值 | QD_ERR_QDAI_PARSE_WARN |
| YAML 语法错误 | 尝试宽松解析（忽略错误行），失败则用默认值 | QD_ERR_YAML_PARSE_ERROR |
| 分隔符找不到 | 整个文件当自然语言，结构化规则为空 | QD_ERR_QDAI_PARSE_WARN |
| 分隔符拼写错误 | 模糊匹配（编辑距离<=2），识别不了就当自然语言 | QD_ERR_QDAI_PARSE_WARN |
| 结构化规则 JSON 语法错误 | 尝试自动修复（去注释/尾逗号/中文引号），失败则忽略，AI 重新生成 | QD_ERR_QDAI_RULE_INVALID |
| 规则不符合 Schema | 跳过不符合的规则，保留符合的 | QD_ERR_QDAI_RULE_INVALID |
| condition 表达式语法错误 | 该规则不注册，记录错误行号 | QD_ERR_CONDITION_EVAL_ERROR |
| condition 引用不存在的变量 | 警告但注册（运行时变量不存在时 condition 为 false） | QD_ERR_QDAI_SEMANTIC_ERROR |
| action 引用不存在的 API | 该规则不注册，通知 AI.qd 重新生成 | QD_ERR_API_NOT_FOUND |
| action 参数不符合 Schema | 该规则不注册，记录参数错误 | QD_ERR_API_PARAM_INVALID |
| Lua 语法错误 | 忽略 Lua 脚本部分，不影响结构化规则 | QD_ERR_LUA_SYNTAX_ERROR |
| Lua 执行超时 | 中断执行，返回错误，不影响其他规则 | QD_ERR_LUA_TIMEOUT |
| Lua 内存超限 | 中断执行，返回错误 | QD_ERR_LUA_MEMORY_LIMIT |
| 跳转深度超过 10 层 | 中断跳转，记录错误 | QD_ERR_JUMP_DEPTH_EXCEEDED |
| AI 转译失败（重试3次） | 保留旧规则或跳过，通知用户 | QD_ERR_AI_TRANSLATE_FAILED |

#### G.6 解析器安全

- **独立进程**：文件解析在独立进程中进行，解析器崩溃（段错误、死循环）不会影响系统主进程
- **超时机制**：每个文件解析最多 5 秒（.qdai 的 AI 转译除外，那是异步的），超时则终止
- **内存限制**：解析器最多使用 10MB 内存，超过则报错
- **成熟解析库**：JSON 用 cJSON/jansson，YAML 用 libcyaml，表达式用自研解析器（经过 fuzz 测试）
- **恶意文件防护**：不执行文件中的任何代码（除了受限的 Lua 沙箱），不加载未知格式的二进制

#### G.7 自动修复机制

- AI.qd 定期（默认每天凌晨3点）扫描所有 .qdai 文件
- 发现结构化规则解析失败的，自动根据自然语言重新生成
- 发现 module.qdmeta 损坏的，尝试根据目录内容重建
- 修复前自动备份原文件（到隔离层），修复失败可回退
- 修复结果记录到日志，用户可查看哪些文件被修复了

#### G.8 开发者工具

- `qd-validate`：验证 .qd/.qds/.qdai 格式，输出详细错误信息（含行号、建议修复方式）
- `qd-new`：生成符合规范的模块/规则模板，从源头减少格式错误
- `qd-debug rule-test`：规则影子模式测试，不实际执行 action，只记录会执行什么
- `qd-fix`：自动修复常见格式错误（JSON 尾逗号、中文引号、YAML 缩进、分隔符拼写）

### H. 模块清单（完整）

| 模块 | 位置 | 类型 | 说明 | 可否卸载 |
|------|------|------|------|---------|
| **HAL** | 内核空间/系统库 | Core | 硬件抽象层 | ❌ |
| **进程调度** | `/系统/功能.qd/进程调度.qds` | Core | 进程管理、墓碑机制 | ❌ |
| **shm_ipc** | `/系统/功能.qd/shm_ipc.qds` | Core | 共享内存 IPC | ❌ |
| **直接传输** | `/系统/功能.qd/直接传输.qd/` | Core | AI.qd 直接传输模块（应用间数据直连） | ❌ |
| **隔离层** | `/系统/功能.qd/隔离层.qd/` | Core | 异常中断隔离层 | ❌ |
| **知识库** | `/系统/功能.qd/知识库.qd/` | User | 用户知识库（可扩展） | ✅ |
| **开发者** | `/系统/功能.qd/开发者.qd/` | Dev | 内置开发环境（工具链/调试器/QD模拟器/SDK） | ✅ |
| **窗口管理** | `/系统/界面.qd/窗口管理.qds` | System | 窗口管理器 | ⚠️ |
| **渲染管线** | `/系统/界面.qd/渲染管线.qds` | System | 渲染管线 | ⚠️ |
| **合成器** | `/系统/界面.qd/合成器.qd/` | System | wlroots 封装 | ⚠️ |
| **投屏** | `/系统/界面.qd/投屏.qd/` | Net | 投屏输出/接收（Miracast/DLNA/HDMI） | ✅ |
| **安装管理** | `/系统/兼容.qd/安装管理.qds` | System | 应用安装管理 | ⚠️ |
| **闪退保护** | `/系统/兼容.qd/闪退保护.qds` | System | 崩溃监控与恢复 | ⚠️ |
| **WDS** | `/系统/兼容.qd/WDS.qd/` | Compat | Windows 兼容层（含 box64/Wine） | ⚠️ |
| **ANZ** | `/系统/兼容.qd/ANZ.qd/` | Compat | 安卓兼容层（含 microG） | ⚠️ |
| **虚拟化** | `/系统/虚拟化.qd/` | VM | 系统虚拟化（KVM 后端/虚拟机管理） | ✅ |
| **微服务主程序** | `/系统/微服务.qd/microsrv.qds` | System | 低功耗常驻服务器主程序 | ⚠️ |
| **远程桌面** | `/系统/微服务.qd/remote_desktop.qds` | Net | 远程桌面服务（VNC/RDP） | ✅ |
| **多屏协同** | `/系统/微服务.qd/multi_screen.qds` | Net | 跨设备投屏/共享键鼠/剪贴板同步 | ✅ |
| **文件传输** | `/系统/微服务.qd/file_transfer.qds` | Net | 跨设备文件传输（类似 AirDrop） | ✅ |
| **AI 服务** | `/AI.qd/ai_service.qds` | AI | AI 推理服务 | ❌ |
| **AI 控制器** | `/AI.qd/ai_controller.qds` | AI | AI 系统控制器 | ❌ |
| **AI 守护进程** | `/AI.qd/ai_daemon.qds` | AI | 监控 AI.qd 状态 | ❌ |
| **推理引擎** | `/AI.qd/推理引擎.qd/` | AI | MNN/llama.cpp 统一 API | ❌ |
| **网络管理** | `/系统/微服务.qd/网络管理.qd/` | Net | 网络配置、连接管理、防火墙 | ✅ |

**模块统计**：
- 核心模块（Core）：5 个（不可卸载）
- 系统服务（System）：7 个（可替换）
- 兼容层（Compat）：2 个（可替换）
- 虚拟化（VM）：1 个（可卸载）
- 图形界面（UI）：4 个（可替换/卸载）
- 网络通信（Net）：5 个（可卸载）
- AI 模块（AI）：4 个（不可卸载，最高权限）
- 开发者（Dev）：1 个（可卸载）
- 用户模块（User）：1 个（可扩展）
- **总计**：30 个模块

---

**文档结束**

> 本文档为奇点OS 系统级记忆，由 AI.qd 输出并维护。  
> 任何与本文档冲突的实现均视为不符合规范。  
> 文档版本：v1.2 | 最后更新：2026-09-16
