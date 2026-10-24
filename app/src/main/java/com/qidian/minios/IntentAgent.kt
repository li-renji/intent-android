package com.qidian.minios

import android.util.Log

/**
 * 手机侧「意图 Agent」内核 —— 把原本只存在于 WebView JS 里的 INTENT 循环
 * 搬到原生层，让**外部 agent（WorkBuddy / 奇点Agent）也能驱动手机执行任务**。
 *
 * 为什么要做：
 *   之前 HTTP API 只有 /chat —— 单次推理、返回纯文本。模型没有工具可用，
 *   外部 agent 拿到回答也无从执行。手机明明有 exec/readFile/writeUI/launchApp
 *   这些能力，却一个都没通过 HTTP 暴露出去。
 *
 * 协议：小模型不擅长 OpenAI 那种 JSON function calling，但很擅长一行 DSL：
 *   【工具】exec|ls -al
 * 所以内部沿用项目原有的 INTENT DSL（与 app.js 的实现保持一致），
 * 对外再提供 OpenAI 兼容的 tool_calls 桥接（见 LocalHttpServer）。
 */
object IntentAgent {
    private const val TAG = "IntentAgent"

    /** 手机能力宿主：由 MainActivity 注册，实现真正的系统操作。 */
    interface ToolHost {
        /** 在 proot 容器内执行 shell 命令。 */
        fun exec(cmd: String): String

        /** 读取界面文件（index.html / style.css / app.js）。 */
        fun readUI(name: String): String

        /** 写入界面文件并刷新。 */
        fun writeUI(name: String, content: String): String

        /** 启动安卓应用。 */
        fun launchApp(packageName: String): String

        /** 系统状态（容器 / AI / HTTP）。 */
        fun status(): String

        /** 搜索知识库。 */
        fun searchKB(keyword: String): String
    }

    @Volatile
    var host: ToolHost? = null

    /** INTENT 系统提示词 —— 与 app.js 的 getIntentSystemPrompt() 语义对齐。 */
    fun buildSystemPrompt(extraTools: String = ""): String {
        val now = java.util.Calendar.getInstance()
        val weekdays = arrayOf("星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六")
        val timeStr = "%d年%d月%d日 %s %02d:%02d".format(
            now.get(java.util.Calendar.YEAR), now.get(java.util.Calendar.MONTH) + 1,
            now.get(java.util.Calendar.DAY_OF_MONTH), weekdays[now.get(java.util.Calendar.DAY_OF_WEEK) - 1],
            now.get(java.util.Calendar.HOUR_OF_DAY), now.get(java.util.Calendar.MINUTE)
        )
        return """你是 INTENT（意图），奇点OS的系统级智能体。
当前时间：$timeStr
你运行在：奇点OS mini（安卓APK，proot非root容器，MNN引擎本地推理）
你的真实模型：Qwen2.5-1.5B-Instruct（千问），不要伪装。

【你的能力】
你不是普通聊天机器人，你可以真正调用工具操作系统：
- exec|命令 → 在容器内执行Linux命令
- readFile|路径 → 读取容器内文件
- writeFile|路径|内容 → 写入文件
- readUI|文件名 → 读取界面文件(index.html/style.css/app.js)
- writeUI|文件名|内容 → 修改界面并自动刷新
- launchApp|包名 → 启动安卓应用
- getStatus → 获取系统状态
- searchKB|关键词 → 搜索知识库
$extraTools
【输出格式】严格遵守：
【思考】分析用户意图，规划步骤
【工具】工具名|参数（如果需要操作）
【回答】最终给用户的回答

【规则】
1. 行动优先：能做就做，不要只给建议
2. 诚实：不编造结果，工具返回什么就是什么
3. 安全：禁止 rm -rf /、mkfs 等危险命令
4. 修改界面前先 readUI 读取当前内容
5. 简单任务直接回答，复杂任务分步调用工具
6. 每次回答必须有【思考】，可以没有【工具】但必须有【回答】"""
    }

    /** 从模型输出里解析出工具调用行，返回 null 表示这轮没有工具调用。 */
    fun parseToolCall(text: String): String? {
        val m = Regex("【工具】([^\\n]+)").find(text) ?: return null
        val call = m.groupValues[1].trim()
        return call.ifBlank { null }
    }

    /** 解析【回答】段；没有就用全文。 */
    fun parseAnswer(text: String): String {
        val m = Regex("【回答】([\\s\\S]*)$").find(text)
        return (m?.groupValues?.get(1) ?: text).trim()
    }

    /** 解析【思考】段。 */
    fun parseThinking(text: String): String {
        val m = Regex("【思考】([\\s\\S]*?)(?=【工具】|【回答】|$)").find(text)
        return (m?.groupValues?.get(1) ?: "").trim()
    }

    /**
     * 执行一个工具调用（DSL 格式：工具名|参数1|参数2）。
     * 返回给模型看的观察结果文本。
     */
    fun executeTool(toolStr: String): String {
        val h = host
        if (h == null) return "[错误] 工具宿主未就绪"
        val parts = toolStr.split("|")
        val tool = parts[0].trim()
        val arg = parts.drop(1).joinToString("|").trim()
        return try {
            when (tool) {
                "exec" -> h.exec(arg)
                "readFile" -> h.exec("cat \"${arg.replace("\"", "\\\"")}\"")
                "writeFile" -> {
                    val filePath = parts.getOrNull(1)?.trim().orEmpty()
                    val content = parts.drop(2).joinToString("|").trim()
                    h.exec(
                        "echo \"${base64(content)}\" | base64 -d > \"${filePath.replace("\"", "\\\"")}\" " +
                            "&& echo \"写入成功\""
                    )
                }
                "readUI" -> h.readUI(arg)
                "writeUI" -> {
                    val fileName = parts.getOrNull(1)?.trim().orEmpty()
                    val content = parts.drop(2).joinToString("|").trim()
                    h.writeUI(fileName, content)
                }
                "launchApp" -> h.launchApp(arg)
                "getStatus" -> h.status()
                "searchKB" -> h.searchKB(arg)
                else -> "[错误] 未知工具: $tool"
            }
        } catch (t: Throwable) {
            Log.e(TAG, "工具执行异常: ${t.message}", t)
            "[工具执行异常] ${t.message}"
        }
    }

    private fun base64(s: String): String =
        android.util.Base64.encodeToString(s.toByteArray(Charsets.UTF_8), android.util.Base64.NO_WRAP)

    /**
     * 跑完整 Agent 循环：思考 → 调工具 → 观察 → 继续 → 回答。
     *
     * @param infer 推理函数（外部注入，便于复用 AiService 的全局锁与长度截断）
     * @return map：ok / answer / rounds / trace（每轮的思考、工具、结果）
     */
    fun run(
        userText: String,
        infer: (String) -> String,
        maxRounds: Int = 5,
        timeBudgetMs: Long = 120_000,
        extraSystem: String = ""
    ): Map<String, Any?> {
        val trace = ArrayList<Map<String, Any?>>()
        val t0 = System.currentTimeMillis()
        var prompt = buildSystemPrompt(extraSystem) + "\n\n用户: $userText\nINTENT: "
        var answer = ""
        var round = 0

        while (round < maxRounds) {
            if (System.currentTimeMillis() - t0 > timeBudgetMs) {
                answer = "[超时] 任务执行超过 ${timeBudgetMs / 1000}s 预算，已中止"
                break
            }
            round++
            val response = try {
                infer(prompt)
            } catch (t: Throwable) {
                "[推理异常] ${t.message}"
            }
            val toolCall = parseToolCall(response)
            if (toolCall != null) {
                val result = executeTool(toolCall)
                trace.add(
                    mapOf(
                        "round" to round,
                        "thinking" to parseThinking(response),
                        "tool" to toolCall,
                        "result" to result.take(800)
                    )
                )
                Log.i(TAG, "[INTENT] 第${round}轮 调用工具: $toolCall")
                prompt += response + "\n【观察】" + result + "\nINTENT: "
                continue
            }
            answer = parseAnswer(response)
            trace.add(mapOf("round" to round, "thinking" to parseThinking(response), "answer" to answer))
            break
        }
        if (answer.isBlank() && trace.isNotEmpty()) {
            answer = trace.last()["result"]?.toString() ?: ""
        }
        return mapOf(
            "ok" to true,
            "answer" to answer,
            "rounds" to round,
            "ms" to (System.currentTimeMillis() - t0),
            "trace" to trace
        )
    }
}
