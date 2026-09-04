import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:web_socket_channel/status.dart' as status;
import 'package:web_socket_channel/web_socket_channel.dart';

import '../generated/companion_protocol.g.dart';
import '../models.dart';
import 'auth_service.dart';
import 'connection_state_machine.dart';
import 'local_cache_database.dart';
import 'power_policy.dart';
import 'safe_outbox.dart';

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

class WebSocketService {
  static const _connectTimeout = Duration(seconds: 10);
  static const _actionTimeout = Duration(seconds: 12);
  static const _closeTimeout = Duration(seconds: 2);

  final List<String> endpoints;
  final void Function(WsLifecycle)? onStateChange;
  final Future<void> Function(int)? onSequenceChange;
  final void Function(ConnectionStatus)? onConnectionChange;

  WebSocketService({
    required this.endpoints,
    this.onStateChange,
    this.onSequenceChange,
    this.onConnectionChange,
    SafeOutbox? outbox,
    LocalCacheDatabase? cache,
    int initialSequence = 0,
    Duration heartbeatInterval = CompanionPowerPolicy.foregroundHeartbeat,
    Duration heartbeatTimeout = CompanionPowerPolicy.foregroundHeartbeatTimeout,
    Duration retryCap = CompanionPowerPolicy.foregroundRetryCap,
  }) : _outbox = outbox ?? SafeOutbox(),
       _cache = cache ?? LocalCacheDatabase.instance,
       _heartbeatInterval = heartbeatInterval,
       _heartbeatTimeout = heartbeatTimeout,
       _retryCap = retryCap,
       _seqId = initialSequence;

  final StreamController<BackendEvent> _controller =
      StreamController<BackendEvent>.broadcast();
  final Map<String, Completer<ActionResult>> _pendingActions = {};
  final Set<Completer<void>> _connectionWaiters = {};
  final ConnectionStateMachine _stateMachine = ConnectionStateMachine();
  final SafeOutbox _outbox;
  final LocalCacheDatabase _cache;
  final Duration _heartbeatInterval;
  final Duration _heartbeatTimeout;
  final Duration _retryCap;
  final Set<String> _hydratedOutboxMachines = {};

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
  int? _protocolVersion;
  Set<String> _capabilities = const {};
  CompanionPeerIdentity? _peerIdentity;
  Future<void> _sequenceWrite = Future.value();
  Future<void>? _ensureInFlight;
  bool _lanDiscoveryAttempted = false;
  bool _terminalProtocolError = false;
  bool _resyncing = false;
  bool _flushingOutbox = false;

  String? get currentEndpoint => _currentEndpoint;
  String? get lastError => _lastError;
  bool get isConnected => _connectionId != null && !_disposed;
  int? get protocolVersion => _protocolVersion;
  Set<String> get capabilities => Set.unmodifiable(_capabilities);
  CompanionPeerIdentity? get peerIdentity => _peerIdentity;
  ConnectionStatus get connectionStatus => _stateMachine.value;
  List<OutboxEntry> get outboxEntries => _outbox.entries;

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
    _terminalProtocolError = false;
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
    _transition(ConnectionPhase.suspended, reason: 'Foreground handoff');
    onStateChange?.call(WsLifecycle.disconnected);
  }

  Future<void> _prepareConnection() async {
    _transition(ConnectionPhase.discovering, attempt: _attempt);
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
      if (endpoints.isEmpty) {
        const reason = 'No reachable endpoint was provided';
        _transition(ConnectionPhase.retryWaiting, reason: reason);
        _reportError(reason);
      }
      return;
    }

    final attempt = ++_attempt;
    final url = endpoints[_endpointIndex % endpoints.length];
    _transition(ConnectionPhase.connecting, endpoint: url, attempt: attempt);
    onStateChange?.call(WsLifecycle.connecting);
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
        final message = CompanionAuthChallenge.fromJson(json);
        _transition(ConnectionPhase.authenticating, attempt: attempt);
        if (message.protocolVersion < CompanionProtocolVersion.minimum ||
            message.protocolMinimum > CompanionProtocolVersion.current) {
          _terminalProtocolError = true;
          _transition(
            ConnectionPhase.incompatible,
            reason:
                'Unsupported protocol ${message.protocolMinimum}-${message.protocolVersion}',
          );
          _reportError(
            'AtomCLI protocol ${message.protocolMinimum}-${message.protocolVersion} is not supported',
          );
          await _channel?.sink.close(status.unsupportedData);
          return;
        }
        final negotiatedVersion = min(
          CompanionProtocolVersion.current,
          message.protocolVersion,
        );
        _authenticate(
          message.challenge,
          protocolVersion: negotiatedVersion,
          enhancedHandshake: json.containsKey('protocol_version'),
          serverCapabilities: message.capabilities,
        );
        return;
      }
      if (json['type'] == 'auth_ok') {
        final message = CompanionAuthOk.fromJson(json);
        _transition(ConnectionPhase.synchronizing, attempt: attempt);
        _protocolVersion = message.protocolVersion;
        _capabilities = message.capabilities;
        _peerIdentity = message.identity;
        if (message.identity != null) {
          final identity = message.identity!;
          final expected = AuthService.instance.activeProfile;
          final wrongMachine =
              expected != null && expected.machineId != identity.machineId;
          final wrongProject =
              expected?.projectDirectory.isNotEmpty == true &&
              identity.projectDirectory?.isNotEmpty == true &&
              expected!.projectDirectory != identity.projectDirectory;
          if (wrongMachine || wrongProject) {
            _terminalProtocolError = true;
            final reason = wrongMachine
                ? 'This endpoint now belongs to a different machine.'
                : 'This endpoint now belongs to a different project.';
            _transition(ConnectionPhase.stopped, reason: reason);
            _reportError('$reason Scan that AtomCLI process again.');
            await _channel?.sink.close(status.policyViolation);
            return;
          }
          await AuthService.instance.recordPeerIdentity(
            machineId: identity.machineId,
            processId: identity.processId,
            bridgeId: identity.bridgeId,
            machineName: identity.machineName,
            projectDirectory: identity.projectDirectory,
          );
          unawaited(
            _cache
                .saveMachine(
                  profileId:
                      AuthService.instance.activeProfileId ??
                      identity.machineId,
                  machineId: identity.machineId,
                  machineName: identity.machineName,
                  projectDirectory: identity.projectDirectory,
                  processId: identity.processId,
                  bridgeId: identity.bridgeId,
                  bridgeEpoch: message.bridgeEpoch,
                  endpoints: message.endpoints.isEmpty
                      ? endpoints
                      : message.endpoints,
                )
                .catchError((_) {}),
          );
        }
        if (message.bridgeEpoch.isNotEmpty) {
          await AuthService.instance.resetForBridgeEpoch(message.bridgeEpoch);
          _seqId = AuthService.instance.lastSequence;
        }
        final refreshedEndpoints = message.endpoints;
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
        _connectionId = message.connectionId;
        _counter = 0;
        _lastPongAt = DateTime.now();
        onStateChange?.call(WsLifecycle.connected);
        for (final waiter in _connectionWaiters.toList()) {
          if (!waiter.isCompleted) waiter.complete();
        }
        _send({
          'type': 'sync',
          'last_seq_id': _seqId,
          if (AuthService.instance.bridgeEpoch != null)
            'bridge_epoch': AuthService.instance.bridgeEpoch,
          if (AuthService.instance.bridgeEpoch != null)
            'cursor': {
              'bridge_epoch': AuthService.instance.bridgeEpoch,
              'seq_id': _seqId,
            },
        });
        _transition(ConnectionPhase.connected, attempt: attempt);
        _startHeartbeat(attempt);
        unawaited(_flushOutbox());
        return;
      }
      if (json['type'] == 'pong') {
        _lastPongAt = DateTime.now();
        return;
      }

      final event = BackendEvent.fromJson(json);
      if (event.type == 'resync_required') {
        _resyncing = true;
        final snapshotFollows = event.payload['snapshot_follows'] == true;
        if (!snapshotFollows) _send({'type': 'request_snapshot'});
        _controller.add(event);
        return;
      }
      if (event.type == 'snapshot') {
        final cursor = event.payload['cursor'];
        final snapshotEpoch = cursor is Map
            ? cursor['bridge_epoch'] as String?
            : event.payload['bridge_epoch'] as String?;
        if (snapshotEpoch != null && snapshotEpoch.isNotEmpty) {
          await AuthService.instance.resetForBridgeEpoch(snapshotEpoch);
        }
        final current = cursor is Map
            ? cursor['seq_id']
            : event.payload['current_seq_id'];
        if (current is int) _synchronizeSequence(current);
        _resyncing = false;
      } else if (event.seqId != null) {
        final expectedEpoch = AuthService.instance.bridgeEpoch;
        if ((event.bridgeEpoch != null &&
                expectedEpoch != null &&
                event.bridgeEpoch != expectedEpoch) ||
            event.seqId! > _seqId + 1) {
          if (!_resyncing) {
            _resyncing = true;
            _send({'type': 'request_snapshot'});
            _controller.add(
              BackendEvent(
                type: 'resync_required',
                bridgeEpoch: event.bridgeEpoch,
                payload: const {
                  'reason': 'event_cursor_gap',
                  'message': 'Live event gap detected; refreshing state.',
                },
              ),
            );
          }
          return;
        }
        if (_resyncing || event.seqId! <= _seqId) return;
        _recordSequence(event.seqId!);
      }
      final machineId = _peerIdentity?.machineId;
      if (machineId != null &&
          (event.type == 'snapshot' || event.type == 'session_list')) {
        final profileId = AuthService.instance.activeProfileId ?? machineId;
        unawaited(
          _cache
              .saveEvent(
                profileId: profileId,
                machineId: machineId,
                type: event.type,
                payload: event.payload,
              )
              .catchError((_) {}),
        );
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
    _protocolVersion = null;
    _capabilities = const {};
    _peerIdentity = null;
    _resyncing = false;
    _counter = 0;
    _lastError = reason;
    _endpointIndex++;
    _retryCount++;
    _failPendingActions('Connection lost');
    onStateChange?.call(WsLifecycle.disconnected);
    _reportError(reason);

    if (_terminalProtocolError) return;

    final jitterWindow = max(1, _retryCap.inSeconds * 200);
    final delay = CompanionPowerPolicy.retryDelay(
      _retryCount,
      cap: _retryCap,
      jitterMilliseconds: Random.secure().nextInt(jitterWindow),
    );
    _transition(
      ConnectionPhase.retryWaiting,
      attempt: attempt,
      reason: reason,
      retryAt: DateTime.now().add(delay),
    );
    _retryTimer = Timer(delay, _tryConnect);
  }

  void _transition(
    ConnectionPhase phase, {
    String? endpoint,
    int? attempt,
    String? reason,
    DateTime? retryAt,
  }) {
    final value = _stateMachine.transition(
      phase,
      endpoint: endpoint,
      attempt: attempt,
      reason: reason,
      retryAt: retryAt,
    );
    onConnectionChange?.call(value);
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
  }) async {
    final payload = <String, dynamic>{
      'type': 'chat_message',
      'session_id': sessionId,
      'text': text,
      if (attachments.isNotEmpty) 'attachments': attachments,
      if (model != null && model.isNotEmpty) 'model': model,
      if (agent != null && agent.isNotEmpty) 'agent': agent,
      if (variant != null && variant.isNotEmpty) 'variant': variant,
      if (directory != null && directory.isNotEmpty) 'directory': directory,
    };
    if (!isConnected) {
      final entry = _outbox.enqueueChat(
        targetMachineId: AuthService.instance.machineId ?? '',
        targetProfileId: AuthService.instance.activeProfileId ?? '',
        targetBridgeEpoch: AuthService.instance.bridgeEpoch,
        payload: payload,
      );
      await _cache.saveOutboxEntry(entry);
      return ActionResult(
        action: 'chat_message',
        status: 'queued',
        id: entry.idempotencyKey,
        payload: {'status': 'queued', 'outbox_id': entry.idempotencyKey},
      );
    }
    return _sendSignedAction(payload);
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

  Future<ActionResult> pauseSession({
    required String sessionId,
    String? directory,
  }) {
    return _sendSignedAction({
      'type': 'pause_session',
      'session_id': sessionId,
      if (directory != null && directory.isNotEmpty) 'directory': directory,
    });
  }

  Future<ActionResult> deleteSession({
    required String sessionId,
    String? directory,
  }) {
    return _sendSignedAction({
      'type': 'delete_session',
      'session_id': sessionId,
      if (directory != null && directory.isNotEmpty) 'directory': directory,
    });
  }

  Future<ActionResult> createUpload({
    required String sessionId,
    required String filename,
    required String mime,
    required int size,
    String? sha256,
    String? directory,
    String? model,
    String? agent,
    String? variant,
  }) {
    return _sendRecoverableSignedAction({
      'type': 'create_upload',
      'session_id': sessionId,
      'filename': filename,
      'mime': mime,
      'size': size,
      if (sha256 != null && sha256.isNotEmpty) 'sha256': sha256,
      if (model != null && model.isNotEmpty) 'model': model,
      if (agent != null && agent.isNotEmpty) 'agent': agent,
      if (variant != null && variant.isNotEmpty) 'variant': variant,
      if (directory != null && directory.isNotEmpty) 'directory': directory,
    });
  }

  /// Transfer tickets are safe to retry because the server caches action
  /// results by device and client request ID. This specifically covers the
  /// short foreground/background handoff window after Android's file picker:
  /// the first request may have succeeded even if its acknowledgement arrived
  /// on a socket that was being replaced.
  Future<ActionResult> _sendRecoverableSignedAction(
    Map<String, dynamic> message,
  ) async {
    final requestId = _uuidV4();
    try {
      return await _sendSignedAction(message, requestId: requestId);
    } on TimeoutException {
      await _forceRestoreConnection();
      return _sendSignedAction(message, requestId: requestId);
    } on StateError {
      await _forceRestoreConnection();
      return _sendSignedAction(message, requestId: requestId);
    }
  }

  Future<void> _forceRestoreConnection() async {
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

  Future<ActionResult> deleteArtifact({
    required String artifactId,
    String? directory,
  }) {
    return _sendSignedAction({
      'type': 'artifact_delete',
      'artifact_id': artifactId,
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

  Future<ActionResult> previewAccess({
    required String previewId,
    String? directory,
  }) {
    return _sendSignedAction({
      'type': 'preview_access',
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

  void _authenticate(
    String challenge, {
    required int protocolVersion,
    required bool enhancedHandshake,
    required Set<String> serverCapabilities,
  }) {
    final auth = AuthService.instance;
    final payload = <String, dynamic>{
      'type': 'authenticate',
      'challenge': challenge,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
      'device_name': auth.deviceName ?? '',
      if (enhancedHandshake) 'device_id': auth.deviceId ?? '',
      if (enhancedHandshake) 'protocol_version': protocolVersion,
      if (enhancedHandshake)
        'capabilities':
            CompanionCapability.supported
                .intersection(serverCapabilities)
                .toList()
              ..sort(),
    };
    payload['signature'] = auth.sign(AuthService.canonicalPayload(payload));
    _requireSend(payload);
  }

  Future<ActionResult> _sendSignedAction(
    Map<String, dynamic> message, {
    String? requestId,
  }) {
    final connectionId = _connectionId;
    if (connectionId == null) {
      return Future.error(StateError('AtomCLI is not connected'));
    }

    final actionRequestId = requestId ?? _uuidV4();
    final auth = AuthService.instance;
    final payload = <String, dynamic>{
      ...message,
      'client_request_id': actionRequestId,
      'connection_id': connectionId,
      'counter': ++_counter,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
      'device_name': auth.deviceName ?? '',
      'device_id': auth.deviceId ?? '',
    };
    payload['signature'] = auth.sign(AuthService.canonicalPayload(payload));

    final completer = Completer<ActionResult>();
    _pendingActions[actionRequestId] = completer;
    try {
      _requireSend(payload);
    } catch (error, stackTrace) {
      _pendingActions.remove(actionRequestId);
      completer.completeError(error, stackTrace);
    }

    return completer.future.timeout(
      _actionTimeout,
      onTimeout: () {
        _pendingActions.remove(actionRequestId);
        throw TimeoutException('AtomCLI did not confirm the action');
      },
    );
  }

  Future<void> _flushOutbox() async {
    if (_flushingOutbox || !isConnected) return;
    final machineId = _peerIdentity?.machineId;
    if (machineId == null) return;
    final profileId = AuthService.instance.activeProfileId;
    if (profileId == null) return;
    _flushingOutbox = true;
    try {
      await _hydrateOutbox(profileId);
      final pending = _outbox.pendingFor(
        machineId,
        profileId: profileId,
        currentBridgeEpoch: AuthService.instance.bridgeEpoch,
      );
      await _cache.saveOutboxEntries(_outbox.entries);
      for (final entry in pending) {
        if (!isConnected) break;
        _outbox.markSending(entry.idempotencyKey);
        await _persistOutboxEntry(entry.idempotencyKey);
        try {
          await _sendSignedAction(
            entry.payload,
            requestId: entry.idempotencyKey,
          );
          _outbox.markAcknowledged(entry.idempotencyKey);
          await _persistOutboxEntry(entry.idempotencyKey);
        } catch (error) {
          _outbox.markQueued(entry.idempotencyKey, error.toString());
          await _persistOutboxEntry(entry.idempotencyKey);
          break;
        }
      }
    } finally {
      _flushingOutbox = false;
    }
  }

  Future<void> _hydrateOutbox(String profileId) async {
    if (!_hydratedOutboxMachines.add(profileId)) return;
    try {
      _outbox.restore(await _cache.loadOutbox(profileId));
    } catch (_) {
      _hydratedOutboxMachines.remove(profileId);
    }
  }

  Future<void> _persistOutboxEntry(String key) async {
    final entry = _outbox.entryFor(key);
    if (entry != null) await _cache.saveOutboxEntry(entry);
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
    _transition(ConnectionPhase.stopped, reason: 'Disposed');
    await _controller.close();
  }
}
