package com.agentation.mobile

import android.view.View
import android.view.ViewGroup
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Composition
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.ComposeView
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.concurrent.ConcurrentHashMap

/**
 * Tracks source locations of Compose components. Users wrap their composables
 * with `Modifier.agentationSource()` to register source info, or the SDK
 * automatically captures layout coordinates of composed elements.
 */
object ElementInspector {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false; prettyPrint = false }

    /**
     * Registry of known elements with their source locations and bounds.
     * Key: a unique tag (component name + source location hash).
     */
    internal val registry = ConcurrentHashMap<String, TrackedElement>()

    @Serializable
    data class TrackedAnimation(
        val type: String = "unknown",
        val property: String,
        val status: String = "running",
        val duration: Double? = null,
        val sourceFile: String? = null,
        val sourceLine: Int? = null,
    )

    @Serializable
    data class TrackedElement(
        val componentName: String,
        val componentPath: String,
        val sourceFile: String? = null,
        val sourceLine: Int? = null,
        val sourceColumn: Int? = null,
        val boundsX: Double = 0.0,
        val boundsY: Double = 0.0,
        val boundsWidth: Double = 0.0,
        val boundsHeight: Double = 0.0,
        val textContent: String? = null,
        val accessibilityLabel: String? = null,
        val accessibilityRole: String? = null,
        val animations: List<TrackedAnimation>? = null,
    )

    /**
     * Register a tracked element. Called from `Modifier.agentationSource()`.
     */
    fun register(
        tag: String,
        componentName: String,
        componentPath: String = componentName,
        sourceFile: String? = null,
        sourceLine: Int? = null,
        sourceColumn: Int? = null,
        textContent: String? = null,
        accessibilityLabel: String? = null,
        accessibilityRole: String? = null,
        animations: List<TrackedAnimation>? = null,
    ) {
        registry[tag] = TrackedElement(
            componentName = componentName,
            componentPath = componentPath,
            sourceFile = sourceFile,
            sourceLine = sourceLine,
            sourceColumn = sourceColumn,
            textContent = textContent,
            accessibilityLabel = accessibilityLabel,
            accessibilityRole = accessibilityRole,
            animations = animations,
        )
    }

    /**
     * Register an animation for a tracked element.
     */
    fun registerAnimation(
        elementTag: String,
        type: String = "unknown",
        property: String,
        status: String = "running",
        duration: Double? = null,
        sourceFile: String? = null,
        sourceLine: Int? = null,
    ) {
        val existing = registry[elementTag] ?: return
        val anim = TrackedAnimation(
            type = type,
            property = property,
            status = status,
            duration = duration,
            sourceFile = sourceFile,
            sourceLine = sourceLine,
        )
        val currentAnims = existing.animations?.toMutableList() ?: mutableListOf()
        currentAnims.add(anim)
        registry[elementTag] = existing.copy(animations = currentAnims)
    }

    /**
     * Update the bounds of a tracked element when layout changes.
     */
    fun updateBounds(tag: String, bounds: Rect) {
        val existing = registry[tag] ?: return
        registry[tag] = existing.copy(
            boundsX = bounds.left.toDouble(),
            boundsY = bounds.top.toDouble(),
            boundsWidth = bounds.width.toDouble(),
            boundsHeight = bounds.height.toDouble(),
        )
    }

    /**
     * Convert tracked elements to MobileElement format for the bridge.
     */
    fun getElements(): List<MobileElement> {
        return registry.values.map { tracked ->
            MobileElement(
                id = "compose:${tracked.componentName}:${tracked.sourceFile}:${tracked.sourceLine}",
                platform = Platform.ANDROID_NATIVE,
                componentPath = tracked.componentPath,
                componentName = tracked.componentName,
                componentFile = tracked.sourceFile,
                sourceLocation = if (tracked.sourceFile != null && tracked.sourceLine != null) {
                    SourceLocation(
                        file = tracked.sourceFile,
                        line = tracked.sourceLine,
                        column = tracked.sourceColumn,
                    )
                } else null,
                boundingBox = BoundingBox(
                    x = tracked.boundsX,
                    y = tracked.boundsY,
                    width = tracked.boundsWidth,
                    height = tracked.boundsHeight,
                ),
                textContent = tracked.textContent,
                accessibility = if (tracked.accessibilityLabel != null || tracked.accessibilityRole != null) {
                    Accessibility(
                        label = tracked.accessibilityLabel,
                        role = tracked.accessibilityRole,
                    )
                } else null,
                animations = tracked.animations?.map { anim ->
                    AnimationInfo(
                        type = anim.type,
                        property = anim.property,
                        status = anim.status,
                        duration = anim.duration,
                        sourceLocation = if (anim.sourceFile != null && anim.sourceLine != null) {
                            SourceLocation(file = anim.sourceFile, line = anim.sourceLine)
                        } else null,
                    )
                },
            )
        }
    }

    /**
     * Serialize all tracked elements to JSON for the HTTP endpoint.
     */
    fun toJson(): String {
        return json.encodeToString(getElements())
    }

    /**
     * Find the element at the given screen coordinates (hit-test).
     * Returns the smallest element whose bounds contain the point.
     */
    fun elementAt(x: Double, y: Double): MobileElement? {
        var best: MobileElement? = null
        var bestArea = Double.MAX_VALUE

        for (element in getElements()) {
            val box = element.boundingBox
            if (x >= box.x && x <= box.x + box.width &&
                y >= box.y && y <= box.y + box.height
            ) {
                val area = box.width * box.height
                if (area < bestArea) {
                    bestArea = area
                    best = element
                }
            }
        }

        return best
    }

    /**
     * Clear all tracked elements (e.g., on activity recreation).
     */
    fun clear() {
        registry.clear()
    }
}

/**
 * Modifier extension to track a Compose component's source location and bounds.
 *
 * Usage:
 * ```kotlin
 * @Composable
 * fun MyButton() {
 *     Button(
 *         modifier = Modifier.agentationSource(
 *             componentName = "MyButton",
 *             sourceFile = __FILE__,    // or hardcode "MyButton.kt"
 *             sourceLine = __LINE__,    // or hardcode the line number
 *         ),
 *         onClick = { }
 *     ) { Text("Click me") }
 * }
 * ```
 *
 * For automatic tracking without manual source info, use `agentationTrack()`.
 */
fun Modifier.agentationSource(
    componentName: String,
    sourceFile: String? = null,
    sourceLine: Int? = null,
    sourceColumn: Int? = null,
    componentPath: String = componentName,
    textContent: String? = null,
    accessibilityLabel: String? = null,
    animations: List<ElementInspector.TrackedAnimation>? = null,
): Modifier {
    val tag = "$componentName:${sourceFile ?: "unknown"}:${sourceLine ?: 0}"

    ElementInspector.register(
        tag = tag,
        componentName = componentName,
        componentPath = componentPath,
        sourceFile = sourceFile,
        sourceLine = sourceLine,
        sourceColumn = sourceColumn,
        textContent = textContent,
        accessibilityLabel = accessibilityLabel,
        animations = animations,
    )

    return this.then(
        Modifier.onGloballyPositioned { coordinates: LayoutCoordinates ->
            val bounds = coordinates.boundsInWindow()
            ElementInspector.updateBounds(tag, bounds)
        }
    )
}

/**
 * Simplified modifier for automatic tracking without source info.
 * Captures bounds only — source location will come from the bridge's
 * UIAutomator merge if available.
 */
fun Modifier.agentationTrack(
    componentName: String,
    textContent: String? = null,
): Modifier {
    return agentationSource(
        componentName = componentName,
        textContent = textContent,
    )
}
