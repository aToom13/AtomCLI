part of 'app_providers.dart';

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
    if (ref.read(inboxFocusRequestProvider) == reqId) {
      ref.read(inboxFocusRequestProvider.notifier).state = null;
    }
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

class RouteProposalsNotifier extends Notifier<List<RouteProposal>> {
  @override
  List<RouteProposal> build() => [];

  void upsert(RouteProposal proposal) {
    final next = state.where((item) => item.id != proposal.id).toList();
    state = [...next, proposal];
  }

  void remove(String id) =>
      state = state.where((item) => item.id != id).toList();

  void setFromSnapshot(List<RouteProposal> proposals) => state = proposals;
}

final routeProposalsProvider =
    NotifierProvider<RouteProposalsNotifier, List<RouteProposal>>(
      RouteProposalsNotifier.new,
    );

final activeRoutesProvider = StateProvider<Map<String, Map<String, dynamic>>>(
  (ref) => {},
);

/// Main shell navigation. Keeping it in provider state allows activity cards
/// and notifications to move to the correct destination without fake tab APIs.
abstract final class ShellTab {
  static const control = 0;
  static const chat = 1;
  static const requests = 2;
  static const files = 3;
  static const devices = 4;
}

final shellTabProvider = StateProvider<int>((ref) => ShellTab.control);

/// A workflow/sub-agent card can select a session before opening Sessions.
final chatJumpToSessionProvider = StateProvider<String?>((ref) => null);
final incomingShareProvider = StateProvider<IncomingShare?>((ref) => null);
final inboxFocusRequestProvider = StateProvider<String?>((ref) => null);
final missionFocusWorkflowProvider = StateProvider<String?>((ref) => null);
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

  void remove(String id) {
    state = state.where((artifact) => artifact.id != id).toList();
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
          s.workflowId == step.workflowId &&
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
    String? workflowId,
  }) {
    state = state
        .map(
          (s) =>
              s.name == name &&
                  (sessionId == null || s.sessionId == sessionId) &&
                  (workflowId == null || s.workflowId == workflowId) &&
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
    String? workflowId,
  }) {
    if (sessionId == null) {
      // No sessionId — update the last running step
      final idx = state.lastIndexWhere(
        (s) =>
            (directory == null || s.directory == directory) &&
            (workflowId == null || s.workflowId == workflowId) &&
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
                  (workflowId == null || s.workflowId == workflowId) &&
                  (directory == null || s.directory == directory)
              ? s.copyWith(status: status)
              : s,
        )
        .toList();
  }

  void setTodos(
    String? sessionId,
    List<TodoItem> todos, {
    String? directory,
    String? workflowId,
  }) {
    state = state.map((s) {
      if ((sessionId == null || s.sessionId == sessionId) &&
          (directory == null || s.directory == directory)) {
        if (workflowId != null && s.workflowId != workflowId) return s;
        return s.copyWith(todos: todos);
      }
      return s;
    }).toList();
  }

  void markTodoDone(
    String? sessionId,
    int todoIndex, {
    String? directory,
    String? workflowId,
  }) {
    state = state.map((s) {
      if (sessionId != null && s.sessionId != sessionId) return s;
      if (directory != null && s.directory != directory) return s;
      if (workflowId != null && s.workflowId != workflowId) return s;
      if (todoIndex < 0 || todoIndex >= s.todos.length) return s;
      final newTodos = [...s.todos];
      newTodos[todoIndex] = newTodos[todoIndex].copyWith(status: 'complete');
      return s.copyWith(todos: newTodos);
    }).toList();
  }

  /// Update a specific step by index (for parallel updates).
  void updateByIndex(
    int stepIndex,
    String status, {
    String? directory,
    String? sessionId,
    String? workflowId,
  }) {
    final indexes = <int>[
      for (var index = 0; index < state.length; index++)
        if ((directory == null || state[index].directory == directory) &&
            (sessionId == null || state[index].sessionId == sessionId) &&
            (workflowId == null || state[index].workflowId == workflowId))
          index,
    ];
    if (stepIndex < 0 || stepIndex >= indexes.length) return;
    final updated = [...state];
    final index = indexes[stepIndex];
    updated[index] = updated[index].copyWith(status: status);
    state = updated;
  }

  void clear({String? directory, String? sessionId, String? workflowId}) {
    state = directory == null && sessionId == null && workflowId == null
        ? []
        : state
              .where(
                (step) =>
                    !((directory == null || step.directory == directory) &&
                        (sessionId == null || step.sessionId == sessionId) &&
                        (workflowId == null || step.workflowId == workflowId)),
              )
              .toList();
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

  void remove(String sessionId) {
    state = state.where((session) => session.id != sessionId).toList();
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

class PromptErrorNotice {
  final String? sessionId;
  final String? modelId;
  final ConversationFailure failure;

  const PromptErrorNotice({
    required this.sessionId,
    required this.failure,
    this.modelId,
  });
}

class PromptErrorNotifier extends Notifier<PromptErrorNotice?> {
  @override
  PromptErrorNotice? build() => null;

  void setError(PromptErrorNotice notice) {
    final current = state;
    if (current?.sessionId == notice.sessionId &&
        current?.modelId == notice.modelId &&
        current?.failure.statusCode == notice.failure.statusCode &&
        current?.failure.message == notice.failure.message) {
      return;
    }
    state = notice;
  }

  void clear() {
    state = null;
  }
}

final promptErrorProvider =
    NotifierProvider<PromptErrorNotifier, PromptErrorNotice?>(
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

  void addActivity(String sessionId, SubAgentActivity activity) {
    final idx = state.indexWhere((agent) => agent.sessionId == sessionId);
    if (idx < 0) return;
    final updated = [...state];
    final previousActivities = updated[idx].activities;
    final previous = previousActivities.lastOrNull;
    final replace =
        previous != null &&
        previous.kind == activity.kind &&
        (activity.kind == 'transcript' ||
            previous.status == 'pending' ||
            previous.status == 'running');
    final activities = replace
        ? [...previousActivities.take(previousActivities.length - 1), activity]
        : [...previousActivities, activity];
    updated[idx] = updated[idx].copyWith(
      activities: activities.length > 40
          ? activities.sublist(activities.length - 40)
          : activities,
    );
    state = updated;
  }

  void markFailed(String sessionId) {
    final idx = state.indexWhere((a) => a.sessionId == sessionId);
    if (idx >= 0) {
      final updated = [...state];
      updated[idx] = updated[idx].copyWith(
        status: 'failed',
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
    if (ref.read(inboxFocusRequestProvider) == reqId) {
      ref.read(inboxFocusRequestProvider.notifier).state = null;
    }
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

