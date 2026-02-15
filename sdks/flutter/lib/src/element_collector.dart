import 'package:flutter/foundation.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';
import 'package:agentation_mobile/src/models.dart';

/// Collected element from the Flutter widget/render tree.
class CollectedElement {
  final String id;
  final String componentName;
  final String componentPath;
  final String? componentFile;
  final SourceLocation? sourceLocation;
  final BoundingBox boundingBox;
  final String? textContent;
  final Accessibility? accessibility;

  const CollectedElement({
    required this.id,
    required this.componentName,
    required this.componentPath,
    this.componentFile,
    this.sourceLocation,
    required this.boundingBox,
    this.textContent,
    this.accessibility,
  });

  MobileElement toMobileElement() {
    return MobileElement(
      id: id,
      platform: 'flutter',
      componentPath: componentPath,
      componentName: componentName,
      componentFile: componentFile,
      sourceLocation: sourceLocation,
      boundingBox: boundingBox,
      textContent: textContent,
      accessibility: accessibility,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'componentName': componentName,
        'componentPath': componentPath,
        if (componentFile != null) 'componentFile': componentFile,
        if (sourceLocation != null)
          'sourceLocation': sourceLocation!.toJson(),
        'boundingBox': boundingBox.toJson(),
        if (textContent != null) 'textContent': textContent,
        if (accessibility != null) 'accessibility': accessibility!.toJson(),
      };
}

/// Collects elements from the Flutter widget tree by walking the Element tree.
class ElementCollector {
  static final ElementCollector instance = ElementCollector._();

  ElementCollector._();

  /// Collect all visible elements from the current widget tree.
  List<CollectedElement> collectElements() {
    if (!kDebugMode) return [];

    final elements = <CollectedElement>[];
    final binding = WidgetsBinding.instance;

    try {
      final rootElement = binding.rootElement;
      if (rootElement != null) {
        _walkElement(rootElement, elements, <String>[]);
      }
    } catch (_) {
      // Tree walk failed — return what we have
    }

    return elements;
  }

  void _walkElement(
    Element element,
    List<CollectedElement> results,
    List<String> parentPath,
  ) {
    final widget = element.widget;
    final name = _getWidgetName(widget);

    // Skip internal Flutter framework widgets
    if (_isFrameworkWidget(name)) {
      element.visitChildren((child) {
        _walkElement(child, results, parentPath);
      });
      return;
    }

    final currentPath = [...parentPath, name];

    // Try to get render object bounds
    final renderObject = element.renderObject;
    if (renderObject is RenderBox && renderObject.hasSize) {
      try {
        final size = renderObject.size;
        final offset = renderObject.localToGlobal(Offset.zero);

        // Only include visible elements with non-zero size
        if (size.width > 0 && size.height > 0) {
          final collected = CollectedElement(
            id: 'flutter-${results.length}',
            componentName: name,
            componentPath: currentPath.join('/'),
            boundingBox: BoundingBox(
              x: offset.dx,
              y: offset.dy,
              width: size.width,
              height: size.height,
            ),
            textContent: _extractTextContent(widget),
            accessibility: _extractAccessibility(widget, element),
          );

          results.add(collected);
        }
      } catch (_) {
        // localToGlobal can fail if not attached
      }
    }

    // Recurse into children
    element.visitChildren((child) {
      _walkElement(child, results, currentPath);
    });
  }

  String _getWidgetName(Widget widget) {
    final type = widget.runtimeType.toString();
    // Clean up generic type parameters for readability
    final genericIdx = type.indexOf('<');
    if (genericIdx > 0) {
      return type.substring(0, genericIdx);
    }
    return type;
  }

  bool _isFrameworkWidget(String name) {
    const frameworkWidgets = {
      // Layout primitives
      'RenderObjectToWidgetAdapter',
      'View',
      'RawView',
      '_ViewScope',
      'MediaQuery',
      '_MediaQueryFromView',
      // Internal wrappers
      'Directionality',
      'Builder',
      'StatefulBuilder',
      'KeyedSubtree',
      'RepaintBoundary',
      'Offstage',
      '_OverlayEntryWidget',
      '_Theatre',
      '_TheatreChild',
      // Focus/shortcuts
      'Focus',
      'FocusScope',
      'FocusTraversalGroup',
      'Shortcuts',
      'Actions',
      'DefaultTextEditingShortcuts',
      // Semantics/accessibility internals
      'MergeSemantics',
      'BlockSemantics',
      'ExcludeSemantics',
      '_EffectiveTickerMode',
      'TickerMode',
      // Notification
      'NotificationListener',
      'ScrollNotificationObserver',
    };
    return frameworkWidgets.contains(name);
  }

  String? _extractTextContent(Widget widget) {
    if (widget is Text) {
      return widget.data ?? widget.textSpan?.toPlainText();
    }
    if (widget is RichText) {
      return widget.text.toPlainText();
    }
    if (widget is EditableText) {
      return widget.controller.text;
    }
    return null;
  }

  Accessibility? _extractAccessibility(Widget widget, Element element) {
    if (widget is Semantics) {
      final props = widget.properties;
      if (props.label != null || props.hint != null || props.value != null) {
        return Accessibility(
          label: props.label,
          hint: props.hint,
          value: props.value,
        );
      }
    }
    return null;
  }
}
