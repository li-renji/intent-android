"""
QD 模拟器 - 环境设置脚本
功能：
1. 解压 QEMU 安装包，提取便携版到 qemu/ 目录
2. 下载 Alpine Linux ISO（最小 rootfs）
3. 验证环境是否就绪
"""
import os
import sys
import subprocess
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent.resolve()
QEMU_DIR = BASE_DIR / 'qemu'
ROOTFS_DIR = BASE_DIR / 'rootfs' / 'minimal'


def extract_qemu_installer():
    """解压 QEMU 安装包（Inno Setup 格式），提取便携版"""
    installer = QEMU_DIR / 'qemu-w64-setup.exe'

    if not installer.exists():
        print(f'错误: 找不到 QEMU 安装包: {installer}')
        print('请先运行: python tools/download_qemu.py')
        return False

    print('=== 解压 QEMU 安装包 ===')
    print(f'安装包: {installer}')
    print()

    # 方法1: 用 7-Zip 解压（如果系统有安装）
    seven_zip = shutil.which('7z')
    if seven_zip:
        print('使用 7-Zip 解压...')
        temp_dir = QEMU_DIR / 'temp_extract'
        temp_dir.mkdir(exist_ok=True)

        result = subprocess.run([
            seven_zip, 'x', str(installer),
            f'-o{temp_dir}', '-y'
        ], capture_output=True, text=True)

        if result.returncode == 0:
            # 找到实际的 QEMU 文件目录
            # Inno Setup 解压后，文件通常在 $PLUGINSDIR 或直接在根目录
            qemu_exe = None
            for root, dirs, files in os.walk(temp_dir):
                if 'qemu-system-x86_64.exe' in files:
                    qemu_exe = Path(root) / 'qemu-system-x86_64.exe'
                    break

            if qemu_exe:
                src_dir = qemu_exe.parent
                print(f'找到 QEMU 目录: {src_dir}')

                # 复制所有文件到 qemu/ 目录
                for item in src_dir.iterdir():
                    dst = QEMU_DIR / item.name
                    if item.is_dir():
                        if dst.exists():
                            shutil.rmtree(dst)
                        shutil.copytree(item, dst)
                    else:
                        shutil.copy2(item, dst)

                # 清理临时目录
                shutil.rmtree(temp_dir, ignore_errors=True)
                print('QEMU 便携版提取完成！')
                return True
            else:
                print('警告: 在解压目录中找不到 qemu-system-x86_64.exe')
                shutil.rmtree(temp_dir, ignore_errors=True)

    # 方法2: 直接运行安装包，静默安装到指定目录
    print('7-Zip 不可用或解压失败，尝试静默安装...')
    install_dir = QEMU_DIR / 'installed'
    install_dir.mkdir(exist_ok=True)

    print(f'安装到: {install_dir}')
    print('注意: 这会弹出安装向导，请按提示完成安装')
    print('      安装目录请选择: ' + str(install_dir))
    print()

    result = subprocess.run([
        str(installer),
        f'/DIR={install_dir}',
        '/VERYSILENT',
        '/NORESTART'
    ], capture_output=True)

    if result.returncode == 0:
        # 检查安装结果
        qemu_exe = install_dir / 'qemu-system-x86_64.exe'
        if qemu_exe.exists():
            # 复制到 qemu/ 目录
            for item in install_dir.iterdir():
                dst = QEMU_DIR / item.name
                if item.is_dir():
                    if dst.exists():
                        shutil.rmtree(dst)
                    shutil.copytree(item, dst)
                else:
                    shutil.copy2(item, dst)
            print('QEMU 安装并提取完成！')
            return True

    print('QEMU 安装失败，请手动运行安装包')
    return False


def verify_qemu():
    """验证 QEMU 是否可用"""
    qemu_exe = QEMU_DIR / 'qemu-system-x86_64.exe'
    qemu_img = QEMU_DIR / 'qemu-img.exe'

    print('=== 验证 QEMU 环境 ===')

    if qemu_exe.exists():
        print(f'  qemu-system-x86_64.exe: 存在')
        # 获取版本
        try:
            result = subprocess.run([str(qemu_exe), '--version'],
                                  capture_output=True, text=True, timeout=10)
            version_line = result.stdout.split('\n')[0] if result.stdout else 'unknown'
            print(f'  版本: {version_line}')
        except:
            pass
    else:
        print(f'  qemu-system-x86_64.exe: 不存在')
        return False

    if qemu_img.exists():
        print(f'  qemu-img.exe: 存在')
    else:
        print(f'  qemu-img.exe: 不存在（部分功能不可用）')

    # 检查 BIOS 文件
    bios_file = QEMU_DIR / 'bios-256k.bin'
    if bios_file.exists():
        print(f'  BIOS (bios-256k.bin): 存在')
    else:
        # 检查 share/ 目录
        share_bios = QEMU_DIR / 'share' / 'qemu' / 'bios-256k.bin'
        if share_bios.exists():
            print(f'  BIOS (share/qemu/bios-256k.bin): 存在')
        else:
            print(f'  BIOS: 未找到（可能需要手动指定）')

    print()
    return True


def main():
    print('=' * 60)
    print('QD 模拟器 - 环境设置')
    print('=' * 60)
    print()

    # 检查是否已经设置好了
    qemu_exe = QEMU_DIR / 'qemu-system-x86_64.exe'
    if qemu_exe.exists():
        print('QEMU 已经设置好了！')
        verify_qemu()
        print()
        print('下一步:')
        print('  1. 下载 Alpine Linux ISO: python tools/download_kernel_rootfs.py')
        print('  2. 创建虚拟机: python src/manager/qd.py create test-vm')
        print('  3. 启动虚拟机: python src/manager/qd.py start test-vm')
        return

    # 检查安装包
    installer = QEMU_DIR / 'qemu-w64-setup.exe'
    if not installer.exists():
        print('错误: 找不到 QEMU 安装包')
        print()
        print('请先下载 QEMU:')
        print('  python tools/download_qemu.py')
        return

    # 解压安装包
    if extract_qemu_installer():
        print()
        verify_qemu()
        print()
        print('环境设置完成！')
        print()
        print('下一步:')
        print('  1. 下载 Alpine Linux ISO: python tools/download_kernel_rootfs.py')
        print('  2. 创建虚拟机: python src/manager/qd.py create test-vm')
        print('  3. 启动虚拟机: python src/manager/qd.py start test-vm')
    else:
        print()
        print('环境设置失败，请检查错误信息')


if __name__ == '__main__':
    main()
