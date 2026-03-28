import 'dart:convert';
import 'package:ed25519_edwards/ed25519_edwards.dart' as ed;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Manages the device's ED25519 keypair and signing operations.
///
/// The private key is stored in the OS secure enclave (Keychain on iOS,
/// Keystore on Android) via flutter_secure_storage. It is NEVER logged
/// or stored in plain SharedPreferences.
///
/// Key format: raw 32-byte keys (compatible with Node.js crypto's SPKI wrap).
class AuthService {
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
  static const _privKeyStorageKey = 'atomcli_companion_priv_key_b64';
  static const _pubKeyStorageKey = 'atomcli_companion_pub_key_b64';
  static const _deviceNameKey = 'atomcli_companion_device_name';
  static const _endpointsKey = 'atomcli_companion_endpoints';

  static AuthService? _instance;
  AuthService._();
  static AuthService get instance => _instance ??= AuthService._();

  ed.KeyPair? _keyPair;
  String? _deviceName;
  List<String> _endpoints = [];

  /// Returns the raw public key (32 bytes) as Base64.
  /// Used when registering the device via /companion/pair.
  String? get publicKeyBase64 {
    if (_keyPair == null) return null;
    return base64.encode(_keyPair!.publicKey.bytes);
  }

  String? get deviceName => _deviceName;
  List<String> get endpoints => _endpoints;

  /// Save endpoints to secure storage so we can reconnect on restart.
  Future<void> saveEndpoints(List<String> urls) async {
    _endpoints = urls;
    await _storage.write(key: _endpointsKey, value: jsonEncode(urls));
  }

  /// Load or generate keypair from secure storage.
  Future<void> init(String deviceName) async {
    _deviceName = deviceName;
    await _storage.write(key: _deviceNameKey, value: deviceName);

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
    final privB64 = await _storage.read(key: _privKeyStorageKey);
    final pubB64 = await _storage.read(key: _pubKeyStorageKey);
    final epsJson = await _storage.read(key: _endpointsKey);

    if (_deviceName == null || privB64 == null || pubB64 == null) return false;

    if (epsJson != null) {
      try {
        _endpoints = (jsonDecode(epsJson) as List).cast<String>();
      } catch (_) {}
    }

    final privBytes = base64.decode(privB64);
    final pubBytes = base64.decode(pubB64);
    _keyPair = ed.KeyPair(ed.PrivateKey(privBytes), ed.PublicKey(pubBytes));
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

  Future<void> _generateAndStore() async {
    _keyPair = ed.generateKey();
    final privB64 = base64.encode(_keyPair!.privateKey.bytes);
    final pubB64 = base64.encode(_keyPair!.publicKey.bytes);
    await _storage.write(key: _privKeyStorageKey, value: privB64);
    await _storage.write(key: _pubKeyStorageKey, value: pubB64);
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
