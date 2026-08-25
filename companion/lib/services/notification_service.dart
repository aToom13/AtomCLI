import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../models.dart';

const _taskListNotificationId = 4097;

/// Service for showing local device notifications for permission requests.
class NotificationService {
  NotificationService._();
  static final instance = NotificationService._();

  final _plugin = FlutterLocalNotificationsPlugin();
  bool _initialized = false;

  Future<void> init({bool requestPermission = true}) async {
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
    if (requestPermission) {
      await _plugin
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >()
          ?.requestNotificationsPermission();
    }
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
      'Permission request',
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

  Future<void> showArtifact(CompanionArtifact artifact) async {
    await _plugin.show(
      artifact.id.hashCode,
      '${artifact.sourceDevice} sent ${artifact.kind == 'image' ? 'an image' : 'a file'}',
      artifact.title,
      const NotificationDetails(
        android: AndroidNotificationDetails(
          'atomcli_transfers',
          'Files and previews',
          channelDescription: 'Files, images and live previews sent by AtomCLI',
          importance: Importance.high,
          priority: Priority.high,
        ),
      ),
    );
  }

  Future<void> showPreview(CompanionPreview preview) async {
    await _plugin.show(
      preview.id.hashCode,
      '${preview.sourceDevice} shared a live preview',
      '${preview.title} is ${preview.status}',
      const NotificationDetails(
        android: AndroidNotificationDetails(
          'atomcli_transfers',
          'Files and previews',
          channelDescription: 'Files, images and live previews sent by AtomCLI',
          importance: Importance.high,
          priority: Priority.high,
        ),
      ),
    );
  }

  Future<void> showTaskList(List<String> tasks) async {
    if (tasks.isEmpty) {
      await _plugin.cancel(_taskListNotificationId);
      return;
    }
    final visible = tasks.take(6).toList();
    await _plugin.show(
      _taskListNotificationId,
      '${tasks.length} active AtomCLI ${tasks.length == 1 ? 'task' : 'tasks'}',
      visible.first,
      NotificationDetails(
        android: AndroidNotificationDetails(
          'atomcli_tasks',
          'Active tasks',
          channelDescription: 'Live AtomCLI task and agent progress',
          importance: Importance.low,
          priority: Priority.low,
          ongoing: true,
          onlyAlertOnce: true,
          showProgress: true,
          indeterminate: true,
          styleInformation: InboxStyleInformation(
            visible,
            contentTitle:
                '${tasks.length} active AtomCLI ${tasks.length == 1 ? 'task' : 'tasks'}',
            summaryText: 'Open Companion for live details',
          ),
        ),
      ),
    );
  }

  Future<void> cancelAll() => _plugin.cancelAll();
}
