package io.atomcli.companion

import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.view.WindowManager
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.android.FlutterActivity
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import kotlin.concurrent.thread

class MainActivity : FlutterActivity() {
    private val deepLinkChannelName = "io.atomcli.companion/deep_links"
    private val mobileInputChannelName = "io.atomcli.companion/mobile_inputs"
    private val privacyChannelName = "io.atomcli.companion/privacy"
    private var deepLinkChannel: MethodChannel? = null
    private var mobileInputChannel: MethodChannel? = null
    private var initialLink: String? = null
    private var initialShare: Intent? = null

    companion object {
        private const val MAX_SHARE_FILES = 10
        private const val MAX_SHARE_BYTES = 256L * 1024L * 1024L
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        initialLink = intent?.dataString
        if (isShareIntent(intent)) initialShare = Intent(intent)
        deepLinkChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, deepLinkChannelName).also { methodChannel ->
            methodChannel.setMethodCallHandler { call, result ->
                when (call.method) {
                    "getInitialLink" -> {
                        result.success(initialLink)
                        initialLink = null
                    }
                    else -> result.notImplemented()
                }
            }
        }
        mobileInputChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, mobileInputChannelName).also { methodChannel ->
            methodChannel.setMethodCallHandler { call, result ->
                when (call.method) {
                    "getInitialShare" -> {
                        val pending = initialShare
                        initialShare = null
                        if (pending == null) result.success(null)
                        else processShare(pending) { payload -> result.success(payload) }
                    }
                    else -> result.notImplemented()
                }
            }
        }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, privacyChannelName).setMethodCallHandler { call, result ->
            when (call.method) {
                "setScreenProtection" -> {
                    val enabled = call.argument<Boolean>("enabled") ?: true
                    if (enabled) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (isShareIntent(intent)) {
            val activeChannel = mobileInputChannel
            if (activeChannel == null) initialShare = Intent(intent)
            else processShare(intent) { payload -> activeChannel.invokeMethod("share", payload) }
            return
        }
        val link = intent.dataString ?: return
        val activeChannel = deepLinkChannel
        if (activeChannel == null) initialLink = link
        else activeChannel.invokeMethod("link", link)
    }

    private fun isShareIntent(value: Intent?): Boolean =
        value?.action == Intent.ACTION_SEND || value?.action == Intent.ACTION_SEND_MULTIPLE

    private fun processShare(intent: Intent, callback: (Map<String, Any>) -> Unit) {
        thread(name = "atomcli-share-import") {
            val files = mutableListOf<Map<String, Any>>()
            val issues = mutableListOf<String>()
            var copied = 0L
            val allUris = sharedUris(intent)
            val uris = allUris.take(MAX_SHARE_FILES)
            if (allUris.size > MAX_SHARE_FILES) {
                issues += getString(R.string.share_file_limit, MAX_SHARE_FILES)
            }
            cleanupOldShareFiles()
            for (uri in uris) {
                if (copied >= MAX_SHARE_BYTES) {
                    issues += getString(R.string.share_size_limit)
                    break
                }
                val metadata = queryMetadata(uri)
                val remaining = MAX_SHARE_BYTES - copied
                if (metadata.second != null && metadata.second!! > remaining) {
                    issues += "${metadata.first} was skipped because it exceeds the remaining import limit."
                    continue
                }
                val target = copySharedUri(uri, metadata.first, remaining)
                if (target == null) {
                    issues += "${metadata.first} could not be read and was not imported."
                    continue
                }
                copied += target.length()
                files += mapOf(
                    "path" to target.absolutePath,
                    "name" to metadata.first,
                    "mime" to (contentResolver.getType(uri) ?: intent.type ?: "application/octet-stream"),
                    "size" to target.length(),
                )
            }
            val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.take(100_000)
            val payload = mutableMapOf<String, Any>("files" to files)
            if (!text.isNullOrBlank()) payload["text"] = text
            if (issues.isNotEmpty()) payload["issues"] = issues.distinct().take(10)
            runOnUiThread { callback(payload) }
        }
    }

    private fun sharedUris(intent: Intent): List<Uri> {
        val result = mutableListOf<Uri>()
        if (intent.action == Intent.ACTION_SEND) {
            sharedUri(intent)?.let(result::add)
        } else if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
            sharedUriList(intent)?.let(result::addAll)
        }
        val clip = intent.clipData
        if (clip != null) {
            for (index in 0 until clip.itemCount) clip.getItemAt(index).uri?.let(result::add)
        }
        return result.distinct()
    }

    @Suppress("DEPRECATION")
    private fun sharedUri(intent: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            intent.getParcelableExtra(Intent.EXTRA_STREAM)
        }

    @Suppress("DEPRECATION")
    private fun sharedUriList(intent: Intent): ArrayList<Uri>? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
        }

    private fun queryMetadata(uri: Uri): Pair<String, Long?> {
        var cursor: Cursor? = null
        try {
            cursor = contentResolver.query(
                uri,
                arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
                null,
                null,
                null,
            )
            if (cursor?.moveToFirst() == true) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                val name = if (nameIndex >= 0) cursor.getString(nameIndex) else null
                val size = if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) cursor.getLong(sizeIndex) else null
                return sanitizeName(name ?: getString(R.string.shared_file_fallback)) to size
            }
        } catch (_: Exception) {
            // Providers are allowed to omit metadata; stream copying remains authoritative.
        } finally {
            cursor?.close()
        }
        return sanitizeName(uri.lastPathSegment ?: getString(R.string.shared_file_fallback)) to null
    }

    private fun copySharedUri(uri: Uri, name: String, remaining: Long): File? {
        val directory = File(cacheDir, "shared-input").apply { mkdirs() }
        val target = File(directory, "${UUID.randomUUID()}-$name")
        try {
            contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(target).use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    var total = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        if (total > remaining) throw IllegalArgumentException(getString(R.string.share_too_large))
                        output.write(buffer, 0, count)
                    }
                }
            } ?: return null
            return target
        } catch (_: Exception) {
            target.delete()
            return null
        }
    }

    private fun cleanupOldShareFiles() {
        val cutoff = System.currentTimeMillis() - 24L * 60L * 60L * 1000L
        File(cacheDir, "shared-input").listFiles()?.forEach { file ->
            if (file.lastModified() < cutoff) file.delete()
        }
    }

    private fun sanitizeName(value: String): String {
        val clean = value.replace(Regex("[^a-zA-Z0-9._ -]"), "_").trim().take(120)
        return clean.ifBlank { getString(R.string.shared_file_fallback) }
    }
}
