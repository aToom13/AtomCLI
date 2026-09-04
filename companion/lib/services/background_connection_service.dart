import 'dart:async';
import 'dart:ui';

import 'package:flutter/widgets.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../l10n/app_localizations.dart';
import '../l10n/app_localizations_en.dart';
import '../l10n/app_localizations_tr.dart';
import '../models.dart';
import 'auth_service.dart';
import 'companion_preferences.dart';
import 'notification_service.dart';
import 'power_policy.dart';
import 'websocket_service.dart';

const _backgroundChannelId = 'atomcli_connection';
const _backgroundNotificationId = 4096;

class BackgroundConnectionService {
  static Future<void>? _resumeInFlight;
  static Future<void>? _pauseInFlight;
  static Future<void>? _stopInFlight;

  static Future<void> configure({required bool startNow}) async {
    final strings = _backgroundStrings();
    final channel = AndroidNotificationChannel(
      _backgroundChannelId,
      strings.backgroundChannelName,
      description: strings.backgroundChannelDescription,
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
        // Android 12+ can reject foreground-service launches from boot and
        // package-replaced receivers. Reconnect only from a visible app
        // lifecycle transition or an explicit notification action.
        autoStartOnBoot: false,
        isForegroundMode: true,
        notificationChannelId: _backgroundChannelId,
        initialNotificationTitle: strings.appTitle,
        initialNotificationContent: strings.backgroundStarting,
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

  static Future<void> stopAndWait() {
    final inFlight = _stopInFlight;
    if (inFlight != null) return inFlight;
    final operation = _stopServiceAndWait();
    _stopInFlight = operation;
    return operation.whenComplete(() {
      if (identical(_stopInFlight, operation)) _stopInFlight = null;
    });
  }

  static Future<void> _stopServiceAndWait() async {
    // A background handoff may still be starting the service when Android
    // reports the activity as resumed. Let that operation settle before
    // claiming foreground ownership; otherwise this method can observe
    // "not running" just before the second isolate opens a competing socket.
    await _resumeInFlight;
    final service = FlutterBackgroundService();
    if (!await service.isRunning()) return;
    // isRunning becomes true before the background Dart isolate necessarily
    // registers its event listeners. Retry the bounded stop signal so a
    // foreground resume cannot lose the only handoff message.
    for (var attempt = 0; attempt < 50; attempt++) {
      service.invoke('stopService');
      await Future<void>.delayed(const Duration(milliseconds: 100));
      if (!await service.isRunning()) return;
    }
    throw StateError('Background connection service did not stop in time');
  }

  static Stream<Map<String, dynamic>?> get notificationActions =>
      FlutterBackgroundService().on('notificationActionForForeground');

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

  static Future<void> resumeForBackground(ConnectionPowerMode mode) async {
    final inFlight = _resumeInFlight;
    if (inFlight != null) return inFlight;
    final operation = _resumeService(mode);
    _resumeInFlight = operation;
    try {
      await operation;
    } finally {
      _resumeInFlight = null;
    }
  }

  static Future<void> _resumeService(ConnectionPowerMode mode) async {
    final service = FlutterBackgroundService();
    if (!await service.isRunning()) await service.startService();
    service.invoke('resumeSocket', {
      'request_id': DateTime.now().microsecondsSinceEpoch,
      'power_mode': mode.wireName,
    });
  }

  static void stop() => FlutterBackgroundService().invoke('stopService');
}

@pragma('vm:entry-point')
void backgroundConnectionEntryPoint(ServiceInstance service) async {
  WidgetsFlutterBinding.ensureInitialized();
  DartPluginRegistrant.ensureInitialized();
  final strings = _backgroundStrings();
  if (service is AndroidServiceInstance) {
    await service.setForegroundNotificationInfo(
      title: strings.appTitle,
      content: strings.backgroundLoading,
    );
  }
  try {
    await NotificationService.instance.init(requestPermission: false);
  } catch (_) {
    // Keep the command link alive if notification plug-in initialization is
    // temporarily unavailable in the background isolate.
  }
  await CompanionPreferences.instance.load();

  WebSocketService? socket;
  StreamSubscription<BackendEvent>? subscription;
  Future<void>? connectInFlight;
  var pausedForForeground = false;
  var powerMode = ConnectionPowerMode.balanced;
  var latestHandoffId = 0;
  final liveTasks = LiveTaskTracker();
  final activeSessionIds = <String>{};
  var receivedSessionList = false;
  final notifiedRequests = <String>{};
  final pendingNotificationIds = <String>{};
  final notificationActionsInFlight = <String>{};

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

  Future<void> stopBalancedWhenIdle() async {
    if (powerMode != ConnectionPowerMode.balanced ||
        !receivedSessionList ||
        liveTasks.activeTasks.isNotEmpty ||
        activeSessionIds.isNotEmpty ||
        pendingNotificationIds.isNotEmpty ||
        pausedForForeground) {
      return;
    }
    await disconnect();
    await NotificationService.instance.showTaskList(const {});
    service.stopSelf();
  }

  Future<void> updateTasks({bool evaluateIdle = true}) async {
    await NotificationService.instance.showTaskList(liveTasks.activeTasks);
    if (evaluateIdle) await stopBalancedWhenIdle();
  }

  void handleEvent(BackendEvent event) {
    if (event.type == 'session_list') {
      activeSessionIds.clear();
      final sessions = event.payload['sessions'] as List? ?? const [];
      for (final raw in sessions.whereType<Map>()) {
        final session = SessionInfo.fromJson(Map<String, dynamic>.from(raw));
        if (session.isActive) activeSessionIds.add(session.id);
      }
      receivedSessionList = true;
      unawaited(stopBalancedWhenIdle());
    }
    if (event.type == 'session_status') {
      final sessionId = event.payload['sessionID'] as String?;
      final status = event.payload['status'];
      final type = status is Map ? status['type'] as String? : null;
      if (sessionId != null && (type == 'busy' || type == 'retry')) {
        activeSessionIds.add(sessionId);
      } else if (sessionId != null && type != null) {
        activeSessionIds.remove(sessionId);
        unawaited(stopBalancedWhenIdle());
      }
    }
    if (event.type == 'permission_request') {
      final permission = PendingPermission.fromJson(event.payload);
      pendingNotificationIds.add(permission.reqId);
      if (shouldNotify(permission.reqId)) {
        NotificationService.instance.showPermissionRequest(
          reqId: permission.reqId,
          permission: permission.permission,
          patterns: permission.patterns,
          sessionId: permission.sessionId,
          directory: permission.directory,
        );
      }
    }
    if (event.type == 'question_request') {
      final question = PendingQuestion.fromJson(event.payload);
      pendingNotificationIds.add(question.reqId);
      if (shouldNotify(question.reqId)) {
        NotificationService.instance.showQuestionRequest(question);
      }
    }
    if (event.type == 'permission_resolved' ||
        event.type == 'question_resolved') {
      final requestId = event.payload['requestID'] as String?;
      if (requestId != null) {
        pendingNotificationIds.remove(requestId);
        NotificationService.instance.cancelRequest(requestId);
        unawaited(stopBalancedWhenIdle());
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
      final snapshotRequestIds = <String>{};
      final dag = event.payload['dag'] as List? ?? const [];
      liveTasks.replace(
        dag.whereType<Map>().map(
          (raw) => DagStep.fromJson(Map<String, dynamic>.from(raw)),
        ),
      );
      unawaited(updateTasks(evaluateIdle: false));
      final permissions =
          event.payload['pending_permissions'] as List? ?? const [];
      for (final raw in permissions.whereType<Map>()) {
        final permission = PendingPermission.fromJson(
          Map<String, dynamic>.from(raw),
        );
        snapshotRequestIds.add(permission.reqId);
        if (!shouldNotify(permission.reqId)) continue;
        NotificationService.instance.showPermissionRequest(
          reqId: permission.reqId,
          permission: permission.permission,
          patterns: permission.patterns,
          sessionId: permission.sessionId,
          directory: permission.directory,
        );
      }
      final questions = event.payload['pending_questions'] as List? ?? const [];
      for (final raw in questions.whereType<Map>()) {
        final question = PendingQuestion.fromJson(
          Map<String, dynamic>.from(raw),
        );
        snapshotRequestIds.add(question.reqId);
        if (!shouldNotify(question.reqId)) continue;
        NotificationService.instance.showQuestionRequest(question);
      }
      for (final staleId in pendingNotificationIds.difference(
        snapshotRequestIds,
      )) {
        NotificationService.instance.cancelRequest(staleId);
      }
      pendingNotificationIds
        ..clear()
        ..addAll(snapshotRequestIds);
      unawaited(stopBalancedWhenIdle());
    }
    if (event.type == 'event') {
      final topic = event.topic ?? '';
      if (liveTasks.apply(topic, event.payload)) {
        final isChainBoundary =
            topic == 'tui.chain.start' || topic == 'tui.chain.clear';
        unawaited(updateTasks(evaluateIdle: !isChainBoundary));
        if (topic == 'tui.chain.clear') {
          // Orchestrate emits clear/start/add as a burst when replacing a DAG.
          // Give those events time to arrive before Balanced mode concludes
          // that the bridge became idle. A final clear still stops promptly.
          unawaited(
            Future<void>.delayed(
              const Duration(seconds: 1),
              stopBalancedWhenIdle,
            ),
          );
        }
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

    receivedSessionList = false;
    activeSessionIds.clear();
    socket = WebSocketService(
      endpoints: AuthService.instance.endpoints,
      initialSequence: AuthService.instance.lastSequence,
      heartbeatInterval: CompanionPowerPolicy.backgroundHeartbeat(powerMode),
      heartbeatTimeout: CompanionPowerPolicy.backgroundHeartbeatTimeout(
        powerMode,
      ),
      retryCap: CompanionPowerPolicy.backgroundRetryCap,
      onSequenceChange: AuthService.instance.recordSequence,
      onStateChange: (state) async {
        if (service is! AndroidServiceInstance) return;
        final content = switch (state) {
          WsLifecycle.connected => strings.backgroundConnected,
          WsLifecycle.connecting => strings.backgroundConnecting,
          WsLifecycle.disconnected => strings.backgroundRetrying,
        };
        await service.setForegroundNotificationInfo(
          title: strings.appTitle,
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
        title: strings.appTitle,
        content: strings.backgroundOpenApp,
      );
    }
    service.invoke('socketPaused', {'request_id': requestId});
  });

  service.on('resumeSocket').listen((event) async {
    final requestId = event?['request_id'] as int? ?? 0;
    if (requestId < latestHandoffId) return;
    latestHandoffId = requestId;
    pausedForForeground = false;
    powerMode = ConnectionPowerModeCodec.parse(event?['power_mode']);
    await connect();
  });

  service.on('notificationAction').listen((event) async {
    if (event == null) return;
    NotificationActionRequest request;
    try {
      request = NotificationActionRequest.fromJson(
        Map<String, dynamic>.from(event),
      );
    } catch (_) {
      return;
    }
    if (!notificationActionsInFlight.add(request.dedupeKey)) return;
    try {
      if (pausedForForeground) {
        service.invoke('notificationActionForForeground', request.toJson());
        return;
      }
      await connect();
      final activeSocket = socket;
      if (activeSocket == null) {
        throw StateError(strings.backgroundNoMachine);
      }
      if (!activeSocket.isConnected) {
        await activeSocket.ensureConnected().timeout(
          const Duration(seconds: 6),
        );
      }
      if (!activeSocket.isConnected) {
        throw StateError(strings.permissionOffline);
      }
      final result = await executeNotificationAction(
        activeSocket,
        request,
      ).timeout(const Duration(seconds: 12));
      await NotificationService.instance.showActionResult(
        request,
        success: result.isOk,
        error: result.error,
      );
    } catch (error) {
      await NotificationService.instance.showActionResult(
        request,
        success: false,
        error: error.toString().replaceFirst('Bad state: ', ''),
      );
    } finally {
      notificationActionsInFlight.remove(request.dedupeKey);
    }
  });

  service.on('stopService').listen((_) async {
    await disconnect();
    await NotificationService.instance.showTaskList(const {});
    service.stopSelf();
  });

  await connect();
}

AppLocalizations _backgroundStrings() =>
    PlatformDispatcher.instance.locale.languageCode == 'tr'
    ? AppLocalizationsTr()
    : AppLocalizationsEn();
