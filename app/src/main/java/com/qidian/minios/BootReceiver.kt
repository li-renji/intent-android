package com.qidian.minios

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * 开机自启：手机重启后把常驻服务拉起来。
 *
 * BOOT_COMPLETED 属于 Android 12+「后台启动前台服务」限制的豁免场景，
 * 所以在收到广播时直接 startForegroundService 不会被系统拦截。
 *
 * 注意：vivo/OPPO 等 ROM 还需要用户在系统设置里允许「自启动」，
 * 否则系统不会把这条广播投递过来。
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_LOCKED_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            return
        }

        Log.i("QdBoot", "收到 $action，启动常驻服务")

        // 1. 先启前台服务，保证进程进入 foreground 状态
        KeepAliveService.start(context)

        // 2. 尝试拉起界面（容器由 MainActivity.onCreate 启动）。
        //    Android 10+ 限制后台启动 Activity，这里可能被拦；
        //    被拦时用户点一下通知或桌面图标即可，服务仍在后台保活。
        try {
            val i = Intent(context, MainActivity::class.java).apply {
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
                )
            }
            context.startActivity(i)
            Log.i("QdBoot", "已尝试拉起 MainActivity")
        } catch (t: Throwable) {
            Log.w("QdBoot", "后台拉起界面被系统拦截（正常），服务仍在运行: ${t.message}")
        }
    }
}
