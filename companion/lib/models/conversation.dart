part of '../models.dart';

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
  final CheckpointData? checkpoint;

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
    this.checkpoint,
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
      checkpoint: json['type'] == 'checkpoint'
          ? CheckpointData.fromJson(Map<String, dynamic>.from(json))
          : null,
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
        checkpoint: incoming.checkpoint ?? checkpoint,
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
            (part) => const {
              'text',
              'reasoning',
              'tool',
              'file',
              'checkpoint',
            }.contains(part.type),
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
