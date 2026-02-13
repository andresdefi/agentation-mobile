import Foundation
import Combine

// MARK: - Configuration

public struct AgentationConfig: Sendable {
    public let serverUrl: String?
    public let deviceId: String?
    public let sessionId: String?
    public let enabled: Bool

    public init(
        serverUrl: String? = nil,
        deviceId: String? = nil,
        sessionId: String? = nil,
        enabled: Bool = true
    ) {
        self.serverUrl = serverUrl?.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        self.deviceId = deviceId
        self.sessionId = sessionId
        #if DEBUG
        self.enabled = enabled
        #else
        self.enabled = false
        #endif
    }
}

// MARK: - Provider

@MainActor
public final class AgentationProvider: ObservableObject {
    @Published public private(set) var annotations: [MobileAnnotation] = []
    @Published public private(set) var connected: Bool = false

    public let config: AgentationConfig

    public var localMode: Bool { config.serverUrl == nil }

    private static let storageKey = "agentation_mobile_annotations"
    private let pollInterval: TimeInterval = 3
    private var pollTimer: Timer?
    private let session = URLSession.shared
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    public init(config: AgentationConfig) {
        self.config = config
        guard config.enabled else { return }
        loadFromStorage()
        if !localMode {
            startPolling()
        }
    }

    deinit {
        pollTimer?.invalidate()
    }

    // MARK: - Local Storage

    private func loadFromStorage() {
        guard let data = UserDefaults.standard.data(forKey: Self.storageKey) else { return }
        do {
            annotations = try decoder.decode([MobileAnnotation].self, from: data)
        } catch {
            // Ignore corrupted storage
        }
    }

    private func saveToStorage() {
        do {
            let data = try encoder.encode(annotations)
            UserDefaults.standard.set(data, forKey: Self.storageKey)
        } catch {
            // Ignore storage write errors
        }
    }

    // MARK: - Server Polling

    private func startPolling() {
        fetchAnnotations()
        pollTimer = Timer.scheduledTimer(withTimeInterval: pollInterval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.fetchAnnotations()
            }
        }
    }

    private func fetchAnnotations() {
        guard let serverUrl = config.serverUrl,
              let sessionId = config.sessionId else { return }

        let urlString = "\(serverUrl)/api/annotations?sessionId=\(sessionId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? sessionId)"
        guard let url = URL(string: urlString) else { return }

        Task {
            do {
                let (data, response) = try await session.data(from: url)
                guard let httpResponse = response as? HTTPURLResponse,
                      httpResponse.statusCode == 200 else { return }
                let fetched = try decoder.decode([MobileAnnotation].self, from: data)
                annotations = fetched
                connected = true
                saveToStorage()
            } catch {
                connected = false
            }
        }
    }

    // MARK: - Create Annotation

    public func createAnnotation(
        x: Double,
        y: Double,
        comment: String,
        intent: AnnotationIntent = .fix,
        severity: AnnotationSeverity = .important,
        screenWidth: Int,
        screenHeight: Int
    ) async {
        if localMode {
            let now = ISO8601DateFormatter().string(from: Date())
            let id = "\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(7).lowercased())"
            let annotation = MobileAnnotation(
                id: id,
                sessionId: config.sessionId ?? "local",
                x: x,
                y: y,
                deviceId: config.deviceId ?? "ios-device",
                platform: "ios-native",
                screenWidth: screenWidth,
                screenHeight: screenHeight,
                comment: comment,
                intent: intent,
                severity: severity,
                createdAt: now,
                updatedAt: now
            )
            annotations.append(annotation)
            saveToStorage()
        } else {
            guard let serverUrl = config.serverUrl,
                  let url = URL(string: "\(serverUrl)/api/annotations") else { return }

            let input = CreateAnnotationInput(
                sessionId: config.sessionId ?? "",
                x: x,
                y: y,
                deviceId: config.deviceId ?? "ios-device",
                screenWidth: screenWidth,
                screenHeight: screenHeight,
                comment: comment,
                intent: intent,
                severity: severity
            )

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")

            do {
                request.httpBody = try encoder.encode(input)
                let (_, response) = try await session.data(for: request)
                guard let httpResponse = response as? HTTPURLResponse,
                      httpResponse.statusCode == 200 || httpResponse.statusCode == 201 else { return }
                fetchAnnotations()
            } catch {
                // Silently fail -- dev tool
            }
        }
    }

    // MARK: - Export

    public func exportAnnotations() -> String {
        var lines: [String] = []
        lines.append("# \(annotations.count) annotations")
        lines.append("")

        for (i, a) in annotations.enumerated() {
            var ref = "\(i + 1). [\(a.intent.rawValue)/\(a.severity.rawValue)]"
            if let name = a.element?.componentName {
                ref += " \(name)"
                if let file = a.element?.componentFile {
                    ref += " (\(file))"
                }
            }
            lines.append(ref)
            lines.append("   \(a.comment)")
            lines.append("   Status: \(a.status.rawValue) | Position: \(String(format: "%.1f", a.x))%, \(String(format: "%.1f", a.y))%")
            if let text = a.selectedText {
                lines.append("   Text: \"\(text)\"")
            }
            lines.append("")
        }

        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
