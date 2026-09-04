import 'dart:convert';
import 'dart:math';

import 'package:ed25519_edwards/ed25519_edwards.dart' as ed;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class PairedMachineProfile {
  final String profileId;
  final String machineId;
  final String machineName;
  final String projectDirectory;
  final List<String> endpoints;
  final String? processId;
  final String? bridgeId;
  final String? bridgeEpoch;
  final int lastSequence;
  final DateTime updatedAt;

  const PairedMachineProfile({
    required this.profileId,
    required this.machineId,
    required this.machineName,
    required this.projectDirectory,
    required this.endpoints,
    this.processId,
    this.bridgeId,
    this.bridgeEpoch,
    this.lastSequence = 0,
    required this.updatedAt,
  });

  factory PairedMachineProfile.fromJson(Map<String, dynamic> json) {
    return PairedMachineProfile(
      profileId: json['profile_id'] as String,
      machineId: json['machine_id'] as String,
      machineName: json['machine_name'] as String? ?? 'AtomCLI machine',
      projectDirectory: json['project_directory'] as String? ?? '',
      endpoints: (json['endpoints'] as List? ?? const [])
          .whereType<String>()
          .toList(),
      processId: json['process_id'] as String?,
      bridgeId: json['bridge_id'] as String?,
      bridgeEpoch: json['bridge_epoch'] as String?,
      lastSequence: json['last_sequence'] as int? ?? 0,
      updatedAt: DateTime.fromMillisecondsSinceEpoch(
        json['updated_at'] as int? ?? 0,
      ),
    );
  }

  Map<String, dynamic> toJson() => {
    'profile_id': profileId,
    'machine_id': machineId,
    'machine_name': machineName,
    'project_directory': projectDirectory,
    'endpoints': endpoints,
    if (processId != null) 'process_id': processId,
    if (bridgeId != null) 'bridge_id': bridgeId,
    if (bridgeEpoch != null) 'bridge_epoch': bridgeEpoch,
    'last_sequence': lastSequence,
    'updated_at': updatedAt.millisecondsSinceEpoch,
  };

  PairedMachineProfile copyWith({
    String? machineName,
    String? projectDirectory,
    List<String>? endpoints,
    String? processId,
    String? bridgeId,
    String? bridgeEpoch,
    bool clearBridgeEpoch = false,
    int? lastSequence,
    DateTime? updatedAt,
  }) => PairedMachineProfile(
    profileId: profileId,
    machineId: machineId,
    machineName: machineName ?? this.machineName,
    projectDirectory: projectDirectory ?? this.projectDirectory,
    endpoints: endpoints ?? this.endpoints,
    processId: processId ?? this.processId,
    bridgeId: bridgeId ?? this.bridgeId,
    bridgeEpoch: clearBridgeEpoch ? null : bridgeEpoch ?? this.bridgeEpoch,
    lastSequence: lastSequence ?? this.lastSequence,
    updatedAt: updatedAt ?? this.updatedAt,
  );
}

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
  static const _machineIdKey = 'atomcli_companion_machine_id';
  static const _profilesKey = 'atomcli_companion_machine_profiles_v1';
  static const _activeProfileKey = 'atomcli_companion_active_profile_v1';

  static AuthService? _instance;
  AuthService._();
  static AuthService get instance => _instance ??= AuthService._();

  static void resetForTests() {
    _instance = null;
  }

  ed.KeyPair? _keyPair;
  String? _deviceName;
  String? _deviceId;
  List<String> _endpoints = [];
  int _lastSequence = 0;
  String? _bridgeEpoch;
  String? _machineId;
  final Map<String, PairedMachineProfile> _profiles = {};
  String? _activeProfileId;

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
  String? get machineId => _machineId;
  String? get activeProfileId => _activeProfileId;
  PairedMachineProfile? get activeProfile => _profiles[_activeProfileId];
  List<PairedMachineProfile> get profiles {
    final result = _profiles.values.toList();
    result.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return List.unmodifiable(result);
  }

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
    final profile = activeProfile;
    if (profile != null) {
      _profiles[profile.profileId] = profile.copyWith(
        endpoints: _endpoints,
        lastSequence: resetSequence ? 0 : profile.lastSequence,
        updatedAt: DateTime.now(),
      );
      await _persistProfiles();
    }
  }

  Future<PairedMachineProfile> saveMachineProfile({
    required String machineId,
    required List<String> endpoints,
    String? machineName,
    String? projectDirectory,
    String? processId,
    String? bridgeId,
  }) async {
    if (machineId.isEmpty) throw const FormatException('Machine ID is empty');
    if (endpoints.isEmpty ||
        endpoints.any((endpoint) => !_isWebSocketEndpoint(endpoint))) {
      throw const FormatException('Pairing contains an invalid endpoint');
    }
    final ordered = orderEndpoints(endpoints);
    final normalizedProject = projectDirectory ?? '';
    final existing = _profiles.values.where((candidate) {
      if (candidate.machineId != machineId) return false;
      if (bridgeId != null && candidate.bridgeId == bridgeId) return true;
      if (candidate.projectDirectory != normalizedProject) return false;
      final candidatePorts = candidate.endpoints
          .map(Uri.tryParse)
          .whereType<Uri>()
          .map((uri) => uri.hasPort ? uri.port : 0)
          .toSet();
      return ordered
          .map(Uri.tryParse)
          .whereType<Uri>()
          .map((uri) => uri.hasPort ? uri.port : 0)
          .any(candidatePorts.contains);
    }).firstOrNull;
    final profile = PairedMachineProfile(
      profileId: existing?.profileId ?? _newDeviceId(),
      machineId: machineId,
      machineName: machineName?.trim().isNotEmpty == true
          ? machineName!.trim()
          : _machineLabel(ordered),
      projectDirectory: normalizedProject,
      endpoints: ordered,
      processId: processId,
      bridgeId: bridgeId,
      updatedAt: DateTime.now(),
    );
    _profiles[profile.profileId] = profile;
    await selectProfile(profile.profileId);
    return profile;
  }

  Future<void> selectProfile(String profileId) async {
    final profile = _profiles[profileId];
    if (profile == null) throw StateError('Unknown machine profile');
    _activeProfileId = profileId;
    _applyProfile(profile);
    await _storage.write(key: _activeProfileKey, value: profileId);
    await _writeLegacyActiveProfile();
    await _persistProfiles();
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
    final profilesJson = await _storage.read(key: _profilesKey);
    final savedActiveProfile = await _storage.read(key: _activeProfileKey);
    final epsJson = await _storage.read(key: _endpointsKey);
    final sequence = await _storage.read(key: _lastSequenceKey);
    final bridgeEpoch = await _storage.read(key: _bridgeEpochKey);
    _machineId = await _storage.read(key: _machineIdKey);

    if (_deviceName == null || privB64 == null || pubB64 == null) return false;

    _profiles.clear();
    if (profilesJson != null) {
      try {
        for (final raw in jsonDecode(profilesJson) as List) {
          if (raw is! Map) continue;
          final parsed = PairedMachineProfile.fromJson(
            Map<String, dynamic>.from(raw),
          );
          final validEndpoints = orderEndpoints(
            parsed.endpoints.where(_isWebSocketEndpoint),
          );
          if (validEndpoints.isEmpty) continue;
          _profiles[parsed.profileId] = parsed.copyWith(
            endpoints: validEndpoints,
          );
        }
      } catch (_) {
        _profiles.clear();
      }
    }

    if (_profiles.isNotEmpty) {
      _activeProfileId = _profiles.containsKey(savedActiveProfile)
          ? savedActiveProfile
          : profiles.first.profileId;
      _applyProfile(_profiles[_activeProfileId]!);
    } else {
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
      if (bridgeEpoch == null) {
        _lastSequence = 0;
        _bridgeEpoch = null;
        await _storage.delete(key: _lastSequenceKey);
      } else {
        _bridgeEpoch = bridgeEpoch;
        _lastSequence = int.tryParse(sequence ?? '') ?? 0;
      }
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
    if (_profiles.isEmpty && _machineId != null) {
      final migrated = PairedMachineProfile(
        profileId: _newDeviceId(),
        machineId: _machineId!,
        machineName: _machineLabel(_endpoints),
        projectDirectory: '',
        endpoints: _endpoints,
        bridgeEpoch: _bridgeEpoch,
        lastSequence: _lastSequence,
        updatedAt: DateTime.now(),
      );
      _profiles[migrated.profileId] = migrated;
      _activeProfileId = migrated.profileId;
      await _persistProfiles();
      await _storage.write(key: _activeProfileKey, value: migrated.profileId);
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
    await _updateActiveProfile(lastSequence: sequence);
  }

  /// Install the current AtomCLI process epoch and reset its sequence space.
  Future<void> resetForBridgeEpoch(String epoch) async {
    if (_bridgeEpoch == epoch) return;
    _bridgeEpoch = epoch;
    _lastSequence = 0;
    await _storage.write(key: _bridgeEpochKey, value: epoch);
    await _storage.delete(key: _lastSequenceKey);
    await _updateActiveProfile(bridgeEpoch: epoch, lastSequence: 0);
  }

  Future<void> recordMachineIdentity(String machineId) async {
    if (machineId.isEmpty) return;
    final expected = activeProfile?.machineId;
    if (expected != null && expected != machineId) {
      throw StateError('Endpoint belongs to a different paired machine');
    }
    if (machineId == _machineId) return;
    _machineId = machineId;
    await _storage.write(key: _machineIdKey, value: machineId);
    if (activeProfile == null && _endpoints.isNotEmpty) {
      final migrated = PairedMachineProfile(
        profileId: _newDeviceId(),
        machineId: machineId,
        machineName: _machineLabel(_endpoints),
        projectDirectory: '',
        endpoints: _endpoints,
        bridgeEpoch: _bridgeEpoch,
        lastSequence: _lastSequence,
        updatedAt: DateTime.now(),
      );
      _profiles[migrated.profileId] = migrated;
      _activeProfileId = migrated.profileId;
      await _storage.write(key: _activeProfileKey, value: migrated.profileId);
      await _persistProfiles();
    }
  }

  Future<void> recordPeerIdentity({
    required String machineId,
    required String processId,
    required String bridgeId,
    String? machineName,
    String? projectDirectory,
  }) async {
    await recordMachineIdentity(machineId);
    await _updateActiveProfile(
      machineName: machineName,
      projectDirectory: projectDirectory,
      processId: processId,
      bridgeId: bridgeId,
    );
  }

  Future<bool> forgetProfile(String profileId) async {
    final removed = _profiles.remove(profileId);
    if (removed == null) return _profiles.isNotEmpty;
    if (_activeProfileId == profileId) {
      if (_profiles.isEmpty) {
        _activeProfileId = null;
        _machineId = null;
        _endpoints = [];
        _lastSequence = 0;
        _bridgeEpoch = null;
        await _storage.delete(key: _activeProfileKey);
        for (final key in [
          _endpointsKey,
          _lastSequenceKey,
          _bridgeEpochKey,
          _machineIdKey,
        ]) {
          await _storage.delete(key: key);
        }
      } else {
        final next = profiles.first;
        _activeProfileId = next.profileId;
        _applyProfile(next);
        await _storage.write(key: _activeProfileKey, value: next.profileId);
        await _writeLegacyActiveProfile();
      }
    }
    await _persistProfiles();
    return _profiles.isNotEmpty;
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
      _machineIdKey,
      _profilesKey,
      _activeProfileKey,
    ]) {
      await _storage.delete(key: key);
    }
    _keyPair = null;
    _deviceName = null;
    _deviceId = null;
    _endpoints = [];
    _lastSequence = 0;
    _machineId = null;
    _profiles.clear();
    _activeProfileId = null;
  }

  Future<void> _updateActiveProfile({
    String? machineName,
    String? projectDirectory,
    String? processId,
    String? bridgeId,
    String? bridgeEpoch,
    int? lastSequence,
  }) async {
    final profile = activeProfile;
    if (profile == null) return;
    final updated = profile.copyWith(
      machineName: machineName?.trim().isNotEmpty == true ? machineName : null,
      projectDirectory: projectDirectory?.trim().isNotEmpty == true
          ? projectDirectory
          : null,
      processId: processId,
      bridgeId: bridgeId,
      bridgeEpoch: bridgeEpoch,
      lastSequence: lastSequence,
      updatedAt: DateTime.now(),
    );
    _profiles[profile.profileId] = updated;
    _applyProfile(updated);
    await _persistProfiles();
  }

  void _applyProfile(PairedMachineProfile profile) {
    _machineId = profile.machineId;
    _endpoints = orderEndpoints(profile.endpoints);
    _lastSequence = profile.bridgeEpoch == null ? 0 : profile.lastSequence;
    _bridgeEpoch = profile.bridgeEpoch;
  }

  Future<void> _persistProfiles() {
    return _storage.write(
      key: _profilesKey,
      value: jsonEncode(profiles.map((profile) => profile.toJson()).toList()),
    );
  }

  Future<void> _writeLegacyActiveProfile() async {
    await _storage.write(key: _machineIdKey, value: _machineId);
    await _storage.write(key: _endpointsKey, value: jsonEncode(_endpoints));
    if (_bridgeEpoch == null) {
      await _storage.delete(key: _bridgeEpochKey);
      await _storage.delete(key: _lastSequenceKey);
    } else {
      await _storage.write(key: _bridgeEpochKey, value: _bridgeEpoch);
      await _storage.write(key: _lastSequenceKey, value: '$_lastSequence');
    }
  }

  static String _machineLabel(List<String> endpoints) {
    final host = endpoints.firstOrNull == null
        ? null
        : Uri.tryParse(endpoints.first)?.host;
    return host == null || host.isEmpty ? 'AtomCLI machine' : host;
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
