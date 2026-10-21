/*
 * microsrv.c —— 微服务.qd/microsrv.qds（真实实现）
 *
 * 职责：低功耗常驻微型服务器主程序（内存占用数 MB 以内）：
 *   - TCP 监听 127.0.0.1:8822
 *   - 每个连接返回一行状态（进程PID / 运行时长 / 内存 / 时间 / 心跳计数）
 *   - 后台永久常驻；SIGTERM 优雅退出
 *
 * 用法: microsrv   （后台常驻，由系统启动器拉起）
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <time.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

#define PORT 8822

static volatile sig_atomic_t running = 1;
static void on_sig(int s) { (void)s; running = 0; }

static long read_uptime(void) {
    FILE *f = fopen("/proc/uptime", "r");
    if (!f) return -1;
    double up = 0;
    fscanf(f, "%lf", &up);
    fclose(f);
    return (long)up;
}

static long read_mem_kb(void) {
    FILE *f = fopen("/proc/self/statm", "r");
    if (!f) return -1;
    long total = 0, rss = 0;
    fscanf(f, "%ld %ld", &total, &rss);
    fclose(f);
    /* statm 单位是页；页大小 4096 */
    long pagesize = sysconf(_SC_PAGESIZE);
    return rss * pagesize / 1024;
}

int main(void) {
    signal(SIGTERM, on_sig);
    signal(SIGINT, on_sig);

    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) { perror("socket"); return 1; }
    int yes = 1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = htons(PORT);
    if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
        perror("bind");
        fprintf(stderr, "microsrv: 端口 %d 被占用？\n", PORT);
        return 1;
    }
    if (listen(fd, 4) != 0) { perror("listen"); return 1; }

    printf("microsrv.qds 已启动: pid=%d 监听 127.0.0.1:%d (常驻)\n", getpid(), PORT);
    fflush(stdout);

    long heartbeat = 0;
    time_t start = time(NULL);
    while (running) {
        struct sockaddr_in cli;
        socklen_t clen = sizeof(cli);
        int c = accept(fd, (struct sockaddr *)&cli, &clen);
        if (c < 0) { if (running) usleep(100000); continue; }
        heartbeat++;
        char resp[256];
        snprintf(resp, sizeof(resp),
                 "奇点OS 微服务 OK | pid=%d | 心跳=%ld | 运行=%lds | 内存≈%ldKB | 时间=%ld\n",
                 getpid(), heartbeat, (long)(time(NULL) - start), read_mem_kb(), (long)time(NULL));
        write(c, resp, strlen(resp));
        close(c);
    }
    close(fd);
    printf("microsrv.qds 已退出 (SIGTERM)\n");
    return 0;
}
