import 'dart:convert';

import 'package:http/http.dart' as http;

/// Result of a pairing attempt.
class PairingResult {
  final bool success;
  final String? error;
  final String? machineId;
  final String? machineName;
  final String? processId;
  final String? bridgeId;
  final String? projectDirectory;

  const PairingResult.ok({
    required this.machineId,
    this.machineName,
    this.processId,
    this.bridgeId,
    this.projectDirectory,
  }) : success = true,
       error = null;
  const PairingResult.fail(this.error)
    : success = false,
      machineId = null,
      machineName = null,
      processId = null,
      bridgeId = null,
      projectDirectory = null;
}

/// Handles the HTTP POST /companion/pair handshake.
class PairingService {
  static Future<PairingResult> pair({
    required String httpPairUrl,
    required String pairingToken,
    required String publicKeyBase64,
    required String deviceName,
    required String deviceId,
  }) async {
    try {
      final response = await http
          .post(
            Uri.parse(httpPairUrl),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'pairing_token': pairingToken,
              'public_key': publicKeyBase64,
              'device_name': deviceName,
              'device_id': deviceId,
            }),
          )
          .timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final body = jsonDecode(response.body) as Map<String, dynamic>;
        return PairingResult.ok(
          machineId: body['machine_id'] as String?,
          machineName: body['machine_name'] as String?,
          processId: body['process_id'] as String?,
          bridgeId: body['bridge_id'] as String?,
          projectDirectory: body['project_directory'] as String?,
        );
      } else {
        try {
          final body = jsonDecode(response.body) as Map<String, dynamic>;
          return PairingResult.fail(
            body['error'] as String? ?? 'AtomCLI rejected the pairing request',
          );
        } catch (_) {
          return PairingResult.fail(
            'AtomCLI returned HTTP ${response.statusCode}',
          );
        }
      }
    } catch (_) {
      return PairingResult.fail(
        'Could not reach AtomCLI. Check Tailscale or local Wi-Fi and try again.',
      );
    }
  }
}
