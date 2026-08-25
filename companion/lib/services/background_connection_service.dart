import 'dart:async';
import 'dart:ui';

import 'package:flutter/widgets.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../models.dart';
import 'auth_service.dart';
import 'notification_service.dart';
import 'websocket_service.dart';

const _backgroundChannelId = 'atomcli_connection';
const _backgroundNotificationId = 4096;

class BackgroundConnectionService {
  static Future<void>? _resumeInFlight;
  static Future<void>? _pauseInFlight;

  static Future<void> configure({required bool startNow}) async {
    const channel = AndroidNotificationChannel(
      _backgroundChannelId,
      'AtomCLI connection',
      description:
          'Keeps the secure AtomCLI command link active in the background.',
      importance: Importance.low,
      showBadge: false,
    );
    final notifications = FlutterLocalNotificationsPlugin();
    await notifications
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.createNotificationChannel(channel);

    final service = FlutterBackgroundService();
    await service.configure(
      androidConfiguration: AndroidConfiguration(
        onStart: backgroundConnectionEntryPoint,
        autoStart: startNow,
        autoStartOnBoot: true,
        isForegroundMode: true,
        notificationChannelId: _backgroundChannelId,
        initialNotificationTitle: 'AtomCLI Companion',
        initialNotificationContent: 'Starting secure command link',
        foregroundServiceNotificationId: _backgroundNotificationId,
        foregroundServiceTypes: const [AndroidForegroundType.remoteMessaging],
      ),
      iosConfiguration: IosConfiguration(
        autoStart: false,
        onForeground: backgroundConnectionEntryPoint,
        onBackground: (_) async => true,
      ),
    );
  }

  static Future<void> start() => FlutterBackgroundService().startService();

  static Future<void> pauseForForeground() {
    final inFlight = _pauseInFlight;
    if (inFlight != null) return inFlight;
    final operation = _pauseServiceSocket();
    _pauseInFlight = operation;
    return operation.whenComplete(() {
      if (identical(_pauseInFlight, operation)) _pauseInFlight = null;
    });
  }

  static Future<void> _pauseServiceSocket() async {
    final service = FlutterBackgroundService();
    // Keep the Android foreground service alive while paired, even when the
    // UI owns the WebSocket. Starting it only after the app is already being
    // detached is too late on devices that kill the Flutter activity quickly.
    if (!await service.isRunning()) await service.startService();
    final requestId = DateTime.now().microsecondsSinceEpoch;
    final paused = service
        .on('socketPaused')
        .where((event) => event?['request_id'] == requestId)
        .first
        .timeout(
          const Duration(seconds: 4),
          onTimeout: () => const <String, dynamic>{},
        );
    void requestPause() =>
        service.invoke('pauseSocket', {'request_id': requestId});
    requestPause();
    final retry = Timer.periodic(
      const Duration(milliseconds: 300),
      (_) => requestPause(),
    );
    try {
      await paused;
    } finally {
      retry.cancel();
    }
  }

  static Future<void> resumeForBackground() async {
    final inFlight = _resumeInFlight;
    if (inFlight != null) return inFlight;
    final operation = _resumeService();
    _resumeInFlight = operation;
    try {
      await operation;
    } finally {
      _resumeInFlight = null;
    }
  }

  static Future<void> _resumeService() async {
    final service = FlutterBackgroundService();
    if (!await service.isRunning()) await service.startService();
    service.invoke('resumeSocket', {
      'request_id': DateTime.now().microsecondsSinceEpoch,
    });
  }

  static void stop() => FlutterBackgroundService().invoke('stopService');
}

@pragma('vm:entry-point')
void backgroundConnectionEntryPoint(ServiceInstance service) async {
  WidgetsFlutterBinding.ensureInitialized();
  DartPluginRegistrant.ensureInitialized();
  if (service is AndroidServiceInstance) {
    await service.setForegroundNotificationInfo(
      title: 'AtomCLI Companion',
      content: 'Loading saved command link',
    );
  }
  try {
    await NotificationService.instance.init(requestPermission: false);
  } catch (_) {
    // Keep the command link alive if notification plug-in initialization is
    // temporarily unavailable in the background isolate.
  }

  WebSocketService? socket;
  StreamSubscription<BackendEvent>? subscription;
  Future<void>? connectInFlight;
  var pausedForForeground = false;
  var latestHandoffId = 0;
  final activeTasks = <String, String>{};
  final sessionTasks = <String, String>{};
  final notifiedRequests = <String>{};

  bool shouldNotify(String id) {
    if (!notifiedRequests.add(id)) return false;
    while (notifiedRequests.length > 500) {
      notifiedRequests.remove(notifiedRequests.first);
    }
    return true;
  }

  Future<void> disconnect() async {
    final oldSubscription = subscription;
    final oldSocket = socket;
    subscription = null;
    socket = null;
    await oldSubscription?.cancel();
    await oldSocket?.dispose();
  }

  Future<void> updateTasks() =>
      NotificationService.instance.showTaskList(activeTasks.values.toList());

  void handleEvent(BackendEvent event) {
    if (event.type == 'permission_request') {
      final permission = PendingPermission.fromJson(event.payload);
      if (shouldNotify(permission.reqId)) {
        NotificationService.instance.showPermissionRequest(
          reqId: permission.reqId,
          permission: permission.permission,
          patterns: permission.patterns,
        );
      }
    }
    if (event.type == 'question_request') {
      final question = PendingQuestion.fromJson(event.payload);
      if (shouldNotify(question.reqId)) {
        NotificationService.instance.showPermissionRequest(
          reqId: question.reqId,
          permission: 'question',
          patterns: question.questions.map((item) => item.header).toList(),
        );
      }
    }
    if (event.type == 'artifact_shared') {
      final artifact = CompanionArtifact.fromJson(event.payload);
      if (artifact.direction == 'pc_to_mobile') {
        NotificationService.instance.showArtifact(artifact);
      }
    }
    if (event.type == 'preview_updated') {
      final preview = CompanionPreview.fromJson(event.payload);
      if (preview.status == 'running' || preview.status == 'failed') {
        NotificationService.instance.showPreview(preview);
      }
    }
    if (event.type == 'snapshot') {
      activeTasks.clear();
      sessionTasks.clear();
      final dag = event.payload['dag'] as List? ?? const [];
      for (final raw in dag.whereType<Map>()) {
        final step = DagStep.fromJson(Map<String, dynamic>.from(raw));
        if (_isActive(step.status)) {
          final key = _taskKey(step.name, step.sessionId, step.directory);
          activeTasks[key] = step.description.isEmpty
              ? step.name
              : step.description;
          if (step.sessionId != null) sessionTasks[step.sessionId!] = key;
        }
      }
      updateTasks();
      final permissions =
          event.payload['pending_permissions'] as List? ?? const [];
      for (final raw in permissions.whereType<Map>()) {
        final permission = PendingPermission.fromJson(
          Map<String, dynamic>.from(raw),
        );
        if (!shouldNotify(permission.reqId)) continue;
        NotificationService.instance.showPermissionRequest(
          reqId: permission.reqId,
          permission: permission.permission,
          patterns: permission.patterns,
        );
      }
      final questions = event.payload['pending_questions'] as List? ?? const [];
      for (final raw in questions.whereType<Map>()) {
        final question = PendingQuestion.fromJson(
          Map<String, dynamic>.from(raw),
        );
        if (!shouldNotify(question.reqId)) continue;
        NotificationService.instance.showPermissionRequest(
          reqId: question.reqId,
          permission: 'question',
          patterns: question.questions.map((item) => item.header).toList(),
        );
      }
    }
    if (event.type == 'event') {
      final topic = event.topic ?? '';
      final name = event.payload['name'] as String?;
      final sessionId = event.payload['sessionID'] as String?;
      final directory = event.payload['directory'] as String?;
      if (topic == 'tui.chain.add_step' && name != null) {
        final status = event.payload['status'] as String? ?? 'pending';
        if (_isActive(status)) {
          final key = _taskKey(name, sessionId, directory);
          activeTasks[key] = event.payload['description'] as String? ?? name;
          if (sessionId != null) sessionTasks[sessionId] = key;
        }
        updateTasks();
      }
      if (topic == 'tui.chain.update_step') {
        final key = sessionId == null
            ? (name == null ? null : _taskKey(name, null, directory))
            : sessionTasks[sessionId];
        if (key != null &&
            !_isActive(event.payload['status'] as String? ?? '')) {
          activeTasks.remove(key);
          updateTasks();
        }
      }
      if (topic == 'tui.chain.complete_step' ||
          topic == 'tui.chain.fail_step') {
        final key = sessionId == null ? name : sessionTasks.remove(sessionId);
        if (key != null) activeTasks.remove(key);
        updateTasks();
      }
    }
  }

  Future<void> performConnect() async {
    if (pausedForForeground || socket != null) return;
    bool paired;
    try {
      paired = await AuthService.instance.tryLoadExisting();
    } catch (_) {
      paired = false;
    }
    if (!paired || AuthService.instance.endpoints.isEmpty) {
      // autoStartOnBoot can invoke the service after pairing was removed.
      // Do not leave an unpaired foreground notification running forever.
      service.stopSelf();
      return;
    }

    socket = WebSocketService(
      endpoints: AuthService.instance.endpoints,
      initialSequence: AuthService.instance.lastSequence,
      onSequenceChange: AuthService.instance.recordSequence,
      onStateChange: (state) async {
        if (service is! AndroidServiceInstance) return;
        final content = switch (state) {
          WsLifecycle.connected => 'Connected and listening for decisions',
          WsLifecycle.connecting => 'Connecting to your machine',
          WsLifecycle.disconnected => 'Connection interrupted; retrying',
        };
        await service.setForegroundNotificationInfo(
          title: 'AtomCLI Companion',
          content: content,
        );
      },
    );
    subscription = socket!.connect().listen(handleEvent);
  }

  Future<void> connect() {
    final inFlight = connectInFlight;
    if (inFlight != null) return inFlight;

    final operation = performConnect();
    connectInFlight = operation;
    return operation.whenComplete(() {
      if (identical(connectInFlight, operation)) connectInFlight = null;
    });
  }

  service.on('pauseSocket').listen((event) async {
    final requestId = event?['request_id'] as int? ?? 0;
    if (requestId < latestHandoffId) return;
    latestHandoffId = requestId;
    pausedForForeground = true;
    await disconnect();
    if (requestId < latestHandoffId || !pausedForForeground) return;
    if (service is AndroidServiceInstance) {
      await service.setForegroundNotificationInfo(
        title: 'AtomCLI Companion',
        content: 'Connected through the open app',
      );
    }
    service.invoke('socketPaused', {'request_id': requestId});
  });

  service.on('resumeSocket').listen((event) async {
    final requestId = event?['request_id'] as int? ?? 0;
    if (requestId < latestHandoffId) return;
    latestHandoffId = requestId;
    pausedForForeground = false;
    await connect();
  });

  service.on('stopService').listen((_) async {
    await disconnect();
    await NotificationService.instance.showTaskList(const []);
    service.stopSelf();
  });

  await connect();
}

bool _isActive(String status) =>
    status == 'running' || status == 'in_progress' || status.endsWith('ing');

String _taskKey(String name, String? sessionId, String? directory) =>
    '${directory ?? ''}\u0000${sessionId ?? ''}\u0000$name';
