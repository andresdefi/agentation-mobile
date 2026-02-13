import Foundation

// MARK: - Enums

public enum AnnotationStatus: String, Codable, CaseIterable, Sendable {
    case pending
    case acknowledged
    case resolved
    case dismissed
}

public enum AnnotationIntent: String, Codable, CaseIterable, Sendable {
    case fix
    case change
    case question
    case approve
}

public enum AnnotationSeverity: String, Codable, CaseIterable, Sendable {
    case blocking
    case important
    case suggestion
}

public enum Platform: String, Codable, Sendable {
    case reactNative = "react-native"
    case flutter
    case iosNative = "ios-native"
    case androidNative = "android-native"
}

// MARK: - Element Types

public struct BoundingBox: Codable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

public struct Accessibility: Codable, Sendable {
    public let label: String?
    public let role: String?
    public let hint: String?
    public let value: String?
    public let traits: [String]?

    public init(label: String? = nil, role: String? = nil, hint: String? = nil, value: String? = nil, traits: [String]? = nil) {
        self.label = label
        self.role = role
        self.hint = hint
        self.value = value
        self.traits = traits
    }
}

public struct SourceLocation: Codable, Sendable {
    public let file: String
    public let line: Int
    public let column: Int?

    public init(file: String, line: Int, column: Int? = nil) {
        self.file = file
        self.line = line
        self.column = column
    }
}

public struct AnimationInfo: Codable, Sendable {
    public let type: String
    public let property: String
    public let status: String?
    public let duration: Double?
    public let sourceLocation: SourceLocation?

    public init(
        type: String = "unknown",
        property: String,
        status: String? = nil,
        duration: Double? = nil,
        sourceLocation: SourceLocation? = nil
    ) {
        self.type = type
        self.property = property
        self.status = status
        self.duration = duration
        self.sourceLocation = sourceLocation
    }
}

public struct MobileElement: Codable, Sendable {
    public let id: String
    public let platform: Platform
    public let componentPath: String
    public let componentName: String
    public let componentFile: String?
    public let sourceLocation: SourceLocation?
    public let boundingBox: BoundingBox
    public let styleProps: [String: AnyCodable]?
    public let accessibility: Accessibility?
    public let textContent: String?
    public let nearbyText: String?
    public let animations: [AnimationInfo]?

    public init(
        id: String,
        platform: Platform,
        componentPath: String,
        componentName: String,
        componentFile: String? = nil,
        sourceLocation: SourceLocation? = nil,
        boundingBox: BoundingBox,
        styleProps: [String: AnyCodable]? = nil,
        accessibility: Accessibility? = nil,
        textContent: String? = nil,
        nearbyText: String? = nil,
        animations: [AnimationInfo]? = nil
    ) {
        self.id = id
        self.platform = platform
        self.componentPath = componentPath
        self.componentName = componentName
        self.componentFile = componentFile
        self.sourceLocation = sourceLocation
        self.boundingBox = boundingBox
        self.styleProps = styleProps
        self.accessibility = accessibility
        self.textContent = textContent
        self.nearbyText = nearbyText
        self.animations = animations
    }
}

// MARK: - Annotation Types

public struct SelectedArea: Codable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

public struct ThreadMessage: Codable, Sendable {
    public let role: String
    public let content: String
    public let timestamp: String

    public init(role: String, content: String, timestamp: String) {
        self.role = role
        self.content = content
        self.timestamp = timestamp
    }
}

public struct MobileAnnotation: Codable, Identifiable, Sendable {
    public let id: String
    public let sessionId: String
    public let x: Double
    public let y: Double
    public let deviceId: String
    public let platform: String
    public let screenWidth: Int
    public let screenHeight: Int
    public let screenshotId: String?
    public let resolvedScreenshotId: String?
    public let comment: String
    public let intent: AnnotationIntent
    public let severity: AnnotationSeverity
    public let status: AnnotationStatus
    public let thread: [ThreadMessage]
    public let element: MobileElement?
    public let selectedArea: SelectedArea?
    public let selectedText: String?
    public let createdAt: String
    public let updatedAt: String

    public init(
        id: String,
        sessionId: String,
        x: Double,
        y: Double,
        deviceId: String,
        platform: String,
        screenWidth: Int,
        screenHeight: Int,
        screenshotId: String? = nil,
        resolvedScreenshotId: String? = nil,
        comment: String,
        intent: AnnotationIntent,
        severity: AnnotationSeverity,
        status: AnnotationStatus = .pending,
        thread: [ThreadMessage] = [],
        element: MobileElement? = nil,
        selectedArea: SelectedArea? = nil,
        selectedText: String? = nil,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.sessionId = sessionId
        self.x = x
        self.y = y
        self.deviceId = deviceId
        self.platform = platform
        self.screenWidth = screenWidth
        self.screenHeight = screenHeight
        self.screenshotId = screenshotId
        self.resolvedScreenshotId = resolvedScreenshotId
        self.comment = comment
        self.intent = intent
        self.severity = severity
        self.status = status
        self.thread = thread
        self.element = element
        self.selectedArea = selectedArea
        self.selectedText = selectedText
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

// MARK: - Input Types

public struct CreateAnnotationInput: Codable, Sendable {
    public let sessionId: String
    public let x: Double
    public let y: Double
    public let deviceId: String
    public let platform: String
    public let screenWidth: Int
    public let screenHeight: Int
    public let screenshotId: String?
    public let comment: String
    public let intent: AnnotationIntent
    public let severity: AnnotationSeverity
    public let element: MobileElement?
    public let selectedArea: SelectedArea?
    public let selectedText: String?

    public init(
        sessionId: String,
        x: Double,
        y: Double,
        deviceId: String,
        platform: String = "ios-native",
        screenWidth: Int,
        screenHeight: Int,
        screenshotId: String? = nil,
        comment: String,
        intent: AnnotationIntent,
        severity: AnnotationSeverity,
        element: MobileElement? = nil,
        selectedArea: SelectedArea? = nil,
        selectedText: String? = nil
    ) {
        self.sessionId = sessionId
        self.x = x
        self.y = y
        self.deviceId = deviceId
        self.platform = platform
        self.screenWidth = screenWidth
        self.screenHeight = screenHeight
        self.screenshotId = screenshotId
        self.comment = comment
        self.intent = intent
        self.severity = severity
        self.element = element
        self.selectedArea = selectedArea
        self.selectedText = selectedText
    }
}

// MARK: - AnyCodable (for styleProps)

public struct AnyCodable: Codable, @unchecked Sendable {
    public let value: Any

    public init(_ value: Any) {
        self.value = value
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map(\.value)
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues(\.value)
        } else {
            value = NSNull()
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case is NSNull:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        default:
            try container.encodeNil()
        }
    }
}
