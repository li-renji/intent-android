# -*- coding: utf-8 -*-
"""生成有导入表的 hello.exe（PE32+ x86-64），用于 Win32 兼容加载器测试。"""
import struct, os

samp = r'D:\qidian编辑器 APK\build\samples'
os.makedirs(samp, exist_ok=True)
exe = os.path.join(samp, 'hello.exe')

# ===== 节区布局 =====
# 文件偏移:
#   0x000-0x03F: DOS 头 (64B)
#   0x040-0x057: PE 签名 + COFF 头 (24B)
#   0x058-0x147: 可选头 PE32+ (240B)
#   0x148-0x1BF: 节区表 (3*40=120B)
#   0x200-0x3FF: .text (512B)
#   0x400-0x5FF: .rdata (512B)
#   0x600-0x7FF: .idata (512B)
#
# 虚拟地址 (SectionAlignment=0x1000):
#   .text  VA=0x1000
#   .rdata VA=0x2000
#   .idata VA=0x3000

TEXT_RAW = 0x200
RDATA_RAW = 0x400
IDATA_RAW = 0x600

TEXT_VA = 0x1000
RDATA_VA = 0x2000
IDATA_VA = 0x3000

# .rdata 内容
hello_str = "Hello from Win32 compat layer! (QidianOS)\n\0".encode('utf-8')
rdata = hello_str + b'\x00' * (512 - len(hello_str))

# .idata 布局 (VA=0x3000)
# Import Directory Table (偏移 0x00, 3个描述符=60B)
IDT_ENTRY_SIZE = 20
# 描述符1: msvcrt.dll
desc_msvcrt = struct.pack('<IIIII',
    IDATA_VA + 0x40,  # OriginalFirstThunk (ILT)
    0,                 # TimeDateStamp
    0,                 # ForwarderChain
    IDATA_VA + 0x80,  # Name (DLL名)
    IDATA_VA + 0x60,  # FirstThunk (IAT)
)
# 描述符2: kernel32.dll
desc_kernel32 = struct.pack('<IIIII',
    IDATA_VA + 0x48,  # OriginalFirstThunk
    0,
    0,
    IDATA_VA + 0x90,  # Name
    IDATA_VA + 0x68,  # FirstThunk
)
desc_null = b'\x00' * 20  # 结束描述符

# ILT (偏移 0x40)
ilt_msvcrt = struct.pack('<QQ', IDATA_VA + 0xA0, 0)  # printf hint/name, 结束
ilt_kernel32 = struct.pack('<QQ', IDATA_VA + 0xB0, 0) # ExitProcess hint/name, 结束

# IAT (偏移 0x60) - 初始值同 ILT
iat_msvcrt = struct.pack('<QQ', IDATA_VA + 0xA0, 0)
iat_kernel32 = struct.pack('<QQ', IDATA_VA + 0xB0, 0)

# DLL 名 (偏移 0x80)
dll_msvcrt = b'msvcrt.dll\0'
dll_kernel32 = b'kernel32.dll\0'

# 函数 hint/name (偏移 0xA0)
hint_printf = struct.pack('<H', 0) + b'printf\0'
hint_exit = struct.pack('<H', 0) + b'ExitProcess\0'

# 组装 .idata
idata = bytearray(512)
off = 0
idata[off:off+20] = desc_msvcrt; off += 20
idata[off:off+20] = desc_kernel32; off += 20
idata[off:off+20] = desc_null; off += 20
# ILT at 0x40
off = 0x40
idata[off:off+16] = ilt_msvcrt; off += 16
idata[off:off+16] = ilt_kernel32; off += 16
# IAT at 0x60
off = 0x60
idata[off:off+16] = iat_msvcrt; off += 16
idata[off:off+16] = iat_kernel32; off += 16
# DLL names at 0x80
off = 0x80
idata[off:off+len(dll_msvcrt)] = dll_msvcrt; off += len(dll_msvcrt)
off = 0x90
idata[off:off+len(dll_kernel32)] = dll_kernel32; off += len(dll_kernel32)
# hint/name at 0xA0
off = 0xA0
idata[off:off+len(hint_printf)] = hint_printf; off += len(hint_printf)
off = 0xB0
idata[off:off+len(hint_exit)] = hint_exit; off += len(hint_exit)

# ===== .text 机器码 (x86-64 Microsoft x64 调用约定) =====
# sub rsp, 0x28          ; 影子空间+栈对齐 (48 83 EC 28)
# lea rcx, [rip+offset]  ; 字符串地址 (48 8D 0D XX XX XX XX)
# call [rip+iat_printf]  ; 调用 printf (FF 15 XX XX XX XX)
# xor rcx, rcx           ; ExitProcess(0) (48 31 C9)
# call [rip+iat_exit]    ; 调用 ExitProcess (FF 15 XX XX XX XX)
# int3                    ; CC

text = bytearray(512)
off = 0
# sub rsp, 0x28
text[off:off+4] = b'\x48\x83\xEC\x28'; off += 4
# lea rcx, [rip + (RDATA_VA - (TEXT_VA + off + 7))]
lea_offset = RDATA_VA - (TEXT_VA + off + 7)
text[off:off+7] = b'\x48\x8D\x0D' + struct.pack('<i', lea_offset); off += 7
# call [rip + (IDATA_VA + 0x60 - (TEXT_VA + off + 6))]  ; IAT printf
call_printf_offset = (IDATA_VA + 0x60) - (TEXT_VA + off + 6)
text[off:off+6] = b'\xFF\x15' + struct.pack('<i', call_printf_offset); off += 6
# xor rcx, rcx
text[off:off+3] = b'\x48\x31\xC9'; off += 3
# call [rip + (IDATA_VA + 0x68 - (TEXT_VA + off + 6))]  ; IAT ExitProcess
call_exit_offset = (IDATA_VA + 0x68) - (TEXT_VA + off + 6)
text[off:off+6] = b'\xFF\x15' + struct.pack('<i', call_exit_offset); off += 6
# int3
text[off] = 0xCC

# ===== DOS 头 =====
dos = bytearray(64)
dos[0:2] = b'MZ'
struct.pack_into('<I', dos, 0x3c, 0x40)  # e_lfanew = 0x40

# ===== COFF 头 =====
coff = bytearray(20)
struct.pack_into('<H', coff, 0, 0x8664)   # Machine x86-64
struct.pack_into('<H', coff, 2, 3)         # NumberOfSections
struct.pack_into('<I', coff, 4, 0)         # TimeDateStamp
struct.pack_into('<I', coff, 8, 0)         # PointerToSymbolTable
struct.pack_into('<I', coff, 12, 0)        # NumberOfSymbols
struct.pack_into('<H', coff, 16, 240)      # SizeOfOptionalHeader
struct.pack_into('<H', coff, 18, 0x0022)   # Characteristics: EXECUTABLE_IMAGE | LARGE_ADDRESS_AWARE

# ===== 可选头 PE32+ =====
opt = bytearray(240)
struct.pack_into('<H', opt, 0, 0x20b)       # Magic PE32+
opt[2] = 14; opt[3] = 0                       # LinkerVersion
struct.pack_into('<I', opt, 4, 0x200)        # SizeOfCode
struct.pack_into('<I', opt, 8, 0x400)        # SizeOfInitializedData
struct.pack_into('<I', opt, 12, 0)            # SizeOfUninitializedData
struct.pack_into('<I', opt, 16, 0x1000)      # AddressOfEntryPoint (.text 起始)
struct.pack_into('<I', opt, 20, 0x1000)      # BaseOfCode
struct.pack_into('<Q', opt, 24, 0x140000000) # ImageBase
struct.pack_into('<I', opt, 32, 0x1000)      # SectionAlignment
struct.pack_into('<I', opt, 36, 0x200)       # FileAlignment
struct.pack_into('<H', opt, 40, 6)            # MajorOSVersion
struct.pack_into('<H', opt, 42, 0)            # MinorOSVersion
struct.pack_into('<H', opt, 44, 1)            # MajorImageVersion
struct.pack_into('<H', opt, 46, 0)            # MinorImageVersion
struct.pack_into('<H', opt, 48, 6)            # MajorSubsystemVersion
struct.pack_into('<H', opt, 50, 0)            # MinorSubsystemVersion
struct.pack_into('<I', opt, 52, 0)            # Win32VersionValue
struct.pack_into('<I', opt, 56, 0x4000)       # SizeOfImage (4 个节区*0x1000)
struct.pack_into('<I', opt, 60, 0x200)        # SizeOfHeaders
struct.pack_into('<I', opt, 64, 0)             # CheckSum
struct.pack_into('<H', opt, 68, 3)             # Subsystem: CONSOLE
struct.pack_into('<H', opt, 70, 0)             # DllCharacteristics
struct.pack_into('<Q', opt, 72, 0x100000)     # SizeOfStackReserve
struct.pack_into('<Q', opt, 80, 0x1000)       # SizeOfStackCommit
struct.pack_into('<Q', opt, 88, 0x100000)     # SizeOfHeapReserve
struct.pack_into('<Q', opt, 96, 0x1000)       # SizeOfHeapCommit
struct.pack_into('<I', opt, 104, 0)            # LoaderFlags
struct.pack_into('<I', opt, 108, 16)           # NumberOfRvaAndSizes
# 数据目录[1] = 导入表 (PE32+ 偏移 112)
struct.pack_into('<I', opt, 112, IDATA_VA)    # ImportTable VirtualAddress
struct.pack_into('<I', opt, 116, 60)           # ImportTable Size (3描述符)

# ===== 节区表 =====
def section_header(name, vsize, vaddr, rsize, raw, chars):
    s = bytearray(40)
    s[0:8] = name.encode() + b'\x00' * (8 - len(name))
    struct.pack_into('<I', s, 8, vsize)
    struct.pack_into('<I', s, 12, vaddr)
    struct.pack_into('<I', s, 16, rsize)
    struct.pack_into('<I', s, 20, raw)
    struct.pack_into('<I', s, 24, 0)  # PointerToRelocations
    struct.pack_into('<I', s, 28, 0)  # PointerToLinenumbers
    struct.pack_into('<H', s, 32, 0)  # NumberOfRelocations
    struct.pack_into('<H', s, 34, 0)  # NumberOfLinenumbers
    struct.pack_into('<I', s, 36, chars)
    return s

sec_text = section_header('.text', 0x200, TEXT_VA, 0x200, TEXT_RAW, 0x60000020)  # EXECUTE|READ|CODE
sec_rdata = section_header('.rdata', 0x200, RDATA_VA, 0x200, RDATA_RAW, 0x40000040) # READ|INITIALIZED_DATA
sec_idata = section_header('.idata', 0x200, IDATA_VA, 0x200, IDATA_RAW, 0xC0000040) # READ|WRITE|INITIALIZED_DATA

# ===== 组装文件 =====
with open(exe, 'wb') as f:
    f.write(dos)                    # 0x000
    f.write(b'PE\0\0')             # 0x040
    f.write(coff)                   # 0x044
    f.write(opt)                    # 0x058
    f.write(sec_text)               # 0x148
    f.write(sec_rdata)              # 0x170
    f.write(sec_idata)              # 0x198
    # 填充到 0x200
    f.write(b'\x00' * (0x200 - (64 + 4 + 20 + 240 + 120)))
    f.write(text)                   # 0x200 .text
    f.write(rdata)                  # 0x400 .rdata
    f.write(idata)                  # 0x600 .idata

print('hello.exe:', os.path.getsize(exe), 'bytes')
print('  .text  VA=0x%04x 机器码入口=0x%04x' % (TEXT_VA, TEXT_VA))
print('  .rdata VA=0x%04x 字符串="%s"' % (RDATA_VA, hello_str.split(b'\0')[0].decode()))
print('  .idata VA=0x%04x 导入: msvcrt.printf, kernel32.ExitProcess' % IDATA_VA)
