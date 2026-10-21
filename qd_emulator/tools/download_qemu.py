import urllib.request
import os
import sys

url = 'https://qemu.eu/w64/2024/qemu-w64-setup-20241220.exe'
output = r'D:\起点OS mini APK\qd_emulator\qemu\qemu-w64-setup.exe'

print(f'下载 QEMU 9.x for Windows (64-bit)')
print(f'URL: {url}')
print(f'保存: {output}')
print()

req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=600) as resp:
    total = int(resp.headers.get('Content-Length', 0))
    print(f'文件大小: {total//1024//1024} MB')
    print()
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
                bar_len = 40
                filled = int(bar_len * pct / 100)
                bar = '=' * filled + '-' * (bar_len - filled)
                sys.stdout.write(f'\r  [{bar}] {pct}% ({downloaded//1024//1024}MB / {total//1024//1024}MB)')
                sys.stdout.flush()

print()
print()
size = os.path.getsize(output)
print(f'下载完成: {size//1024//1024} MB')
