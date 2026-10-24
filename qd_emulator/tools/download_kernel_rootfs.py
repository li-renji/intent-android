"""
下载预编译的 Linux 内核和最小 rootfs
用于 QD 模拟器第一阶段验证
"""
import urllib.request
import os
import sys

def download(url, output, desc):
    print(f'下载: {desc}')
    print(f'URL: {url}')
    print(f'保存: {output}')
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            total = int(resp.headers.get('Content-Length', 0))
            print(f'大小: {total//1024//1024 if total else "未知"} MB')
            downloaded = 0
            with open(output, 'wb') as f:
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total > 0:
                        pct = downloaded * 100 // total
                        sys.stdout.write(f'\r  进度: {pct}% ({downloaded//1024}KB)')
                        sys.stdout.flush()
            print()
            size = os.path.getsize(output)
            print(f'完成: {size//1024} KB')
            return True
    except Exception as e:
        print(f'失败: {e}')
        return False

base = r'D:\qidian编辑器 APK\qd_emulator'

# 方案1: 用 Buildroot 预编译的最小 Linux 系统
# 方案2: 用 Alpine Linux 的 virt 镜像
# 方案3: 自己构建 busybox initramfs

# 先用 Alpine Linux virt 镜像（小、快、稳定）
# Alpine 标准镜像里的 kernel 和 initramfs
alpine_version = '3.19'
alpine_url = f'https://dl-cdn.alpinelinux.org/alpine/v{alpine_version}/releases/x86_64/alpine-virt-{alpine_version}.0-x86_64.iso'

print('=' * 60)
print('QD 模拟器 - 第一阶段准备')
print('=' * 60)
print()

# 下载 Alpine virt ISO（包含内核和最小系统）
iso_path = os.path.join(base, 'rootfs', 'minimal', 'alpine-virt.iso')
if download(alpine_url, iso_path, f'Alpine Linux {alpine_version} virt ISO'):
    print()
    print('ISO 下载完成！')
    print('下一步: 从 ISO 中提取内核和 initramfs，或者直接从 ISO 启动')
    print()
    print('启动命令示例:')
    print('  qemu-system-x86_64 ^')
    print('    -m 512M ^')
    print('    -cdrom rootfs/minimal/alpine-virt.iso ^')
    print('    -boot d ^')
    print('    -display gtk')
else:
    print()
    print('ISO 下载失败，请检查网络连接')
    print('备用方案: 手动从 https://alpinelinux.org/downloads/ 下载 virt 版本')
