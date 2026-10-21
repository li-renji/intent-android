"""
下载 innoextract Windows 版本，用于解压 QEMU 安装包
"""
import urllib.request
import os
import sys
import zipfile
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent.resolve()
TOOLS_DIR = BASE_DIR / 'tools'

# innoextract GitHub 发布页面
# 最新版本的 Windows 下载链接
download_urls = [
    'https://github.com/dscharrer/innoextract/releases/download/1.9/innoextract-1.9-windows.zip',
    'https://github.com/dscharrer/innoextract/releases/download/1.8/innoextract-1.8-windows.zip',
]

output_zip = TOOLS_DIR / 'innoextract-windows.zip'
output_exe = TOOLS_DIR / 'innoextract.exe'

print('=== 下载 innoextract ===')

for url in download_urls:
    try:
        print(f'尝试: {url}')
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=60) as resp:
            if resp.status == 200:
                total = int(resp.headers.get('Content-Length', 0))
                print(f'  大小: {total//1024} KB')
                with open(output_zip, 'wb') as f:
                    while True:
                        chunk = resp.read(65536)
                        if not chunk:
                            break
                        f.write(chunk)
                print('  下载完成')
                break
            else:
                print(f'  状态: {resp.status}')
    except Exception as e:
        print(f'  失败: {e}')
        continue
else:
    print('所有下载链接都失败了')
    sys.exit(1)

# 解压 zip
print()
print('=== 解压 innoextract ===')
try:
    with zipfile.ZipFile(output_zip, 'r') as zf:
        # 查找 innoextract.exe
        exe_name = None
        for name in zf.namelist():
            if name.lower().endswith('innoextract.exe'):
                exe_name = name
                break

        if exe_name:
            print(f'找到: {exe_name}')
            with zf.open(exe_name) as src, open(output_exe, 'wb') as dst:
                dst.write(src.read())
            print(f'解压到: {output_exe}')
        else:
            print('在 zip 中找不到 innoextract.exe')
            print('zip 内容:')
            for name in zf.namelist():
                print(f'  {name}')
            sys.exit(1)
except Exception as e:
    print(f'解压失败: {e}')
    sys.exit(1)

# 清理 zip
output_zip.unlink()

# 验证
print()
print('=== 验证 ===')
if output_exe.exists():
    print(f'innoextract.exe 大小: {output_exe.stat().st_size//1024} KB')
    print()
    print('使用方法:')
    print(f'  {output_exe} --help')
    print(f'  {output_exe} -d <输出目录> <安装包.exe>')
else:
    print('验证失败')
    sys.exit(1)
