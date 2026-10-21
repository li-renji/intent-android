/*
 * apm_install.c —— 兼容.qd/安装管理.qds（真实实现）
 *
 * 职责：APP 安装路径、注册表模拟、存储管理：
 *   - register <名称> <路径>：登记一个已安装的应用（APK/EXE）到注册表
 *   - list：列出全部已登记应用（注册表内容）
 *   - remove <名称>：卸载登记
 *
 * 注册表位置：/用户/registry.ini（用户数据区，容器内可见）
 * 用法: 安装管理.qds register 测试应用 /用户/测试.apk
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define REGISTRY "/用户/registry.ini"

static int registry_has(const char *name) {
    FILE *f = fopen(REGISTRY, "r");
    if (!f) return 0;
    char line[512];
    int found = 0;
    char key[128];
    snprintf(key, sizeof(key), "[%s]", name);
    while (fgets(line, sizeof(line), f)) {
        if (strncmp(line, key, strlen(key)) == 0) { found = 1; break; }
    }
    fclose(f);
    return found;
}

static int cmd_register(const char *name, const char *path) {
    if (registry_has(name)) {
        printf("[安装管理] 已存在登记: %s（如需更新请先 remove）\n", name);
        return 1;
    }
    FILE *f = fopen(REGISTRY, "a");
    if (!f) { perror("打开注册表失败"); return 1; }
    fprintf(f, "[%s]\npath=%s\nstatus=installed\n", name, path);
    fclose(f);
    printf("[安装管理] 已登记: %s -> %s（写入 %s）\n", name, path, REGISTRY);
    return 0;
}

static int cmd_list(void) {
    FILE *f = fopen(REGISTRY, "r");
    if (!f) {
        printf("[安装管理] 注册表为空（尚无已安装应用）\n");
        return 0;
    }
    printf("=== 安装注册表 (%s) ===\n", REGISTRY);
    char line[512];
    char app[128] = "";
    while (fgets(line, sizeof(line), f)) {
        line[strcspn(line, "\n")] = 0;
        if (line[0] == '[') {
            size_t n = strlen(line);
            if (n > 2) { memcpy(app, line + 1, n - 2); app[n - 2] = 0; }
            printf("  应用: %s\n", app);
        } else if (strncmp(line, "path=", 5) == 0) {
            printf("    路径: %s\n", line + 5);
        } else if (strncmp(line, "status=", 7) == 0) {
            printf("    状态: %s\n", line + 7);
        }
    }
    fclose(f);
    return 0;
}

static int cmd_remove(const char *name) {
    FILE *f = fopen(REGISTRY, "r");
    if (!f) { printf("[安装管理] 注册表为空\n"); return 1; }
    char tmp[] = "/tmp/registry.tmp";
    FILE *t = fopen(tmp, "w");
    char line[512];
    char key[128];
    int skipping = 0, removed = 0;
    snprintf(key, sizeof(key), "[%s]", name);
    while (fgets(line, sizeof(line), f)) {
        if (line[0] == '[') {
            skipping = (strncmp(line, key, strlen(key)) == 0);
            if (skipping) removed = 1;
        }
        if (!skipping) fputs(line, t);
    }
    fclose(f);
    fclose(t);
    if (removed) {
        rename(tmp, REGISTRY);
        printf("[安装管理] 已卸载登记: %s\n", name);
        return 0;
    }
    remove(tmp);
    printf("[安装管理] 未找到登记: %s\n", name);
    return 1;
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s register <名称> <路径> | list | remove <名称>\n", argv[0]);
        return 1;
    }
    if (strcmp(argv[1], "register") == 0 && argc >= 4)
        return cmd_register(argv[2], argv[3]);
    if (strcmp(argv[1], "list") == 0)
        return cmd_list();
    if (strcmp(argv[1], "remove") == 0 && argc >= 3)
        return cmd_remove(argv[2]);
    fprintf(stderr, "未知命令: %s\n", argv[1]);
    return 1;
}
