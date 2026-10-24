# -*- coding: utf-8 -*-
"""更新 rootfs.tar：把奇点OS模块的文本占位替换为真实二进制实现。"""
import tarfile, io, os, shutil, hashlib, zlib, time

ROOT = r'D:\qidian编辑器 APK'
TAR = os.path.join(ROOT, 'app', 'src', 'main', 'assets', 'rootfs.tar')
MOD = os.path.join(ROOT, 'build', 'modules')
SAMP = os.path.join(ROOT, 'build', 'samples')

# 需要移除的旧条目（bin/shm_client 并入功能.qd/shm_ipc.qds；文本占位 qds 被二进制替换）
REMOVE = [
    'bin/shm_client',
]

# 二进制模块 -> 目标路径（.qds = 可执行系统单文件）
BINARIES = {
    os.path.join(MOD, 'apk_parse'):    '系统/兼容.qd/安卓.qd/apk_parse',
    os.path.join(MOD, 'apk_install'):  '系统/兼容.qd/安卓.qd/apk_install',
    os.path.join(MOD, 'apk_launch'):   '系统/兼容.qd/安卓.qd/apk_launch',
    os.path.join(MOD, 'pe_parse'):     '系统/兼容.qd/Win32.qd/pe_parse',
    os.path.join(MOD, 'win32_loader'): '系统/兼容.qd/Win32.qd/win32_loader',
    os.path.join(MOD, 'apm_install'):  '系统/兼容.qd/安装管理.qds',
    os.path.join(MOD, 'watchdog'):     '系统/兼容.qd/闪退保护.qds',
    os.path.join(MOD, 'proc_mgr'):     '系统/功能.qd/进程调度.qds',
    os.path.join(ROOT, 'framework', 'shm_client'): '系统/功能.qd/shm_ipc.qds',
    os.path.join(MOD, 'wm'):           '系统/界面.qd/窗口管理.qds',
    os.path.join(MOD, 'render'):       '系统/界面.qd/渲染管线.qds',
    os.path.join(MOD, 'microsrv'):     '系统/微服务.qd/microsrv.qds',
    os.path.join(MOD, 'intent_agent'):  'AI.qd/ai_service.qds',
    os.path.join(MOD, 'ai_controller'): 'AI.qd/ai_controller.qds',
}

# 样本 -> 用户目录
SAMPLES = {
    os.path.join(SAMP, '测试.apk'): '用户/测试.apk',
    os.path.join(SAMP, '测试.exe'): '用户/测试.exe',
    os.path.join(SAMP, 'hello.exe'): '用户/hello.exe',
}

# 所有会被重新添加的路径（遍历时跳过，避免重复）
REPLACE_PATHS = set(BINARIES.values()) | set(SAMPLES.values())

# qdai 规则更新（规则 + 实现对接，纯自然语言）
QDAI = {
    'AI.qd/ai_entry.qdai':
        '# AI.qd 全局跳转规则（跳转起点）\n'
        '# 依据: 跳转起点位于 AI.qd 模块内的 qdai；目标只能是其他 qdai 文件。\n'
        '#\n'
        '# 规则:\n'
        '# 1. 用户请求涉及 APK/EXE 安装、兼容运行、崩溃诊断\n'
        '#    → 跳转 系统/兼容.qd/compat_ai.qdai（实现: 安卓.qd/apk_parse、Win32.qd/pe_parse、安装管理.qds、闪退保护.qds）\n'
        '# 2. 用户请求涉及进程管理、内存、IPC/SHM 数据通道\n'
        '#    → 跳转 系统/功能.qd/func_ai.qdai（实现: 进程调度.qds、shm_ipc.qds）\n'
        '# 3. 用户请求涉及窗口、渲染、图形界面\n'
        '#    → 跳转 系统/界面.qd/ui_ai.qdai（实现: 窗口管理.qds、渲染管线.qds）\n'
        '# 4. 用户请求涉及低功耗常驻服务\n'
        '#    → 跳转 系统/微服务.qd/microsrv.qdai（实现: microsrv.qds，TCP 127.0.0.1:8822）\n'
        '# 5. 未匹配上述主题 → 由 ai_service.qds 直接处理（系统级 AI 服务，共享内存通道常驻）\n'
        '#\n'
        '# 权限: 可读写任意 .qds 系统单文件，以此让 AI 规则生效。\n',
    '系统/兼容.qd/compat_ai.qdai':
        '# 兼容.qd AI 规则（跳转目标）\n'
        '# 职责: AI 辅助兼容调度、异常诊断（安卓 APK / Win32 EXE 加载与运行管理）。\n'
        '#\n'
        '# 规则:\n'
        '# - APK 解析: 调用 安卓.qd/apk_parse <apk>（ZIP 结构、ABI、dex、包名提取）。\n'
        '# - EXE 解析: 调用 Win32.qd/pe_parse <exe>（MZ/PE/COFF/节区/入口点）。\n'
        '# - 安装应用: 调用 安装管理.qds register <名称> <路径>（写入 用户/registry.ini 注册表）。\n'
        '# - 应用崩溃: 调用 闪退保护.qds <pid> [重启命令]（记录崩溃到 用户/crash.log，防牵连系统）。\n'
        '# - APK/EXE 文件放置于本模块或 用户/ 目录。\n'
        '# - 权限: 可读写 安装管理.qds / 闪退保护.qds。\n',
    '系统/功能.qd/func_ai.qdai':
        '# 功能.qd AI 规则（跳转目标）\n'
        '# 职责: AI 辅助核心功能调度（进程管理、内存、IPC/SHM 通道）。\n'
        '#\n'
        '# 规则:\n'
        '# - 进程列表/状态/终止: 调用 进程调度.qds [list|stat <pid>|kill <pid>]（遍历 /proc）。\n'
        '# - 宿主与容器数据交换: shm_ipc.qds <shm_path> <tag>（共享内存通道客户端，已验证）。\n'
        '# - 权限: 可读写 进程调度.qds / shm_ipc.qds。\n',
    '系统/界面.qd/ui_ai.qdai':
        '# 界面.qd AI 规则（跳转目标）\n'
        '# 职责: AI 辅助界面（窗口管理、渲染管线）。\n'
        '#\n'
        '# 规则:\n'
        '# - 窗口管理: 调用 窗口管理.qds（窗口表创建/销毁/聚焦，独立于渲染）。\n'
        '# - 渲染: 调用 渲染管线.qds <out.ppm>（离屏帧缓冲软件渲染）。\n'
        '# - 界面模块可单独崩溃/重启，不影响底层功能与系统。\n'
        '# - 权限: 可读写 窗口管理.qds / 渲染管线.qds。\n',
    '系统/微服务.qd/microsrv.qdai':
        '# 微服务.qd AI 规则（跳转目标）\n'
        '# 职责: microsrv.qds 低功耗常驻微服务的 AI 配置。\n'
        '#\n'
        '# 规则:\n'
        '# - microsrv.qds 后台永久常驻，TCP 监听 127.0.0.1:8822，内存占用数 MB。\n'
        '# - 每个连接返回状态行（pid/心跳/运行时长/内存）。\n'
        '# - AI 负责按需启动/停止、异常恢复与资源监控。\n'
        '# - 权限: 可读写 microsrv.qds。\n',
}

# 从外部文件读取 AI 主配置 qdai（避免在脚本里硬编码大段文本）
_ai_config_path = os.path.join(ROOT, 'framework', 'ai_config.qdai')
if os.path.exists(_ai_config_path):
    with open(_ai_config_path, 'r', encoding='utf-8') as _f:
        QDAI['AI.qd/ai_config.qdai'] = _f.read()
REPLACE_PATHS.add('AI.qd/ai_config.qdai')

# 知识库.qd 模块的 AI 规则文件
_kb_qdai_path = os.path.join(ROOT, 'framework', 'knowledge_base.qdai')
if os.path.exists(_kb_qdai_path):
    with open(_kb_qdai_path, 'r', encoding='utf-8') as _f:
        QDAI['系统/功能.qd/知识库.qd/知识库.qdai'] = _f.read()
REPLACE_PATHS.add('系统/功能.qd/知识库.qd/知识库.qdai')

# INTENT Agent 规则文件
_intent_qdai_path = os.path.join(ROOT, 'framework', 'intent_agent.qdai')
if os.path.exists(_intent_qdai_path):
    with open(_intent_qdai_path, 'r', encoding='utf-8') as _f:
        QDAI['AI.qd/intent_agent.qdai'] = _f.read()
REPLACE_PATHS.add('AI.qd/intent_agent.qdai')

# 屏幕操纵规则文件
_screen_qdai_path = os.path.join(ROOT, 'framework', 'screen_control.qdai')
if os.path.exists(_screen_qdai_path):
    with open(_screen_qdai_path, 'r', encoding='utf-8') as _f:
        QDAI['AI.qd/screen_control.qdai'] = _f.read()
REPLACE_PATHS.add('AI.qd/screen_control.qdai')

ti = tarfile.open(TAR, 'r')
buf = io.BytesIO()
to = tarfile.open(fileobj=buf, mode='w', format=tarfile.GNU_FORMAT)
removed = 0
processed_qdai = set()
for m in ti.getmembers():
    n = m.name
    if n in REMOVE:
        removed += 1
        continue
    # 跳过将被二进制/样本替换的旧文件（按路径匹配）
    if n in REPLACE_PATHS:
        removed += 1
        continue
    # 跳过旧的 .git 目录（会重新生成带初始提交的）
    if '/.git' in n or n.endswith('/.git'):
        removed += 1
        continue
    # qdai 用新内容覆盖
    if n in QDAI:
        data = QDAI[n].encode('utf-8')
        info = tarfile.TarInfo(n)
        info.size = len(data)
        info.mode = 0o644
        to.addfile(info, io.BytesIO(data))
        processed_qdai.add(n)
        continue
    to.addfile(m, ti.extractfile(m) if m.isfile() else None)
ti.close()

# 添加原始 tar 中不存在的新 QDAI 文件
for qdai_path, qdai_content in QDAI.items():
    if qdai_path not in processed_qdai:
        data = qdai_content.encode('utf-8')
        info = tarfile.TarInfo(qdai_path)
        info.size = len(data)
        info.mode = 0o644
        to.addfile(info, io.BytesIO(data))
        print('  新增QDAI: ' + qdai_path)

def add_bin(src, dst, mode):
    data = open(src, 'rb').read()
    info = tarfile.TarInfo(dst)
    info.size = len(data)
    info.mode = mode
    to.addfile(info, io.BytesIO(data))

for src, dst in BINARIES.items():
    add_bin(src, dst, 0o755)
for src, dst in SAMPLES.items():
    add_bin(src, dst, 0o644)

# ===== 为每个 .qd 模块创建带初始提交的 Git 仓库 =====
def git_object(obj_type, content):
    """创建Git对象，返回(sha1_hex, zlib_compressed_data)"""
    header = '{} {}\0'.format(obj_type, len(content)).encode('utf-8')
    raw = header + content
    sha = hashlib.sha1(raw).hexdigest()
    return sha, zlib.compress(raw)

def add_git_file(repo_path, obj_sha, obj_data):
    """向tar添加一个Git对象文件"""
    obj_path = '{}/.git/objects/{}/{}'.format(repo_path, obj_sha[:2], obj_sha[2:])
    info = tarfile.TarInfo(obj_path)
    info.size = len(obj_data)
    info.mode = 0o444
    to.addfile(info, io.BytesIO(obj_data))

def build_tree(entries):
    """构建tree对象内容，entries是[(mode_bytes, name_bytes, sha_bytes)]"""
    content = b''
    for mode, name, sha in entries:
        content += mode + b' ' + name + b'\0' + sha
    return content

def create_git_repo(repo_path, files):
    """
    为模块创建Git仓库，包含初始提交。
    files: {relative_path: (content_bytes, mode)} —— relative_path相对于模块根目录
    """
    # 1. 为每个文件创建blob
    blobs = {}  # path -> sha
    for path, (content, mode) in files.items():
        sha, data = git_object('blob', content)
        add_git_file(repo_path, sha, data)
        blobs[path] = (sha, mode)

    # 2. 递归构建tree
    def build_subtree(prefix):
        entries = []
        # 收集直接子项
        children = {}
        for path, (sha, mode) in blobs.items():
            if not path.startswith(prefix):
                continue
            remainder = path[len(prefix):] if prefix else path
            if '/' in remainder:
                dirname = remainder.split('/')[0]
                if dirname not in children:
                    children[dirname] = 'dir'
            else:
                children[remainder] = ('file', sha, mode)

        for name, val in sorted(children.items()):
            if val == 'dir':
                sub_prefix = prefix + name + '/' if prefix else name + '/'
                sub_sha = build_subtree(sub_prefix)
                entries.append((b'40000', name.encode('utf-8'), bytes.fromhex(sub_sha)))
            else:
                _, sha, mode = val
                mode_str = '100755' if mode & 0o111 else '100644'
                entries.append((mode_str.encode('utf-8'), name.encode('utf-8'), bytes.fromhex(sha)))

        tree_content = build_tree(entries)
        sha, data = git_object('tree', tree_content)
        add_git_file(repo_path, sha, data)
        return sha

    tree_sha = build_subtree('')

    # 3. 创建commit
    timestamp = int(time.time())
    commit_content = (
        'tree {}\n'
        'author 奇点OS <qidian@os.local> {} +0800\n'
        'committer 奇点OS <qidian@os.local> {} +0800\n'
        '\n'
        '初始提交: 奇点OS 模块 {}\n'
    ).format(tree_sha, timestamp, timestamp, repo_path.split('/')[-1]).encode('utf-8')
    commit_sha, commit_data = git_object('commit', commit_content)
    add_git_file(repo_path, commit_sha, commit_data)

    # 4. 创建HEAD和refs
    head_content = 'ref: refs/heads/main\n'.encode('utf-8')
    head_info = tarfile.TarInfo('{}/.git/HEAD'.format(repo_path))
    head_info.size = len(head_content)
    head_info.mode = 0o644
    to.addfile(head_info, io.BytesIO(head_content))

    ref_content = (commit_sha + '\n').encode('utf-8')
    ref_info = tarfile.TarInfo('{}/.git/refs/heads/main'.format(repo_path))
    ref_info.size = len(ref_content)
    ref_info.mode = 0o644
    to.addfile(ref_info, io.BytesIO(ref_content))

    # 创建空的objects/info和objects/pack目录（Git需要）
    for d in ['objects/info', 'objects/pack', 'refs/tags']:
        dir_info = tarfile.TarInfo('{}/.git/{}'.format(repo_path, d))
        dir_info.type = tarfile.DIRTYPE
        dir_info.mode = 0o755
        to.addfile(dir_info)

    print('  Git仓库: {} (commit={}, tree={}, {}个文件)'.format(repo_path, commit_sha[:8], tree_sha[:8], len(files)))

# 收集每个.qd模块的文件（从已添加的内容中）
print('创建Git仓库初始提交:')
qd_modules = {}

def find_deepest_qd(path):
    """找到路径中最深的.qd模块，返回(module_path, rel_path)"""
    parts = path.split('/')
    qd_indices = [i for i, p in enumerate(parts) if p.endswith('.qd')]
    if not qd_indices:
        return None, None
    deepest = qd_indices[-1]
    module_path = '/'.join(parts[:deepest+1])
    rel_path = '/'.join(parts[deepest+1:])
    return module_path, rel_path

# 从BINARIES收集文件
for src, dst in BINARIES.items():
    module_path, rel_path = find_deepest_qd(dst)
    if module_path and rel_path:
        if module_path not in qd_modules:
            qd_modules[module_path] = {}
        content = open(src, 'rb').read()
        qd_modules[module_path][rel_path] = (content, 0o755)

# 从QDAI收集文件
for dst, content_str in QDAI.items():
    module_path, rel_path = find_deepest_qd(dst)
    if module_path and rel_path:
        if module_path not in qd_modules:
            qd_modules[module_path] = {}
        qd_modules[module_path][rel_path] = (content_str.encode('utf-8'), 0o644)

for module_path, files in sorted(qd_modules.items()):
    create_git_repo(module_path, files)

to.close()
open(TAR + '.new', 'wb').write(buf.getvalue())
shutil.move(TAR + '.new', TAR)
print('rootfs.tar size:', os.path.getsize(TAR))

t = tarfile.open(TAR)
names = t.getnames()
print('移除 bin/shm_client:', 'bin/shm_client' not in names)
print('模块二进制就位:')
for _, dst in BINARIES.items():
    print('  ', dst, 'OK' if dst in names else 'MISSING')
print('样本就位:')
for _, dst in SAMPLES.items():
    print('  ', dst, 'OK' if dst in names else 'MISSING')
