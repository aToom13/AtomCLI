// GENERATED FILE. DO NOT EDIT.
// Source: libs/companion/src/protocol.ts

abstract final class CompanionProtocolVersion {
  static const int pairing = 2;
  static const int minimum = 2;
  static const int current = 3;

  static bool supports(int version) => version >= minimum && version <= current;
}

abstract final class CompanionCapability {
  static const String coreSync = 'core.sync';
  static const String coreSnapshot = 'core.snapshot';
  static const String identityV1 = 'identity.v1';
  static const String eventsCursor = 'events.cursor';
  static const String actionsSigned = 'actions.signed';
  static const String permissionsResolve = 'permissions.resolve';
  static const String questionsReply = 'questions.reply';
  static const String sessionsManage = 'sessions.manage';
  static const String missionsControl = 'missions.control';
  static const String chatSend = 'chat.send';
  static const String modelsList = 'models.list';
  static const String directoriesList = 'directories.list';
  static const String transfersV1 = 'transfers.v1';
  static const String transfersV2 = 'transfers.v2';
  static const String previewsV1 = 'previews.v1';
  static const String previewsV2 = 'previews.v2';

  static const Set<String> supported = {
    'core.sync',
    'core.snapshot',
    'identity.v1',
    'events.cursor',
    'actions.signed',
    'permissions.resolve',
    'questions.reply',
    'sessions.manage',
    'missions.control',
    'chat.send',
    'models.list',
    'directories.list',
    'transfers.v1',
    'transfers.v2',
    'previews.v1',
    'previews.v2',
  };
}

class CompanionPeerIdentity {
  final String machineId;
  final String processId;
  final String bridgeId;
  final String? machineName;
  final String? projectDirectory;

  const CompanionPeerIdentity({
    required this.machineId,
    required this.processId,
    required this.bridgeId,
    this.machineName,
    this.projectDirectory,
  });

  factory CompanionPeerIdentity.fromJson(Map<String, dynamic> json) {
    return CompanionPeerIdentity(
      machineId: json['machine_id'] as String,
      processId: json['process_id'] as String,
      bridgeId: json['bridge_id'] as String,
      machineName: json['machine_name'] as String?,
      projectDirectory: json['project_directory'] as String?,
    );
  }
}

class CompanionAuthChallenge {
  final int protocolVersion;
  final int protocolMinimum;
  final Set<String> capabilities;
  final CompanionPeerIdentity? identity;
  final String challenge;
  final int expiresAt;

  const CompanionAuthChallenge({
    required this.protocolVersion,
    required this.protocolMinimum,
    required this.capabilities,
    this.identity,
    required this.challenge,
    required this.expiresAt,
  });

  factory CompanionAuthChallenge.fromJson(Map<String, dynamic> json) {
    final version =
        json['protocol_version'] as int? ?? json['protocol'] as int? ?? 2;
    final rawIdentity = json['identity'];
    return CompanionAuthChallenge(
      protocolVersion: version,
      protocolMinimum: json['protocol_min'] as int? ?? version,
      capabilities: (json['capabilities'] as List? ?? const [])
          .whereType<String>()
          .toSet(),
      identity: rawIdentity is Map
          ? CompanionPeerIdentity.fromJson(
              Map<String, dynamic>.from(rawIdentity),
            )
          : null,
      challenge: json['challenge'] as String,
      expiresAt: json['expires_at'] as int? ?? 0,
    );
  }
}

class CompanionAuthOk {
  final int protocolVersion;
  final Set<String> capabilities;
  final CompanionPeerIdentity? identity;
  final String bridgeEpoch;
  final String connectionId;
  final List<String> endpoints;

  const CompanionAuthOk({
    required this.protocolVersion,
    required this.capabilities,
    this.identity,
    required this.bridgeEpoch,
    required this.connectionId,
    required this.endpoints,
  });

  factory CompanionAuthOk.fromJson(Map<String, dynamic> json) {
    final rawIdentity = json['identity'];
    return CompanionAuthOk(
      protocolVersion: json['protocol_version'] as int? ?? 2,
      capabilities: (json['capabilities'] as List? ?? const [])
          .whereType<String>()
          .toSet(),
      identity: rawIdentity is Map
          ? CompanionPeerIdentity.fromJson(
              Map<String, dynamic>.from(rawIdentity),
            )
          : null,
      bridgeEpoch: json['bridge_epoch'] as String,
      connectionId: json['connection_id'] as String,
      endpoints: (json['endpoints'] as List? ?? const [])
          .whereType<String>()
          .toList(),
    );
  }
}
