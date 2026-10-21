package com.qidian.minios

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel

/**
 * 奇点 OS 框架 · 内存通道 · 宿主机侧（主框架 ↔ AI 副框架 的桥）。
 *
 * 与容器内 shm_client.c 共享同一份内存布局（见 framework/shm_client.c 顶部宏）：
 *   偏移 0      : header（magic/version/state/in_len/out_len）
 *   偏移 4096   : 输入区（容器 → AI，64KB）
 *   偏移 69632  : 输出区（AI → 容器，64KB）
 *   state: bit0 = IN_READY（容器已写入输入）, bit1 = OUT_READY（AI 已写回）
 *
 * 实现：宿主进程 open 通道文件并 mmap（Java NIO FileChannel.map），
 * 容器内程序 open 同一文件并 mmap —— 双方映射同一物理内存页，即共享内存。
 * 轮询语义 + 页缓存顺序保证数据一致；字节序固定小端（aarch64 与 C 一致）。
 */
class ShmChannel(private val file: File) {

    companion object {
        const val SIZE = 256 * 1024
        private const val MAGIC = 0x514D5348u          // "QMSH"
        private const val VERSION = 1u
        private const val IN_OFF = 4096
        private const val IN_CAP = 64 * 1024
        private const val OUT_OFF = IN_OFF + IN_CAP
        private const val OUT_CAP = 64 * 1024
        private const val STATE_IN_READY = 1
        private const val STATE_OUT_READY = 2
        private const val HEADER_SIZE = 32
        private const val POLL_INTERVAL_MS = 10L
    }

    /** 推理引擎接口：输入字节 → 输出字节。由原生 AI 服务实现。 */
    fun interface Inferencer {
        fun infer(input: ByteArray): ByteArray
    }

    private var inferencer: Inferencer? = null

    /** 注入真实推理引擎（如 LlamaEngine 封装）。不注入则用占位实现。 */
    fun setInferencer(inf: Inferencer?) { inferencer = inf }

    private lateinit var raf: RandomAccessFile
    private lateinit var chan: FileChannel
    private lateinit var buf: MappedByteBuffer

    /** 打开（必要时创建）并初始化通道。返回是否成功。 */
    fun open(): Boolean {
        return try {
            file.parentFile?.mkdirs()
            raf = RandomAccessFile(file, "rw")
            chan = raf.channel
            buf = chan.map(FileChannel.MapMode.READ_WRITE, 0, SIZE.toLong())
            buf.order(ByteOrder.LITTLE_ENDIAN)
            // 清空并写头部
            for (i in 0 until SIZE / 4) buf.putInt(i * 4, 0)
            buf.putInt(0, MAGIC.toInt())
            buf.putInt(4, VERSION.toInt())
            buf.putInt(8, 0) // state
            true
        } catch (t: Throwable) {
            t.printStackTrace()
            false
        }
    }

    fun close() {
        try { chan.close() } catch (_: Throwable) {}
        try { raf.close() } catch (_: Throwable) {}
    }

    /**
     * AI 处理循环（副框架占位）：轮询"容器→AI"输入；
     * 收到后执行 AI 处理（当前为占位：转大写 + 前缀，验证通道），写回"AI→容器"输出。
     * 返回是否处理过一次输入。
     */
    fun process(timeoutMs: Long): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val state = buf.getInt(8)
            if ((state and STATE_IN_READY) != 0) {
                val inLen = buf.getInt(12).coerceAtMost(IN_CAP)
                // 读输入（容器 → AI）
                val input = ByteArray(inLen)
                for (i in 0 until inLen) input[i] = buf.get(IN_OFF + i)

                // === AI 处理（调用注入的推理引擎）===
                val output = inferencer?.infer(input) ?: aiProcess(input)

                // 写回输出（AI → 容器）
                val outLen = output.size.coerceAtMost(OUT_CAP)
                for (i in 0 until outLen) buf.put(OUT_OFF + i, output[i])
                buf.putInt(12, inLen)   // 输入长度不变（调试用）
                buf.putInt(16, outLen)
                buf.putInt(8, (state and STATE_IN_READY.inv()) or STATE_OUT_READY)
                return true
            }
            Thread.sleep(POLL_INTERVAL_MS)
        }
        return false
    }

    /** 占位 AI：输入转大写 + 前缀 "[AI] "。 */
    private fun aiProcess(input: ByteArray): ByteArray {
        val prefix = "[AI] ".toByteArray(Charsets.UTF_8)
        val out = ByteArray(prefix.size + input.size)
        prefix.copyInto(out, 0)
        for (i in input.indices) {
            val c = input[i].toInt()
            out[prefix.size + i] = if (c in 'a'.code..'z'.code) (c - 32).toByte() else input[i]
        }
        return out
    }
}
