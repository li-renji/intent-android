import struct, os, zipfile

samp = r'D:\qidian编辑器 APK\build\samples'
os.makedirs(samp, exist_ok=True)

# ===== 最小 APK 样本（stored 条目，含 manifest/classes.dex/lib）=====
apk = os.path.join(samp, '测试.apk')
manifest = "<?xml version='1.0'?><manifest package='com.qidian.sample'><application/></manifest>"
with zipfile.ZipFile(apk, 'w', zipfile.ZIP_STORED) as z:
    z.writestr('AndroidManifest.xml', manifest)
    z.writestr('classes.dex', b'dex\n035\0' + b'\x00' * 64)
    z.writestr('lib/arm64-v8a/libsample.so', b'\x7fELF' + b'\x00' * 60)
print('APK sample:', os.path.getsize(apk), 'bytes')

# ===== 最小 PE 样本（x86-64, PE32+, 1 节区）=====
exe = os.path.join(samp, '测试.exe')
dos = bytearray(64)
dos[0:2] = b'MZ'
struct.pack_into('<I', dos, 0x3c, 0x40)   # e_lfanew = 64（PE 头紧跟 64 字节 DOS 头）
opt_size = 240
pe = bytearray(4 + 20 + opt_size + 40)
pe[0:4] = b'PE\0\0'
struct.pack_into('<H', pe, 4, 0x8664)      # machine x86-64
struct.pack_into('<H', pe, 6, 1)            # 1 section
struct.pack_into('<I', pe, 8, 0)            # timestamp
struct.pack_into('<H', pe, 20, opt_size)    # opt header size
struct.pack_into('<H', pe, 22, 0x22)        # characteristics
# 可选头（pe[24:] 起，直接按绝对偏移写入，避免切片复制丢写）
struct.pack_into('<H', pe, 24 + 0, 0x20b)       # magic PE32+
struct.pack_into('<I', pe, 24 + 16, 0x1000)     # AddressOfEntryPoint
struct.pack_into('<I', pe, 24 + 24, 0x400)      # SizeOfCode
struct.pack_into('<Q', pe, 24 + 24, 0x140000000)  # ImageBase
struct.pack_into('<I', pe, 24 + 32, 0x1000)     # SectionAlignment
struct.pack_into('<I', pe, 24 + 36, 0x200)      # FileAlignment
struct.pack_into('<H', pe, 24 + 68, 6)          # MajorOS
struct.pack_into('<H', pe, 24 + 88, 6)          # MajorSubsystemVersion
struct.pack_into('<I', pe, 24 + 96, 0x1000)     # SizeOfImage
struct.pack_into('<I', pe, 24 + 100, 0x400)     # SizeOfHeaders
struct.pack_into('<H', pe, 24 + 108, 3)         # Subsystem: CONSOLE
sec_off = 24 + opt_size
struct.pack_into('<8s', pe, sec_off, b'.text\x00\x00\x00')
struct.pack_into('<I', pe, sec_off + 8, 0x1000)      # VirtualSize
struct.pack_into('<I', pe, sec_off + 12, 0x1000)     # VirtualAddress
struct.pack_into('<I', pe, sec_off + 16, 0x400)      # SizeOfRawData
struct.pack_into('<I', pe, sec_off + 20, 0x400)      # PointerToRawData
struct.pack_into('<I', pe, sec_off + 36, 0x60000020) # EXECUTE|READ
with open(exe, 'wb') as f:
    f.write(dos)
    f.write(pe)
    f.write(b'\x90' * 0x400)
print('PE sample:', os.path.getsize(exe), 'bytes')
