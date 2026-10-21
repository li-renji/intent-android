import urllib.request
import re
import os
import sys

def list_files(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        content = resp.read().decode('utf-8', errors='ignore')
    files = re.findall(r'href="([^"]*\.(?:exe|zip))"', content)
    return sorted(set(files))

def download_file(url, output):
    print(f'下载: {url}')
    print(f'保存: {output}')
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=600) as resp:
        total = int(resp.headers.get('Content-Length', 0))
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
                    sys.stdout.write(f'\r  进度: {pct}% ({downloaded//1024//1024}MB / {total//1024//1024}MB)')
                    sys.stdout.flush()
    print()
    size = os.path.getsize(output)
    print(f'完成: {size//1024//1024} MB')

# 列出2024目录
print('=== 列出 https://qemu.eu/w64/2024/ ===')
try:
    files = list_files('https://qemu.eu/w64/2024/')
    for f in files:
        print(f'  {f}')
except Exception as e:
    print(f'失败: {e}')

print()
print('=== 列出 https://qemu.weilnetz.de/w64/2024/ ===')
try:
    files = list_files('https://qemu.weilnetz.de/w64/2024/')
    for f in files:
        print(f'  {f}')
except Exception as e:
    print(f'失败: {e}')
