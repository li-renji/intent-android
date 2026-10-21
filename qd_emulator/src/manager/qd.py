#!/usr/bin/env python3
"""
QD 模拟器 - 命令行管理器
第一阶段：最小可运行版本
支持：create / start / stop / list / status / console / delete
"""

import json
import os
import sys
import subprocess
import argparse
import time
import socket
import shutil
from pathlib import Path

# 项目根目录
BASE_DIR = Path(__file__).parent.parent.parent.resolve()
QEMU_DIR = BASE_DIR / 'qemu'
IMAGES_DIR = BASE_DIR / 'images'
TEMPLATES_DIR = BASE_DIR / 'templates'
VMS_DIR = BASE_DIR / 'vms'

# 确保目录存在
for d in [IMAGES_DIR, VMS_DIR]:
    d.mkdir(parents=True, exist_ok=True)


def find_qemu():
    """查找 QEMU 可执行文件"""
    # 优先用项目目录里的便携版
    qemu_exe = QEMU_DIR / 'qemu-system-x86_64.exe'
    if qemu_exe.exists():
        return str(qemu_exe)

    # 尝试系统 PATH
    qemu_exe = shutil.which('qemu-system-x86_64')
    if qemu_exe:
        return qemu_exe

    # 尝试常见安装路径
    common_paths = [
        r'C:\Program Files\qemu\qemu-system-x86_64.exe',
        r'C:\Program Files (x86)\qemu\qemu-system-x86_64.exe',
    ]
    for p in common_paths:
        if os.path.exists(p):
            return p

    return None


def find_qemu_img():
    """查找 qemu-img 工具"""
    qemu_img = QEMU_DIR / 'qemu-img.exe'
    if qemu_img.exists():
        return str(qemu_img)
    qemu_img = shutil.which('qemu-img')
    return qemu_img


def load_vm_config(vm_name):
    """加载虚拟机配置"""
    config_path = VMS_DIR / vm_name / 'config.json'
    if not config_path.exists():
        return None
    with open(config_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_vm_config(vm_name, config):
    """保存虚拟机配置"""
    vm_dir = VMS_DIR / vm_name
    vm_dir.mkdir(parents=True, exist_ok=True)
    config_path = vm_dir / 'config.json'
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    return config_path


def list_vms():
    """列出所有虚拟机"""
    if not VMS_DIR.exists():
        return []
    vms = []
    for d in VMS_DIR.iterdir():
        if d.is_dir():
            config = load_vm_config(d.name)
            if config:
                vms.append({
                    'name': d.name,
                    'os': config.get('os', 'unknown'),
                    'status': get_vm_status(d.name),
                    'memory': config.get('memory', {}).get('size_mb', 0),
                    'cpus': config.get('cpu', {}).get('cores', 0),
                })
    return vms


def get_vm_status(vm_name):
    """获取虚拟机运行状态（通过 QMP 端口检测）"""
    config = load_vm_config(vm_name)
    if not config:
        return 'not_found'

    qmp_port = config.get('qmp', {}).get('port', 4444)
    qmp_host = config.get('qmp', {}).get('host', '127.0.0.1')

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        result = sock.connect_ex((qmp_host, qmp_port))
        sock.close()
        if result == 0:
            return 'running'
    except:
        pass

    return 'stopped'


def build_qemu_command(config, headless=False):
    """构建 QEMU 启动命令"""
    qemu = find_qemu()
    if not qemu:
        print('错误: 找不到 QEMU，请先运行 tools/setup_qemu.py')
        sys.exit(1)

    cmd = [qemu]

    # 名称
    cmd += ['-name', config.get('name', 'qdemu')]

    # 机器类型和加速器
    accel = config.get('accelerator', 'whpx')
    cmd += ['-machine', f'q35,accel={accel}']
    cmd += ['-cpu', 'host']

    # CPU
    cpu = config.get('cpu', {})
    cores = cpu.get('cores', 2)
    sockets = cpu.get('sockets', 1)
    threads = cpu.get('threads_per_core', 1)
    cmd += ['-smp', f'{cores},sockets={sockets},threads={threads}']

    # 内存
    memory = config.get('memory', {}).get('size_mb', 512)
    cmd += ['-m', f'{memory}M']

    # 磁盘
    disk = config.get('disk', {})
    disk_path = disk.get('path', '')
    if disk_path and os.path.exists(disk_path):
        disk_if = disk.get('interface', 'virtio')
        disk_fmt = disk.get('format', 'qcow2')
        cmd += ['-drive', f'file={disk_path},if={disk_if},format={disk_fmt}']

    # 光驱
    cdrom = config.get('cdrom', {})
    if cdrom.get('enabled', False):
        cdrom_path = cdrom.get('path', '')
        if cdrom_path and os.path.exists(cdrom_path):
            cmd += ['-cdrom', cdrom_path]

    # 启动顺序
    boot_order = config.get('boot', {}).get('order', 'dc')
    cmd += ['-boot', boot_order]

    # 网络
    net = config.get('network', {})
    if net.get('mode', 'user') == 'user':
        netdev_id = 'net0'
        netdev_args = f'user,id={netdev_id}'
        for pf in net.get('port_forwards', []):
            proto = pf.get('protocol', 'tcp')
            netdev_args += f',hostfwd={proto}::{pf["host"]}-:{pf["guest"]}'
        cmd += ['-netdev', netdev_args]
        cmd += ['-device', 'virtio-net-pci,netdev=net0']

    # 显示
    if headless:
        cmd += ['-display', 'none']
    else:
        display_type = config.get('display', {}).get('type', 'gtk')
        cmd += ['-display', display_type]

    # 串口
    serial = config.get('serial', {})
    if serial.get('enabled', True):
        if headless:
            cmd += ['-serial', 'stdio']
        else:
            cmd += ['-serial', 'stdio']

    # QMP
    qmp = config.get('qmp', {})
    if qmp.get('enabled', True):
        qmp_host = qmp.get('host', '127.0.0.1')
        qmp_port = qmp.get('port', 4444)
        cmd += ['-qmp', f'tcp:{qmp_host}:{qmp_port},server,nowait']

    # 不自动重启
    cmd += ['-no-reboot']

    return cmd


def cmd_create(args):
    """创建虚拟机"""
    vm_name = args.name
    template = args.template or 'alpine_minimal'

    # 检查是否已存在
    if (VMS_DIR / vm_name).exists():
        print(f'错误: 虚拟机 "{vm_name}" 已存在')
        sys.exit(1)

    # 加载模板
    template_path = TEMPLATES_DIR / f'{template}.json'
    if not template_path.exists():
        print(f'错误: 模板 "{template}" 不存在')
        print(f'可用模板:')
        for t in TEMPLATES_DIR.glob('*.json'):
            print(f'  - {t.stem}')
        sys.exit(1)

    with open(template_path, 'r', encoding='utf-8') as f:
        config = json.load(f)

    # 更新配置
    config['name'] = vm_name
    config['id'] = f'vm-{vm_name}'

    # 自定义 CPU/内存/磁盘
    if args.cpus:
        config['cpu']['cores'] = args.cpus
    if args.memory:
        config['memory']['size_mb'] = args.memory
    if args.disk:
        size_gb = int(args.disk.replace('G', '').replace('g', ''))
        config['disk']['size_gb'] = size_gb

    # 修改磁盘路径到 vms 目录
    config['disk']['path'] = str(VMS_DIR / vm_name / 'disk.qcow2')

    # 修改 QMP 端口（避免冲突）
    existing_vms = list_vms()
    base_port = 4444 + len(existing_vms) * 10
    config['qmp']['port'] = base_port
    config['network']['port_forwards'][0]['host'] = 2222 + len(existing_vms)
    config['network']['port_forwards'][1]['host'] = 5555 + len(existing_vms)

    # 保存配置
    save_vm_config(vm_name, config)

    # 创建磁盘镜像
    qemu_img = find_qemu_img()
    if qemu_img:
        disk_path = config['disk']['path']
        size_gb = config['disk']['size_gb']
        print(f'创建磁盘镜像: {size_gb}GB')
        subprocess.run([
            qemu_img, 'create', '-f', 'qcow2',
            disk_path, f'{size_gb}G'
        ], check=True)
    else:
        print('警告: 找不到 qemu-img，跳过磁盘创建')

    print(f'虚拟机 "{vm_name}" 创建成功！')
    print(f'  配置: {config["cpu"]["cores"]} CPU / {config["memory"]["size_mb"]}MB 内存 / {config["disk"]["size_gb"]}GB 磁盘')
    print(f'  QMP 端口: {config["qmp"]["port"]}')
    print(f'  SSH 转发: 127.0.0.1:{config["network"]["port_forwards"][0]["host"]} -> guest:22')
    print()
    print(f'启动命令: qd start {vm_name}')


def cmd_start(args):
    """启动虚拟机"""
    vm_name = args.name
    config = load_vm_config(vm_name)
    if not config:
        print(f'错误: 虚拟机 "{vm_name}" 不存在')
        sys.exit(1)

    status = get_vm_status(vm_name)
    if status == 'running':
        print(f'虚拟机 "{vm_name}" 已经在运行中')
        return

    cmd = build_qemu_command(config, headless=args.headless)

    print(f'启动虚拟机: {vm_name}')
    print(f'命令: {" ".join(cmd)}')
    print()

    if args.headless:
        # 无头模式：后台运行
        log_path = VMS_DIR / vm_name / 'qemu.log'
        with open(log_path, 'w') as logf:
            proc = subprocess.Popen(cmd, stdout=logf, stderr=subprocess.STDOUT)
        print(f'虚拟机已在后台启动 (PID: {proc.pid})')
        print(f'日志: {log_path}')
        print(f'串口连接: qd console {vm_name}')
    else:
        # 有图形界面：前台运行
        try:
            subprocess.run(cmd)
        except KeyboardInterrupt:
            print('\n虚拟机已停止')


def cmd_stop(args):
    """停止虚拟机"""
    vm_name = args.name
    config = load_vm_config(vm_name)
    if not config:
        print(f'错误: 虚拟机 "{vm_name}" 不存在')
        sys.exit(1)

    status = get_vm_status(vm_name)
    if status != 'running':
        print(f'虚拟机 "{vm_name}" 未在运行')
        return

    # 通过 QMP 发送关机命令
    qmp_host = config.get('qmp', {}).get('host', '127.0.0.1')
    qmp_port = config.get('qmp', {}).get('port', 4444)

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        sock.connect((qmp_host, qmp_port))

        # 读取 QMP 问候
        sock.recv(4096)

        # 发送 qmp_capabilities
        sock.sendall(b'{"execute": "qmp_capabilities"}\r\n')
        sock.recv(4096)

        if args.force:
            # 强制关机（相当于断电）
            sock.sendall(b'{"execute": "quit"}\r\n')
            print(f'已发送强制关机命令到 "{vm_name}"')
        else:
            # 正常关机（发送系统关机事件）
            sock.sendall(b'{"execute": "system_powerdown"}\r\n')
            print(f'已发送关机命令到 "{vm_name}"')
            print('等待虚拟机关闭...')

        sock.close()
    except Exception as e:
        print(f'QMP 通信失败: {e}')
        if args.force:
            print('尝试强制终止 QEMU 进程...')
            subprocess.run(['taskkill', '/F', '/IM', 'qemu-system-x86_64.exe'],
                         capture_output=True)


def cmd_list(args):
    """列出所有虚拟机"""
    vms = list_vms()
    if not vms:
        print('没有虚拟机，使用 qd create 创建一个')
        return

    print(f'{"名称":<20} {"系统":<12} {"状态":<10} {"CPU":<5} {"内存":<8}')
    print('-' * 60)
    for vm in vms:
        print(f'{vm["name"]:<20} {vm["os"]:<12} {vm["status"]:<10} {vm["cpus"]:<5} {vm["memory"]}MB')


def cmd_status(args):
    """查看虚拟机状态"""
    vm_name = args.name
    config = load_vm_config(vm_name)
    if not config:
        print(f'错误: 虚拟机 "{vm_name}" 不存在')
        sys.exit(1)

    status = get_vm_status(vm_name)
    print(f'虚拟机: {vm_name}')
    print(f'状态: {status}')
    print(f'系统: {config.get("os", "unknown")}')
    print(f'CPU: {config.get("cpu", {}).get("cores", 0)} 核')
    print(f'内存: {config.get("memory", {}).get("size_mb", 0)} MB')
    print(f'磁盘: {config.get("disk", {}).get("size_gb", 0)} GB')
    print(f'QMP: {config.get("qmp", {}).get("host", "127.0.0.1")}:{config.get("qmp", {}).get("port", 4444)}')

    if status == 'running':
        print()
        print('端口转发:')
        for pf in config.get('network', {}).get('port_forwards', []):
            print(f'  127.0.0.1:{pf["host"]} -> guest:{pf["guest"]} ({pf.get("protocol", "tcp")})')


def cmd_console(args):
    """连接串口控制台"""
    vm_name = args.name
    config = load_vm_config(vm_name)
    if not config:
        print(f'错误: 虚拟机 "{vm_name}" 不存在')
        sys.exit(1)

    status = get_vm_status(vm_name)
    if status != 'running':
        print(f'虚拟机 "{vm_name}" 未在运行')
        return

    print(f'连接到 {vm_name} 串口控制台...')
    print('按 Ctrl+A 然后按 X 退出')
    print()

    # 第一阶段：直接用 QEMU 的 stdio（需要在启动时用 -serial stdio）
    # 后续可以用 telnet/nc 连接串口
    print('提示: 第一阶段串口控制台需要在启动时使用 --headless 模式')
    print('      或者直接在 QEMU 窗口中操作')


def cmd_delete(args):
    """删除虚拟机"""
    vm_name = args.name
    vm_dir = VMS_DIR / vm_name

    if not vm_dir.exists():
        print(f'错误: 虚拟机 "{vm_name}" 不存在')
        sys.exit(1)

    status = get_vm_status(vm_name)
    if status == 'running':
        print(f'错误: 虚拟机 "{vm_name}" 正在运行，请先停止')
        sys.exit(1)

    if not args.yes:
        confirm = input(f'确认删除虚拟机 "{vm_name}"？此操作不可恢复 (y/N): ')
        if confirm.lower() != 'y':
            print('已取消')
            return

    if args.keep_disk:
        # 只删除配置，保留磁盘
        config_path = vm_dir / 'config.json'
        if config_path.exists():
            config_path.unlink()
        print(f'已删除虚拟机配置，磁盘保留在: {vm_dir / "disk.qcow2"}')
    else:
        shutil.rmtree(vm_dir)
        print(f'虚拟机 "{vm_name}" 已删除')


def main():
    parser = argparse.ArgumentParser(
        prog='qd',
        description='QD 模拟器 - 奇点OS 官方模拟器命令行工具'
    )
    subparsers = parser.add_subparsers(dest='command', help='可用命令')

    # create
    p_create = subparsers.add_parser('create', help='创建虚拟机')
    p_create.add_argument('name', help='虚拟机名称')
    p_create.add_argument('--template', '-t', help='配置模板 (默认: alpine_minimal)')
    p_create.add_argument('--cpus', type=int, help='CPU 核心数')
    p_create.add_argument('--memory', type=int, help='内存大小 (MB)')
    p_create.add_argument('--disk', help='磁盘大小 (如 4G)')
    p_create.set_defaults(func=cmd_create)

    # start
    p_start = subparsers.add_parser('start', help='启动虚拟机')
    p_start.add_argument('name', help='虚拟机名称')
    p_start.add_argument('--headless', action='store_true', help='无头模式（无图形界面）')
    p_start.set_defaults(func=cmd_start)

    # stop
    p_stop = subparsers.add_parser('stop', help='停止虚拟机')
    p_stop.add_argument('name', help='虚拟机名称')
    p_stop.add_argument('--force', '-f', action='store_true', help='强制关机（断电）')
    p_stop.set_defaults(func=cmd_stop)

    # list
    p_list = subparsers.add_parser('list', help='列出所有虚拟机')
    p_list.set_defaults(func=cmd_list)

    # status
    p_status = subparsers.add_parser('status', help='查看虚拟机状态')
    p_status.add_argument('name', help='虚拟机名称')
    p_status.set_defaults(func=cmd_status)

    # console
    p_console = subparsers.add_parser('console', help='连接串口控制台')
    p_console.add_argument('name', help='虚拟机名称')
    p_console.set_defaults(func=cmd_console)

    # delete
    p_delete = subparsers.add_parser('delete', help='删除虚拟机')
    p_delete.add_argument('name', help='虚拟机名称')
    p_delete.add_argument('--keep-disk', action='store_true', help='保留磁盘镜像')
    p_delete.add_argument('--yes', '-y', action='store_true', help='跳过确认')
    p_delete.set_defaults(func=cmd_delete)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    args.func(args)


if __name__ == '__main__':
    main()
