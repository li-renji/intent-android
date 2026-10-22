package com.qidian.minios

import android.util.Log
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * 局域网 HTTP API 服务（App 内置原生实现）。
 *
 * 为什么不用容器里的 microsrv：
 *   旧实现把 microsrv.qds 跑在 proot 容器内。proot 用 ptrace 拦截子进程的**每一个**
 *   syscall，且 proot 本身是 App 的子进程。一旦 App 被系统冻结、或 proot 的事件循环
 *   卡住，microsrv 的 poll()/accept() 就再也不会返回——端口依然 LISTEN（那是内核行为），
 *   但连接建立后永远收不到响应。这就是"端口通、请求超时"的根因。
 *
 * 现在：
 *   - ServerSocket 直接跑在 App 进程的独立线程里，syscall 直通内核，不经过 ptrace；
 *   - /chat 直接调用 AiService.inferSync()，不再依赖 WebView 轮询 /tmp 文件；
 *   - AI 是否就绪由 /health 明确告知，不会把"容器未启动"这种字符串当成回答。
 *
 * 端口：
 *   9999 —— HTTP API（0.0.0.0，局域网可访问）
 *   8822 —— 一行纯文本状态（127.0.0.1，兼容旧版脚本）
 */
class LocalHttpServer(
    private val httpPort: Int = 9999,
    private val statusPort: Int = 8822,
    private val aiProvider: () -> AiService?,
    private val modelName: String = "qwen2.5-1.5b-mnn",
    /** App filesDir：API key 持久化目录（首次启动自动生成，之后固定不变）。 */
    private val keyDir: File? = null
) {
    companion object {
        private const val TAG = "LocalHttp"
        private const val MAX_REQ_BYTES = 256 * 1024      // 单请求上限 256KB
        private const val SOCKET_TIMEOUT_MS = 10_000
        private const val MAX_BODY_LOG = 120
    }

    /** MNN 引擎不是线程安全的，所有推理串行化。 */
    private val inferLock = Any()

    /** 进程内缓存的 API key。 */
    @Volatile private var cachedKey: String? = null

    private val startedAt = System.currentTimeMillis()
    private val chatCount = AtomicLong(0)
    private val errorCount = AtomicLong(0)

    @Volatile private var running = false
    @Volatile private var httpSocket: ServerSocket? = null
    @Volatile private var statusSocket: ServerSocket? = null

    /** 已实际监听的端口；-1 表示起不来。 */
    @Volatile var boundHttpPort: Int = -1
        private set
    @Volatile var boundStatusPort: Int = -1
        private set

    private val acceptPool = Executors.newFixedThreadPool(4) { r ->
        Thread(r, "http-accept").apply { isDaemon = true }
    }
    private val workerPool = Executors.newFixedThreadPool(6) { r ->
        Thread(r, "http-worker").apply { isDaemon = true }
    }

    // ---------------------------------------------------------------- 生命周期

    /** 启动服务；返回 HTTP 端口是否成功监听。 */
    fun start(): Boolean {
        if (running) return boundHttpPort > 0
        running = true

        // 先清掉可能残留的容器版 microsrv，否则 9999/8822 被它占着，我们绑不上，
        // 而它可能正处于 proot 卡死状态（端口通、不响应）。
        killStaleMicrosrv()

        httpSocket = bindWithRetry(httpPort, any = true)
        statusSocket = bindWithRetry(statusPort, any = false)

        boundHttpPort = httpSocket?.localPort ?: -1
        boundStatusPort = statusSocket?.localPort ?: -1

        httpSocket?.let { s -> acceptPool.execute { acceptLoop(s, isStatus = false) } }
        statusSocket?.let { s -> acceptPool.execute { acceptLoop(s, isStatus = true) } }

        if (boundHttpPort > 0) {
            Log.i(TAG, "HTTP API 已启动: 0.0.0.0:$boundHttpPort (状态端口 $boundStatusPort)")
        } else {
            Log.e(TAG, "HTTP API 启动失败：$httpPort 与 $statusPort 均不可用")
        }
        return boundHttpPort > 0
    }

    fun stop() {
        running = false
        try { httpSocket?.close() } catch (_: Throwable) {}
        try { statusSocket?.close() } catch (_: Throwable) {}
        acceptPool.shutdownNow()
        workerPool.shutdownNow()
    }

    fun isListening(): Boolean = running && boundHttpPort > 0

    /** 局域网可访问地址，如 192.168.3.4:9999 */
    fun lanAddress(): String = "${localIp()}:$boundHttpPort"

    /** 服务运行秒数（供 JS 桥读取，WebView 里 fetch 本机 /health 不一定可行） */
    fun uptimeSec(): Long = uptimeSecInternal()

    /** 已服务对话次数 */
    fun chatCount(): Long = chatCount.get()

    // ---------------------------------------------------------------- API key

    /**
     * 获取 API key：首次调用自动生成（qd- + 24位十六进制），写入 keyDir/api_key.txt，
     * 之后一直用这一个。Agent 侧配置一次即可，重启/重装（保留数据）都不变。
     */
    fun apiKey(): String {
        cachedKey?.let { return it }
        synchronized(this) {
            cachedKey?.let { return it }
            val generated = "qd-" + java.util.UUID.randomUUID().toString().replace("-", "").take(24)
            val key = try {
                val dir = keyDir
                if (dir != null) {
                    val f = File(dir, "api_key.txt")
                    if (f.isFile) {
                        val saved = f.readText().trim()
                        if (saved.length >= 16) saved else {
                            f.writeText(generated); generated
                        }
                    } else {
                        f.writeText(generated); generated
                    }
                } else generated
            } catch (_: Throwable) {
                generated
            }
            cachedKey = key
            return key
        }
    }

    /** 校验请求头中的 key：支持 Authorization: Bearer <key> 与 X-API-Key: <key>。 */
    private fun checkAuth(headers: Map<String, String>): Boolean {
        val expected = apiKey()
        val auth = headers["authorization"] ?: ""
        if (auth.length > 7 && auth.startsWith("Bearer ", ignoreCase = true) &&
            auth.substring(7).trim() == expected) return true
        val xKey = headers["x-api-key"]?.trim() ?: ""
        return xKey == expected
    }

    /** 结束时间戳（毫秒），用于 /health 的 uptime。 */
    private fun uptimeSecInternal(): Long = (System.currentTimeMillis() - startedAt) / 1000

    // ---------------------------------------------------------------- socket

    private fun bindWithRetry(port: Int, any: Boolean): ServerSocket? {
        repeat(3) { round ->
            try {
                val s = ServerSocket()
                s.reuseAddress = true
                s.bind(
                    InetSocketAddress(
                        if (any) InetAddress.getByName("0.0.0.0") else InetAddress.getByName("127.0.0.1"),
                        port
                    ),
                    32
                )
                return s
            } catch (t: Throwable) {
                Log.w(TAG, "绑定端口 $port 失败（第 ${round + 1} 次）：${t.message}")
                if (round < 2) {
                    killStaleMicrosrv()
                    try { Thread.sleep(220) } catch (_: InterruptedException) {}
                }
            }
        }
        return null
    }

    /**
     * 杀掉同 uid 下残留的 microsrv.qds 进程。
     * 同 uid 进程之间允许 sendSignal，读 /proc/<pid>/cmdline 也不需要特殊权限。
     */
    private fun killStaleMicrosrv() {
        val myPid = android.os.Process.myPid()
        try {
            File("/proc").listFiles()?.forEach { dir ->
                val pid = dir.name.toIntOrNull() ?: return@forEach
                if (pid == myPid) return@forEach
                try {
                    val raw = File(dir, "cmdline").readText()
                    val cmd = raw.replace('\u0000', ' ').trim()
                    if (cmd.isEmpty()) return@forEach
                    if (cmd.contains("microsrv.qds")) {
                        Log.i(TAG, "清理残留 microsrv: pid=$pid")
                        android.os.Process.sendSignal(pid, 9)
                    }
                } catch (_: Throwable) {}
            }
        } catch (t: Throwable) {
            Log.w(TAG, "扫描 /proc 失败：${t.message}")
        }
    }

    private fun acceptLoop(server: ServerSocket, isStatus: Boolean) {
        while (running) {
            val client = try {
                server.accept()
            } catch (e: SocketException) {
                break                       // server 已关闭
            } catch (t: Throwable) {
                Log.w(TAG, "accept 异常：${t.message}")
                continue
            }
            workerPool.execute {
                try {
                    handle(client, isStatus)
                } catch (t: Throwable) {
                    errorCount.incrementAndGet()
                    Log.w(TAG, "处理请求异常：${t.message}")
                } finally {
                    try { client.close() } catch (_: Throwable) {}
                }
            }
        }
    }

    // ---------------------------------------------------------------- 请求处理

    private fun handle(client: Socket, isStatus: Boolean) {
        client.soTimeout = SOCKET_TIMEOUT_MS
        client.tcpNoDelay = true
        val input = BufferedInputStream(client.getInputStream())
        val out = client.getOutputStream()

        val head = readHead(input) ?: return
        val lines = head.split("\r\n")
        if (lines.isEmpty() || lines[0].isBlank()) return

        val parts = lines[0].split(" ")
        if (parts.size < 2) {
            writeText(out, 400, "Bad Request", "bad request line")
            return
        }
        val method = parts[0].uppercase()
        val path = parts[1].substringBefore('?')
        val query = parts[1].substringAfter('?', "")

        val headers = HashMap<String, String>()
        for (i in 1 until lines.size) {
            val idx = lines[i].indexOf(':')
            if (idx > 0) headers[lines[i].substring(0, idx).trim().lowercase()] =
                lines[i].substring(idx + 1).trim()
        }

        // 8822：一行纯文本状态，兼容旧版上位机脚本
        if (isStatus) {
            val s = if (aiProvider() != null) "READY" else "LOADING"
            writeText(out, 200, "OK", "$s up=${uptimeSec()}s chats=${chatCount.get()}\n", "text/plain")
            return
        }

        if (method == "OPTIONS") {
            writeEmpty(out, 204)
            return
        }

        val body = readBody(input, headers)

        // ---- 鉴权：需要 key 的端点（/health、/、8822 保持开放，方便看状态）----
        val protected = path == "/chat" || path == "/api/chat" ||
            path == "/v1/chat/completions" || path == "/v1/models"
        if (protected && !checkAuth(headers)) {
            writeJson(
                out, 401,
                """{"ok":false,"error":"invalid_api_key","hint":"请求头需带 Authorization: Bearer <key> 或 X-API-Key: <key>。key 在 App「关于」页查看。"}"""
            )
            return
        }

        when {
            path == "/health" && (method == "GET" || method == "HEAD") -> writeJson(out, 200, healthJson())
            path == "/" && method == "GET" -> writeHtml(out, 200, indexHtml())
            path == "/v1/models" && method == "GET" -> writeJson(out, 200, modelsJson())
            path == "/v1/chat/completions" -> {
                if (method != "POST") {
                    writeJson(out, 405, """{"error":{"message":"use POST","type":"invalid_request_error"}}""")
                } else {
                    handleOpenAiChat(out, body)
                }
            }
            path == "/chat" || path == "/api/chat" -> {
                if (method != "POST") {
                    writeJson(
                        out, 405,
                        """{"ok":false,"error":"method_not_allowed","hint":"请用 POST /chat，body 为 {\"prompt\":\"你好\"}"}"""
                    )
                } else {
                    handleChat(out, body, query)
                }
            }
            path == "/status" -> writeJson(out, 200, healthJson())
            else -> writeJson(
                out, 404,
                """{"ok":false,"error":"not_found","hint":"可用端点：GET /health，GET /，POST /chat，POST /v1/chat/completions（OpenAI 兼容）"}"""
            )
        }
    }

    private fun handleChat(out: OutputStream, body: String, query: String) {
        val t0 = System.currentTimeMillis()

        // 兼容三种入参：JSON {"prompt":...} / JSON {"message":...} / 纯文本
        var prompt = ""
        val trimmed = body.trim()
        if (trimmed.startsWith("{")) {
            try {
                val jo = JSONObject(trimmed)
                prompt = jo.optString("prompt", "").ifBlank { jo.optString("message", "") }
                    .ifBlank { jo.optString("content", "") }
            } catch (t: Throwable) {
                writeJson(out, 400, """{"ok":false,"error":"bad_json","hint":"body 需要是 {\"prompt\":\"...\"}"}""")
                return
            }
        } else {
            prompt = trimmed
        }
        if (prompt.isBlank()) {
            // 也支持 ?prompt=xxx
            prompt = query.split("&").firstOrNull { it.startsWith("prompt=") }
                ?.substringAfter("prompt=")?.let { urlDecode(it) } ?: ""
        }
        if (prompt.isBlank()) {
            writeJson(out, 400, """{"ok":false,"error":"empty_prompt","hint":"请提供 prompt 字段"}""")
            return
        }

        val ai = aiProvider()
        if (ai == null) {
            // 明确告诉调用方"模型还在加载"，并给出可重试时间——不再伪装成回答
            writeJson(
                out, 503,
                """{"ok":false,"error":"model_loading","retry_after":5,"hint":"本地模型正在加载（首次约 2~3 秒），请 5 秒后重试 GET /health"}"""
            )
            return
        }

        val reply: String = try {
            synchronized(inferLock) { ai.inferSync(prompt) ?: "" }
        } catch (t: Throwable) {
            errorCount.incrementAndGet()
            writeJson(out, 500, """{"ok":false,"error":"infer_failed","detail":"${escape(t.message ?: "unknown")}"}""")
            return
        }

        chatCount.incrementAndGet()
        val ms = System.currentTimeMillis() - t0
        Log.i(TAG, "chat 完成 ${ms}ms, prompt=${prompt.take(MAX_BODY_LOG)}")

        writeJson(
            out, 200,
            """{"ok":true,"reply":${JSONObject.quote(reply)},"model":"$modelName","ms":$ms,"chars":${reply.length}}"""
        )
    }

    // ---------------------------------------------------------------- OpenAI 兼容

    /** GET /v1/models：列出本机模型，让 Agent 端能拉模型列表。 */
    private fun modelsJson(): String {
        val created = startedAt / 1000
        return """{"object":"list","data":[{"id":"$modelName","object":"model","created":$created,"owned_by":"qidian-minios"}]}"""
    }

    /**
     * POST /v1/chat/completions：OpenAI 兼容对话接口。
     * 支持 stream:true（SSE，一次性整段输出）与 stream:false。
     * 多轮 messages 拼接为带角色标记的单 prompt（本地小模型无多轮模板）。
     */
    private fun handleOpenAiChat(out: OutputStream, body: String) {
        val t0 = System.currentTimeMillis()

        var stream = false
        val messages = ArrayList<Pair<String, String>>()
        try {
            val jo = JSONObject(body.trim())
            stream = jo.optBoolean("stream", false)
            val arr = jo.optJSONArray("messages")
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val m = arr.optJSONObject(i) ?: continue
                    messages.add(Pair(m.optString("role", "user"), m.optString("content", "")))
                }
            }
        } catch (t: Throwable) {
            writeJson(out, 400, """{"error":{"message":"body must be JSON with messages array","type":"invalid_request_error"}}""")
            return
        }
        if (messages.isEmpty()) {
            writeJson(out, 400, """{"error":{"message":"messages is required","type":"invalid_request_error"}}""")
            return
        }

        val promptSb = StringBuilder()
        for ((role, content) in messages) {
            when (role) {
                "system" -> promptSb.append("[系统] ").append(content).append('\n')
                "assistant" -> promptSb.append("[助手] ").append(content).append('\n')
                else -> promptSb.append(content).append('\n')
            }
        }
        val prompt = promptSb.toString().trim()
        if (prompt.isBlank()) {
            writeJson(out, 400, """{"error":{"message":"messages content is empty","type":"invalid_request_error"}}""")
            return
        }

        val ai = aiProvider()
        if (ai == null) {
            writeJson(out, 503, """{"error":{"message":"model is loading, retry in a few seconds","type":"server_error","code":"model_loading"}}""")
            return
        }

        val reply: String = try {
            synchronized(inferLock) { ai.inferSync(prompt) ?: "" }
        } catch (t: Throwable) {
            errorCount.incrementAndGet()
            writeJson(out, 500, """{"error":{"message":"${escape(t.message ?: "infer_failed")}","type":"server_error"}}""")
            return
        }

        chatCount.incrementAndGet()
        val ms = System.currentTimeMillis() - t0
        Log.i(TAG, "openai chat 完成 ${ms}ms, prompt=${prompt.take(MAX_BODY_LOG)}")

        val id = "chatcmpl-" + java.util.UUID.randomUUID().toString().replace("-", "").take(20)
        val created = System.currentTimeMillis() / 1000

        if (!stream) {
            writeJson(
                out, 200,
                """{"id":"$id","object":"chat.completion","created":$created,"model":"$modelName","choices":[{"index":0,"message":{"role":"assistant","content":${JSONObject.quote(reply)}},"finish_reason":"stop"}],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}"""
            )
            return
        }

        // SSE 流式：role 块 → 内容块 → 结束块 → [DONE]
        val sb = StringBuilder()
        sb.append("HTTP/1.1 200 OK\r\n")
        sb.append("Content-Type: text/event-stream; charset=utf-8\r\n")
        sb.append("Cache-Control: no-cache\r\n")
        sb.append("Connection: close\r\n")
        sb.append("Access-Control-Allow-Origin: *\r\n\r\n")

        fun chunk(delta: String, finish: String?) {
            val finishJson = if (finish == null) "null" else "\"$finish\""
            sb.append("data: {\"id\":\"$id\",\"object\":\"chat.completion.chunk\",\"created\":$created,\"model\":\"$modelName\",\"choices\":[{\"index\":0,\"delta\":$delta,\"finish_reason\":$finishJson}]}\n\n")
        }
        chunk("""{"role":"assistant","content":""}""", null)
        chunk("""{"content":${JSONObject.quote(reply)}}""", null)
        chunk("{}", "stop")
        sb.append("data: [DONE]\n\n")

        out.write(sb.toString().toByteArray(Charsets.UTF_8))
        out.flush()
    }

    // ---------------------------------------------------------------- HTTP 解析

    /** 读到 \r\n\r\n 为止，返回头部文本（不含结尾空行）。 */
    private fun readHead(input: InputStream): String? {
        val buf = java.io.ByteArrayOutputStream(512)
        var state = 0                      // 0 无、1 有 CR、2 有 CRLF、3 有 CRLFCR
        val limit = 16 * 1024
        while (buf.size() < limit) {
            val b = input.read()
            if (b < 0) return null
            buf.write(b)
            state = when (state) {
                0 -> if (b == 13) 1 else 0
                1 -> if (b == 10) 2 else if (b == 13) 1 else 0
                2 -> if (b == 13) 3 else 0
                3 -> if (b == 10) 4 else 0
                else -> 0
            }
            if (state == 4) {
                val s = buf.toString("UTF-8")
                return s.substring(0, s.length - 4)
            }
        }
        return null
    }

    private fun readBody(input: InputStream, headers: Map<String, String>): String {
        val len = headers["content-length"]?.trim()?.toIntOrNull() ?: 0
        if (len <= 0) return ""
        val size = len.coerceAtMost(MAX_REQ_BYTES)
        val data = ByteArray(size)
        var read = 0
        while (read < size) {
            val n = input.read(data, read, size - read)
            if (n < 0) break
            read += n
        }
        return String(data, 0, read, Charsets.UTF_8)
    }

    // ---------------------------------------------------------------- 响应

    private fun writeJson(out: OutputStream, code: Int, json: String) =
        write(out, code, "application/json; charset=utf-8", json)

    private fun writeText(out: OutputStream, code: Int, status: String, text: String, type: String = "text/plain; charset=utf-8") {
        val body = text.toByteArray(Charsets.UTF_8)
        val head = buildString {
            append("HTTP/1.1 $code $status\r\n")
            append("Content-Type: $type\r\n")
            append("Content-Length: ${body.size}\r\n")
            append("Connection: close\r\n")
            append("Access-Control-Allow-Origin: *\r\n")
            append("Access-Control-Allow-Headers: Content-Type, Authorization, X-API-Key\r\n")
            append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n")
            append("\r\n")
        }
        out.write(head.toByteArray(Charsets.UTF_8))
        out.write(body)
        out.flush()
    }

    private fun write(out: OutputStream, code: Int, type: String, body: String) {
        val bytes = body.toByteArray(Charsets.UTF_8)
        val reason = when (code) {
            200 -> "OK"; 204 -> "No Content"; 400 -> "Bad Request"; 404 -> "Not Found"
            405 -> "Method Not Allowed"; 500 -> "Internal Server Error"; 503 -> "Service Unavailable"
            else -> "OK"
        }
        val head = buildString {
            append("HTTP/1.1 $code $reason\r\n")
            append("Content-Type: $type\r\n")
            append("Content-Length: ${bytes.size}\r\n")
            append("Connection: close\r\n")
            append("Access-Control-Allow-Origin: *\r\n")
            append("Access-Control-Allow-Headers: Content-Type, Authorization, X-API-Key\r\n")
            append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n")
            append("\r\n")
        }
        out.write(head.toByteArray(Charsets.UTF_8))
        out.write(bytes)
        out.flush()
    }

    private fun writeHtml(out: OutputStream, code: Int, html: String) =
        write(out, code, "text/html; charset=utf-8", html)

    private fun writeEmpty(out: OutputStream, code: Int) {
        val head = "HTTP/1.1 $code No Content\r\n" +
            "Content-Length: 0\r\n" +
            "Connection: close\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Access-Control-Allow-Headers: Content-Type\r\n" +
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\r\n"
        out.write(head.toByteArray(Charsets.UTF_8))
        out.flush()
    }

    // ---------------------------------------------------------------- 内容

    private fun healthJson(): String {
        val ai = aiProvider()
        val ip = localIp()
        return """{"ok":true,"service":"qidian-minios","version":"3.0","ai":${ai != null},"model":"$modelName","uptime":${uptimeSec()},"chats":${chatCount.get()},"errors":${errorCount.get()},"http_port":$boundHttpPort,"status_port":$boundStatusPort,"lan":"$ip:$boundHttpPort"}"""
    }

    private fun localIp(): String = try {
        java.net.NetworkInterface.getNetworkInterfaces().toList()
            .asSequence()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList().asSequence() }
            .firstOrNull { it is java.net.Inet4Address && !it.isLoopbackAddress }
            ?.hostAddress ?: "127.0.0.1"
    } catch (_: Throwable) {
        "127.0.0.1"
    }

    private fun escape(s: String): String =
        s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").replace("\r", " ")

    private fun urlDecode(s: String): String = try {
        java.net.URLDecoder.decode(s, "UTF-8")
    } catch (_: Throwable) {
        s
    }

    private fun indexHtml(): String = """
<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>起点OS mini · 本地 AI API</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:720px;margin:0 auto;padding:24px;background:#0b0b0d;color:#e8e8ea;line-height:1.65}
h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;color:#9aa0a6;font-weight:600;margin:24px 0 8px;letter-spacing:.04em}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
pre{background:#17171a;border:1px solid #26262b;border-radius:8px;padding:12px;overflow-x:auto;font-size:12.5px;color:#c9d1d9}
code{background:#232327;padding:1px 5px;border-radius:4px;font-size:12.5px;color:#8fd6ff}
.pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;background:#1d3a24;color:#7ee2a8;border:1px solid #2c5a38}
a{color:#7ab7ff}
</style></head><body>
<h1>起点OS mini · 本地 AI API</h1>
<div class="pill">运行中 · 模型 $modelName</div>
<h2>端点</h2>
<pre>GET  /health                  服务与模型状态（无需 key）
GET  /v1/models               模型列表（OpenAI 兼容，需 key）
POST /v1/chat/completions     对话（OpenAI 兼容，需 key，支持 stream）
POST /chat                    对话（简单格式，需 key）
8822                          一行文本状态</pre>
<h2>给 Agent / 客户端配置</h2>
<pre>Base URL: http://${localIp()}:$boundHttpPort/v1
API Key:  在 App「关于」页查看（首次启动自动生成）</pre>
<h2>调用示例</h2>
<pre>curl http://${localIp()}:$boundHttpPort/health

curl -X POST http://${localIp()}:$boundHttpPort/v1/chat/completions \\
  -H 'Authorization: Bearer &lt;你的key&gt;' \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"$modelName","messages":[{"role":"user","content":"你好"}]}'</pre>
<p style="color:#8b9096;font-size:12.5px">App 退到后台不影响服务；进程被杀后重新打开 App 即自动恢复。</p>
</body></html>
""".trimIndent()
}
