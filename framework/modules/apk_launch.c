/*
 * 奇点OS · APK 启动器
 *
 * 通过共享内存桥向宿主安卓发送 APK 启动请求，
 * 宿主安卓通过 Intent 启动已安装的 APK。
 *
 * 协议：
 *   容器→宿主: [APK_LAUNCH]<包名>
 *   宿主→容器: [APK_RESULT]success 或 [APK_RESULT]failed:<原因>
 *
 * 共享内存布局（与宿主 ShmChannel.kt 一致）：
 *   偏移 0    : magic (0x514D5348 = "QMSH")
 *   偏移 4    : version
 *   偏移 8    : state (bit0=IN_READY, bit1=OUT_READY)
 *   偏移 12   : in_len
 *   偏移 16   : out_len
 *   偏移 4096 : 输入区（容器→宿主，64KB）
 *   偏移 69632: 输出区（宿主→容器，64KB）
 *
 * 用法：apk_launch <包名>
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <errno.h>

#define SHM_SIZE (256 * 1024)
#define MAGIC 0x514D5348  /* "QMSH"，与宿主 ShmChannel 一致 */
#define IN_OFF 4096
#define IN_CAP (64 * 1024)
#define OUT_OFF (IN_OFF + IN_CAP)
#define OUT_CAP (64 * 1024)
#define STATE_IN_READY  (1 << 0)
#define STATE_OUT_READY (1 << 1)

static uint8_t *shm_base = NULL;

static inline uint32_t rd32(const uint8_t *p) {
    return p[0] | (p[1] << 8) | (p[2] << 16) | (p[3] << 24);
}
static inline void wr32(uint8_t *p, uint32_t v) {
    p[0] = v & 0xFF; p[1] = (v >> 8) & 0xFF;
    p[2] = (v >> 16) & 0xFF; p[3] = (v >> 24) & 0xFF;
}

static int shm_connect(const char *path) {
    int fd = open(path, O_RDWR);
    if (fd < 0) {
        fprintf(stderr, "[apk_launch] 无法打开共享内存 %s: %s\n", path, strerror(errno));
        return -1;
    }
    shm_base = mmap(NULL, SHM_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    if (shm_base == MAP_FAILED) {
        fprintf(stderr, "[apk_launch] mmap 失败: %s\n", strerror(errno));
        return -1;
    }
    uint32_t magic = rd32(shm_base);
    if (magic != MAGIC) {
        fprintf(stderr, "[apk_launch] magic 不匹配 (0x%x != 0x%x)\n", magic, MAGIC);
        return -1;
    }
    return 0;
}

static void shm_disconnect(void) {
    if (shm_base && shm_base != MAP_FAILED) {
        munmap(shm_base, SHM_SIZE);
        shm_base = NULL;
    }
}

int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "用法: %s <包名>\n", argv[0]);
        return 1;
    }

    const char *package = argv[1];
    const char *shm_path = "/shm/shm.dat";

    printf("=== 奇点OS APK 启动器 ===\n");
    printf("  包名: %s\n", package);
    printf("  通道: %s\n", shm_path);

    if (shm_connect(shm_path) != 0) return 1;
    printf("  [OK] 共享内存已连接 (state=0x%x)\n", rd32(shm_base + 8));

    /* 等待通道空闲（上一个请求已处理完） */
    int wait_count = 0;
    while ((rd32(shm_base + 8) & STATE_IN_READY) || (rd32(shm_base + 8) & STATE_OUT_READY)) {
        /* 如果 OUT_READY 还在，说明上一个请求的输出没被读取，清除它 */
        if (rd32(shm_base + 8) & STATE_OUT_READY) {
            uint32_t s = rd32(shm_base + 8);
            wr32(shm_base + 8, s & ~STATE_OUT_READY);
            __sync_synchronize();
        }
        usleep(100000);
        if (++wait_count > 50) {
            fprintf(stderr, "  [错误] 通道繁忙\n");
            shm_disconnect();
            return 1;
        }
    }

    /* 构造请求 */
    char request[1024];
    int req_len = snprintf(request, sizeof(request), "[APK_LAUNCH]%s", package);
    if (req_len >= IN_CAP) {
        fprintf(stderr, "  [错误] 请求过长\n");
        shm_disconnect();
        return 1;
    }

    /* 写入输入区（偏移 4096） */
    memcpy(shm_base + IN_OFF, request, req_len);
    wr32(shm_base + 12, req_len);   /* in_len */
    wr32(shm_base + 16, 0);          /* out_len */
    __sync_synchronize();
    uint32_t state = rd32(shm_base + 8);
    wr32(shm_base + 8, state | STATE_IN_READY);
    printf("  [发送] %s (%d bytes)\n", request, req_len);

    /* 等待宿主回复 */
    printf("  等待宿主安卓启动 APK...\n");
    wait_count = 0;
    while (!(rd32(shm_base + 8) & STATE_OUT_READY)) {
        usleep(100000);
        if (++wait_count > 100) {
            fprintf(stderr, "  [超时] 宿主未在 10 秒内响应\n");
            shm_disconnect();
            return 1;
        }
    }

    /* 读取输出区（偏移 69632） */
    uint32_t out_len = rd32(shm_base + 16);
    if (out_len > 0 && out_len < OUT_CAP) {
        char response[1024];
        int copy_len = out_len < sizeof(response) - 1 ? out_len : sizeof(response) - 1;
        memcpy(response, shm_base + OUT_OFF, copy_len);
        response[copy_len] = '\0';
        printf("  [回复] %s\n", response);

        if (strncmp(response, "[APK_RESULT]success", 20) == 0) {
            printf("\n=== APK 启动成功 ===\n");
            printf("  包名: %s\n", package);
            printf("  状态: 已通过宿主安卓 Intent 启动\n");
        } else if (strncmp(response, "[APK_RESULT]failed:", 20) == 0) {
            fprintf(stderr, "\n=== APK 启动失败 ===\n");
            fprintf(stderr, "  原因: %s\n", response + 20);
            shm_disconnect();
            return 1;
        }
    }

    /* 清除 OUT_READY */
    state = rd32(shm_base + 8);
    wr32(shm_base + 8, state & ~STATE_OUT_READY);
    __sync_synchronize();

    shm_disconnect();
    return 0;
}
