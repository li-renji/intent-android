package com.qidian.minios

import android.content.Context
import android.content.Intent
import android.util.Log
import java.io.File

/**
 * 奇点OS 副框架 · 原生 AI 服务（MNN 引擎版）。
 *
 * 使用 MNN-LLM 推理引擎，支持 CPU / OpenCL / Hexagon NPU 后端。
 * AI 完全在原生侧跑，容器内只通过 shm 发请求。
 *
 * 同时处理容器发来的系统命令（如 [APK_LAUNCH] 启动 APK）。
 */
class AiService(
    private val context: Context,
    private val modelDir: File,
    private val shmFile: File,
    private val maxTokens: Int = 256
) {
    companion object {
        private const val TAG = "AiService"
    }

    private var mnnEngine: MnnEngine? = null
    private var channel: ShmChannel? = null
    private var diagFile: java.io.File? = null
    @Volatile private var running = false

    private fun diagLog(msg: String) {
        try { diagFile?.appendText(msg + "\n") } catch (_: Throwable) {}
        Log.i(TAG, msg)
    }

    /** 加载 MNN 模型。返回是否成功。 */
    fun start(diag: java.io.File? = null): Boolean {
        diagFile = diag
        fun log(msg: String) = diagLog(msg)
        val configFile = File(modelDir, "config.json")
        if (!configFile.exists()) { log("config.json 不存在: ${configFile.absolutePath}"); return false }

        log("启动 MNN 推理: dir=${modelDir.name}")
        val t0 = System.currentTimeMillis()
        return try {
            mnnEngine = MnnEngine()
            val ok = mnnEngine!!.load(configFile.absolutePath)
            val dt = System.currentTimeMillis() - t0
            if (!ok) {
                log("MNN 模型加载失败 (${dt}ms)")
                return false
            }
            log("MNN 模型加载成功 (${dt}ms)")

            channel = ShmChannel(shmFile).also { it.open() }
            channel?.setInferencer { input -> doInfer(input) }
            running = true
            Thread({ loop() }, "native-ai").start()
            true
        } catch (t: Throwable) {
            log("MNN 启动失败: $t")
            t.printStackTrace()
            false
        }
    }

    fun stop() {
        running = false
        channel?.close()
        try { mnnEngine?.close() } catch (_: Throwable) {}
    }

    /** 公开的同步推理方法（供 JS 接口直接调用）。 */
    fun inferSync(prompt: String): String? {
        return try {
            val result = mnnEngine?.infer(prompt, maxTokens)
            result
        } catch (t: Throwable) {
            diagLog("同步推理异常: $t")
            null
        }
    }

    private fun loop() {
        Log.i(TAG, "原生 AI 服务(MNN)已启动，监听共享内存: ${shmFile.absolutePath}")
        while (running) {
            try {
                channel?.process(1000L)
            } catch (t: Throwable) {
                Log.e(TAG, "AI 循环异常", t)
            }
        }
    }

    /** 通过 MNN 推理：输入字节 → prompt → 输出字节。 */
    private fun doInfer(input: ByteArray): ByteArray {
        val prompt = String(input, Charsets.UTF_8)

        /* 处理系统命令：[APK_LAUNCH]<包名> */
        if (prompt.startsWith("[APK_LAUNCH]")) {
            val packageName = prompt.removePrefix("[APK_LAUNCH]").trim()
            diagLog("收到 APK 启动请求: $packageName")
            return try {
                val intent = context.packageManager.getLaunchIntentForPackage(packageName)
                if (intent != null) {
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(intent)
                    diagLog("APK 启动成功: $packageName")
                    "[APK_RESULT]success".toByteArray(Charsets.UTF_8)
                } else {
                    diagLog("APK 未安装或无启动 Activity: $packageName")
                    "[APK_RESULT]failed:应用未安装或无启动界面".toByteArray(Charsets.UTF_8)
                }
            } catch (t: Throwable) {
                diagLog("APK 启动异常: $t")
                "[APK_RESULT]failed:${t.message}".toByteArray(Charsets.UTF_8)
            }
        }

        diagLog("收到推理请求 (${input.size}B): ${prompt.take(80)}")
        val t0 = System.currentTimeMillis()
        return try {
            val result = mnnEngine?.infer(prompt, maxTokens) ?: ""
            val dt = System.currentTimeMillis() - t0
            val tokens = result.length / 4  /* 估算 token 数（1 token ≈ 4 chars） */
            val speed = if (dt > 0) "%.1f".format(tokens * 1000.0 / dt) else "?"
            diagLog("推理完成: ${dt}ms, 输出${result.length}B, 约${tokens} tokens, ${speed} tok/s")
            "[AI(原生 MNN)] $result".toByteArray(Charsets.UTF_8)
        } catch (t: Throwable) {
            diagLog("推理异常: $t")
            "[AI 推理异常: ${t.message}]".toByteArray(Charsets.UTF_8)
        }
    }
}
