#!/usr/bin/env bash
# ============================================================================
# 下载 Alpine Linux mini rootfs 到 assets（供 APK 首次启动时解压）。
#
# 默认下载与当前 assets/rootfs.tar.gz 相同的版本：
#   Alpine 3.24.1 aarch64 minirootfs（约 3.8MB，静态 busybox，无需联网即可跑）
#
# 用法：
#   ./scripts/fetch_rootfs.sh [URL] [SHA256]
# ============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT_DIR/app/src/main/assets/rootfs.tar.gz"

URL="${1:-https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/aarch64/alpine-minirootfs-3.24.1-aarch64.tar.gz}"
SHA256="${2:-f55a90f69052c5bd6f92cb09a8f47065970830b194c917a006fb94028e721259}"

mkdir -p "$(dirname "$OUT")"
curl -fSL "$URL" -o "$OUT"
echo "$SHA256  $OUT" | sha256sum -c -

echo "OK: $OUT"
