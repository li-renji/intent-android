package com.qidian.minios

/**
 * libproot.so 的 JNI 绑定——唯一的职责是把参数交给 proot 的 [proot_main]。
 *
 * libproot.so 由 `scripts/build_proot_android.sh` 构建：
 *   proot-termux 源码（补丁把 `main` 改名为 `proot_main`）+ talloc + 本 JNI 包装。
 * 构建产物放在 `app/src/main/jniLibs/arm64-v8a/libproot.so`。
 */
object NativeProot {

    init {
        // JNI 加载 proot 库
        System.loadLibrary("proot")
    }

    /**
     * 在 fork 出的子进程中运行 proot，父进程等待其退出后返回退出码。
     *
     * 为什么必须 fork：proot 的 main 无论成败都会调用 `exit()` 结束进程，
     * 如果直接在 Java 线程里调用，会连 APP 一起退出。fork 子进程后，
     * `exit()` 只结束子进程，APP 进程不受影响。
     *
     * @param argv      proot 命令行参数，例如：
     *                  ["proot","-r","<rootfs>","-0","--link2symlink",
     *                   "-b","/proc","-b","/dev","-b","/sys","-w","/",
     *                   "/bin/sh","-c","<命令>"]
     * @param tmpDir    容器临时目录（作为 $TMPDIR 注入 proot）
     * @param loader    64 位 loader 的绝对路径（由 assets/libproot_loader.so 拷贝而来）
     * @param loader32  32 位 loader 的绝对路径；不需要 32 位支持时传空字符串
     * @param logFile   proot 与容器内进程 stdout/stderr 的重定向文件
     * @return          proot 退出码；fork/wait 失败返回 -1
     */
    external fun runProot(
        argv: Array<String>,
        tmpDir: String,
        loader: String,
        loader32: String,
        logFile: String
    ): Int
}
