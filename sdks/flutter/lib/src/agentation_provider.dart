import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:agentation_mobile/src/models.dart';
import 'package:agentation_mobile/src/animation_detector.dart';
import 'package:agentation_mobile/src/element_collector.dart';

const _storageKey = 'agentation_mobile_annotations';

/// Configuration for the agentation-mobile connection.
class AgentationConfig {
  /// Server URL, e.g. "http://192.168.1.5:4747".
  /// If null, runs in local-only mode (annotations stored on device).
  final String? serverUrl;

  /// Device ID for this device
  final String? deviceId;

  /// Session ID to use
  final String? sessionId;

  /// Whether the overlay is enabled (defaults to kDebugMode)
  final bool enabled;

  const AgentationConfig({
    this.serverUrl,
    this.deviceId,
    this.sessionId,
    bool? enabled,
  }) : enabled = enabled ?? kDebugMode;
}

/// Provides agentation-mobile context to descendant widgets.
///
/// Place this above [AgentationOverlay] in the widget tree.
///
/// Local mode (no server needed):
/// ```dart
/// AgentationProvider(
///   config: AgentationConfig(),
///   child: AgentationOverlay(child: MyApp()),
/// )
/// ```
///
/// Server mode:
/// ```dart
/// AgentationProvider(
///   config: AgentationConfig(serverUrl: 'http://localhost:4747'),
///   child: AgentationOverlay(child: MyApp()),
/// )
/// ```
class AgentationProvider extends StatefulWidget {
  final AgentationConfig config;
  final Widget child;

  const AgentationProvider({
    super.key,
    required this.config,
    required this.child,
  });

  static AgentationState? maybeOf(BuildContext context) {
    return context.findAncestorStateOfType<AgentationState>();
  }

  static AgentationState of(BuildContext context) {
    final state = maybeOf(context);
    assert(state != null, 'No AgentationProvider found in context');
    return state!;
  }

  @override
  State<AgentationProvider> createState() => AgentationState();
}

class AgentationState extends State<AgentationProvider> {
  List<MobileAnnotation> _annotations = [];
  bool _connected = false;
  Timer? _pollTimer;
  Timer? _reportTimer;
  HttpClient? _httpClient;
  SharedPreferences? _prefs;
  List<DetectedAnimation> _activeAnimations = [];
  List<CollectedElement> _collectedElements = [];
  VoidCallback? _animationListener;

  List<MobileAnnotation> get annotations => _annotations;
  bool get connected => localMode ? true : _connected;
  bool get localMode => widget.config.serverUrl == null;
  AgentationConfig get config => widget.config;

  /// Currently active/recent animations detected in the app.
  List<DetectedAnimation> get activeAnimations => _activeAnimations;

  /// Collected element tree from the widget tree.
  List<CollectedElement> get collectedElements => _collectedElements;

  @override
  void initState() {
    super.initState();
    if (widget.config.enabled) {
      _initialize();
    }
  }

  Future<void> _initialize() async {
    // Load from local storage first
    _prefs = await SharedPreferences.getInstance();
    _loadFromStorage();

    // Install animation detector
    AnimationDetector.instance.install();
    _animationListener = () {
      if (mounted) {
        setState(() {
          _activeAnimations = AnimationDetector.instance.activeAnimations;
        });
      }
    };
    AnimationDetector.instance.addListener(_animationListener!);

    // If server mode, start polling and reporting
    if (!localMode) {
      _httpClient = HttpClient();
      _startPolling();
      _startReporting();
    }
  }

  void _loadFromStorage() {
    final stored = _prefs?.getString(_storageKey);
    if (stored != null && mounted) {
      try {
        final list = jsonDecode(stored) as List<dynamic>;
        setState(() {
          _annotations = list
              .map((j) => MobileAnnotation.fromJson(j as Map<String, dynamic>))
              .toList();
        });
      } catch (_) {
        // Ignore corrupted storage
      }
    }
  }

  void _saveToStorage() {
    final data = jsonEncode(_annotations.map((a) => a.toJson()).toList());
    _prefs?.setString(_storageKey, data);
  }

  @override
  void didUpdateWidget(AgentationProvider oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.config.serverUrl != widget.config.serverUrl ||
        oldWidget.config.sessionId != widget.config.sessionId) {
      _stopPolling();
      if (widget.config.enabled && !localMode) {
        _httpClient ??= HttpClient();
        _startPolling();
      }
    }
  }

  @override
  void dispose() {
    _stopPolling();
    _stopReporting();
    if (_animationListener != null) {
      AnimationDetector.instance.removeListener(_animationListener!);
    }
    AnimationDetector.instance.uninstall();
    _httpClient?.close();
    super.dispose();
  }

  void _startPolling() {
    _fetchAnnotations();
    _pollTimer = Timer.periodic(
      const Duration(seconds: 3),
      (_) => _fetchAnnotations(),
    );
  }

  void _stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  void _startReporting() {
    _reportTimer = Timer.periodic(
      const Duration(seconds: 1),
      (_) => _reportToBackend(),
    );
  }

  void _stopReporting() {
    _reportTimer?.cancel();
    _reportTimer = null;
  }

  Future<void> _reportToBackend() async {
    if (_httpClient == null || !mounted) return;

    try {
      // Collect element tree
      final elements = ElementCollector.instance.collectElements();
      if (mounted) {
        _collectedElements = elements;
      }

      // Get active animations
      final animations = AnimationDetector.instance.activeAnimations;

      if (animations.isEmpty && elements.isEmpty) return;

      final deviceId = widget.config.deviceId ?? 'flutter-device';
      final uri = Uri.parse(
        '${widget.config.serverUrl}/api/devices/${Uri.encodeComponent(deviceId)}/sdk-report',
      );
      final request = await _httpClient!.postUrl(uri);
      request.headers.set('Content-Type', 'application/json');
      request.write(jsonEncode({
        'animations': animations.map((a) => a.toJson()).toList(),
        'elements': elements.map((e) => e.toJson()).toList(),
        'timestamp': DateTime.now().millisecondsSinceEpoch,
      }));
      await request.close();
    } catch (_) {
      // Silently ignore — server may be unreachable
    }
  }

  Future<void> _fetchAnnotations() async {
    if (widget.config.sessionId == null || _httpClient == null) return;
    try {
      final uri = Uri.parse(
        '${widget.config.serverUrl}/api/annotations?sessionId=${widget.config.sessionId}',
      );
      final request = await _httpClient!.getUrl(uri);
      final response = await request.close();
      if (response.statusCode == 200) {
        final body = await response.transform(utf8.decoder).join();
        final list = jsonDecode(body) as List<dynamic>;
        if (mounted) {
          setState(() {
            _annotations = list
                .map((j) => MobileAnnotation.fromJson(j as Map<String, dynamic>))
                .toList();
            _connected = true;
          });
          _saveToStorage();
        }
      }
    } catch (_) {
      if (mounted) {
        setState(() => _connected = false);
      }
    }
  }

  /// Create a new annotation. Works in both local and server mode.
  Future<void> createAnnotation({
    required double x,
    required double y,
    required String comment,
    AnnotationIntent intent = AnnotationIntent.fix,
    AnnotationSeverity severity = AnnotationSeverity.important,
  }) async {
    if (localMode) {
      // Local-only mode: create annotation locally
      final now = DateTime.now().toUtc().toIso8601String();
      final annotation = MobileAnnotation(
        id: '${DateTime.now().millisecondsSinceEpoch}-${(DateTime.now().microsecond).toRadixString(36)}',
        sessionId: widget.config.sessionId ?? 'local',
        x: x,
        y: y,
        deviceId: widget.config.deviceId ?? 'flutter-device',
        platform: 'flutter',
        screenWidth: 0,
        screenHeight: 0,
        comment: comment,
        intent: intent,
        severity: severity,
        status: AnnotationStatus.pending,
        thread: [],
        createdAt: now,
        updatedAt: now,
      );
      if (mounted) {
        setState(() => _annotations = [..._annotations, annotation]);
        _saveToStorage();
      }
    } else {
      // Server mode: POST to server
      if (widget.config.sessionId == null || _httpClient == null) return;
      try {
        final uri = Uri.parse('${widget.config.serverUrl}/api/annotations');
        final request = await _httpClient!.postUrl(uri);
        request.headers.set('Content-Type', 'application/json');
        request.write(jsonEncode({
          'sessionId': widget.config.sessionId,
          'x': x,
          'y': y,
          'deviceId': widget.config.deviceId ?? 'flutter-device',
          'platform': 'flutter',
          'screenWidth': 0,
          'screenHeight': 0,
          'comment': comment,
          'intent': intent.name,
          'severity': severity.name,
        }));
        await request.close();
        await _fetchAnnotations();
      } catch (_) {
        // Silently fail — dev tool
      }
    }
  }

  /// Export all annotations as structured text for pasting into AI tools.
  String exportAnnotations() {
    final lines = <String>[];
    lines.add('# ${_annotations.length} annotations');
    lines.add('');

    for (var i = 0; i < _annotations.length; i++) {
      final a = _annotations[i];
      var ref = '${i + 1}. [${a.intent.name}/${a.severity.name}]';
      if (a.element?.componentName != null) {
        ref += ' ${a.element!.componentName}';
        if (a.element!.componentFile != null) {
          ref += ' (${a.element!.componentFile})';
        }
      }
      lines.add(ref);
      lines.add('   ${a.comment}');
      lines.add('   Status: ${a.status.name} | Position: ${a.x.toStringAsFixed(1)}%, ${a.y.toStringAsFixed(1)}%');
      if (a.selectedText != null) {
        lines.add('   Text: "${a.selectedText}"');
      }
      lines.add('');
    }

    return lines.join('\n').trimRight();
  }

  @override
  Widget build(BuildContext context) {
    return _AgentationInherited(
      state: this,
      child: widget.child,
    );
  }
}

class _AgentationInherited extends InheritedWidget {
  final AgentationState state;

  const _AgentationInherited({
    required this.state,
    required super.child,
  });

  @override
  bool updateShouldNotify(_AgentationInherited oldWidget) => true;
}
