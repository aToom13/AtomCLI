import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class CompanionPreferences {
  CompanionPreferences._();

  static final instance = CompanionPreferences._();
  static const _storageKey = 'companion_preferences_v1';
  static const _storage = FlutterSecureStorage();

  final List<String> recentModels = [];
  final Set<String> favoriteModels = {};
  final Map<String, String> modelVariants = {};
  String? lastModel;
  String? lastAgent;
  String? lastDirectory;

  Future<void> load() async {
    try {
      final raw = await _storage.read(key: _storageKey);
      if (raw == null) return;
      final json = jsonDecode(raw) as Map<String, dynamic>;
      recentModels
        ..clear()
        ..addAll(
          (json['recent_models'] as List? ?? const []).whereType<String>(),
        );
      favoriteModels
        ..clear()
        ..addAll(
          (json['favorite_models'] as List? ?? const []).whereType<String>(),
        );
      modelVariants
        ..clear()
        ..addAll(
          (json['model_variants'] as Map? ?? const {}).map(
            (key, value) => MapEntry(key.toString(), value.toString()),
          ),
        );
      lastModel = json['last_model'] as String?;
      lastAgent = json['last_agent'] as String?;
      lastDirectory = json['last_directory'] as String?;
    } catch (_) {
      // Corrupt or unavailable preferences should never prevent pairing.
    }
  }

  void selectModel(String modelId) {
    lastModel = modelId;
    recentModels
      ..remove(modelId)
      ..insert(0, modelId);
    if (recentModels.length > 5) {
      recentModels.removeRange(5, recentModels.length);
    }
    _save();
  }

  void toggleFavorite(String modelId) {
    if (!favoriteModels.remove(modelId)) favoriteModels.add(modelId);
    _save();
  }

  void selectVariant(String modelId, String? variant) {
    if (variant == null || variant.isEmpty) {
      modelVariants.remove(modelId);
    } else {
      modelVariants[modelId] = variant;
    }
    _save();
  }

  void selectAgent(String agent) {
    lastAgent = agent;
    _save();
  }

  void selectDirectory(String directory) {
    lastDirectory = directory;
    _save();
  }

  Future<void> _save() async {
    try {
      await _storage.write(
        key: _storageKey,
        value: jsonEncode({
          'recent_models': recentModels,
          'favorite_models': favoriteModels.toList(),
          'model_variants': modelVariants,
          'last_model': lastModel,
          'last_agent': lastAgent,
          'last_directory': lastDirectory,
        }),
      );
    } catch (_) {
      // Selection still remains valid for this process if storage is unavailable.
    }
  }
}
