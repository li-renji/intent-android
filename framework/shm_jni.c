/*
 * shm_jni.c —— 奇点 OS 框架 · 内存通道 · 宿主机原生侧
 *
 * 职责：
 *   1. init():  创建/打开共享通道文件并 mmap，初始化通道头（magic/version）
 *   2. process(): AI 处理循环 —— 轮询"容器→AI"输入，执行 AI（当前为占位处理：
 *      输入转大写 + 加前缀，用于验证通道双向闭环；后续在此处挂接真正的
 *      llama/MNN 本地推理），把结果写入"AI→容器"输出区
 *
 * 与容器内 shm_client.c 共享同一份内存布局（宏定义保持一致）。
 */

#include <jni.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>

#define SHM_MAGIC   0x514D5348u   /* "QMSH" */
#define SHM_VERSION 1u
#define SHM_DEFAULT_SIZE (256 * 1024)
#define SHM_IN_OFF  4096
#define SHM_IN_CAP  (64 * 1024)
#define SHM_OUT_OFF (SHM_IN_OFF + SHM_IN_CAP)
#define SHM_OUT_CAP (64 * 1024)

#define STATE_IN_READY  0x1u
#define STATE_OUT_READY 0x2u

struct shm_header {
    unsigned int magic;
    unsigned int version;
    unsigned int state;
    unsigned int in_len;
    unsigned int out_len;
    unsigned int reserved[3];
};

static void *map_shm(const char *path, int create, unsigned int size) {
    int fd;
    if (create) {
        fd = open(path, O_RDWR | O_CREAT | O_TRUNC, 0600);
        if (fd < 0) return NULL;
        if (ftruncate(fd, size) != 0) { close(fd); return NULL; }
    } else {
        fd = open(path, O_RDWR);
        if (fd < 0) return NULL;
    }
    void *base = mmap(NULL, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    return (base == MAP_FAILED) ? NULL : base;
}

/*
 * init(path, size): 创建并初始化共享通道。
 * 返回 1 成功，0 失败。
 */
JNIEXPORT jboolean JNICALL
Java_com_qidian_minios_MainActivity_shmInit(JNIEnv *env, jobject thiz, jstring path, jint size) {
    const char *p = (*env)->GetStringUTFChars(env, path, NULL);
    unsigned int sz = (size > 0) ? (unsigned int)size : SHM_DEFAULT_SIZE;
    if (sz < 128 * 1024) sz = SHM_DEFAULT_SIZE;

    unsigned char *base = (unsigned char *)map_shm(p, 1, sz);
    (*env)->ReleaseStringUTFChars(env, path, p);
    if (!base) return JNI_FALSE;

    struct shm_header *h = (struct shm_header *)base;
    memset(base, 0, sz);
    h->magic = SHM_MAGIC;
    h->version = SHM_VERSION;
    h->state = 0;
    h->in_len = 0;
    h->out_len = 0;
    munmap(base, sz);
    return JNI_TRUE;
}

/*
 * 占位 AI：真实推理接入点。
 * 当前实现：输入整体转大写，前缀 "[AI]" —— 用于验证通道双向与调用链，
 * 后续替换为 llama/MNN 原生推理。
 */
static int ai_process(const unsigned char *in, unsigned int in_len,
                      unsigned char *out, unsigned int cap) {
    unsigned int n = in_len;
    if (n > cap - 32) n = cap - 32;
    static const char prefix[] = "[AI] ";
    unsigned int i, o = 0;
    for (i = 0; i < sizeof(prefix) - 1 && o < cap; i++) out[o++] = (unsigned char)prefix[i];
    for (i = 0; i < n && o < cap; i++) {
        unsigned char c = in[i];
        if (c >= 'a' && c <= 'z') c -= 32;   /* 转大写 */
        out[o++] = c;
    }
    return (int)o;
}

/*
 * process(path, timeoutMs): AI 处理循环。
 * 轮询"容器→AI"输入；收到后执行 AI，写回"AI→容器"输出区。
 * 返回 1 已处理一次输入，0 超时。
 */
JNIEXPORT jboolean JNICALL
Java_com_qidian_minios_MainActivity_shmProcess(JNIEnv *env, jobject thiz,
                                         jstring path, jlong timeoutMs) {
    const char *p = (*env)->GetStringUTFChars(env, path, NULL);
    unsigned char *base = (unsigned char *)map_shm(p, 0, SHM_DEFAULT_SIZE);
    (*env)->ReleaseStringUTFChars(env, path, p);
    if (!base) return JNI_FALSE;

    struct shm_header *h = (struct shm_header *)base;
    long loops = (long)(timeoutMs / 10);
    if (loops < 1) loops = 1;

    for (long i = 0; i < loops; i++) {
        unsigned int state = __atomic_load_n(&h->state, __ATOMIC_ACQUIRE);
        if (state & STATE_IN_READY) {
            unsigned int in_len = h->in_len;
            if (in_len > SHM_IN_CAP) in_len = SHM_IN_CAP;

            /* AI 处理（占位） */
            unsigned int out_len = ai_process(base + SHM_IN_OFF, in_len,
                                              base + SHM_OUT_OFF, SHM_OUT_CAP);
            __atomic_store_n(&h->out_len, out_len, __ATOMIC_RELEASE);
            /* 清输入标志、置输出标志 */
            unsigned int ns = (state & ~STATE_IN_READY) | STATE_OUT_READY;
            __atomic_store_n(&h->state, ns, __ATOMIC_RELEASE);
            munmap(base, SHM_DEFAULT_SIZE);
            return JNI_TRUE;
        }
        usleep(10000);
    }
    munmap(base, SHM_DEFAULT_SIZE);
    return JNI_FALSE;
}
