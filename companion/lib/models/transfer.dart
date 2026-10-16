part of '../models.dart';

class CompanionArtifact {
  final String id;
  final String kind;
  final String direction;
  final String sourceDevice;
  final String title;
  final String name;
  final String mime;
  final int size;
  final String? sha256;
  final DateTime createdAt;
  final DateTime? expiresAt;
  final String? sessionId;
  final String downloadPath;

  const CompanionArtifact({
    required this.id,
    required this.kind,
    required this.direction,
    required this.sourceDevice,
    required this.title,
    required this.name,
    required this.mime,
    required this.size,
    this.sha256,
    required this.createdAt,
    this.expiresAt,
    this.sessionId,
    required this.downloadPath,
  });

  factory CompanionArtifact.fromJson(Map<String, dynamic> json) =>
      CompanionArtifact(
        id: json['id'] as String? ?? '',
        kind: json['kind'] as String? ?? 'file',
        direction: json['direction'] as String? ?? 'pc_to_mobile',
        sourceDevice: json['sourceDevice'] as String? ?? 'AtomCLI machine',
        title: json['title'] as String? ?? json['name'] as String? ?? 'File',
        name: json['name'] as String? ?? 'file',
        mime: json['mime'] as String? ?? 'application/octet-stream',
        size: json['size'] as int? ?? 0,
        sha256: json['sha256'] as String?,
        createdAt: DateTime.fromMillisecondsSinceEpoch(
          json['createdAt'] as int? ?? DateTime.now().millisecondsSinceEpoch,
        ),
        expiresAt: json['expiresAt'] is int
            ? DateTime.fromMillisecondsSinceEpoch(json['expiresAt'] as int)
            : null,
        sessionId: json['sessionID'] as String?,
        downloadPath: json['downloadPath'] as String? ?? '',
      );
}

class CompanionPreview {
  final String id;
  final String title;
  final String command;
  final int port;
  final String status;
  final List<String> endpoints;
  final String logTail;
  final DateTime createdAt;
  final String sourceDevice;
  final String directory;
  final String? sessionId;
  final int? exitCode;
  final DateTime? accessExpiresAt;

  const CompanionPreview({
    required this.id,
    required this.title,
    required this.command,
    required this.port,
    required this.status,
    required this.endpoints,
    required this.logTail,
    required this.createdAt,
    required this.sourceDevice,
    required this.directory,
    this.sessionId,
    this.exitCode,
    this.accessExpiresAt,
  });

  factory CompanionPreview.fromJson(Map<String, dynamic> json) =>
      CompanionPreview(
        id: json['id'] as String? ?? '',
        title: json['title'] as String? ?? 'Project preview',
        command: json['command'] as String? ?? '',
        port: json['port'] as int? ?? 0,
        status: json['status'] as String? ?? 'starting',
        endpoints: (json['endpoints'] as List? ?? const [])
            .whereType<String>()
            .toList(),
        logTail: json['logTail'] as String? ?? '',
        createdAt: DateTime.fromMillisecondsSinceEpoch(
          json['createdAt'] as int? ?? DateTime.now().millisecondsSinceEpoch,
        ),
        sourceDevice: json['sourceDevice'] as String? ?? 'AtomCLI machine',
        directory: json['directory'] as String? ?? '',
        sessionId: json['sessionID'] as String?,
        exitCode: json['exitCode'] as int?,
        accessExpiresAt: json['accessExpiresAt'] is int
            ? DateTime.fromMillisecondsSinceEpoch(
                json['accessExpiresAt'] as int,
              )
            : null,
      );
}

