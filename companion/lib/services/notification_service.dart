import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Service for showing local device notifications for permission requests.
class NotificationService {
  NotificationService._();
  static final instance = NotificationService._();

  final _plugin = FlutterLocalNotificationsPlugin();
  bool _initialized = false;

  Future<void> init() async {
    if (_initialized) return;
    const android = AndroidInitializationSettings('@mipmap/ic_launcher');
    const ios = DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: true,
      requestSoundPermission: true,
    );
    await _plugin.initialize(
      const InitializationSettings(android: android, iOS: ios),
    );
    _initialized = true;
  }

  Future<void> showPermissionRequest({
    required String reqId,
    required String permission,
    required List<String> patterns,
  }) async {
    final patternSummary = patterns.isEmpty
        ? ''
        : ': ${patterns.take(3).join(', ')}${patterns.length > 3 ? '…' : ''}';

    await _plugin.show(
      reqId.hashCode,
      '⚠️ Permission Request',
      '$permission$patternSummary',
      const NotificationDetails(
        android: AndroidNotificationDetails(
          'atomcli_permissions',
          'Permission Requests',
          channelDescription: 'AtomCLI agent permission requests',
          importance: Importance.high,
          priority: Priority.high,
          playSound: true,
        ),
        iOS: DarwinNotificationDetails(
          presentAlert: true,
          presentBadge: true,
          presentSound: true,
        ),
      ),
    );
  }

  Future<void> cancelAll() => _plugin.cancelAll();
}
