import 'dart:io';

import 'package:flutter/services.dart';

class AndroidLiveUpdateResult {
  final bool supported;
  final bool allowed;
  final bool promotable;
  final bool promoted;

  const AndroidLiveUpdateResult({
    required this.supported,
    required this.allowed,
    required this.promotable,
    required this.promoted,
  });

  factory AndroidLiveUpdateResult.fromMap(Map<Object?, Object?> value) =>
      AndroidLiveUpdateResult(
        supported: value['supported'] == true,
        allowed: value['allowed'] == true,
        promotable: value['promotable'] == true,
        promoted: value['promoted'] == true,
      );
}

class AtomcliAndroidLiveUpdates {
  static const _channel = MethodChannel('io.atomcli.companion/live_updates');

  static Future<AndroidLiveUpdateResult?> show({
    required int notificationId,
    required String title,
    required String text,
    required String shortText,
    int? progress,
    int? progressMax,
    required int startedAtMillis,
    required String deepLink,
    required bool hideOnLockScreen,
  }) async {
    if (!Platform.isAndroid) return null;
    final result = await _channel.invokeMapMethod<Object?, Object?>('show', {
      'notificationId': notificationId,
      'title': title,
      'text': text,
      'shortText': shortText,
      'progress': ?progress,
      'progressMax': ?progressMax,
      'startedAtMillis': startedAtMillis,
      'deepLink': deepLink,
      'hideOnLockScreen': hideOnLockScreen,
    });
    return result == null ? null : AndroidLiveUpdateResult.fromMap(result);
  }

  static Future<AndroidLiveUpdateResult?> status() async {
    if (!Platform.isAndroid) return null;
    final result = await _channel.invokeMapMethod<Object?, Object?>('status');
    return result == null ? null : AndroidLiveUpdateResult.fromMap(result);
  }

  static Future<bool> openSettings() async {
    if (!Platform.isAndroid) return false;
    return await _channel.invokeMethod<bool>('openSettings') ?? false;
  }

  static Future<void> cancel(int notificationId) async {
    if (!Platform.isAndroid) return;
    await _channel.invokeMethod<void>('cancel', {
      'notificationId': notificationId,
    });
  }
}
