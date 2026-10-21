/*
 * ai_service.c —— AI.qd/ai_service.qds（真实实现）
 *
 * 职责：系统级 AI 服务（容器内常驻）：
 *   - 通过共享内存通道（功能.qd/shm_ipc.qds 的通道）接收请求
 *   - 按 AI 跳转规则路由（qdai 规则的自然语言含义在此落地为代码分支）
 *   - 推理内核当前为占位（规则化响应）；真实模型推理（llama/MNN）
 *     在此函数接入，接口不变：输入字节 → 输出字节
 *   - 常驻循环：处理完一条继续等下一条
 *
 * 用法: ai_service <shm_path> <tag>   （后台常驻）
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/mman.h>
#include <fcntl.h>
#include <signal.h>

#define SHM_MAGIC   0x514D5348u
#define SHM_SIZE    (256 * 1024)
#define SHM_IN_OFF  4096
#define SHM_IN_CAP  (64 * 1024)
#define SHM_OUT_OFF (SHM_IN_OFF + SHM_IN_CAP)
#define SHM_OUT_CAP (64 * 1024)
#define STATE_IN_READY  0x1u
#define STATE_OUT_READY 0x2u

struct shm_header {
    unsigned int magic, version, state, in_len, out_len;
    unsigned int reserved[3];
};

static volatile sig_atomic_t running = 1;
static void on_sig(int s) { (void)s; running = 0; }

/* 简易规则路由：根据请求文本中的主题词决定响应方向 */
static const char *route(const unsigned char *in, unsigned int len) {
    static char buf[256];
    unsigned int n = len < sizeof(buf) - 1 ? len : sizeof(buf) - 1;
    for (unsigned int i = 0; i < n; i++) buf[i] = (char)in[i];
    buf[n] = 0;
    /* 转小写便于匹配 */
    for (unsigned int i = 0; i < n; i++)
        if (buf[i] >= 'A' && buf[i] <= 'Z') buf[i] += 32;
    if (strstr(buf, "apk")) return "兼容层(安卓)";
    if (strstr(buf, "exe") || strstr(buf, "win") || strstr(buf, "pe")) return "兼容层(Win32)";
    if (strstr(buf, "进程") || strstr(buf, "proc")) return "功能层(进程调度)";
    if (strstr(buf, "shm") || strstr(buf, "内存") || strstr(buf, "ipc")) return "功能层(shm_ipc)";
    if (strstr(buf, "窗口") || strstr(buf, "渲染") || strstr(buf, "gui")) return "界面层";
    if (strstr(buf, "微服务") || strstr(buf, "microsrv")) return "微服务.qd";
    return "AI.qd(全局)";
}

/* AI 推理内核（占位）：基于规则的响应；真实模型推理在此替换 */
static int ai_infer(const unsigned char *in, unsigned int in_len,
                    unsigned char *out, unsigned int cap) {
    const char *r = route(in, in_len);
    const char *fmt = "[AI(ai_service.qds)] 已路由到 %s；请求: ";
    int n = snprintf((char *)out, cap, fmt, r);
    unsigned int m = in_len < (cap - (unsigned int)n - 1) ? in_len : (cap - (unsigned int)n - 1);
    for (unsigned int i = 0; i < m; i++) out[n + i] = in[i];
    n += m;
    out[n] = 0;
    return n;
}

int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: %s <shm_path> <tag>\n", argv[0]);
        return 1;
    }
    const char *path = argv[1];
    const char *tag = argv[2];
    signal(SIGTERM, on_sig);

    int fd = open(path, O_RDWR);
    if (fd < 0) { perror("open shm"); return 1; }
    unsigned char *base = mmap(NULL, SHM_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    if (base == MAP_FAILED) { perror("mmap"); return 1; }

    struct shm_header *h = (struct shm_header *)base;
    if (h->magic != SHM_MAGIC) {
        fprintf(stderr, "ai_service: 通道未初始化 (magic=0x%08x)\n", h->magic);
        return 2;
    }

    printf("ai_service.qds 已启动: pid=%d tag=%s 常驻监听共享内存通道\n", getpid(), tag);
    fflush(stdout);

    long served = 0;
    while (running) {
        unsigned int state = __atomic_load_n(&h->state, __ATOMIC_ACQUIRE);
        if (state & STATE_IN_READY) {
            unsigned int in_len = h->in_len;
            if (in_len > SHM_IN_CAP) in_len = SHM_IN_CAP;
            /* 清除输入标志（抢到处理权） */
            __atomic_store_n(&h->state, state & ~STATE_IN_READY, __ATOMIC_RELEASE);

            unsigned int out_len = ai_infer(base + SHM_IN_OFF, in_len,
                                            base + SHM_OUT_OFF, SHM_OUT_CAP);
            __atomic_store_n(&h->out_len, out_len, __ATOMIC_RELEASE);
            __atomic_store_n(&h->state, STATE_OUT_READY, __ATOMIC_RELEASE);
            served++;
            printf("ai_service: 已处理请求 #%ld (%u -> %u bytes)\n", served, in_len, out_len);
            fflush(stdout);
        }
        usleep(10000);
    }
    munmap(base, SHM_SIZE);
    printf("ai_service.qds 已退出 (共处理 %ld 条)\n", served);
    return 0;
}
