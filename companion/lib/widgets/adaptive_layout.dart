import 'dart:math' as math;
import 'dart:ui' show DisplayFeature, DisplayFeatureState, DisplayFeatureType;

import 'package:flutter/material.dart';

abstract final class AdaptiveBreakpoints {
  static const navigationRail = 720.0;
  static const twoPane = 840.0;
}

class AdaptiveTwoPane extends StatelessWidget {
  final Widget compact;
  final Widget primary;
  final Widget detail;
  final double breakpoint;

  const AdaptiveTwoPane({
    super.key,
    required this.compact,
    required this.primary,
    required this.detail,
    this.breakpoint = AdaptiveBreakpoints.twoPane,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < breakpoint) return compact;

        final media = MediaQuery.of(context);
        final feature = _verticalSeparatingFeature(media.displayFeatures);
        final featureWidth = feature == null
            ? 1.0
            : math.max(feature.bounds.width, 12).toDouble();
        final defaultPrimary = (constraints.maxWidth * 0.32)
            .clamp(280.0, 360.0)
            .toDouble();
        final featureCenter = feature?.bounds.center.dx;
        final projectedPrimary = featureCenter == null || media.size.width == 0
            ? defaultPrimary
            : (featureCenter / media.size.width * constraints.maxWidth)
                  .clamp(280.0, constraints.maxWidth - featureWidth - 360)
                  .toDouble();

        return Row(
          children: [
            SizedBox(width: projectedPrimary, child: primary),
            SizedBox(
              width: featureWidth,
              child: feature == null
                  ? const VerticalDivider(width: 1)
                  : const ColoredBox(color: Colors.black),
            ),
            Expanded(child: detail),
          ],
        );
      },
    );
  }

  DisplayFeature? _verticalSeparatingFeature(List<DisplayFeature> features) {
    for (final feature in features) {
      final bounds = feature.bounds;
      final vertical = bounds.height > bounds.width;
      final separating =
          feature.type == DisplayFeatureType.hinge ||
          (feature.type == DisplayFeatureType.fold &&
              feature.state != DisplayFeatureState.postureFlat);
      if (vertical && separating) return feature;
    }
    return null;
  }
}
