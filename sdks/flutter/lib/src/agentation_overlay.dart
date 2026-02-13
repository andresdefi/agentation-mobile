import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:agentation_mobile/src/agentation_provider.dart';
import 'package:agentation_mobile/src/annotation_pin.dart';
import 'package:agentation_mobile/src/models.dart';

/// Transparent overlay that shows annotation pins and supports
/// long-press to create new annotations.
///
/// Must be a descendant of [AgentationProvider].
///
/// ```dart
/// AgentationProvider(
///   config: AgentationConfig(serverUrl: 'http://localhost:4747'),
///   child: AgentationOverlay(child: MyApp()),
/// )
/// ```
class AgentationOverlay extends StatefulWidget {
  final Widget child;

  const AgentationOverlay({
    super.key,
    required this.child,
  });

  @override
  State<AgentationOverlay> createState() => _AgentationOverlayState();
}

class _AgentationOverlayState extends State<AgentationOverlay> {
  bool _showForm = false;
  double _formX = 0;
  double _formY = 0;
  final TextEditingController _commentController = TextEditingController();
  AnnotationIntent _selectedIntent = AnnotationIntent.fix;
  AnnotationSeverity _selectedSeverity = AnnotationSeverity.important;

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  void _handleLongPress(LongPressStartDetails details) {
    if (!kDebugMode) return;
    final size = MediaQuery.of(context).size;
    setState(() {
      _formX = (details.localPosition.dx / size.width) * 100;
      _formY = (details.localPosition.dy / size.height) * 100;
      _showForm = true;
      _commentController.clear();
      _selectedIntent = AnnotationIntent.fix;
      _selectedSeverity = AnnotationSeverity.important;
    });
  }

  void _handleSubmit() {
    final comment = _commentController.text.trim();
    if (comment.isEmpty) return;
    final state = AgentationProvider.maybeOf(context);
    if (state == null) return;

    state.createAnnotation(
      x: _formX,
      y: _formY,
      comment: comment,
      intent: _selectedIntent,
      severity: _selectedSeverity,
    );

    setState(() => _showForm = false);
  }

  void _showAnnotationDetail(MobileAnnotation annotation) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1A1A1A),
        title: Text(
          annotation.comment,
          style: const TextStyle(color: Colors.white, fontSize: 14),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _detailRow('Status', annotation.status.name),
            _detailRow('Intent', annotation.intent.name),
            _detailRow('Severity', annotation.severity.name),
            _detailRow(
              'Position',
              '${annotation.x.toStringAsFixed(1)}%, ${annotation.y.toStringAsFixed(1)}%',
            ),
            if (annotation.thread.isNotEmpty)
              _detailRow('Replies', '${annotation.thread.length}'),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  Widget _detailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Text(
            '$label: ',
            style: const TextStyle(color: Colors.grey, fontSize: 12),
          ),
          Text(
            value,
            style: const TextStyle(color: Colors.white70, fontSize: 12),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!kDebugMode) return widget.child;

    final state = AgentationProvider.maybeOf(context);
    final annotations = state?.annotations ?? [];

    return Stack(
      children: [
        // App content
        widget.child,

        // Long-press detector overlay
        Positioned.fill(
          child: GestureDetector(
            behavior: HitTestBehavior.translucent,
            onLongPressStart: _handleLongPress,
          ),
        ),

        // Annotation pins
        for (var i = 0; i < annotations.length; i++)
          Positioned(
            left: (annotations[i].x / 100) * MediaQuery.of(context).size.width - 12,
            top: (annotations[i].y / 100) * MediaQuery.of(context).size.height - 12,
            child: AnnotationPin(
              annotation: annotations[i],
              index: i,
              onTap: () => _showAnnotationDetail(annotations[i]),
            ),
          ),

        // Annotation form modal
        if (_showForm)
          Positioned.fill(
            child: GestureDetector(
              onTap: () => setState(() => _showForm = false),
              child: Container(
                color: Colors.black54,
                alignment: Alignment.center,
                child: GestureDetector(
                  onTap: () {}, // Prevent dismiss on form tap
                  child: Container(
                    margin: const EdgeInsets.all(32),
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: const Color(0xFF1A1A1A),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFF333333)),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text(
                              'New Annotation',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 16,
                                fontWeight: FontWeight.w600,
                                decoration: TextDecoration.none,
                              ),
                            ),
                            Text(
                              '${_formX.toStringAsFixed(1)}%, ${_formY.toStringAsFixed(1)}%',
                              style: const TextStyle(
                                color: Colors.grey,
                                fontSize: 11,
                                fontFamily: 'monospace',
                                decoration: TextDecoration.none,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Material(
                          color: Colors.transparent,
                          child: TextField(
                            controller: _commentController,
                            autofocus: true,
                            maxLines: 3,
                            style: const TextStyle(color: Colors.white, fontSize: 14),
                            decoration: InputDecoration(
                              hintText: 'Describe the issue or feedback...',
                              hintStyle: const TextStyle(color: Colors.grey),
                              filled: true,
                              fillColor: const Color(0xFF0A0A0A),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(8),
                                borderSide:
                                    const BorderSide(color: Color(0xFF333333)),
                              ),
                              enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(8),
                                borderSide:
                                    const BorderSide(color: Color(0xFF333333)),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                        // Intent selector
                        _chipSelector<AnnotationIntent>(
                          'Intent',
                          AnnotationIntent.values,
                          _selectedIntent,
                          (v) => setState(() => _selectedIntent = v),
                        ),
                        const SizedBox(height: 8),
                        // Severity selector
                        _chipSelector<AnnotationSeverity>(
                          'Severity',
                          AnnotationSeverity.values,
                          _selectedSeverity,
                          (v) => setState(() => _selectedSeverity = v),
                        ),
                        const SizedBox(height: 16),
                        Row(
                          children: [
                            Expanded(
                              child: Material(
                                color: Colors.transparent,
                                child: OutlinedButton(
                                  onPressed: () =>
                                      setState(() => _showForm = false),
                                  style: OutlinedButton.styleFrom(
                                    foregroundColor: Colors.grey,
                                    side: const BorderSide(
                                        color: Color(0xFF333333)),
                                  ),
                                  child: const Text('Cancel'),
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Material(
                                color: Colors.transparent,
                                child: ElevatedButton(
                                  onPressed: _handleSubmit,
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: Colors.white,
                                    foregroundColor: Colors.black,
                                  ),
                                  child: const Text('Create'),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _chipSelector<T extends Enum>(
    String label,
    List<T> values,
    T selected,
    ValueChanged<T> onSelected,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: Colors.grey,
            fontSize: 11,
            fontWeight: FontWeight.w500,
            decoration: TextDecoration.none,
          ),
        ),
        const SizedBox(height: 4),
        Wrap(
          spacing: 6,
          children: values.map((v) {
            final isActive = v == selected;
            return GestureDetector(
              onTap: () => onSelected(v),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: isActive ? const Color(0xFF333333) : const Color(0xFF0A0A0A),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: isActive ? Colors.grey : const Color(0xFF333333),
                  ),
                ),
                child: Text(
                  v.name[0].toUpperCase() + v.name.substring(1),
                  style: TextStyle(
                    color: isActive ? Colors.white : Colors.grey,
                    fontSize: 12,
                    decoration: TextDecoration.none,
                  ),
                ),
              ),
            );
          }).toList(),
        ),
      ],
    );
  }
}
