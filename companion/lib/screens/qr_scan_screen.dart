import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../models.dart';
import '../services/auth_service.dart';
import '../services/pairing_service.dart';
import '../services/websocket_service.dart';
import '../providers/app_providers.dart';

/// QR scanning screen that handles the full pairing flow:
/// 1. Scan QR → parse PairingPayload
/// 2. POST /companion/pair (pairing_token + public_key + device_name)
/// 3. Navigate to HomeScreen on success
class QrScanScreen extends ConsumerStatefulWidget {
  const QrScanScreen({super.key});

  @override
  ConsumerState<QrScanScreen> createState() => _QrScanScreenState();
}

class _QrScanScreenState extends ConsumerState<QrScanScreen> {
  final _controller = MobileScannerController();
  bool _processing = false;
  String? _statusMessage;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _handleBarcode(BarcodeCapture capture) async {
    if (_processing) return;
    final raw = capture.barcodes.firstOrNull?.rawValue;
    if (raw == null) return;

    setState(() {
      _processing = true;
      _statusMessage = 'Parsing QR...';
    });

    try {
      final json = jsonDecode(raw) as Map<String, dynamic>;
      final payload = PairingPayload.fromJson(json);

      if (payload.v != 1) {
        _setError('Unsupported pairing version: ${payload.v}');
        return;
      }

      _setStatus('Initializing keys...');

      // Ensure keypair exists (generates on first run)
      final deviceName = Platform.localHostname;
      await AuthService.instance.init(deviceName);
      final pubKey = AuthService.instance.publicKeyBase64!;

      _setStatus('Pairing with AtomCLI...');

      final result = await PairingService.pair(
        httpPairUrl: payload.httpPair,
        pairingToken: payload.pairingToken,
        publicKeyBase64: pubKey,
        deviceName: deviceName,
      );

      if (!result.success) {
        _setError(result.error ?? 'Pairing failed');
        return;
      }

      _setStatus('Connected! Loading dashboard...');

      // Initialize WS service and save endpoints for auto-reconnect
      await AuthService.instance.saveEndpoints(payload.endpoints);
      final ws = WebSocketService(
        endpoints: payload.endpoints,
        onStateChange: (lifecycle) {
          final mapped = switch (lifecycle) {
            WsLifecycle.connecting => WsConnectionState.connecting,
            WsLifecycle.connected => WsConnectionState.connected,
            WsLifecycle.disconnected => WsConnectionState.disconnected,
          };
          Future.microtask(() {
            try {
              ref.read(connectionStateProvider.notifier).state = mapped;
            } catch (_) {}
          });
        },
      );
      ref.read(wsServiceProvider.notifier).state = ws;

      if (mounted) {
        Navigator.of(context).pushReplacementNamed('/home');
      }
    } catch (e) {
      _setError('Invalid QR code: $e');
    }
  }

  void _setStatus(String msg) {
    if (mounted) setState(() => _statusMessage = msg);
  }

  void _setError(String msg) {
    if (mounted) {
      setState(() {
        _processing = false;
        _statusMessage = '⚠️ $msg — Tap to retry';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          MobileScanner(controller: _controller, onDetect: _handleBarcode),
          // Overlay
          Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // Scan frame
                Container(
                  width: 250,
                  height: 250,
                  decoration: BoxDecoration(
                    border: Border.all(color: Colors.cyanAccent, width: 2),
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                const SizedBox(height: 24),
                if (_statusMessage != null)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.75),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      _statusMessage!,
                      style: const TextStyle(color: Colors.white, fontSize: 14),
                      textAlign: TextAlign.center,
                    ),
                  )
                else
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.75),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Text(
                      'Scan the AtomCLI QR code\nfrom `atomcli serve --companion`',
                      style: TextStyle(color: Colors.white70, fontSize: 14),
                      textAlign: TextAlign.center,
                    ),
                  ),
              ],
            ),
          ),
          // Top safe area label
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: const [
                  Icon(Icons.terminal, color: Colors.cyanAccent),
                  SizedBox(width: 8),
                  Text(
                    'AtomCLI Companion',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
