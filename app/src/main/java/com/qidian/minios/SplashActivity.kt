package com.qidian.minios

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.VideoView

/**
 * 奇点OS 开机动画（Splash）。
 *
 * 视频居中显示，保持原始宽高比，背景纯黑。
 * 播放完成后自动跳转到 MainActivity。
 * 播放失败或超时（5秒）后也自动跳转，保证不阻塞启动。
 */
class SplashActivity : Activity() {

    private lateinit var videoView: VideoView
    private var finished = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 全屏沉浸式 + 纯黑背景
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        )
        window.decorView.setBackgroundColor(Color.BLACK)

        // 根布局：纯黑背景
        val root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)

        // VideoView 居中，保持原始宽高比
        videoView = VideoView(this)
        val params = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        )
        params.gravity = Gravity.CENTER
        videoView.layoutParams = params

        root.addView(videoView)
        setContentView(root)

        // 把视频从 assets 复制到 filesDir（VideoView 不直接支持 assets）
        val videoFile = java.io.File(filesDir, "boot_animation.mp4")
        if (!videoFile.exists()) {
            try {
                assets.open("boot_animation.mp4").use { input ->
                    videoFile.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }
            } catch (e: Exception) {
                goToMain()
                return
            }
        }

        try {
            videoView.setVideoPath(videoFile.absolutePath)
            videoView.setOnCompletionListener { goToMain() }
            videoView.setOnErrorListener { _, _, _ ->
                goToMain()
                true
            }
            videoView.start()
        } catch (e: Exception) {
            goToMain()
        }

        // 超时保护：15秒后强制进入主界面（新动画较长）
        videoView.postDelayed({ goToMain() }, 15000)
    }

    private fun goToMain() {
        if (finished) return
        finished = true
        try { videoView.stopPlayback() } catch (_: Exception) {}
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        try { videoView.stopPlayback() } catch (_: Exception) {}
    }
}
