package com.qidian.minios

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log

/**
 * 常驻前台服务 —— 让本进程始终处于 foreground 状态。
 *
 * 为什么必须有它：
 *   Android 12+ 的 cached app freezer 会冻结所有「无前台组件」的后台进程。
 *   被冻结时 proot 的 fork/exec 直接卡死，容器起不来、microsrv 停摆。
 *   实测（vivo V2303A / Android 16）：熄屏后 diag.txt 停在 "rootfs ready"，
 *   proot 进程根本创建不出来；一回到前台，proot + microsrv 立刻出现。
 *   持有前台服务后进程不再进入 cached 分组，熄屏也能继续跑。
 *
 * 配合 PARTIAL_WAKE_LOCK：熄屏时 CPU 不挂起，容器与 HTTP 服务持续可用。
 * START_STICKY：被系统因内存压力杀掉后，系统会自动重建本服务。
 */
class KeepAliveService : Service() {

    companion object {
        private const val TAG = "QdKeepAlive"
        private const val CHANNEL_ID = "qd_keepalive"
        private const val NOTI_ID = 1001
        const val ACTION_START = "com.qidian.minios.KEEPALIVE_START"
        const val ACTION_STOP = "com.qidian.minios.KEEPALIVE_STOP"

        @Volatile
        var running = false
            private set

        fun start(ctx: Context) {
            try {
                val i = Intent(ctx, KeepAliveService::class.java).setAction(ACTION_START)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(i)
                } else {
                    ctx.startService(i)
                }
            } catch (t: Throwable) {
                Log.e(TAG, "启动前台服务失败: ${t.message}", t)
            }
        }

        fun stop(ctx: Context) {
            try {
                ctx.startService(Intent(ctx, KeepAliveService::class.java).setAction(ACTION_STOP))
            } catch (ignore: Throwable) {
            }
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null

    /**
     * 静音音频流。
     *
     * 为什么还要这个：
     *   vivo/OriginOS 在熄屏后会强制 CPU 深度睡眠，并且把普通应用的
     *   PARTIAL_WAKE_LOCK 判定为无效（dumpsys power 里显示
     *   "DISABLED ... mIsFrozen"）。实测：熄屏 50s 后 HTTP 请求全部超时，
     *   一唤醒立刻恢复。
     *   但音频通路的 wakelock 由 AudioFlinger 持有，优先级高于普通应用，
     *   因此播放音频的进程熄屏后 CPU 不会被挂起（音乐播放器熄屏继续放歌即此原理）。
     *   这里持续写入极低幅度样本（±1 LSB），保证音频通路活跃、不产生可听声音。
     */
    private var audioTrack: AudioTrack? = null
    private var audioThread: Thread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            releaseWakeLock()
            stopSilentAudio()
            running = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
            stopSelf()
            return START_NOT_STICKY
        }

        try {
            val n = buildNotification()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTI_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            } else {
                startForeground(NOTI_ID, n)
            }
        } catch (t: Throwable) {
            Log.e(TAG, "startForeground 失败: ${t.message}", t)
        }

        acquireWakeLock()
        startSilentAudio()
        running = true
        Log.i(TAG, "前台服务运行中（进程不会被 freezer 冻结）")
        return START_STICKY
    }

    /** 启动静音音频流：让音频子系统持有唤醒锁，阻止熄屏后 CPU 深度睡眠 */
    private fun startSilentAudio() {
        if (audioTrack != null) return
        try {
            val sampleRate = 8000
            val minBuf = AudioTrack.getMinBufferSize(
                sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT
            )
            val bufSize = if (minBuf > 0) minBuf * 2 else 8192

            val track = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(sampleRate)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build()
                )
                .setBufferSizeInBytes(bufSize)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()

            track.setVolume(0f)
            track.play()
            audioTrack = track

            // ±1 LSB 的稀疏脉冲：幅度低于人耳阈值，但保证数据不是全零（避免被静音优化）
            val pattern = ByteArray(bufSize)
            var i = 0
            while (i + 1 < pattern.size) {
                val v = if ((i / 2) % 400 == 0) 1 else 0
                pattern[i] = (v and 0xFF).toByte()
                pattern[i + 1] = 0
                i += 2
            }

            audioThread = Thread {
                try {
                    while (!Thread.currentThread().isInterrupted) {
                        val t = audioTrack ?: break
                        if (t.playState != AudioTrack.PLAYSTATE_PLAYING) break
                        t.write(pattern, 0, pattern.size)
                    }
                } catch (ignore: Throwable) {
                }
            }.apply {
                isDaemon = true
                name = "qd-silent-audio"
                start()
            }
            Log.i(TAG, "静音音频已启动（音频通路持有唤醒锁）")
        } catch (t: Throwable) {
            Log.e(TAG, "静音音频启动失败: ${t.message}", t)
        }
    }

    private fun stopSilentAudio() {
        try {
            audioThread?.interrupt()
        } catch (ignore: Throwable) {
        }
        audioThread = null
        try {
            audioTrack?.let {
                it.pause()
                it.flush()
                it.stop()
                it.release()
            }
        } catch (ignore: Throwable) {
        }
        audioTrack = null
    }

    private fun acquireWakeLock() {
        try {
            val cur = wakeLock
            if (cur != null && cur.isHeld) return
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "qidian:keepalive").apply {
                setReferenceCounted(false)
                acquire()
            }
            Log.i(TAG, "已持有 PARTIAL_WAKE_LOCK")
        } catch (t: Throwable) {
            Log.e(TAG, "获取 WakeLock 失败: ${t.message}", t)
        }
    }

    private fun releaseWakeLock() {
        try {
            val cur = wakeLock
            if (cur != null && cur.isHeld) cur.release()
        } catch (ignore: Throwable) {
        }
        wakeLock = null
    }

    override fun onDestroy() {
        running = false
        stopSilentAudio()
        releaseWakeLock()
        Log.i(TAG, "前台服务已销毁")
        super.onDestroy()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val ch = NotificationChannel(
            CHANNEL_ID, "本地 AI 服务", NotificationManager.IMPORTANCE_MIN
        ).apply {
            description = "保持容器与本地推理服务常驻"
            setShowBadge(false)
        }
        nm.createNotificationChannel(ch)
    }

    private fun buildNotification(): Notification {
        val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pi = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            piFlags
        )

        val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        return b.setContentTitle("起点OS mini 运行中")
            .setContentText("容器与本地 AI 服务常驻，可被局域网调用")
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentIntent(pi)
            .setOngoing(true)
            .setPriority(Notification.PRIORITY_MIN)
            .build()
    }
}
