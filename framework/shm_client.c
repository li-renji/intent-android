/*
 * shm_client.c —— 容器内共享内存客户端（奇点 OS 框架 · 内存通道 · 容器侧）
 *
 * 用法: shm_client <shm文件路径> <tag>
 *   1. open + mmap 共享通道文件（由宿主机 App 创建，proot -b 绑定到容器内）
 *   2. 写入"容器 → AI"输入（uname 信息 + 问候）
 *   3. 置 IN_READY 状态标志
 *   4. 轮询 OUT_READY（AI 处理完成），读取"AI → 容器"输出
 *   5. 输出结果到 stdout（proot 转发进日志），供宿主验证闭环
 *
 * 静态编译（musl），无任何动态依赖，直接跑在 Alpine rootfs 内。
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/mman.h>
#include <sys/utsname.h>
#include <sys/stat.h>
#include <fcntl.h>

/* 与宿主机 JNI 侧 (shm_jni.c) 保持一致的布局 */
#define SHM_MAGIC   0x514D5348u   /* "QMSH" */
#define SHM_VERSION 1u
#define SHM_SIZE    (256 * 1024)  /* 256 KB 通道 */
#define SHM_IN_OFF  4096          /* 输入区偏移（容器 → AI） */
#define SHM_IN_CAP  (64 * 1024)
#define SHM_OUT_OFF (SHM_IN_OFF + SHM_IN_CAP)  /* 输出区偏移（AI → 容器） */
#define SHM_OUT_CAP (64 * 1024)

#define STATE_IN_READY  0x1u       /* 容器已写入输入 */
#define STATE_OUT_READY 0x2u       /* AI 已写入输出 */

struct shm_header {
    unsigned int magic;
    unsigned int version;
    unsigned int state;
    unsigned int in_len;
    unsigned int out_len;
    unsigned int reserved[3];
};

/* 超时（毫秒） */
#define POLL_TIMEOUT_MS 20000

static void fail(const char *msg) {
    perror(msg);
    _exit(1);
}

int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: %s <shm_path> <tag>\n", argv[0]);
        return 1;
    }
    const char *path = argv[1];
    const char *tag = argv[2];

    /* 1. 打开共享通道文件 */
    int fd = open(path, O_RDWR);
    if (fd < 0) fail("open shm");
    unsigned char *base = mmap(NULL, SHM_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (base == MAP_FAILED) fail("mmap");
    close(fd);

    struct shm_header *h = (struct shm_header *)base;
    if (h->magic != SHM_MAGIC) {
        fprintf(stderr, "shm_client: bad magic 0x%08x (宿主机未初始化通道?)\n", h->magic);
        _exit(2);
    }

    /* 2. 构造输入：tag + uname + 问候 */
    struct utsname ut;
    int n = 0;
    if (uname(&ut) == 0) {
        n = snprintf((char *)base + SHM_IN_OFF, SHM_IN_CAP,
                     "[%s] uname: %s %s %s %s\nhello from qidian-mini-os container\n",
                     tag, ut.sysname, ut.release, ut.machine, ut.version);
    } else {
        n = snprintf((char *)base + SHM_IN_OFF, SHM_IN_CAP,
                     "[%s] hello from qidian-mini-os container\n", tag);
    }
    if (n < 0 || n >= (int)SHM_IN_CAP) n = SHM_IN_CAP - 1;

    /* 3. 发布输入（release 语义，保证数据先于标志可见） */
    __atomic_store_n(&h->in_len, (unsigned int)n, __ATOMIC_RELEASE);
    __atomic_store_n(&h->state, STATE_IN_READY, __ATOMIC_RELEASE);

    /* 4. 轮询 AI 输出 */
    unsigned int state = 0;
    for (int i = 0; i < POLL_TIMEOUT_MS / 10; i++) {
        state = __atomic_load_n(&h->state, __ATOMIC_ACQUIRE);
        if (state & STATE_OUT_READY) break;
        usleep(10000);
    }

    /* 5. 读取并输出 AI 的回复 */
    if (state & STATE_OUT_READY) {
        unsigned int len = h->out_len;
        if (len > SHM_OUT_CAP) len = SHM_OUT_CAP;
        /* 直接写 stdout，proot 转发到宿主日志 */
        write(1, base + SHM_OUT_OFF, len);
        write(1, "\n", 1);
        printf("[shm_client] AI 回复接收成功 (%u bytes)\n", len);
        return 0;
    } else {
        printf("[shm_client] 等待 AI 输出超时 (state=0x%x)\n", state);
        return 3;
    }
}
