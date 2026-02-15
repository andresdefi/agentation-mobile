package com.agentation.mobile

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.util.UUID

data class AgentationConfig(
    val serverUrl: String? = null,
    val deviceId: String? = null,
    val sessionId: String? = null,
    val enabled: Boolean = true,
) {
    internal val normalizedUrl: String? get() = serverUrl?.trimEnd('/')
}

class AgentationProvider(
    val config: AgentationConfig,
    context: Context,
) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val prefs: SharedPreferences =
        context.getSharedPreferences("agentation_mobile", Context.MODE_PRIVATE)
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private val _annotations = MutableStateFlow<List<MobileAnnotation>>(emptyList())
    val annotations: StateFlow<List<MobileAnnotation>> = _annotations.asStateFlow()

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected.asStateFlow()

    val localMode: Boolean get() = config.normalizedUrl == null

    private var pollJob: Job? = null
    private var reportJob: Job? = null

    companion object {
        private const val STORAGE_KEY = "agentation_mobile_annotations"
        private const val POLL_INTERVAL_MS = 3000L
        private const val REPORT_INTERVAL_MS = 1000L
    }

    init {
        if (config.enabled) {
            loadFromStorage()
            AnimationDetector.install()
            if (!localMode) {
                startPolling()
                startReporting()
            }
        }
    }

    fun destroy() {
        AnimationDetector.uninstall()
        scope.cancel()
    }

    // Storage

    private fun loadFromStorage() {
        val stored = prefs.getString(STORAGE_KEY, null) ?: return
        try {
            _annotations.value = json.decodeFromString<List<MobileAnnotation>>(stored)
        } catch (_: Exception) {
            // Ignore corrupted storage
        }
    }

    private fun saveToStorage() {
        try {
            val data = json.encodeToString(_annotations.value)
            prefs.edit().putString(STORAGE_KEY, data).apply()
        } catch (_: Exception) {
            // Ignore storage write errors
        }
    }

    // Polling

    private fun startPolling() {
        fetchAnnotations()
        pollJob = scope.launch {
            while (isActive) {
                delay(POLL_INTERVAL_MS)
                fetchAnnotations()
            }
        }
    }

    private fun fetchAnnotations() {
        val serverUrl = config.normalizedUrl ?: return
        val sessionId = config.sessionId ?: return

        scope.launch(Dispatchers.IO) {
            try {
                val url = URL("$serverUrl/api/annotations?sessionId=${java.net.URLEncoder.encode(sessionId, "UTF-8")}")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "GET"
                conn.connectTimeout = 10_000
                conn.readTimeout = 10_000

                if (conn.responseCode == 200) {
                    val body = conn.inputStream.bufferedReader().readText()
                    val fetched = json.decodeFromString<List<MobileAnnotation>>(body)
                    withContext(Dispatchers.Main) {
                        _annotations.value = fetched
                        _connected.value = true
                        saveToStorage()
                    }
                }
                conn.disconnect()
            } catch (_: Exception) {
                withContext(Dispatchers.Main) {
                    _connected.value = false
                }
            }
        }
    }

    // SDK Reporting

    private fun startReporting() {
        reportJob = scope.launch {
            while (isActive) {
                delay(REPORT_INTERVAL_MS)
                reportToBackend()
            }
        }
    }

    private suspend fun reportToBackend() {
        val serverUrl = config.normalizedUrl ?: return
        val deviceId = java.net.URLEncoder.encode(config.deviceId ?: "android-device", "UTF-8")

        val animations = AnimationDetector.getActiveAnimations()
        val elements = ElementInspector.getElements()

        if (animations.isEmpty() && elements.isEmpty()) return

        withContext(Dispatchers.IO) {
            try {
                val url = URL("$serverUrl/api/devices/$deviceId/sdk-report")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.connectTimeout = 5000

                val animJson = json.encodeToString(animations)
                val elemJson = json.encodeToString(elements)
                val body = """{"animations":$animJson,"elements":$elemJson,"timestamp":${System.currentTimeMillis()}}"""

                conn.outputStream.bufferedWriter().use { it.write(body) }
                conn.responseCode // trigger the request
                conn.disconnect()
            } catch (_: Exception) {
                // Silently ignore — server may be unreachable
            }
        }
    }

    // Create annotation

    suspend fun createAnnotation(
        x: Double,
        y: Double,
        comment: String,
        intent: AnnotationIntent = AnnotationIntent.FIX,
        severity: AnnotationSeverity = AnnotationSeverity.IMPORTANT,
        screenWidth: Int,
        screenHeight: Int,
    ) {
        if (localMode) {
            val now = Instant.now().toString()
            val id = "${System.currentTimeMillis()}-${UUID.randomUUID().toString().take(7)}"
            val annotation = MobileAnnotation(
                id = id,
                sessionId = config.sessionId ?: "local",
                x = x,
                y = y,
                deviceId = config.deviceId ?: "android-device",
                platform = "android-native",
                screenWidth = screenWidth,
                screenHeight = screenHeight,
                comment = comment,
                intent = intent,
                severity = severity,
                createdAt = now,
                updatedAt = now,
            )
            _annotations.value = _annotations.value + annotation
            saveToStorage()
        } else {
            val serverUrl = config.normalizedUrl ?: return
            val input = CreateAnnotationInput(
                sessionId = config.sessionId ?: "",
                x = x,
                y = y,
                deviceId = config.deviceId ?: "android-device",
                screenWidth = screenWidth,
                screenHeight = screenHeight,
                comment = comment,
                intent = intent,
                severity = severity,
            )

            withContext(Dispatchers.IO) {
                try {
                    val url = URL("$serverUrl/api/annotations")
                    val conn = url.openConnection() as HttpURLConnection
                    conn.requestMethod = "POST"
                    conn.setRequestProperty("Content-Type", "application/json")
                    conn.doOutput = true
                    conn.connectTimeout = 10_000

                    conn.outputStream.bufferedWriter().use { it.write(json.encodeToString(input)) }

                    if (conn.responseCode in 200..201) {
                        withContext(Dispatchers.Main) { fetchAnnotations() }
                    }
                    conn.disconnect()
                } catch (_: Exception) {
                    // Silently fail -- dev tool
                }
            }
        }
    }

    // Export

    fun exportAnnotations(): String {
        val lines = mutableListOf<String>()
        lines.add("# ${_annotations.value.size} annotations")
        lines.add("")

        _annotations.value.forEachIndexed { i, a ->
            var ref = "${i + 1}. [${a.intent.value}/${a.severity.value}]"
            a.element?.componentName?.let { name ->
                ref += " $name"
                a.element.componentFile?.let { file -> ref += " ($file)" }
            }
            lines.add(ref)
            lines.add("   ${a.comment}")
            lines.add("   Status: ${a.status.value} | Position: ${"%.1f".format(a.x)}%, ${"%.1f".format(a.y)}%")
            a.selectedText?.let { lines.add("   Text: \"$it\"") }
            lines.add("")
        }

        return lines.joinToString("\n").trimEnd()
    }
}
