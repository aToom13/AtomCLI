import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../models.dart';
import '../providers/app_providers.dart';
import '../services/auth_service.dart';
import '../services/pairing_service.dart';
import '../services/websocket_service.dart';
import '../theme/app_theme.dart';
import '../widgets/control_widgets.dart';

class QrScanScreen extends ConsumerStatefulWidget {
  const QrScanScreen({super.key});

  @override
  ConsumerState<QrScanScreen> createState() => _QrScanScreenState();
}

class _QrScanScreenState extends ConsumerState<QrScanScreen> {
  final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
  );
  bool _processing = false;
  bool _torchEnabled = false;
  String? _status;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _handleBarcode(BarcodeCapture capture) async {
    final raw = capture.barcodes.firstOrNull?.rawValue;
    if (raw != null) await _processRaw(raw);
  }

  Future<void> _pastePairingCode() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final raw = data?.text?.trim();
    if (raw == null || raw.isEmpty) {
      _setError('Clipboard does not contain a pairing code.');
      return;
    }
    await _processRaw(raw);
  }

  Future<void> _processRaw(String raw) async {
    if (_processing) return;
    setState(() {
      _processing = true;
      _error = null;
      _status = 'Reading pairing code';
    });
    await _controller.stop();

    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) {
        throw const FormatException('Pairing code is not an object');
      }
      final payload = PairingPayload.fromJson(decoded);
      if (payload.v != 2) {
        throw FormatException('Unsupported pairing version ${payload.v}');
      }

      _setStatus('Creating device identity');
      await AuthService.instance.init(Platform.localHostname);
      final publicKey = AuthService.instance.publicKeyBase64;
      final deviceName = AuthService.instance.deviceName;
      if (publicKey == null || deviceName == null) {
        throw StateError('Device identity could not be created');
      }

      _setStatus('Contacting AtomCLI');
      final result = await PairingService.pair(
        httpPairUrl: payload.httpPair,
        pairingToken: payload.pairingToken,
        publicKeyBase64: publicKey,
        deviceName: deviceName,
      );
      if (!result.success) throw StateError(result.error ?? 'Pairing failed');

      await AuthService.instance.saveEndpoints(payload.endpoints);
      final ws = _createWebSocket(payload.endpoints);
      ref.read(wsServiceProvider.notifier).state = ws;
      _setStatus('Pairing complete');
      if (mounted) Navigator.of(context).pushReplacementNamed('/home');
    } on FormatException catch (error) {
      _setError(error.message);
    } catch (error) {
      _setError(_cleanError(error));
    }
  }

  WebSocketService _createWebSocket(List<String> endpoints) {
    return WebSocketService(
      endpoints: endpoints,
      onStateChange: (lifecycle) {
        final mapped = switch (lifecycle) {
          WsLifecycle.connecting => WsConnectionState.connecting,
          WsLifecycle.connected => WsConnectionState.connected,
          WsLifecycle.disconnected => WsConnectionState.disconnected,
        };
        Future.microtask(() {
          try {
            ref.read(connectionStateProvider.notifier).state = mapped;
            if (mapped == WsConnectionState.connected) {
              ref.read(connectionMessageProvider.notifier).state = null;
            }
          } catch (_) {}
        });
      },
    );
  }

  void _setStatus(String value) {
    if (!mounted) return;
    setState(() => _status = value);
  }

  Future<void> _retry() async {
    if (!mounted) return;
    setState(() {
      _processing = false;
      _status = null;
      _error = null;
    });
    try {
      await _controller.start();
    } catch (error) {
      _setError('Camera could not be started: ${_cleanError(error)}');
    }
  }

  void _setError(String value) {
    if (!mounted) return;
    setState(() {
      _processing = false;
      _status = null;
      _error = value;
    });
  }

  static String _cleanError(Object error) => error.toString().replaceFirst(
    RegExp(r'^(Bad state|FormatException):\s*'),
    '',
  );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppPalette.background,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 16, 18, 14),
              child: Row(
                children: [
                  const AtomMark(size: 34),
                  const SizedBox(width: 11),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'ATOMCLI',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: AppPalette.primary,
                        ),
                      ),
                      Text(
                        'Pair a machine',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                    ],
                  ),
                  const Spacer(),
                  IconButton(
                    tooltip: 'Toggle torch',
                    onPressed: () async {
                      await _controller.toggleTorch();
                      if (mounted) {
                        setState(() => _torchEnabled = !_torchEnabled);
                      }
                    },
                    icon: Icon(
                      _torchEnabled
                          ? Icons.flash_on_rounded
                          : Icons.flash_off_rounded,
                      color: _torchEnabled
                          ? AppPalette.amber
                          : AppPalette.textMuted,
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 18),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(26),
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      MobileScanner(
                        controller: _controller,
                        onDetect: _handleBarcode,
                      ),
                      DecoratedBox(
                        decoration: BoxDecoration(
                          border: Border.all(color: AppPalette.strokeStrong),
                          borderRadius: BorderRadius.circular(26),
                        ),
                      ),
                      Center(
                        child: Container(
                          width: 238,
                          height: 238,
                          decoration: BoxDecoration(
                            border: Border.all(
                              color: AppPalette.primary,
                              width: 2,
                            ),
                            borderRadius: BorderRadius.circular(24),
                            boxShadow: [
                              BoxShadow(
                                color: AppPalette.primary.withValues(
                                  alpha: 0.18,
                                ),
                                blurRadius: 28,
                                spreadRadius: 2,
                              ),
                            ],
                          ),
                        ),
                      ),
                      if (_processing)
                        ColoredBox(
                          color: AppPalette.background.withValues(alpha: 0.78),
                          child: Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const CircularProgressIndicator(
                                  color: AppPalette.primary,
                                ),
                                const SizedBox(height: 16),
                                Text(
                                  _status ?? 'Pairing',
                                  style: Theme.of(
                                    context,
                                  ).textTheme.titleMedium,
                                ),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 18, 18, 22),
              child: Column(
                children: [
                  if (_error != null) ...[
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(13),
                      decoration: BoxDecoration(
                        color: AppPalette.danger.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(
                          color: AppPalette.danger.withValues(alpha: 0.35),
                        ),
                      ),
                      child: Text(
                        _error!,
                        style: const TextStyle(
                          color: AppPalette.danger,
                          fontSize: 12,
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: _retry,
                        icon: const Icon(Icons.refresh_rounded),
                        label: const Text('Try again'),
                      ),
                    ),
                  ] else ...[
                    Text(
                      'Scan the code shown by AtomCLI. The app will try Tailscale first, then your local network.',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                    const SizedBox(height: 10),
                    TextButton.icon(
                      onPressed: _processing ? null : _pastePairingCode,
                      icon: const Icon(Icons.content_paste_rounded, size: 18),
                      label: const Text('Paste pairing code'),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
