package com.agentation.mobile

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.os.Build
import android.view.View
import android.view.ViewTreeObserver
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Represents a detected animation in the app.
 */
@Serializable
data class DetectedAnimation(
    val id: String,
    val type: String, // timing, spring, objectAnimator, valueAnimator, compose
    val property: String,
    var status: String = "running", // running, completed, stopped
    val startedAt: Long,
    val duration: Long? = null,
    val fromValue: String? = null,
    val toValue: String? = null,
    val interpolator: String? = null,
    val sourceFile: String? = null,
    val sourceLine: Int? = null,
    val config: Map<String, String> = emptyMap(),
)

/**
 * Detects and tracks animations in Android apps.
 *
 * Supports:
 * - View animations (ObjectAnimator, ValueAnimator)
 * - Manual registration for Compose animations
 * - Periodic reporting to the backend
 */
object AnimationDetector {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false }
    private val activeAnimations = ConcurrentHashMap<String, DetectedAnimation>()
    private val listeners = CopyOnWriteArrayList<() -> Unit>()
    private val counter = AtomicInteger(0)
    private val installed = AtomicBoolean(false)

    /**
     * Install animation detection.
     * Call once at app startup.
     */
    fun install() {
        if (installed.getAndSet(true)) return
    }

    /**
     * Uninstall and clean up.
     */
    fun uninstall() {
        installed.set(false)
        activeAnimations.clear()
    }

    /**
     * Track a ValueAnimator or ObjectAnimator for animation detection.
     * Call this when creating animators in your code.
     */
    fun trackAnimator(
        animator: Animator,
        property: String = "unknown",
        sourceFile: String? = null,
        sourceLine: Int? = null,
    ): String {
        if (!installed.get()) return ""

        val id = generateId()
        val type = when (animator) {
            is ObjectAnimator -> "objectAnimator"
            is ValueAnimator -> "valueAnimator"
            else -> "animator"
        }

        val detected = DetectedAnimation(
            id = id,
            type = type,
            property = if (animator is ObjectAnimator) {
                animator.propertyName ?: property
            } else property,
            status = if (animator.isRunning) "running" else "completed",
            startedAt = System.currentTimeMillis(),
            duration = animator.duration,
            interpolator = animator.interpolator?.javaClass?.simpleName,
            sourceFile = sourceFile,
            sourceLine = sourceLine,
        )

        activeAnimations[id] = detected

        animator.addListener(object : AnimatorListenerAdapter() {
            override fun onAnimationStart(animation: Animator) {
                activeAnimations[id]?.let {
                    activeAnimations[id] = it.copy(status = "running")
                }
                notifyListeners()
            }

            override fun onAnimationEnd(animation: Animator) {
                activeAnimations[id]?.let {
                    activeAnimations[id] = it.copy(status = "completed")
                }
                notifyListeners()
                // Remove after delay
                android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                    activeAnimations.remove(id)
                    notifyListeners()
                }, 2000)
            }

            override fun onAnimationCancel(animation: Animator) {
                activeAnimations[id]?.let {
                    activeAnimations[id] = it.copy(status = "stopped")
                }
                activeAnimations.remove(id)
                notifyListeners()
            }
        })

        notifyListeners()
        return id
    }

    /**
     * Manually register an animation (for Compose animations, transitions, etc.).
     * Returns the animation ID.
     */
    fun registerAnimation(
        type: String,
        property: String,
        duration: Long? = null,
        fromValue: String? = null,
        toValue: String? = null,
        interpolator: String? = null,
        sourceFile: String? = null,
        sourceLine: Int? = null,
    ): String {
        if (!installed.get()) return ""

        val id = generateId()
        val detected = DetectedAnimation(
            id = id,
            type = type,
            property = property,
            status = "running",
            startedAt = System.currentTimeMillis(),
            duration = duration,
            fromValue = fromValue,
            toValue = toValue,
            interpolator = interpolator,
            sourceFile = sourceFile,
            sourceLine = sourceLine,
        )

        activeAnimations[id] = detected
        notifyListeners()

        // Auto-complete after duration
        if (duration != null && duration > 0) {
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                activeAnimations[id]?.let {
                    activeAnimations[id] = it.copy(status = "completed")
                }
                notifyListeners()
                android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                    activeAnimations.remove(id)
                    notifyListeners()
                }, 2000)
            }, duration)
        }

        return id
    }

    /**
     * Mark an animation as completed by its ID.
     */
    fun markCompleted(id: String) {
        activeAnimations[id]?.let {
            activeAnimations[id] = it.copy(status = "completed")
        }
        notifyListeners()
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            activeAnimations.remove(id)
            notifyListeners()
        }, 2000)
    }

    /**
     * Get all currently active/recent animations.
     */
    fun getActiveAnimations(): List<DetectedAnimation> {
        return activeAnimations.values.toList()
    }

    /**
     * Serialize active animations to JSON.
     */
    fun toJson(): String {
        return json.encodeToString(getActiveAnimations())
    }

    /**
     * Subscribe to animation state changes.
     */
    fun addListener(callback: () -> Unit) {
        listeners.add(callback)
    }

    /**
     * Remove a listener.
     */
    fun removeListener(callback: () -> Unit) {
        listeners.remove(callback)
    }

    private fun generateId(): String {
        return "anim-${counter.incrementAndGet()}-${System.currentTimeMillis()}"
    }

    private fun notifyListeners() {
        for (listener in listeners) {
            try {
                listener()
            } catch (_: Exception) {
                // Ignore listener errors
            }
        }
    }
}
