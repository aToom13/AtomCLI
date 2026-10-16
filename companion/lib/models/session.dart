part of '../models.dart';

class SessionInfo {
  final String id;
  final String title;
  final int updated;
  final String directory;
  final String status;

  SessionInfo({
    required this.id,
    required this.title,
    required this.updated,
    this.directory = '',
    this.status = 'idle',
  });

  factory SessionInfo.fromJson(Map<String, dynamic> json) {
    return SessionInfo(
      id: json['id'] as String,
      title: json['title'] as String,
      updated: json['updated'] as int,
      directory: json['directory'] as String? ?? '',
      status: json['status'] as String? ?? 'idle',
    );
  }

  String get formattedDate {
    final dt = DateTime.fromMillisecondsSinceEpoch(updated);
    return "${dt.day.toString().padLeft(2, '0')}/${dt.month.toString().padLeft(2, '0')} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}";
  }

  bool get isActive => status == 'busy' || status == 'retry';
}

class DirectoryEntry {
  final String name;
  final String path;
  final bool hidden;

  const DirectoryEntry({
    required this.name,
    required this.path,
    this.hidden = false,
  });

  factory DirectoryEntry.fromJson(Map<String, dynamic> json) => DirectoryEntry(
    name: json['name'] as String? ?? '',
    path: json['path'] as String? ?? '',
    hidden: json['hidden'] as bool? ?? false,
  );
}

class DirectoryListing {
  final String path;
  final String home;
  final String? parent;
  final List<DirectoryEntry> roots;
  final List<DirectoryEntry> directories;

  const DirectoryListing({
    required this.path,
    required this.home,
    this.parent,
    this.roots = const [],
    this.directories = const [],
  });

  factory DirectoryListing.fromJson(Map<String, dynamic> json) {
    List<DirectoryEntry> entries(String key) => (json[key] as List? ?? const [])
        .whereType<Map>()
        .map((item) => DirectoryEntry.fromJson(Map<String, dynamic>.from(item)))
        .toList();
    return DirectoryListing(
      path: json['path'] as String? ?? '',
      home: json['home'] as String? ?? '',
      parent: json['parent'] as String?,
      roots: entries('roots'),
      directories: entries('directories'),
    );
  }
}

/// A running or completed sub-agent spawned by an orchestrator.
