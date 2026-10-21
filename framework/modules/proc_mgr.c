/*
 * proc_mgr.c —— 功能.qd/进程调度.qds（真实实现）
 *
 * 职责：容器内进程管理/调度：
 *   - 无参数：列出容器内可见进程（PID / 状态 / 名称）
 *   - proc_mgr kill <pid>：终止指定进程
 *   - proc_mgr stat <pid>：查看单进程状态
 *
 * 实现：遍历 /proc/<pid>/stat 与 cmdline。
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <dirent.h>
#include <signal.h>
#include <ctype.h>

static int read_proc_name(int pid, char *out, size_t cap) {
    char path[64];
    snprintf(path, sizeof(path), "/proc/%d/cmdline", pid);
    FILE *f = fopen(path, "r");
    if (!f) return -1;
    size_t n = fread(out, 1, cap - 1, f);
    fclose(f);
    for (size_t i = 0; i < n; i++) if (out[i] == 0 || out[i] == '\n') out[i] = ' ';
    out[n] = 0;
    return (int)n;
}

static int read_proc_state(int pid, char *out, size_t cap) {
    char path[64];
    snprintf(path, sizeof(path), "/proc/%d/stat", pid);
    FILE *f = fopen(path, "r");
    if (!f) return -1;
    /* 格式: pid (comm) state ... —— comm 可能含空格/括号 */
    int p; char comm[256]; char state;
    /* 用 %*s 跳过 pid，再手动解析括号 */
    if (fscanf(f, "%d %255s %c", &p, comm, &state) != 3) { fclose(f); return -1; }
    fclose(f);
    snprintf(out, cap, "%c", state);
    return 0;
}

static const char *state_name(char s) {
    switch (s) {
        case 'R': return "运行";
        case 'S': return "睡眠";
        case 'D': return "不可中断";
        case 'Z': return "僵尸";
        case 'T': return "停止";
        default: return "?";
    }
}

int main(int argc, char **argv) {
    if (argc >= 2 && strcmp(argv[1], "kill") == 0) {
        if (argc < 3) { fprintf(stderr, "usage: %s kill <pid>\n", argv[0]); return 1; }
        int pid = atoi(argv[2]);
        if (pid <= 0) { fprintf(stderr, "非法 pid\n"); return 1; }
        if (kill(pid, SIGTERM) == 0) {
            printf("[进程调度] 已向 pid=%d 发送 SIGTERM\n", pid);
            return 0;
        }
        perror("kill");
        return 1;
    }
    if (argc >= 2 && strcmp(argv[1], "stat") == 0) {
        if (argc < 3) { fprintf(stderr, "usage: %s stat <pid>\n", argv[0]); return 1; }
        int pid = atoi(argv[2]);
        char name[512], st;
        if (read_proc_name(pid, name, sizeof(name)) < 0 ||
            read_proc_state(pid, &st, sizeof(st)) < 0) {
            printf("[进程调度] pid=%d 不存在\n", pid);
            return 1;
        }
        printf("[进程调度] pid=%d state=%s name=%s\n", pid, state_name(st), name);
        return 0;
    }

    printf("=== 进程调度.qds: 容器内进程列表 ===\n");
    DIR *dir = opendir("/proc");
    if (!dir) { perror("opendir /proc"); return 1; }
    struct dirent *ent;
    int count = 0;
    while ((ent = readdir(dir)) != NULL) {
        if (!isdigit((unsigned char)ent->d_name[0])) continue;
        int pid = atoi(ent->d_name);
        char name[512], st;
        if (read_proc_name(pid, name, sizeof(name)) < 0) continue;
        if (read_proc_state(pid, &st, sizeof(st)) < 0) continue;
        printf("  pid=%-6d %-6s %s\n", pid, state_name(st), name);
        count++;
    }
    closedir(dir);
    printf("=== 共 %d 个进程 ===\n", count);
    return 0;
}
