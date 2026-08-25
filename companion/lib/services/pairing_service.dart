import 'dart:convert';

import 'package:http/http.dart' as http;

/// Result of a pairing attempt.
class PairingResult {
  final bool success;
  final String? error;
  const PairingResult.ok() : success = true, error = null;
  const PairingResult.fail(this.error) : success = false;
}

/// Handles the HTTP POST /companion/pair handshake.
class PairingService {
  static Future<PairingResult> pair({
    required String httpPairUrl,
    required String pairingToken,
    required String publicKeyBase64,
    required String deviceName,
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
            }),
          )
          .timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        return const PairingResult.ok();
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
