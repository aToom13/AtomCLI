part of 'websocket_service.dart';

extension WebSocketServiceActions on WebSocketService {
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

  Future<ActionResult> decideRoute({
    required RouteProposal proposal,
    required String decision,
    String acceptScope = 'episode',
  }) {
    return _sendSignedAction({
      'type': 'route_decision',
      'session_id': proposal.sessionId,
      'execution_id': proposal.executionId,
      'proposal_id': proposal.id,
      'expected_proposal_version': proposal.version,
      'expected_route_revision': proposal.routeRevision,
      'decision': decision,
      if (decision == 'accept') 'accept_scope': acceptScope,
      if (proposal.directory != null) 'directory': proposal.directory,
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
    final requestId = WebSocketService._uuidV4();
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
        WebSocketService._connectTimeout,
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
}
