import Foundation
import SwiftUI

// MARK: - Element Inspector

/// Tracks source locations and bounds of SwiftUI views.
/// Views register themselves using the `.agentationSource()` modifier.
@MainActor
public final class ElementInspector: ObservableObject {
    public static let shared = ElementInspector()

    /// All tracked elements, keyed by a unique tag.
    @Published public private(set) var elements: [String: TrackedElement] = [:]

    private let encoder = JSONEncoder()

    public struct TrackedAnimation: Codable, Sendable {
        public let type: String
        public let property: String
        public var status: String
        public var duration: Double?
        public var sourceFile: String?
        public var sourceLine: Int?

        public init(
            type: String = "unknown",
            property: String,
            status: String = "running",
            duration: Double? = nil,
            sourceFile: String? = nil,
            sourceLine: Int? = nil
        ) {
            self.type = type
            self.property = property
            self.status = status
            self.duration = duration
            self.sourceFile = sourceFile
            self.sourceLine = sourceLine
        }
    }

    public struct TrackedElement: Codable, Sendable {
        public let componentName: String
        public let componentPath: String
        public let sourceFile: String?
        public let sourceLine: Int?
        public let sourceColumn: Int?
        public var boundsX: Double
        public var boundsY: Double
        public var boundsWidth: Double
        public var boundsHeight: Double
        public var textContent: String?
        public var accessibilityLabel: String?
        public var accessibilityRole: String?
        public var animations: [TrackedAnimation]?
    }

    private init() {}

    /// Register a tracked element with source location info.
    public func register(
        tag: String,
        componentName: String,
        componentPath: String? = nil,
        sourceFile: String? = nil,
        sourceLine: Int? = nil,
        sourceColumn: Int? = nil,
        textContent: String? = nil,
        accessibilityLabel: String? = nil,
        animations: [TrackedAnimation]? = nil
    ) {
        elements[tag] = TrackedElement(
            componentName: componentName,
            componentPath: componentPath ?? componentName,
            sourceFile: sourceFile,
            sourceLine: sourceLine,
            sourceColumn: sourceColumn,
            boundsX: 0,
            boundsY: 0,
            boundsWidth: 0,
            boundsHeight: 0,
            textContent: textContent,
            accessibilityLabel: accessibilityLabel,
            accessibilityRole: nil,
            animations: animations
        )
    }

    /// Register an animation for a tracked element.
    public func registerAnimation(
        elementTag: String,
        type: String = "unknown",
        property: String,
        status: String = "running",
        duration: Double? = nil,
        sourceFile: String? = nil,
        sourceLine: Int? = nil
    ) {
        guard var element = elements[elementTag] else { return }
        let anim = TrackedAnimation(
            type: type,
            property: property,
            status: status,
            duration: duration,
            sourceFile: sourceFile,
            sourceLine: sourceLine
        )
        var currentAnims = element.animations ?? []
        currentAnims.append(anim)
        element.animations = currentAnims
        elements[elementTag] = element
    }

    /// Update the bounds of a tracked element when its layout changes.
    public func updateBounds(tag: String, frame: CGRect) {
        guard var element = elements[tag] else { return }
        element.boundsX = Double(frame.origin.x)
        element.boundsY = Double(frame.origin.y)
        element.boundsWidth = Double(frame.size.width)
        element.boundsHeight = Double(frame.size.height)
        elements[tag] = element
    }

    /// Convert all tracked elements to MobileElement format.
    public func getMobileElements() -> [MobileElement] {
        return elements.values.map { tracked in
            MobileElement(
                id: "swiftui:\(tracked.componentName):\(tracked.sourceFile ?? "unknown"):\(tracked.sourceLine ?? 0)",
                platform: .iosNative,
                componentPath: tracked.componentPath,
                componentName: tracked.componentName,
                componentFile: tracked.sourceFile,
                sourceLocation: tracked.sourceFile != nil && tracked.sourceLine != nil
                    ? SourceLocation(
                        file: tracked.sourceFile!,
                        line: tracked.sourceLine!,
                        column: tracked.sourceColumn
                    )
                    : nil,
                boundingBox: BoundingBox(
                    x: tracked.boundsX,
                    y: tracked.boundsY,
                    width: tracked.boundsWidth,
                    height: tracked.boundsHeight
                ),
                textContent: tracked.textContent,
                accessibility: tracked.accessibilityLabel != nil
                    ? Accessibility(label: tracked.accessibilityLabel)
                    : nil,
                animations: tracked.animations?.map { anim in
                    AnimationInfo(
                        type: anim.type,
                        property: anim.property,
                        status: anim.status,
                        duration: anim.duration,
                        sourceLocation: anim.sourceFile != nil && anim.sourceLine != nil
                            ? SourceLocation(file: anim.sourceFile!, line: anim.sourceLine!)
                            : nil
                    )
                }
            )
        }
    }

    /// Serialize all tracked elements to JSON.
    public func toJson() -> String {
        do {
            let data = try encoder.encode(getMobileElements())
            return String(data: data, encoding: .utf8) ?? "[]"
        } catch {
            return "[]"
        }
    }

    /// Hit-test: find the smallest element whose bounds contain the point.
    public func elementAt(x: Double, y: Double) -> MobileElement? {
        var best: MobileElement?
        var bestArea = Double.greatestFiniteMagnitude

        for element in getMobileElements() {
            let box = element.boundingBox
            if x >= box.x && x <= box.x + box.width &&
               y >= box.y && y <= box.y + box.height {
                let area = box.width * box.height
                if area < bestArea {
                    bestArea = area
                    best = element
                }
            }
        }

        return best
    }

    /// Clear all tracked elements.
    public func clear() {
        elements.removeAll()
    }
}

// MARK: - Source Tracking Modifier

/// A ViewModifier that captures the source location of a SwiftUI view
/// using Swift's `#file` and `#line` compile-time literals.
///
/// Usage:
/// ```swift
/// Text("Hello")
///     .agentationSource(componentName: "Greeting")
/// ```
///
/// The source file and line are captured automatically at the call site.
struct AgentationSourceModifier: ViewModifier {
    let componentName: String
    let componentPath: String
    let sourceFile: String
    let sourceLine: Int
    let sourceColumn: Int
    let textContent: String?
    let accessibilityLabel: String?
    let animations: [ElementInspector.TrackedAnimation]?
    let tag: String

    init(
        componentName: String,
        componentPath: String? = nil,
        sourceFile: String,
        sourceLine: Int,
        sourceColumn: Int,
        textContent: String? = nil,
        accessibilityLabel: String? = nil,
        animations: [ElementInspector.TrackedAnimation]? = nil
    ) {
        self.componentName = componentName
        self.componentPath = componentPath ?? componentName
        self.sourceFile = sourceFile
        self.sourceLine = sourceLine
        self.sourceColumn = sourceColumn
        self.textContent = textContent
        self.accessibilityLabel = accessibilityLabel
        self.animations = animations
        self.tag = "\(componentName):\(sourceFile):\(sourceLine)"
    }

    func body(content: Content) -> some View {
        content
            .background(
                GeometryReader { geometry in
                    Color.clear
                        .onAppear {
                            let frame = geometry.frame(in: .global)
                            Task { @MainActor in
                                ElementInspector.shared.register(
                                    tag: tag,
                                    componentName: componentName,
                                    componentPath: componentPath,
                                    sourceFile: sourceFile,
                                    sourceLine: sourceLine,
                                    sourceColumn: sourceColumn,
                                    textContent: textContent,
                                    accessibilityLabel: accessibilityLabel,
                                    animations: animations
                                )
                                ElementInspector.shared.updateBounds(tag: tag, frame: frame)
                            }
                        }
                        .onChange(of: geometry.frame(in: .global)) { _, newFrame in
                            Task { @MainActor in
                                ElementInspector.shared.updateBounds(tag: tag, frame: newFrame)
                            }
                        }
                }
            )
    }
}

// MARK: - View Extension

public extension View {
    /// Track this view's source location for Agentation element inspection.
    ///
    /// The `file`, `line`, and `column` parameters are captured automatically
    /// using Swift's compile-time literals — you don't need to pass them manually.
    ///
    /// ```swift
    /// Button("Submit") { submit() }
    ///     .agentationSource(componentName: "SubmitButton")
    /// ```
    func agentationSource(
        componentName: String,
        componentPath: String? = nil,
        textContent: String? = nil,
        accessibilityLabel: String? = nil,
        animations: [ElementInspector.TrackedAnimation]? = nil,
        file: String = #file,
        line: Int = #line,
        column: Int = #column
    ) -> some View {
        #if DEBUG
        self.modifier(AgentationSourceModifier(
            componentName: componentName,
            componentPath: componentPath,
            sourceFile: file,
            sourceLine: line,
            sourceColumn: column,
            textContent: textContent,
            accessibilityLabel: accessibilityLabel,
            animations: animations
        ))
        #else
        self
        #endif
    }
}
