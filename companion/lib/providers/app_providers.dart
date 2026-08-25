import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models.dart';
import '../services/websocket_service.dart';
import '../services/auth_service.dart';
import '../services/notification_service.dart';
import '../services/companion_preferences.dart';

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
      initialSequence: AuthService.instance.lastSequence,
      onSequenceChange: AuthService.instance.recordSequence,
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
          } catch (_) {
            /* ref may be disposed */
          }
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
  ref.onDispose(() {
    ws.dispose();
  });
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

/// Main shell navigation. Keeping it in provider state allows activity cards
/// and notifications to move to the correct destination without fake tab APIs.
final shellTabProvider = StateProvider<int>((ref) => 0);

/// A workflow/sub-agent card can select a session before opening Sessions.
final chatJumpToSessionProvider = StateProvider<String?>((ref) => null);
final newSessionRequestProvider = StateProvider<int>((ref) => 0);

class ArtifactsNotifier extends Notifier<List<CompanionArtifact>> {
  @override
  List<CompanionArtifact> build() => [];

  void upsert(CompanionArtifact artifact) {
    final next = state.where((item) => item.id != artifact.id).toList();
    state = [artifact, ...next].take(100).toList();
  }

  void setFromSnapshot(List<CompanionArtifact> artifacts) {
    state = [...artifacts]..sort((a, b) => b.createdAt.compareTo(a.createdAt));
  }
}

final artifactsProvider =
    NotifierProvider<ArtifactsNotifier, List<CompanionArtifact>>(
      ArtifactsNotifier.new,
    );

class PreviewsNotifier extends Notifier<List<CompanionPreview>> {
  @override
  List<CompanionPreview> build() => [];

  void upsert(CompanionPreview preview) {
    final next = state.where((item) => item.id != preview.id).toList();
    state = [preview, ...next].take(100).toList();
  }

  void setFromSnapshot(List<CompanionPreview> previews) {
    state = [...previews]..sort((a, b) => b.createdAt.compareTo(a.createdAt));
  }
}

final previewsProvider =
    NotifierProvider<PreviewsNotifier, List<CompanionPreview>>(
      PreviewsNotifier.new,
    );

// ---------------------------------------------------------------------------
// DAG Steps
// ---------------------------------------------------------------------------

class DagNotifier extends Notifier<List<DagStep>> {
  @override
  List<DagStep> build() => [];

  void upsert(DagStep step) {
    final idx = state.indexWhere(
      (s) =>
          s.name == step.name &&
          s.sessionId == step.sessionId &&
          s.directory == step.directory,
    );
    if (idx == -1) {
      state = [...state, step];
    } else {
      state = [...state]..[idx] = step;
    }
  }

  void updateStatus(
    String name,
    String status, {
    String? sessionId,
    String? directory,
  }) {
    state = state
        .map(
          (s) =>
              s.name == name &&
                  (sessionId == null || s.sessionId == sessionId) &&
                  (directory == null || s.directory == directory)
              ? s.copyWith(status: status)
              : s,
        )
        .toList();
  }

  /// Update the last step matching a sessionId (used by complete/fail events).
  void updateBySessionId(
    String? sessionId,
    String status, {
    String? directory,
  }) {
    if (sessionId == null) {
      // No sessionId — update the last running step
      final idx = state.lastIndexWhere(
        (s) =>
            (directory == null || s.directory == directory) &&
            (s.status == 'running' || s.status.contains('ing')),
      );
      if (idx != -1) {
        final updated = [...state];
        updated[idx] = updated[idx].copyWith(status: status);
        state = updated;
      }
      return;
    }
    state = state
        .map(
          (s) =>
              s.sessionId == sessionId &&
                  (directory == null || s.directory == directory)
              ? s.copyWith(status: status)
              : s,
        )
        .toList();
  }

  void setTodos(String? sessionId, List<TodoItem> todos, {String? directory}) {
    state = state.map((s) {
      if ((sessionId == null || s.sessionId == sessionId) &&
          (directory == null || s.directory == directory)) {
        return s.copyWith(todos: todos);
      }
      return s;
    }).toList();
  }

  void markTodoDone(String? sessionId, int todoIndex, {String? directory}) {
    state = state.map((s) {
      if (sessionId != null && s.sessionId != sessionId) return s;
      if (directory != null && s.directory != directory) return s;
      if (todoIndex < 0 || todoIndex >= s.todos.length) return s;
      final newTodos = [...s.todos];
      newTodos[todoIndex] = newTodos[todoIndex].copyWith(status: 'complete');
      return s.copyWith(todos: newTodos);
    }).toList();
  }

  /// Update a specific step by index (for parallel updates).
  void updateByIndex(int stepIndex, String status, {String? directory}) {
    final indexes = <int>[
      for (var index = 0; index < state.length; index++)
        if (directory == null || state[index].directory == directory) index,
    ];
    if (stepIndex < 0 || stepIndex >= indexes.length) return;
    final updated = [...state];
    final index = indexes[stepIndex];
    updated[index] = updated[index].copyWith(status: status);
    state = updated;
  }

  void clear({String? directory}) {
    state = directory == null
        ? []
        : state.where((step) => step.directory != directory).toList();
  }

  void setFromSnapshot(List<DagStep> steps) => state = steps;
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

  void updateStatus(String sessionId, String status) {
    state = state
        .map(
          (session) => session.id == sessionId
              ? SessionInfo(
                  id: session.id,
                  title: session.title,
                  updated: session.updated,
                  directory: session.directory,
                  status: status,
                )
              : session,
        )
        .toList();
  }
}

final sessionListProvider =
    NotifierProvider<SessionListNotifier, List<SessionInfo>>(
      SessionListNotifier.new,
    );

class ModelInfo {
  final String id;
  final String name;
  final String providerId;
  final String providerName;
  final String? family;
  final String status;
  final bool free;
  final bool reasoning;
  final bool images;
  final bool pdf;
  final bool audio;
  final bool video;
  final double inputCost;
  final double outputCost;
  final int contextLimit;
  final int outputLimit;
  final List<String> variants;

  ModelInfo({
    required this.id,
    required this.name,
    String? providerId,
    required this.providerName,
    this.family,
    this.status = 'active',
    this.free = false,
    this.reasoning = false,
    this.images = false,
    this.pdf = false,
    this.audio = false,
    this.video = false,
    this.inputCost = 0,
    this.outputCost = 0,
    this.contextLimit = 0,
    this.outputLimit = 0,
    this.variants = const [],
  }) : providerId = providerId ?? id.split('/').first;

  factory ModelInfo.fromJson(Map<String, dynamic> json) {
    return ModelInfo(
      id: json['id'] as String,
      name: json['name'] as String,
      providerId: json['providerId'] as String?,
      providerName: json['providerName'] as String,
      family: json['family'] as String?,
      status: json['status'] as String? ?? 'active',
      free: json['free'] as bool? ?? false,
      reasoning: json['reasoning'] as bool? ?? false,
      images: json['capabilities']?['images'] as bool? ?? false,
      pdf: json['capabilities']?['pdf'] as bool? ?? false,
      audio: json['capabilities']?['audio'] as bool? ?? false,
      video: json['capabilities']?['video'] as bool? ?? false,
      inputCost: (json['cost']?['input'] as num?)?.toDouble() ?? 0,
      outputCost: (json['cost']?['output'] as num?)?.toDouble() ?? 0,
      contextLimit: json['limit']?['context'] as int? ?? 0,
      outputLimit: json['limit']?['output'] as int? ?? 0,
      variants: (json['variants'] as List? ?? const [])
          .whereType<String>()
          .toList(),
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
final currentDirectoryProvider = StateProvider<String?>((ref) => null);

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

  void setFromSnapshot(List<SubAgentInfo> agents) => state = agents;
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
    final existing = state.indexWhere((item) => item.reqId == q.reqId);
    if (existing < 0) {
      state = [...state, q];
      return;
    }
    final updated = [...state];
    updated[existing] = q;
    state = updated;
  }

  void remove(String reqId) {
    state = state.where((q) => q.reqId != reqId).toList();
  }

  void clear() => state = [];

  void setFromSnapshot(List<PendingQuestion> questions) => state = questions;
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

class ConversationState {
  final String? selectedSessionId;
  final String? selectedModelId;
  final String? selectedAgentName;
  final String? selectedVariant;
  final String? selectedDirectory;
  final Map<String, List<ConversationMessage>> messages;
  final Set<String> loadingSessionIds;

  const ConversationState({
    this.selectedSessionId,
    this.selectedModelId,
    this.selectedAgentName,
    this.selectedVariant,
    this.selectedDirectory,
    this.messages = const {},
    this.loadingSessionIds = const {},
  });

  List<ConversationMessage> messagesFor(String? sessionId) =>
      sessionId == null ? const [] : messages[sessionId] ?? const [];

  ConversationState copyWith({
    String? selectedSessionId,
    bool clearSelectedSession = false,
    String? selectedModelId,
    String? selectedAgentName,
    String? selectedVariant,
    bool clearSelectedVariant = false,
    String? selectedDirectory,
    Map<String, List<ConversationMessage>>? messages,
    Set<String>? loadingSessionIds,
  }) {
    return ConversationState(
      selectedSessionId: clearSelectedSession
          ? null
          : selectedSessionId ?? this.selectedSessionId,
      selectedModelId: selectedModelId ?? this.selectedModelId,
      selectedAgentName: selectedAgentName ?? this.selectedAgentName,
      selectedVariant: clearSelectedVariant
          ? null
          : selectedVariant ?? this.selectedVariant,
      selectedDirectory: selectedDirectory ?? this.selectedDirectory,
      messages: messages ?? this.messages,
      loadingSessionIds: loadingSessionIds ?? this.loadingSessionIds,
    );
  }
}

class ConversationNotifier extends Notifier<ConversationState> {
  @override
  ConversationState build() => ConversationState(
    selectedModelId: CompanionPreferences.instance.lastModel,
    selectedAgentName: CompanionPreferences.instance.lastAgent,
    selectedDirectory: CompanionPreferences.instance.lastDirectory,
  );

  Future<void> syncSessions(List<SessionInfo> sessions) async {
    if (sessions.isEmpty) {
      state = state.copyWith(clearSelectedSession: true);
      return;
    }
    final current = state.selectedSessionId;
    if (current != null && sessions.any((session) => session.id == current)) {
      return;
    }
    await selectSession(sessions.first.id);
  }

  Future<void> selectSession(String sessionId, {bool reload = false}) async {
    final session = ref
        .read(sessionListProvider)
        .where((candidate) => candidate.id == sessionId)
        .firstOrNull;
    final alreadyLoaded = state.messages.containsKey(sessionId);
    state = state.copyWith(
      selectedSessionId: sessionId,
      selectedDirectory: session?.directory.isNotEmpty == true
          ? session!.directory
          : null,
    );
    if (alreadyLoaded && !reload) return;

    final ws = ref.read(wsServiceProvider);
    if (ws == null || !ws.isConnected) return;
    state = state.copyWith(
      loadingSessionIds: {...state.loadingSessionIds, sessionId},
    );
    try {
      await ws.getMessages(sessionId: sessionId, directory: session?.directory);
    } catch (error) {
      ref.read(connectionMessageProvider.notifier).state = _cleanError(error);
      _finishLoading(sessionId);
    }
  }

  void setModel(String modelId) {
    final models = ref.read(modelsListProvider);
    final model = models.where((item) => item.id == modelId).firstOrNull;
    final savedVariant = CompanionPreferences.instance.modelVariants[modelId];
    state = state.copyWith(
      selectedModelId: modelId,
      selectedVariant: model?.variants.contains(savedVariant) == true
          ? savedVariant
          : null,
      clearSelectedVariant:
          model == null || model.variants.contains(savedVariant) != true,
    );
    CompanionPreferences.instance.selectModel(modelId);
  }

  void setVariant(String? variant) {
    final modelId = state.selectedModelId;
    if (modelId == null) return;
    state = state.copyWith(
      selectedVariant: variant,
      clearSelectedVariant: variant == null,
    );
    CompanionPreferences.instance.selectVariant(modelId, variant);
  }

  void setDirectory(String directory) {
    state = state.copyWith(selectedDirectory: directory);
    CompanionPreferences.instance.selectDirectory(directory);
  }

  void syncModels(List<ModelInfo> models, String? defaultModel) {
    if (models.isEmpty) return;
    final selected = state.selectedModelId;
    if (selected != null && models.any((model) => model.id == selected)) return;
    final saved = CompanionPreferences.instance.lastModel;
    final atomAuto = models.where(
      (model) => model.id == 'atomcli/atomcli-auto',
    );
    final resolvedDefault = models.any((model) => model.id == saved)
        ? saved
        : models.any((model) => model.id == defaultModel)
        ? defaultModel
        : atomAuto.isNotEmpty
        ? atomAuto.first.id
        : models.first.id;
    if (resolvedDefault != null) setModel(resolvedDefault);
  }

  void setAgent(String agentName) {
    state = state.copyWith(selectedAgentName: agentName);
    CompanionPreferences.instance.selectAgent(agentName);
  }

  void syncAgents(List<AgentInfo> agents) {
    if (agents.isEmpty) return;
    final selected = state.selectedAgentName;
    if (selected != null && agents.any((agent) => agent.name == selected)) {
      return;
    }
    final primary = agents.where((agent) => agent.name == 'agent');
    state = state.copyWith(
      selectedAgentName: primary.isNotEmpty
          ? primary.first.name
          : agents.first.name,
    );
  }

  void setMessages(String sessionId, List<ConversationMessage> messages) {
    var next = state.copyWith(
      messages: {...state.messages, sessionId: messages},
      loadingSessionIds: {...state.loadingSessionIds}..remove(sessionId),
    );
    if (sessionId == state.selectedSessionId) {
      final users = messages
          .where((message) => message.role == 'user')
          .toList();
      final last = users.isEmpty ? null : users.last;
      if (last?.modelId != null) {
        next = next.copyWith(
          selectedModelId: last!.modelId,
          selectedAgentName: last.agent,
          selectedVariant: last.variant,
          clearSelectedVariant: last.variant == null,
        );
        CompanionPreferences.instance.selectModel(last.modelId!);
        if (last.agent != null) {
          CompanionPreferences.instance.selectAgent(last.agent!);
        }
        CompanionPreferences.instance.selectVariant(
          last.modelId!,
          last.variant,
        );
      }
    }
    state = next;
  }

  void addCreatedSession({
    required String sessionId,
    required String? initialText,
    String? directory,
  }) {
    final messages = <ConversationMessage>[];
    if (initialText != null && initialText.trim().isNotEmpty) {
      messages.add(_optimisticMessage(sessionId, initialText));
    }
    state = state.copyWith(
      selectedSessionId: sessionId,
      messages: {...state.messages, sessionId: messages},
      loadingSessionIds: {...state.loadingSessionIds}..remove(sessionId),
      selectedDirectory: directory,
    );
  }

  void addOptimisticUserMessage(String sessionId, String text) {
    final current = state.messagesFor(sessionId);
    state = state.copyWith(
      messages: {
        ...state.messages,
        sessionId: [...current, _optimisticMessage(sessionId, text)],
      },
    );
  }

  void applyMessageInfo(Map<String, dynamic> info) {
    final messageId = info['id'] as String?;
    final sessionId = info['sessionID'] as String?;
    if (messageId == null || sessionId == null) return;
    final current = [...state.messagesFor(sessionId)];
    final index = current.indexWhere((message) => message.id == messageId);
    final role = info['role'] as String? ?? 'assistant';
    if (index >= 0) {
      current[index] = current[index].copyWith(role: role);
    } else {
      final localIndex = role == 'user'
          ? current.lastIndexWhere(
              (message) =>
                  message.role == 'user' && message.id.startsWith('local_'),
            )
          : -1;
      final message = ConversationMessage(
        id: messageId,
        sessionId: sessionId,
        role: role,
        time: DateTime.now(),
      );
      if (localIndex >= 0) {
        current[localIndex] = message;
      } else {
        current.add(message);
      }
    }
    state = state.copyWith(messages: {...state.messages, sessionId: current});
  }

  void applyMessagePart(Map<String, dynamic> payload) {
    final rawPart = payload['part'];
    if (rawPart is! Map) return;
    final part = ConversationPart.fromJson(Map<String, dynamic>.from(rawPart));
    if (part.sessionId.isEmpty || part.messageId.isEmpty) return;
    final current = [...state.messagesFor(part.sessionId)];
    var messageIndex = current.indexWhere(
      (message) => message.id == part.messageId,
    );
    if (messageIndex < 0) {
      current.add(
        ConversationMessage(
          id: part.messageId,
          sessionId: part.sessionId,
          role: 'assistant',
          time: DateTime.now(),
        ),
      );
      messageIndex = current.length - 1;
    }
    final message = current[messageIndex];
    final parts = [...message.parts];
    final partIndex = part.id.isEmpty
        ? -1
        : parts.indexWhere((candidate) => candidate.id == part.id);
    if (partIndex < 0) {
      parts.add(part);
    } else {
      parts[partIndex] = parts[partIndex].merge(
        part,
        payload['delta'] as String?,
      );
    }
    current[messageIndex] = message.copyWith(parts: parts);
    state = state.copyWith(
      messages: {...state.messages, part.sessionId: current},
    );
  }

  void _finishLoading(String sessionId) {
    state = state.copyWith(
      loadingSessionIds: {...state.loadingSessionIds}..remove(sessionId),
    );
  }

  ConversationMessage _optimisticMessage(String sessionId, String text) {
    final id = 'local_${DateTime.now().microsecondsSinceEpoch}';
    return ConversationMessage(
      id: id,
      sessionId: sessionId,
      role: 'user',
      time: DateTime.now(),
      parts: [
        ConversationPart(
          id: '${id}_text',
          messageId: id,
          sessionId: sessionId,
          type: 'text',
          text: text,
        ),
      ],
    );
  }
}

final conversationProvider =
    NotifierProvider<ConversationNotifier, ConversationState>(
      ConversationNotifier.new,
    );

// ---------------------------------------------------------------------------
// Connection State
// ---------------------------------------------------------------------------

enum WsConnectionState { disconnected, connecting, connected }

final connectionStateProvider = StateProvider<WsConnectionState>(
  (_) => AuthService.instance.endpoints.isEmpty
      ? WsConnectionState.disconnected
      : WsConnectionState.connecting,
);

final connectionMessageProvider = StateProvider<String?>((_) => null);

// ---------------------------------------------------------------------------
// Event dispatcher — wire the WS stream to state notifiers
// ---------------------------------------------------------------------------

/// Listen to backend events and dispatch to the correct notifiers.
/// Call this once after pairing in your root widget.
void dispatchBackendEvents(Ref ref) {
  ref.listen<AsyncValue<BackendEvent>>(backendEventStreamProvider, (_, next) {
    next.whenData((event) {
      switch (event.type) {
        case 'snapshot':
          // Snapshots are authoritative. Replace state so items resolved while
          // the phone was offline cannot survive as stale cards.
          final dag = event.payload['dag'] as List? ?? [];
          ref
              .read(dagProvider.notifier)
              .setFromSnapshot(
                dag
                    .map(
                      (step) => DagStep.fromJson(step as Map<String, dynamic>),
                    )
                    .toList(),
              );
          final perms = event.payload['pending_permissions'] as List? ?? [];
          ref
              .read(permissionsProvider.notifier)
              .setFromSnapshot(
                perms
                    .map(
                      (perm) => PendingPermission.fromJson(
                        perm as Map<String, dynamic>,
                      ),
                    )
                    .toList(),
              );
          final rawSubAgents = event.payload['sub_agents'] as List? ?? [];
          ref
              .read(subAgentProvider.notifier)
              .setFromSnapshot(
                rawSubAgents
                    .map(
                      (sa) => SubAgentInfo.fromJson(sa as Map<String, dynamic>),
                    )
                    .toList(),
              );
          ref.read(connectionStateProvider.notifier).state =
              WsConnectionState.connected;
          ref.read(connectionMessageProvider.notifier).state = null;
          final rawQuestions =
              event.payload['pending_questions'] as List? ?? [];
          ref
              .read(questionsProvider.notifier)
              .setFromSnapshot(
                rawQuestions
                    .map(
                      (q) =>
                          PendingQuestion.fromJson(q as Map<String, dynamic>),
                    )
                    .toList(),
              );
          final rawArtifacts = event.payload['artifacts'] as List? ?? [];
          ref
              .read(artifactsProvider.notifier)
              .setFromSnapshot(
                rawArtifacts
                    .whereType<Map>()
                    .map(
                      (item) => CompanionArtifact.fromJson(
                        Map<String, dynamic>.from(item),
                      ),
                    )
                    .toList(),
              );
          final rawPreviews = event.payload['previews'] as List? ?? [];
          ref
              .read(previewsProvider.notifier)
              .setFromSnapshot(
                rawPreviews
                    .whereType<Map>()
                    .map(
                      (item) => CompanionPreview.fromJson(
                        Map<String, dynamic>.from(item),
                      ),
                    )
                    .toList(),
              );

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
          final currentDirectory =
              event.payload['current_directory'] as String?;
          if (currentDirectory != null) {
            ref.read(currentDirectoryProvider.notifier).state =
                currentDirectory;
            if (CompanionPreferences.instance.lastDirectory == null) {
              ref
                  .read(conversationProvider.notifier)
                  .setDirectory(currentDirectory);
            }
          }
          unawaited(
            ref.read(conversationProvider.notifier).syncSessions(sessions),
          );

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
          ref
              .read(conversationProvider.notifier)
              .syncModels(models, defaultModel);

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
          ref.read(conversationProvider.notifier).syncAgents(agents);

        case 'session_created':
          final newSessionId = event.payload['session_id'] as String?;
          final sessionTitle =
              event.payload['session_title'] as String? ?? 'New session';
          if (newSessionId != null) {
            ref
                .read(conversationProvider.notifier)
                .addCreatedSession(
                  sessionId: newSessionId,
                  initialText: event.payload['initial_text'] as String?,
                  directory: event.payload['directory'] as String?,
                );
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
                    directory: event.payload['directory'] as String? ?? '',
                    status: 'busy',
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

        case 'messages_result':
          final sessionId = event.payload['session_id'] as String?;
          if (sessionId == null) break;
          final rawMessages = event.payload['messages'] as List? ?? const [];
          final messages = rawMessages
              .whereType<Map>()
              .map(
                (message) => ConversationMessage.fromJson(
                  Map<String, dynamic>.from(message),
                ),
              )
              .toList();
          ref
              .read(conversationProvider.notifier)
              .setMessages(sessionId, messages);

        case 'message_updated':
          final info = event.payload['info'];
          if (info is Map) {
            ref
                .read(conversationProvider.notifier)
                .applyMessageInfo(Map<String, dynamic>.from(info));
          }

        case 'message_part':
          ref
              .read(conversationProvider.notifier)
              .applyMessagePart(event.payload);

        case 'artifact_shared':
          ref
              .read(artifactsProvider.notifier)
              .upsert(CompanionArtifact.fromJson(event.payload));

        case 'preview_updated':
          ref
              .read(previewsProvider.notifier)
              .upsert(CompanionPreview.fromJson(event.payload));

        case 'session_status':
          final sessionId = event.payload['sessionID'] as String?;
          final status = event.payload['status'];
          if (sessionId != null && status is Map) {
            ref
                .read(sessionListProvider.notifier)
                .updateStatus(sessionId, status['type'] as String? ?? 'idle');
          }

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

        case 'connection_error':
        case 'protocol_error':
          ref.read(connectionMessageProvider.notifier).state =
              event.payload['message'] as String? ??
              event.payload['error'] as String? ??
              'Connection error';
      }
    });
  });
}

final backendSyncProvider = Provider<void>((ref) {
  dispatchBackendEvents(ref);
});

String _cleanError(Object error) => error.toString().replaceFirst(
  RegExp(r'^(Bad state|TimeoutException):\s*'),
  '',
);

void _handleDag(Ref ref, String topic, Map<String, dynamic> p) {
  final dag = ref.read(dagProvider.notifier);
  final sessionId = p['sessionID'] as String?;
  final directory = p['directory'] as String?;

  switch (topic) {
    case 'tui.chain.add_step':
      dag.upsert(DagStep.fromJson(p));

    case 'tui.chain.update_step':
      final status = p['status'] as String? ?? '';
      final name = p['name'] as String?;
      if (name != null && name.isNotEmpty) {
        dag.updateStatus(
          name,
          status,
          sessionId: sessionId,
          directory: directory,
        );
      } else {
        dag.updateBySessionId(sessionId, status, directory: directory);
      }

    case 'tui.chain.complete_step':
      dag.updateBySessionId(sessionId, 'complete', directory: directory);

    case 'tui.chain.fail_step':
      dag.updateBySessionId(sessionId, 'failed', directory: directory);

    case 'tui.chain.set_todos':
      final rawTodos = p['todos'] as List? ?? [];
      final todos = rawTodos
          .map((t) => TodoItem.fromJson(t as Map<String, dynamic>))
          .toList();
      dag.setTodos(sessionId, todos, directory: directory);

    case 'tui.chain.todo_done':
      final todoIndex = p['todoIndex'] as int? ?? -1;
      dag.markTodoDone(sessionId, todoIndex, directory: directory);

    case 'tui.chain.start':
      dag.clear(directory: directory);

    case 'tui.chain.parallel.update':
      final stepIndex = p['stepIndex'] as int? ?? -1;
      final status = p['status'] as String? ?? '';
      dag.updateByIndex(stepIndex, status, directory: directory);

    case 'tui.chain.clear':
      dag.clear(directory: directory);
  }
}
