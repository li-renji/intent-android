/*
 * proot_jni.c —— libproot.so 的 JNI 入口（安卓 NDK proot 调用核心代码）。
 *
 * 职责：
 *   1. 把 Java 传入的 String[] 转成 C 的 argv；
 *   2. fork 一个子进程，在子进程里设置容器环境变量并调用 proot 的
 *      proot_main()；父进程 waitpid 等待并返回退出码。
 *
 * 为什么必须 fork：
 *   proot 的 main() 无论成功失败都会调用 exit() 结束进程（见
 *   src/cli/cli.c），如果直接在 Java 线程里调用会把整个 APP 进程带走。
 *   fork 之后 exit() 只结束子进程；子进程是容器进程的父进程，
 *   ptrace 追踪容器进程完全合法（同 UID、自己的后代）。
 *
 * 构建：由 scripts/build_proot_android.sh 与 proot 源码一起链接成
 *   libproot.so（proot 的 main 已由补丁改名为 proot_main）。
 */

#include <jni.h>
#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/wait.h>

/* proot 源码入口：由 patch/proot-main-as-library.patch 把 main 改名而来 */
extern int proot_main(int argc, char *const argv[]);

JNIEXPORT jint JNICALL
Java_com_qidian_minios_NativeProot_runProot(JNIEnv *env, jobject thiz,
                                            jobjectArray argvArray,
                                            jstring tmpDir,
                                            jstring loader,
                                            jstring loader32,
                                            jstring logFile)
{
    jsize argc;
    char **argv;
    const char *c_tmp = NULL;
    const char *c_loader = NULL;
    const char *c_loader32 = NULL;
    const char *c_log = NULL;
    pid_t pid;
    int status = 0;
    jsize i;

    /* ---------- 1. 把 Java 参数数组转成 argv ---------- */
    argc = (*env)->GetArrayLength(env, argvArray);
    argv = (char **)calloc((size_t)argc + 1, sizeof(char *));
    if (argv == NULL)
        return -1;

    for (i = 0; i < argc; i++) {
        jstring js = (jstring)(*env)->GetObjectArrayElement(env, argvArray, i);
        const char *utf = (js != NULL) ? (*env)->GetStringUTFChars(env, js, NULL) : NULL;
        argv[i] = strdup(utf != NULL ? utf : "");
        if (js != NULL) {
            (*env)->ReleaseStringUTFChars(env, js, utf);
            (*env)->DeleteLocalRef(env, js);
        }
        if (argv[i] == NULL) {
            jsize k;
            for (k = 0; k < i; k++)
                free(argv[k]);
            free(argv);
            return -1;
        }
    }
    argv[argc] = NULL;

    c_tmp     = (*env)->GetStringUTFChars(env, tmpDir, NULL);
    c_loader  = (*env)->GetStringUTFChars(env, loader, NULL);
    c_loader32= (*env)->GetStringUTFChars(env, loader32, NULL);
    c_log     = (*env)->GetStringUTFChars(env, logFile, NULL);

    /* ---------- 2. fork：子进程运行 proot，父进程等待 ---------- */
    pid = fork();
    if (pid == 0) {
        /* ===== 子进程（= proot 进程）===== */
        if (c_tmp != NULL && c_tmp[0] != '\0')
            setenv("TMPDIR", c_tmp, 1);
        /* loader 路径：proot 运行时用环境变量覆盖编译期默认值 */
        if (c_loader != NULL && c_loader[0] != '\0')
            setenv("PROOT_LOADER", c_loader, 1);
        if (c_loader32 != NULL && c_loader32[0] != '\0')
            setenv("PROOT_LOADER_32", c_loader32, 1);

        /* 把 proot 及容器内进程的 stdout/stderr 重定向到日志文件，
         * 便于宿主机读取诊断信息 */
        if (c_log != NULL && c_log[0] != '\0') {
            int fd = open(c_log, O_WRONLY | O_CREAT | O_TRUNC, 0600);
            if (fd >= 0) {
                dup2(fd, STDOUT_FILENO);
                dup2(fd, STDERR_FILENO);
                if (fd > STDERR_FILENO)
                    close(fd);
            }
        }

        /* 进入 proot 主循环：创建隔离环境并运行容器内命令。
         * 注意：proot_main 内部会 exit()，因此这里不会返回。 */
        int ret = proot_main((int)argc, argv);
        _exit(ret);
    }

    /* ===== 父进程（APP 进程）===== */
    if (pid < 0) {
        /* fork 失败 */
        status = -1;
        goto cleanup;
    }

    while (waitpid(pid, &status, 0) < 0) {
        if (errno != EINTR) {
            status = -1;
            goto cleanup;
        }
    }
    status = WIFEXITED(status) ? WEXITSTATUS(status) : -1;

cleanup:
    if (c_tmp)      (*env)->ReleaseStringUTFChars(env, tmpDir, c_tmp);
    if (c_loader)   (*env)->ReleaseStringUTFChars(env, loader, c_loader);
    if (c_loader32) (*env)->ReleaseStringUTFChars(env, loader32, c_loader32);
    if (c_log)      (*env)->ReleaseStringUTFChars(env, logFile, c_log);
    for (i = 0; i < argc; i++)
        free(argv[i]);
    free(argv);
    return (jint)status;
}
