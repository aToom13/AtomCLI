import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:web_socket_channel/status.dart' as status;
import 'package:web_socket_channel/web_socket_channel.dart';

import '../models.dart';
import 'auth_service.dart';

class BackendEvent {
  final String type;
  final int? seqId;
  final String? topic;
  final Map<String, dynamic> payload;

  const BackendEvent({
    required this.type,
    this.seqId,
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

class WebSocketService {
  static const _connectTimeout = Duration(seconds: 10);
  static const _actionTimeout = Duration(seconds: 12);
  static const _heartbeatInterval = Duration(seconds: 20);
  static const _heartbeatTimeout = Duration(seconds: 50);
  static const _closeTimeout = Duration(seconds: 2);

  final List<String> endpoints;
  final void Function(WsLifecycle)? onStateChange;
  final Future<void> Function(int)? onSequenceChange;

  WebSocketService({
    required this.endpoints,
    this.onStateChange,
    this.onSequenceChange,
    int initialSequence = 0,
  }) : _seqId = initialSequence;

  final StreamController<BackendEvent> _controller =
      StreamController<BackendEvent>.broadcast();
  final Map<String, Completer<ActionResult>> _pendingActions = {};
  final Set<Completer<void>> _connectionWaiters = {};

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  Timer? _retryTimer;
  Timer? _heartbeatTimer;
  Timer? _authTimer;
  int _seqId;
  int _endpointIndex = 0;
  int _retryCount = 0;
  int _attempt = 0;
  bool _started = false;
  bool _disposed = false;
  String? _connectionId;
  String? _currentEndpoint;
  String? _lastError;
  int _counter = 0;
  DateTime? _lastPongAt;
  Future<void> _sequenceWrite = Future.value();
  Future<void>? _ensureInFlight;
  bool _lanDiscoveryAttempted = false;

  String? get currentEndpoint => _currentEndpoint;
  String? get lastError => _lastError;
  bool get isConnected => _connectionId != null && !_disposed;

  Uri httpUriForPath(String relativePath) {
    final endpoint = _currentEndpoint ?? endpoints.firstOrNull;
    if (endpoint == null) throw StateError('No AtomCLI endpoint is available');
    final base = Uri.parse(endpoint);
    final relative = Uri.parse(relativePath);
    return base.replace(
      scheme: base.scheme == 'wss' ? 'https' : 'http',
      path: relative.path,
      query: relative.hasQuery ? relative.query : null,
      fragment: null,
    );
  }

  Stream<BackendEvent> connect() {
    if (!_started && !_disposed) {
      _started = true;
      unawaited(_prepareConnection());
    }
    return _controller.stream;
  }

  Future<void> reconnect() async {
    if (_disposed) return;
    _retryTimer?.cancel();
    _heartbeatTimer?.cancel();
    _authTimer?.cancel();
    _retryCount = 0;
    _endpointIndex = 0;
    _attempt++;
    final oldChannel = _channel;
    _channel = null;
    _connectionId = null;
    final oldSubscription = _subscription;
    _subscription = null;
    await _shutdownTransport(oldChannel, oldSubscription);
    _started = true;
    unawaited(_prepareConnection());
  }

  Future<void> ensureConnected() {
    if (isConnected) return Future.value();
    final inFlight = _ensureInFlight;
    if (inFlight != null) return inFlight;
    final operation = _restoreConnection();
    _ensureInFlight = operation;
    return operation.whenComplete(() {
      if (identical(_ensureInFlight, operation)) _ensureInFlight = null;
    });
  }

  Future<void> _restoreConnection() async {
    if (isConnected) return;
    final waiter = Completer<void>();
    _connectionWaiters.add(waiter);
    try {
      await reconnect();
      if (isConnected) return;
      await waiter.future.timeout(
        _connectTimeout,
        onTimeout: () => throw TimeoutException(
          _lastError ?? 'AtomCLI connection was not restored in time',
        ),
      );
    } finally {
      _connectionWaiters.remove(waiter);
    }
  }

  Future<void> suspend() async {
    if (_disposed || !_started) return;
    _attempt++;
    _retryTimer?.cancel();
    _heartbeatTimer?.cancel();
    _authTimer?.cancel();
    _started = false;
    _connectionId = null;
    _counter = 0;
    _failPendingActions('Connection handed to the background service');
    final oldSubscription = _subscription;
    final oldChannel = _channel;
    _subscription = null;
    _channel = null;
    await _shutdownTransport(oldChannel, oldSubscription);
    await _sequenceWrite;
    onStateChange?.call(WsLifecycle.disconnected);
  }

  Future<void> _prepareConnection() async {
    if (!_lanDiscoveryAttempted) {
      _lanDiscoveryAttempted = true;
      await _refreshLanEndpoint();
    }
    if (_started && !_disposed) _tryConnect();
  }

  /// A tethering/Wi-Fi subnet can change while the paired machine keeps the
  /// same DHCP host suffix. Probe only those translated saved endpoints; this
  /// restores LAN-first behavior without scanning the surrounding network.
  Future<void> _refreshLanEndpoint() async {
    final savedLan = endpoints
        .map(Uri.tryParse)
        .whereType<Uri>()
        .where((uri) => _isLanIPv4(uri.host))
        .toList();
    if (savedLan.isEmpty) return;
    try {
      final interfaces = await NetworkInterface.list(
        type: InternetAddressType.IPv4,
        includeLoopback: false,
        includeLinkLocal: false,
      );
      for (final interface in interfaces) {
        final name = interface.name.toLowerCase();
        if (!name.contains('wlan') &&
            !name.contains('wifi') &&
            !name.startsWith('eth')) {
          continue;
        }
        for (final address in interface.addresses) {
          if (!_isLanIPv4(address.address)) continue;
          final network = address.address.split('.')..removeLast();
          for (final saved in savedLan) {
            final suffix = saved.host.split('.').last;
            final host = [...network, suffix].join('.');
            final candidate = saved.replace(host: host).toString();
            if (!await _canReach(host, saved.port)) continue;
            endpoints
              ..remove(candidate)
              ..insert(0, candidate);
            return;
          }
        }
      }
    } catch (_) {
      // Endpoint cycling remains available when Android hides interface data.
    }
  }

  static Future<bool> _canReach(String host, int port) async {
    Socket? socket;
    try {
      socket = await Socket.connect(
        host,
        port,
        timeout: const Duration(milliseconds: 500),
      );
      return true;
    } catch (_) {
      return false;
    } finally {
      socket?.destroy();
    }
  }

  static bool _isLanIPv4(String host) {
    final parts = host.split('.').map(int.tryParse).toList();
    if (parts.length != 4 || parts.any((part) => part == null)) return false;
    final first = parts[0]!;
    final second = parts[1]!;
    return first == 10 ||
        (first == 172 && second >= 16 && second <= 31) ||
        (first == 192 && second == 168);
  }

  Future<void> _tryConnect() async {
    if (_disposed || endpoints.isEmpty) {
      if (endpoints.isEmpty) _reportError('No reachable endpoint was provided');
      return;
    }

    final attempt = ++_attempt;
    onStateChange?.call(WsLifecycle.connecting);
    final url = endpoints[_endpointIndex % endpoints.length];
    _currentEndpoint = url;
    _lastError = null;

    try {
      final channel = WebSocketChannel.connect(Uri.parse(url));
      _channel = channel;
      await channel.ready.timeout(_connectTimeout);
      if (_disposed || attempt != _attempt) {
        await channel.sink.close(status.normalClosure);
        return;
      }

      _retryCount = 0;
      _subscription = channel.stream.listen(
        (raw) => unawaited(_handleMessage(attempt, raw)),
        onDone: () => _handleDisconnect(attempt, 'Connection closed'),
        onError: (Object error) => _handleDisconnect(attempt, error.toString()),
        cancelOnError: true,
      );
      _authTimer = Timer(
        _connectTimeout,
        () => _handleDisconnect(attempt, 'Authentication timed out'),
      );
    } on TimeoutException {
      _handleDisconnect(attempt, 'Connection timed out');
    } catch (error) {
      _handleDisconnect(attempt, error.toString());
    }
  }

  Future<void> _handleMessage(int attempt, dynamic raw) async {
    if (_disposed || attempt != _attempt) return;
    try {
      final json = jsonDecode(raw as String) as Map<String, dynamic>;
      if (json['type'] == 'auth_challenge') {
        _authenticate(json['challenge'] as String);
        return;
      }
      if (json['type'] == 'auth_ok') {
        final bridgeEpoch = json['bridge_epoch'] as String?;
        if (bridgeEpoch != null && bridgeEpoch.isNotEmpty) {
          await AuthService.instance.resetForBridgeEpoch(bridgeEpoch);
          _seqId = AuthService.instance.lastSequence;
        }
        final refreshedEndpoints = (json['endpoints'] as List? ?? const [])
            .whereType<String>()
            .toList();
        if (refreshedEndpoints.isNotEmpty) {
          final ordered = AuthService.orderEndpoints(refreshedEndpoints);
          endpoints
            ..clear()
            ..addAll(ordered);
          unawaited(
            AuthService.instance.saveEndpoints(ordered, resetSequence: false),
          );
        }
        _authTimer?.cancel();
        _connectionId = json['connection_id'] as String;
        _counter = 0;
        _lastPongAt = DateTime.now();
        onStateChange?.call(WsLifecycle.connected);
        for (final waiter in _connectionWaiters.toList()) {
          if (!waiter.isCompleted) waiter.complete();
        }
        _send({'type': 'sync', 'last_seq_id': _seqId});
        _startHeartbeat(attempt);
        return;
      }
      if (json['type'] == 'pong') {
        _lastPongAt = DateTime.now();
        return;
      }

      final event = BackendEvent.fromJson(json);
      if (event.type == 'snapshot') {
        final current = event.payload['current_seq_id'];
        if (current is int) _synchronizeSequence(current);
      } else if (event.seqId != null && event.seqId! > _seqId) {
        _recordSequence(event.seqId!);
      }
      _completePendingAction(event);
      _controller.add(event);
    } catch (error) {
      _reportError('Invalid server message: $error');
    }
  }

  void _startHeartbeat(int attempt) {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(_heartbeatInterval, (_) {
      if (_disposed || attempt != _attempt) return;
      final lastPong = _lastPongAt;
      if (lastPong == null ||
          DateTime.now().difference(lastPong) > _heartbeatTimeout) {
        _handleDisconnect(attempt, 'Heartbeat timed out');
        return;
      }
      _send({
        'type': 'ping',
        'timestamp': DateTime.now().millisecondsSinceEpoch,
      });
    });
  }

  void _recordSequence(int sequence) {
    if (sequence <= _seqId) return;
    _synchronizeSequence(sequence);
  }

  void _synchronizeSequence(int sequence) {
    if (sequence < 0 || sequence == _seqId) return;
    _seqId = sequence;
    final callback = onSequenceChange;
    if (callback == null) return;
    _sequenceWrite = _sequenceWrite
        .then((_) => callback(sequence))
        .catchError((_) {});
  }

  void _handleDisconnect(int attempt, String reason) {
    if (_disposed || attempt != _attempt) return;
    _attempt++;
    _authTimer?.cancel();
    _heartbeatTimer?.cancel();
    final oldSubscription = _subscription;
    _subscription = null;
    final oldChannel = _channel;
    _channel = null;
    unawaited(_shutdownTransport(oldChannel, oldSubscription));
    _connectionId = null;
    _counter = 0;
    _lastError = reason;
    _endpointIndex++;
    _retryCount++;
    _failPendingActions('Connection lost');
    onStateChange?.call(WsLifecycle.disconnected);
    _reportError(reason);

    final seconds = _retryCount < 5
        ? (1 << (_retryCount - 1)).clamp(1, 30)
        : 30;
    _retryTimer = Timer(Duration(seconds: seconds), _tryConnect);
  }

  void requestSnapshot() {
    _requireSend({'type': 'request_snapshot'});
  }

  Future<ActionResult> resolvePermission({
    required String reqId,
    required String resolution,
    String? directory,
  }) {
    return _sendSignedAction({
      'type': 'permission_resolve',
      'id': reqId,
      'resolution': resolution,
      if (directory != null && directory.isNotEmpty) 'directory': directory,
    });
  }

  Future<ActionResult> createSession({
    String? text,
    String? model,
    String? agent,
    String? variant,
    String? directory,
  }) {
    return _sendSignedAction({
      'type': 'create_session',
      if (text != null && text.isNotEmpty) 'text': text,
      if (model != null && model.isNotEmpty) 'model': model,
      if (agent != null && agent.isNotEmpty) 'agent': agent,
      if (variant != null && variant.isNotEmpty) 'variant': variant,
      if (directory != null && directory.isNotEmpty) 'directory': directory,
    });
  }

  Future<ActionResult> getMessages({
    required String sessionId,
    String? directory,
  }) {
    return _sendReadRequest({
      'type': 'get_messages',
      'session_id': sessionId,
      if (directory != null && directory.isNotEmpty) 'directory': directory,
    });
  }

  Future<DirectoryListing> listDirectories({String? path}) async {
    final result = await _sendReadRequest({
      'type': 'list_directories',
      if (path != null && path.isNotEmpty) 'path': path,
    });
    return DirectoryListing.fromJson(result.payload);
  }

  Future<ActionResult> sendChatMessage({
    required String sessionId,
    required String text,
    String? model,
    String? agent,
    String? variant,
    String? directory,
    List<String> attachments = const [],
  }) {
    return _sendSignedAction({
      'type': 'chat_message',
      'session_id': sessionId,
      'text': text,
      if (attachments.isNotEmpty) 'attachments': attachments,
      if (model != null && model.isNotEmpty) 'model': model,
      if (agent != null && agent.isNotEmpty) 'agent': agent,
      if (variant != null && variant.isNotEmpty) 'variant': variant,
      if (directory != null && directory.isNotEmpty) 'directory': directory,
    });
  }

  Future<ActionResult> replyQuestion({
    required String id,
    required List<List<String>> answers,
    String? directory,
  }) {
    return _sendSignedAction({
      'type': 'question_reply',
      'id': id,
      'answers': answers,
      if (directory != null && directory.isNotEmpty) 'directory': directory,
    });
  }

  Future<ActionResult> rejectQuestion({required String id, String? directory}) {
    return _sendSignedAction({
      'type': 'question_reject',
      'id': id,
      if (directory != null && directory.isNotEmpty) 'directory': directory,
    });
  }

  Future<ActionResult> abortSession({
    required String sessionId,
    String? directory,
  }) {
    return _sendSignedAction({
      'type': 'abort_session',
      'session_id': sessionId,
      if (directory != null && directory.isNotEmpty) 'directory': directory,
    });
  }

  Future<ActionResult> createUpload({
    required String sessionId,
    required String filename,
    required String mime,
    required int size,
    String? directory,
    String? model,
    String? agent,
    String? variant,
  }) {
    return _sendSignedAction({
      'type': 'create_upload',
      'session_id': sessionId,
      'filename': filename,
      'mime': mime,
      'size': size,
      if (model != null && model.isNotEmpty) 'model': model,
      if (agent != null && agent.isNotEmpty) 'agent': agent,
      if (variant != null && variant.isNotEmpty) 'variant': variant,
      if (directory != null && directory.isNotEmpty) 'directory': directory,
    });
  }

  Future<ActionResult> previewLogs({
    required String previewId,
    String? directory,
  }) {
    return _sendReadRequest({
      'type': 'preview_logs',
      'preview_id': previewId,
      if (directory != null && directory.isNotEmpty) 'directory': directory,
    });
  }

  Future<ActionResult> stopPreview({
    required String previewId,
    String? directory,
  }) {
    return _sendSignedAction({
      'type': 'preview_stop',
      'preview_id': previewId,
      if (directory != null && directory.isNotEmpty) 'directory': directory,
    });
  }

  Future<ActionResult> unpair() {
    return _sendSignedAction({'type': 'unpair'});
  }

  void getModels() {
    _requireSend({'type': 'get_models'});
  }

  void _authenticate(String challenge) {
    final auth = AuthService.instance;
    final payload = <String, dynamic>{
      'type': 'authenticate',
      'challenge': challenge,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
      'device_name': auth.deviceName ?? '',
    };
    payload['signature'] = auth.sign(AuthService.canonicalPayload(payload));
    _requireSend(payload);
  }

  Future<ActionResult> _sendSignedAction(Map<String, dynamic> message) {
    final connectionId = _connectionId;
    if (connectionId == null) {
      return Future.error(StateError('AtomCLI is not connected'));
    }

    final requestId = _uuidV4();
    final auth = AuthService.instance;
    final payload = <String, dynamic>{
      ...message,
      'client_request_id': requestId,
      'connection_id': connectionId,
      'counter': ++_counter,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
      'device_name': auth.deviceName ?? '',
    };
    payload['signature'] = auth.sign(AuthService.canonicalPayload(payload));

    final completer = Completer<ActionResult>();
    _pendingActions[requestId] = completer;
    try {
      _requireSend(payload);
    } catch (error, stackTrace) {
      _pendingActions.remove(requestId);
      completer.completeError(error, stackTrace);
    }

    return completer.future.timeout(
      _actionTimeout,
      onTimeout: () {
        _pendingActions.remove(requestId);
        throw TimeoutException('AtomCLI did not confirm the action');
      },
    );
  }

  Future<ActionResult> _sendReadRequest(Map<String, dynamic> message) {
    if (!isConnected) {
      return Future.error(StateError('AtomCLI is not connected'));
    }
    final requestId = _uuidV4();
    final completer = Completer<ActionResult>();
    _pendingActions[requestId] = completer;
    try {
      _requireSend({...message, 'client_request_id': requestId});
    } catch (error, stackTrace) {
      _pendingActions.remove(requestId);
      completer.completeError(error, stackTrace);
    }
    return completer.future.timeout(
      _actionTimeout,
      onTimeout: () {
        _pendingActions.remove(requestId);
        throw TimeoutException('AtomCLI did not return the requested data');
      },
    );
  }

  void _completePendingAction(BackendEvent event) {
    final requestId = event.payload['client_request_id'] as String?;
    if (requestId == null) return;
    final completer = _pendingActions.remove(requestId);
    if (completer == null || completer.isCompleted) return;
    final result = ActionResult.fromEvent(event);
    if (result.isOk) {
      completer.complete(result);
    } else {
      completer.completeError(StateError(result.error ?? result.status));
    }
  }

  void _requireSend(Map<String, dynamic> msg) {
    final channel = _channel;
    if (channel == null) throw StateError('AtomCLI is not connected');
    channel.sink.add(jsonEncode(msg));
  }

  void _send(Map<String, dynamic> msg) {
    final channel = _channel;
    if (channel == null) return;
    channel.sink.add(jsonEncode(msg));
  }

  void _reportError(String message) {
    _lastError = message;
    if (_controller.isClosed) return;
    _controller.add(
      BackendEvent(type: 'connection_error', payload: {'message': message}),
    );
  }

  void _failPendingActions(String message) {
    for (final completer in _pendingActions.values) {
      if (!completer.isCompleted) completer.completeError(StateError(message));
    }
    _pendingActions.clear();
  }

  static Future<void> _cancelSubscription(
    StreamSubscription<dynamic>? subscription,
  ) async {
    if (subscription == null) return;
    try {
      await subscription.cancel().timeout(_closeTimeout);
    } catch (_) {
      // A broken transport must not block endpoint fallback or manual retry.
    }
  }

  static Future<void> _closeChannel(WebSocketChannel? channel) async {
    if (channel == null) return;
    try {
      await channel.sink.close(status.normalClosure).timeout(_closeTimeout);
    } catch (_) {
      // The channel may never finish opening after DNS or routing failure.
    }
  }

  static Future<void> _shutdownTransport(
    WebSocketChannel? channel,
    StreamSubscription<dynamic>? subscription,
  ) async {
    // Start the WebSocket close handshake while the stream is still attached.
    // Cancelling first can detach the adapter before its close frame reaches
    // the peer, leaving the TCP connection alive across foreground handoffs.
    await _closeChannel(channel);
    await _cancelSubscription(subscription);
  }

  static String _uuidV4() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes
        .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-'
        '${hex.substring(20)}';
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _attempt++;
    _retryTimer?.cancel();
    _heartbeatTimer?.cancel();
    _authTimer?.cancel();
    _failPendingActions('Connection disposed');
    for (final waiter in _connectionWaiters.toList()) {
      if (!waiter.isCompleted) {
        waiter.completeError(StateError('Connection disposed'));
      }
    }
    _connectionWaiters.clear();
    final oldSubscription = _subscription;
    final oldChannel = _channel;
    _subscription = null;
    _channel = null;
    await _shutdownTransport(oldChannel, oldSubscription);
    await _sequenceWrite;
    await _controller.close();
  }
}
