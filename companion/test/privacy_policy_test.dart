import 'package:atomcli_companion/services/companion_preferences.dart';
import 'package:atomcli_companion/services/privacy_policy.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('protected mode is the safe fallback for unknown stored values', () {
    expect(
      NotificationPrivacyModeCodec.parse('future-mode'),
      NotificationPrivacyMode.protected,
    );
    expect(
      CompanionPrivacyPolicy.showSensitiveNotificationContent(
        NotificationPrivacyMode.protected,
      ),
      isFalse,
    );
    expect(
      CompanionPrivacyPolicy.hideNotificationFromSecureLockScreen(
        NotificationPrivacyMode.hidden,
      ),
      isTrue,
    );
  });

  test('privacy preferences survive secure-storage reload', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final preferences = CompanionPreferences.instance;
    await preferences.selectNotificationPrivacy(NotificationPrivacyMode.hidden);
    await preferences.selectScreenProtection(false);
    preferences.notificationPrivacy = NotificationPrivacyMode.details;
    preferences.protectScreenPreviews = true;

    await preferences.load();

    expect(preferences.notificationPrivacy, NotificationPrivacyMode.hidden);
    expect(preferences.protectScreenPreviews, isFalse);
    preferences.notificationPrivacy = NotificationPrivacyMode.protected;
    preferences.protectScreenPreviews = true;
  });
}
