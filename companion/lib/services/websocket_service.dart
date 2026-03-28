import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:web_socket_channel/status.dart' as status;

/// Event received from the AtomCLI backend via WebSocket.
class BackendEvent {
  final String type;
  final int? seqId;
  final String? topic; // top-level topic field (e.g. 'tui.chain.add_step')
  final Map<String, dynamic> payload;

  const BackendEvent({
    required this.type,
    this.seqId,
    this.topic,
    required this.payload,
  });

  factory BackendEvent.fromJson(Map<String, dynamic> json) {
    return BackendEvent(
      type: json['type'] as String,
      seqId: json['seq_id'] as int?,
      topic: json['topic'] as String?,
      payload: Map<String, dynamic>.from(json['payload'] as Map? ?? json),
    );
  }
}

/// Connection lifecycle states emitted by [WebSocketService].
enum WsLifecycle { connecting, connected, disconnected }

/// Multi-endpoint WebSocket manager with exponential backoff reconnection.
///
/// Tries endpoints in order (Tailscale MagicDNS → Tailscale IP → LAN).
/// On disconnect, backs off and retries cycling through all endpoints.
class WebSocketService {
  final List<String> endpoints;

  /// Called whenever the connection lifecycle changes.
  /// Wire this up to update `connectionStateProvider` in your provider layer.
  final void Function(WsLifecycle)? onStateChange;

  WebSocketService({required this.endpoints, this.onStateChange});

  WebSocketChannel? _channel;
  StreamController<BackendEvent>? _controller;
  int _seqId = 0;
  int _endpointIndex = 0;
  int _retryCount = 0;
  bool _disposed = false;

  /// Connect and return a stream of backend events.
  Stream<BackendEvent> connect() {
    _controller = StreamController<BackendEvent>.broadcast();
    _tryConnect();
    return _controller!.stream;
  }

  void _tryConnect() async {
    if (_disposed || endpoints.isEmpty) return;

    // Signal connecting state before attempting connection
    onStateChange?.call(WsLifecycle.connecting);

    final url = endpoints[_endpointIndex % endpoints.length];
    try {
      _channel = WebSocketChannel.connect(Uri.parse(url));
      await _channel!.ready;

      _retryCount = 0;
      // Signal connected state
      onStateChange?.call(WsLifecycle.connected);

      // Send initial sync
      _send({'type': 'sync', 'last_seq_id': _seqId});

      _channel!.stream.listen(
        (raw) {
          try {
            final json = jsonDecode(raw as String) as Map<String, dynamic>;
            final event = BackendEvent.fromJson(json);
            if (event.seqId != null && event.seqId! > _seqId) {
              _seqId = event.seqId!;
            }
            _controller?.add(event);
          } catch (_) {}
        },
        onDone: () => _handleDisconnect(),
        onError: (_) => _handleDisconnect(),
      );
    } catch (_) {
      _handleDisconnect();
    }
  }

  void _handleDisconnect() {
    if (_disposed) return;
    _channel = null;
    _endpointIndex++;
    _retryCount++;

    // Signal disconnected state
    onStateChange?.call(WsLifecycle.disconnected);

    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    final delay = Duration(
      seconds: (_retryCount < 5) ? (1 << (_retryCount - 1)).clamp(1, 30) : 30,
    );

    Future.delayed(delay, _tryConnect);
  }

  /// Request a full snapshot from the backend.
  void requestSnapshot() {
    _send({'type': 'request_snapshot'});
  }

  /// Send a signed permission resolution.
  void resolvePermission({
    required String reqId,
    required String resolution, // 'allow' | 'deny' | 'intervene'
    required String deviceName,
    required String signature,
    String? interventionParams,
  }) {
    _send({
      'type': 'permission_resolve',
      'id': reqId,
      'resolution': resolution,
      'intervention_params': interventionParams,
      'device_name': deviceName,
      'signature': signature,
    });
  }

  /// Send a signed request to create a new standalone session.
  void createSession({
    required String deviceName,
    required String signature,
    String? text,
    String? model,
    String? agent,
  }) {
    _send({
      'type': 'create_session',
      if (text != null && text.isNotEmpty) 'text': text,
      if (model != null && model.isNotEmpty) 'model': model,
      if (agent != null && agent.isNotEmpty) 'agent': agent,
      'device_name': deviceName,
      'signature': signature,
    });
  }

  /// Request message history for a given session.
  void getMessages({required String sessionId}) {
    _send({'type': 'get_messages', 'session_id': sessionId});
  }

  /// Send a signed chat message to a session.
  void sendChatMessage({
    required String sessionId,
    required String text,
    required String deviceName,
    required String signature,
    String? model,
    String? agent,
  }) {
    _send({
      'type': 'chat_message',
      'session_id': sessionId,
      'text': text,
      if (model != null && model.isNotEmpty) 'model': model,
      if (agent != null && agent.isNotEmpty) 'agent': agent,
      'device_name': deviceName,
      'signature': signature,
    });
  }

  /// Send a signed reply to a question request from the AI assistant.
  void replyQuestion({
    required String id,
    required List<List<String>> answers,
    required String deviceName,
    required String signature,
  }) {
    _send({
      'type': 'question_reply',
      'id': id,
      'answers': answers,
      'device_name': deviceName,
      'signature': signature,
    });
  }

  /// Send a signed rejection of a question request.
  void rejectQuestion({
    required String id,
    required String deviceName,
    required String signature,
  }) {
    _send({
      'type': 'question_reject',
      'id': id,
      'device_name': deviceName,
      'signature': signature,
    });
  }

  /// Request the list of available models from the backend.
  void getModels() {
    _send({'type': 'get_models'});
  }

  void _send(Map<String, dynamic> msg) {
    _channel?.sink.add(jsonEncode(msg));
  }

  void dispose() {
    _disposed = true;
    _channel?.sink.close(status.goingAway);
    _controller?.close();
  }
}
