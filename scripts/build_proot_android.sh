#!/usr/bin/env bash
# ============================================================================
# 构建 "qidian编辑器 APK" 的 proot 原生库（在 Linux 或 WSL 上运行）
#
# 产物：
#   app/src/main/jniLibs/arm64-v8a/libproot.so   <- JNI 入口 + proot 核心（System.loadLibrary("proot")）
#   app/src/main/assets/libproot_loader.so       <- proot 的 64 位 loader（运行时拷贝到私有目录）
#
# 依赖：
#   - Android NDK r26+（aarch64 工具链）
#   - make / curl / tar / unzip / patch / python3（构建 talloc 需要 waf）
#
# 用法：
#   ANDROID_NDK_HOME=/path/to/android-ndk-r26 ./scripts/build_proot_android.sh
#
# 技术要点（与 tiny_container / Termux 同一套做法）：
#   - proot 源码用 tiny-container 在用的 proot-termux fork（commit 固定）；
#   - proot 5.x 需要一个独立 "loader" 静态 ELF，编译期把它的默认目录
#     编进 proot（PROOT_UNBUNDLE_LOADER），运行时再由 JNI 用 PROOT_LOADER
#     环境变量指向实际路径；
#   - talloc 用 Termux 相同的 waf + cross-answers 交叉编译，链接成静态库；
#   - 所有 proot 目标文件加 -fPIC，最后与 JNI 包装 proot_jni.c 一起链接成
#     共享库 libproot.so。
# ============================================================================
set -euo pipefail

NDK_PATH="${ANDROID_NDK_HOME:-/opt/android-ndk}"
API="${ANDROID_API:-24}"
TARGET=aarch64-linux-android

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="$ROOT_DIR/build/proot-build"
JNI_OUT="$ROOT_DIR/app/src/main/jniLibs/arm64-v8a"
ASSET_OUT="$ROOT_DIR/app/src/main/assets"

# tiny_container 的 termux-packages/proot/build.sh 固定使用的 commit
PROOT_COMMIT="e58b34ff3aa54eb84a708ab2c5e8cd1176f641c7"
# Termux libtalloc 的版本与校验和
TALLOC_VERSION="2.4.3"
TALLOC_SHA256="dc46c40b9f46bb34dd97fe41f548b0e8b247b77a918576733c528e83abd854dd"

# 编译进 proot 的默认 loader 目录（运行时由 PROOT_LOADER 环境变量覆盖）
APP_FILES_DIR="/data/user/0/com.qidian.minios/files"

TOOLCHAIN="$NDK_PATH/toolchains/llvm/prebuilt/linux-x86_64"
CC="$TOOLCHAIN/bin/${TARGET}${API}-clang"
AR="$TOOLCHAIN/bin/llvm-ar"

if [ ! -x "$CC" ]; then
    echo "错误：找不到 NDK 编译器: $CC" >&2
    echo "请设置 ANDROID_NDK_HOME 指向 NDK 根目录" >&2
    exit 1
fi

mkdir -p "$WORK_DIR" "$JNI_OUT" "$ASSET_OUT"

echo "==> [1/4] 构建 talloc $TALLOC_VERSION（Termux 同款 waf cross-answers）"
TALLOC_DIR="$WORK_DIR/talloc-$TALLOC_VERSION"
if [ ! -d "$TALLOC_DIR" ]; then
    curl -fsSL "https://www.samba.org/ftp/talloc/talloc-$TALLOC_VERSION.tar.gz" \
         -o "$WORK_DIR/talloc.tar.gz"
    echo "$TALLOC_SHA256  $WORK_DIR/talloc.tar.gz" | sha256sum -c -
    tar -xzf "$WORK_DIR/talloc.tar.gz" -C "$WORK_DIR"
fi
pushd "$TALLOC_DIR" >/dev/null
cat > cross-answers.txt <<'EOF'
Checking uname sysname type: "Linux"
Checking uname machine type: "dontcare"
Checking uname release type: "dontcare"
Checking uname version type: "dontcare"
Checking simple C program: OK
building library support: OK
Checking for large file support: OK
Checking for -D_FILE_OFFSET_BITS=64: OK
Checking for WORDS_BIGENDIAN: OK
Checking for C99 vsnprintf: OK
Checking for HAVE_SECURE_MKSTEMP: OK
rpath library support: OK
-Wl,--version-script support: FAIL
Checking correct behavior of strtoll: OK
Checking correct behavior of strptime: OK
Checking for HAVE_IFACE_GETIFADDRS: OK
Checking for HAVE_IFACE_IFCONF: OK
Checking for HAVE_IFACE_IFREQ: OK
Checking getconf LFS_CFLAGS: OK
Checking for large file support without additional flags: OK
Checking for working strptime: OK
Checking for HAVE_SHARED_MMAP: OK
Checking for HAVE_MREMAP: OK
Checking for HAVE_INCOHERENT_MMAP: OK
Checking getconf large file support flags work: OK
EOF
export CC
export CFLAGS="-O2 -fPIC"
./configure --prefix="$WORK_DIR/talloc-prefix" --disable-rpath --disable-python \
            --cross-compile --cross-answers=cross-answers.txt
make -j"$(nproc)"
"$AR" rcu "$WORK_DIR/libtalloc.a" bin/default/talloc*.o
popd >/dev/null
echo "    libtalloc.a 完成"

echo "==> [2/4] 获取 proot-termux 源码（commit: $PROOT_COMMIT）"
SRC_DIR="$WORK_DIR/proot-termux-$PROOT_COMMIT"
if [ ! -d "$SRC_DIR" ]; then
    curl -fsSL "https://github.com/tiny-computer/proot-termux/archive/$PROOT_COMMIT.zip" \
         -o "$WORK_DIR/proot-termux.zip"
    unzip -q "$WORK_DIR/proot-termux.zip" -d "$WORK_DIR"
fi

echo "==> [3/4] 打补丁：main -> proot_main（便于链接成共享库）"
pushd "$SRC_DIR" >/dev/null
patch -p1 -N < "$ROOT_DIR/patch/proot-main-as-library.patch" || true
if ! grep -q "int proot_main" src/cli/cli.c; then
    echo "错误：补丁未生效（src/cli/cli.c 中没有 proot_main）" >&2
    exit 1
fi
popd >/dev/null

echo "==> [4/4] 编译 proot 并链接 libproot.so"
pushd "$SRC_DIR/src" >/dev/null
# -fPIC：目标文件最终要链接成共享库
# -DARG_MAX=131072：Termux 为 bionic 附加的定义
# PROOT_UNBUNDLE_LOADER：编译期写死的 loader 默认目录
# HAS_LOADER_32BIT=：本项目只做 arm64，跳过 32 位 loader
make -j"$(nproc)" \
    CC="$CC" \
    CFLAGS="-fPIC -Wall -Wextra -O2" \
    CPPFLAGS="-DARG_MAX=131072 -I$TALLOC_DIR" \
    LDFLAGS="-L$WORK_DIR -ltalloc -Wl,-z,noexecstack" \
    PROOT_UNBUNDLE_LOADER="$APP_FILES_DIR" \
    HAS_LOADER_32BIT=
popd >/dev/null

OBJS=$(find "$SRC_DIR/src" -name '*.o' \
    ! -name '.check_*' \
    ! -name 'loader.o' ! -name 'assembly.o' \
    ! -name 'loader-m32.o' ! -name 'assembly-m32.o')

"$CC" -shared -o "$JNI_OUT/libproot.so" \
    $OBJS \
    "$ROOT_DIR/app/src/main/cpp/proot_jni.c" \
    "$WORK_DIR/libtalloc.a" \
    -Wl,-z,noexecstack

# 64 位 loader：随 APK 打包到 assets，启动时拷到私有目录
cp "$SRC_DIR/src/loader/loader" "$ASSET_OUT/libproot_loader.so"

echo ""
echo "构建完成："
echo "  $JNI_OUT/libproot.so"
echo "  $ASSET_OUT/libproot_loader.so"
echo ""
echo "下一步：用 Android Studio 打开本工程直接构建 APK。"
