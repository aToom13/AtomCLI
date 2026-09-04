import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../providers/app_providers.dart';
import '../theme/app_theme.dart';

class ControlPanel extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color? borderColor;
  final Color? color;

  const ControlPanel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.borderColor,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color ?? AppPalette.panel,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: borderColor ?? AppPalette.stroke),
      ),
      child: Padding(padding: padding, child: child),
    );
  }
}

class SectionLabel extends StatelessWidget {
  final String text;
  final Widget? trailing;

  const SectionLabel(this.text, {super.key, this.trailing});

  @override
  Widget build(BuildContext context) {
    final locale = Localizations.localeOf(context).languageCode;
    final label = locale == 'tr'
        ? text.replaceAll('i', 'İ').replaceAll('ı', 'I').toUpperCase()
        : text.toUpperCase();
    return Semantics(
      header: true,
      child: Row(
        children: [
          Text(label, style: Theme.of(context).textTheme.labelSmall),
          const Spacer(),
          ?trailing,
        ],
      ),
    );
  }
}

class ConnectionBadge extends StatelessWidget {
  final WsConnectionState state;

  const ConnectionBadge({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final (label, color) = switch (state) {
      WsConnectionState.connected => (
        strings.connectionLinked,
        AppPalette.mint,
      ),
      WsConnectionState.connecting => (
        strings.connectionLinking,
        AppPalette.amber,
      ),
      WsConnectionState.disconnected => (
        strings.connectionOfflineShort,
        AppPalette.danger,
      ),
    };
    return Semantics(
      container: true,
      label: strings.connectionStatusAccessibility(label),
      child: ExcludeSemantics(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.09),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: color.withValues(alpha: 0.3)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(color: color, shape: BoxShape.circle),
              ),
              const SizedBox(width: 7),
              Text(
                label.toUpperCase(),
                style: TextStyle(
                  color: color,
                  fontFamily: 'monospace',
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.8,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class AtomMark extends StatelessWidget {
  final double size;

  const AtomMark({super.key, this.size = 36});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      image: true,
      label: AppLocalizations.of(context).appLogoAccessibility,
      child: ExcludeSemantics(
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            color: AppPalette.primary,
            borderRadius: BorderRadius.circular(size * 0.28),
            boxShadow: [
              BoxShadow(
                color: AppPalette.primary.withValues(alpha: 0.22),
                blurRadius: 20,
                spreadRadius: -4,
              ),
            ],
          ),
          child: Icon(
            Icons.terminal_rounded,
            color: AppPalette.background,
            size: size * 0.52,
          ),
        ),
      ),
    );
  }
}
