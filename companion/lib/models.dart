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
  final DateTime createdAt;
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
    required this.createdAt,
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
        createdAt: DateTime.fromMillisecondsSinceEpoch(
          json['createdAt'] as int? ?? DateTime.now().millisecondsSinceEpoch,
        ),
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

class ConversationMessage {
  final String id;
  final String sessionId;
  final String role;
  final DateTime time;
  final List<ConversationPart> parts;
  final String? modelId;
  final String? agent;
  final String? variant;

  const ConversationMessage({
    required this.id,
    required this.sessionId,
    required this.role,
    required this.time,
    this.parts = const [],
    this.modelId,
    this.agent,
    this.variant,
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
      modelId: json['model'] as String?,
      agent: json['agent'] as String?,
      variant: json['variant'] as String?,
    );
  }

  ConversationMessage copyWith({
    String? role,
    DateTime? time,
    List<ConversationPart>? parts,
    String? modelId,
    String? agent,
    String? variant,
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
