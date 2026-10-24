package com.qidian.minios

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * 模型商店（Model Store）。
 *
 * 清单来自 assets/model_catalog.json，由 tools/gen_model_catalog.py 生成。
 * 每个条目描述一个可下载的本地模型：来源仓库、文件清单、大小、sha256。
 *
 * 目录约定：
 *   files/models/<modelId>/            每个模型独立目录，可共存多个
 *   files/models/.active               当前激活的模型 id（纯文本）
 *
 * 下载完成后由 MainActivity 负责重启 AI 引擎加载新模型。
 */
class ModelCatalog(private val context: Context) {

    data class ModelEntry(
        val id: String,
        val name: String,
        val desc: String,
        val params: String,
        val repo: String,
        val tags: List<String>,
        val minRamMb: Int,
        val recommended: Boolean,
        val mirrors: List<String>,
        val files: List<FileSpec>,
        val totalBytes: Long
    )

    data class FileSpec(
        val path: String,
        val bytes: Long,
        val sha256: String
    )

    companion object {
        private const val TAG = "ModelCatalog"
        private const val CATALOG_ASSET = "model_catalog.json"
        private const val OVERRIDE_ASSET = "model_catalog.override.json"
        private const val MODELS_DIR = "models"
        private const val ACTIVE_FILE = "models/.active"

        /** 解析 catalog JSON */
        fun parse(raw: String): Pair<String, List<ModelEntry>> {
            val root = JSONObject(raw)
            val defaultId = root.optString("default_model", "")
            val arr = root.optJSONArray("models") ?: JSONArray()
            val list = ArrayList<ModelEntry>()
            for (i in 0 until arr.length()) {
                val m = arr.getJSONObject(i)
                val filesArr = m.optJSONArray("files") ?: JSONArray()
                val files = ArrayList<FileSpec>()
                for (j in 0 until filesArr.length()) {
                    val f = filesArr.getJSONObject(j)
                    files.add(
                        FileSpec(
                            path = f.getString("path"),
                            bytes = f.optLong("bytes", 0),
                            sha256 = f.optString("sha256", "")
                        )
                    )
                }
                val mirrorsArr = m.optJSONArray("mirrors") ?: JSONArray()
                val mirrors = ArrayList<String>()
                for (j in 0 until mirrorsArr.length()) mirrors.add(mirrorsArr.getString(j))
                val tagsArr = m.optJSONArray("tags") ?: JSONArray()
                val tags = ArrayList<String>()
                for (j in 0 until tagsArr.length()) tags.add(tagsArr.getString(j))

                list.add(
                    ModelEntry(
                        id = m.getString("id"),
                        name = m.optString("name", m.getString("id")),
                        desc = m.optString("desc", ""),
                        params = m.optString("params", ""),
                        repo = m.optString("repo", ""),
                        tags = tags,
                        minRamMb = m.optInt("min_ram_mb", 1024),
                        recommended = m.optBoolean("recommended", false),
                        mirrors = mirrors,
                        files = files,
                        totalBytes = m.optLong("total_bytes", files.sumOf { it.bytes })
                    )
                )
            }
            return defaultId to list
        }
    }

    val defaultModelId: String
    val models: List<ModelEntry>

    init {
        val raw = try {
            context.assets.open(CATALOG_ASSET).use { it.readBytes().toString(Charsets.UTF_8) }
        } catch (t: Throwable) {
            Log.w(TAG, "catalog 读取失败: $t")
            "{\"default_model\":\"\",\"models\":[]}"
        }
        val (def, list) = parse(raw)
        defaultModelId = def
        models = list
    }

    fun find(id: String): ModelEntry? = allModels().firstOrNull { it.id == id }

    /**
     * 读取「覆盖清单」files/model_catalog.override.json（用户/本地 AI 添加、无需重打包）。
     * 不存在或损坏时返回空列表。
     */
    private fun overrideList(): List<ModelEntry> {
        val f = File(context.filesDir, OVERRIDE_ASSET)
        if (!f.exists()) return emptyList()
        return try {
            parse(f.readText()).second
        } catch (t: Throwable) {
            Log.w(TAG, "覆盖清单解析失败: $t")
            emptyList()
        }
    }

    /**
     * 合并：内置清单 + 覆盖清单（覆盖清单按 id 优先，新 id 追加在末尾）。
     * 覆盖清单每次调用即时读取，保证「加完立刻在商店出现」无需重启/重打包。
     */
    fun allModels(): List<ModelEntry> {
        val over = overrideList()
        if (over.isEmpty()) return models
        val byId = models.associateBy { it.id }.toMutableMap()
        for (m in over) byId[m.id] = m
        return byId.values.toList()
    }

    /** 覆盖清单里的 id 集合（用于商店标记「新」）。 */
    fun overrideIds(): Set<String> = overrideList().map { it.id }.toSet()

    /**
     * 把一个新模型追加/更新进覆盖清单。json 是单个模型的 JSON 对象字符串。
     * 返回标准 JSON 结果串。
     */
    fun appendModel(json: String): String {
        val newEntry = try {
            parse("{\"models\":[$json]}").second.firstOrNull()
        } catch (t: Throwable) {
            null
        } ?: return "{\"ok\":false,\"error\":\"模型 JSON 解析失败\"}"

        val f = File(context.filesDir, OVERRIDE_ASSET)
        val existing = if (f.exists()) {
            try { parse(f.readText()).second.toMutableList() } catch (_: Throwable) { mutableListOf() }
        } else {
            mutableListOf()
        }
        val idx = existing.indexOfFirst { it.id == newEntry.id }
        if (idx >= 0) existing[idx] = newEntry else existing.add(newEntry)

        val arr = org.json.JSONArray()
        for (m in existing) arr.put(entryToJson(m))
        val obj = org.json.JSONObject().apply {
            put("default_model", "")
            put("models", arr)
        }
        try {
            f.writeText(obj.toString())
        } catch (t: Throwable) {
            return "{\"ok\":false,\"error\":\"写入覆盖清单失败: ${t.message}\"}"
        }
        return "{\"ok\":true,\"id\":\"${newEntry.id}\"}"
    }

    private fun entryToJson(m: ModelEntry): org.json.JSONObject =
        org.json.JSONObject().apply {
            put("id", m.id)
            put("name", m.name)
            put("desc", m.desc)
            put("params", m.params)
            put("repo", m.repo)
            put("tags", org.json.JSONArray(m.tags))
            put("min_ram_mb", m.minRamMb)
            put("recommended", m.recommended)
            put("mirrors", org.json.JSONArray(m.mirrors))
            put("total_bytes", m.totalBytes)
            val fa = org.json.JSONArray()
            for (f in m.files) {
                fa.put(org.json.JSONObject().apply {
                    put("path", f.path)
                    put("bytes", f.bytes)
                    put("sha256", f.sha256)
                })
            }
            put("files", fa)
        }

    /** 已下载且完整的模型 id 集合 */
    fun downloadedIds(): Set<String> =
        models.filter { isDownloaded(it.id) }.map { it.id }.toSet()

    fun modelDir(id: String): File = File(File(context.filesDir, MODELS_DIR), id)

    /**
     * 模型是否已完整下载（可用于推理）。
     *
     * 判定标准是"推理所需文件是否齐备"，而不是"是否与清单逐字节一致"：
     *   - config.json        MNN 入口配置
     *   - llm.mnn(.weight)   计算图 + 权重
     *   - tokenizer.*        分词器（文件名因模型版本而异）
     * 原因：用户手上可能已有同 id 的其他版本模型（不同量化/不同导出工具），
     * 严格比对会导致"明明能用却提示要重下几百 MB"。
     */
    fun isDownloaded(id: String): Boolean {
        val entry = find(id) ?: return false
        val dir = modelDir(id)
        if (!dir.exists()) return false
        if (!File(dir, "config.json").exists()) return false

        // 权重：清单里的文件名优先，否则找目录里任意 .weight
        val weight = entry.files.firstOrNull { it.path.endsWith(".weight") }?.path
        val weightFile = if (weight != null) File(dir, weight)
        else dir.listFiles()?.firstOrNull { it.name.endsWith(".weight") }
        if (weightFile == null || !weightFile.exists() || weightFile.length() <= 0) return false

        // 分词器：tokenizer.txt / tokenizer.mtok 任一存在即可
        val hasTokenizer = dir.listFiles()?.any {
            it.name.startsWith("tokenizer") && it.length() > 0
        } == true
        return hasTokenizer
    }

    /** 已下载模型的占用大小（字节） */
    fun downloadedSize(id: String): Long {
        val dir = modelDir(id)
        if (!dir.exists()) return 0
        return dir.walkTopDown().filter { it.isFile }.sumOf { it.length() }
    }

    /** 当前激活的模型 id */
    fun activeModelId(): String {
        val f = File(context.filesDir, ACTIVE_FILE)
        if (f.exists()) {
            val id = f.readText().trim()
            if (id.isNotEmpty() && isDownloaded(id)) return id
        }
        // 回退：默认模型 → 任意已下载模型
        val fallback = when {
            isDownloaded(defaultModelId) -> defaultModelId
            else -> downloadedIds().firstOrNull() ?: defaultModelId
        }
        // 把解析结果持久化，保证下次启动一致（否则 .active 永远不生成，
        // 用户切换过模型后重启会退回默认模型）
        if (fallback.isNotEmpty()) {
            try {
                f.parentFile?.mkdirs()
                f.writeText(fallback)
            } catch (_: Throwable) {
            }
        }
        return fallback
    }

    fun setActiveModel(id: String): Boolean {
        if (!isDownloaded(id)) return false
        val f = File(context.filesDir, ACTIVE_FILE)
        f.parentFile?.mkdirs()
        f.writeText(id)
        return true
    }

    /** 删除已下载模型，释放空间 */
    fun deleteModel(id: String): Boolean {
        if (activeModelId() == id) return false   // 激活中的不能删
        val dir = modelDir(id)
        if (!dir.exists()) return true
        // 只删本模型目录内的内容（防路径穿越）
        val root = File(context.filesDir, MODELS_DIR).canonicalFile
        val target = dir.canonicalFile
        if (!target.path.startsWith(root.path + File.separator)) return false
        target.deleteRecursively()
        return true
    }

    /** 汇总商店状态，供 UI / HTTP 查询 */
    fun snapshotJson(): String {
        val active = activeModelId()
        val overrideSet = overrideIds()
        val arr = JSONArray()
        for (m in allModels()) {
            val downloaded = isDownloaded(m.id)
            arr.put(
                JSONObject().apply {
                    put("id", m.id)
                    put("name", m.name)
                    put("desc", m.desc)
                    put("params", m.params)
                    put("tags", JSONArray(m.tags))
                    put("min_ram_mb", m.minRamMb)
                    put("recommended", m.recommended)
                    put("size_mb", m.totalBytes / 1024 / 1024)
                    put("downloaded", downloaded)
                    put("active", m.id == active)
                    put("override", overrideSet.contains(m.id))
                    put("local_mb", if (downloaded) downloadedSize(m.id) / 1024 / 1024 else 0)
                }
            )
        }
        return JSONObject().apply {
            put("ok", true)
            put("active", active)
            put("default", defaultModelId)
            put("models", arr)
        }.toString()
    }

    /** 转成 ModelProvisioner 需要的 manifest */
    fun toManifest(entry: ModelEntry): ModelProvisioner.ModelManifest =
        ModelProvisioner.ModelManifest(
            name = entry.id,
            totalBytes = entry.totalBytes,
            files = entry.files.map {
                ModelProvisioner.FileSpec(path = it.path, bytes = it.bytes, sha256 = it.sha256)
            },
            mirrors = entry.mirrors,
            sha256 = ""
        )
}
