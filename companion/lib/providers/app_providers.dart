import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models.dart';
import '../services/websocket_service.dart';
import '../services/auth_service.dart';
import '../services/notification_service.dart';

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/// WebSocket service — initialized after pairing or loaded from disk on startup.
/// Use StateProvider so it can be updated imperatively after QR scan.
final wsServiceProvider = StateProvider<WebSocketService?>((ref) {
  final eps = AuthService.instance.endpoints;
  if (eps.isNotEmpty) {
    return WebSocketService(
      endpoints: eps,
      onStateChange: (lifecycle) {
        final mapped = switch (lifecycle) {
          WsLifecycle.connecting => WsConnectionState.connecting,
          WsLifecycle.connected => WsConnectionState.connected,
          WsLifecycle.disconnected => WsConnectionState.disconnected,
        };
        // Use Future.microtask to avoid modifying state during provider build
        Future.microtask(() {
          try {
            ref.read(connectionStateProvider.notifier).state = mapped;
          } catch (_) { /* ref may be disposed */ }
        });
      },
    );
  }
  return null;
});

/// Stream of raw backend events.
final backendEventStreamProvider = StreamProvider<BackendEvent>((ref) {
  final ws = ref.watch(wsServiceProvider);
  if (ws == null) return const Stream.empty();
  return ws.connect();
});

// ---------------------------------------------------------------------------
// Pending Permissions
// ---------------------------------------------------------------------------

class PermissionsNotifier extends Notifier<List<PendingPermission>> {
  @override
  List<PendingPermission> build() => [];

  /// Add or replace a permission by reqId (deduplication-safe).
  void add(PendingPermission p) {
    final existing = state.indexWhere((e) => e.reqId == p.reqId);
    if (existing >= 0) {
      state = [...state]..[existing] = p;
    } else {
      state = [...state, p];
    }
  }

  void remove(String reqId) {
    state = state.where((p) => p.reqId != reqId).toList();
  }

  /// Replace full list from snapshot (authoritative).
  void setFromSnapshot(List<PendingPermission> perms) {
    state = perms;
  }
}

final permissionsProvider =
    NotifierProvider<PermissionsNotifier, List<PendingPermission>>(
      PermissionsNotifier.new,
    );

// ---------------------------------------------------------------------------
// DAG Steps
// ---------------------------------------------------------------------------

class DagNotifier extends Notifier<List<DagStep>> {
  @override
  List<DagStep> build() => [];

  void upsert(DagStep step) {
    final idx = state.indexWhere((s) => s.name == step.name);
    if (idx == -1) {
      state = [...state, step];
    } else {
      state = [...state]..[idx] = step;
    }
  }

  void updateStatus(String name, String status) {
    state = state
        .map((s) => s.name == name ? s.copyWith(status: status) : s)
        .toList();
  }

  /// Update the last step matching a sessionId (used by complete/fail events).
  void updateBySessionId(String? sessionId, String status) {
    if (sessionId == null) {
      // No sessionId — update the last running step
      final idx = state.lastIndexWhere(
        (s) => s.status == 'running' || s.status.contains('ing'),
      );
      if (idx != -1) {
        final updated = [...state];
        updated[idx] = updated[idx].copyWith(status: status);
        state = updated;
      }
      return;
    }
    state = state
        .map((s) => s.sessionId == sessionId ? s.copyWith(status: status) : s)
        .toList();
  }

  void setTodos(String? sessionId, List<TodoItem> todos) {
    state = state.map((s) {
      if (sessionId == null || s.sessionId == sessionId) {
        return s.copyWith(todos: todos);
      }
      return s;
    }).toList();
  }

  void markTodoDone(String? sessionId, int todoIndex) {
    state = state.map((s) {
      if (sessionId != null && s.sessionId != sessionId) return s;
      if (todoIndex < 0 || todoIndex >= s.todos.length) return s;
      final newTodos = [...s.todos];
      newTodos[todoIndex] = newTodos[todoIndex].copyWith(status: 'complete');
      return s.copyWith(todos: newTodos);
    }).toList();
  }

  /// Update a specific step by index (for parallel updates).
  void updateByIndex(int stepIndex, String status) {
    if (stepIndex < 0 || stepIndex >= state.length) return;
    final updated = [...state];
    updated[stepIndex] = updated[stepIndex].copyWith(status: status);
    state = updated;
  }

  void clear() => state = [];
}

final dagProvider = NotifierProvider<DagNotifier, List<DagStep>>(
  DagNotifier.new,
);

// ---------------------------------------------------------------------------
// Chat / Logs
// ---------------------------------------------------------------------------

class LogsNotifier extends Notifier<List<LogEntry>> {
  @override
  List<LogEntry> build() => [];

  void add(LogEntry entry) {
    state = [...state, entry];
  }

  void clear(String sessionId) {
    state = state.where((l) => l.sessionId != sessionId).toList();
  }

  void clearAll() {
    state = [];
  }
}

final logsProvider = NotifierProvider<LogsNotifier, List<LogEntry>>(
  LogsNotifier.new,
);

class SessionListNotifier extends Notifier<List<SessionInfo>> {
  @override
  List<SessionInfo> build() => [];

  void setSessions(List<SessionInfo> sessions) {
    state = sessions;
  }

  void addOrUpdate(SessionInfo session) {
    final existingIndex = state.indexWhere((s) => s.id == session.id);
    if (existingIndex >= 0) {
      final updated = [...state];
      updated[existingIndex] = session;
      state = updated;
    } else {
      state = [session, ...state];
    }
  }
}

final sessionListProvider =
    NotifierProvider<SessionListNotifier, List<SessionInfo>>(
      SessionListNotifier.new,
    );

class ModelInfo {
  final String id;
  final String name;
  final String providerName;

  ModelInfo({required this.id, required this.name, required this.providerName});

  factory ModelInfo.fromJson(Map<String, dynamic> json) {
    return ModelInfo(
      id: json['id'] as String,
      name: json['name'] as String,
      providerName: json['providerName'] as String,
    );
  }
}

class ModelsListNotifier extends Notifier<List<ModelInfo>> {
  @override
  List<ModelInfo> build() => [];

  void setModels(List<ModelInfo> models) {
    state = models;
  }
}

final modelsListProvider =
    NotifierProvider<ModelsListNotifier, List<ModelInfo>>(
      ModelsListNotifier.new,
    );

/// The server-configured default model ID (e.g. "anthropic/claude-sonnet-4-5").
/// Populated when the server sends `models_list` with a `default_model` field.
final defaultModelProvider = StateProvider<String?>((ref) => null);

// ---------------------------------------------------------------------------
// Prompt errors (sent by server when SessionPrompt.prompt fails)
// ---------------------------------------------------------------------------

class PromptErrorNotifier extends Notifier<String?> {
  @override
  String? build() => null;

  void setError(String message) {
    state = message;
  }

  void clear() {
    state = null;
  }
}

final promptErrorProvider = NotifierProvider<PromptErrorNotifier, String?>(
  PromptErrorNotifier.new,
);

// ---------------------------------------------------------------------------
// Sub-agent sessions (spawned by orchestrators)
// ---------------------------------------------------------------------------

class SubAgentNotifier extends Notifier<List<SubAgentInfo>> {
  @override
  List<SubAgentInfo> build() => [];

  void addOrUpdate(SubAgentInfo agent) {
    final idx = state.indexWhere((a) => a.sessionId == agent.sessionId);
    if (idx >= 0) {
      final updated = [...state];
      updated[idx] = agent;
      state = updated;
    } else {
      state = [...state, agent];
    }
  }

  void markDone(String sessionId) {
    final idx = state.indexWhere((a) => a.sessionId == sessionId);
    if (idx >= 0) {
      final updated = [...state];
      updated[idx] = updated[idx].copyWith(
        status: 'done',
        finishedAt: DateTime.now().millisecondsSinceEpoch,
      );
      state = updated;
    }
  }

  void removeBySessionId(String sessionId) {
    state = state.where((a) => a.sessionId != sessionId).toList();
  }

  void clearAll() => state = [];
}

final subAgentProvider = NotifierProvider<SubAgentNotifier, List<SubAgentInfo>>(
  SubAgentNotifier.new,
);

// ---------------------------------------------------------------------------
// Pending Questions (from question tool)
// ---------------------------------------------------------------------------

class QuestionsNotifier extends Notifier<List<PendingQuestion>> {
  @override
  List<PendingQuestion> build() => [];

  void add(PendingQuestion q) {
    state = [...state, q];
  }

  void remove(String reqId) {
    state = state.where((q) => q.reqId != reqId).toList();
  }

  void clear() => state = [];
}

final questionsProvider =
    NotifierProvider<QuestionsNotifier, List<PendingQuestion>>(
      QuestionsNotifier.new,
    );

class AgentInfo {
  final String name;
  final String? description;
  final String mode;
  final bool? hidden;

  AgentInfo({
    required this.name,
    this.description,
    required this.mode,
    this.hidden,
  });

  factory AgentInfo.fromJson(Map<String, dynamic> json) {
    return AgentInfo(
      name: json['name'] as String,
      description: json['description'] as String?,
      mode: json['mode'] as String,
      hidden: json['hidden'] as bool?,
    );
  }
}

class AgentsListNotifier extends Notifier<List<AgentInfo>> {
  @override
  List<AgentInfo> build() => [];

  void setAgents(List<AgentInfo> agents) {
    state = agents;
  }
}

final agentsListProvider =
    NotifierProvider<AgentsListNotifier, List<AgentInfo>>(
      AgentsListNotifier.new,
    );

// ---------------------------------------------------------------------------
// Connection State
// ---------------------------------------------------------------------------

enum WsConnectionState { disconnected, connecting, connected }

final connectionStateProvider = StateProvider<WsConnectionState>(
  (_) => WsConnectionState.disconnected,
);

// ---------------------------------------------------------------------------
// Event dispatcher — wire the WS stream to state notifiers
// ---------------------------------------------------------------------------

/// Listen to backend events and dispatch to the correct notifiers.
/// Call this once after pairing in your root widget.
void dispatchBackendEvents(WidgetRef ref) {
  ref.listen<AsyncValue<BackendEvent>>(backendEventStreamProvider, (_, next) {
    next.whenData((event) {
      switch (event.type) {
        case 'snapshot':
          // Hydrate DAG, permissions, and sub-agents from snapshot
          final dag = event.payload['dag'] as List? ?? [];
          for (final step in dag) {
            ref
                .read(dagProvider.notifier)
                .upsert(DagStep.fromJson(step as Map<String, dynamic>));
          }
          final perms = event.payload['pending_permissions'] as List? ?? [];
          for (final perm in perms) {
            ref
                .read(permissionsProvider.notifier)
                .add(PendingPermission.fromJson(perm as Map<String, dynamic>));
          }
          final rawSubAgents = event.payload['sub_agents'] as List? ?? [];
          for (final sa in rawSubAgents) {
            ref
                .read(subAgentProvider.notifier)
                .addOrUpdate(SubAgentInfo.fromJson(sa as Map<String, dynamic>));
          }
          ref.read(connectionStateProvider.notifier).state =
              WsConnectionState.connected;
          // Hydrate pending questions from snapshot
          final rawQuestions = event.payload['pending_questions'] as List? ?? [];
          for (final q in rawQuestions) {
            ref
                .read(questionsProvider.notifier)
                .add(PendingQuestion.fromJson(q as Map<String, dynamic>));
          }

        case 'event':
          // topic is a top-level field in BridgeEvent, NOT nested inside payload
          final topic = event.topic ?? event.payload['topic'] as String? ?? '';
          if (topic.startsWith('tui.chain')) {
            _handleDag(ref, topic, event.payload);
          }

        case 'session_list':
          final sessionsRaw = event.payload['sessions'] as List? ?? [];
          final sessions = sessionsRaw
              .map((s) => SessionInfo.fromJson(s as Map<String, dynamic>))
              .toList();
          ref.read(sessionListProvider.notifier).setSessions(sessions);

        case 'models_list':
          final modelsRaw = event.payload['models'] as List? ?? [];
          final models = modelsRaw
              .map((m) => ModelInfo.fromJson(m as Map<String, dynamic>))
              .toList();
          ref.read(modelsListProvider.notifier).setModels(models);
          // Pre-select the server's configured default model
          final defaultModel = event.payload['default_model'] as String?;
          if (defaultModel != null && defaultModel.isNotEmpty) {
            ref.read(defaultModelProvider.notifier).state = defaultModel;
          } else if (models.isNotEmpty) {
            // Fallback: pick first model if server didn't specify
            ref.read(defaultModelProvider.notifier).state = models.first.id;
          }

        case 'agents_list':
          final agentsRaw = event.payload['agents'] as List? ?? [];
          final agents = agentsRaw
              .map((a) => AgentInfo.fromJson(a as Map<String, dynamic>))
              .where(
                (a) =>
                    a.hidden != true &&
                    (a.mode == 'primary' || a.mode == 'all'),
              )
              .toList();
          ref.read(agentsListProvider.notifier).setAgents(agents);

        case 'session_created':
          final newSessionId = event.payload['session_id'] as String?;
          final sessionTitle =
              event.payload['session_title'] as String? ?? 'New session';
          if (newSessionId != null) {
            ref
                .read(logsProvider.notifier)
                .add(
                  LogEntry(
                    id: DateTime.now().millisecondsSinceEpoch.toString(),
                    sessionId: newSessionId,
                    role: 'system',
                    message: 'New session started ($newSessionId)',
                    timestamp: DateTime.now(),
                  ),
                );
            ref
                .read(sessionListProvider.notifier)
                .addOrUpdate(
                  SessionInfo(
                    id: newSessionId,
                    title: sessionTitle,
                    updated: DateTime.now().millisecondsSinceEpoch,
                  ),
                );

            final initialText = event.payload['initial_text'] as String?;
            if (initialText != null && initialText.isNotEmpty) {
              ref
                  .read(logsProvider.notifier)
                  .add(
                    LogEntry(
                      id: "${DateTime.now().millisecondsSinceEpoch}_m",
                      sessionId: newSessionId,
                      role: 'user',
                      message: initialText,
                      timestamp: DateTime.now(),
                    ),
                  );
            }
          }

        case 'chat_message':
          ref.read(logsProvider.notifier).add(LogEntry.fromJson(event.payload));

        case 'permission_request':
          final perm = PendingPermission.fromJson(event.payload);
          ref.read(permissionsProvider.notifier).add(perm);
          NotificationService.instance.showPermissionRequest(
            reqId: perm.reqId,
            permission: perm.permission,
            patterns: perm.patterns,
          );

        case 'permission_resolved':
          ref
              .read(permissionsProvider.notifier)
              .remove(event.payload['requestID'] as String);

        case 'sub_agent_started':
          final sa = SubAgentInfo.fromJson(
            Map<String, dynamic>.from(event.payload),
          );
          ref.read(subAgentProvider.notifier).addOrUpdate(sa);

        case 'sub_agent_done':
          final sid = event.payload['sessionID'] as String?;
          if (sid != null) ref.read(subAgentProvider.notifier).markDone(sid);

        case 'sub_agent_removed':
          final sid = event.payload['sessionID'] as String?;
          if (sid != null) {
            ref.read(subAgentProvider.notifier).removeBySessionId(sid);
          }

        case 'question_request':
          final q = PendingQuestion.fromJson(event.payload);
          ref.read(questionsProvider.notifier).add(q);
          NotificationService.instance.showPermissionRequest(
            reqId: q.reqId,
            permission: 'question',
            patterns: q.questions.map((qi) => qi.header).toList(),
          );

        case 'question_resolved':
          ref
              .read(questionsProvider.notifier)
              .remove(event.payload['requestID'] as String? ?? '');

        case 'prompt_error':
          final errMsg =
              event.payload['message'] as String? ??
              'Unknown error from server';
          ref.read(promptErrorProvider.notifier).setError(errMsg);
      }
    });
  });
}

void _handleDag(WidgetRef ref, String topic, Map<String, dynamic> p) {
  final dag = ref.read(dagProvider.notifier);
  final sessionId = p['sessionID'] as String?;

  switch (topic) {
    case 'tui.chain.add_step':
      dag.upsert(DagStep.fromJson(p));

    case 'tui.chain.update_step':
      final status = p['status'] as String? ?? '';
      final name = p['name'] as String?;
      if (name != null && name.isNotEmpty) {
        dag.updateStatus(name, status);
      } else {
        dag.updateBySessionId(sessionId, status);
      }

    case 'tui.chain.complete_step':
      dag.updateBySessionId(sessionId, 'complete');

    case 'tui.chain.fail_step':
      dag.updateBySessionId(sessionId, 'failed');

    case 'tui.chain.set_todos':
      final rawTodos = p['todos'] as List? ?? [];
      final todos = rawTodos
          .map((t) => TodoItem.fromJson(t as Map<String, dynamic>))
          .toList();
      dag.setTodos(sessionId, todos);

    case 'tui.chain.todo_done':
      final todoIndex = p['todoIndex'] as int? ?? -1;
      dag.markTodoDone(sessionId, todoIndex);

    case 'tui.chain.start':
      dag.clear();

    case 'tui.chain.parallel.update':
      final stepIndex = p['stepIndex'] as int? ?? -1;
      final status = p['status'] as String? ?? '';
      dag.updateByIndex(stepIndex, status);

    case 'tui.chain.clear':
      dag.clear();
  }
}
