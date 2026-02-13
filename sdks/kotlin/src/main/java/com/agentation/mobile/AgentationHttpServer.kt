package com.agentation.mobile

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintWriter
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Lightweight HTTP server that exposes element inspection data on port 4748.
 * The bridge (bridge-android) connects to this via ADB port forwarding:
 *   `adb forward tcp:4748 tcp:4748`
 *
 * Endpoints:
 *   GET /agentation/elements     → JSON array of all tracked MobileElement
 *   GET /agentation/element?x=&y= → hit-test element at coordinates
 *   GET /agentation/health       → { "status": "ok" }
 */
class AgentationHttpServer(
    private val port: Int = 4748,
) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false; prettyPrint = false }
    private var serverSocket: ServerSocket? = null
    private var executor: ExecutorService? = null
    @Volatile
    private var running = false

    /**
     * Start the HTTP server on a background thread.
     * Safe to call multiple times — subsequent calls are no-ops.
     */
    fun start() {
        if (running) return
        running = true

        executor = Executors.newCachedThreadPool { r ->
            Thread(r, "agentation-http").apply { isDaemon = true }
        }

        executor?.execute {
            try {
                serverSocket = ServerSocket(port)
                while (running) {
                    try {
                        val socket = serverSocket?.accept() ?: break
                        executor?.execute { handleConnection(socket) }
                    } catch (_: Exception) {
                        if (!running) break
                    }
                }
            } catch (_: Exception) {
                // Port might already be in use — silently fail for dev tool
            }
        }
    }

    /**
     * Stop the HTTP server and release resources.
     */
    fun stop() {
        running = false
        try {
            serverSocket?.close()
        } catch (_: Exception) {}
        executor?.shutdownNow()
        executor = null
        serverSocket = null
    }

    private fun handleConnection(socket: Socket) {
        try {
            socket.soTimeout = 5000
            val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
            val writer = PrintWriter(socket.getOutputStream(), true)

            val requestLine = reader.readLine() ?: return
            // Consume headers
            while (true) {
                val line = reader.readLine() ?: break
                if (line.isEmpty()) break
            }

            val parts = requestLine.split(" ")
            if (parts.size < 2) {
                sendResponse(writer, 400, """{"error":"Bad request"}""")
                return
            }

            val method = parts[0]
            val fullPath = parts[1]
            val pathAndQuery = fullPath.split("?", limit = 2)
            val path = pathAndQuery[0]
            val queryParams = if (pathAndQuery.size > 1) parseQuery(pathAndQuery[1]) else emptyMap()

            if (method != "GET") {
                sendResponse(writer, 405, """{"error":"Method not allowed"}""")
                return
            }

            when (path) {
                "/agentation/health" -> {
                    sendResponse(writer, 200, """{"status":"ok","elements":${ElementInspector.registry.size}}""")
                }
                "/agentation/elements" -> {
                    val body = ElementInspector.toJson()
                    sendResponse(writer, 200, body)
                }
                "/agentation/element" -> {
                    val x = queryParams["x"]?.toDoubleOrNull()
                    val y = queryParams["y"]?.toDoubleOrNull()
                    if (x == null || y == null) {
                        sendResponse(writer, 400, """{"error":"Missing x and y query parameters"}""")
                        return
                    }
                    val element = ElementInspector.elementAt(x, y)
                    if (element != null) {
                        sendResponse(writer, 200, json.encodeToString(element))
                    } else {
                        sendResponse(writer, 404, """{"error":"No element found at coordinates"}""")
                    }
                }
                else -> {
                    sendResponse(writer, 404, """{"error":"Not found"}""")
                }
            }
        } catch (_: Exception) {
            // Silently handle connection errors
        } finally {
            try { socket.close() } catch (_: Exception) {}
        }
    }

    private fun sendResponse(writer: PrintWriter, status: Int, body: String) {
        val statusText = when (status) {
            200 -> "OK"
            400 -> "Bad Request"
            404 -> "Not Found"
            405 -> "Method Not Allowed"
            else -> "Error"
        }
        writer.print("HTTP/1.1 $status $statusText\r\n")
        writer.print("Content-Type: application/json\r\n")
        writer.print("Access-Control-Allow-Origin: *\r\n")
        writer.print("Content-Length: ${body.toByteArray(Charsets.UTF_8).size}\r\n")
        writer.print("Connection: close\r\n")
        writer.print("\r\n")
        writer.print(body)
        writer.flush()
    }

    private fun parseQuery(query: String): Map<String, String> {
        return query.split("&").mapNotNull { param ->
            val kv = param.split("=", limit = 2)
            if (kv.size == 2) kv[0] to java.net.URLDecoder.decode(kv[1], "UTF-8") else null
        }.toMap()
    }
}
