package com.qidian.minios

import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.util.zip.GZIPInputStream

/**
 * 极简 tar.gz 解压器（ustar + PAX 扩展头 + GNU 长名），只用于把
 * assets/rootfs.tar.gz 展开到 APP 私有目录。不引入任何第三方库。
 *
 * 支持的类型：
 *  - '0'/'\0' 普通文件
 *  - '5' 目录
 *  - '2' 符号链接
 *  - '1' 硬链接
 *  - 'x' PAX 扩展头（path / linkpath / size）
 *  - 'g' PAX 全局头（忽略）
 *  - 'L'/'K' GNU 长名 / 长链接名
 */
object TarExtractor {

    private const val BLOCK = 512

    private class Header(
        val name: String,
        val mode: Int,
        val size: Long,
        val type: Char,
        val linkName: String,
    )

    fun extractTarGz(tarGz: File, dest: File) {
        val input = BufferedInputStream(GZIPInputStream(FileInputStream(tarGz)), 1 shl 16)
        try {
            extractTar(input, dest)
        } finally {
            input.close()
        }
    }

    fun extractTar(input: InputStream, dest: File) {
        if (!dest.exists() && !dest.mkdirs()) {
            throw IOException("无法创建目录: $dest")
        }
        var paxPath: String? = null
        var paxLink: String? = null
        var paxSize: Long? = null
        var gnuName: String? = null
        var gnuLink: String? = null

        // 局部函数：PAX/GNU 覆盖字段只对紧随其后的一个条目生效
        fun clearOverrides() {
            paxPath = null
            paxLink = null
            paxSize = null
            gnuName = null
            gnuLink = null
        }

        while (true) {
            val header = readHeader(input) ?: break
            when (header.type) {
                'x' -> { // PAX 扩展头：读取内容并解析 key=value
                    val data = readBytes(input, header.size)
                    skipPadding(input, header.size)
                    val fields = parsePax(data)
                    paxPath = fields["path"] ?: paxPath
                    paxLink = fields["linkpath"] ?: paxLink
                    paxSize = fields["size"]?.toLongOrNull() ?: paxSize
                }
                'g' -> { // PAX 全局头：忽略
                    skipBytes(input, header.size)
                    skipPadding(input, header.size)
                }
                'L' -> { // GNU 长文件名
                    gnuName = String(readBytes(input, header.size), Charsets.UTF_8).trimEnd('\u0000')
                    skipPadding(input, header.size)
                }
                'K' -> { // GNU 长链接名
                    gnuLink = String(readBytes(input, header.size), Charsets.UTF_8).trimEnd('\u0000')
                    skipPadding(input, header.size)
                }
                '0', '\u0000' -> { // 普通文件
                    val name = gnuName ?: paxPath ?: header.name
                    val size = paxSize ?: header.size
                    val target = File(dest, name)
                    target.parentFile?.mkdirs()
                    FileOutputStream(target).use { out -> copyBytes(input, out, size) }
                    skipPadding(input, size)
                    applyMode(target, header.mode, isDir = false)
                    clearOverrides()
                }
                '5' -> { // 目录
                    val target = File(dest, gnuName ?: paxPath ?: header.name)
                    target.mkdirs()
                    applyMode(target, header.mode, isDir = true)
                    clearOverrides()
                }
                '2' -> { // 符号链接
                    val name = gnuName ?: paxPath ?: header.name
                    val link = gnuLink ?: paxLink ?: header.linkName
                    val target = File(dest, name)
                    target.parentFile?.mkdirs()
                    target.delete()
                    try {
                        java.nio.file.Files.createSymbolicLink(target.toPath(), java.nio.file.Paths.get(link))
                    } catch (e: Exception) {
                        // 个别设备/文件系统限制符号链接：记录但不中断解压
                        System.err.println("TarExtractor: 创建符号链接失败 $name -> $link : $e")
                    }
                    clearOverrides()
                }
                '1' -> { // 硬链接
                    val name = gnuName ?: paxPath ?: header.name
                    val link = gnuLink ?: paxLink ?: header.linkName
                    val target = File(dest, name)
                    target.parentFile?.mkdirs()
                    val source = File(dest, link)
                    if (!target.exists() && source.exists()) {
                        try {
                            java.nio.file.Files.createLink(target.toPath(), source.toPath())
                        } catch (e: Exception) {
                            // 不支持硬链接时退化为复制
                            source.copyTo(target, overwrite = true)
                        }
                    }
                    clearOverrides()
                }
                else -> { // 其他类型（fifo/设备等）：跳过内容
                    skipBytes(input, header.size)
                    skipPadding(input, header.size)
                    clearOverrides()
                }
            }
        }
    }

    /** 读取一个 512 字节的 ustar 头；读到文件结束（或全零块）返回 null。 */
    private fun readHeader(input: InputStream): Header? {
        val buf = ByteArray(BLOCK)
        var off = 0
        while (off < BLOCK) {
            val n = input.read(buf, off, BLOCK - off)
            if (n < 0) {
                if (off == 0) return null
                throw IOException("tar 数据意外截断")
            }
            off += n
        }
        if (buf.all { it == 0.toByte() }) return null // 两个全零块 = 归档结束
        val name = String(buf, 0, 100, Charsets.UTF_8).trimEnd('\u0000', ' ')
        if (name.isEmpty()) return null
        val mode = octal(buf, 100, 8).toInt()
        val size = octal(buf, 124, 12)
        val type = buf[156].toInt().toChar()
        val linkName = String(buf, 157, 100, Charsets.UTF_8).trimEnd('\u0000', ' ')
        return Header(name, mode, size, type, linkName)
    }

    /** 解析 PAX 扩展头：形如 "len key=value\n" 的连续记录。 */
    private fun parsePax(data: ByteArray): Map<String, String> {
        val map = HashMap<String, String>()
        val text = String(data, Charsets.UTF_8)
        var i = 0
        while (i < text.length) {
            val sp = text.indexOf(' ', i)
            if (sp < 0) break
            val len = text.substring(i, sp).toIntOrNull() ?: break
            if (len <= 0 || i + len > text.length) break
            val record = text.substring(sp + 1, i + len)
            val eq = record.indexOf('=')
            if (eq > 0) {
                map[record.substring(0, eq)] = record.substring(eq + 1)
            }
            i += len
            while (i < text.length && (text[i] == '\n' || text[i] == '\r')) i++
        }
        return map
    }

    /** 读取八进制字段；若最高位为 1 表示 base-256（本场景不会出现，直接按 0 处理）。 */
    private fun octal(buf: ByteArray, offset: Int, length: Int): Long {
        var v = 0L
        for (i in offset until offset + length) {
            val c = buf[i].toInt()
            if (c == 0) break
            if (c == ' '.toInt()) continue
            if (c < '0'.toInt() || c > '7'.toInt()) break
            v = v * 8 + (c - '0'.toInt())
        }
        return v
    }

    private fun readBytes(input: InputStream, n: Long): ByteArray {
        val data = ByteArray(n.toInt())
        var off = 0
        while (off < n) {
            val r = input.read(data, off, (n - off).toInt())
            if (r < 0) throw IOException("tar 数据意外截断")
            off += r
        }
        return data
    }

    private fun copyBytes(input: InputStream, out: FileOutputStream, n: Long) {
        val buf = ByteArray(65536)
        var rem = n
        while (rem > 0) {
            val r = input.read(buf, 0, minOf(rem, buf.size.toLong()).toInt())
            if (r < 0) throw IOException("tar 数据意外截断")
            out.write(buf, 0, r)
            rem -= r
        }
    }

    private fun skipBytes(input: InputStream, n: Long) {
        val buf = ByteArray(8192)
        var rem = n
        while (rem > 0) {
            val r = input.read(buf, 0, minOf(rem, buf.size.toLong()).toInt())
            if (r < 0) throw IOException("tar 数据意外截断")
            rem -= r
        }
    }

    private fun skipPadding(input: InputStream, size: Long) {
        val pad = (BLOCK - (size % BLOCK).toInt()) % BLOCK
        if (pad > 0) skipBytes(input, pad.toLong())
    }

    private fun applyMode(file: File, mode: Int, isDir: Boolean) {
        file.setReadable(true, false)
        file.setWritable(true, false)
        // 目录必须可执行才能遍历；文件按属主执行位
        file.setExecutable(isDir || (mode and 0x40) != 0, false)
    }
}
