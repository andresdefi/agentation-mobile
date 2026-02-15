import Foundation

/// Lightweight HTTP server that exposes element inspection data on port 4748.
/// The bridge (bridge-ios) connects to this on the simulator's localhost.
///
/// Endpoints:
///   GET /agentation/elements     → JSON array of all tracked MobileElement
///   GET /agentation/element?x=&y= → hit-test element at coordinates
///   GET /agentation/health       → { "status": "ok" }
///
/// Start from your App's init:
/// ```swift
/// #if DEBUG
/// AgentationHttpServer.shared.start()
/// #endif
/// ```
public final class AgentationHttpServer: @unchecked Sendable {
    public static let shared = AgentationHttpServer()

    private let port: UInt16
    private var listener: Thread?
    private var serverFd: Int32 = -1
    private var running = false

    public init(port: UInt16 = 4748) {
        self.port = port
    }

    /// Start the HTTP server on a background thread.
    public func start() {
        guard !running else { return }
        running = true

        let thread = Thread { [weak self] in
            self?.runServer()
        }
        thread.name = "agentation-http"
        thread.qualityOfService = .utility
        thread.start()
        self.listener = thread
    }

    /// Stop the HTTP server.
    public func stop() {
        running = false
        if serverFd >= 0 {
            close(serverFd)
            serverFd = -1
        }
    }

    private func runServer() {
        serverFd = socket(AF_INET, SOCK_STREAM, 0)
        guard serverFd >= 0 else { return }

        var opt: Int32 = 1
        setsockopt(serverFd, SOL_SOCKET, SO_REUSEADDR, &opt, socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = INADDR_ANY

        let bindResult = withUnsafePointer(to: &addr) { addrPtr in
            addrPtr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPtr in
                bind(serverFd, sockaddrPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }

        guard bindResult >= 0 else {
            close(serverFd)
            serverFd = -1
            return
        }

        listen(serverFd, 5)

        while running {
            var clientAddr = sockaddr_in()
            var clientAddrLen = socklen_t(MemoryLayout<sockaddr_in>.size)

            let clientFd = withUnsafeMutablePointer(to: &clientAddr) { addrPtr in
                addrPtr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPtr in
                    accept(serverFd, sockaddrPtr, &clientAddrLen)
                }
            }

            guard clientFd >= 0 else {
                if !running { break }
                continue
            }

            DispatchQueue.global(qos: .utility).async { [weak self] in
                self?.handleConnection(clientFd)
            }
        }
    }

    private func handleConnection(_ fd: Int32) {
        defer { close(fd) }

        var buffer = [UInt8](repeating: 0, count: 4096)
        let bytesRead = recv(fd, &buffer, buffer.count, 0)
        guard bytesRead > 0 else { return }

        let request = String(bytes: buffer[0..<bytesRead], encoding: .utf8) ?? ""
        let lines = request.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { return }

        let parts = requestLine.components(separatedBy: " ")
        guard parts.count >= 2, parts[0] == "GET" else {
            sendResponse(fd, status: 405, body: #"{"error":"Method not allowed"}"#)
            return
        }

        let fullPath = parts[1]
        let pathComponents = fullPath.components(separatedBy: "?")
        let path = pathComponents[0]
        let queryParams = pathComponents.count > 1 ? parseQuery(pathComponents[1]) : [:]

        switch path {
        case "/agentation/health":
            let body = DispatchQueue.main.sync { () -> String in
                let count = ElementInspector.shared.elements.count
                return #"{"status":"ok","elements":\#(count)}"#
            }
            sendResponse(fd, status: 200, body: body)

        case "/agentation/elements":
            let body = DispatchQueue.main.sync { () -> String in
                return ElementInspector.shared.toJson()
            }
            sendResponse(fd, status: 200, body: body)

        case "/agentation/animations":
            let animations = AnimationDetector.shared.getActiveAnimations()
            let encoder = JSONEncoder()
            if let data = try? encoder.encode(animations),
               let json = String(data: data, encoding: .utf8) {
                sendResponse(fd, status: 200, body: json)
            } else {
                sendResponse(fd, status: 200, body: "[]")
            }

        case "/agentation/element":
            guard let xStr = queryParams["x"], let x = Double(xStr),
                  let yStr = queryParams["y"], let y = Double(yStr) else {
                sendResponse(fd, status: 400, body: #"{"error":"Missing x and y query parameters"}"#)
                return
            }
            let result = DispatchQueue.main.sync { () -> (Int, String) in
                if let element = ElementInspector.shared.elementAt(x: x, y: y) {
                    let encoder = JSONEncoder()
                    if let data = try? encoder.encode(element),
                       let json = String(data: data, encoding: .utf8) {
                        return (200, json)
                    }
                    return (500, #"{"error":"Encoding failed"}"#)
                }
                return (404, #"{"error":"No element found at coordinates"}"#)
            }
            sendResponse(fd, status: result.0, body: result.1)

        default:
            sendResponse(fd, status: 404, body: #"{"error":"Not found"}"#)
        }
    }

    private func sendResponse(_ fd: Int32, status: Int, body: String) {
        let statusText: String
        switch status {
        case 200: statusText = "OK"
        case 400: statusText = "Bad Request"
        case 404: statusText = "Not Found"
        case 405: statusText = "Method Not Allowed"
        default: statusText = "Error"
        }

        let bodyData = body.data(using: .utf8) ?? Data()
        let response = "HTTP/1.1 \(status) \(statusText)\r\n" +
            "Content-Type: application/json\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Content-Length: \(bodyData.count)\r\n" +
            "Connection: close\r\n" +
            "\r\n" +
            body

        if let data = response.data(using: .utf8) {
            data.withUnsafeBytes { ptr in
                if let baseAddress = ptr.baseAddress {
                    send(fd, baseAddress, data.count, 0)
                }
            }
        }
    }

    private func parseQuery(_ query: String) -> [String: String] {
        var result: [String: String] = [:]
        for param in query.components(separatedBy: "&") {
            let kv = param.components(separatedBy: "=")
            if kv.count == 2 {
                result[kv[0]] = kv[1].removingPercentEncoding ?? kv[1]
            }
        }
        return result
    }
}
