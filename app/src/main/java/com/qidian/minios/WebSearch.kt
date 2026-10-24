package com.qidian.minios

import android.content.Context
import android.util.Log
import kotlin.text.RegexOption
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * 本地 AI 的联网能力。
 *
 * 设计目标：让运行在手机上的本地小模型也能"自己上网找资料"。
 * - isOnline：真正能联网（不仅连上 WiFi，还要能通过系统校验 VALIDATED）。
 * - search：多搜索引擎容错（Bing → DuckDuckGo），返回标题/摘要/链接。
 * - fetchPage：抓取网页并抽取可读正文，供模型阅读具体内容。
 *
 * 全部用 HttpURLConnection（无额外依赖），模拟桌面浏览器 UA 以提高成功率。
 * 结果做了长度截断，避免塞爆 MNN 的 prompt 上限（1800 字符）。
 */
object WebSearch {
    private const val UA =
        "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
    private const val CONNECT_TIMEOUT = 10_000
    private const val READ_TIMEOUT = 20_000
    private const val MAX_PAGE_BYTES = 2 * 1024 * 1024
    private const val MAX_SEARCH_CHARS = 1200
    private const val MAX_PAGE_CHARS = 1200

    /** 设备是否真正可联网（已连接且通过系统连通性校验）。 */
    fun isOnline(context: Context): Boolean {
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val nw = cm.activeNetwork ?: return false
                val cap = cm.getNetworkCapabilities(nw) ?: return false
                cap.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                    cap.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            } else {
                @Suppress("DEPRECATION")
                val info = cm.activeNetworkInfo
                info != null && info.isConnected
            }
        } catch (_: Throwable) {
            false
        }
    }

    /** 联网搜索，返回 topN 条结果的纯文本（标题/摘要/链接）。 */
    fun search(query: String, maxResults: Int = 5): String {
        val q = query.trim()
        if (q.isBlank()) return "[搜索] 关键词为空"
        if (!isOnlineCtx()) return "[网络不可用] 当前设备未连接到互联网，无法联网搜索。"
        val enc = URLEncoder.encode(q, "UTF-8")
        val sb = StringBuilder()
        sb.append("联网搜索「$q」的结果：\n")
        val providers = listOf(
            { trySearch("Bing", searchBing(enc, maxResults)) },
            { trySearch("Baidu", searchBaidu(enc, maxResults)) }
        )
        for (p in providers) {
            val results = p()
            if (results.isNotEmpty()) {
                results.take(maxResults).forEachIndexed { i, r ->
                    sb.append("${i + 1}. ${r.title}\n   摘要：${r.snippet}\n   链接：${r.url}\n")
                }
                return sb.toString().take(MAX_SEARCH_CHARS)
            }
        }
        return "[搜索失败] 未能从搜索引擎获取结果（可能网络被拦截或暂时不可用）。"
    }

    /** 抓取网页并提取正文文本。 */
    fun fetchPage(url: String, maxChars: Int = MAX_PAGE_CHARS): String {
        val u = url.trim()
        if (!u.startsWith("http://") && !u.startsWith("https://")) {
            return "[抓取] 仅支持 http/https 链接"
        }
        if (!isOnlineCtx()) return "[网络不可用] 当前设备未连接到互联网，无法抓取网页。"
        val html = getHtml(u) ?: return "[抓取失败] 无法获取页面（可能未联网、链接失效或被拦截）"
        val text = extractText(html)
        return if (text.isBlank()) "[抓取失败] 页面无可读文本" else text.take(maxChars)
    }

    // ===================== 内部实现 =====================

    private var appCtx: Context? = null

    fun attach(context: Context) {
        appCtx = context.applicationContext
    }

    private fun isOnlineCtx(): Boolean = appCtx?.let { isOnline(it) } ?: false

    private fun trySearch(name: String, results: List<Result>): List<Result> {
        if (results.isNotEmpty()) Log.i("WebSearch", "搜索命中引擎: $name (${results.size} 条)")
        return results
    }

    private data class Result(val title: String, val url: String, val snippet: String)

    private fun getHtml(url: String): String? {
        return try {
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = CONNECT_TIMEOUT
                readTimeout = READ_TIMEOUT
                instanceFollowRedirects = true
                setRequestProperty("User-Agent", UA)
                setRequestProperty("Accept", "text/html,application/xhtml+xml")
                setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
            }
            val code = conn.responseCode
            if (code != HttpURLConnection.HTTP_OK) {
                conn.disconnect()
                return null
            }
            // 限制读取大小，避免超大页面 OOM；HttpURLConnection 在未设置
            // Accept-Encoding 时会自动解压 gzip。
            val bytes = conn.inputStream.use { it.readBytes() }.take(MAX_PAGE_BYTES).toByteArray()
            conn.disconnect()
            String(bytes, Charsets.UTF_8)
        } catch (t: Throwable) {
            Log.w("WebSearch", "getHtml 失败: $url -> ${t.message}")
            null
        }
    }

    private fun searchBing(enc: String, max: Int): List<Result> {
        // 用 cn.bing.com 直连：www.bing.com 在国内会 302 跳转到 cn，
        // 而 HttpURLConnection 在部分 Android 版本上对跨主机重定向跟随不可靠。
        val html = getHtml("https://cn.bing.com/search?q=$enc&setlang=zh-CN&mkt=zh-CN")
            ?: return emptyList()
        val out = ArrayList<Result>()
        val blocks = Regex("""<li class="b_algo"[^>]*>[\s\S]*?</li>""").findAll(html)
        for (b in blocks) {
            val block = b.value
            // 结果块内首个外链 http(s) 即为目标网址（CSS 用相对路径 /rp/，不会被误取）
            val href = Regex("""href="(https?://[^"]+)"""").find(block)?.groupValues?.get(1) ?: continue
            if (!href.startsWith("http")) continue
            val title = stripTags(
                Regex("""<a[^>]*class="tilk"[^>]*>(.*?)</a>""", RegexOption.DOT_MATCHES_ALL)
                    .find(block)?.groupValues?.get(1) ?: ""
            ).ifBlank {
                Regex("""aria-label="([^"]+)"""").find(block)?.groupValues?.get(1) ?: ""
            }
            val snippet = stripTags(
                Regex("""<p[^>]*>([\s\S]*?)</p>""", RegexOption.DOT_MATCHES_ALL)
                    .find(block)?.groupValues?.get(1) ?: ""
            ).take(160)
            if (title.isNotBlank()) out.add(Result(title, href, snippet))
            if (out.size >= max) break
        }
        return out
    }

    private fun searchBaidu(enc: String, max: Int): List<Result> {
        val html = getHtml("https://www.baidu.com/s?wd=$enc") ?: return emptyList()
        val out = ArrayList<Result>()
        val titles = Regex("""<h3 class="t">\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>""", RegexOption.DOT_MATCHES_ALL)
            .findAll(html).toList()
        val snips = Regex("""<span class="content-right_[^"]*">([\s\S]*?)</span>""", RegexOption.DOT_MATCHES_ALL)
            .findAll(html).toList()
        for (i in titles.indices) {
            val href = titles[i].groupValues[1]
            val title = stripTags(titles[i].groupValues[2]).take(80)
            val snippet = if (i < snips.size) stripTags(snips[i].groupValues[1]).take(160) else ""
            if (title.isNotBlank() && href.startsWith("http")) out.add(Result(title, href, snippet))
            if (out.size >= max) break
        }
        return out
    }

    private fun extractText(html: String): String {
        var s = html
        s = Regex("""(?is)<script[\s\S]*?</script>""").replace(s, " ")
        s = Regex("""(?is)<style[\s\S]*?</style>""").replace(s, " ")
        s = Regex("""(?is)<(br|/p|/div|/li|/h[1-6]|/tr|/td)>""").replace(s) { "\n" }
        s = stripTags(s)
        return s.replace(Regex("""\n[ \t]*\n+"""), "\n").trim()
    }

    private fun stripTags(s: String): String {
        return s.replace(Regex("""<[^>]+>"""), "")
            .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
            .replace("&quot;", "\"").replace("&#39;", "'").replace("&nbsp;", " ")
            .replace(Regex("""\s+"""), " ").trim()
    }
}
