package io.atomcli.live_updates

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

class AtomcliLiveUpdatesPlugin : FlutterPlugin, MethodChannel.MethodCallHandler {
    private lateinit var context: Context
    private lateinit var channel: MethodChannel

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        context = binding.applicationContext
        channel = MethodChannel(binding.binaryMessenger, CHANNEL_NAME)
        channel.setMethodCallHandler(this)
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel.setMethodCallHandler(null)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "show" -> show(call, result)
            "status" -> result.success(status())
            "openSettings" -> openSettings(result)
            "cancel" -> {
                manager().cancel(call.argument<Int>("notificationId") ?: NOTIFICATION_ID)
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    private fun status(): Map<String, Boolean> {
        val supported = Build.VERSION.SDK_INT >= 36
        return mapOf(
            "supported" to supported,
            "allowed" to (supported && manager().canPostPromotedNotifications()),
        )
    }

    private fun openSettings(result: MethodChannel.Result) {
        val intent = Intent(
            if (Build.VERSION.SDK_INT >= 36) Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS
            else Settings.ACTION_APP_NOTIFICATION_SETTINGS,
        ).apply {
            putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            data = Uri.parse("package:${context.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
            result.success(true)
        } catch (_: Exception) {
            val fallback = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                data = Uri.parse("package:${context.packageName}")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            try {
                context.startActivity(fallback)
                result.success(true)
            } catch (_: Exception) {
                result.success(false)
            }
        }
    }

    private fun show(call: MethodCall, result: MethodChannel.Result) {
        val id = call.argument<Int>("notificationId") ?: NOTIFICATION_ID
        val title = call.argument<String>("title")?.take(120) ?: context.getString(R.string.live_task_fallback_title)
        val text = call.argument<String>("text")?.take(500) ?: context.getString(R.string.live_task_fallback_text)
        val shortText = call.argument<String>("shortText")?.take(7) ?: "LIVE"
        val progress = call.argument<Number>("progress")?.toInt()
        val progressMax = call.argument<Number>("progressMax")?.toInt()
        val startedAt = call.argument<Number>("startedAtMillis")?.toLong()
            ?: System.currentTimeMillis()
        val deepLink = call.argument<String>("deepLink") ?: "atomcli://open?tab=deck"
        val hideOnLockScreen = call.argument<Boolean>("hideOnLockScreen") ?: false
        val notificationManager = manager()
        ensureChannel(notificationManager)

        val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?: Intent(Intent.ACTION_VIEW)
        launchIntent.apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse(deepLink)
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val contentIntent = PendingIntent.getActivity(
            context,
            id,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val extras = Bundle().apply {
            putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true)
            if (isSamsungNowBarCandidate() && Build.VERSION.SDK_INT < 36) {
                putSamsungNowBarExtras(
                    title = title,
                    text = text,
                    shortText = shortText,
                    progress = progress,
                    progressMax = progressMax,
                    contentIntent = contentIntent,
                )
            }
        }
        val style = if (
            Build.VERSION.SDK_INT >= 36 &&
            progress != null && progressMax != null &&
            progressMax > 0 && progress in 0..progressMax
        ) {
            Notification.ProgressStyle()
                .setStyledByProgress(true)
                .setProgress(progress)
                .setProgressSegments(listOf(Notification.ProgressStyle.Segment(progressMax)))
        } else {
            Notification.BigTextStyle().bigText(text)
        }
        val openAction = Notification.Action.Builder(
            android.graphics.drawable.Icon.createWithResource(
                context,
                context.applicationInfo.icon,
            ),
            context.getString(R.string.open_atomcli),
            contentIntent,
        ).build()
        val notification = Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(context.applicationInfo.icon)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(style)
            .setContentIntent(contentIntent)
            .addAction(openAction)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setVisibility(
                if (hideOnLockScreen) Notification.VISIBILITY_SECRET
                else Notification.VISIBILITY_PRIVATE,
            )
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setWhen(startedAt)
            .setUsesChronometer(true)
            .setExtras(extras)
            .apply {
                if (Build.VERSION.SDK_INT >= 36) {
                    setShortCriticalText(shortText)
                }
            }
            .build()

        notificationManager.notify(id, notification)
        val supported = Build.VERSION.SDK_INT >= 36
        val allowed = supported && notificationManager.canPostPromotedNotifications()
        val promotable = supported && notification.hasPromotableCharacteristics()
        val posted = notificationManager.activeNotifications
            .firstOrNull { it.id == id }
            ?.notification
        val promoted = supported && posted != null &&
            posted.flags and Notification.FLAG_PROMOTED_ONGOING != 0
        result.success(
            mapOf(
                "supported" to supported,
                "allowed" to allowed,
                "promotable" to promotable,
                "promoted" to promoted,
            ),
        )
    }

    private fun manager() = context.getSystemService(NotificationManager::class.java)

    private fun ensureChannel(notificationManager: NotificationManager) {
        val existing = notificationManager.getNotificationChannel(CHANNEL_ID)
        if (existing != null) return
        notificationManager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.live_tasks_channel),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = context.getString(R.string.live_tasks_description)
                setShowBadge(false)
            },
        )
    }

    private fun isSamsungNowBarCandidate(): Boolean =
        Build.MANUFACTURER.equals("samsung", ignoreCase = true) ||
            Build.BRAND.equals("samsung", ignoreCase = true)

    private fun Bundle.putSamsungNowBarExtras(
        title: String,
        text: String,
        shortText: String,
        progress: Int?,
        progressMax: Int?,
        contentIntent: PendingIntent,
    ) {
        val appIcon = android.graphics.drawable.Icon.createWithResource(
            context,
            context.applicationInfo.icon,
        )
        putInt(SAMSUNG_NOWBAR_STYLE, SAMSUNG_NOWBAR_STYLE_BOTH)
        putInt(SAMSUNG_NOWBAR_ACTION_TYPE, SAMSUNG_NOWBAR_ACTION_TYPE_TEXT)
        putInt(SAMSUNG_NOWBAR_ACTION_PRIMARY_SET, SAMSUNG_NOWBAR_ACTION_PRIMARY_SET_DEFAULT)
        putBoolean(SAMSUNG_NOWBAR_SHOW_SMALL_ICON, true)
        putInt(SAMSUNG_NOWBAR_CHIP_BACKGROUND, android.graphics.Color.rgb(32, 33, 45))
        putCharSequence(SAMSUNG_NOWBAR_CHIP_EXPANDED_TEXT, shortText)
        putString(SAMSUNG_NOWBAR_PRIMARY_INFO, title)
        putString(SAMSUNG_NOWBAR_NOWBAR_PRIMARY_INFO, title)
        putString(SAMSUNG_NOWBAR_SECONDARY_INFO, text)
        putString(SAMSUNG_NOWBAR_SECONDARY_INFO_NOWBAR, text)
        if (progress != null && progressMax != null && progressMax > 0 && progress in 0..progressMax) {
            putInt(SAMSUNG_NOWBAR_PROGRESS, progress)
            putInt(SAMSUNG_NOWBAR_PROGRESS_MAX, progressMax)
            putInt(SAMSUNG_NOWBAR_PROGRESS_COLOR, android.graphics.Color.rgb(108, 99, 255))
        }
        putParcelable(SAMSUNG_NOWBAR_CHIP_ICON, appIcon)
        putParcelable(SAMSUNG_NOWBAR_ICON, appIcon)
        putParcelable(SAMSUNG_NOWBAR_PENDING_INTENT, contentIntent)
        putCharSequence(SAMSUNG_NOWBAR_AOD_APP_NAME, context.applicationInfo.loadLabel(context.packageManager))
        putParcelable(SAMSUNG_NOWBAR_AOD_APP_ICON, appIcon)
        putParcelable(SAMSUNG_NOWBAR_AOD_APP_PENDING_INTENT, contentIntent)
        putCharSequence(SAMSUNG_NOWBAR_SUBSTITUTION_NAME, context.applicationInfo.loadLabel(context.packageManager))
    }

    companion object {
        private const val CHANNEL_NAME = "io.atomcli.companion/live_updates"
        private const val CHANNEL_ID = "atomcli_live_tasks"
        private const val NOTIFICATION_ID = 4097
        private const val EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing"
        private const val SAMSUNG_NOWBAR_STYLE = "android.ongoingActivityNoti.style"
        private const val SAMSUNG_NOWBAR_STYLE_BOTH = 1
        private const val SAMSUNG_NOWBAR_ACTION_TYPE = "android.ongoingActivityNoti.actionType"
        private const val SAMSUNG_NOWBAR_ACTION_TYPE_TEXT = 1
        private const val SAMSUNG_NOWBAR_ACTION_PRIMARY_SET = "android.ongoingActivityNoti.actionPrimarySet"
        private const val SAMSUNG_NOWBAR_ACTION_PRIMARY_SET_DEFAULT = 1
        private const val SAMSUNG_NOWBAR_SHOW_SMALL_ICON = "android.showSmallIcon"
        private const val SAMSUNG_NOWBAR_CHIP_BACKGROUND = "android.ongoingActivityNoti.chipBgColor"
        private const val SAMSUNG_NOWBAR_CHIP_ICON = "android.ongoingActivityNoti.chipIcon"
        private const val SAMSUNG_NOWBAR_CHIP_EXPANDED_TEXT = "android.ongoingActivityNoti.chipExpandedText"
        private const val SAMSUNG_NOWBAR_PRIMARY_INFO = "android.ongoingActivityNoti.primaryInfo"
        private const val SAMSUNG_NOWBAR_NOWBAR_PRIMARY_INFO = "android.ongoingActivityNoti.nowbarPrimaryInfo"
        private const val SAMSUNG_NOWBAR_SECONDARY_INFO = "android.ongoingActivityNoti.secondaryInfo"
        private const val SAMSUNG_NOWBAR_SECONDARY_INFO_NOWBAR = "android.ongoingActivityNoti.nowbarSecondaryInfo"
        private const val SAMSUNG_NOWBAR_PROGRESS = "android.ongoingActivityNoti.progress"
        private const val SAMSUNG_NOWBAR_PROGRESS_MAX = "android.ongoingActivityNoti.progressMax"
        private const val SAMSUNG_NOWBAR_PROGRESS_COLOR =
            "android.ongoingActivityNoti.progressSegments.progressColor"
        private const val SAMSUNG_NOWBAR_ICON = "android.ongoingActivityNoti.nowbarIcon"
        private const val SAMSUNG_NOWBAR_PENDING_INTENT = "android.ongoingActivityNoti.nowbarPendingIntentOnSubScreen"
        private const val SAMSUNG_NOWBAR_AOD_APP_NAME = "android.ongoingActivityNoti.aodRemoteAppName"
        private const val SAMSUNG_NOWBAR_AOD_APP_ICON = "android.ongoingActivityNoti.aodRemoteAppIcon"
        private const val SAMSUNG_NOWBAR_AOD_APP_PENDING_INTENT = "android.ongoingActivityNoti.aodRemoteAppPendingIntent"
        private const val SAMSUNG_NOWBAR_SUBSTITUTION_NAME = "android.substName"
    }
}
