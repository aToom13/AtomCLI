import 'dart:convert';
import 'dart:math';

import 'package:ed25519_edwards/ed25519_edwards.dart' as ed;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Manages the device's ED25519 keypair and signing operations.
///
/// The private key is stored through flutter_secure_storage and is never
/// logged or written to plain SharedPreferences.
///
/// Key format: raw 32-byte keys (compatible with Node.js crypto's SPKI wrap).
class AuthService {
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
  static const _privKeyStorageKey = 'atomcli_companion_priv_key_b64';
  static const _pubKeyStorageKey = 'atomcli_companion_pub_key_b64';
  static const _deviceNameKey = 'atomcli_companion_device_name';
  static const _deviceIdKey = 'atomcli_companion_device_id';
  static const _endpointsKey = 'atomcli_companion_endpoints';
  static const _lastSequenceKey = 'atomcli_companion_last_sequence';
  static const _bridgeEpochKey = 'atomcli_companion_bridge_epoch';

  static AuthService? _instance;
  AuthService._();
  static AuthService get instance => _instance ??= AuthService._();

  ed.KeyPair? _keyPair;
  String? _deviceName;
  String? _deviceId;
  List<String> _endpoints = [];
  int _lastSequence = 0;
  String? _bridgeEpoch;

  /// Returns the raw public key (32 bytes) as Base64.
  /// Used when registering the device via /companion/pair.
  String? get publicKeyBase64 {
    if (_keyPair == null) return null;
    return base64.encode(_keyPair!.publicKey.bytes);
  }

  String? get deviceName => _deviceName;
  String? get deviceId => _deviceId;
  List<String> get endpoints => _endpoints;
  int get lastSequence => _lastSequence;
  String? get bridgeEpoch => _bridgeEpoch;

  /// Save endpoints to secure storage so we can reconnect on restart.
  Future<void> saveEndpoints(
    List<String> urls, {
    bool resetSequence = true,
  }) async {
    if (urls.isEmpty || urls.any((url) => !_isWebSocketEndpoint(url))) {
      throw const FormatException('Pairing contains an invalid endpoint');
    }
    _endpoints = orderEndpoints(urls);
    if (resetSequence) _lastSequence = 0;
    await _storage.write(key: _endpointsKey, value: jsonEncode(_endpoints));
    if (resetSequence) await _storage.delete(key: _lastSequenceKey);
  }

  /// Load or generate keypair from secure storage.
  Future<void> init([String? suggestedName]) async {
    _deviceId = await _storage.read(key: _deviceIdKey);
    if (_deviceId == null) {
      _deviceId = _newDeviceId();
      await _storage.write(key: _deviceIdKey, value: _deviceId);
    }

    _deviceName = await _storage.read(key: _deviceNameKey);
    if (_deviceName == null || _deviceName!.trim().isEmpty) {
      final prefix = suggestedName?.trim().isNotEmpty == true
          ? suggestedName!.trim()
          : 'Android';
      _deviceName = '$prefix ${_deviceId!.substring(0, 6)}';
      await _storage.write(key: _deviceNameKey, value: _deviceName);
    }

    final privB64 = await _storage.read(key: _privKeyStorageKey);
    final pubB64 = await _storage.read(key: _pubKeyStorageKey);

    if (privB64 != null && pubB64 != null) {
      // Load existing keypair
      final privBytes = base64.decode(privB64);
      final pubBytes = base64.decode(pubB64);
      _keyPair = ed.KeyPair(ed.PrivateKey(privBytes), ed.PublicKey(pubBytes));
    } else {
      // Generate new keypair
      await _generateAndStore();
    }
  }

  /// Load saved device name, keypair, and endpoints without prompting for a new name.
  Future<bool> tryLoadExisting() async {
    _deviceName = await _storage.read(key: _deviceNameKey);
    _deviceId = await _storage.read(key: _deviceIdKey);
    final privB64 = await _storage.read(key: _privKeyStorageKey);
    final pubB64 = await _storage.read(key: _pubKeyStorageKey);
    final epsJson = await _storage.read(key: _endpointsKey);
    final sequence = await _storage.read(key: _lastSequenceKey);
    final bridgeEpoch = await _storage.read(key: _bridgeEpochKey);

    if (_deviceName == null || privB64 == null || pubB64 == null) return false;

    _endpoints = [];
    if (epsJson != null) {
      try {
        _endpoints = orderEndpoints(
          (jsonDecode(epsJson) as List)
              .whereType<String>()
              .where(_isWebSocketEndpoint)
              .toList(),
        );
      } catch (_) {
        return false;
      }
    }
    // A generated identity alone does not mean pairing succeeded. In
    // particular, a failed HTTP handshake can leave a valid keypair behind.
    if (_endpoints.isEmpty) return false;
    // Sequence counters are process-local on AtomCLI. An old high sequence
    // from a previous PC process must never suppress the new bridge epoch.
    if (bridgeEpoch == null) {
      _lastSequence = 0;
      _bridgeEpoch = null;
      await _storage.delete(key: _lastSequenceKey);
    } else {
      _bridgeEpoch = bridgeEpoch;
      _lastSequence = int.tryParse(sequence ?? '') ?? 0;
    }

    if (_deviceId == null) {
      _deviceId = _newDeviceId();
      await _storage.write(key: _deviceIdKey, value: _deviceId);
    }

    try {
      final privBytes = base64.decode(privB64);
      final pubBytes = base64.decode(pubB64);
      _keyPair = ed.KeyPair(ed.PrivateKey(privBytes), ed.PublicKey(pubBytes));
    } catch (_) {
      _keyPair = null;
      return false;
    }
    return true;
  }

  /// Sign a canonical JSON payload string.
  ///
  /// The signature is a raw 64-byte ED25519 signature encoded as Base64.
  /// The backend verifies it with `crypto.verify(null, payloadBuffer, spkiKey, sig)`.
  String sign(String payload) {
    if (_keyPair == null) throw StateError('AuthService not initialized');
    final payloadBytes = utf8.encode(payload);
    final sigBytes = ed.sign(_keyPair!.privateKey, payloadBytes);
    return base64.encode(sigBytes);
  }

  /// Rotate keypair (e.g., after a security concern).
  Future<void> rotateKeys() async {
    await _generateAndStore();
  }

  Future<void> recordSequence(int sequence) async {
    if (sequence < 0 || sequence == _lastSequence) return;
    _lastSequence = sequence;
    await _storage.write(key: _lastSequenceKey, value: '$sequence');
  }

  /// Install the current AtomCLI process epoch and reset its sequence space.
  Future<void> resetForBridgeEpoch(String epoch) async {
    if (_bridgeEpoch == epoch) return;
    _bridgeEpoch = epoch;
    _lastSequence = 0;
    await _storage.write(key: _bridgeEpochKey, value: epoch);
    await _storage.delete(key: _lastSequenceKey);
  }

  /// Remove all local pairing material after the backend has revoked the device.
  Future<void> clearPairing() async {
    for (final key in [
      _privKeyStorageKey,
      _pubKeyStorageKey,
      _deviceNameKey,
      _deviceIdKey,
      _endpointsKey,
      _lastSequenceKey,
      _bridgeEpochKey,
    ]) {
      await _storage.delete(key: key);
    }
    _keyPair = null;
    _deviceName = null;
    _deviceId = null;
    _endpoints = [];
    _lastSequence = 0;
  }

  Future<void> _generateAndStore() async {
    _keyPair = ed.generateKey();
    final privB64 = base64.encode(_keyPair!.privateKey.bytes);
    final pubB64 = base64.encode(_keyPair!.publicKey.bytes);
    await _storage.write(key: _privKeyStorageKey, value: privB64);
    await _storage.write(key: _pubKeyStorageKey, value: pubB64);
  }

  static String _newDeviceId() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    return base64Url.encode(bytes).replaceAll('=', '');
  }

  static bool _isWebSocketEndpoint(String value) {
    final uri = Uri.tryParse(value);
    return uri != null &&
        (uri.scheme == 'ws' || uri.scheme == 'wss') &&
        uri.host.isNotEmpty;
  }

  /// Prefer a direct local-network route, then Tailscale IP/MagicDNS.
  /// This is applied while loading too, so existing pairings automatically
  /// adopt the corrected route order after an app update.
  static List<String> orderEndpoints(Iterable<String> urls) {
    final source = urls.toList();
    final ordered = <String>{...source}.toList();
    ordered.sort((left, right) {
      final priority = _endpointPriority(left) - _endpointPriority(right);
      if (priority != 0) return priority;
      return source.indexOf(left) - source.indexOf(right);
    });
    return ordered;
  }

  static int _endpointPriority(String value) {
    final uri = Uri.tryParse(value);
    if (uri == null) return 3;
    final host = uri.host.toLowerCase();
    final octets = host.split('.').map(int.tryParse).toList();
    if (octets.length == 4 && octets.every((part) => part != null)) {
      final first = octets[0]!;
      final second = octets[1]!;
      if (first == 10 ||
          (first == 172 && second >= 16 && second <= 31) ||
          (first == 192 && second == 168)) {
        return 0;
      }
      if (first == 100 && second >= 64 && second <= 127) return 1;
    }
    if (host.endsWith('.ts.net')) return 2;
    return 3;
  }

  /// Build canonical payload for signing (mirrors TypeScript `canonicalPayload()`).
  /// Sorts keys alphabetically, excludes `signature` and `device_name` fields.
  static String canonicalPayload(Map<String, dynamic> msg) {
    final filtered = Map<String, dynamic>.from(msg)
      ..remove('signature')
      ..remove('device_name');
    final sortedKeys = filtered.keys.toList()..sort();
    final ordered = {for (final k in sortedKeys) k: filtered[k]};
    return jsonEncode(ordered);
  }
}
