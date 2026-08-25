import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/app_providers.dart';
import '../services/auth_service.dart';
import '../services/background_connection_service.dart';
import '../theme/app_theme.dart';
import '../widgets/control_widgets.dart';

class LinkScreen extends ConsumerStatefulWidget {
  const LinkScreen({super.key});

  @override
  ConsumerState<LinkScreen> createState() => _LinkScreenState();
}

class _LinkScreenState extends ConsumerState<LinkScreen> {
  bool _retrying = false;
  bool _forgetting = false;

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(connectionStateProvider);
    final message = ref.watch(connectionMessageProvider);
    final ws = ref.watch(wsServiceProvider);
    final endpoints = AuthService.instance.endpoints;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Link'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Center(child: ConnectionBadge(state: state)),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 8, 18, 32),
        children: [
          Text(
            'Command link',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 6),
          Text(
            'AtomCLI tries every address from the pairing code. Tailscale and local Wi-Fi are both supported.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 22),
          _StatusPanel(
            state: state,
            endpoint: ws?.currentEndpoint,
            message: message ?? ws?.lastError,
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _retrying || ws == null ? null : _retry,
              icon: _retrying
                  ? const SizedBox(
                      width: 17,
                      height: 17,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.sync_rounded),
              label: Text(_retrying ? 'Retrying link' : 'Retry connection'),
            ),
          ),
          const SizedBox(height: 28),
          const SectionLabel('Reachable addresses'),
          const SizedBox(height: 10),
          ControlPanel(
            padding: EdgeInsets.zero,
            child: endpoints.isEmpty
                ? const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text(
                      'No endpoints are stored. Pair the device again.',
                      style: TextStyle(color: AppPalette.textSecondary),
                    ),
                  )
                : Column(
                    children: [
                      for (var index = 0; index < endpoints.length; index++)
                        _EndpointRow(
                          endpoint: endpoints[index],
                          current: endpoints[index] == ws?.currentEndpoint,
                          connected: state == WsConnectionState.connected,
                          showDivider: index < endpoints.length - 1,
                        ),
                    ],
                  ),
          ),
          const SizedBox(height: 14),
          const ControlPanel(
            color: Color(0xFF101A22),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.shield_outlined, color: AppPalette.mint, size: 20),
                SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Commands are signed with this device key. Tailscale encrypts traffic in transit. Local Wi-Fi uses direct cleartext transport and should only be used on a trusted network.',
                    style: TextStyle(
                      color: AppPalette.textSecondary,
                      fontSize: 12,
                      height: 1.45,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 28),
          const SectionLabel('This device'),
          const SizedBox(height: 10),
          ControlPanel(
            child: Column(
              children: [
                _DetailRow(
                  label: 'NAME',
                  value: AuthService.instance.deviceName ?? 'Android device',
                ),
                const SizedBox(height: 14),
                _DetailRow(
                  label: 'DEVICE ID',
                  value: _shortDeviceId(AuthService.instance.deviceId),
                  monospace: true,
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          OutlinedButton.icon(
            onPressed: _forgetting ? null : _confirmForget,
            style: OutlinedButton.styleFrom(
              foregroundColor: AppPalette.danger,
              side: BorderSide(
                color: AppPalette.danger.withValues(alpha: 0.45),
              ),
              minimumSize: const Size.fromHeight(48),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
            icon: const Icon(Icons.link_off_rounded),
            label: Text(
              _forgetting ? 'Removing device' : 'Forget this machine',
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _retry() async {
    final ws = ref.read(wsServiceProvider);
    if (ws == null) return;
    setState(() => _retrying = true);
    ref.read(connectionMessageProvider.notifier).state = null;
    try {
      await ws.reconnect();
    } catch (error) {
      ref.read(connectionMessageProvider.notifier).state = error.toString();
    } finally {
      if (mounted) setState(() => _retrying = false);
    }
  }

  Future<void> _confirmForget() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppPalette.panel,
        title: const Text('Forget this machine?'),
        content: const Text(
          'The pairing key and saved addresses will be removed from this phone. You will need to scan a new QR code.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: AppPalette.danger,
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Forget'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _forgetting = true);
    final ws = ref.read(wsServiceProvider);
    try {
      if (ws?.isConnected == true) await ws!.unpair();
    } catch (_) {
      // Local cleanup remains available when the old machine is unreachable.
    }
    await ws?.dispose();
    BackgroundConnectionService.stop();
    await AuthService.instance.clearPairing();
    if (!mounted) return;
    ref.read(wsServiceProvider.notifier).state = null;
    ref.read(connectionStateProvider.notifier).state =
        WsConnectionState.disconnected;
    ref.read(connectionMessageProvider.notifier).state = null;
    ref.read(permissionsProvider.notifier).setFromSnapshot([]);
    ref.read(questionsProvider.notifier).setFromSnapshot([]);
    ref.read(dagProvider.notifier).clear();
    ref.read(subAgentProvider.notifier).clearAll();
    Navigator.of(context).pushNamedAndRemoveUntil('/scan', (_) => false);
  }

  static String _shortDeviceId(String? id) {
    if (id == null || id.isEmpty) return 'Unavailable';
    return id.length <= 12
        ? id
        : '${id.substring(0, 6)}…${id.substring(id.length - 4)}';
  }
}

class _StatusPanel extends StatelessWidget {
  final WsConnectionState state;
  final String? endpoint;
  final String? message;

  const _StatusPanel({required this.state, this.endpoint, this.message});

  @override
  Widget build(BuildContext context) {
    final (title, body, color, icon) = switch (state) {
      WsConnectionState.connected => (
        'Link operational',
        'Authenticated and receiving live events.',
        AppPalette.mint,
        Icons.hub_rounded,
      ),
      WsConnectionState.connecting => (
        'Trying available routes',
        'The next saved address will be attempted automatically.',
        AppPalette.amber,
        Icons.sync_rounded,
      ),
      WsConnectionState.disconnected => (
        'Link offline',
        message ?? 'AtomCLI is not reachable from this device.',
        AppPalette.danger,
        Icons.link_off_rounded,
      ),
    };

    return ControlPanel(
      borderColor: color.withValues(alpha: 0.4),
      color: color.withValues(alpha: 0.06),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(13),
            ),
            child: Icon(icon, color: color),
          ),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 4),
                Text(body, style: Theme.of(context).textTheme.bodySmall),
                if (endpoint != null) ...[
                  const SizedBox(height: 9),
                  Text(
                    endpoint!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppPalette.textSecondary,
                      fontFamily: 'monospace',
                      fontSize: 10,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _EndpointRow extends StatelessWidget {
  final String endpoint;
  final bool current;
  final bool connected;
  final bool showDivider;

  const _EndpointRow({
    required this.endpoint,
    required this.current,
    required this.connected,
    required this.showDivider,
  });

  @override
  Widget build(BuildContext context) {
    final uri = Uri.tryParse(endpoint);
    final host = uri?.host ?? endpoint;
    final kind = _kind(host);
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
                  ],
                ),
              ),
              if (current)
                Text(
                  connected ? 'ACTIVE' : 'TRYING',
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

  static (String, IconData) _kind(String host) {
    if (RegExp(r'^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.').hasMatch(host) ||
        !RegExp(r'^\d+\.').hasMatch(host)) {
      return ('Tailscale', Icons.shield_outlined);
    }
    return ('Local network', Icons.wifi_rounded);
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
