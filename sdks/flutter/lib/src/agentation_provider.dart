import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:agentation_mobile/src/models.dart';

/// Configuration for the agentation-mobile connection.
class AgentationConfig {
  /// Server URL, e.g. "http://192.168.1.5:4747"
  final String serverUrl;

  /// Device ID for this device
  final String? deviceId;

  /// Session ID to use
  final String? sessionId;

  /// Whether the overlay is enabled (defaults to kDebugMode)
  final bool enabled;

  const AgentationConfig({
    required this.serverUrl,
    this.deviceId,
    this.sessionId,
    bool? enabled,
  }) : enabled = enabled ?? kDebugMode;
}

/// Provides agentation-mobile context to descendant widgets.
///
/// Place this above [AgentationOverlay] in the widget tree.
///
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
  final HttpClient _httpClient = HttpClient();

  List<MobileAnnotation> get annotations => _annotations;
  bool get connected => _connected;
  AgentationConfig get config => widget.config;

  @override
  void initState() {
    super.initState();
    if (widget.config.enabled) {
      _startPolling();
    }
  }

  @override
  void didUpdateWidget(AgentationProvider oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.config.serverUrl != widget.config.serverUrl ||
        oldWidget.config.sessionId != widget.config.sessionId) {
      _stopPolling();
      if (widget.config.enabled) {
        _startPolling();
      }
    }
  }

  @override
  void dispose() {
    _stopPolling();
    _httpClient.close();
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

  Future<void> _fetchAnnotations() async {
    if (widget.config.sessionId == null) return;
    try {
      final uri = Uri.parse(
        '${widget.config.serverUrl}/api/annotations?sessionId=${widget.config.sessionId}',
      );
      final request = await _httpClient.getUrl(uri);
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
        }
      }
    } catch (_) {
      if (mounted) {
        setState(() => _connected = false);
      }
    }
  }

  /// Create a new annotation on the server.
  Future<void> createAnnotation({
    required double x,
    required double y,
    required String comment,
    AnnotationIntent intent = AnnotationIntent.fix,
    AnnotationSeverity severity = AnnotationSeverity.important,
  }) async {
    if (widget.config.sessionId == null) return;
    try {
      final uri = Uri.parse('${widget.config.serverUrl}/api/annotations');
      final request = await _httpClient.postUrl(uri);
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
