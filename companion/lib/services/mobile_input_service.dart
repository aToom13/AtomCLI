import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';

class IncomingShareFile {
  final String path;
  final String name;
  final String mime;
  final int size;

  const IncomingShareFile({
    required this.path,
    required this.name,
    required this.mime,
    required this.size,
  });

  static IncomingShareFile? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final map = Map<String, dynamic>.from(raw);
    final path = map['path'] as String?;
    final name = map['name'] as String?;
    final mime = map['mime'] as String?;
    final size = map['size'] as int?;
    if (path == null ||
        name == null ||
        mime == null ||
        size == null ||
        size < 0) {
      return null;
    }
    return IncomingShareFile(path: path, name: name, mime: mime, size: size);
  }
}

class IncomingShare {
  final String? text;
  final List<IncomingShareFile> files;
  final List<String> issues;

  const IncomingShare({
    this.text,
    this.files = const [],
    this.issues = const [],
  });

  bool get isEmpty => (text == null || text!.trim().isEmpty) && files.isEmpty;

  static IncomingShare? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final map = Map<String, dynamic>.from(raw);
    final files = (map['files'] as List? ?? const [])
        .map(IncomingShareFile.fromJson)
        .whereType<IncomingShareFile>()
        .take(10)
        .toList(growable: false);
    final text = (map['text'] as String?)?.trim();
    final issues = (map['issues'] as List? ?? const [])
        .whereType<String>()
        .map((value) => value.trim())
        .where((value) => value.isNotEmpty)
        .take(10)
        .toList(growable: false);
    final value = IncomingShare(
      text: text?.isEmpty == true ? null : text,
      files: files,
      issues: issues,
    );
    return value.isEmpty ? null : value;
  }
}

class MobileInputService {
  MobileInputService._();
  static final instance = MobileInputService._();

  static const _channel = MethodChannel('io.atomcli.companion/mobile_inputs');
  final _shares = StreamController<IncomingShare>.broadcast();
  bool _initialized = false;

  Stream<IncomingShare> get shares => _shares.stream;

  Future<IncomingShare?> initialize() async {
    if (!_initialized) {
      _initialized = true;
      _channel.setMethodCallHandler((call) async {
        if (call.method != 'share') return;
        final share = IncomingShare.fromJson(call.arguments);
        if (share != null) _shares.add(share);
      });
    }
    try {
      return IncomingShare.fromJson(
        await _channel.invokeMethod<Object?>('getInitialShare'),
      );
    } on MissingPluginException {
      return null;
    } on PlatformException {
      return null;
    }
  }

  Future<void> discard(IncomingShare share) async {
    for (final file in share.files) {
      try {
        await File(file.path).delete();
      } catch (_) {
        // Android also removes stale share-cache files before the next import.
      }
    }
  }
}
