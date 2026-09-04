enum NotificationPrivacyMode { details, protected, hidden }

extension NotificationPrivacyModeCodec on NotificationPrivacyMode {
  String get wireName => switch (this) {
    NotificationPrivacyMode.details => 'details',
    NotificationPrivacyMode.protected => 'protected',
    NotificationPrivacyMode.hidden => 'hidden',
  };

  static NotificationPrivacyMode parse(Object? value) => switch (value) {
    'details' => NotificationPrivacyMode.details,
    'hidden' => NotificationPrivacyMode.hidden,
    _ => NotificationPrivacyMode.protected,
  };
}

class CompanionPrivacyPolicy {
  const CompanionPrivacyPolicy._();

  static bool showSensitiveNotificationContent(NotificationPrivacyMode mode) =>
      mode == NotificationPrivacyMode.details;

  static bool hideNotificationFromSecureLockScreen(
    NotificationPrivacyMode mode,
  ) => mode == NotificationPrivacyMode.hidden;
}
