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
    return PairingPayload(
      v: json['v'] as int,
      endpoints: List<String>.from(json['endpoints'] as List),
      pairingToken: json['pairing_token'] as String,
      httpPair: json['http_pair'] as String,
    );
  }
}

/// A pending permission request received from the backend.
class PendingPermission {
  final String reqId;
  final String sessionId;
  final String permission;
  final List<String> patterns;
  final Map<String, dynamic> metadata;

  const PendingPermission({
    required this.reqId,
    required this.sessionId,
    required this.permission,
    required this.patterns,
    required this.metadata,
  });

  factory PendingPermission.fromJson(Map<String, dynamic> json) {
    return PendingPermission(
      reqId: json['req_id'] as String,
      sessionId: json['sessionID'] as String? ?? '',
      permission: json['permission'] as String,
      patterns: List<String>.from(json['patterns'] as List? ?? []),
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
  final String name;
  final String description;
  final String
  status; // pending | running | complete | failed | <tool-specific>
  final String? sessionId;
  final String? agentType;
  final List<String> dependsOn;
  final List<TodoItem> todos;

  const DagStep({
    required this.name,
    required this.description,
    required this.status,
    this.sessionId,
    this.agentType,
    this.dependsOn = const [],
    this.todos = const [],
  });

  factory DagStep.fromJson(Map<String, dynamic> json) {
    final rawTodos = json['todos'] as List? ?? [];
    return DagStep(
      name: json['name'] as String,
      description: json['description'] as String,
      status: json['status'] as String? ?? 'pending',
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
      name: name,
      description: description,
      status: status ?? this.status,
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

  SessionInfo({required this.id, required this.title, required this.updated});

  factory SessionInfo.fromJson(Map<String, dynamic> json) {
    return SessionInfo(
      id: json['id'] as String,
      title: json['title'] as String,
      updated: json['updated'] as int,
    );
  }

  String get formattedDate {
    final dt = DateTime.fromMillisecondsSinceEpoch(updated);
    return "${dt.day.toString().padLeft(2, '0')}/${dt.month.toString().padLeft(2, '0')} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}";
  }
}

/// A running or completed sub-agent spawned by an orchestrator.
class SubAgentInfo {
  final String sessionId;
  final String? parentSessionId;
  final String agentType;
  final String name;
  final String status; // 'running' | 'done' | 'failed'
  final int startedAt;
  final int? finishedAt;

  SubAgentInfo({
    required this.sessionId,
    this.parentSessionId,
    required this.agentType,
    required this.name,
    required this.status,
    required this.startedAt,
    this.finishedAt,
  });

  factory SubAgentInfo.fromJson(Map<String, dynamic> json) {
    return SubAgentInfo(
      sessionId: json['sessionID'] as String,
      parentSessionId: json['parentSessionID'] as String?,
      agentType: json['agentType'] as String? ?? 'unknown',
      name: json['name'] as String? ?? json['agentType'] as String? ?? 'Agent',
      status: json['status'] as String? ?? 'running',
      startedAt: json['startedAt'] as int? ?? 0,
      finishedAt: json['finishedAt'] as int?,
    );
  }

  SubAgentInfo copyWith({String? status, int? finishedAt}) => SubAgentInfo(
    sessionId: sessionId,
    parentSessionId: parentSessionId,
    agentType: agentType,
    name: name,
    status: status ?? this.status,
    startedAt: startedAt,
    finishedAt: finishedAt ?? this.finishedAt,
  );
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
  final List<QuestionInfo> questions;

  const PendingQuestion({
    required this.reqId,
    required this.sessionId,
    required this.questions,
  });

  factory PendingQuestion.fromJson(Map<String, dynamic> json) {
    final rawQuestions = json['questions'] as List? ?? [];
    return PendingQuestion(
      reqId: json['req_id'] as String? ?? '',
      sessionId: json['sessionID'] as String? ?? json['sessionId'] as String? ?? '',
      questions: rawQuestions
          .map((q) => QuestionInfo.fromJson(q as Map<String, dynamic>))
          .toList(),
    );
  }
}
