package com.qidian.minios

import android.app.Service
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * 远程投屏与控制服务
 * 提供：屏幕投射（MJPEG over HTTP）、远程控制（WebSocket输入）
 * 其他设备通过浏览器访问 http://<手机IP>:<端口> 即可查看和控制
 */
class RemoteCastService : Service() {

    companion object {
        private const val TAG = "RemoteCast"
        private const val DEFAULT_PORT = 8080
        private const val SCREEN_WIDTH = 1280
        private const val SCREEN_HEIGHT = 720
        private const val FPS = 30
        private const val JPEG_QUALITY = 60

        // 控制页面 HTML
        private val CONTROL_PAGE = """
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>奇点OS 远程控制</title>
<style>
body{margin:0;background:#1a1a2e;color:#fff;font-family:system-ui;display:flex;flex-direction:column;align-items:center;min-height:100vh}
.header{padding:12px;background:#16213e;width:100%;text-align:center}
.header h1{margin:0;font-size:18px;color:#4a9eff}
.status{padding:8px;font-size:13px;color:#8892a4}
.screen-container{position:relative;margin:16px;border:2px solid #2a3a5c;border-radius:8px;overflow:hidden;background:#000}
.screen-container img{display:block;max-width:100%;cursor:crosshair}
.controls{display:flex;gap:8px;margin:12px;flex-wrap:wrap;justify-content:center}
.controls button{padding:10px 20px;border:none;border-radius:6px;background:#2a6db5;color:#fff;cursor:pointer;font-size:14px}
.controls button:hover{background:#3a7dc5}
.controls button:active{background:#1a5da5}
.info{padding:12px;font-size:12px;color:#666;text-align:center}
</style>
</head>
<body>
<div class="header"><h1>奇点OS 远程控制</h1></div>
<div class="status" id="status">连接中...</div>
<div class="screen-container" id="screenContainer">
    <img id="screen" src="/stream.mjpg" alt="屏幕">
</div>
<div class="controls">
    <button onclick="sendKey('home')">主页</button>
    <button onclick="sendKey('back')">返回</button>
    <button onclick="sendKey('recent')">多任务</button>
    <button onclick="sendKey('volume_up')">音量+</button>
    <button onclick="sendKey('volume_down')">音量-</button>
    <button onclick="sendKey('power')">电源</button>
</div>
<div class="info">点击屏幕可模拟触摸，按钮可模拟系统按键</div>
<script>
const screen = document.getElementById('screen');
const container = document.getElementById('screenContainer');
const status = document.getElementById('status');
let ws = null;

function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/ws');
    ws.onopen = () => { status.textContent = '已连接 - 可触摸控制'; status.style.color = '#4caf50'; };
    ws.onclose = () => { status.textContent = '连接断开，重连中...'; status.style.color = '#f44336'; setTimeout(connectWS, 2000); };
    ws.onerror = () => { status.textContent = '连接错误'; status.style.color = '#f44336'; };
}
connectWS();

function getPos(e) {
    const rect = screen.getBoundingClientRect();
    const scaleX = SCREEN_WIDTH / rect.width;
    const scaleY = SCREEN_HEIGHT / rect.height;
    const touch = e.touches ? e.touches[0] : e;
    return {
        x: Math.round((touch.clientX - rect.left) * scaleX),
        y: Math.round((touch.clientY - rect.top) * scaleY)
    };
}

screen.addEventListener('mousedown', e => { const p = getPos(e); ws.send(JSON.stringify({type:'touch',action:'down',x:p.x,y:p.y})); });
screen.addEventListener('mousemove', e => { if(e.buttons===1){ const p=getPos(e); ws.send(JSON.stringify({type:'touch',action:'move',x:p.x,y:p.y})); } });
screen.addEventListener('mouseup', e => { const p = getPos(e); ws.send(JSON.stringify({type:'touch',action:'up',x:p.x,y:p.y})); });
screen.addEventListener('touchstart', e => { e.preventDefault(); const p=getPos(e); ws.send(JSON.stringify({type:'touch',action:'down',x:p.x,y:p.y})); }, {passive:false});
screen.addEventListener('touchmove', e => { e.preventDefault(); const p=getPos(e); ws.send(JSON.stringify({type:'touch',action:'move',x:p.x,y:p.y})); }, {passive:false});
screen.addEventListener('touchend', e => { e.preventDefault(); const p=getPos(e); ws.send(JSON.stringify({type:'touch',action:'up',x:p.x,y:p.y})); }, {passive:false});

function sendKey(key) { if(ws && ws.readyState===1) ws.send(JSON.stringify({type:'key',key:key})); }
</script>
</body>
</html>
        """.trimIndent()
    }

    private var serverSocket: ServerSocket? = null
    private var isRunning = AtomicBoolean(false)
    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var latestFrame: ByteArray? = null
    private val frameLock = Any()
    private val clients = ConcurrentHashMap<Socket, OutputStream>()
    private var port = DEFAULT_PORT

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.getStringExtra("action")
        val resultCode = intent?.getIntExtra("resultCode", 0)
        val data = intent?.getParcelableExtra<Intent>("data")
        port = intent?.getIntExtra("port", DEFAULT_PORT) ?: DEFAULT_PORT

        when (action) {
            "start" -> {
                if (resultCode != null && resultCode != 0 && data != null) {
                    startProjection(resultCode, data)
                }
                startServer()
            }
            "stop" -> stopService()
        }
        return START_STICKY
    }

    private fun startProjection(resultCode: Int, data: Intent) {
        try {
            val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            mediaProjection = mpm.getMediaProjection(resultCode, data)

            imageReader = ImageReader.newInstance(
                SCREEN_WIDTH, SCREEN_HEIGHT, PixelFormat.RGBA_8888, 2
            )

            imageReader?.setOnImageAvailableListener({ reader ->
                val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
                try {
                    val planes = image.planes
                    val buffer: ByteBuffer = planes[0].buffer
                    val pixelStride = planes[0].pixelStride
                    val rowStride = planes[0].rowStride
                    val rowPadding = rowStride - pixelStride * SCREEN_WIDTH

                    val bitmap = Bitmap.createBitmap(
                        SCREEN_WIDTH + rowPadding / pixelStride,
                        SCREEN_HEIGHT, Bitmap.Config.ARGB_8888
                    )
                    bitmap.copyPixelsFromBuffer(buffer)

                    val cropped = Bitmap.createBitmap(bitmap, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT)
                    val stream = ByteArrayOutputStream()
                    cropped.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, stream)
                    synchronized(frameLock) {
                        latestFrame = stream.toByteArray()
                    }
                    bitmap.recycle()
                    cropped.recycle()
                } catch (e: Exception) {
                    Log.e(TAG, "截图错误: ${e.message}")
                } finally {
                    image.close()
                }
            }, null)

            virtualDisplay = mediaProjection?.createVirtualDisplay(
                "奇点OS投屏",
                SCREEN_WIDTH, SCREEN_HEIGHT, resources.displayMetrics.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader?.surface, null, null
            )
            Log.i(TAG, "屏幕投射已启动: ${SCREEN_WIDTH}x${SCREEN_HEIGHT}")
        } catch (e: Exception) {
            Log.e(TAG, "启动投射失败: ${e.message}")
        }
    }

    private fun startServer() {
        if (isRunning.get()) return
        isRunning.set(true)
        thread {
            try {
                serverSocket = ServerSocket(port)
                Log.i(TAG, "HTTP服务器已启动: 端口 $port")
                while (isRunning.get()) {
                    try {
                        val client = serverSocket?.accept() ?: continue
                        thread { handleClient(client) }
                    } catch (e: Exception) {
                        if (isRunning.get()) Log.e(TAG, "接受连接错误: ${e.message}")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "服务器错误: ${e.message}")
            }
        }
    }

    private fun handleClient(client: Socket) {
        try {
            val input = client.getInputStream()
            val output = client.getOutputStream()
            val buffer = ByteArray(8192)
            val n = input.read(buffer)
            if (n <= 0) { client.close(); return }

            val request = String(buffer, 0, n)
            val firstLine = request.substringBefore("\r\n")
            val path = firstLine.split(" ")[1]

            when {
                path == "/" || path == "/index.html" -> {
                    val body = CONTROL_PAGE.toByteArray(Charsets.UTF_8)
                    output.write("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray())
                    output.write(body)
                    output.flush()
                }
                path == "/stream.mjpg" -> {
                    output.write("HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=frame\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n".toByteArray())
                    output.flush()
                    clients[client] = output
                    // MJPEG 推送线程
                    thread {
                        try {
                            while (isRunning.get() && !client.isClosed) {
                                val frame = synchronized(frameLock) { latestFrame }
                                if (frame != null) {
                                    output.write("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.size}\r\n\r\n".toByteArray())
                                    output.write(frame)
                                    output.write("\r\n".toByteArray())
                                    output.flush()
                                }
                                Thread.sleep(1000 / FPS.toLong())
                            }
                        } catch (e: Exception) {
                            // 客户端断开
                        } finally {
                            clients.remove(client)
                            try { client.close() } catch (_: Exception) {}
                        }
                    }
                    return // 保持连接
                }
                path == "/ws" -> {
                    handleWebSocket(client, input, output, request)
                    return
                }
                path == "/status" -> {
                    val body = """{"status":"running","port":$port,"clients":${clients.size},"resolution":"${SCREEN_WIDTH}x${SCREEN_HEIGHT}","fps":$FPS}""".toByteArray()
                    output.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray())
                    output.write(body)
                    output.flush()
                }
                else -> {
                    output.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
                    output.flush()
                }
            }
            client.close()
        } catch (e: Exception) {
            try { client.close() } catch (_: Exception) {}
        }
    }

    private fun handleWebSocket(client: Socket, input: java.io.InputStream, output: OutputStream, request: String) {
        // 简单 WebSocket 握手
        val keyMatch = Regex("Sec-WebSocket-Key: (.*)").find(request)
        val key = keyMatch?.groupValues?.get(1)?.trim() ?: return
        val acceptKey = android.util.Base64.encodeToString(
            java.security.MessageDigest.getInstance("SHA-1")
                .digest("${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11".toByteArray()),
            android.util.Base64.NO_WRAP
        )
        output.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: $acceptKey\r\n\r\n".toByteArray())
        output.flush()

        // 读取 WebSocket 帧并处理输入事件
        thread {
            try {
                while (isRunning.get() && !client.isClosed) {
                    val header = ByteArray(2)
                    if (input.read(header) != 2) break
                    val opcode = header[0].toInt() and 0x0F
                    val masked = header[1].toInt() and 0x80 != 0
                    var payloadLen = header[1].toInt() and 0x7F

                    if (payloadLen == 126) {
                        val ext = ByteArray(2)
                        input.read(ext)
                        payloadLen = ((ext[0].toInt() and 0xFF) shl 8) or (ext[1].toInt() and 0xFF)
                    } else if (payloadLen == 127) {
                        val ext = ByteArray(8)
                        input.read(ext)
                        payloadLen = 0 // 忽略大帧
                    }

                    val maskKey = if (masked) ByteArray(4) else null
                    if (masked) input.read(maskKey)

                    val payload = ByteArray(payloadLen)
                    var read = 0
                    while (read < payloadLen) {
                        val n = input.read(payload, read, payloadLen - read)
                        if (n <= 0) break
                        read += n
                    }
                    if (masked && maskKey != null) {
                        for (i in payload.indices) payload[i] = (payload[i].toInt() xor maskKey[i % 4].toInt()).toByte()
                    }

                    if (opcode == 0x1) { // 文本帧
                        val message = String(payload, Charsets.UTF_8)
                        handleInputMessage(message)
                    } else if (opcode == 0x8) { // 关闭
                        break
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "WebSocket错误: ${e.message}")
            } finally {
                try { client.close() } catch (_: Exception) {}
            }
        }
    }

    private fun handleInputMessage(message: String) {
        try {
            val json = org.json.JSONObject(message)
            when (json.getString("type")) {
                "touch" -> {
                    val action = json.getString("action")
                    val x = json.getInt("x")
                    val y = json.getInt("y")
                    injectTouch(action, x, y)
                }
                "key" -> {
                    val key = json.getString("key")
                    injectKey(key)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "处理输入消息错误: ${e.message}")
        }
    }

    private fun injectTouch(action: String, x: Int, y: Int) {
        // 通过 shell input 命令注入触摸事件（需要适当权限）
        try {
            when (action) {
                "down" -> Runtime.getRuntime().exec("input tap $x $y")
                "move" -> {} // 简化处理，move 事件可以用 swipe
                "up" -> {}
            }
        } catch (e: Exception) {
            Log.e(TAG, "注入触摸错误: ${e.message}")
        }
    }

    private fun injectKey(key: String) {
        try {
            val keyCode = when (key) {
                "home" -> "KEYCODE_HOME"
                "back" -> "KEYCODE_BACK"
                "recent" -> "KEYCODE_APP_SWITCH"
                "volume_up" -> "KEYCODE_VOLUME_UP"
                "volume_down" -> "KEYCODE_VOLUME_DOWN"
                "power" -> "KEYCODE_POWER"
                "enter" -> "KEYCODE_ENTER"
                else -> null
            }
            if (keyCode != null) {
                Runtime.getRuntime().exec("input keyevent $keyCode")
            }
        } catch (e: Exception) {
            Log.e(TAG, "注入按键错误: ${e.message}")
        }
    }

    private fun stopService() {
        isRunning.set(false)
        try { serverSocket?.close() } catch (_: Exception) {}
        try { virtualDisplay?.release() } catch (_: Exception) {}
        try { imageReader?.close() } catch (_: Exception) {}
        try { mediaProjection?.stop() } catch (_: Exception) {}
        clients.keys.forEach { try { it.close() } catch (_: Exception) {} }
        clients.clear()
        Log.i(TAG, "远程投屏服务已停止")
        stopSelf()
    }

    override fun onDestroy() {
        stopService()
        super.onDestroy()
    }
}
