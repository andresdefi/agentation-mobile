import Foundation
import QuartzCore

// MARK: - Detected Animation

/// Represents a detected animation in the app.
public struct DetectedAnimation: Codable, Sendable {
    public let id: String
    public let type: String // timing, spring, keyframe, group, transition
    public let property: String
    public var status: String // running, completed, stopped
    public let startedAt: Int
    public var duration: Double?
    public var fromValue: String?
    public var toValue: String?
    public var timingFunction: String?
    public var sourceFile: String?
    public var sourceLine: Int?
    public let config: [String: String]

    public init(
        id: String,
        type: String,
        property: String,
        status: String = "running",
        startedAt: Int = Int(Date().timeIntervalSince1970 * 1000),
        duration: Double? = nil,
        fromValue: String? = nil,
        toValue: String? = nil,
        timingFunction: String? = nil,
        sourceFile: String? = nil,
        sourceLine: Int? = nil,
        config: [String: String] = [:]
    ) {
        self.id = id
        self.type = type
        self.property = property
        self.status = status
        self.startedAt = startedAt
        self.duration = duration
        self.fromValue = fromValue
        self.toValue = toValue
        self.timingFunction = timingFunction
        self.sourceFile = sourceFile
        self.sourceLine = sourceLine
        self.config = config
    }
}

// MARK: - Animation Detector

/// Detects and tracks animations by swizzling Core Animation methods.
/// All UIKit and SwiftUI animations ultimately go through Core Animation,
/// so this captures animations across both frameworks.
public final class AnimationDetector: @unchecked Sendable {
    public static let shared = AnimationDetector()

    private let lock = NSLock()
    private var activeAnimations: [String: DetectedAnimation] = [:]
    private var listeners: [() -> Void] = []
    private var counter: Int = 0
    private var installed = false

    private init() {}

    // MARK: - Public API

    /// Install animation detection by swizzling Core Animation methods.
    /// Call once at app startup.
    public func install() {
        lock.lock()
        defer { lock.unlock() }
        guard !installed else { return }
        installed = true
        Self.swizzleCALayer()
    }

    /// Uninstall and clean up.
    public func uninstall() {
        lock.lock()
        defer { lock.unlock() }
        installed = false
        activeAnimations.removeAll()
    }

    /// Get all currently active/recent animations.
    public func getActiveAnimations() -> [DetectedAnimation] {
        lock.lock()
        defer { lock.unlock() }
        return Array(activeAnimations.values)
    }

    /// Subscribe to animation state changes.
    public func addListener(_ callback: @escaping () -> Void) {
        lock.lock()
        defer { lock.unlock() }
        listeners.append(callback)
    }

    /// Manually register an animation (for SwiftUI withAnimation, etc).
    public func registerAnimation(
        type: String,
        property: String,
        duration: Double? = nil,
        fromValue: String? = nil,
        toValue: String? = nil,
        timingFunction: String? = nil,
        sourceFile: String? = nil,
        sourceLine: Int? = nil
    ) -> String {
        let id = generateId()
        let detected = DetectedAnimation(
            id: id,
            type: type,
            property: property,
            status: "running",
            startedAt: Int(Date().timeIntervalSince1970 * 1000),
            duration: duration,
            fromValue: fromValue,
            toValue: toValue,
            timingFunction: timingFunction,
            sourceFile: sourceFile,
            sourceLine: sourceLine
        )

        lock.lock()
        activeAnimations[id] = detected
        lock.unlock()

        notifyListeners()

        // Auto-complete after duration
        if let duration = duration {
            let durationMs = Int(duration * 1000)
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(durationMs)) { [weak self] in
                self?.markCompleted(id: id)
            }
        }

        return id
    }

    /// Mark an animation as completed.
    public func markCompleted(id: String) {
        lock.lock()
        activeAnimations[id]?.status = "completed"
        lock.unlock()

        notifyListeners()

        // Remove after a short delay for UI display
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            self?.lock.lock()
            self?.activeAnimations.removeValue(forKey: id)
            self?.lock.unlock()
            self?.notifyListeners()
        }
    }

    // MARK: - Internal (called from swizzled method)

    func onLayerAnimationAdded(_ animation: CAAnimation, forKey key: String?, on layer: CALayer) {
        guard installed else { return }

        let id = generateId()
        let type = Self.inferAnimationType(animation)
        let property = key ?? Self.inferProperty(animation)

        var detected = DetectedAnimation(
            id: id,
            type: type,
            property: property,
            status: "running",
            startedAt: Int(Date().timeIntervalSince1970 * 1000),
            duration: animation.duration > 0 ? animation.duration : nil
        )

        // Extract timing function name
        if let basicAnim = animation as? CABasicAnimation {
            detected.fromValue = basicAnim.fromValue.map { "\($0)" }
            detected.toValue = basicAnim.toValue.map { "\($0)" }
        }

        if let tf = animation.timingFunction {
            detected.timingFunction = Self.timingFunctionName(tf)
        }

        lock.lock()
        activeAnimations[id] = detected
        lock.unlock()

        notifyListeners()

        // Estimate completion from duration
        let completionTime = animation.duration > 0 ? animation.duration : 0.3
        DispatchQueue.main.asyncAfter(deadline: .now() + completionTime) { [weak self] in
            self?.markCompleted(id: id)
        }
    }

    // MARK: - Private

    private func generateId() -> String {
        lock.lock()
        counter += 1
        let c = counter
        lock.unlock()
        return "anim-\(c)-\(Int(Date().timeIntervalSince1970 * 1000))"
    }

    private func notifyListeners() {
        lock.lock()
        let callbacks = listeners
        lock.unlock()
        for callback in callbacks {
            callback()
        }
    }

    private static func inferAnimationType(_ animation: CAAnimation) -> String {
        switch animation {
        case is CASpringAnimation:
            return "spring"
        case is CABasicAnimation:
            return "timing"
        case is CAKeyframeAnimation:
            return "keyframe"
        case is CAAnimationGroup:
            return "group"
        case is CATransition:
            return "transition"
        default:
            return "unknown"
        }
    }

    private static func inferProperty(_ animation: CAAnimation) -> String {
        if let basicAnim = animation as? CABasicAnimation {
            return basicAnim.keyPath ?? "unknown"
        }
        if let keyframeAnim = animation as? CAKeyframeAnimation {
            return keyframeAnim.keyPath ?? "unknown"
        }
        if let transition = animation as? CATransition {
            return "transition.\(transition.type.rawValue)"
        }
        return "unknown"
    }

    private static func timingFunctionName(_ tf: CAMediaTimingFunction) -> String {
        // Compare control points to known functions
        var c1 = Float(0), c2 = Float(0)
        tf.getControlPoint(at: 1, values: &c1)
        tf.getControlPoint(at: 1, values: &c2)

        // Can't easily decode, return a generic label
        return "custom"
    }

    // MARK: - Swizzling

    private static var swizzled = false

    private static func swizzleCALayer() {
        guard !swizzled else { return }
        swizzled = true

        let originalSelector = #selector(CALayer.add(_:forKey:))
        let swizzledSelector = #selector(CALayer.agentation_add(_:forKey:))

        guard let originalMethod = class_getInstanceMethod(CALayer.self, originalSelector),
              let swizzledMethod = class_getInstanceMethod(CALayer.self, swizzledSelector) else {
            return
        }

        method_exchangeImplementations(originalMethod, swizzledMethod)
    }
}

// MARK: - CALayer Swizzle Extension

extension CALayer {
    @objc func agentation_add(_ animation: CAAnimation, forKey key: String?) {
        // Call the original (which is now this method due to swizzling)
        agentation_add(animation, forKey: key)

        // Filter out implicit/system animations that are noise
        let property = key ?? ""
        let ignoredProperties: Set<String> = [
            "onOrderIn", "onOrderOut", "sublayers",
            "onLayout", "bounds", "position", "zPosition",
        ]
        if ignoredProperties.contains(property) { return }

        // Notify the detector
        AnimationDetector.shared.onLayerAnimationAdded(animation, forKey: key, on: self)
    }
}
