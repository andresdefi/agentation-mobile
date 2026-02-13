package com.agentation.mobile

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// MARK: Enums

@Serializable
enum class AnnotationStatus {
    @SerialName("pending") PENDING,
    @SerialName("acknowledged") ACKNOWLEDGED,
    @SerialName("resolved") RESOLVED,
    @SerialName("dismissed") DISMISSED;

    val value: String get() = when (this) {
        PENDING -> "pending"
        ACKNOWLEDGED -> "acknowledged"
        RESOLVED -> "resolved"
        DISMISSED -> "dismissed"
    }
}

@Serializable
enum class AnnotationIntent {
    @SerialName("fix") FIX,
    @SerialName("change") CHANGE,
    @SerialName("question") QUESTION,
    @SerialName("approve") APPROVE;

    val value: String get() = when (this) {
        FIX -> "fix"
        CHANGE -> "change"
        QUESTION -> "question"
        APPROVE -> "approve"
    }
}

@Serializable
enum class AnnotationSeverity {
    @SerialName("blocking") BLOCKING,
    @SerialName("important") IMPORTANT,
    @SerialName("suggestion") SUGGESTION;

    val value: String get() = when (this) {
        BLOCKING -> "blocking"
        IMPORTANT -> "important"
        SUGGESTION -> "suggestion"
    }
}

@Serializable
enum class Platform {
    @SerialName("react-native") REACT_NATIVE,
    @SerialName("flutter") FLUTTER,
    @SerialName("ios-native") IOS_NATIVE,
    @SerialName("android-native") ANDROID_NATIVE;

    val value: String get() = when (this) {
        REACT_NATIVE -> "react-native"
        FLUTTER -> "flutter"
        IOS_NATIVE -> "ios-native"
        ANDROID_NATIVE -> "android-native"
    }
}

// MARK: Element types

@Serializable
data class BoundingBox(
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
)

@Serializable
data class Accessibility(
    val label: String? = null,
    val role: String? = null,
    val hint: String? = null,
    val value: String? = null,
    val traits: List<String>? = null,
)

@Serializable
data class SourceLocation(
    val file: String,
    val line: Int,
    val column: Int? = null,
)

@Serializable
data class AnimationInfo(
    val type: String = "unknown",
    val property: String,
    val status: String? = null,
    val duration: Double? = null,
    val sourceLocation: SourceLocation? = null,
)

@Serializable
data class MobileElement(
    val id: String,
    val platform: Platform,
    val componentPath: String,
    val componentName: String,
    val componentFile: String? = null,
    val sourceLocation: SourceLocation? = null,
    val boundingBox: BoundingBox,
    val styleProps: Map<String, JsonElement>? = null,
    val accessibility: Accessibility? = null,
    val textContent: String? = null,
    val nearbyText: String? = null,
    val animations: List<AnimationInfo>? = null,
)

// MARK: Annotation types

@Serializable
data class SelectedArea(
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
)

@Serializable
data class ThreadMessage(
    val role: String,
    val content: String,
    val timestamp: String,
)

@Serializable
data class MobileAnnotation(
    val id: String,
    val sessionId: String,
    val x: Double,
    val y: Double,
    val deviceId: String,
    val platform: String,
    val screenWidth: Int,
    val screenHeight: Int,
    val screenshotId: String? = null,
    val resolvedScreenshotId: String? = null,
    val comment: String,
    val intent: AnnotationIntent,
    val severity: AnnotationSeverity,
    val status: AnnotationStatus = AnnotationStatus.PENDING,
    val thread: List<ThreadMessage> = emptyList(),
    val element: MobileElement? = null,
    val selectedArea: SelectedArea? = null,
    val selectedText: String? = null,
    val createdAt: String,
    val updatedAt: String,
)

// MARK: Input types

@Serializable
data class CreateAnnotationInput(
    val sessionId: String,
    val x: Double,
    val y: Double,
    val deviceId: String,
    val platform: String = "android-native",
    val screenWidth: Int,
    val screenHeight: Int,
    val screenshotId: String? = null,
    val comment: String,
    val intent: AnnotationIntent,
    val severity: AnnotationSeverity,
    val element: MobileElement? = null,
    val selectedArea: SelectedArea? = null,
    val selectedText: String? = null,
)
