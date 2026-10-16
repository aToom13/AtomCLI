class BackendEvent {
  final String type;
  final int? seqId;
  final String? bridgeEpoch;
  final String? topic;
  final Map<String, dynamic> payload;

  const BackendEvent({
    required this.type,
    this.seqId,
    this.bridgeEpoch,
    this.topic,
    required this.payload,
  });

  factory BackendEvent.fromJson(Map<String, dynamic> json) {
    final rawType = json['type'];
    final type = rawType is String
        ? rawType
        : json.containsKey('error')
        ? 'protocol_error'
        : json.containsKey('status')
        ? 'action_result'
        : 'unknown_message';
    return BackendEvent(
      type: type,
      seqId: json['seq_id'] as int?,
      bridgeEpoch: json['bridge_epoch'] as String?,
      topic: json['topic'] as String?,
      payload: Map<String, dynamic>.from(json['payload'] as Map? ?? json),
    );
  }
}

class ActionResult {
  final String action;
  final String status;
  final String? id;
  final String? error;
  final Map<String, dynamic> payload;

  const ActionResult({
    required this.action,
    required this.status,
    this.id,
    this.error,
    required this.payload,
  });

  bool get isOk => status == 'ok';

  factory ActionResult.fromEvent(BackendEvent event) {
    return ActionResult(
      action: event.payload['action'] as String? ?? event.type,
      status: event.payload['status'] as String? ?? 'ok',
      id: event.payload['id'] as String?,
      error: event.payload['error'] as String?,
      payload: event.payload,
    );
  }
}

enum WsLifecycle { connecting, connected, disconnected }
