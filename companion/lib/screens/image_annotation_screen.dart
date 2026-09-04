import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import '../theme/app_theme.dart';
import '../l10n/app_localizations.dart';

enum AnnotationTool { draw, arrow, box }

class AnnotatedImage {
  final Uint8List bytes;
  final String filename;

  const AnnotatedImage({required this.bytes, required this.filename});
}

class _Mark {
  final AnnotationTool tool;
  final List<Offset> points;

  const _Mark(this.tool, this.points);
}

class ImageAnnotationScreen extends StatefulWidget {
  final String imagePath;
  final String filename;

  const ImageAnnotationScreen({
    super.key,
    required this.imagePath,
    required this.filename,
  });

  @override
  State<ImageAnnotationScreen> createState() => _ImageAnnotationScreenState();
}

class _ImageAnnotationScreenState extends State<ImageAnnotationScreen> {
  final _boundaryKey = GlobalKey();
  final List<_Mark> _marks = [];
  AnnotationTool _tool = AnnotationTool.draw;
  List<Offset>? _activePoints;
  bool _saving = false;

  void _start(DragStartDetails details) {
    setState(() {
      _activePoints = [details.localPosition];
      _marks.add(_Mark(_tool, _activePoints!));
    });
  }

  void _update(DragUpdateDetails details) {
    setState(() {
      final points = _activePoints;
      if (points == null) return;
      if (_tool == AnnotationTool.draw) {
        points.add(details.localPosition);
      } else if (points.length == 1) {
        points.add(details.localPosition);
      } else {
        points[1] = details.localPosition;
      }
    });
  }

  Future<void> _finish() async {
    final points = _activePoints;
    _activePoints = null;
    if (points == null || points.length < 2) {
      setState(() => _marks.removeLast());
    }
  }

  Future<void> _save() async {
    final strings = AppLocalizations.of(context);
    if (_saving) return;
    setState(() => _saving = true);
    try {
      final boundary =
          _boundaryKey.currentContext?.findRenderObject()
              as RenderRepaintBoundary?;
      if (boundary == null) throw StateError(strings.imageEditorNotReady);
      final image = await boundary.toImage(pixelRatio: 2);
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      image.dispose();
      if (data == null) {
        throw StateError(strings.imageEncodeFailed);
      }
      if (!mounted) return;
      Navigator.pop(
        context,
        AnnotatedImage(
          bytes: data.buffer.asUint8List(),
          filename: _annotatedName(widget.filename),
        ),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(strings.markUpImage),
        actions: [
          IconButton(
            tooltip: strings.undo,
            onPressed: _marks.isEmpty
                ? null
                : () => setState(_marks.removeLast),
            icon: const Icon(Icons.undo_rounded),
          ),
          TextButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(strings.useImage),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(10),
            child: SegmentedButton<AnnotationTool>(
              segments: [
                ButtonSegment(
                  value: AnnotationTool.draw,
                  icon: const Icon(Icons.draw_rounded),
                  label: Text(strings.draw),
                ),
                ButtonSegment(
                  value: AnnotationTool.arrow,
                  icon: const Icon(Icons.arrow_outward_rounded),
                  label: Text(strings.arrow),
                ),
                ButtonSegment(
                  value: AnnotationTool.box,
                  icon: const Icon(Icons.crop_square_rounded),
                  label: Text(strings.box),
                ),
              ],
              selected: {_tool},
              onSelectionChanged: (selection) =>
                  setState(() => _tool = selection.first),
            ),
          ),
          Expanded(
            child: Center(
              child: RepaintBoundary(
                key: _boundaryKey,
                child: GestureDetector(
                  onPanStart: _start,
                  onPanUpdate: _update,
                  onPanEnd: (_) => _finish(),
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      ColoredBox(
                        color: Colors.black,
                        child: Image.file(
                          File(widget.imagePath),
                          fit: BoxFit.contain,
                        ),
                      ),
                      CustomPaint(painter: _AnnotationPainter(_marks)),
                    ],
                  ),
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 10, 18, 18),
            child: Text(
              strings.draftSafety,
              style: const TextStyle(color: AppPalette.textMuted),
            ),
          ),
        ],
      ),
    );
  }
}

class _AnnotationPainter extends CustomPainter {
  final List<_Mark> marks;

  const _AnnotationPainter(this.marks);

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AppPalette.amber
      ..strokeWidth = 5
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;
    for (final mark in marks) {
      if (mark.points.length < 2) continue;
      switch (mark.tool) {
        case AnnotationTool.draw:
          final path = Path()
            ..moveTo(mark.points.first.dx, mark.points.first.dy);
          for (final point in mark.points.skip(1)) {
            path.lineTo(point.dx, point.dy);
          }
          canvas.drawPath(path, paint);
        case AnnotationTool.box:
          canvas.drawRect(
            Rect.fromPoints(mark.points.first, mark.points.last),
            paint,
          );
        case AnnotationTool.arrow:
          final start = mark.points.first;
          final end = mark.points.last;
          canvas.drawLine(start, end, paint);
          final direction = (start - end).direction;
          const head = 18.0;
          canvas.drawLine(
            end,
            end + Offset.fromDirection(direction - 0.55, head),
            paint,
          );
          canvas.drawLine(
            end,
            end + Offset.fromDirection(direction + 0.55, head),
            paint,
          );
      }
    }
  }

  @override
  bool shouldRepaint(covariant _AnnotationPainter oldDelegate) => true;
}

String _annotatedName(String filename) {
  final dot = filename.lastIndexOf('.');
  final base = dot > 0 ? filename.substring(0, dot) : filename;
  return '${base.isEmpty ? 'camera' : base}-annotated.png';
}
