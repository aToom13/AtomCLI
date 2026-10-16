part of 'link_screen.dart';

class _EndpointRow extends StatelessWidget {
  final String endpoint;
  final bool current;
  final bool connected;
  final bool showDivider;
  final EndpointDiagnosis? diagnosis;

  const _EndpointRow({
    required this.endpoint,
    required this.current,
    required this.connected,
    required this.showDivider,
    this.diagnosis,
  });

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final host = Uri.tryParse(endpoint)?.host ?? endpoint;
    final kind = _kind(host, strings.localNetwork);
    final stateColor = connected ? AppPalette.mint : AppPalette.amber;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 13),
          child: Row(
            children: [
              Icon(
                kind.$2,
                color: current ? stateColor : AppPalette.textMuted,
                size: 19,
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      kind.$1,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      host,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(
                        context,
                      ).textTheme.bodySmall?.copyWith(fontFamily: 'monospace'),
                    ),
                    if (diagnosis != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        localizedDiagnosis(strings, diagnosis!.issue),
                        style: TextStyle(
                          color: diagnosis!.reachable
                              ? AppPalette.mint
                              : AppPalette.danger,
                          fontSize: 10,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (current)
                Text(
                  connected ? strings.active : strings.trying,
                  style: TextStyle(
                    color: stateColor,
                    fontFamily: 'monospace',
                    fontSize: 9,
                    fontWeight: FontWeight.w700,
                  ),
                ),
            ],
          ),
        ),
        if (showDivider) const Divider(height: 1, indent: 45),
      ],
    );
  }

  static (String, IconData) _kind(String host, String localNetwork) {
    if (RegExp(r'^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.').hasMatch(host) ||
        !RegExp(r'^\d+\.').hasMatch(host)) {
      return ('Tailscale', Icons.shield_outlined);
    }
    return (localNetwork, Icons.wifi_rounded);
  }
}

class _DetailRow extends StatelessWidget {
  final String label;
  final String value;
  final bool monospace;

  const _DetailRow({
    required this.label,
    required this.value,
    this.monospace = false,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(label, style: Theme.of(context).textTheme.labelSmall),
        const Spacer(),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.end,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: AppPalette.textSecondary,
              fontSize: 12,
              fontFamily: monospace ? 'monospace' : null,
            ),
          ),
        ),
      ],
    );
  }
}
