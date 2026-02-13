import 'package:flutter/material.dart';
import 'package:agentation_mobile/src/models.dart';

/// A colored pin that represents an annotation on screen.
class AnnotationPin extends StatelessWidget {
  final MobileAnnotation annotation;
  final int index;
  final VoidCallback onTap;

  const AnnotationPin({
    super.key,
    required this.annotation,
    required this.index,
    required this.onTap,
  });

  Color get _pinColor {
    switch (annotation.status) {
      case AnnotationStatus.pending:
        return Colors.amber;
      case AnnotationStatus.acknowledged:
        return Colors.blue;
      case AnnotationStatus.resolved:
        return Colors.green;
      case AnnotationStatus.dismissed:
        return Colors.grey;
    }
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 24,
        height: 24,
        decoration: BoxDecoration(
          color: _pinColor,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 2),
          boxShadow: const [
            BoxShadow(
              color: Colors.black26,
              blurRadius: 4,
              offset: Offset(0, 2),
            ),
          ],
        ),
        alignment: Alignment.center,
        child: Text(
          '${index + 1}',
          style: const TextStyle(
            color: Colors.white,
            fontSize: 10,
            fontWeight: FontWeight.bold,
            decoration: TextDecoration.none,
          ),
        ),
      ),
    );
  }
}
