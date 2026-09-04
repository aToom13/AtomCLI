import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'power_policy.dart';
import 'privacy_policy.dart';
import '../theme/app_theme.dart';

class CompanionPreferences {
  CompanionPreferences._();

  static final instance = CompanionPreferences._();
  static const _storageKey = 'companion_preferences_v1';
  // All secure-storage callers must use the same Android backend. Mixing the
  // legacy cipher backend with EncryptedSharedPreferences makes the plugin
  // migrate this entry whenever AuthService starts, so preferences appear to
  // reset on every process launch.
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  final List<String> recentModels = [];
  final Set<String> favoriteModels = {};
  final Map<String, String> modelVariants = {};
  String? lastModel;
  String? lastAgent;
  String? lastDirectory;
  ConnectionPowerMode powerMode = ConnectionPowerMode.balanced;
  NotificationPrivacyMode notificationPrivacy =
      NotificationPrivacyMode.protected;
  bool protectScreenPreviews = true;
  AppAccent accent = AppAccent.azure;

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
      powerMode = ConnectionPowerModeCodec.parse(json['power_mode']);
      notificationPrivacy = NotificationPrivacyModeCodec.parse(
        json['notification_privacy'],
      );
      protectScreenPreviews = json['protect_screen_previews'] as bool? ?? true;
      accent = AppAccent.values.firstWhere(
        (value) => value.name == json['accent'],
        orElse: () => AppAccent.azure,
      );
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

  Future<void> selectPowerMode(ConnectionPowerMode mode) {
    powerMode = mode;
    return _save();
  }

  Future<void> selectNotificationPrivacy(NotificationPrivacyMode mode) {
    notificationPrivacy = mode;
    return _save();
  }

  Future<void> selectScreenProtection(bool enabled) {
    protectScreenPreviews = enabled;
    return _save();
  }

  Future<void> selectAccent(AppAccent value) {
    accent = value;
    AppPalette.selectAccent(value);
    return _save();
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
          'power_mode': powerMode.wireName,
          'notification_privacy': notificationPrivacy.wireName,
          'protect_screen_previews': protectScreenPreviews,
          'accent': accent.name,
        }),
      );
    } catch (_) {
      // Selection still remains valid for this process if storage is unavailable.
    }
  }
}
