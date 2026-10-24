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
    /** App filesDir：API key 持久化目录（首次启动自动生成，之后固定不变）。 */
    keyDir: File? = null,
    /**
     * Application 上下文。
     * 模型商店相关端点不能依赖 Activity —— 手机锁屏时 Activity 会被销毁，
     * 若走 Activity.instance 拿 catalog，锁屏期间这些端点会全部 503。
     */
    appContext: android.content.Context? = null
) {
    private val keyDir: File? = keyDir

    /** Application 上下文（供模型商店使用，不随 Activity 销毁失效） */
    private val appContext: android.content.Context? = appContext

    /** 模型商店（进程级，不随 Activity 生命周期变化） */
    private val catalog: ModelCatalog?
        get() = appContext?.let { MainActivity.modelCatalogOf(it) }
            ?: MainActivity.instance?.modelCatalog()

    /** 当前激活的模型名（可在运行时切换，故为动态 getter） */
    private val modelName: String
        get() = try {
            val c = catalog
            val id = c?.activeModelId() ?: "qwen2.5-1.5b-mnn"
            c?.find(id)?.name ?: id
        } catch (_: Throwable) {
            "qwen2.5-1.5b-mnn"
        }
    companion object {
        private const val TAG = "LocalHttp"
        private const val MAX_REQ_BYTES = 256 * 1024      // 单请求上限 256KB
        private const val SOCKET_TIMEOUT_MS = 10_000
        private const val MAX_BODY_LOG = 120

        // 各段消息进入 prompt 的字符配额（合计 < AiService.MAX_PROMPT_CHARS=1800）。
        // MNN 在 prompt 超过模型 max_seq_len 时会原生越界崩溃（SIGSEGV，App 直接闪退），
        // 且 prefill 耗时与长度线性相关（约 4.4ms/字符），所以必须按优先级裁剪：
        // 系统规则开头 > 用户最后一句 > 最近助手回复 > 更早的历史。
        private const val MAX_SYSTEM_CHARS = 500
        private const val MAX_HISTORY_CHARS = 250
        private const val MAX_LAST_USER_CHARS = 800
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
            path == "/v1/chat/completions" || path == "/v1/models" ||
            path == "/agent/run" ||
            // 模型安装/激活/删除有副作用（占空间、切引擎），必须鉴权
            path == "/model/install" || path == "/model/activate" || path == "/model/delete" ||
            // 联网搜索/fetch 会对外发请求，有 SSRF 风险，也须鉴权
            path == "/websearch" || path == "/fetch" || path == "/net"
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
            path == "/agent/run" -> {
                if (method != "POST") {
                    writeJson(out, 405, """{"error":{"message":"use POST","type":"invalid_request_error"}}""")
                } else {
                    handleAgentRun(out, body)
                }
            }
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
            path == "/model/status" -> writeJson(out, 200, modelProvisionJson())
            path == "/model/list" -> writeJson(out, 200, modelCatalogJson())
            path == "/model/install" -> {
                if (method != "POST") writeJson(out, 405, """{"ok":false,"error":"method_not_allowed"}""")
                else handleModelInstall(out, body)
            }
            path == "/model/activate" -> {
                if (method != "POST") writeJson(out, 405, """{"ok":false,"error":"method_not_allowed"}""")
                else handleModelActivate(out, body)
            }
            path == "/model/delete" -> {
                if (method != "POST") writeJson(out, 405, """{"ok":false,"error":"method_not_allowed"}""")
                else handleModelDelete(out, body)
            }
            path == "/net" -> writeJson(out, 200, netStatusJson())
            path == "/websearch" -> handleWebSearch(out, query)
            path == "/fetch" -> handleFetchPage(out, query)
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
        var toolsArr: org.json.JSONArray? = null
        try {
            val jo = JSONObject(body.trim())
            stream = jo.optBoolean("stream", false)
            toolsArr = jo.optJSONArray("tools")
            val arr = jo.optJSONArray("messages")
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val m = arr.optJSONObject(i) ?: continue
                    val role = m.optString("role", "user")
                    val content = m.optString("content", "")
                    messages.add(Pair(role, content))
                    // 上一轮 assistant 的 tool_calls：还原成 DSL，模型才能接着往下想
                    val tcs = m.optJSONArray("tool_calls")
                    if (tcs != null && tcs.length() > 0) {
                        val fn = tcs.optJSONObject(0)?.optJSONObject("function")
                        val fname = fn?.optString("name").orEmpty()
                        val fargs = fn?.optString("arguments").orEmpty()
                        val argText = try {
                            val ao = JSONObject(fargs)
                            val keys = ao.keys()
                            if (keys.hasNext()) "${keys.next()}=${ao.optString(keys.next())}" else ""
                        } catch (e: Throwable) { "" }
                        messages.add(Pair("assistant_tool", "【工具】$fname|$argText"))
                    }
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
        // 按消息粒度裁剪：本地小模型上下文有限，且 MNN 在 prompt 超长时会原生崩溃。
        // 策略：system 保留开头（规则），最后一条 user 保留结尾（当前问题），
        // 中间历史只留少量，避免把预算浪费在冗长系统提示词上。
        val toolMode = toolsArr != null && toolsArr!!.length() > 0
        val systemMsg = messages.firstOrNull { it.first == "system" }
        val userMsgs = messages.filter { it.first == "user" }
        val lastUser = userMsgs.lastOrNull()
        val history = messages.filter { it.first == "assistant" || it.first == "assistant_tool" }.takeLast(3)

        if (toolMode) {
            // 工具模式：用项目原有的 INTENT DSL（小模型对「一行 DSL」远比对 JSON function calling 友好）
            promptSb.append(toolModeSystemPrompt(toolsArr!!)).append('\n')
        } else {
            systemMsg?.let { (role, content) ->
                val head = content.take(MAX_SYSTEM_CHARS)
                promptSb.append("[系统] ").append(head)
                if (content.length > MAX_SYSTEM_CHARS) promptSb.append("…（已精简）")
                promptSb.append('\n')
            }
        }
        history.forEach { (role, content) ->
            if (role == "assistant_tool") promptSb.append(content).append('\n')
            else promptSb.append("[助手] ").append(content.take(MAX_HISTORY_CHARS)).append('\n')
        }
        // 上一步工具的执行结果
        messages.filter { it.first == "tool" }.takeLast(2).forEach { (_, content) ->
            promptSb.append("[观察] ").append(content.take(MAX_HISTORY_CHARS)).append('\n')
        }
        userMsgs.dropLast(1).takeLast(1).forEach { (_, content) ->
            promptSb.append("[用户] ").append(content.take(MAX_HISTORY_CHARS)).append('\n')
        }
        lastUser?.let { (_, content) ->
            promptSb.append(content.take(MAX_LAST_USER_CHARS))
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

        if (toolMode) {
            // 工具模式：模型若给出【工具】xxx|yyy，就翻译成标准 OpenAI tool_calls，
            // 由调用方（WorkBuddy / 奇点Agent）执行工具并回传结果，形成闭环。
            val call = IntentAgent.parseToolCall(reply)
            if (call != null) {
                val parts = call.split("|")
                val fname = parts[0].trim()
                val farg = parts.drop(1).joinToString("|").trim()
                val paramName = firstParamName(toolsArr!!, fname)
                val argsJson = JSONObject().put(paramName, farg).toString()
                val callId = "call_" + java.util.UUID.randomUUID().toString().replace("-", "").take(16)
                Log.i(TAG, "tool_call: $fname($paramName=$farg)")
                writeJson(
                    out, 200,
                    """{"id":"$id","object":"chat.completion","created":$created,"model":"$modelName","choices":[{"index":0,"message":{"role":"assistant","content":null,"tool_calls":[{"id":"$callId","type":"function","function":{"name":${JSONObject.quote(fname)},"arguments":${JSONObject.quote(argsJson)}}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}"""
                )
                return
            }
            val answer = IntentAgent.parseAnswer(reply)
            writeJson(
                out, 200,
                """{"id":"$id","object":"chat.completion","created":$created,"model":"$modelName","choices":[{"index":0,"message":{"role":"assistant","content":${JSONObject.quote(answer)}},"finish_reason":"stop"}],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}"""
            )
            return
        }

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

    /** 模型 provisioning 状态（供外部部署/监控查询首次下载进度） */
    private fun modelProvisionJson(): String {
        fun esc(s: String?) = s?.replace("\\", "\\\\")?.replace("\"", "\\\"")?.replace("\n", " ") ?: ""
        val st = MainActivity.modelDownloadState
        val total = MainActivity.modelDownloadTotalBytes
        val got = MainActivity.modelDownloadedBytes
        val pct = if (total > 0) (got * 100 / total).toInt() else 0
        return """{"ok":true,"state":"$st","percent":$pct,"downloaded":$got,"total":$total,"speed":${MainActivity.modelDownloadSpeed},"file":"${esc(MainActivity.modelDownloadFile)}","model_id":"${esc(MainActivity.modelDownloadModelId)}","error":"${esc(MainActivity.modelDownloadError)}","model":"$modelName"}"""
    }

    /** 模型商店列表（供外部脚本/监控查询已下载模型与当前激活） */
    private fun modelCatalogJson(): String = try {
        catalog?.snapshotJson() ?: """{"ok":false,"error":"catalog unavailable"}"""
    } catch (t: Throwable) {
        """{"ok":false,"error":"${t.message?.replace("\"", "") ?: "unknown"}"}"""
    }

    /** POST /model/install {"model_id":"xxx"} —— 触发下载（异步） */
    private fun handleModelInstall(out: OutputStream, body: String) {
        val id = extractJsonString(body, "model_id") ?: extractJsonString(body, "id")
        if (id.isNullOrEmpty()) {
            writeJson(out, 400, """{"ok":false,"error":"缺少 model_id"}""")
            return
        }
        val cat = catalog
        if (cat == null) {
            writeJson(out, 503, """{"ok":false,"error":"catalog unavailable"}""")
            return
        }
        if (cat.find(id) == null) {
            writeJson(out, 404, """{"ok":false,"error":"模型不存在: $id"}""")
            return
        }
        if (cat.isDownloaded(id)) {
            writeJson(out, 200, """{"ok":true,"started":false,"reason":"already_downloaded"}""")
            return
        }
        val act = MainActivity.instance
        if (act == null) {
            // Activity 不在（锁屏/被杀）→ 由 App 重启后的首启流程接手下载
            writeJson(out, 503, """{"ok":false,"error":"activity unavailable, 将在下次启动时自动下载"}""")
            return
        }
        Thread {
            act.provisionModel(java.io.File(act.filesDir, "diag.txt"), id, activate = false)
        }.apply { name = "model-install-$id"; start() }
        writeJson(out, 202, """{"ok":true,"started":true,"model_id":"$id"}""")
    }

    /** POST /model/activate {"model_id":"xxx"} —— 切换当前模型 */
    private fun handleModelActivate(out: OutputStream, body: String) {
        val id = extractJsonString(body, "model_id") ?: extractJsonString(body, "id")
        if (id.isNullOrEmpty()) {
            writeJson(out, 400, """{"ok":false,"error":"缺少 model_id"}""")
            return
        }
        // 切换需要重建 MNN 引擎，必须有 Activity 上下文
        val act = MainActivity.instance
        if (act == null) {
            writeJson(out, 503, """{"ok":false,"error":"activity unavailable（切模型需要 App 在前台）"}""")
            return
        }
        val ok = act.activateModel(id)
        if (ok) writeJson(out, 200, """{"ok":true,"active":"$id"}""")
        else writeJson(out, 400, """{"ok":false,"error":"切换失败（模型未完整下载？）"}""")
    }

    /** POST /model/delete {"model_id":"xxx"} —— 删除模型释放空间 */
    private fun handleModelDelete(out: OutputStream, body: String) {
        val id = extractJsonString(body, "model_id") ?: extractJsonString(body, "id")
        if (id.isNullOrEmpty()) {
            writeJson(out, 400, """{"ok":false,"error":"缺少 model_id"}""")
            return
        }
        val cat = catalog
        if (cat == null) {
            writeJson(out, 503, """{"ok":false,"error":"catalog unavailable"}""")
            return
        }
        val ok = cat.deleteModel(id)
        if (ok) writeJson(out, 200, """{"ok":true,"deleted":"$id"}""")
        else writeJson(out, 400, """{"ok":false,"error":"删除失败（当前使用的模型不能删除）"}""")
    }

    // ==================== 联网搜索（本地 AI 的上网能力） ====================

    /** GET /net —— 设备当前是否真的联网。 */
    private fun netStatusJson(): String {
        val online = try { appContext?.let { WebSearch.isOnline(it) } ?: false } catch (_: Throwable) { false }
        return """{"ok":true,"online":$online}"""
    }

    /** GET /websearch?q=关键词[&n=5] —— 联网搜索，返回结果列表。 */
    private fun handleWebSearch(out: OutputStream, query: String) {
        val q = queryParam(query, "q")
        if (q.isNullOrBlank()) {
            writeJson(out, 400, """{"ok":false,"error":"缺少 q 参数，如 /websearch?q=今天新闻"}""")
            return
        }
        val n = queryParam(query, "n")?.toIntOrNull()?.coerceIn(1, 10) ?: 5
        val text = WebSearch.search(q, n)
        // 把纯文本结果也尽量结构化返回
        val lines = text.lines().filter { it.isNotBlank() }
        writeJson(out, 200, """{"ok":true,"query":"$q","raw":${jsonStr(text)},"lines":${jsonArr(lines)}}""")
    }

    /** GET /fetch?url=https://... —— 抓取网页正文。 */
    private fun handleFetchPage(out: OutputStream, query: String) {
        val url = queryParam(query, "url")
        if (url.isNullOrBlank()) {
            writeJson(out, 400, """{"ok":false,"error":"缺少 url 参数，如 /fetch?url=https://example.com"}""")
            return
        }
        val text = WebSearch.fetchPage(url)
        writeJson(out, 200, """{"ok":true,"url":"$url","text":${jsonStr(text)}}""")
    }

    /** 从原始 query 串里取参数（不做 URL 解码以外的特殊处理）。 */
    private fun queryParam(query: String, key: String): String? {
        if (query.isBlank()) return null
        for (pair in query.split("&")) {
            val kv = pair.split("=", limit = 2)
            if (kv.size == 2 && kv[0] == key) {
                return try { java.net.URLDecoder.decode(kv[1], "UTF-8") } catch (_: Throwable) { kv[1] }
            }
        }
        return null
    }

    private fun jsonStr(s: String): String = org.json.JSONObject.quote(s)
    private fun jsonArr(lines: List<String>): String =
        "[" + lines.joinToString(",") { org.json.JSONObject.quote(it) } + "]"

    /** 从 JSON body 里取字符串字段（极简解析，避免为此引入依赖） */
    private fun extractJsonString(body: String, key: String): String? = try {
        val m = Regex("\"$key\"\\s*:\\s*\"([^\"]*)\"").find(body)
        m?.groupValues?.get(1)?.takeIf { it.isNotEmpty() }
    } catch (_: Throwable) {
        null
    }

    /**
     * 取本机可被外部访问的局域网 IP。
     *
     * 必须优先选 wlan0 / 常规 WiFi 网卡，不能"随机挑一个接口"：
     * 早期版本用 NetworkInterface 遍历的第一个 IPv4，vivo 等设备上会取到
     * p2p0（WiFi Direct 虚拟接口，典型 192.168.49.1），该地址只在手机上自洽，
     * 电脑上根本路由不到 —— 用户照着显示的地址连接必然超时。
     * 现在按优先级筛选：wlan0 > eth/usb > 其他物理网卡 > 最后才放弃用虚拟接口。
     */
    private fun localIp(): String = try {
        val ifaces = java.net.NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }

        fun ipv4s(nic: java.net.NetworkInterface) = nic.inetAddresses.toList()
            .filterIsInstance<java.net.Inet4Address>()
            .filter { !it.isLoopbackAddress && !it.isLinkLocalAddress }

        // 1) 名字精确匹配 wlan0 / wifi
        val byName = ifaces.firstOrNull {
            val n = it.name.lowercase()
            n == "wlan0" || n == "wlan1" || n.startsWith("wifi")
        }
        // 2) 有线 / USB 网络
        val byWired = ifaces.firstOrNull {
            val n = it.name.lowercase()
            n.startsWith("eth") || n.startsWith("usb") || n.startsWith("en")
        }
        // 3) 其他物理网卡（排除点对点/虚拟）
        val byPhysical = ifaces.firstOrNull {
            val n = it.name.lowercase()
            !n.startsWith("p2p") && !n.startsWith("ap") && !n.startsWith("tun") &&
            !n.startsWith("rmnet") && !n.startsWith("ccmni") && !n.startsWith("docker") &&
            !n.startsWith("vethernet") && !n.startsWith("swlan")
        }

        val chosen = byName ?: byWired ?: byPhysical
        chosen?.let { nic -> ipv4s(nic).firstOrNull()?.hostAddress }
            // 4) 兜底：排除明显的虚拟/点对点接口后再找
            ?: ifaces.firstOrNull {
                val n = it.name.lowercase()
                !n.startsWith("p2p") && !n.startsWith("rmnet") && !n.startsWith("ccmni")
            }?.let { nic -> ipv4s(nic).firstOrNull()?.hostAddress }
            // 5) 最后兜底：任何 IPv4（宁可给不可用地址也不要空）
            ?: ifaces.asSequence()
                .flatMap { ipv4s(it).asSequence() }
                .firstOrNull()?.hostAddress
            ?: "127.0.0.1"
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

    // ==================== 工具模式（tool_calls 桥接） ====================

    /**
     * 把调用方给的 OpenAI tools schema 转成小模型友好的 DSL 提示。
     *
     * 1.5B 模型写 JSON function calling 极不可靠，但「工具名|参数」这种一行格式
     * 命中率很高（项目自己的 INTENT agent 就是这么用的）。
     */
    private fun toolModeSystemPrompt(tools: org.json.JSONArray): String {
        val sb = StringBuilder()
        sb.append("你是奇点OS的本地助手，可以调用工具来完成任务。\n")
        sb.append("【可用工具】需要调用工具时，严格用一行输出：工具名|参数\n")
        for (i in 0 until tools.length()) {
            val t = tools.optJSONObject(i) ?: continue
            val fn = t.optJSONObject("function") ?: continue
            val name = fn.optString("name")
            val desc = fn.optString("description")
            val param = firstParamName(tools, name)
            sb.append("- ").append(name)
            if (param.isNotEmpty()) sb.append("|").append(param)
            if (desc.isNotEmpty()) sb.append("（").append(desc.take(60)).append("）")
            sb.append('\n')
        }
        sb.append("""
【输出格式】严格遵守：
【思考】你要做什么
【工具】工具名|参数（需要调用工具时才写这一行）
【回答】给用户的最终回答（不需要再调工具时写这一行）
""".trimIndent())
        return sb.toString()
    }

    /** 取某个工具 schema 里第一个参数的属性名（作为 DSL 参数名的映射目标）。 */
    private fun firstParamName(tools: org.json.JSONArray, fname: String): String {
        for (i in 0 until tools.length()) {
            val t = tools.optJSONObject(i) ?: continue
            val fn = t.optJSONObject("function") ?: continue
            if (fn.optString("name") != fname) continue
            val props = fn.optJSONObject("parameters")?.optJSONObject("properties") ?: return ""
            val keys = props.keys()
            return if (keys.hasNext()) keys.next() else ""
        }
        return ""
    }

    // ==================== 手机端 Agent（自执行任务） ====================

    /**
     * POST /agent/run —— 让手机自己的意图 Agent 执行任务。
     *
     * 与 /v1/chat/completions 的区别：那个只做单次推理返回文本；
     * 这个在手机内部跑完整循环（思考 → 调工具 → 观察 → 继续 → 回答），
     * 工具全部在手机上就地执行（容器命令 / 改界面 / 启动 App / 查知识库）。
     */
    private fun handleAgentRun(out: OutputStream, body: String) {
        val t0 = System.currentTimeMillis()
        var prompt = ""
        var rounds = 5
        try {
            val jo = JSONObject(body.trim())
            prompt = jo.optString("prompt", "")
                .ifBlank { jo.optString("message", "") }
                .ifBlank { jo.optString("task", "") }
            rounds = jo.optInt("rounds", 5).coerceIn(1, 8)
        } catch (t: Throwable) {
            writeJson(out, 400, """{"ok":false,"error":"bad_json","hint":"body 需要是 {\"prompt\":\"要执行的任务\"}"}""")
            return
        }
        if (prompt.isBlank()) {
            writeJson(out, 400, """{"ok":false,"error":"empty_prompt","hint":"请提供 prompt 字段"}""")
            return
        }
        val ai = aiProvider()
        if (ai == null) {
            writeJson(out, 503, """{"ok":false,"error":"model_loading","hint":"本地模型正在加载，请稍后重试"}""")
            return
        }
        val res = IntentAgent.run(
            prompt,
            infer = { p -> ai.inferSync(p) ?: "" },
            maxRounds = rounds
        )
        chatCount.incrementAndGet()
        val jo = JSONObject()
        jo.put("ok", true)
        jo.put("answer", res["answer"] ?: "")
        jo.put("rounds", res["rounds"] ?: 0)
        jo.put("ms", System.currentTimeMillis() - t0)
        jo.put("trace", org.json.JSONArray(res["trace"] as? List<*> ?: emptyList<Any>()))
        writeJson(out, 200, jo.toString())
    }
}
