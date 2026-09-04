/// Pairing payload received from QR code.
class PairingPayload {
  final int v;
  final List<String> endpoints;
  final String pairingToken;
  final String httpPair;

  const PairingPayload({
    required this.v,
    required this.endpoints,
    required this.pairingToken,
    required this.httpPair,
  });

  factory PairingPayload.fromJson(Map<String, dynamic> json) {
    final version = json['v'];
    final rawEndpoints = json['endpoints'];
    final token = json['pairing_token'];
    final pairUrl = json['http_pair'];
    if (version is! int ||
        rawEndpoints is! List ||
        token is! String ||
        pairUrl is! String) {
      throw const FormatException('Pairing code is missing required fields');
    }
    final endpoints = rawEndpoints.whereType<String>().where((value) {
      final uri = Uri.tryParse(value);
      return uri != null &&
          (uri.scheme == 'ws' || uri.scheme == 'wss') &&
          uri.host.isNotEmpty;
    }).toList();
    final pairUri = Uri.tryParse(pairUrl);
    if (endpoints.isEmpty) {
      throw const FormatException('Pairing code contains no reachable address');
    }
    if (pairUri == null ||
        (pairUri.scheme != 'http' && pairUri.scheme != 'https') ||
        pairUri.host.isEmpty) {
      throw const FormatException('Pairing address is invalid');
    }
    return PairingPayload(
      v: version,
      endpoints: endpoints,
      pairingToken: token,
      httpPair: pairUrl,
    );
  }
}

/// A pending permission request received from the backend.
class PendingPermission {
  final String reqId;
  final String sessionId;
  final String permission;
  final List<String> patterns;
  final List<String> always;
  final String? directory;
  final Map<String, dynamic> metadata;

  const PendingPermission({
    required this.reqId,
    required this.sessionId,
    required this.permission,
    required this.patterns,
    this.always = const [],
    this.directory,
    required this.metadata,
  });

  factory PendingPermission.fromJson(Map<String, dynamic> json) {
    return PendingPermission(
      reqId: json['req_id'] as String,
      sessionId: json['sessionID'] as String? ?? '',
      permission: json['permission'] as String,
      patterns: List<String>.from(json['patterns'] as List? ?? []),
      always: List<String>.from(json['always'] as List? ?? []),
      directory: json['directory'] as String?,
      metadata: Map<String, dynamic>.from(json['metadata'] as Map? ?? {}),
    );
  }
}

/// A single todo checklist item inside a DAG step.
class TodoItem {
  final String id;
  final String content;
  final String status; // pending | in_progress | complete | failed

  const TodoItem({
    required this.id,
    required this.content,
    required this.status,
  });

  factory TodoItem.fromJson(Map<String, dynamic> json) {
    return TodoItem(
      id: json['id'] as String,
      content: json['content'] as String,
      status: json['status'] as String? ?? 'pending',
    );
  }

  TodoItem copyWith({String? status}) =>
      TodoItem(id: id, content: content, status: status ?? this.status);
}

/// A DAG step from the orchestrator.
class DagStep {
  final String? stepId;
  final String? workflowId;
  final String name;
  final String description;
  final String
  status; // pending | running | complete | failed | <tool-specific>
  final String? directory;
  final String? sessionId;
  final String? agentType;
  final List<String> dependsOn;
  final List<TodoItem> todos;

  const DagStep({
    this.stepId,
    this.workflowId,
    required this.name,
    required this.description,
    required this.status,
    this.directory,
    this.sessionId,
    this.agentType,
    this.dependsOn = const [],
    this.todos = const [],
  });

  factory DagStep.fromJson(Map<String, dynamic> json) {
    final rawTodos = json['todos'] as List? ?? [];
    return DagStep(
      stepId: json['stepId'] as String?,
      workflowId: json['workflowId'] as String?,
      name: json['name'] as String,
      description: json['description'] as String,
      status: json['status'] as String? ?? 'pending',
      directory: json['directory'] as String?,
      sessionId: json['sessionID'] as String?,
      agentType: json['agentType'] as String?,
      dependsOn: List<String>.from(json['dependsOn'] as List? ?? []),
      todos: rawTodos
          .map((t) => TodoItem.fromJson(t as Map<String, dynamic>))
          .toList(),
    );
  }

  DagStep copyWith({String? status, List<TodoItem>? todos}) {
    return DagStep(
      stepId: stepId,
      workflowId: workflowId,
      name: name,
      description: description,
      status: status ?? this.status,
      directory: directory,
      sessionId: sessionId,
      agentType: agentType,
      dependsOn: dependsOn,
      todos: todos ?? this.todos,
    );
  }
}

class LogEntry {
  final String id;
  final String sessionId;
  final String role; // 'user', 'assistant', 'system'
  final String message;
  final DateTime timestamp;

  LogEntry({
    required this.id,
    required this.sessionId,
    required this.role,
    required this.message,
    required this.timestamp,
  });

  factory LogEntry.fromJson(Map<String, dynamic> json) {
    return LogEntry(
      id:
          json['id'] as String? ??
          DateTime.now().millisecondsSinceEpoch.toString(),
      sessionId:
          json['sessionID'] as String? ?? json['sessionId'] as String? ?? '',
      role: json['role'] as String? ?? 'system',
      message: json['message'] as String? ?? json['text'] as String? ?? '',
      timestamp: json['timestamp'] != null
          ? DateTime.fromMillisecondsSinceEpoch(json['timestamp'] as int)
          : DateTime.now(),
    );
  }
}

class SessionInfo {
  final String id;
  final String title;
  final int updated;
  final String directory;
  final String status;

  SessionInfo({
    required this.id,
    required this.title,
    required this.updated,
    this.directory = '',
    this.status = 'idle',
  });

  factory SessionInfo.fromJson(Map<String, dynamic> json) {
    return SessionInfo(
      id: json['id'] as String,
      title: json['title'] as String,
      updated: json['updated'] as int,
      directory: json['directory'] as String? ?? '',
      status: json['status'] as String? ?? 'idle',
    );
  }

  String get formattedDate {
    final dt = DateTime.fromMillisecondsSinceEpoch(updated);
    return "${dt.day.toString().padLeft(2, '0')}/${dt.month.toString().padLeft(2, '0')} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}";
  }

  bool get isActive => status == 'busy' || status == 'retry';
}

class DirectoryEntry {
  final String name;
  final String path;
  final bool hidden;

  const DirectoryEntry({
    required this.name,
    required this.path,
    this.hidden = false,
  });

  factory DirectoryEntry.fromJson(Map<String, dynamic> json) => DirectoryEntry(
    name: json['name'] as String? ?? '',
    path: json['path'] as String? ?? '',
    hidden: json['hidden'] as bool? ?? false,
  );
}

class DirectoryListing {
  final String path;
  final String home;
  final String? parent;
  final List<DirectoryEntry> roots;
  final List<DirectoryEntry> directories;

  const DirectoryListing({
    required this.path,
    required this.home,
    this.parent,
    this.roots = const [],
    this.directories = const [],
  });

  factory DirectoryListing.fromJson(Map<String, dynamic> json) {
    List<DirectoryEntry> entries(String key) => (json[key] as List? ?? const [])
        .whereType<Map>()
        .map((item) => DirectoryEntry.fromJson(Map<String, dynamic>.from(item)))
        .toList();
    return DirectoryListing(
      path: json['path'] as String? ?? '',
      home: json['home'] as String? ?? '',
      parent: json['parent'] as String?,
      roots: entries('roots'),
      directories: entries('directories'),
    );
  }
}

/// A running or completed sub-agent spawned by an orchestrator.
class SubAgentInfo {
  final String sessionId;
  final String? parentSessionId;
  final String? parentStepId;
  final String? directory;
  final String agentType;
  final String name;
  final String status; // 'running' | 'done' | 'failed'
  final int startedAt;
  final int? finishedAt;
  final List<SubAgentActivity> activities;

  SubAgentInfo({
    required this.sessionId,
    this.parentSessionId,
    this.parentStepId,
    this.directory,
    required this.agentType,
    required this.name,
    required this.status,
    required this.startedAt,
    this.finishedAt,
    this.activities = const [],
  });

  factory SubAgentInfo.fromJson(Map<String, dynamic> json) {
    return SubAgentInfo(
      sessionId: json['sessionID'] as String,
      parentSessionId: json['parentSessionID'] as String?,
      parentStepId: json['parentStepId'] as String?,
      directory: json['directory'] as String?,
      agentType: json['agentType'] as String? ?? 'unknown',
      name: json['name'] as String? ?? json['agentType'] as String? ?? 'Agent',
      status: json['status'] as String? ?? 'running',
      startedAt: json['startedAt'] as int? ?? 0,
      finishedAt: json['finishedAt'] as int?,
      activities: (json['activities'] as List? ?? const [])
          .whereType<Map>()
          .map(
            (item) =>
                SubAgentActivity.fromJson(Map<String, dynamic>.from(item)),
          )
          .toList(),
    );
  }

  SubAgentInfo copyWith({
    String? status,
    int? finishedAt,
    List<SubAgentActivity>? activities,
  }) => SubAgentInfo(
    sessionId: sessionId,
    parentSessionId: parentSessionId,
    parentStepId: parentStepId,
    directory: directory,
    agentType: agentType,
    name: name,
    status: status ?? this.status,
    startedAt: startedAt,
    finishedAt: finishedAt ?? this.finishedAt,
    activities: activities ?? this.activities,
  );
}

class SubAgentActivity {
  final String kind;
  final String label;
  final String status;
  final String? output;
  final int time;

  const SubAgentActivity({
    required this.kind,
    required this.label,
    required this.status,
    this.output,
    required this.time,
  });

  factory SubAgentActivity.fromJson(Map<String, dynamic> json) {
    return SubAgentActivity(
      kind: json['kind'] as String? ?? 'transcript',
      label: json['label'] as String? ?? '',
      status: json['status'] as String? ?? 'running',
      output: json['output'] as String?,
      time: json['time'] as int? ?? 0,
    );
  }
}

enum MissionStatus { waiting, running, paused, completed, failed }

/// A display-ready workflow assembled from chain, child-agent and decision
/// events. This is deliberately derived state: reconnect snapshots remain the
/// source of truth and the phone never invents a second workflow database.
class MissionInfo {
  final String id;
  final String? workflowId;
  final String? sessionId;
  final String? directory;
  final List<DagStep> steps;
  final List<SubAgentInfo> agents;
  final int pendingDecisions;
  final MissionStatus status;

  const MissionInfo({
    required this.id,
    this.workflowId,
    this.sessionId,
    this.directory,
    required this.steps,
    required this.agents,
    required this.pendingDecisions,
    required this.status,
  });

  int get completedSteps =>
      steps.where((step) => step.status == 'complete').length;

  static List<MissionInfo> assemble({
    required List<DagStep> steps,
    required List<SubAgentInfo> agents,
    required List<PendingPermission> permissions,
    required List<PendingQuestion> questions,
  }) {
    final groupedSteps = <String, List<DagStep>>{};
    for (final step in steps) {
      final key = _missionKey(
        workflowId: step.workflowId,
        sessionId: step.sessionId,
        directory: step.directory,
      );
      groupedSteps.putIfAbsent(key, () => []).add(step);
    }

    final missions = <MissionInfo>[];
    final assignedAgents = <String>{};
    for (final entry in groupedSteps.entries) {
      final missionSteps = entry.value;
      final first = missionSteps.first;
      final missionAgents = agents.where((agent) {
        final stepMatches =
            agent.parentStepId == null ||
            missionSteps.any((step) => step.stepId == agent.parentStepId);
        final matches =
            stepMatches &&
            agent.parentSessionId == first.sessionId &&
            (agent.directory == null ||
                first.directory == null ||
                agent.directory == first.directory);
        if (matches) assignedAgents.add(agent.sessionId);
        return matches;
      }).toList();
      missions.add(
        _build(
          id: entry.key,
          workflowId: first.workflowId,
          sessionId: first.sessionId,
          directory: first.directory,
          steps: missionSteps,
          agents: missionAgents,
          permissions: permissions,
          questions: questions,
        ),
      );
    }

    for (final agent in agents) {
      if (assignedAgents.contains(agent.sessionId)) continue;
      final sessionId = agent.parentSessionId ?? agent.sessionId;
      missions.add(
        _build(
          id: _missionKey(sessionId: sessionId, directory: agent.directory),
          sessionId: sessionId,
          directory: agent.directory,
          steps: const [],
          agents: [agent],
          permissions: permissions,
          questions: questions,
        ),
      );
    }
    return missions;
  }

  static MissionInfo _build({
    required String id,
    String? workflowId,
    String? sessionId,
    String? directory,
    required List<DagStep> steps,
    required List<SubAgentInfo> agents,
    required List<PendingPermission> permissions,
    required List<PendingQuestion> questions,
  }) {
    final relatedSessions = <String>{
      ?sessionId,
      ...agents.map((agent) => agent.sessionId),
    };
    final decisions =
        permissions
            .where((item) => relatedSessions.contains(item.sessionId))
            .length +
        questions
            .where((item) => relatedSessions.contains(item.sessionId))
            .length;
    final states = [
      ...steps.map((step) => step.status),
      ...agents.map((agent) => agent.status),
    ];
    final status =
        states.any((state) => state == 'failed' || state == 'stopped')
        ? MissionStatus.failed
        : states.any((state) => state == 'paused')
        ? MissionStatus.paused
        : decisions > 0
        ? MissionStatus.waiting
        : states.any(_isRunning)
        ? MissionStatus.running
        : states.isNotEmpty &&
              states.every((state) => state == 'complete' || state == 'done')
        ? MissionStatus.completed
        : MissionStatus.waiting;
    return MissionInfo(
      id: id,
      workflowId: workflowId,
      sessionId: sessionId,
      directory: directory,
      steps: steps,
      agents: agents,
      pendingDecisions: decisions,
      status: status,
    );
  }

  static bool _isRunning(String status) =>
      status == 'running' || status == 'in_progress' || status.endsWith('ing');

  static String _missionKey({
    String? workflowId,
    String? sessionId,
    String? directory,
  }) => workflowId ?? '${directory ?? ''}\u0000${sessionId ?? 'unassigned'}';
}

/// An option for a select-type question.
class QuestionOption {
  final String label;
  final String description;

  const QuestionOption({required this.label, required this.description});

  factory QuestionOption.fromJson(Map<String, dynamic> json) {
    return QuestionOption(
      label: json['label'] as String? ?? '',
      description: json['description'] as String? ?? '',
    );
  }
}

/// A single question from the question tool.
class QuestionInfo {
  final String question;
  final String header;
  final String type; // 'select', 'text', 'password'
  final String? placeholder;
  final List<QuestionOption> options;
  final bool multiple;

  const QuestionInfo({
    required this.question,
    required this.header,
    required this.type,
    this.placeholder,
    this.options = const [],
    this.multiple = false,
  });

  factory QuestionInfo.fromJson(Map<String, dynamic> json) {
    final rawOptions = json['options'] as List? ?? [];
    return QuestionInfo(
      question: json['question'] as String? ?? '',
      header: json['header'] as String? ?? '',
      type: json['type'] as String? ?? 'select',
      placeholder: json['placeholder'] as String?,
      options: rawOptions
          .map((o) => QuestionOption.fromJson(o as Map<String, dynamic>))
          .toList(),
      multiple: json['multiple'] as bool? ?? false,
    );
  }
}

/// A pending question request from the AI assistant.
class PendingQuestion {
  final String reqId;
  final String sessionId;
  final String? directory;
  final List<QuestionInfo> questions;

  const PendingQuestion({
    required this.reqId,
    required this.sessionId,
    this.directory,
    required this.questions,
  });

  factory PendingQuestion.fromJson(Map<String, dynamic> json) {
    final rawQuestions = json['questions'] as List? ?? [];
    return PendingQuestion(
      reqId: json['req_id'] as String? ?? '',
      sessionId:
          json['sessionID'] as String? ?? json['sessionId'] as String? ?? '',
      directory: json['directory'] as String?,
      questions: rawQuestions
          .map((q) => QuestionInfo.fromJson(q as Map<String, dynamic>))
          .toList(),
    );
  }
}

class CompanionArtifact {
  final String id;
  final String kind;
  final String direction;
  final String sourceDevice;
  final String title;
  final String name;
  final String mime;
  final int size;
  final String? sha256;
  final DateTime createdAt;
  final DateTime? expiresAt;
  final String? sessionId;
  final String downloadPath;

  const CompanionArtifact({
    required this.id,
    required this.kind,
    required this.direction,
    required this.sourceDevice,
    required this.title,
    required this.name,
    required this.mime,
    required this.size,
    this.sha256,
    required this.createdAt,
    this.expiresAt,
    this.sessionId,
    required this.downloadPath,
  });

  factory CompanionArtifact.fromJson(Map<String, dynamic> json) =>
      CompanionArtifact(
        id: json['id'] as String? ?? '',
        kind: json['kind'] as String? ?? 'file',
        direction: json['direction'] as String? ?? 'pc_to_mobile',
        sourceDevice: json['sourceDevice'] as String? ?? 'AtomCLI machine',
        title: json['title'] as String? ?? json['name'] as String? ?? 'File',
        name: json['name'] as String? ?? 'file',
        mime: json['mime'] as String? ?? 'application/octet-stream',
        size: json['size'] as int? ?? 0,
        sha256: json['sha256'] as String?,
        createdAt: DateTime.fromMillisecondsSinceEpoch(
          json['createdAt'] as int? ?? DateTime.now().millisecondsSinceEpoch,
        ),
        expiresAt: json['expiresAt'] is int
            ? DateTime.fromMillisecondsSinceEpoch(json['expiresAt'] as int)
            : null,
        sessionId: json['sessionID'] as String?,
        downloadPath: json['downloadPath'] as String? ?? '',
      );
}

class CompanionPreview {
  final String id;
  final String title;
  final String command;
  final int port;
  final String status;
  final List<String> endpoints;
  final String logTail;
  final DateTime createdAt;
  final String sourceDevice;
  final String directory;
  final String? sessionId;
  final int? exitCode;
  final DateTime? accessExpiresAt;

  const CompanionPreview({
    required this.id,
    required this.title,
    required this.command,
    required this.port,
    required this.status,
    required this.endpoints,
    required this.logTail,
    required this.createdAt,
    required this.sourceDevice,
    required this.directory,
    this.sessionId,
    this.exitCode,
    this.accessExpiresAt,
  });

  factory CompanionPreview.fromJson(Map<String, dynamic> json) =>
      CompanionPreview(
        id: json['id'] as String? ?? '',
        title: json['title'] as String? ?? 'Project preview',
        command: json['command'] as String? ?? '',
        port: json['port'] as int? ?? 0,
        status: json['status'] as String? ?? 'starting',
        endpoints: (json['endpoints'] as List? ?? const [])
            .whereType<String>()
            .toList(),
        logTail: json['logTail'] as String? ?? '',
        createdAt: DateTime.fromMillisecondsSinceEpoch(
          json['createdAt'] as int? ?? DateTime.now().millisecondsSinceEpoch,
        ),
        sourceDevice: json['sourceDevice'] as String? ?? 'AtomCLI machine',
        directory: json['directory'] as String? ?? '',
        sessionId: json['sessionID'] as String?,
        exitCode: json['exitCode'] as int?,
        accessExpiresAt: json['accessExpiresAt'] is int
            ? DateTime.fromMillisecondsSinceEpoch(
                json['accessExpiresAt'] as int,
              )
            : null,
      );
}

class ConversationPart {
  final String id;
  final String messageId;
  final String sessionId;
  final String type;
  final String text;
  final String? tool;
  final Map<String, dynamic>? toolState;
  final String? mime;
  final String? filename;
  final String? url;

  const ConversationPart({
    required this.id,
    required this.messageId,
    required this.sessionId,
    required this.type,
    this.text = '',
    this.tool,
    this.toolState,
    this.mime,
    this.filename,
    this.url,
  });

  factory ConversationPart.fromJson(Map<String, dynamic> json) {
    return ConversationPart(
      id: json['id'] as String? ?? '',
      messageId: json['messageID'] as String? ?? '',
      sessionId: json['sessionID'] as String? ?? '',
      type: json['type'] as String? ?? 'unknown',
      text: json['text'] as String? ?? '',
      tool: json['tool'] as String?,
      toolState: json['state'] is Map
          ? Map<String, dynamic>.from(json['state'] as Map)
          : null,
      mime: json['mime'] as String?,
      filename: json['filename'] as String?,
      url: json['url'] as String?,
    );
  }

  ConversationPart merge(ConversationPart incoming, String? delta) {
    if (delta != null && incoming.type == 'text') {
      return ConversationPart(
        id: incoming.id.isEmpty ? id : incoming.id,
        messageId: incoming.messageId.isEmpty ? messageId : incoming.messageId,
        sessionId: incoming.sessionId.isEmpty ? sessionId : incoming.sessionId,
        type: incoming.type,
        text: text + delta,
        tool: incoming.tool ?? tool,
        toolState: incoming.toolState ?? toolState,
        mime: incoming.mime ?? mime,
        filename: incoming.filename ?? filename,
        url: incoming.url ?? url,
      );
    }
    return incoming;
  }
}

class ConversationFailure {
  final String code;
  final String message;
  final int? statusCode;
  final bool retryable;

  const ConversationFailure({
    required this.code,
    required this.message,
    this.statusCode,
    this.retryable = false,
  });

  factory ConversationFailure.fromJson(Object? raw) {
    if (raw is String) {
      return ConversationFailure(
        code: 'Error',
        message: _boundedFailureText(raw),
      );
    }
    final error = raw is Map
        ? Map<String, dynamic>.from(raw)
        : const <String, dynamic>{};
    final data = error['data'] is Map
        ? Map<String, dynamic>.from(error['data'] as Map)
        : const <String, dynamic>{};
    final status = data['statusCode'] ?? error['statusCode'];
    return ConversationFailure(
      code: error['name'] as String? ?? error['code'] as String? ?? 'Error',
      message: _boundedFailureText(
        data['message'] as String? ??
            error['message'] as String? ??
            'Unknown provider error',
      ),
      statusCode: status is num ? status.toInt() : null,
      retryable:
          data['isRetryable'] as bool? ??
          error['isRetryable'] as bool? ??
          false,
    );
  }
}

String _boundedFailureText(String value) {
  final normalized = value.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (normalized.length <= 500) return normalized;
  return '${normalized.substring(0, 497)}...';
}

String? _conversationModelId(Map<String, dynamic> json) {
  final model = json['model'];
  if (model is String && model.isNotEmpty) return model;
  if (model is Map) {
    final providerId = model['providerID'] as String?;
    final modelId = model['modelID'] as String?;
    if (providerId?.isNotEmpty == true && modelId?.isNotEmpty == true) {
      return '$providerId/$modelId';
    }
  }
  final providerId = json['providerID'] as String?;
  final modelId = json['modelID'] as String?;
  if (providerId?.isNotEmpty == true && modelId?.isNotEmpty == true) {
    return '$providerId/$modelId';
  }
  return null;
}

class ConversationMessage {
  final String id;
  final String sessionId;
  final String role;
  final DateTime time;
  final List<ConversationPart> parts;
  final String? modelId;
  final String? agent;
  final String? variant;
  final ConversationFailure? failure;

  const ConversationMessage({
    required this.id,
    required this.sessionId,
    required this.role,
    required this.time,
    this.parts = const [],
    this.modelId,
    this.agent,
    this.variant,
    this.failure,
  });

  factory ConversationMessage.fromJson(Map<String, dynamic> json) {
    final rawTime = json['time'];
    final created = rawTime is Map
        ? (rawTime['created'] as int? ?? rawTime['updated'] as int?)
        : null;
    final rawParts = json['parts'] as List? ?? const [];
    return ConversationMessage(
      id: json['id'] as String? ?? '',
      sessionId: json['sessionID'] as String? ?? '',
      role: json['role'] as String? ?? 'assistant',
      time: created == null
          ? DateTime.now()
          : DateTime.fromMillisecondsSinceEpoch(created),
      parts: rawParts
          .whereType<Map>()
          .map(
            (part) =>
                ConversationPart.fromJson(Map<String, dynamic>.from(part)),
          )
          .where(
            (part) =>
                const {'text', 'reasoning', 'tool', 'file'}.contains(part.type),
          )
          .toList(),
      modelId: _conversationModelId(json),
      agent: json['agent'] as String?,
      variant: json['variant'] as String?,
      failure: json['error'] == null
          ? null
          : ConversationFailure.fromJson(json['error']),
    );
  }

  ConversationMessage copyWith({
    String? role,
    DateTime? time,
    List<ConversationPart>? parts,
    String? modelId,
    String? agent,
    String? variant,
    ConversationFailure? failure,
  }) {
    return ConversationMessage(
      id: id,
      sessionId: sessionId,
      role: role ?? this.role,
      time: time ?? this.time,
      parts: parts ?? this.parts,
      modelId: modelId ?? this.modelId,
      agent: agent ?? this.agent,
      variant: variant ?? this.variant,
      failure: failure ?? this.failure,
    );
  }
}

/// Chat message model for messaging feature
class ChatMessage {
  final String id;
  final String role; // 'user', 'assistant', 'system'
  final String content;
  final int timestamp;
  final bool isStreaming;
  final String? error;

  const ChatMessage({
    required this.id,
    required this.role,
    required this.content,
    required this.timestamp,
    this.isStreaming = false,
    this.error,
  });

  factory ChatMessage.fromJson(Map<String, dynamic> json) {
    return ChatMessage(
      id: json['id'] as String? ?? '',
      role: json['role'] as String? ?? 'system',
      content: json['content'] as String? ?? json['text'] as String? ?? '',
      timestamp:
          json['timestamp'] as int? ?? DateTime.now().millisecondsSinceEpoch,
      isStreaming: json['isStreaming'] as bool? ?? false,
      error: json['error'] as String?,
    );
  }

  ChatMessage copyWith({
    String? id,
    String? role,
    String? content,
    int? timestamp,
    bool? isStreaming,
    String? error,
  }) {
    return ChatMessage(
      id: id ?? this.id,
      role: role ?? this.role,
      content: content ?? this.content,
      timestamp: timestamp ?? this.timestamp,
      isStreaming: isStreaming ?? this.isStreaming,
      error: error ?? this.error,
    );
  }
}
