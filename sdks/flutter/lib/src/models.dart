/// Data models for agentation-mobile annotations.
/// Mirrors the core TypeScript schemas for full SDK parity.

enum AnnotationStatus { pending, acknowledged, resolved, dismissed }

enum AnnotationIntent { fix, change, question, approve }

enum AnnotationSeverity { blocking, important, suggestion }

class BoundingBox {
  final double x;
  final double y;
  final double width;
  final double height;

  const BoundingBox({
    required this.x,
    required this.y,
    required this.width,
    required this.height,
  });

  factory BoundingBox.fromJson(Map<String, dynamic> json) {
    return BoundingBox(
      x: (json['x'] as num).toDouble(),
      y: (json['y'] as num).toDouble(),
      width: (json['width'] as num).toDouble(),
      height: (json['height'] as num).toDouble(),
    );
  }

  Map<String, dynamic> toJson() => {
        'x': x,
        'y': y,
        'width': width,
        'height': height,
      };
}

class Accessibility {
  final String? label;
  final String? role;
  final String? hint;
  final String? value;
  final List<String>? traits;

  const Accessibility({this.label, this.role, this.hint, this.value, this.traits});

  factory Accessibility.fromJson(Map<String, dynamic> json) {
    return Accessibility(
      label: json['label'] as String?,
      role: json['role'] as String?,
      hint: json['hint'] as String?,
      value: json['value'] as String?,
      traits: (json['traits'] as List<dynamic>?)?.cast<String>(),
    );
  }

  Map<String, dynamic> toJson() => {
        if (label != null) 'label': label,
        if (role != null) 'role': role,
        if (hint != null) 'hint': hint,
        if (value != null) 'value': value,
        if (traits != null) 'traits': traits,
      };
}

class SourceLocation {
  final String file;
  final int line;
  final int? column;

  const SourceLocation({
    required this.file,
    required this.line,
    this.column,
  });

  factory SourceLocation.fromJson(Map<String, dynamic> json) {
    return SourceLocation(
      file: json['file'] as String,
      line: json['line'] as int,
      column: json['column'] as int?,
    );
  }

  Map<String, dynamic> toJson() => {
        'file': file,
        'line': line,
        if (column != null) 'column': column,
      };
}

class AnimationInfo {
  final String type;
  final String property;
  final String? status;
  final double? duration;
  final SourceLocation? sourceLocation;

  const AnimationInfo({
    this.type = 'unknown',
    required this.property,
    this.status,
    this.duration,
    this.sourceLocation,
  });

  factory AnimationInfo.fromJson(Map<String, dynamic> json) {
    return AnimationInfo(
      type: json['type'] as String? ?? 'unknown',
      property: json['property'] as String,
      status: json['status'] as String?,
      duration: (json['duration'] as num?)?.toDouble(),
      sourceLocation: json['sourceLocation'] != null
          ? SourceLocation.fromJson(json['sourceLocation'] as Map<String, dynamic>)
          : null,
    );
  }

  Map<String, dynamic> toJson() => {
        'type': type,
        'property': property,
        if (status != null) 'status': status,
        if (duration != null) 'duration': duration,
        if (sourceLocation != null) 'sourceLocation': sourceLocation!.toJson(),
      };
}

class MobileElement {
  final String id;
  final String platform;
  final String componentPath;
  final String componentName;
  final String? componentFile;
  final SourceLocation? sourceLocation;
  final BoundingBox boundingBox;
  final Map<String, dynamic>? styleProps;
  final Accessibility? accessibility;
  final String? textContent;
  final String? nearbyText;
  final List<AnimationInfo>? animations;

  const MobileElement({
    required this.id,
    required this.platform,
    required this.componentPath,
    required this.componentName,
    this.componentFile,
    this.sourceLocation,
    required this.boundingBox,
    this.styleProps,
    this.accessibility,
    this.textContent,
    this.nearbyText,
    this.animations,
  });

  factory MobileElement.fromJson(Map<String, dynamic> json) {
    return MobileElement(
      id: json['id'] as String,
      platform: json['platform'] as String,
      componentPath: json['componentPath'] as String,
      componentName: json['componentName'] as String,
      componentFile: json['componentFile'] as String?,
      sourceLocation: json['sourceLocation'] != null
          ? SourceLocation.fromJson(json['sourceLocation'] as Map<String, dynamic>)
          : null,
      boundingBox: BoundingBox.fromJson(json['boundingBox'] as Map<String, dynamic>),
      styleProps: json['styleProps'] as Map<String, dynamic>?,
      accessibility: json['accessibility'] != null
          ? Accessibility.fromJson(json['accessibility'] as Map<String, dynamic>)
          : null,
      textContent: json['textContent'] as String?,
      nearbyText: json['nearbyText'] as String?,
      animations: (json['animations'] as List<dynamic>?)
          ?.map((a) => AnimationInfo.fromJson(a as Map<String, dynamic>))
          .toList(),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'platform': platform,
        'componentPath': componentPath,
        'componentName': componentName,
        if (componentFile != null) 'componentFile': componentFile,
        if (sourceLocation != null) 'sourceLocation': sourceLocation!.toJson(),
        'boundingBox': boundingBox.toJson(),
        if (styleProps != null) 'styleProps': styleProps,
        if (accessibility != null) 'accessibility': accessibility!.toJson(),
        if (textContent != null) 'textContent': textContent,
        if (nearbyText != null) 'nearbyText': nearbyText,
        if (animations != null) 'animations': animations!.map((a) => a.toJson()).toList(),
      };
}

class SelectedArea {
  final double x;
  final double y;
  final double width;
  final double height;

  const SelectedArea({
    required this.x,
    required this.y,
    required this.width,
    required this.height,
  });

  factory SelectedArea.fromJson(Map<String, dynamic> json) {
    return SelectedArea(
      x: (json['x'] as num).toDouble(),
      y: (json['y'] as num).toDouble(),
      width: (json['width'] as num).toDouble(),
      height: (json['height'] as num).toDouble(),
    );
  }

  Map<String, dynamic> toJson() => {
        'x': x,
        'y': y,
        'width': width,
        'height': height,
      };
}

class ThreadMessage {
  final String role;
  final String content;
  final String timestamp;

  const ThreadMessage({
    required this.role,
    required this.content,
    required this.timestamp,
  });

  factory ThreadMessage.fromJson(Map<String, dynamic> json) {
    return ThreadMessage(
      role: json['role'] as String,
      content: json['content'] as String,
      timestamp: json['timestamp'] as String,
    );
  }

  Map<String, dynamic> toJson() => {
        'role': role,
        'content': content,
        'timestamp': timestamp,
      };
}

class MobileAnnotation {
  final String id;
  final String sessionId;
  final double x;
  final double y;
  final String deviceId;
  final String platform;
  final int screenWidth;
  final int screenHeight;
  final String? screenshotId;
  final String? resolvedScreenshotId;
  final String comment;
  final AnnotationIntent intent;
  final AnnotationSeverity severity;
  final AnnotationStatus status;
  final List<ThreadMessage> thread;
  final MobileElement? element;
  final SelectedArea? selectedArea;
  final String? selectedText;
  final String createdAt;
  final String updatedAt;

  const MobileAnnotation({
    required this.id,
    required this.sessionId,
    required this.x,
    required this.y,
    required this.deviceId,
    required this.platform,
    required this.screenWidth,
    required this.screenHeight,
    this.screenshotId,
    this.resolvedScreenshotId,
    required this.comment,
    required this.intent,
    required this.severity,
    required this.status,
    required this.thread,
    this.element,
    this.selectedArea,
    this.selectedText,
    required this.createdAt,
    required this.updatedAt,
  });

  factory MobileAnnotation.fromJson(Map<String, dynamic> json) {
    return MobileAnnotation(
      id: json['id'] as String,
      sessionId: json['sessionId'] as String,
      x: (json['x'] as num).toDouble(),
      y: (json['y'] as num).toDouble(),
      deviceId: json['deviceId'] as String,
      platform: json['platform'] as String,
      screenWidth: json['screenWidth'] as int,
      screenHeight: json['screenHeight'] as int,
      screenshotId: json['screenshotId'] as String?,
      resolvedScreenshotId: json['resolvedScreenshotId'] as String?,
      comment: json['comment'] as String,
      intent: AnnotationIntent.values.firstWhere(
        (e) => e.name == json['intent'],
        orElse: () => AnnotationIntent.fix,
      ),
      severity: AnnotationSeverity.values.firstWhere(
        (e) => e.name == json['severity'],
        orElse: () => AnnotationSeverity.important,
      ),
      status: AnnotationStatus.values.firstWhere(
        (e) => e.name == json['status'],
        orElse: () => AnnotationStatus.pending,
      ),
      thread: (json['thread'] as List<dynamic>?)
              ?.map((t) => ThreadMessage.fromJson(t as Map<String, dynamic>))
              .toList() ??
          [],
      element: json['element'] != null
          ? MobileElement.fromJson(json['element'] as Map<String, dynamic>)
          : null,
      selectedArea: json['selectedArea'] != null
          ? SelectedArea.fromJson(json['selectedArea'] as Map<String, dynamic>)
          : null,
      selectedText: json['selectedText'] as String?,
      createdAt: json['createdAt'] as String,
      updatedAt: json['updatedAt'] as String,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'sessionId': sessionId,
        'x': x,
        'y': y,
        'deviceId': deviceId,
        'platform': platform,
        'screenWidth': screenWidth,
        'screenHeight': screenHeight,
        if (screenshotId != null) 'screenshotId': screenshotId,
        if (resolvedScreenshotId != null) 'resolvedScreenshotId': resolvedScreenshotId,
        'comment': comment,
        'intent': intent.name,
        'severity': severity.name,
        'status': status.name,
        'thread': thread.map((t) => t.toJson()).toList(),
        if (element != null) 'element': element!.toJson(),
        if (selectedArea != null) 'selectedArea': selectedArea!.toJson(),
        if (selectedText != null) 'selectedText': selectedText,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
      };
}
