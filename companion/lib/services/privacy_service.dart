import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

class PrivacyService {
  PrivacyService._();

  static const _channel = MethodChannel('io.atomcli.companion/privacy');
  static final screenProtection = ValueNotifier<bool>(true);

  static Future<void> applyScreenProtection(bool enabled) async {
    screenProtection.value = enabled;
    try {
      await _channel.invokeMethod<void>('setScreenProtection', {
        'enabled': enabled,
      });
    } on MissingPluginException {
      // Desktop/widget tests and older builds do not provide the native guard.
    } on PlatformException {
      // The visible in-app preference remains truthful even if this platform
      // cannot provide foreground capture prevention.
    }
  }
}
