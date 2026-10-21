/*
 * apk_parse.c —— 兼容.qd/安卓.qd 的 APK 解析器（真实实现）
 *
 * 职责：解析 Android APK（ZIP 结构）：
 *   - 列出中央目录条目（文件清单）
 *   - 识别 ABI（lib/<abi>/）
 *   - 识别 classes.dex
 *   - 解压 AndroidManifest.xml（支持 stored / deflate），提取包名
 *
 * 用法: apk_parse <test.apk>
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

/* ---- 最小 ZIP 解析（EOCD + 中央目录 + 本地头） ---- */
static uint32_t rd32(const unsigned char *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static uint16_t rd16(const unsigned char *p) {
    return (uint16_t)(p[0] | (p[1] << 8));
}

/* inflate（raw deflate）：足够解压 manifest 的小型实现 */
#include <zlib.h>

static int inflate_raw(const unsigned char *in, size_t inlen,
                       unsigned char *out, size_t outcap) {
    z_stream zs;
    memset(&zs, 0, sizeof(zs));
    if (inflateInit2(&zs, -15) != Z_OK) return -1;
    zs.next_in = (unsigned char *)in;
    zs.avail_in = (uInt)inlen;
    zs.next_out = out;
    zs.avail_out = (uInt)outcap;
    int r = inflate(&zs, Z_FINISH);
    size_t got = (size_t)zs.total_out;
    inflateEnd(&zs);
    return (r == Z_STREAM_END || r == Z_OK || r == Z_BUF_ERROR) ? (int)got : -1;
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s <apk>\n", argv[0]);
        return 1;
    }
    FILE *f = fopen(argv[1], "rb");
    if (!f) { perror("open"); return 1; }
    fseek(f, 0, SEEK_END);
    long fsz = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (fsz < 22) { fprintf(stderr, "too small\n"); return 1; }
    unsigned char *data = malloc(fsz);
    if (!data) return 1;
    if (fread(data, 1, fsz, f) != (size_t)fsz) return 1;
    fclose(f);

    /* EOCD: 从尾部找 PK\x05\x06 */
    long eocd = -1;
    for (long i = fsz - 22; i >= 0 && i > fsz - 65536 - 22; i--) {
        if (data[i] == 'P' && data[i+1] == 'K' && data[i+2] == 5 && data[i+3] == 6) { eocd = i; break; }
    }
    if (eocd < 0) { fprintf(stderr, "EOCD not found (不是合法 ZIP/APK)\n"); return 1; }
    unsigned char *e = data + eocd;
    uint16_t n_entries = rd16(e + 10);
    uint32_t cd_off = rd32(e + 16);

    printf("=== APK 解析: %s (%ld bytes, %u entries) ===\n", argv[1], fsz, n_entries);
    int has_dex = 0, has_manifest = 0;
    char abi[64] = "?";

    for (int i = 0; i < n_entries; i++) {
        unsigned char *c = data + cd_off;
        if (c + 46 > data + fsz || c[0] != 'P' || c[1] != 'K' || c[2] != 1 || c[3] != 2) {
            fprintf(stderr, "中央目录损坏 @%d\n", i);
            break;
        }
        uint16_t method = rd16(c + 10);
        uint32_t csize = rd32(c + 20);
        uint32_t usize = rd32(c + 24);
        uint16_t nlen = rd16(c + 28);
        uint32_t lho = rd32(c + 42);
        /* 复制文件名到本地缓冲再截断（不能原地写 NUL，会破坏下一条目签名） */
        char nb[256];
        int nn = nlen < 255 ? nlen : 255;
        memcpy(nb, c + 46, nn);
        nb[nn] = 0;
        const char *name = nb;

        /* 关键文件判定 */
        if (strcmp(name, "AndroidManifest.xml") == 0) has_manifest = 1;
        if (strncmp(name, "classes", 7) == 0 && strstr(name, ".dex")) has_dex = 1;
        if (strncmp(name, "lib/", 4) == 0) {
            /* lib/<abi>/... 提取 ABI */
            char *p = name + 4, *q = strchr(p, '/');
            if (q && q - p < 60) { memcpy(abi, p, q - p); abi[q - p] = 0; }
        }

        /* 打印部分条目（前 20 + 关键文件） */
        int key = strcmp(name, "AndroidManifest.xml") == 0 ||
                  strstr(name, ".dex") || strncmp(name, "lib/", 4) == 0;
        if (i < 12 || key) {
            printf("  [%02d] %-40s method=%s usize=%u csize=%u\n",
                   i, name, method == 0 ? "stored" : (method == 8 ? "deflate" : "?"),
                   usize, csize);
        }
        if (i == 12 && n_entries > 15) printf("  ... (%u 更多) ...\n", n_entries - 13);

        /* 解压 manifest 找包名 */
        if (strcmp(name, "AndroidManifest.xml") == 0) {
            unsigned char *l = data + lho;
            uint32_t lsize = rd32(l + 18);   /* 本地头里的压缩大小 */
            unsigned char *content = data + lho + 30 + rd16(l + 26);
            unsigned char *out = malloc(usize + 1);
            long got = -1;
            if (method == 0) {
                got = (lsize <= usize) ? (long)lsize : (long)usize;
                memcpy(out, content, got);
            } else if (method == 8) {
                got = inflate_raw(content, csize, out, usize);
            }
            if (got > 0) {
                out[got] = 0;
                /* 提取包名：搜索 package= 附近的 ASCII 串（真实 AXML 的字符串池含包名） */
                printf("  --- AndroidManifest.xml (%ld bytes) 内容摘要 ---\n", got);
                const char *keys[] = { "package=", "package\"", NULL };
                for (int k = 0; keys[k]; k++) {
                    const char *hit = NULL;
                    for (long j = 0; j < got; j++) {
                        if (memcmp(out + j, keys[k], strlen(keys[k])) == 0) { hit = (const char *)out + j; break; }
                    }
                    if (hit) {
                        /* 提取可打印串 */
                        char pk[128]; int m = 0;
                        for (const char *s = hit; *s && m < 127; s++) {
                            unsigned char ch = *s;
                            if (ch >= 0x20 && ch < 0x7f) pk[m++] = (char)ch;
                            else if (ch == '"' || ch == 0) break;
                        }
                        pk[m] = 0;
                        printf("  包名字符串: %s\n", pk);
                        break;
                    }
                }
            } else {
                printf("  --- AndroidManifest.xml 解压失败 (method=%u) ---\n", method);
            }
            free(out);
        }

        cd_off += 46 + nlen + rd16(c + 30) + rd16(c + 32);
    }

    printf("=== 结论: manifest=%s dex=%s abi=%s ===\n",
           has_manifest ? "有" : "无", has_dex ? "有" : "无", abi);
    free(data);
    return 0;
}
