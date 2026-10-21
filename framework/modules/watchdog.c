/*
 * watchdog.c —— 兼容.qd/闪退保护.qds（真实实现）
 *
 * 职责：进程看门狗，捕获崩溃防止牵连系统：
 *   - 监控指定 pid（循环检查 /proc/<pid>）
 *   - 目标进程消失时：记录崩溃日志（/用户/crash.log）+ 可选自动重启
 *   - 独立运行，即使被监控进程崩溃也不影响其他模块
 *
 * 用法: 闪退保护.qds <pid> [重启命令...]
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <time.h>
#include <signal.h>
#include <sys/wait.h>

#define CRASH_LOG "/用户/crash.log"

static int proc_alive(int pid) {
    char path[64];
    snprintf(path, sizeof(path), "/proc/%d", pid);
    return access(path, F_OK) == 0;
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s <pid> [重启命令...]\n", argv[0]);
        return 1;
    }
    int pid = atoi(argv[1]);
    if (pid <= 0) { fprintf(stderr, "非法 pid\n"); return 1; }

    printf("[闪退保护] 看门狗已启动: 监控 pid=%d（%s）\n",
           pid, argc >= 3 ? "崩溃后自动重启" : "仅记录崩溃");
    fflush(stdout);

    /* 自检：演示模式——监控一个短暂进程，验证崩溃捕获 */
    int crashed = 0;
    while (proc_alive(pid)) {
        usleep(200000);
    }
    crashed = 1;

    time_t now = time(NULL);
    char ts[64];
    snprintf(ts, sizeof(ts), "%s", ctime(&now));
    ts[strcspn(ts, "\n")] = 0;

    FILE *f = fopen(CRASH_LOG, "a");
    if (f) {
        fprintf(f, "[%s] 进程 pid=%d 已退出（崩溃或被终止）", ts, pid);
        if (argc >= 3) fprintf(f, "；执行自动重启");
        fprintf(f, "\n");
        fclose(f);
    }

    printf("[闪退保护] 捕获到 pid=%d 退出，已记录到 %s\n", pid, CRASH_LOG);
    fflush(stdout);

    if (argc >= 3) {
        printf("[闪退保护] 自动重启: %s ...\n", argv[2]);
        pid_t c = fork();
        if (c == 0) {
            /* 子进程执行重启命令 */
            char *args[8];
            int n = 0;
            for (int i = 2; i < argc && n < 7; i++) args[n++] = argv[i];
            args[n] = NULL;
            execvp(args[0], args);
            _exit(127);
        }
        int st;
        waitpid(c, &st, 0);
        printf("[闪退保护] 重启命令已执行 (exit=%d)\n", WEXITSTATUS(st));
    }
    return 0;
}
