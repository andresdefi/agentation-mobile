import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';
import 'package:agentation_mobile/src/models.dart';

/// Tracks detected animations from Flutter's animation system.
class DetectedAnimation {
  final String id;
  final String type; // timing, spring, tween, curve, repeat
  final String property;
  String status; // running, completed, dismissed
  final int startedAt;
  final int? duration;
  final double? fromValue;
  final double? toValue;
  final String? curve;
  final String? sourceFile;
  final int? sourceLine;
  final Map<String, dynamic> config;

  DetectedAnimation({
    required this.id,
    required this.type,
    required this.property,
    this.status = 'running',
    required this.startedAt,
    this.duration,
    this.fromValue,
    this.toValue,
    this.curve,
    this.sourceFile,
    this.sourceLine,
    this.config = const {},
  });

  AnimationInfo toAnimationInfo() {
    return AnimationInfo(
      type: type,
      property: property,
      status: status,
      duration: duration?.toDouble(),
      sourceLocation: sourceFile != null
          ? SourceLocation(file: sourceFile!, line: sourceLine ?? 0)
          : null,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type,
        'property': property,
        'status': status,
        'startedAt': startedAt,
        if (duration != null) 'duration': duration,
        if (fromValue != null) 'fromValue': fromValue,
        if (toValue != null) 'toValue': toValue,
        if (curve != null) 'curve': curve,
        if (sourceFile != null) 'sourceFile': sourceFile,
        if (sourceLine != null) 'sourceLine': sourceLine,
        'config': config,
      };
}

/// Global animation detector that hooks into Flutter's animation system.
class AnimationDetector {
  static final AnimationDetector instance = AnimationDetector._();

  AnimationDetector._();

  final Map<String, DetectedAnimation> _activeAnimations = {};
  final List<VoidCallback> _listeners = [];
  int _counter = 0;
  bool _installed = false;

  /// Install animation detection hooks.
  void install() {
    if (_installed || !kDebugMode) return;
    _installed = true;
  }

  /// Uninstall and clean up.
  void uninstall() {
    _installed = false;
    _activeAnimations.clear();
  }

  /// Register an AnimationController for tracking.
  /// Call this from a widget's initState or build method.
  String trackController(
    AnimationController controller, {
    String property = 'unknown',
    String? sourceFile,
    int? sourceLine,
  }) {
    if (!_installed) return '';

    final id = 'anim-${++_counter}-${DateTime.now().millisecondsSinceEpoch}';

    final detected = DetectedAnimation(
      id: id,
      type: _inferAnimationType(controller),
      property: property,
      status: controller.isAnimating ? 'running' : 'completed',
      startedAt: DateTime.now().millisecondsSinceEpoch,
      duration: controller.duration?.inMilliseconds,
      fromValue: controller.lowerBound,
      toValue: controller.upperBound,
      curve: 'linear',
      sourceFile: sourceFile,
      sourceLine: sourceLine,
    );

    _activeAnimations[id] = detected;

    // Listen for status changes
    void statusListener(AnimationStatus status) {
      switch (status) {
        case AnimationStatus.forward:
        case AnimationStatus.reverse:
          detected.status = 'running';
          break;
        case AnimationStatus.completed:
        case AnimationStatus.dismissed:
          detected.status = status == AnimationStatus.completed
              ? 'completed'
              : 'stopped';
          // Auto-remove after a delay
          Future.delayed(const Duration(seconds: 2), () {
            _activeAnimations.remove(id);
            _notifyListeners();
          });
          break;
      }
      _notifyListeners();
    }

    controller.addStatusListener(statusListener);

    _notifyListeners();
    return id;
  }

  /// Manually register an animation (for implicit animations, Hero, etc.).
  String registerAnimation({
    required String type,
    required String property,
    int? duration,
    double? fromValue,
    double? toValue,
    String? curve,
    String? sourceFile,
    int? sourceLine,
  }) {
    if (!_installed) return '';

    final id = 'anim-${++_counter}-${DateTime.now().millisecondsSinceEpoch}';

    final detected = DetectedAnimation(
      id: id,
      type: type,
      property: property,
      status: 'running',
      startedAt: DateTime.now().millisecondsSinceEpoch,
      duration: duration,
      fromValue: fromValue,
      toValue: toValue,
      curve: curve,
      sourceFile: sourceFile,
      sourceLine: sourceLine,
    );

    _activeAnimations[id] = detected;

    // Auto-complete after duration
    if (duration != null) {
      Future.delayed(Duration(milliseconds: duration), () {
        detected.status = 'completed';
        _notifyListeners();
        Future.delayed(const Duration(seconds: 2), () {
          _activeAnimations.remove(id);
          _notifyListeners();
        });
      });
    }

    _notifyListeners();
    return id;
  }

  /// Get all currently active/recent animations.
  List<DetectedAnimation> get activeAnimations =>
      _activeAnimations.values.toList();

  /// Subscribe to animation state changes.
  void addListener(VoidCallback callback) {
    _listeners.add(callback);
  }

  /// Unsubscribe from animation state changes.
  void removeListener(VoidCallback callback) {
    _listeners.remove(callback);
  }

  void _notifyListeners() {
    for (final listener in _listeners) {
      listener();
    }
  }

  String _inferAnimationType(AnimationController controller) {
    if (controller.isCompleted || controller.isDismissed) {
      return 'timing';
    }
    // Check if it's repeating
    return 'timing';
  }
}

/// Widget wrapper that auto-tracks an AnimationController.
class AgentationAnimationTracker extends StatefulWidget {
  final AnimationController controller;
  final String property;
  final String? sourceFile;
  final int? sourceLine;
  final Widget child;

  const AgentationAnimationTracker({
    super.key,
    required this.controller,
    required this.property,
    this.sourceFile,
    this.sourceLine,
    required this.child,
  });

  @override
  State<AgentationAnimationTracker> createState() =>
      _AgentationAnimationTrackerState();
}

class _AgentationAnimationTrackerState
    extends State<AgentationAnimationTracker> {
  String? _trackingId;

  @override
  void initState() {
    super.initState();
    _trackingId = AnimationDetector.instance.trackController(
      widget.controller,
      property: widget.property,
      sourceFile: widget.sourceFile,
      sourceLine: widget.sourceLine,
    );
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
