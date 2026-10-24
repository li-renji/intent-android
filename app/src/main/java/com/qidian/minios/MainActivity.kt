package com.qidian.minios

import android.app.Activity
import android.os.Bundle
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.content.Intent
import android.content.pm.PackageManager
import java.io.File
import java.io.FileInputStream

/**
 * 起点OS mini —— WebView 壳 + AI 可修改界面。
 *
 * 界面不打包在 APK 里，放在 files/ui/ 目录（HTML/CSS/JS 纯文本）。
 * AI 可以直接修改这些文件，WebView 实时刷新，用户立即看到效果，无需重装。
 *
 * 启动流程：
 *   1. 首次启动从 assets/ui/ 复制默认界面到 files/ui/
 *   2. 设置全屏 WebView，加载 files/ui/index.html
 *   3. 暴露 Qidian JS 接口给界面调用
 *   4. 后台线程启动 proot 容器 + MNN AI 服务
 */
class MainActivity : Activity() {

    companion object {
        private const val TAG = "QidianMiniOS"
        private const val ROOTFS_ASSET = "rootfs.tar"
        private const val SHM_NAME = "shm/shm.dat"

        // ===== 进程级状态 =====
        // 这些必须放在 companion：横竖屏切换 / 主题变化都会让 Activity 销毁重建，
        // 如果挂在实例上，重建出来的新实例字段全是 null（containerStarted 挡住了
        // 重新初始化），WebView 的 JS 接口就会读到 ai:false、http:false，
        // 而 HTTP 服务还挂在旧实例上继续正常工作——出现"API 好的、App 却说模型加载中"的诡异分裂。
        @Volatile var aiService: AiService? = null
            private set
        @Volatile var containerReady = false
            private set
        @Volatile var localHttp: LocalHttpServer? = null
            private set
        @Volatile var rootfsDir: File? = null
            private set
        @Volatile var shmFile: File? = null
            private set
        @Volatile private var containerStarted = false
        @Volatile private var bootLock = Any()

        // ===== 模型自动下载状态（进程级，供 JS 与 HTTP 读取）=====
        @Volatile var modelProvision: ModelProvisioner? = null
        @Volatile var modelDownloadState: String = "idle"   // idle|checking|downloading|verifying|done|failed
        @Volatile var modelDownloadError: String? = null
        @Volatile var modelDownloadedBytes: Long = 0
        @Volatile var modelDownloadTotalBytes: Long = 0
        @Volatile var modelDownloadSpeed: Long = 0
        @Volatile var modelDownloadFile: String = ""
        @Volatile var modelDownloadStartedAt: Long = 0

        // 投屏授权全局变量
        @Volatile
        var castResultCodeGlobal = 0
        @Volatile
        var castDataGlobal: Intent? = null
    }

    lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 先拉起前台服务：让进程在容器启动前就进入 foreground，
        // 否则熄屏/切后台时会被 cached app freezer 冻结，proot 起不来。
        KeepAliveService.start(this)

        // 立刻启动局域网 HTTP API。
        // 它跑在 App 进程自己的线程里，syscall 直通内核、不经过 proot，
        // 也不依赖 WebView 轮询，所以容器卡死/没起来时它照样能用。
        startHttpApi()

        // 注册意图 Agent 的工具宿主：让外部 agent 能通过 HTTP 驱动手机执行任务
        registerToolHost()

        // 系统背景纯黑
        window.decorView.setBackgroundColor(android.graphics.Color.BLACK)

        // 沉浸式全屏：隐藏状态栏和导航栏，撑满整个屏幕
        window.decorView.systemUiVisibility = (
            android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                or android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        )

        // 初始化 WebView
        setupWebView()

        // 复制默认界面（首次启动）
        copyDefaultUI()

        // 读取并应用保存的屏幕方向（onCreate + onResume 双重钉死，防止被 ROM 重置）
        applySavedOrientation()

        // 加载界面
        val uiDir = File(filesDir, "ui")
        webView.loadUrl("file://${uiDir.absolutePath}/index.html")

        // 后台启动容器 + AI
        if (!containerStarted) {
            containerStarted = true
            startContainerInBackground()
        }
    }

    /**
     * 应用已保存的屏幕方向。唯一数据源是 SharedPreferences：
     * onCreate 和 onResume 都调用它——部分 ROM 在任务切换、侧滑返回后会把
     * Activity 的 requestedOrientation 重置，不钉回去就会出现
     * "设置里显示竖屏、实际却是横屏"的分裂。
     */
    private fun applySavedOrientation() {
        val prefs = getSharedPreferences("settings", MODE_PRIVATE)
        requestedOrientation = if (prefs.getString("orientation", "landscape") == "portrait") {
            android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        } else {
            android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        }
    }

    override fun onResume() {
        super.onResume()
        applySavedOrientation()
    }

    /**
     * 方向被系统/ROM 改变时（锁屏旋转、分屏、侧滑返回触发的小窗等），
     * 立即按用户设置重新钉死方向——解决"设置里是竖屏、实际却横屏"的分裂。
     */
    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        Log.i(TAG, "系统方向变更 → ${newConfig.orientation}，重新应用用户设置")
        applySavedOrientation()
    }

    /** 设置 WebView */
    private fun setupWebView() {
        webView = WebView(this)
        setContentView(webView)

        // 左缘手势排除区：把左边缘一段高度（上限 200dp）划给 App 自己的手势
        // （竖屏下左缘右滑 = 呼出导航抽屉/返回列表）。不做这一步，vivo 等ROM的
        // 系统返回手势会先吃掉整个左缘，界面的抽屉手势永远收不到。
        if (android.os.Build.VERSION.SDK_INT >= 29) {
            webView.setOnApplyWindowInsetsListener { v, insets ->
                val gestureLeft = try {
                    insets.systemGestureInsets.left
                } catch (_: Throwable) {
                    (24 * resources.displayMetrics.density).toInt()
                }
                val zoneH = (200 * resources.displayMetrics.density).toInt()
                    .coerceAtMost(v.height)
                val top = (v.height - zoneH) / 2
                v.systemGestureExclusionRects = listOf(
                    android.graphics.Rect(0, top, gestureLeft.coerceAtLeast(40), top + zoneH)
                )
                insets
            }
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: android.webkit.WebView?, request: android.webkit.WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                // 拦截自定义 scheme，防止 ERR_UNKNOWN_URL_SCHEME
                if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("file://")) {
                    Log.i(TAG, "拦截自定义 scheme: $url")
                    return true // 不加载，不跳转
                }
                return false
            }
            override fun onReceivedError(view: android.webkit.WebView?, request: android.webkit.WebResourceRequest?, error: android.webkit.WebResourceError?) {
                Log.w(TAG, "WebView 错误: ${error?.description} url=${request?.url}")
            }
        }
        // JS console → logcat（便于真机排查 UI 问题）
        android.webkit.WebView.setWebContentsDebuggingEnabled(true)
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: android.webkit.ConsoleMessage?): Boolean {
                Log.i(TAG, "JS[${m?.messageLevel()}] ${m?.message()} @${m?.sourceId()}:${m?.lineNumber()}")
                return true
            }
        }

        // 暴露 JS 接口
        webView.addJavascriptInterface(QidianJSInterface(this), "Qidian")
    }

    /**
     * 注册意图 Agent 的工具宿主。
     *
     * 这样 HTTP API 的 /agent/run 和 tool_calls 桥接就能真正驱动手机做事
     * （容器命令 / 改界面 / 启动 App / 查知识库），而不只是返回一段文本。
     */
    private fun registerToolHost() {
        IntentAgent.host = object : IntentAgent.ToolHost {
            override fun exec(cmd: String): String = execInContainer(cmd)

            override fun readUI(name: String): String = try {
                val safe = name.replace("..", "").trimStart('/')
                val f = File(filesDir, "ui/$safe")
                if (f.exists()) f.readText() else ""
            } catch (e: Exception) {
                ""
            }

            override fun writeUI(name: String, content: String): String = try {
                val uiDir = File(filesDir, "ui")
                uiDir.mkdirs()
                val safe = name.replace("..", "").trimStart('/')
                val f = File(uiDir, safe)
                f.parentFile?.mkdirs()
                f.writeText(content)
                runOnUiThread { webView.reload() }
                "界面文件 $safe 已更新并刷新"
            } catch (e: Exception) {
                "[错误] 写入界面文件失败: ${e.message}"
            }

            override fun launchApp(packageName: String): String = try {
                val i = packageManager.getLaunchIntentForPackage(packageName)
                if (i != null) {
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    startActivity(i)
                    "已启动: $packageName"
                } else {
                    "未找到应用: $packageName"
                }
            } catch (e: Exception) {
                "启动失败: ${e.message}"
            }

            override fun status(): String =
                "{\"container\":$containerReady,\"ai\":${aiService != null}}"

            override fun searchKB(keyword: String): String =
                execInContainer("grep -n -i -- \"$keyword\" '/系统/功能.qd/知识库.qd/知识库.qdai' | head -20")
        }
    }

    /** 从 assets/ui/ 复制默认界面到 files/ui/ */
    private fun copyDefaultUI() {
        val uiDir = File(filesDir, "ui")
        uiDir.mkdirs()

        // 读取 APK 内置的界面版本号
        val assetVersion = try {
            assets.open("ui/ui_version.txt").bufferedReader().use { it.readText().trim() }
        } catch (e: Exception) { "unknown" }

        // 读取当前已安装的界面版本号
        val localVersionFile = File(uiDir, "ui_version.txt")
        val localVersion = if (localVersionFile.exists()) localVersionFile.readText().trim() else "none"

        // 版本一致且文件存在，跳过
        if (localVersion == assetVersion && File(uiDir, "index.html").exists()) {
            Log.i(TAG, "界面版本一致($assetVersion)，跳过复制")
            return
        }

        Log.i(TAG, "界面版本变化: $localVersion -> $assetVersion，开始更新界面")

        val uiAssets = listOf("index.html", "style.css", "app.js", "ui_version.txt")
        for (name in uiAssets) {
            try {
                assets.open("ui/$name").use { input ->
                    File(uiDir, name).outputStream().use { out ->
                        input.copyTo(out)
                    }
                }
                Log.i(TAG, "复制界面文件: $name")
            } catch (e: Exception) {
                Log.e(TAG, "复制界面文件失败: $name", e)
            }
        }

        // 创建备份目录
        File(uiDir, "backups").mkdirs()
    }

    /**
     * 启动局域网 HTTP API（9999 / 8822）。
     *
     * 与旧方案的区别：不再往 proot 容器里塞 microsrv.qds。
     * proot 用 ptrace 拦截每个 syscall，且自身是 App 的子进程——App 被冻结或
     * proot 事件循环卡住时，容器内的 microsrv 会变成"端口 LISTEN 但永不响应"。
     * 现在 ServerSocket 直接在 App 进程里跑，/chat 直接调 MNN，链路最短。
     */
    private fun startHttpApi() {
        if (localHttp?.isListening() == true) return
        Thread {
            try {
                val srv = LocalHttpServer(
                    httpPort = 9999,
                    statusPort = 8822,
                    aiProvider = { aiService },
                    keyDir = filesDir
                )
                val ok = srv.start()
                localHttp = srv
                Log.i(TAG, "HTTP API 启动结果: ok=$ok port=${srv.boundHttpPort}")
            } catch (t: Throwable) {
                Log.e(TAG, "HTTP API 启动异常", t)
            }
        }.apply {
            name = "http-api-boot"
            start()
        }
    }

    /**
     * 确保模型就绪：读取 assets 清单 → 自动下载 → 校验。
     * 阻塞调用（已在后台线程中）。
     * @return true 表示模型可用
     */
    internal fun ensureModelProvisioned(diag: File): Boolean {
        try {
            val raw = assets.open("model_manifest.json").use { it.readBytes().toString(Charsets.UTF_8) }
            val manifest = ModelProvisioner.loadManifest(raw)
            val modelDir = File(filesDir, "models/${manifest.name}")
            val provisioner = ModelProvisioner(modelDir, manifest) { p ->
                modelDownloadState = when (p.phase) {
                    ModelProvisioner.Progress.Phase.CHECKING -> "checking"
                    ModelProvisioner.Progress.Phase.DOWNLOADING -> "downloading"
                    ModelProvisioner.Progress.Phase.VERIFYING -> "verifying"
                    ModelProvisioner.Progress.Phase.DONE -> "done"
                    ModelProvisioner.Progress.Phase.FAILED,
                    ModelProvisioner.Progress.Phase.NO_SPACE -> "failed"
                    else -> "idle"
                }
                modelDownloadError = p.error
                modelDownloadedBytes = p.downloaded
                modelDownloadTotalBytes = p.total
                modelDownloadSpeed = p.bytesPerSec
                modelDownloadFile = p.fileName
                notifyModelProgress()
            }
            modelProvision = provisioner

            if (provisioner.isReady()) {
                diag.appendText("模型已就绪，跳过下载\n")
                modelDownloadState = "done"
                return true
            }

            modelDownloadStartedAt = System.currentTimeMillis()
            modelDownloadState = "checking"
            notifyModelProgress()

            val err = provisioner.provision()
            if (err != null) {
                modelDownloadState = "failed"
                modelDownloadError = err
                diag.appendText("模型下载失败: $err\n")
                notifyModelProgress()
                return false
            }
            diag.appendText("模型下载并校验完成\n")
            return true
        } catch (t: Throwable) {
            val msg = "模型初始化异常：${t.message}"
            modelDownloadState = "failed"
            modelDownloadError = msg
            diag.appendText("$msg\n")
            Log.e(TAG, msg, t)
            notifyModelProgress()
            return false
        }
    }

    /** 把下载进度推给 WebView */
    internal fun notifyModelProgress() {
        runOnUiThread {
            try {
                val js = "window.onModelProgress && window.onModelProgress(" +
                    "{state:'$modelDownloadState'," +
                    "downloaded:$modelDownloadedBytes," +
                    "total:$modelDownloadTotalBytes," +
                    "speed:$modelDownloadSpeed," +
                    "file:'${modelDownloadFile.replace("'", "")}'," +
                    "error:${modelDownloadError?.let { "'" + it.replace("'", "") + "'" } ?: "null"}})"
                webView.evaluateJavascript(js, null)
            } catch (_: Throwable) {
            }
        }
    }

    /** 后台启动容器 + AI 服务 */
    private fun startContainerInBackground() {
        Thread {
            try {
                val diag = File(filesDir, "diag.txt").apply {
                    writeText("start ${System.currentTimeMillis()}\n")
                }

                // 初始化共享内存通道
                shmFile = File(filesDir, SHM_NAME)
                val channel = ShmChannel(shmFile!!)
                if (!channel.open()) {
                    diag.appendText("shm init FAILED\n")
                    throw IllegalStateException("共享内存通道初始化失败")
                }
                diag.appendText("shm=$shmFile\n")

                // 启动 MNN AI 服务
                val mnnModelDir = File(filesDir, "models/qwen2.5-1.5b-mnn")
                aiService = if (mnnModelDir.exists() && File(mnnModelDir, "config.json").exists()) {
                    val svc = AiService(this, mnnModelDir, shmFile!!, maxTokens = 256)
                    if (svc.start(diag)) {
                        diag.appendText("原生 AI 服务(MNN)已启动\n")
                        svc
                    } else {
                        diag.appendText("原生 AI 服务启动失败\n")
                        null
                    }
                } else {
                    // 模型缺失：首次启动自动下载（联网即可，无需用户手动操作）
                    diag.appendText("MNN 模型缺失，启动自动下载流程\n")
                    val ok = ensureModelProvisioned(diag)
                    if (ok) {
                        val svc = AiService(this, mnnModelDir, shmFile!!, maxTokens = 256)
                        if (svc.start(diag)) {
                            diag.appendText("模型下载完成，原生 AI 服务(MNN)已启动\n")
                            svc
                        } else {
                            diag.appendText("原生 AI 服务启动失败\n")
                            null
                        }
                    } else {
                        diag.appendText("模型未就绪：${modelDownloadError ?: "未知原因"}\n")
                        null
                    }
                }

                // 解压 rootfs
                rootfsDir = File(filesDir, "rootfs")
                if (!File(rootfsDir, "bin").exists()) {
                    Log.i(TAG, "首次启动：解压 rootfs ...")
                    extractRootfs(rootfsDir!!)
                }
                diag.appendText("rootfs ready\n")
                containerReady = true  // rootfs 就绪，可执行容器命令

                val proot = nativeProot()

                // 启动容器（后台验证）
                val exit = startContainer(rootfsDir!!, proot, shmFile!!, diag)
                Log.i(TAG, "proot 已退出，exit=$exit")
                diag.appendText("proot exit=$exit\n")

                // 注意：不停止 AI 服务，让它常驻供界面调用
                // aiService?.stop()  ← 移除，AI 服务需要常驻
                // channel.close()  ← 移除，共享内存通道保持打开
            } catch (t: Throwable) {
                Log.e(TAG, "容器启动失败", t)
                try {
                    File(filesDir, "fatal.txt").writeText(
                        "$t\n" + t.stackTrace.joinToString("\n") { "  at $it" }
                    )
                } catch (ignore: Throwable) {}
            }
        }.apply {
            name = "proot-container"
            start()
        }
    }

    /** 解压 rootfs */
    private fun extractRootfs(rootfs: File) {
        val cache = File(cacheDir, ROOTFS_ASSET)
        assets.open(ROOTFS_ASSET).use { input ->
            cache.outputStream().use { out -> input.copyTo(out) }
        }
        try {
            val isGzip = FileInputStream(cache).use { ins ->
                val magic = ByteArray(2)
                ins.read(magic) == 2 && magic[0] == 0x1f.toByte() && magic[1] == 0x8b.toByte()
            }
            if (isGzip) {
                TarExtractor.extractTarGz(cache, rootfs)
            } else {
                FileInputStream(cache).use { ins -> TarExtractor.extractTar(ins, rootfs) }
            }
        } catch (t: Throwable) {
            rootfs.deleteRecursively()
            throw t
        } finally {
            cache.delete()
        }
    }

    /** 定位 proot 二进制 */
    private fun nativeProot(): File {
        val proot = File(applicationInfo.nativeLibraryDir, "lib__bin__proot-classic__.so")
        if (!proot.exists() || proot.length() == 0L) {
            throw IllegalStateException("nativeLibraryDir 中缺少 proot: $proot")
        }
        return proot
    }

    /** 启动容器验证 */
    private fun startContainer(rootfs: File, proot: File, shmFile: File, diag: File): Int {
        val logFile = File(filesDir, "proot.log")
        val nativeDir = applicationInfo.nativeLibraryDir
        val shmDir = shmFile.parentFile!!

        // 容器只负责验证 rootfs / 模块可执行，不再在里面起 HTTP 服务。
        // HTTP 由 App 内的 LocalHttpServer 提供（见 startHttpApi），
        // 避免 proot 卡死时端口 LISTEN 却不响应，也避免两套服务抢 9999。
        val guestCommand =
            "echo '=== 奇点OS 容器启动完成 ===' > /container_result.txt; " +
            "echo '系统模块:' >> /container_result.txt; " +
            "ls /系统 >> /container_result.txt 2>&1; " +
            "echo 'AI模块:' >> /container_result.txt; " +
            "ls /AI.qd >> /container_result.txt 2>&1; " +
            "echo '== container ready ==' >> /container_result.txt"

        val argv = listOf(
            proot.absolutePath,
            "--link2symlink", "-0",
            "-r", rootfs.absolutePath,
            "-b", "/dev", "-b", "/proc", "-b", "/sys",
            "-b", "${shmDir.absolutePath}:/shm",
            "-w", "/",
            "/bin/sh", "-c", guestCommand
        )

        val loader = File(nativeDir, "libproot-loader-aarch64-5.1.107-92.so")
        val loader32 = File(nativeDir, "libproot-loader32-aarch64-5.1.107-92.so")
        val tmpDir = File(filesDir, "proot_tmp").apply { mkdirs() }

        val env = mutableMapOf(
            "PATH" to "/system/bin:/system/xbin:/bin:/usr/bin",
            "LD_LIBRARY_PATH" to nativeDir,
            "PROOT_LOADER" to loader.absolutePath,
            "PROOT_LOADER_32" to loader32.absolutePath,
            "PROOT_TMP_DIR" to tmpDir.absolutePath,
            "HOME" to "/root",
            "LANG" to "C.UTF-8",
            "TMPDIR" to tmpDir.absolutePath
        )

        return try {
            val process = ProcessBuilder(argv)
                .redirectErrorStream(true)
                .redirectOutput(logFile)
                .apply { environment().putAll(env) }
                .start()
            process.waitFor()
        } catch (t: Throwable) {
            diag.appendText("EXCEPTION: $t\n")
            throw t
        }
    }

    /** 运行时权限请求结果 */
    private val permissionResults = mutableMapOf<String, Boolean>()

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        permissions.forEachIndexed { index, perm ->
            permissionResults[perm] = grantResults[index] == PackageManager.PERMISSION_GRANTED
            Log.i(TAG, "权限结果: $perm = ${grantResults[index] == PackageManager.PERMISSION_GRANTED}")
        }
    }

    /** 请求运行时权限（供 JS 接口调用） */
    fun requestPermission(type: String): String {
        val permission = when (type) {
            "location" -> android.Manifest.permission.ACCESS_FINE_LOCATION
            "microphone" -> android.Manifest.permission.RECORD_AUDIO
            "camera" -> android.Manifest.permission.CAMERA
            else -> return "未知权限类型: $type"
        }

        // 检查是否已经授权
        if (checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) {
            return "已授权: $type"
        }

        // 请求权限（异步，系统弹窗）
        requestPermissions(arrayOf(permission), 1001)
        return "已弹出权限请求，请在系统对话框中选择"
    }

    /** 在容器内执行命令，返回输出 */
    fun execInContainer(cmd: String): String {
        val rootfs = rootfsDir ?: return "[容器未启动]"
        val shm = shmFile ?: return "[共享内存未初始化]"
        val nativeDir = applicationInfo.nativeLibraryDir
        val shmDir = shm.parentFile!!
        val proot = nativeProot()
        val loader = File(nativeDir, "libproot-loader-aarch64-5.1.107-92.so")
        val loader32 = File(nativeDir, "libproot-loader32-aarch64-5.1.107-92.so")
        val tmpDir = File(filesDir, "proot_tmp").apply { mkdirs() }

        val env = mutableMapOf(
            "PATH" to "/system/bin:/system/xbin:/bin:/usr/bin",
            "LD_LIBRARY_PATH" to nativeDir,
            "PROOT_LOADER" to loader.absolutePath,
            "PROOT_LOADER_32" to loader32.absolutePath,
            "PROOT_TMP_DIR" to tmpDir.absolutePath,
            "HOME" to "/root",
            "LANG" to "C.UTF-8",
            "TMPDIR" to tmpDir.absolutePath
        )

        val argv = listOf(
            proot.absolutePath,
            "--link2symlink", "-0",
            "-r", rootfs.absolutePath,
            "-b", "/dev", "-b", "/proc", "-b", "/sys",
            "-b", "${shmDir.absolutePath}:/shm",
            "-w", "/",
            "/bin/sh", "-c", cmd
        )

        return try {
            val process = ProcessBuilder(argv)
                .apply { environment().putAll(env) }
                .start()
            val output = process.inputStream.bufferedReader().readText()
            process.waitFor()
            output.trim()
        } catch (t: Throwable) {
            "[执行失败] ${t.message}"
        }
    }

    /** JS 接口 */
    class QidianJSInterface(private val activity: MainActivity) {

        @JavascriptInterface
        fun getStatus(): String {
            val aiReady = MainActivity.aiService != null
            val container = MainActivity.containerReady
            val http = MainActivity.localHttp?.isListening() == true
            return "{\"container\":$container,\"ai\":$aiReady,\"microsrv\":$http,\"http\":$http}"
        }

        /** 给界面展示"怎么调用 API"用：返回监听状态、局域网地址与 API key。 */
        @JavascriptInterface
        fun getHttpInfo(): String {
            val s = MainActivity.localHttp
            val listening = s?.isListening() == true
            val port = s?.boundHttpPort ?: -1
            val lan = if (listening) s!!.lanAddress() else ""
            val key = if (listening) s!!.apiKey() else ""
            val ai = MainActivity.aiService != null
            val uptime = s?.uptimeSec() ?: 0L
            val chats = s?.chatCount() ?: 0L
            return "{\"listening\":$listening,\"port\":$port,\"lan\":\"$lan\",\"ai\":$ai,\"uptime\":$uptime,\"chats\":$chats,\"apiKey\":\"$key\"}"
        }

        @JavascriptInterface
        fun requestPermission(type: String): String {
            return activity.requestPermission(type)
        }

        @JavascriptInterface
        fun checkPermission(type: String): String {
            val permission = when (type) {
                "location" -> android.Manifest.permission.ACCESS_FINE_LOCATION
                "microphone" -> android.Manifest.permission.RECORD_AUDIO
                "camera" -> android.Manifest.permission.CAMERA
                else -> return "未知权限类型"
            }
            val granted = activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
            return if (granted) "已授权" else "未授权"
        }

        @JavascriptInterface
        fun checkModelExists(): String {
            val modelDir = java.io.File(activity.filesDir, "models/qwen2.5-1.5b-mnn")
            val weightFile = java.io.File(modelDir, "llm.mnn.weight")
            val configFile = java.io.File(modelDir, "config.json")
            val exists = weightFile.exists() && configFile.exists()
            val sizeMB = if (weightFile.exists()) weightFile.length() / 1024 / 1024 else 0
            return "{\"exists\":$exists,\"sizeMB\":$sizeMB,\"path\":\"${modelDir.absolutePath}\"}"
        }

        /** 模型下载状态快照（供 UI 展示进度） */
        @JavascriptInterface
        fun getModelDownloadState(): String {
            val pct = if (MainActivity.modelDownloadTotalBytes > 0)
                (MainActivity.modelDownloadedBytes * 100 / MainActivity.modelDownloadTotalBytes).toInt()
            else 0
            return "{\"state\":\"${MainActivity.modelDownloadState}\"," +
                "\"downloaded\":${MainActivity.modelDownloadedBytes}," +
                "\"total\":${MainActivity.modelDownloadTotalBytes}," +
                "\"speed\":${MainActivity.modelDownloadSpeed}," +
                "\"percent\":$pct," +
                "\"file\":\"${MainActivity.modelDownloadFile.replace("'", "")}\"," +
                "\"error\":${MainActivity.modelDownloadError?.let { "\"" + it.replace("\"", "").replace("'", "") + "\"" } ?: "null"}}"
        }

        /** 手动触发模型下载（UI 的「重试下载」按钮） */
        @JavascriptInterface
        fun startModelDownload() {
            activity.runOnUiThread {
                MainActivity.modelDownloadError = null
                MainActivity.modelDownloadState = "checking"
                activity.notifyModelProgress()
                Thread {
                    activity.ensureModelProvisioned(File(activity.filesDir, "diag.txt"))
                }.apply { name = "model-provision"; start() }
            }
        }

        /** 取消下载 */
        @JavascriptInterface
        fun cancelModelDownload() {
            MainActivity.modelProvision?.cancel()
        }

        /** 环境自检结果：null 表示通过，否则返回给用户看的说明 */
        @JavascriptInterface
        fun checkEnvironment(): String {
            return try {
                val raw = activity.assets.open("model_manifest.json").use { it.readBytes().toString(Charsets.UTF_8) }
                val manifest = ModelProvisioner.loadManifest(raw)
                val modelDir = java.io.File(activity.filesDir, "models/${manifest.name}")
                val err = ModelProvisioner(modelDir, manifest) {}.preflight()
                if (err == null) "{\"ok\":true,\"error\":null}"
                else "{\"ok\":false,\"error\":\"$err\"}"
            } catch (t: Throwable) {
                "{\"ok\":false,\"error\":\"自检异常: ${t.message}\"}"
            }
        }

        @JavascriptInterface
        fun openExternalUrl(url: String) {
            try {
                val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))
                activity.startActivity(intent)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        @JavascriptInterface
        fun setOrientation(orientation: String) {
            activity.runOnUiThread {
                try {
                    val prefs = activity.getSharedPreferences("settings", MODE_PRIVATE)
                    prefs.edit().putString("orientation", orientation).apply()
                    if (orientation == "portrait") {
                        activity.requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                        Log.i(TAG, "切换竖屏")
                    } else {
                        activity.requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                        Log.i(TAG, "切换横屏")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "切换屏幕方向失败", e)
                }
            }
        }

        /**
         * 界面显示方向的唯一数据源：mode=设置的值，actual=系统当前真实方向。
         * 两者可能短暂不一致（切换后 Activity 正在重建），一致后自动对齐。
         */
        @JavascriptInterface
        fun getOrientation(): String {
            val prefs = activity.getSharedPreferences("settings", MODE_PRIVATE)
            val mode = prefs.getString("orientation", "landscape") ?: "landscape"
            val actual = if (activity.resources.configuration.orientation ==
                android.content.res.Configuration.ORIENTATION_PORTRAIT
            ) "portrait" else "landscape"
            return "{\"mode\":\"$mode\",\"actual\":\"$actual\"}"
        }

        @JavascriptInterface
        fun saveChatFile(content: String) {
            try {
                val file = java.io.File(activity.filesDir, "chat_history.json")
                file.writeText(content, Charsets.UTF_8)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        @JavascriptInterface
        fun loadChatFile(): String {
            return try {
                val file = java.io.File(activity.filesDir, "chat_history.json")
                if (file.exists()) file.readText(Charsets.UTF_8) else "[]"
            } catch (e: Exception) {
                "[]"
            }
        }

        @JavascriptInterface
        fun execContainer(cmd: String): String {
            return activity.execInContainer(cmd)
        }

        @JavascriptInterface
        fun callAI(prompt: String): String {
            return try {
                val svc = MainActivity.aiService
                if (svc != null) {
                    Log.i(TAG, "AI 推理调用，prompt 长度=${prompt.length}")
                    val result = svc.inferSync(prompt)
                    Log.i(TAG, "AI 推理完成，结果长度=${result?.length ?: 0}")
                    result ?: "[AI 空回复]"
                } else {
                    Log.w(TAG, "AI 服务未就绪，aiService=null")
                    "[AI 正在加载中，请稍候再试...]"
                }
            } catch (e: Exception) {
                Log.e(TAG, "AI 调用失败", e)
                "[AI 调用失败] ${e.message}"
            }
        }

        @JavascriptInterface
        fun callCloudAI(baseUrl: String, apiKey: String, model: String, prompt: String): String {
            return try {
                Log.i(TAG, "云端 API 调用: baseUrl=$baseUrl model=$model")
                val url = java.net.URL("${baseUrl.trimEnd('/')}/chat/completions")
                val conn = url.openConnection() as java.net.HttpURLConnection
                conn.requestMethod = "POST"
                conn.connectTimeout = 30000
                conn.readTimeout = 60000
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Authorization", "Bearer $apiKey")

                // 构建请求体（简化为单轮对话）
                val body = """{
                    "model": "$model",
                    "messages": [{"role": "user", "content": ${org.json.JSONObject.quote(prompt)}}],
                    "max_tokens": 1024,
                    "temperature": 0.7
                }"""
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }

                val responseCode = conn.responseCode
                val responseBody = if (responseCode == 200) {
                    conn.inputStream.bufferedReader().use { it.readText() }
                } else {
                    conn.errorStream?.bufferedReader()?.use { it.readText() } ?: "HTTP $responseCode"
                }
                Log.i(TAG, "云端 API 响应: code=$responseCode length=${responseBody.length}")

                // 解析 OpenAI 兼容格式
                val json = org.json.JSONObject(responseBody)
                val choices = json.getJSONArray("choices")
                if (choices.length() > 0) {
                    choices.getJSONObject(0).getJSONObject("message").getString("content")
                } else {
                    "[云端 API 无回复] $responseBody"
                }
            } catch (e: Exception) {
                Log.e(TAG, "云端 API 调用失败", e)
                "[云端 API 调用失败] ${e.message}"
            }
        }

        @JavascriptInterface
        fun launchApp(packageName: String): String {
            return try {
                val intent = activity.packageManager.getLaunchIntentForPackage(packageName)
                if (intent != null) {
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    activity.startActivity(intent)
                    "已启动: $packageName"
                } else {
                    "未找到应用: $packageName"
                }
            } catch (e: Exception) {
                "启动失败: ${e.message}"
            }
        }

        @JavascriptInterface
        fun readUIFile(name: String): String {
            return try {
                val file = File(activity.filesDir, "ui/$name")
                if (file.exists()) file.readText() else ""
            } catch (e: Exception) {
                ""
            }
        }

        @JavascriptInterface
        fun writeUIFile(name: String, content: String) {
            try {
                val uiDir = File(activity.filesDir, "ui")
                uiDir.mkdirs()
                // 安全检查：防止路径穿越
                val safeName = name.replace("..", "").trimStart('/')
                val file = File(uiDir, safeName)
                file.parentFile?.mkdirs()
                file.writeText(content)
                Log.i(TAG, "写入界面文件: $safeName (${content.length} bytes)")
            } catch (e: Exception) {
                Log.e(TAG, "写入界面文件失败: $name", e)
            }
        }

        @JavascriptInterface
        fun reloadUI() {
            activity.runOnUiThread {
                activity.webView.reload()
            }
        }

        @JavascriptInterface
        fun resetUI() {
            try {
                val uiDir = File(activity.filesDir, "ui")
                // 备份当前界面
                val backupDir = File(uiDir, "backups/manual_reset_${System.currentTimeMillis()}")
                backupDir.mkdirs()
                listOf("index.html", "style.css", "app.js").forEach { name ->
                    val f = File(uiDir, name)
                    if (f.exists()) f.copyTo(File(backupDir, name))
                }
                // 重新从 assets 复制
                listOf("index.html", "style.css", "app.js").forEach { name ->
                    activity.assets.open("ui/$name").use { input ->
                        File(uiDir, name).outputStream().use { out -> input.copyTo(out) }
                    }
                }
                activity.runOnUiThread {
                    activity.webView.reload()
                }
            } catch (e: Exception) {
                Log.e(TAG, "恢复默认界面失败", e)
            }
        }

        @JavascriptInterface
        fun getSystemInfo(): String {
            return try {
                val sb = StringBuilder()
                sb.appendLine("容器状态: ${if (MainActivity.rootfsDir?.exists() == true) "运行中" else "未启动"}")
                sb.appendLine("AI 引擎: ${if (MainActivity.aiService != null) "MNN (Qwen2.5-1.5B)" else "未就绪"}")
                sb.appendLine("模型路径: ${activity.filesDir}/models/qwen2.5-1.5b-mnn")
                sb.toString()
            } catch (e: Exception) {
                "获取系统信息失败"
            }
        }

        // ========== 投屏/远程控制 ==========

        @JavascriptInterface
        fun requestCastPermission(): String {
            // 请求 MediaProjection 权限
            return try {
                val mpm = activity.getSystemService(android.content.Context.MEDIA_PROJECTION_SERVICE) as android.media.projection.MediaProjectionManager
                val intent = mpm.createScreenCaptureIntent()
                activity.startActivityForResult(intent, 1001)
                "正在请求投屏权限..."
            } catch (e: Exception) {
                "请求投屏权限失败: ${e.message}"
            }
        }

        @JavascriptInterface
        fun startCast(port: Int): String {
            return try {
                if (castResultCodeGlobal == 0 || castDataGlobal == null) {
                    return "请先请求投屏权限"
                }
                val intent = Intent(activity, RemoteCastService::class.java)
                intent.putExtra("action", "start")
                intent.putExtra("port", port)
                intent.putExtra("resultCode", castResultCodeGlobal)
                intent.putExtra("data", castDataGlobal)
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    activity.startForegroundService(intent)
                } else {
                    activity.startService(intent)
                }
                val ip = getDeviceIP()
                "投屏已启动: http://$ip:$port"
            } catch (e: Exception) {
                "启动投屏失败: ${e.message}"
            }
        }

        @JavascriptInterface
        fun stopCast(): String {
            return try {
                val intent = Intent(activity, RemoteCastService::class.java)
                intent.putExtra("action", "stop")
                activity.startService(intent)
                "投屏已停止"
            } catch (e: Exception) {
                "停止投屏失败: ${e.message}"
            }
        }

        @JavascriptInterface
        fun getCastStatus(): String {
            return try {
                val ip = getDeviceIP()
                "{\"ip\":\"$ip\",\"port\":8080,\"status\":\"ready\"}"
            } catch (e: Exception) {
                "{\"error\":\"${e.message}\"}"
            }
        }

        @JavascriptInterface
        fun getDeviceIP(): String {
            return try {
                val interfaces = java.net.NetworkInterface.getNetworkInterfaces()
                while (interfaces.hasMoreElements()) {
                    val iface = interfaces.nextElement()
                    if (iface.isLoopback || !iface.isUp) continue
                    val addresses = iface.inetAddresses
                    while (addresses.hasMoreElements()) {
                        val addr = addresses.nextElement()
                        if (!addr.isLoopbackAddress && addr is java.net.Inet4Address) {
                            return addr.hostAddress
                        }
                    }
                }
                "127.0.0.1"
            } catch (e: Exception) {
                "127.0.0.1"
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 1001 && resultCode == RESULT_OK && data != null) {
            // 保存 MediaProjection 授权结果
            val jsInterface = webView?.let {
                // 通过反射获取已添加的 JS 接口
                null
            }
            // 直接保存到 companion object
            castResultCodeGlobal = resultCode
            castDataGlobal = data
            Log.i(TAG, "投屏权限已授权")
            webView.evaluateJavascript("if(typeof onCastPermissionGranted==='function')onCastPermissionGranted();", null)
        }
    }

    override fun onBackPressed() {
        // 先检查 JS 页面栈是否有可返回的页面
        webView.evaluateJavascript("(typeof pageHistory !== 'undefined' && pageHistory.length > 0)") { result ->
            if (result == "true") {
                // JS 页面有上一页，返回
                webView.evaluateJavascript("goBack()", null)
            } else if (webView.canGoBack()) {
                webView.goBack()
            } else {
                super.onBackPressed()
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        webView.destroy()
    }
}
