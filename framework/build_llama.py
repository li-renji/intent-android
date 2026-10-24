# -*- coding: utf-8 -*-
"""用 Zig 交叉编译 llama.cpp 为 aarch64-linux-musl 静态库。"""
import os, subprocess, sys, glob

ROOT = r'D:\qidian编辑器 APK\llama.cpp'
ZIG = r'D:\android-build\zig\zig-windows-x86_64-0.13.0\zig.exe'
BUILD = r'D:\qidian编辑器 APK\build\llama'
OUT_LIB = os.path.join(BUILD, 'libllama.a')

os.makedirs(BUILD, exist_ok=True)

INCLUDES = [
    os.path.join(ROOT, 'include'),
    os.path.join(ROOT, 'ggml', 'include'),
    os.path.join(ROOT, 'ggml', 'src'),
    os.path.join(ROOT, 'ggml', 'src', 'ggml-cpu'),
    os.path.join(ROOT, 'src'),
    os.path.join(ROOT, 'common'),
    os.path.join(ROOT, 'vendor'),
]

DEFINES = [
    'GGML_USE_CPU',
    '_GNU_SOURCE',
    'GGML_UNICODE',
    'NDEBUG',
    'GGML_CPU_USE_RUNTIME',
]

CFLAGS = ['-O3', '-fPIC', '-fvisibility=hidden']
CXXFLAGS = ['-O3', '-fPIC', '-fvisibility=hidden', '-std=c++17']

# 需要编译的源文件（CPU 后端 + llama 核心）
C_FILES = [
    'ggml/src/ggml.c',
    'ggml/src/ggml-alloc.c',
    'ggml/src/ggml-quants.c',
    'ggml/src/ggml-cpu/ggml-cpu.c',
    'ggml/src/ggml-cpu/quants.c',
    'ggml/src/ggml-cpu/arch/arm/quants.c',
]

CPP_FILES = [
    'ggml/src/ggml.cpp',
    'ggml/src/gguf.cpp',
    'ggml/src/ggml-backend.cpp',
    'ggml/src/ggml-backend-reg.cpp',
    'ggml/src/ggml-backend-meta.cpp',
    'ggml/src/ggml-backend-dl.cpp',
    'ggml/src/ggml-threading.cpp',
    'ggml/src/ggml-opt.cpp',
    'ggml/src/ggml-cpu/ggml-cpu.cpp',
    'ggml/src/ggml-cpu/ops.cpp',
    'ggml/src/ggml-cpu/binary-ops.cpp',
    'ggml/src/ggml-cpu/unary-ops.cpp',
    'ggml/src/ggml-cpu/vec.cpp',
    'ggml/src/ggml-cpu/traits.cpp',
    'ggml/src/ggml-cpu/iqp.cpp',
    'ggml/src/ggml-cpu/repack.cpp',
    'ggml/src/ggml-cpu/hbm.cpp',
    'ggml/src/ggml-cpu/arch/arm/cpu-feats.cpp',
    'ggml/src/ggml-cpu/arch/arm/repack.cpp',
]
# llama 核心所有 cpp
for f in sorted(glob.glob(os.path.join(ROOT, 'src', '*.cpp'))):
    CPP_FILES.append(os.path.relpath(f, ROOT))
# 所有模型架构（src/models/*.cpp）—— llama-arch 注册表引用，必须全部编入
for f in sorted(glob.glob(os.path.join(ROOT, 'src', 'models', '*.cpp'))):
    CPP_FILES.append(os.path.relpath(f, ROOT))

def inc_flags():
    return ['-I' + p for p in INCLUDES]

def def_flags():
    return ['-D' + d for d in DEFINES]

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print('FAIL:', ' '.join(cmd[:3]), '...')
        print(r.stderr[-2000:])
        sys.exit(1)
    return r

# 容器内模块用 musl 静态链接；JNI .so 也用 musl 编译但链接时强制包含 libc
TARGET = 'aarch64-linux-musl'

objs = []
total = len(C_FILES) + len(CPP_FILES)
done = 0

for src in C_FILES:
    done += 1
    obj = os.path.join(BUILD, src.replace('/', '_').replace('\\', '_') + '.o')
    objs.append(obj)
    cmd = [ZIG, 'cc', '-target', TARGET] + CFLAGS + inc_flags() + def_flags() + ['-c', '-o', obj, os.path.join(ROOT, src)]
    print(f'[{done}/{total}] CC {src}')
    run(cmd)

for src in CPP_FILES:
    done += 1
    obj = os.path.join(BUILD, src.replace('/', '_').replace('\\', '_') + '.o')
    objs.append(obj)
    cmd = [ZIG, 'c++', '-target', TARGET] + CXXFLAGS + inc_flags() + def_flags() + ['-c', '-o', obj, os.path.join(ROOT, src)]
    print(f'[{done}/{total}] CXX {src}')
    run(cmd)

# 打包静态库
print('打包静态库...')
cmd = [ZIG, 'ar', 'rcs', OUT_LIB] + objs
run(cmd)
print(f'完成: {OUT_LIB} ({os.path.getsize(OUT_LIB)/1024/1024:.1f} MB)')
