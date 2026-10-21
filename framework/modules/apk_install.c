/*
 * 奇点OS · APK 安装器
 *
 * 功能：
 *   1. 解压 APK（zip 格式，内置 zlib，不依赖系统 unzip）到 /用户/<包名>/
 *   2. 解析二进制 AndroidManifest.xml（AXML 格式）
 *   3. 提取：包名、版本名/版本号、应用名、入口 Activity、权限列表
 *   4. 调用 安装管理.qds register 注册到系统
 *
 * 用法：apk_install <apk文件路径>
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <dirent.h>
#include <errno.h>

/* ========== 工具函数 ========== */

/* 递归创建目录 */
static int mkdir_p(const char *path) {
    char tmp[1024];
    snprintf(tmp, sizeof(tmp), "%s", path);
    int len = strlen(tmp);
    if (len > 0 && tmp[len - 1] == '/') tmp[len - 1] = '\0';
    for (char *p = tmp + 1; *p; p++) {
        if (*p == '/') {
            *p = '\0';
            mkdir(tmp, 0755);
            *p = '/';
        }
    }
    return mkdir(tmp, 0755);
}

/* ========== AXML（二进制 XML）解析器 ========== */

#define AXML_MAGIC 0x00080003
#define CHUNK_STRING_POOL 0x0001
#define CHUNK_RESOURCE_MAP 0x0180
#define CHUNK_START_NS 0x0100
#define CHUNK_END_NS 0x0101
#define CHUNK_START_ELEMENT 0x0102
#define CHUNK_END_ELEMENT 0x0103

#define UTF8_FLAG 0x00000100

typedef struct {
    uint16_t type;
    uint16_t header_size;
    uint32_t size;
} axml_chunk_t;

typedef struct {
    uint32_t count;
    uint32_t style_count;
    uint32_t flags;
    uint32_t strings_start;
    uint32_t styles_start;
    uint32_t *offsets;
    char **strings;
} string_pool_t;

static uint16_t read_u16(const uint8_t *p) { return p[0] | (p[1] << 8); }
static uint32_t read_u32(const uint8_t *p) { return p[0] | (p[1] << 8) | (p[2] << 16) | (p[3] << 24); }

static char *extract_string(const uint8_t *data, uint32_t offset, int is_utf8) {
    const uint8_t *p = data + offset;
    if (is_utf8) {
        int char_len = p[0];
        if (char_len & 0x80) { char_len = ((char_len & 0x7F) << 8) | p[1]; p += 2; } else { p += 1; }
        int byte_len = p[0];
        if (byte_len & 0x80) { byte_len = ((byte_len & 0x7F) << 8) | p[1]; p += 2; } else { p += 1; }
        char *s = malloc(byte_len + 1);
        memcpy(s, p, byte_len);
        s[byte_len] = '\0';
        return s;
    } else {
        int char_len = read_u16(p);
        if (char_len & 0x8000) { char_len = ((char_len & 0x7FFF) << 16) | read_u16(p + 2); p += 4; } else { p += 2; }
        int max_bytes = char_len * 3 + 1;
        char *s = malloc(max_bytes);
        int pos = 0;
        for (int i = 0; i < char_len; i++) {
            uint16_t c = read_u16(p + i * 2);
            if (c < 0x80) s[pos++] = c;
            else if (c < 0x800) { s[pos++] = 0xC0 | (c >> 6); s[pos++] = 0x80 | (c & 0x3F); }
            else { s[pos++] = 0xE0 | (c >> 12); s[pos++] = 0x80 | ((c >> 6) & 0x3F); s[pos++] = 0x80 | (c & 0x3F); }
        }
        s[pos] = '\0';
        return s;
    }
}

static string_pool_t *parse_string_pool(const uint8_t *data, uint32_t offset) {
    const uint8_t *p = data + offset;
    axml_chunk_t *chunk = (axml_chunk_t *)p;
    if (chunk->type != CHUNK_STRING_POOL) return NULL;
    string_pool_t *pool = calloc(1, sizeof(string_pool_t));
    pool->count = read_u32(p + 8);
    pool->style_count = read_u32(p + 12);
    pool->flags = read_u32(p + 16);
    pool->strings_start = read_u32(p + 20);
    pool->styles_start = read_u32(p + 24);
    int is_utf8 = (pool->flags & UTF8_FLAG) != 0;
    pool->offsets = malloc(pool->count * sizeof(uint32_t));
    pool->strings = malloc(pool->count * sizeof(char *));
    const uint8_t *offset_data = p + 28;
    const uint8_t *string_data = p + pool->strings_start;
    for (uint32_t i = 0; i < pool->count; i++) {
        pool->offsets[i] = read_u32(offset_data + i * 4);
        pool->strings[i] = extract_string(string_data, pool->offsets[i], is_utf8);
    }
    return pool;
}

static const char *sp_get(string_pool_t *pool, int idx) {
    if (idx < 0 || idx >= (int)pool->count || !pool->strings[idx]) return "";
    return pool->strings[idx];
}

typedef struct {
    char package[256];
    char version_name[256];
    int version_code;
    char app_label[256];
    char launcher_activity[512];
    char permissions[64][256];
    int permission_count;
    char activities[64][512];
    int activity_count;
} apk_info_t;

typedef struct {
    int namespace_uri;
    int name;
    int raw_value;
    int data_type;
    uint32_t data;
} attribute_t;

static void resolve_attribute(attribute_t *attr, string_pool_t *pool, char *out, int out_size) {
    if (attr->raw_value >= 0 && attr->raw_value < (int)pool->count) {
        snprintf(out, out_size, "%s", sp_get(pool, attr->raw_value));
        return;
    }
    switch (attr->data_type) {
        case 0x03: snprintf(out, out_size, "%s", sp_get(pool, attr->data)); break;
        case 0x10: snprintf(out, out_size, "%s", attr->data ? "true" : "false"); break;
        case 0x02: case 0x04: case 0x11: case 0x12:
            snprintf(out, out_size, "%d", (int)attr->data); break;
        default: snprintf(out, out_size, "0x%x", attr->data);
    }
}

static int parse_axml(const char *path, apk_info_t *info) {
    FILE *f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "[apk_install] 无法打开 %s\n", path); return -1; }
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *data = malloc(size);
    fread(data, 1, size, f);
    fclose(f);
    if (read_u32(data) != AXML_MAGIC) {
        fprintf(stderr, "[apk_install] 不是有效的 AXML (magic=0x%x)\n", read_u32(data));
        free(data); return -1;
    }
    string_pool_t *pool = parse_string_pool(data, 8);
    if (!pool) { free(data); return -1; }

    uint32_t pos = 8;
    int in_activity = 0, in_intent_filter = 0;
    int has_main = 0, has_launcher = 0;
    char current_activity[512] = "";

    while (pos < (uint32_t)size) {
        axml_chunk_t *chunk = (axml_chunk_t *)(data + pos);
        uint16_t type = chunk->type;
        uint32_t chunk_size = chunk->size;
        if (chunk_size == 0) break;

        if (type == CHUNK_START_ELEMENT) {
            const uint8_t *ep = data + pos + 16;
            int name_idx = (int)read_u32(ep + 4);
            int attr_start = read_u16(ep + 8);
            int attr_count = read_u16(ep + 12);
            const char *elem_name = sp_get(pool, name_idx);
            const uint8_t *ap = ep + 16 + attr_start;

            for (int i = 0; i < attr_count; i++) {
                attribute_t attr;
                attr.namespace_uri = (int)read_u32(ap);
                attr.name = (int)read_u32(ap + 4);
                attr.raw_value = (int)read_u32(ap + 8);
                attr.data_type = ap[13];
                attr.data = read_u32(ap + 16);
                const char *attr_name = sp_get(pool, attr.name);
                char value[512] = "";
                resolve_attribute(&attr, pool, value, sizeof(value));

                if (strcmp(elem_name, "manifest") == 0) {
                    if (strcmp(attr_name, "package") == 0) strncpy(info->package, value, 255);
                    else if (strcmp(attr_name, "versionName") == 0) strncpy(info->version_name, value, 255);
                    else if (strcmp(attr_name, "versionCode") == 0) info->version_code = atoi(value);
                } else if (strcmp(elem_name, "application") == 0) {
                    if (strcmp(attr_name, "label") == 0) strncpy(info->app_label, value, 255);
                } else if (strcmp(elem_name, "activity") == 0) {
                    if (strcmp(attr_name, "name") == 0) {
                        strncpy(current_activity, value, 511);
                        if (info->activity_count < 64) {
                            strncpy(info->activities[info->activity_count], value, 255);
                            info->activity_count++;
                        }
                    }
                } else if (strcmp(elem_name, "action") == 0) {
                    if (strcmp(attr_name, "name") == 0 && strcmp(value, "android.intent.action.MAIN") == 0) has_main = 1;
                } else if (strcmp(elem_name, "category") == 0) {
                    if (strcmp(attr_name, "name") == 0 && strcmp(value, "android.intent.category.LAUNCHER") == 0) has_launcher = 1;
                } else if (strcmp(elem_name, "uses-permission") == 0) {
                    if (strcmp(attr_name, "name") == 0 && info->permission_count < 64) {
                        strncpy(info->permissions[info->permission_count], value, 255);
                        info->permission_count++;
                    }
                }
                ap += 20;
            }
            if (strcmp(elem_name, "activity") == 0) in_activity = 1;
            if (strcmp(elem_name, "intent-filter") == 0) in_intent_filter = 1;
        } else if (type == CHUNK_END_ELEMENT) {
            const uint8_t *ep = data + pos + 16;
            int name_idx = (int)read_u32(ep + 4);
            const char *elem_name = sp_get(pool, name_idx);
            if (strcmp(elem_name, "activity") == 0) {
                if (has_main && has_launcher && current_activity[0])
                    strncpy(info->launcher_activity, current_activity, 511);
                in_activity = 0; has_main = 0; has_launcher = 0;
                current_activity[0] = '\0';
            }
            if (strcmp(elem_name, "intent-filter") == 0) in_intent_filter = 0;
        }
        pos += chunk_size;
    }

    for (uint32_t i = 0; i < pool->count; i++) free(pool->strings[i]);
    free(pool->strings); free(pool->offsets); free(pool); free(data);
    return 0;
}

/* ========== ZIP 解压（自解析 + zlib uncompress） ========== */

#include "../../build/zlib/zlib.h"

/* ZIP 结构常量 */
#define LOCAL_FILE_HEADER_SIG 0x04034b50
#define CENTRAL_DIR_SIG       0x02014b50
#define EOCD_SIG              0x06054b50

static int extract_zip(const char *zip_path, const char *dest_dir) {
    FILE *f = fopen(zip_path, "rb");
    if (!f) { fprintf(stderr, "  [错误] 无法打开 ZIP: %s\n", zip_path); return -1; }
    fseek(f, 0, SEEK_END);
    long fsize = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *data = malloc(fsize);
    fread(data, 1, fsize, f);
    fclose(f);

    /* 找 EOCD（从文件末尾往前搜） */
    uint32_t eocd_off = 0;
    for (long i = fsize - 22; i >= 0 && i > fsize - 65557; i--) {
        if (read_u32(data + i) == EOCD_SIG) { eocd_off = i; break; }
    }
    if (!eocd_off) { fprintf(stderr, "  [错误] 未找到 EOCD\n"); free(data); return -1; }

    uint16_t cd_count = read_u16(data + eocd_off + 10);
    uint32_t cd_size = read_u32(data + eocd_off + 12);
    uint32_t cd_off = read_u32(data + eocd_off + 16);
    printf("  ZIP: %d 个条目, 中央目录偏移=0x%x\n", cd_count, cd_off);

    int extracted = 0;
    uint32_t pos = cd_off;
    for (int i = 0; i < cd_count; i++) {
        if (read_u32(data + pos) != CENTRAL_DIR_SIG) break;
        uint16_t method = read_u16(data + pos + 10);
        uint32_t comp_size = read_u32(data + pos + 20);
        uint32_t uncomp_size = read_u32(data + pos + 24);
        uint16_t name_len = read_u16(data + pos + 28);
        uint16_t extra_len = read_u16(data + pos + 30);
        uint16_t comment_len = read_u16(data + pos + 32);
        uint32_t local_hdr_off = read_u32(data + pos + 42);

        char filename[512];
        int fn_len = name_len < 511 ? name_len : 511;
        memcpy(filename, data + pos + 46, fn_len);
        filename[fn_len] = '\0';

        /* 构建输出路径 */
        char out_path[1024];
        snprintf(out_path, sizeof(out_path), "%s/%s", dest_dir, filename);

        int is_dir = (filename[fn_len - 1] == '/');
        if (is_dir) {
            mkdir_p(out_path);
        } else {
            /* 创建父目录 */
            char *slash = strrchr(out_path, '/');
            if (slash) {
                *slash = '\0';
                mkdir_p(out_path);
                struct stat dst;
                if (stat(out_path, &dst) != 0)
                    fprintf(stderr, "  [警告] 父目录不存在: %s (%s)\n", out_path, strerror(errno));
                *slash = '/';
            }

            /* 找本地文件头 */
            uint32_t lh = local_hdr_off;
            if (read_u32(data + lh) != LOCAL_FILE_HEADER_SIG) {
                fprintf(stderr, "  [警告] 本地头签名错误: %s\n", filename);
                pos += 46 + name_len + extra_len + comment_len;
                continue;
            }
            uint16_t lh_name_len = read_u16(data + lh + 26);
            uint16_t lh_extra_len = read_u16(data + lh + 28);
            uint32_t file_data_off = lh + 30 + lh_name_len + lh_extra_len;

            FILE *out = fopen(out_path, "wb");
            if (!out) {
                fprintf(stderr, "  [警告] 无法创建: %s (%s)\n", out_path, strerror(errno));
                pos += 46 + name_len + extra_len + comment_len;
                continue;
            }

            if (method == 0) {
                /* stored：直接复制 */
                fwrite(data + file_data_off, 1, comp_size, out);
            } else if (method == 8) {
                /* deflate：用 miniz 解压 */
                unsigned long dest_len = uncomp_size;
                uint8_t *out_buf = malloc(uncomp_size + 1);
                int ret = uncompress(out_buf, &dest_len, data + file_data_off, comp_size);
                if (ret == Z_OK) {
                    fwrite(out_buf, 1, dest_len, out);
                } else {
                    fprintf(stderr, "  [警告] 解压失败 (%d): %s\n", ret, filename);
                }
                free(out_buf);
            } else {
                fprintf(stderr, "  [警告] 不支持的压缩方法 %d: %s\n", method, filename);
            }
            fclose(out);
            extracted++;
        }

        pos += 46 + name_len + extra_len + comment_len;
    }

    printf("  解压完成: %d 个文件\n", extracted);
    free(data);
    return 0;
}

/* ========== 主程序 ========== */

int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "用法: %s <apk文件路径>\n", argv[0]);
        return 1;
    }

    const char *apk_path = argv[1];
    printf("=== 奇点OS APK 安装器 ===\n");
    printf("  APK: %s\n", apk_path);

    struct stat st;
    if (stat(apk_path, &st) != 0) {
        fprintf(stderr, "  [错误] 文件不存在: %s\n", apk_path);
        return 1;
    }
    printf("  大小: %.1f KB\n", st.st_size / 1024.0);

    /* 创建临时解压目录（用 /用户/.tmp_apk_install，避免 /tmp 不存在） */
    const char *tmp_dir = "/用户/.tmp_apk_install";
    mkdir_p("/用户");
    mkdir_p(tmp_dir);

    /* 解压 APK（内置 miniz） */
    printf("\n[1/4] 解压 APK（miniz）...\n");
    if (extract_zip(apk_path, tmp_dir) != 0) {
        fprintf(stderr, "  [错误] 解压失败\n");
        return 1;
    }
    printf("  解压完成: %s\n", tmp_dir);

    /* 解析 AndroidManifest.xml */
    printf("\n[2/4] 解析 AndroidManifest.xml...\n");
    char manifest_path[600];
    snprintf(manifest_path, sizeof(manifest_path), "%s/AndroidManifest.xml", tmp_dir);

    apk_info_t info;
    memset(&info, 0, sizeof(info));
    if (parse_axml(manifest_path, &info) != 0) {
        fprintf(stderr, "  [错误] Manifest 解析失败\n");
        return 1;
    }

    printf("  包名: %s\n", info.package);
    printf("  版本: %s (code=%d)\n", info.version_name, info.version_code);
    printf("  应用名: %s\n", info.app_label[0] ? info.app_label : "(未指定)");
    printf("  入口 Activity: %s\n", info.launcher_activity[0] ? info.launcher_activity : "(未找到)");
    printf("  Activity 数量: %d\n", info.activity_count);
    printf("  权限数量: %d\n", info.permission_count);
    for (int i = 0; i < info.permission_count; i++)
        printf("    - %s\n", info.permissions[i]);

    if (!info.package[0]) {
        fprintf(stderr, "  [错误] 无法提取包名\n");
        return 1;
    }

    /* 安装到 /用户/<包名>/ */
    printf("\n[3/4] 安装到 /用户/%s/...\n", info.package);
    char install_dir[512];
    snprintf(install_dir, sizeof(install_dir), "/用户/%s", info.package);

    char cmd[1024];
    snprintf(cmd, sizeof(cmd), "rm -rf '%s'", install_dir);
    system(cmd);

    snprintf(cmd, sizeof(cmd), "mv '%s' '%s'", tmp_dir, install_dir);
    if (system(cmd) != 0) {
        snprintf(cmd, sizeof(cmd), "cp -r '%s' '%s' && rm -rf '%s'", tmp_dir, install_dir, tmp_dir);
        system(cmd);
    }
    printf("  安装目录: %s\n", install_dir);

    /* 写入应用信息文件 */
    char info_path[600];
    snprintf(info_path, sizeof(info_path), "%s/.qidian_app_info", install_dir);
    FILE *f = fopen(info_path, "w");
    if (f) {
        fprintf(f, "package=%s\n", info.package);
        fprintf(f, "version_name=%s\n", info.version_name);
        fprintf(f, "version_code=%d\n", info.version_code);
        fprintf(f, "label=%s\n", info.app_label);
        fprintf(f, "launcher_activity=%s\n", info.launcher_activity);
        fprintf(f, "activity_count=%d\n", info.activity_count);
        fprintf(f, "permission_count=%d\n", info.permission_count);
        for (int i = 0; i < info.permission_count; i++)
            fprintf(f, "permission_%d=%s\n", i, info.permissions[i]);
        fclose(f);
        printf("  应用信息已写入\n");
    }

    /* 注册到安装管理 */
    printf("\n[4/4] 注册到系统安装管理...\n");
    snprintf(cmd, sizeof(cmd),
        "/系统/兼容.qd/安装管理.qds register '%s' '%s' 2>&1",
        info.app_label[0] ? info.app_label : info.package, install_dir);
    int ret = system(cmd);
    printf("  注册结果: ret=%d\n", ret);

    printf("\n=== 已安装应用列表 ===\n");
    system("/系统/兼容.qd/安装管理.qds list 2>&1");

    printf("\n=== APK 安装完成 ===\n");
    printf("  包名: %s\n", info.package);
    printf("  入口: %s\n", info.launcher_activity);
    printf("  路径: %s\n", install_dir);
    printf("  启动方式: apk_launch %s\n", info.package);

    return 0;
}
