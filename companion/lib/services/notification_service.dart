import 'dart:async';
import 'dart:convert';
import 'dart:ui';

import 'package:atomcli_android_live_updates/atomcli_android_live_updates.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../models.dart';
import '../l10n/app_localizations.dart';
import 'auth_service.dart';
import 'companion_preferences.dart';
import 'deep_link_service.dart';
import 'privacy_policy.dart';
import 'websocket_service.dart';

const _taskListNotificationId = 4097;
const _allowOnceAction = 'permission_allow_once';
const _denyAction = 'permission_deny';
const _replyAction = 'question_reply';
const _rejectQuestionAction = 'question_reject';

class NotificationActionRequest {
  final int notificationId;
  final String actionId;
  final String requestId;
  final String? directory;
  final String? input;

  const NotificationActionRequest({
    required this.notificationId,
    required this.actionId,
    required this.requestId,
    this.directory,
    this.input,
  });

  String get dedupeKey => '$requestId\u0000$actionId';

  Map<String, dynamic> toJson() => {
    'notification_id': notificationId,
    'action_id': actionId,
    'request_id': requestId,
    if (directory != null) 'directory': directory,
    if (input != null) 'input': input,
  };

  factory NotificationActionRequest.fromJson(Map<String, dynamic> json) =>
      NotificationActionRequest(
        notificationId: json['notification_id'] as int,
        actionId: json['action_id'] as String,
        requestId: json['request_id'] as String,
        directory: json['directory'] as String?,
        input: json['input'] as String?,
      );

  static NotificationActionRequest? fromResponse(
    NotificationResponse response,
  ) {
    final actionId = response.actionId;
    final rawPayload = response.payload;
    if (actionId == null || actionId.isEmpty || rawPayload == null) return null;
    try {
      final payload = Map<String, dynamic>.from(jsonDecode(rawPayload) as Map);
      return NotificationActionRequest(
        notificationId: response.id ?? payload['notification_id'] as int,
        actionId: actionId,
        requestId: payload['request_id'] as String,
        directory: payload['directory'] as String?,
        input: response.input?.trim(),
      );
    } catch (_) {
      return null;
    }
  }
}

@pragma('vm:entry-point')
void notificationBackgroundResponse(NotificationResponse response) async {
  WidgetsFlutterBinding.ensureInitialized();
  DartPluginRegistrant.ensureInitialized();
  final request = NotificationActionRequest.fromResponse(response);
  if (request == null) return;
  final service = FlutterBackgroundService();
  final wasRunning = await service.isRunning();
  if (!wasRunning) {
    await service.startService();
    // Android starts the service isolate asynchronously. The request is sent
    // only after a small bounded grace period and is never persisted as an
    // offline authority decision.
    await Future<void>.delayed(const Duration(milliseconds: 700));
  }
  service.invoke('notificationAction', request.toJson());
}

/// Service for showing local device notifications for permission requests.
class NotificationService {
  NotificationService._();
  static final instance = NotificationService._();

  final _plugin = FlutterLocalNotificationsPlugin();
  final _actions = StreamController<NotificationActionRequest>.broadcast();
  final _navigationLinks = StreamController<CompanionDeepLink>.broadcast();
  bool _initialized = false;
  String? _liveTaskId;
  int? _liveTaskStartedAt;
  String? _liveTaskFingerprint;

  AppLocalizations get _strings {
    final locale = PlatformDispatcher.instance.locale;
    return lookupAppLocalizations(
      const {'en', 'tr'}.contains(locale.languageCode)
          ? locale
          : const Locale('en'),
    );
  }

  Stream<NotificationActionRequest> get actions => _actions.stream;
  Stream<CompanionDeepLink> get navigationLinks => _navigationLinks.stream;

  NotificationPrivacyMode get _privacy =>
      CompanionPreferences.instance.notificationPrivacy;
  bool get _showDetails =>
      CompanionPrivacyPolicy.showSensitiveNotificationContent(_privacy);
  NotificationVisibility get _visibility =>
      CompanionPrivacyPolicy.hideNotificationFromSecureLockScreen(_privacy)
      ? NotificationVisibility.secret
      : NotificationVisibility.private;

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
      onDidReceiveNotificationResponse: (response) {
        final request = NotificationActionRequest.fromResponse(response);
        if (request != null) {
          _actions.add(request);
          return;
        }
        final link = _navigationFromPayload(response.payload);
        if (link != null) _navigationLinks.add(link);
      },
      onDidReceiveBackgroundNotificationResponse:
          notificationBackgroundResponse,
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
    String? sessionId,
    String? directory,
  }) async {
    final notificationId = reqId.hashCode;
    final payload = jsonEncode({
      'notification_id': notificationId,
      'request_id': reqId,
      'directory': ?directory,
      'deep_link': _link(
        CompanionDestination.inbox,
        sessionId: sessionId,
        requestId: reqId,
      ),
    });
    final body = _showDetails
        ? (patterns.isEmpty
              ? permission
              : '$permission · ${_strings.targetCount(patterns.length)}')
        : _strings.notificationContentProtected;

    await _plugin.show(
      notificationId,
      _strings.permissionRequest,
      body,
      NotificationDetails(
        android: AndroidNotificationDetails(
          'atomcli_permissions',
          _strings.permissionRequestsChannel,
          channelDescription: _strings.permissionRequestsDescription,
          importance: Importance.high,
          priority: Priority.high,
          playSound: true,
          visibility: _visibility,
          actions: [
            AndroidNotificationAction(
              _allowOnceAction,
              _strings.allowOnce,
              cancelNotification: false,
              semanticAction: SemanticAction.thumbsUp,
            ),
            AndroidNotificationAction(
              _denyAction,
              _strings.deny,
              cancelNotification: false,
              semanticAction: SemanticAction.thumbsDown,
            ),
          ],
        ),
        iOS: const DarwinNotificationDetails(
          presentAlert: true,
          presentBadge: true,
          presentSound: true,
        ),
      ),
      payload: payload,
    );
  }

  Future<void> showQuestionRequest(PendingQuestion request) async {
    final notificationId = request.reqId.hashCode;
    final supportsDirectReply = supportsDirectNotificationReply(request);
    final payload = jsonEncode({
      'notification_id': notificationId,
      'request_id': request.reqId,
      'directory': ?request.directory,
      'deep_link': _link(
        CompanionDestination.inbox,
        sessionId: request.sessionId,
        requestId: request.reqId,
      ),
    });
    await _plugin.show(
      notificationId,
      _showDetails && request.questions.length == 1
          ? request.questions.single.header
          : _strings.questionsFromAtomcli(request.questions.length),
      _showDetails && request.questions.length == 1
          ? request.questions.single.question
          : _strings.notificationContentProtected,
      NotificationDetails(
        android: AndroidNotificationDetails(
          'atomcli_questions',
          _strings.agentQuestionsChannel,
          channelDescription: _strings.agentQuestionsDescription,
          importance: Importance.high,
          priority: Priority.high,
          playSound: true,
          visibility: _visibility,
          actions: [
            if (supportsDirectReply)
              AndroidNotificationAction(
                _replyAction,
                _strings.reply,
                cancelNotification: false,
                allowGeneratedReplies: true,
                semanticAction: SemanticAction.reply,
                inputs: [
                  AndroidNotificationActionInput(label: _strings.answer),
                ],
              ),
            AndroidNotificationAction(
              _rejectQuestionAction,
              _strings.decline,
              cancelNotification: false,
              semanticAction: SemanticAction.thumbsDown,
            ),
          ],
        ),
        iOS: const DarwinNotificationDetails(
          presentAlert: true,
          presentBadge: true,
          presentSound: true,
        ),
      ),
      payload: payload,
    );
  }

  Future<void> showActionResult(
    NotificationActionRequest request, {
    required bool success,
    String? error,
  }) async {
    final title = success ? _strings.confirmed : _strings.actionNotCompleted;
    final body = success
        ? _strings.requestAcknowledged
        : _showDetails
        ? error ?? _strings.openAndCheckConnection
        : _strings.openAndCheckConnection;
    await _plugin.show(
      request.notificationId,
      title,
      body,
      NotificationDetails(
        android: AndroidNotificationDetails(
          'atomcli_action_results',
          _strings.actionResultsChannel,
          channelDescription: _strings.actionResultsDescription,
          importance: success ? Importance.low : Importance.high,
          priority: success ? Priority.low : Priority.high,
          onlyAlertOnce: success,
          playSound: !success,
          visibility: _visibility,
          timeoutAfter: success ? 4000 : null,
        ),
      ),
    );
  }

  Future<void> cancelRequest(String requestId) =>
      _plugin.cancel(requestId.hashCode);

  Future<void> showArtifact(CompanionArtifact artifact) async {
    await _plugin.show(
      artifact.id.hashCode,
      _showDetails
          ? (artifact.kind == 'image'
                ? _strings.sentImage(artifact.sourceDevice)
                : _strings.sentFile(artifact.sourceDevice))
          : _strings.transferReady,
      _showDetails ? artifact.title : _strings.notificationContentProtected,
      NotificationDetails(
        android: AndroidNotificationDetails(
          'atomcli_transfers',
          _strings.filesAndPreviewsChannel,
          channelDescription: _strings.filesAndPreviewsDescription,
          importance: Importance.high,
          priority: Priority.high,
          visibility: _visibility,
        ),
      ),
      payload: jsonEncode({
        'deep_link': _link(
          CompanionDestination.deck,
          sessionId: artifact.sessionId,
        ),
      }),
    );
  }

  Future<void> showPreview(CompanionPreview preview) async {
    await _plugin.show(
      preview.id.hashCode,
      _showDetails
          ? _strings.sharedPreview(preview.sourceDevice)
          : _strings.previewReady,
      _showDetails
          ? _strings.previewStatus(preview.title, preview.status)
          : _strings.notificationContentProtected,
      NotificationDetails(
        android: AndroidNotificationDetails(
          'atomcli_transfers',
          _strings.filesAndPreviewsChannel,
          channelDescription: _strings.filesAndPreviewsDescription,
          importance: Importance.high,
          priority: Priority.high,
          visibility: _visibility,
        ),
      ),
      payload: jsonEncode({
        'deep_link': _link(
          CompanionDestination.deck,
          sessionId: preview.sessionId,
        ),
      }),
    );
  }

  Future<void> showTaskList(Map<String, String> tasks) async {
    if (tasks.isEmpty) {
      _liveTaskId = null;
      _liveTaskStartedAt = null;
      _liveTaskFingerprint = null;
      try {
        await AtomcliAndroidLiveUpdates.cancel(_taskListNotificationId);
      } on MissingPluginException {
        // Older development builds fall back to the portable notification.
      } on PlatformException {
        // A standard notification remains the compatibility fallback.
      }
      await _plugin.cancel(_taskListNotificationId);
      return;
    }
    final primary = tasks.entries.first;
    final visible = tasks.values.take(6).toList();
    final fingerprint = tasks.entries
        .map((entry) => '${entry.key}\u0001${entry.value}')
        .join('\u0002');
    if (_liveTaskFingerprint == fingerprint) return;
    _liveTaskFingerprint = fingerprint;
    if (_liveTaskId != primary.key) {
      _liveTaskId = primary.key;
      _liveTaskStartedAt = DateTime.now().millisecondsSinceEpoch;
    }
    final progress = liveTaskProgress(primary.value);
    final taskTitle = liveTaskTitle(primary.value);
    final title = _showDetails
        ? taskTitle
        : (tasks.length == 1
              ? _strings.taskInProgress
              : _strings.activeTasks(tasks.length));
    final text = _showDetails
        ? [
            progress == null
                ? _strings.taskInProgress
                : _strings.liveTaskProgress(progress.completed, progress.total),
            if (tasks.length > 1) _strings.otherActiveTasks(tasks.length - 1),
          ].join(' · ')
        : _strings.notificationContentProtected;
    final workflowId = primary.key.startsWith('workflow:')
        ? primary.key.substring('workflow:'.length)
        : null;
    final taskLink = _link(CompanionDestination.deck, workflowId: workflowId);
    try {
      final native = await AtomcliAndroidLiveUpdates.show(
        notificationId: _taskListNotificationId,
        title: title,
        text: text,
        // A compact x/y count does not expose task content, so keep useful
        // progress visible even when notification details are protected.
        shortText: liveTaskShortText(primary.value),
        progress: progress?.completed,
        progressMax: progress?.total,
        startedAtMillis:
            _liveTaskStartedAt ?? DateTime.now().millisecondsSinceEpoch,
        deepLink: taskLink,
        hideOnLockScreen:
            CompanionPrivacyPolicy.hideNotificationFromSecureLockScreen(
              _privacy,
            ),
      );
      if (native != null) return;
    } on MissingPluginException {
      // Continue with the portable notification on an older installed build.
    } on PlatformException {
      // Live Update eligibility is best-effort and controlled by Android/OEM.
    }
    await _plugin.show(
      _taskListNotificationId,
      title,
      text,
      NotificationDetails(
        android: AndroidNotificationDetails(
          'atomcli_tasks',
          _strings.activeTasksChannel,
          channelDescription: _strings.activeTasksDescription,
          importance: Importance.low,
          priority: Priority.low,
          ongoing: true,
          onlyAlertOnce: true,
          usesChronometer: true,
          when: _liveTaskStartedAt,
          styleInformation: BigTextStyleInformation(
            text,
            contentTitle: title,
            summaryText: visible.length > 1
                ? _strings.taskSummary(visible.length)
                : _strings.openForDetails,
          ),
          visibility: _visibility,
        ),
      ),
      payload: jsonEncode({'deep_link': taskLink}),
    );
  }

  Future<void> cancelAll() async {
    try {
      await AtomcliAndroidLiveUpdates.cancel(_taskListNotificationId);
    } on MissingPluginException {
      // Nothing native was posted by this installed build.
    } on PlatformException {
      // Continue clearing the portable notification set.
    }
    await _plugin.cancelAll();
  }

  String _link(
    CompanionDestination destination, {
    String? sessionId,
    String? requestId,
    String? workflowId,
  }) => CompanionDeepLink(
    destination: destination,
    profileId: AuthService.instance.activeProfileId,
    machineId: AuthService.instance.machineId,
    sessionId: sessionId,
    requestId: requestId,
    workflowId: workflowId,
  ).toUri().toString();

  CompanionDeepLink? _navigationFromPayload(String? payload) {
    if (payload == null) return null;
    try {
      final value = jsonDecode(payload) as Map;
      return CompanionDeepLink.tryParse(value['deep_link']);
    } catch (_) {
      return null;
    }
  }
}

/// Keeps the background isolate's small, authoritative view of workflow DAGs.
/// Pending steps must be retained: their later status events often omit the
/// step name, so dropping them prevents both progress and completion updates.
class LiveTaskTracker {
  final Map<String, DagStep> _steps = {};

  Map<String, String> get activeTasks {
    final groups = <String, List<DagStep>>{};
    for (final step in _steps.values) {
      final group = step.workflowId?.isNotEmpty == true
          ? 'workflow:${step.workflowId}'
          : 'session:${step.directory ?? ''}\u0000${step.sessionId ?? step.name}';
      groups.putIfAbsent(group, () => []).add(step);
    }

    final result = <String, String>{};
    for (final entry in groups.entries) {
      final steps = entry.value;
      if (steps.isEmpty || steps.every((step) => _isTerminal(step.status))) {
        continue;
      }
      final completed = steps.where((step) => _isComplete(step.status)).length;
      final current = steps.cast<DagStep?>().firstWhere(
        (step) => step != null && _isRunning(step.status),
        orElse: () => steps.cast<DagStep?>().firstWhere(
          (step) => step != null && !_isTerminal(step.status),
          orElse: () => steps.first,
        ),
      )!;
      final label = current.description.trim().isEmpty
          ? current.name
          : current.description.trim();
      result[entry.key] = '$label · $completed/${steps.length}';
    }
    return result;
  }

  void replace(Iterable<DagStep> steps) {
    _steps
      ..clear()
      ..addEntries(steps.map((step) => MapEntry(_key(step), step)));
  }

  bool apply(String topic, Map<String, dynamic> payload) {
    if (topic == 'tui.chain.start' || topic == 'tui.chain.clear') {
      final removed = _removeMatching(payload);
      return removed || topic == 'tui.chain.start';
    }
    if (topic == 'tui.chain.add_step') {
      final step = DagStep.fromJson(payload);
      _steps[_key(step)] = step;
      return true;
    }
    if (topic == 'tui.chain.update_step') {
      final candidates = _matching(payload);
      final name = payload['name'] as String?;
      final selected = name == null
          ? candidates.reversed.firstWhere(
              (step) => _isRunning(step.status),
              orElse: () => candidates.reversed.firstWhere(
                (step) => !_isTerminal(step.status),
                orElse: () => candidates.isEmpty
                    ? const DagStep(
                        name: '',
                        description: '',
                        status: 'complete',
                      )
                    : candidates.last,
              ),
            )
          : candidates.reversed.firstWhere(
              (step) => step.name == name,
              orElse: () => candidates.isEmpty
                  ? const DagStep(name: '', description: '', status: 'complete')
                  : candidates.last,
            );
      if (selected.name.isEmpty) return false;
      _replaceStep(
        selected,
        selected.copyWith(status: payload['status'] as String?),
      );
      return true;
    }
    if (topic == 'tui.chain.complete_step' || topic == 'tui.chain.fail_step') {
      final status = topic == 'tui.chain.complete_step' ? 'complete' : 'failed';
      final candidates = _matching(payload);
      for (final step in candidates) {
        if (!_isTerminal(step.status)) {
          _replaceStep(step, step.copyWith(status: status));
        }
      }
      return candidates.isNotEmpty;
    }
    if (topic == 'tui.chain.parallel.update') {
      final candidates = _matching(payload);
      final index = payload['stepIndex'] as int?;
      if (index == null || index < 0 || index >= candidates.length) {
        return false;
      }
      final step = candidates[index];
      _replaceStep(step, step.copyWith(status: payload['status'] as String?));
      return true;
    }
    return false;
  }

  List<DagStep> _matching(Map<String, dynamic> payload) {
    final workflowId = payload['workflowId'] as String?;
    final sessionId = (payload['sessionID'] ?? payload['sessionId']) as String?;
    final directory = payload['directory'] as String?;
    return _steps.values.where((step) {
      if (workflowId != null && step.workflowId != workflowId) return false;
      if (sessionId != null && step.sessionId != sessionId) return false;
      if (directory != null && step.directory != directory) return false;
      return workflowId != null || sessionId != null || directory != null;
    }).toList();
  }

  bool _removeMatching(Map<String, dynamic> payload) {
    final matches = _matching(payload).map(_key).toSet();
    for (final key in matches) {
      _steps.remove(key);
    }
    return matches.isNotEmpty;
  }

  void _replaceStep(DagStep oldStep, DagStep newStep) {
    final oldKey = _key(oldStep);
    final newKey = _key(newStep);
    if (oldKey == newKey) {
      // Assigning an existing LinkedHashMap key preserves DAG insertion order,
      // which is also the contract used by `tui.chain.parallel.update` indexes.
      _steps[oldKey] = newStep;
      return;
    }
    _steps.remove(oldKey);
    _steps[newKey] = newStep;
  }

  static String _key(DagStep step) => step.stepId?.isNotEmpty == true
      ? '${step.directory ?? ''}\u0000${step.workflowId ?? ''}\u0000${step.stepId}'
      : '${step.directory ?? ''}\u0000${step.workflowId ?? ''}\u0000${step.sessionId ?? ''}\u0000${step.name}';

  static bool _isComplete(String status) =>
      status == 'complete' || status == 'completed' || status == 'done';

  static bool _isTerminal(String status) =>
      _isComplete(status) ||
      status == 'failed' ||
      status == 'stopped' ||
      status == 'skipped';

  static bool _isRunning(String status) =>
      status == 'running' || status == 'in_progress' || status.endsWith('ing');
}

String liveTaskShortText(String task) {
  final progress = liveTaskProgress(task);
  if (progress == null) return 'LIVE';
  final value = '${progress.completed}/${progress.total}';
  return value.length <= 7 ? value : 'LIVE';
}

String liveTaskTitle(String task) {
  final title = task.replaceFirst(
    RegExp(r'\s+·\s+\d{1,3}\s*/\s*\d{1,3}\s*$'),
    '',
  );
  return title.trim().isEmpty ? task.trim() : title.trim();
}

({int completed, int total})? liveTaskProgress(String task) {
  final matches = RegExp(
    r'(?<!\d)(\d{1,3})\s*/\s*(\d{1,3})(?!\d)',
  ).allMatches(task).toList();
  if (matches.isEmpty) return null;
  final match = matches.last;
  final completed = int.parse(match.group(1)!);
  final total = int.parse(match.group(2)!);
  if (total <= 0 || completed < 0 || completed > total) return null;
  return (completed: completed, total: total);
}

bool supportsDirectNotificationReply(PendingQuestion request) =>
    request.questions.length == 1 && request.questions.single.type == 'text';

Future<ActionResult> executeNotificationAction(
  WebSocketService socket,
  NotificationActionRequest request,
) {
  if (request.actionId == _replyAction &&
      (request.input == null || request.input!.isEmpty)) {
    return Future.error(StateError('Enter a reply before sending.'));
  }
  return switch (request.actionId) {
    _allowOnceAction => socket.resolvePermission(
      reqId: request.requestId,
      resolution: 'allow_once',
      directory: request.directory,
    ),
    _denyAction => socket.resolvePermission(
      reqId: request.requestId,
      resolution: 'deny',
      directory: request.directory,
    ),
    _replyAction => socket.replyQuestion(
      id: request.requestId,
      answers: [
        [request.input ?? ''],
      ],
      directory: request.directory,
    ),
    _rejectQuestionAction => socket.rejectQuestion(
      id: request.requestId,
      directory: request.directory,
    ),
    _ => Future.error(StateError('Unsupported notification action')),
  };
}
