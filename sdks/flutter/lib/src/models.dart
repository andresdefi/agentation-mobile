/// Data models for agentation-mobile annotations.

enum AnnotationStatus { pending, acknowledged, resolved, dismissed }

enum AnnotationIntent { fix, change, question, approve }

enum AnnotationSeverity { blocking, important, suggestion }

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
  final String comment;
  final AnnotationIntent intent;
  final AnnotationSeverity severity;
  final AnnotationStatus status;
  final List<ThreadMessage> thread;
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
    required this.comment,
    required this.intent,
    required this.severity,
    required this.status,
    required this.thread,
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
      createdAt: json['createdAt'] as String,
      updatedAt: json['updatedAt'] as String,
    );
  }
}
