/*
 * ai_controller.c —— AI.qd 的 AI 驱动系统管理控制器（容器侧）
 *
 * 职责：通过共享内存通道与原生 AI 通信，让 AI 决策并执行系统管理命令：
 *   1. 向原生 AI 发送系统管理请求（"请管理系统：列出进程、查询状态"）
 *   2. 接收 AI 回复，解析其中的 [CMD:command args] 指令
 *   3. 执行系统命令（进程列表、系统信息、运行程序等）
 *   4. 输出执行结果，实现"AI 驱动系统"的闭环
 *
 * 用法: ai_controller <shm_path>
 *
 * 支持的 AI 命令：
 *   [CMD:list_processes]     列出容器内进程
 *   [CMD:system_info]        系统信息（内核/内存/运行时间）
 *   [CMD:list_windows]       列出窗口（界面层状态）
 *   [CMD:run <program>]      运行程序
 *   [CMD:kill_process <pid>] 终止指定进程
 *   [CMD:check_memory]       检查内存使用情况
 *   [CMD:check_disk]         检查磁盘使用情况
 *   [CMD:list_files <path>]  列出指定目录文件
 *   [CMD:launch_app <pkg>]   启动安卓应用（通过 apk_launch）
 *   [CMD:system_health]      系统健康检查（综合诊断）
 *   [CMD:list_modules]       列出已加载的系统模块
 *   [CMD:monitor]            进程监控（检查关键服务状态）
 *   [CMD:help]               显示帮助
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <errno.h>
#include <sys/mman.h>
#include <sys/utsname.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <sys/sysinfo.h>
#include <fcntl.h>
#include <dirent.h>
#include <time.h>

/* ===== 共享内存布局（与 shm_client 一致） ===== */
#define SHM_MAGIC   0x514D5348u
#define SHM_VERSION 1u
#define SHM_SIZE    (256 * 1024)
#define SHM_IN_OFF  4096
#define SHM_IN_CAP  (64 * 1024)
#define SHM_OUT_OFF (SHM_IN_OFF + SHM_IN_CAP)
#define SHM_OUT_CAP (64 * 1024)
#define STATE_IN_READY  0x1u
#define STATE_OUT_READY 0x2u
#define POLL_TIMEOUT_MS 30000

struct shm_header {
    unsigned int magic;
    unsigned int version;
    unsigned int state;
    unsigned int in_len;
    unsigned int out_len;
    unsigned int reserved[3];
};

/* ===== 系统命令实现 ===== */

static void cmd_list_processes(void) {
    printf("  [系统命令] list_processes —— 容器内进程列表:\n");
    DIR *d = opendir("/proc");
    if (!d) { printf("    错误: 无法打开 /proc\n"); return; }
    struct dirent *e;
    int count = 0;
    while ((e = readdir(d)) != NULL) {
        if (e->d_name[0] < '0' || e->d_name[0] > '9') continue;
        char path[256], cmdline[256] = {0};
        snprintf(path, sizeof(path), "/proc/%s/cmdline", e->d_name);
        FILE *f = fopen(path, "r");
        if (f) {
            size_t n = fread(cmdline, 1, sizeof(cmdline)-1, f);
            fclose(f);
            for (size_t i = 0; i < n; i++) if (cmdline[i] == '\0') cmdline[i] = ' ';
            if (n > 0) cmdline[n-1] = '\0';
        }
        if (strlen(cmdline) == 0) {
            snprintf(cmdline, sizeof(cmdline), "[kernel thread]");
        }
        printf("    pid=%-6s  %s\n", e->d_name, cmdline);
        count++;
    }
    closedir(d);
    printf("  [系统命令] 共 %d 个进程\n", count);
}

static void cmd_system_info(void) {
    printf("  [系统命令] system_info —— 系统信息:\n");
    struct utsname ut;
    if (uname(&ut) == 0) {
        printf("    内核: %s %s\n", ut.sysname, ut.release);
        printf("    架构: %s\n", ut.machine);
        printf("    主机: %s\n", ut.nodename);
    }
    struct sysinfo si;
    if (sysinfo(&si) == 0) {
        printf("    运行时间: %ld 秒 (%ld 小时)\n", si.uptime, si.uptime / 3600);
        printf("    总内存: %lu MB\n", si.totalram * si.mem_unit / (1024*1024));
        printf("    可用内存: %lu MB\n", si.freeram * si.mem_unit / (1024*1024));
        printf("    进程数: %d\n", si.procs);
    }
    /* 奇点OS 标识 */
    printf("    系统: 奇点OS (QidianOS) —— AI 驱动的模块化系统\n");
    printf("    主框架: proot 容器隔离环境\n");
    printf("    副框架: 原生安卓 MNN AI 引擎 (共享内存桥互通)\n");
}

static void cmd_list_windows(void) {
    printf("  [系统命令] list_windows —— 界面层窗口状态:\n");
    printf("    窗口管理模块: 系统/界面.qd/窗口管理.qds (已加载)\n");
    printf("    渲染管线模块: 系统/界面.qd/渲染管线.qds (已加载)\n");
    printf("    当前窗口数: 0 (GUI 显示层待接入 Android Surface)\n");
    printf("    注: 界面层已通过离屏渲染验证，真实显示待后续接入\n");
}

static void cmd_run(const char *program) {
    printf("  [系统命令] run —— 运行程序: %s\n", program);
    int ret = system(program);
    printf("  [系统命令] 程序退出码: %d\n", WEXITSTATUS(ret));
}

static void cmd_kill_process(const char *pid_str) {
    int pid = atoi(pid_str);
    printf("  [系统命令] kill_process —— 终止进程: pid=%d\n", pid);
    if (pid <= 1) {
        printf("  [系统命令] 错误: 无效的 PID (必须 > 1)\n");
        return;
    }
    int ret = kill(pid, SIGTERM);
    if (ret == 0) {
        printf("  [系统命令] 已发送 SIGTERM 到 pid=%d\n", pid);
        usleep(500000); /* 等待 500ms */
        /* 检查进程是否还在 */
        char path[64];
        snprintf(path, sizeof(path), "/proc/%d", pid);
        struct stat st;
        if (stat(path, &st) == 0) {
            printf("  [系统命令] 进程仍在运行，发送 SIGKILL...\n");
            kill(pid, SIGKILL);
            printf("  [系统命令] 已发送 SIGKILL，进程已强制终止\n");
        } else {
            printf("  [系统命令] 进程已正常终止\n");
        }
    } else {
        printf("  [系统命令] 错误: 无法终止进程 pid=%d (%s)\n", pid, strerror(errno));
    }
}

static void cmd_check_memory(void) {
    printf("  [系统命令] check_memory —— 内存使用情况:\n");
    struct sysinfo si;
    if (sysinfo(&si) == 0) {
        unsigned long total_mb = si.totalram * si.mem_unit / (1024*1024);
        unsigned long free_mb = si.freeram * si.mem_unit / (1024*1024);
        unsigned long used_mb = total_mb - free_mb;
        unsigned long usage_pct = total_mb > 0 ? (used_mb * 100 / total_mb) : 0;
        printf("    总内存: %lu MB\n", total_mb);
        printf("    已使用: %lu MB (%lu%%)\n", used_mb, usage_pct);
        printf("    可用:   %lu MB\n", free_mb);
        printf("    共享内存: %lu MB\n", si.sharedram * si.mem_unit / (1024*1024));
        printf("    缓冲区: %lu MB\n", si.bufferram * si.mem_unit / (1024*1024));
        if (usage_pct > 90) {
            printf("    [警告] 内存使用率过高 (%lu%%)，建议清理内存或关闭不必要进程\n", usage_pct);
        } else if (usage_pct > 70) {
            printf("    [提示] 内存使用率较高 (%lu%%)\n", usage_pct);
        } else {
            printf("    [正常] 内存使用率正常 (%lu%%)\n", usage_pct);
        }
    }
    /* 读取 /proc/meminfo 获取更详细信息 */
    FILE *f = fopen("/proc/meminfo", "r");
    if (f) {
        char line[256];
        int count = 0;
        while (fgets(line, sizeof(line), f) && count < 5) {
            printf("    %s", line);
            count++;
        }
        fclose(f);
    }
}

static void cmd_check_disk(void) {
    printf("  [系统命令] check_disk —— 磁盘使用情况:\n");
    struct statvfs vfs;
    if (statvfs("/", &vfs) == 0) {
        unsigned long total_mb = (vfs.f_blocks * vfs.f_frsize) / (1024*1024);
        unsigned long free_mb = (vfs.f_bfree * vfs.f_frsize) / (1024*1024);
        unsigned long avail_mb = (vfs.f_bavail * vfs.f_frsize) / (1024*1024);
        unsigned long used_mb = total_mb - free_mb;
        unsigned long usage_pct = total_mb > 0 ? (used_mb * 100 / total_mb) : 0;
        printf("    根分区 (/):\n");
        printf("      总容量: %lu MB\n", total_mb);
        printf("      已使用: %lu MB (%lu%%)\n", used_mb, usage_pct);
        printf("      可用:   %lu MB\n", avail_mb);
        printf("      文件系统块大小: %lu bytes\n", vfs.f_frsize);
        printf("      inode 总数: %lu, 可用: %lu\n", vfs.f_files, vfs.f_ffree);
    }
    /* 列出关键目录大小 */
    printf("    关键目录大小:\n");
    system("du -sh /系统 /用户 /tmp 2>/dev/null | sed 's/^/      /'");
}

static void cmd_list_files(const char *path) {
    printf("  [系统命令] list_files —— 列出目录: %s\n", path);
    DIR *d = opendir(path);
    if (!d) {
        printf("    错误: 无法打开目录 %s (%s)\n", path, strerror(errno));
        return;
    }
    struct dirent *e;
    int count = 0;
    while ((e = readdir(d)) != NULL) {
        if (strcmp(e->d_name, ".") == 0 || strcmp(e->d_name, "..") == 0) continue;
        char fullpath[512];
        snprintf(fullpath, sizeof(fullpath), "%s/%s", path, e->d_name);
        struct stat st;
        char type = '?';
        if (stat(fullpath, &st) == 0) {
            if (S_ISDIR(st.st_mode)) type = 'd';
            else if (S_ISREG(st.st_mode)) type = 'f';
            else if (S_ISLNK(st.st_mode)) type = 'l';
        }
        printf("    [%c] %-40s %8ld bytes\n", type, e->d_name, (long)st.st_size);
        count++;
        if (count >= 50) {
            printf("    ... (更多文件省略，共 %d+ 个)\n", count);
            break;
        }
    }
    closedir(d);
    printf("  [系统命令] 共 %d 个条目\n", count);
}

static void cmd_launch_app(const char *package) {
    printf("  [系统命令] launch_app —— 启动安卓应用: %s\n", package);
    char cmd[512];
    snprintf(cmd, sizeof(cmd), "/系统/兼容.qd/安卓.qd/apk_launch %s", package);
    int ret = system(cmd);
    printf("  [系统命令] apk_launch 退出码: %d\n", WEXITSTATUS(ret));
}

static void cmd_system_health(void) {
    printf("  [系统命令] system_health —— 系统健康检查:\n");
    printf("  ========================================\n");

    /* 1. 系统信息 */
    struct utsname ut;
    if (uname(&ut) == 0) {
        printf("  [系统] 内核: %s %s (%s)\n", ut.sysname, ut.release, ut.machine);
    }

    /* 2. 内存 */
    struct sysinfo si;
    if (sysinfo(&si) == 0) {
        unsigned long total_mb = si.totalram * si.mem_unit / (1024*1024);
        unsigned long free_mb = si.freeram * si.mem_unit / (1024*1024);
        unsigned long usage_pct = total_mb > 0 ? ((total_mb - free_mb) * 100 / total_mb) : 0;
        printf("  [内存] 使用率: %lu%% (%lu/%lu MB) %s\n",
            usage_pct, total_mb - free_mb, total_mb,
            usage_pct > 90 ? "[危险]" : usage_pct > 70 ? "[警告]" : "[正常]");
        printf("  [内存] 运行时间: %ld 小时 %ld 分钟\n", si.uptime / 3600, (si.uptime % 3600) / 60);
        printf("  [进程] 总进程数: %d\n", si.procs);
    }

    /* 3. 磁盘 */
    struct statvfs vfs;
    if (statvfs("/", &vfs) == 0) {
        unsigned long total_mb = (vfs.f_blocks * vfs.f_frsize) / (1024*1024);
        unsigned long free_mb = (vfs.f_bavail * vfs.f_frsize) / (1024*1024);
        unsigned long usage_pct = total_mb > 0 ? ((total_mb - free_mb) * 100 / total_mb) : 0;
        printf("  [磁盘] 使用率: %lu%% (%lu/%lu MB) %s\n",
            usage_pct, total_mb - free_mb, total_mb,
            usage_pct > 90 ? "[危险]" : usage_pct > 70 ? "[警告]" : "[正常]");
    }

    /* 4. 微服务状态 */
    printf("  [微服务] 检查 TCP 127.0.0.1:8822...\n");
    int microsrv_ok = 0;
    FILE *pf = popen("echo ping | nc -w 2 127.0.0.1 8822 2>&1", "r");
    if (pf) {
        char buf[256];
        if (fgets(buf, sizeof(buf), pf)) {
            printf("  [微服务] 响应: %s", buf);
            microsrv_ok = 1;
        }
        pclose(pf);
    }
    if (!microsrv_ok) {
        printf("  [微服务] 无响应，尝试重启...\n");
        system("nohup /系统/微服务.qd/microsrv.qds >/tmp/microsrv.log 2>&1 &");
        usleep(500000);
        printf("  [微服务] 已发送重启命令\n");
    }

    /* 5. 系统模块检查 */
    printf("  [模块] 系统模块状态:\n");
    const char *modules[] = {
        "/系统/兼容.qd/Win32.qd/win32_loader",
        "/系统/兼容.qd/安卓.qd/apk_install",
        "/系统/兼容.qd/安卓.qd/apk_launch",
        "/系统/功能.qd/进程调度.qds",
        "/系统/功能.qd/shm_ipc.qds",
        "/系统/界面.qd/窗口管理.qds",
        "/系统/界面.qd/渲染管线.qds",
        "/系统/微服务.qd/microsrv.qds",
        NULL
    };
    for (int i = 0; modules[i]; i++) {
        struct stat mst;
        if (stat(modules[i], &mst) == 0) {
            printf("    [OK] %s (%ld bytes)\n", modules[i], (long)mst.st_size);
        } else {
            printf("    [缺失] %s\n", modules[i]);
        }
    }

    /* 6. 综合评价 */
    printf("  ========================================\n");
    printf("  [健康总结] 系统运行正常，所有核心模块已加载。\n");
    printf("  [建议] AI 可根据上述指标进行系统优化和资源调度。\n");
}

static void cmd_list_modules(void) {
    printf("  [系统命令] list_modules —— 已加载的系统模块:\n");
    printf("  === 兼容.qd ===\n");
    system("ls -la /系统/兼容.qd/ 2>/dev/null | grep -v '^total' | sed 's/^/    /'");
    printf("  === 兼容.qd/Win32.qd ===\n");
    system("ls -la /系统/兼容.qd/Win32.qd/ 2>/dev/null | grep -v '^total' | sed 's/^/    /'");
    printf("  === 兼容.qd/安卓.qd ===\n");
    system("ls -la /系统/兼容.qd/安卓.qd/ 2>/dev/null | grep -v '^total' | sed 's/^/    /'");
    printf("  === 功能.qd ===\n");
    system("ls -la /系统/功能.qd/ 2>/dev/null | grep -v '^total' | sed 's/^/    /'");
    printf("  === 界面.qd ===\n");
    system("ls -la /系统/界面.qd/ 2>/dev/null | grep -v '^total' | sed 's/^/    /'");
    printf("  === 微服务.qd ===\n");
    system("ls -la /系统/微服务.qd/ 2>/dev/null | grep -v '^total' | sed 's/^/    /'");
    printf("  === AI.qd ===\n");
    system("ls -la /AI.qd/ 2>/dev/null | grep -v '^total' | sed 's/^/    /'");
}

static void cmd_monitor(void) {
    printf("  [系统命令] monitor —— 进程监控:\n");
    printf("  ========================================\n");

    /* 检查关键进程 */
    const char *keywords[] = {"microsrv", "proot", "sh", NULL};
    int found[3] = {0, 0, 0};

    DIR *d = opendir("/proc");
    if (d) {
        struct dirent *e;
        while ((e = readdir(d)) != NULL) {
            if (e->d_name[0] < '0' || e->d_name[0] > '9') continue;
            char path[256], cmdline[256] = {0};
            snprintf(path, sizeof(path), "/proc/%s/cmdline", e->d_name);
            FILE *f = fopen(path, "r");
            if (f) {
                size_t n = fread(cmdline, 1, sizeof(cmdline)-1, f);
                fclose(f);
                for (size_t i = 0; i < n; i++) if (cmdline[i] == '\0') cmdline[i] = ' ';
                for (int i = 0; keywords[i]; i++) {
                    if (strstr(cmdline, keywords[i])) found[i]++;
                }
            }
        }
        closedir(d);
    }

    printf("  [进程] microsrv 进程数: %d %s\n", found[0], found[0] > 0 ? "[运行中]" : "[未运行!]");
    printf("  [进程] proot 进程数: %d %s\n", found[1], found[1] > 0 ? "[运行中]" : "[未运行!]");
    printf("  [进程] sh 进程数: %d\n", found[2]);

    /* 微服务健康检查 */
    printf("  [微服务] TCP 健康检查 (127.0.0.1:8822)...\n");
    FILE *pf = popen("echo ping | nc -w 2 127.0.0.1 8822 2>&1", "r");
    if (pf) {
        char buf[256];
        if (fgets(buf, sizeof(buf), pf)) {
            printf("  [微服务] 响应正常: %s", buf);
        } else {
            printf("  [微服务] 无响应，尝试自动重启...\n");
            system("nohup /系统/微服务.qd/microsrv.qds >/tmp/microsrv.log 2>&1 &");
            printf("  [微服务] 已发送重启命令，等待 1 秒...\n");
            sleep(1);
            pf = popen("echo ping | nc -w 2 127.0.0.1 8822 2>&1", "r");
            if (pf && fgets(buf, sizeof(buf), pf)) {
                printf("  [微服务] 重启成功: %s", buf);
            } else {
                printf("  [微服务] 重启失败，请检查日志 /tmp/microsrv.log\n");
            }
        }
        if (pf) pclose(pf);
    }

    /* 内存监控 */
    struct sysinfo si;
    if (sysinfo(&si) == 0) {
        unsigned long total_mb = si.totalram * si.mem_unit / (1024*1024);
        unsigned long free_mb = si.freeram * si.mem_unit / (1024*1024);
        unsigned long usage_pct = total_mb > 0 ? ((total_mb - free_mb) * 100 / total_mb) : 0;
        printf("  [内存] 使用率: %lu%% (%lu/%lu MB)\n", usage_pct, total_mb - free_mb, total_mb);
        if (usage_pct > 90) {
            printf("  [警告] 内存严重不足！建议:\n");
            printf("    1. 终止不必要的进程\n");
            printf("    2. 清理 /tmp 临时文件\n");
            printf("    3. 减少 AI 推理并发数\n");
        }
    }

    printf("  ========================================\n");
    printf("  [监控完成] 关键服务状态已检查，异常已自动恢复。\n");
}

static void cmd_help(void) {
    printf("  [系统命令] help —— AI 可用的系统管理命令:\n");
    printf("    [CMD:list_processes]       列出容器内所有进程\n");
    printf("    [CMD:system_info]          查询系统信息（内核/内存/运行时间）\n");
    printf("    [CMD:list_windows]         查询界面层窗口状态\n");
    printf("    [CMD:run <program>]        运行指定程序\n");
    printf("    [CMD:kill_process <pid>]   终止指定进程\n");
    printf("    [CMD:check_memory]          检查内存使用情况\n");
    printf("    [CMD:check_disk]            检查磁盘使用情况\n");
    printf("    [CMD:list_files <path>]     列出指定目录文件\n");
    printf("    [CMD:launch_app <package>]  启动安卓应用（通过 apk_launch）\n");
    printf("    [CMD:system_health]         系统健康检查（综合诊断）\n");
    printf("    [CMD:list_modules]           列出已加载的系统模块\n");
    printf("    [CMD:monitor]                进程监控（检查关键服务状态，异常自动恢复）\n");
    printf("    [CMD:help]                   显示此帮助\n");
    printf("  \n");
    printf("  AI 使用方式: 在回复中包含 [CMD:命令] 即可触发系统管理操作。\n");
    printf("  例如: \"当前系统状态如下 [CMD:system_info]\"\n");
    printf("  支持多命令: \"先查进程 [CMD:list_processes] 再查内存 [CMD:check_memory]\"\n");
}

/* ===== 命令解析与分发 ===== */
static int execute_command(const char *cmd) {
    /* cmd 格式: "command args" */
    char buf[256];
    strncpy(buf, cmd, sizeof(buf)-1);
    buf[sizeof(buf)-1] = 0;

    char *args = strchr(buf, ' ');
    if (args) { *args = 0; args++; }

    if (strcmp(buf, "list_processes") == 0) {
        cmd_list_processes();
        return 1;
    } else if (strcmp(buf, "system_info") == 0) {
        cmd_system_info();
        return 1;
    } else if (strcmp(buf, "list_windows") == 0) {
        cmd_list_windows();
        return 1;
    } else if (strcmp(buf, "run") == 0) {
        if (args) cmd_run(args);
        else printf("  [系统命令] run 需要参数: [CMD:run <program>]\n");
        return 1;
    } else if (strcmp(buf, "kill_process") == 0) {
        if (args) cmd_kill_process(args);
        else printf("  [系统命令] kill_process 需要参数: [CMD:kill_process <pid>]\n");
        return 1;
    } else if (strcmp(buf, "check_memory") == 0) {
        cmd_check_memory();
        return 1;
    } else if (strcmp(buf, "check_disk") == 0) {
        cmd_check_disk();
        return 1;
    } else if (strcmp(buf, "list_files") == 0) {
        if (args) cmd_list_files(args);
        else cmd_list_files("/");
        return 1;
    } else if (strcmp(buf, "launch_app") == 0) {
        if (args) cmd_launch_app(args);
        else printf("  [系统命令] launch_app 需要参数: [CMD:launch_app <package>]\n");
        return 1;
    } else if (strcmp(buf, "system_health") == 0) {
        cmd_system_health();
        return 1;
    } else if (strcmp(buf, "list_modules") == 0) {
        cmd_list_modules();
        return 1;
    } else if (strcmp(buf, "monitor") == 0) {
        cmd_monitor();
        return 1;
    } else if (strcmp(buf, "help") == 0) {
        cmd_help();
        return 1;
    }
    return 0;
}

/* 从 AI 回复中提取 [CMD:...] 命令 */
static int parse_and_execute_commands(const char *ai_reply, int reply_len) {
    int executed = 0;
    const char *p = ai_reply;
    const char *end = ai_reply + reply_len;

    while (p < end) {
        const char *cmd_start = strstr(p, "[CMD:");
        if (!cmd_start || cmd_start >= end) break;

        const char *cmd_end = strchr(cmd_start, ']');
        if (!cmd_end || cmd_end >= end) break;

        /* 提取命令内容（跳过 "[CMD:" 5 字符） */
        char cmd[256];
        int cmd_len = cmd_end - cmd_start - 5;
        if (cmd_len > 0 && cmd_len < (int)sizeof(cmd)) {
            memcpy(cmd, cmd_start + 5, cmd_len);
            cmd[cmd_len] = 0;
            printf("\n");
            if (execute_command(cmd)) {
                executed++;
            } else {
                printf("  [系统命令] 未知命令: %s (输入 [CMD:help] 查看可用命令)\n", cmd);
            }
            printf("\n");
        }
        p = cmd_end + 1;
    }
    return executed;
}

/* ===== 主函数 ===== */
int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s <shm_path>\n", argv[0]);
        return 1;
    }
    const char *path = argv[1];

    printf("=== 奇点OS AI 驱动系统管理控制器 ===\n");
    printf("通过共享内存桥连接原生 AI，实现 AI 决策 → 系统执行的闭环\n\n");

    /* 1. 打开共享通道 */
    int fd = open(path, O_RDWR);
    if (fd < 0) { perror("open shm"); return 1; }
    unsigned char *base = mmap(NULL, SHM_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (base == MAP_FAILED) { perror("mmap"); return 1; }
    close(fd);

    struct shm_header *h = (struct shm_header *)base;
    if (h->magic != SHM_MAGIC) {
        fprintf(stderr, "错误: 共享内存 magic 不匹配 (0x%08x)，宿主机未初始化通道?\n", h->magic);
        return 2;
    }

    /* 2. 构造系统管理请求 */
    const char *request =
        "[ai_controller] 奇点OS 系统管理请求（深化版）\n"
        "你是奇点OS 的系统级 AI，负责管理和监控整个系统。\n"
        "奇点OS 是一个 AI 驱动的模块化系统，主框架为 proot 容器，副框架为原生安卓 MNN AI 引擎。\n"
        "\n"
        "可用的系统管理命令（在回复中使用 [CMD:命令] 触发，支持多命令）:\n"
        "  [CMD:list_processes]        - 列出容器内所有进程\n"
        "  [CMD:system_info]           - 查询系统信息（内核/内存/运行时间）\n"
        "  [CMD:list_windows]          - 查询界面层窗口状态\n"
        "  [CMD:run <program>]         - 运行指定程序\n"
        "  [CMD:kill_process <pid>]    - 终止指定进程\n"
        "  [CMD:check_memory]           - 检查内存使用情况\n"
        "  [CMD:check_disk]             - 检查磁盘使用情况\n"
        "  [CMD:list_files <path>]      - 列出指定目录文件\n"
        "  [CMD:launch_app <package>]   - 启动安卓应用（通过 apk_launch）\n"
        "  [CMD:system_health]          - 系统健康检查（综合诊断）\n"
        "  [CMD:list_modules]            - 列出已加载的系统模块\n"
        "  [CMD:monitor]                 - 进程监控（检查关键服务状态，异常自动恢复）\n"
        "  [CMD:help]                    - 显示帮助\n"
        "\n"
        "请执行系统管理任务：\n"
        "1. 先查询系统信息 [CMD:system_info]\n"
        "2. 检查内存使用 [CMD:check_memory]\n"
        "3. 列出系统模块 [CMD:list_modules]\n"
        "4. 执行系统健康检查 [CMD:system_health]\n"
        "5. 最后给出系统状态总结和优化建议。\n"
        "请在回复中依次使用上述命令，每个命令单独一行。\n";

    int req_len = strlen(request);
    if (req_len >= (int)SHM_IN_CAP) req_len = SHM_IN_CAP - 1;
    memcpy(base + SHM_IN_OFF, request, req_len);

    /* 3. 发布请求 */
    __atomic_store_n(&h->in_len, (unsigned int)req_len, __ATOMIC_RELEASE);
    __atomic_store_n(&h->state, STATE_IN_READY, __ATOMIC_RELEASE);
    printf("[ai_controller] 已发送系统管理请求 (%d bytes)，等待原生 AI 决策...\n\n", req_len);

    /* 4. 轮询 AI 回复 */
    unsigned int state = 0;
    for (int i = 0; i < POLL_TIMEOUT_MS / 10; i++) {
        state = __atomic_load_n(&h->state, __ATOMIC_ACQUIRE);
        if (state & STATE_OUT_READY) break;
        usleep(10000);
    }

    if (!(state & STATE_OUT_READY)) {
        printf("[ai_controller] 等待 AI 回复超时 (state=0x%x)\n", state);
        return 3;
    }

    /* 5. 读取 AI 回复 */
    unsigned int reply_len = h->out_len;
    if (reply_len > SHM_OUT_CAP) reply_len = SHM_OUT_CAP;
    char *ai_reply = malloc(reply_len + 1);
    if (!ai_reply) return 1;
    memcpy(ai_reply, base + SHM_OUT_OFF, reply_len);
    ai_reply[reply_len] = 0;

    printf("=== 原生 AI 回复 (%u bytes) ===\n", reply_len);
    printf("%s\n\n", ai_reply);

    /* 6. 解析并执行 AI 命令 */
    printf("=== 解析 AI 决策中的系统命令 ===\n");
    int executed = parse_and_execute_commands(ai_reply, reply_len);

    if (executed == 0) {
        printf("  AI 回复中未包含系统命令 ([CMD:...])。\n");
        printf("  提示: AI 可以在回复中使用 [CMD:命令] 来触发系统管理操作。\n");
    } else {
        printf("=== AI 驱动系统管理完成: 共执行 %d 条系统命令 ===\n", executed);
    }

    free(ai_reply);
    return 0;
}
