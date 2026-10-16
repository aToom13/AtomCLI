part of '../models.dart';

/// Pairing payload received from QR code.
class PairingPayload {
  final int v;
  final List<String> endpoints;
  final String pairingToken;
  final String httpPair;

  const PairingPayload({
    required this.v,
    required this.endpoints,
    required this.pairingToken,
    required this.httpPair,
  });

  factory PairingPayload.fromJson(Map<String, dynamic> json) {
    final version = json['v'];
    final rawEndpoints = json['endpoints'];
    final token = json['pairing_token'];
    final pairUrl = json['http_pair'];
    if (version is! int ||
        rawEndpoints is! List ||
        token is! String ||
        pairUrl is! String) {
      throw const FormatException('Pairing code is missing required fields');
    }
    final endpoints = rawEndpoints.whereType<String>().where((value) {
      final uri = Uri.tryParse(value);
      return uri != null &&
          (uri.scheme == 'ws' || uri.scheme == 'wss') &&
          uri.host.isNotEmpty;
    }).toList();
    final pairUri = Uri.tryParse(pairUrl);
    if (endpoints.isEmpty) {
      throw const FormatException('Pairing code contains no reachable address');
    }
    if (pairUri == null ||
        (pairUri.scheme != 'http' && pairUri.scheme != 'https') ||
        pairUri.host.isEmpty) {
      throw const FormatException('Pairing address is invalid');
    }
    return PairingPayload(
      v: version,
      endpoints: endpoints,
      pairingToken: token,
      httpPair: pairUrl,
    );
  }
}

/// A pending permission request received from the backend.
