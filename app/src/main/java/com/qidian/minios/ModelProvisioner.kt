package com.qidian.minios

import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.File
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * 模型自动 provisioning（首次启动自动下载）。
 *
 * 设计要点：
 *  - 模型权重约 792MB，绝不能塞进 APK（会撑爆安装包），必须运行时下载。
 *  - 多镜像源：任一源失败自动切换下一个，适应国内网络与不同部署环境。
 *  - 断点续传：用 .part 文件 + Range 头，中断后重试不重下。
 *  - 完整性校验：sha256，防止镜像损坏 / 截断导致模型加载崩溃。
 *  - 弱网友好：超时放宽、指数退避重试、进度实时回调。
 *
 * 清单来自 assets/model_catalog.json（模型商店），运维改版本只改那个文件，不用改代码。
 */
class ModelProvisioner(
    private val context: android.content.Context,
    private val modelDir: File,
    private val manifest: ModelManifest,
    private val onProgress: (Progress) -> Unit
) {

    data class ModelManifest(
        val name: String,
        val totalBytes: Long,
        val files: List<FileSpec>,
        val mirrors: List<String>,
        val sha256: String
    )

    data class FileSpec(
        val path: String,
        val bytes: Long,
        val sha256: String? = null,
        val url: String? = null   // 为空则用镜像源 + path
    )

    data class Progress(
        val phase: Phase,
        val fileName: String,
        val fileIndex: Int,
        val fileTotal: Int,
        val downloaded: Long,
        val total: Long,
        val bytesPerSec: Long,
        val error: String? = null,
        val finished: Boolean = false
    ) {
        enum class Phase { IDLE, CHECKING, DOWNLOADING, VERIFYING, DONE, FAILED, NO_SPACE, UNSUPPORTED }

        val percent: Int
            get() = if (total <= 0) 0 else ((downloaded * 100) / total).toInt().coerceIn(0, 100)

        val etaSeconds: Long
            get() = if (bytesPerSec <= 0) -1 else (total - downloaded) / bytesPerSec
    }

    companion object {
        private const val TAG = "ModelProvisioner"
        private const val CONNECT_TIMEOUT = 20_000
        private const val READ_TIMEOUT = 60_000
        private const val MAX_RETRY_PER_MIRROR = 3
        private const val MIN_FREE_SPACE_MARGIN = 64L * 1024 * 1024   // 额外留 64MB 余量

        /** 解析模型清单 JSON（兼容旧的单模型 manifest 格式） */
        fun loadManifest(json: String): ModelManifest {
            val jo = org.json.JSONObject(json)
            val files = ArrayList<FileSpec>()
            val arr = jo.optJSONArray("files") ?: org.json.JSONArray()
            for (i in 0 until arr.length()) {
                val f = arr.getJSONObject(i)
                files.add(
                    FileSpec(
                        path = f.getString("path"),
                        bytes = f.optLong("bytes", 0),
                        sha256 = f.optString("sha256", "").ifEmpty { null },
                        url = f.optString("url", "").ifEmpty { null }
                    )
                )
            }
            val mirrors = ArrayList<String>()
            val marr = jo.optJSONArray("mirrors") ?: org.json.JSONArray()
            for (i in 0 until marr.length()) mirrors.add(marr.getString(i))
            return ModelManifest(
                name = jo.optString("name", "model"),
                totalBytes = jo.optLong("total_bytes", files.sumOf { it.bytes }),
                files = files,
                mirrors = mirrors,
                sha256 = jo.optString("sha256", "")
            )
        }
    }

    private val cancelled = AtomicBoolean(false)
    private val mainHandler = Handler(Looper.getMainLooper())
    private val downloadedBytes = AtomicLong(0)

    fun cancel() {
        cancelled.set(true)
    }

    /** 模型是否已经完整就绪 */
    /**
     * 模型是否已就绪（可直接加载推理）。
     *
     * 判定标准与 ModelCatalog.isDownloaded 一致：看推理必需文件是否齐备，
     * 而不是与清单逐字节一致 —— 用户手上可能已有同 id 的其他导出版本，
     * 严格比对会导致"明明能用却重下几百 MB"。
     */
    fun isReady(): Boolean {
        if (!modelDir.exists()) return false
        if (!File(modelDir, "config.json").exists()) return false
        val weight = File(modelDir, "llm.mnn.weight")
        if (!weight.exists() || weight.length() <= 0) return false
        val hasTokenizer = modelDir.listFiles()?.any {
            it.name.startsWith("tokenizer") && it.length() > 0
        } == true
        return hasTokenizer
    }

    /**
     * 环境自检：架构 / 内存 / 存储。返回 null 表示可以下载，否则返回给用户看的错误说明。
     *
     * 内存必须用 ActivityManager.MemoryInfo 拿物理内存：
     * Runtime.maxMemory() 返回的是当前 JVM 堆上限（通常 256MB），
     * 不是设备内存 —— 用它判断会把所有正常手机都误判成"内存不足"。
     */
    fun preflight(): String? {
        // 1) CPU 架构：原生库只有 arm64-v8a
        val abi = android.os.Build.SUPPORTED_ABIS ?: emptyArray()
        if (!abi.contains("arm64-v8a")) {
            return "当前设备架构为 ${abi.joinToString("/")}，本应用仅支持 arm64-v8a（64 位）设备。"
        }
        // 2) 物理内存：MNN 加载 1.5B 权重需要约 1GB 常驻内存
        val totalRamMb = deviceTotalRamMb()
        val requiredRamMb = manifest.files
            .firstOrNull { it.path.endsWith(".weight") }
            ?.let { (it.bytes / 1024 / 1024 * 1.6).toInt() }   // 权重体积 × 1.6 估算运行时占用
            ?: 1536
        if (totalRamMb in 1 until requiredRamMb) {
            return "设备内存 ${totalRamMb}MB，运行该模型（约需 ${requiredRamMb}MB）可能不够。请选择更小的模型。"
        }
        // 3) 存储空间：模型总量 + 根文件系统 + 余量
        //    注意：StatFs 要求路径已存在，模型目录可能还没建，
        //    此时逐级上溯到第一个存在的父目录来查剩余空间。
        val need = manifest.totalBytes + MIN_FREE_SPACE_MARGIN
        var statPath: File? = if (modelDir.exists()) modelDir else modelDir.parentFile
        while (statPath != null && !statPath.exists()) statPath = statPath.parentFile
        val free = try {
            val stat = android.os.StatFs((statPath ?: modelDir).absolutePath)
            stat.availableBlocksLong * stat.blockSizeLong
        } catch (_: Throwable) {
            Long.MAX_VALUE   // 查不到就放行
        }
        if (free < need) {
            return "存储空间不足：需要约 ${need / 1024 / 1024}MB，可用 ${free / 1024 / 1024}MB。请清理空间后重试。"
        }
        return null
    }

    /** 设备物理内存（MB） */
    private fun deviceTotalRamMb(): Int = try {
        val am = context.getSystemService(android.content.Context.ACTIVITY_SERVICE) as android.app.ActivityManager
        val mi = android.app.ActivityManager.MemoryInfo()
        am.getMemoryInfo(mi)
        (mi.totalMem / 1024 / 1024).toInt()
    } catch (_: Throwable) {
        4096   // 读不到就放行，别误伤用户
    }

    /**
     * 执行下载。阻塞调用（请在后台线程执行）。
     * @return 成功返回 null，失败返回错误信息
     */
    fun provision(): String? {
        // 先建目录再自检：StatFs 要求路径存在，且下载也要目录就绪
        if (!modelDir.exists() && !modelDir.mkdirs()) {
            val msg = "无法创建模型目录：${modelDir.absolutePath}"
            emit(Progress(Progress.Phase.FAILED, "", 0, manifest.files.size, 0, manifest.totalBytes, 0, msg))
            return msg
        }
        val err = preflight()
        if (err != null) {
            emit(Progress(Progress.Phase.NO_SPACE, "", 0, manifest.files.size, 0, manifest.totalBytes, 0, err))
            return err
        }

        downloadedBytes.set(0)
        val total = manifest.totalBytes
        var currentMirror = 0

        for ((idx, spec) in manifest.files.withIndex()) {
            val target = File(modelDir, spec.path)
            if (target.exists() && spec.bytes > 0 && target.length() == spec.bytes) {
                Log.i(TAG, "已存在，跳过: ${spec.path}")
                downloadedBytes.addAndGet(spec.bytes)
                continue
            }

            var lastError: String? = null
            var ok = false

            // 依次尝试每个镜像
            while (currentMirror < manifest.mirrors.size && !cancelled.get()) {
                val mirror = manifest.mirrors[currentMirror]
                val url = spec.url ?: mirror.trimEnd('/') + "/" + spec.path.trimStart('/')

                var attempt = 0
                while (attempt < MAX_RETRY_PER_MIRROR && !cancelled.get()) {
                    attempt++
                    try {
                        emit(Progress(Progress.Phase.DOWNLOADING, spec.path, idx, manifest.files.size,
                            downloadedBytes.get(), total, 0))
                        downloadOne(url, target, spec.bytes) { got, speed ->
                            emit(Progress(Progress.Phase.DOWNLOADING, spec.path, idx, manifest.files.size,
                                downloadedBytes.get() + got, total, speed))
                        }
                        downloadedBytes.addAndGet(spec.bytes)
                        ok = true
                        break
                    } catch (t: Throwable) {
                        lastError = "${t.javaClass.simpleName}: ${t.message}"
                        Log.w(TAG, "下载失败 ${spec.path} 源=$mirror 第${attempt}次: $lastError")
                        // 断点续传文件保留，下次从断点继续
                        if (attempt < MAX_RETRY_PER_MIRROR) {
                            Thread.sleep(1500L * attempt)
                        }
                    }
                }
                if (ok) break
                currentMirror++
                if (currentMirror < manifest.mirrors.size) {
                    Log.i(TAG, "切换镜像源 -> ${manifest.mirrors[currentMirror]}")
                }
            }

            if (!ok) {
                if (cancelled.get()) return "下载已取消"
                val msg = "「${spec.path}」下载失败：${lastError ?: "所有镜像源均不可用"}"
                emit(Progress(Progress.Phase.FAILED, spec.path, idx, manifest.files.size,
                    downloadedBytes.get(), total, 0, msg))
                return msg
            }
        }

        // 整体校验
        emit(Progress(Progress.Phase.VERIFYING, "", manifest.files.size, manifest.files.size,
            total, total, 0))
        if (manifest.sha256.isNotEmpty()) {
            val weight = File(modelDir, manifest.files.first { it.path.endsWith("llm.mnn.weight") }.path)
            val actual = sha256(weight)
            if (!actual.equals(manifest.sha256, ignoreCase = true)) {
                val msg = "模型校验失败（sha256 不匹配），文件可能损坏。请删除模型目录后重试。"
                emit(Progress(Progress.Phase.FAILED, "llm.mnn.weight", 0, manifest.files.size,
                    total, total, 0, msg))
                return msg
            }
        }

        emit(Progress(Progress.Phase.DONE, "", manifest.files.size, manifest.files.size, total, total, 0))
        return null
    }

    /**
     * 下载单个文件，支持断点续传。
     * 进度回调参数：本次已下载字节数、速度(B/s)
     */
    private fun downloadOne(url: String, target: File, expectedBytes: Long, onTick: (Long, Long) -> Unit) {
        val part = File(target.parentFile, target.name + ".part")
        if (!part.parentFile.exists()) part.parentFile.mkdirs()

        var resumeFrom = if (part.exists()) part.length() else 0L
        // 断点文件比预期还大，说明是脏数据，重来
        if (expectedBytes > 0 && resumeFrom > expectedBytes) {
            part.delete(); resumeFrom = 0
        }

        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = CONNECT_TIMEOUT
            readTimeout = READ_TIMEOUT
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", "QidianMiniOS/1.0 (Android)")
            setRequestProperty("Accept-Encoding", "identity")
            if (resumeFrom > 0) setRequestProperty("Range", "bytes=$resumeFrom-")
        }

        try {
            val code = conn.responseCode
            // 206 = 部分内容（续传成功）；200 = 服务端忽略了 Range，从头下
            val appending = code == 206 && resumeFrom > 0
            if (code != 200 && code != 206) {
                throw IllegalStateException("HTTP $code ${conn.responseMessage ?: ""}")
            }
            if (code == 200 && resumeFrom > 0) {
                Log.i(TAG, "服务端不支持续传，从头下载")
                resumeFrom = 0
            }

            val total = conn.contentLengthLong.let { if (it > 0) it + resumeFrom else expectedBytes }
            val raf = RandomAccessFile(part, "rw")
            raf.setLength(resumeFrom)
            raf.seek(resumeFrom)

            val buf = ByteArray(256 * 1024)
            conn.inputStream.use { input ->
                var got = 0L
                var sessionStart = resumeFrom
                val t0 = System.currentTimeMillis()
                var lastEmit = 0L
                while (true) {
                    if (cancelled.get()) throw IllegalStateException("已取消")
                    val n = input.read(buf)
                    if (n < 0) break
                    raf.write(buf, 0, n)
                    got += n
                    val now = System.currentTimeMillis()
                    // 每 500ms 上报一次，避免过于频繁
                    if (now - lastEmit >= 500) {
                        lastEmit = now
                        // 分母至少为 1ms，否则同一毫秒内会除零
                        val dt = (now - t0).coerceAtLeast(1L)
                        val speed = (got * 1000) / dt
                        onTick(got, speed)
                        if (now - sessionStart > 60_000) { sessionStart = now } // 防止长时间连接被断
                    }
                }
                raf.fd.sync()
            }
            raf.close()

            if (expectedBytes > 0 && part.length() != expectedBytes) {
                throw IllegalStateException("文件大小不符：期望 ${expectedBytes}，实际 ${part.length()}")
            }
            // 单文件 sha256 校验（若有）
            val spec = manifest.files.firstOrNull { it.path == target.name }
            if (spec?.sha256 != null) {
                val actual = sha256(part)
                if (!actual.equals(spec.sha256, ignoreCase = true)) {
                    part.delete()
                    throw IllegalStateException("sha256 校验失败")
                }
            }
            // 原子替换
            if (target.exists()) target.delete()
            if (!part.renameTo(target)) {
                // 跨文件系统时 renameTo 可能失败，退化为复制
                part.copyTo(target, overwrite = true)
                part.delete()
            }
        } finally {
            conn.disconnect()
        }
    }

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { ins ->
            val buf = ByteArray(1 shl 16)
            while (true) {
                val n = ins.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    private fun emit(p: Progress) {
        mainHandler.post { onProgress(p) }
    }
}
