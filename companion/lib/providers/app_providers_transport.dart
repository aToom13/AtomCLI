part of 'app_providers.dart';

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/// WebSocket service — initialized after pairing or loaded from disk on startup.
/// Use StateProvider so it can be updated imperatively after QR scan.
final wsServiceProvider = StateProvider<WebSocketService?>((ref) {
  final eps = AuthService.instance.endpoints;
  if (eps.isNotEmpty) {
    return WebSocketService(
      endpoints: eps,
      initialSequence: AuthService.instance.lastSequence,
      onSequenceChange: AuthService.instance.recordSequence,
      onStateChange: (lifecycle) {
        final mapped = switch (lifecycle) {
          WsLifecycle.connecting => WsConnectionState.connecting,
          WsLifecycle.connected => WsConnectionState.connected,
          WsLifecycle.disconnected => WsConnectionState.disconnected,
        };
        // Use Future.microtask to avoid modifying state during provider build
        Future.microtask(() {
          try {
            ref.read(connectionStateProvider.notifier).state = mapped;
          } catch (_) {
            /* ref may be disposed */
          }
        });
      },
      onConnectionChange: (status) {
        Future.microtask(() {
          try {
            ref.read(connectionDetailProvider.notifier).state = status;
            ref.read(connectionMessageProvider.notifier).state =
                connectionStatusMessage(status);
          } catch (_) {
            /* ref may be disposed */
          }
        });
      },
    );
  }
  return null;
});

/// Stream of raw backend events.
final backendEventStreamProvider = StreamProvider<BackendEvent>((ref) {
  final ws = ref.watch(wsServiceProvider);
  if (ws == null) return const Stream.empty();
  ref.onDispose(() {
    ws.dispose();
  });
  return _cachedThenLiveEvents(ws);
});

Stream<BackendEvent> _cachedThenLiveEvents(WebSocketService ws) async* {
  final profileId = AuthService.instance.activeProfileId;
  if (profileId != null) {
    try {
      final cached = await LocalCacheDatabase.instance.loadEvents(profileId);
      for (final event in cached) {
        yield BackendEvent(
          type: event.type,
          payload: {
            ...event.payload,
            '_offline_cache': true,
            '_cached_at': event.cachedAt.toIso8601String(),
          },
        );
      }
    } catch (_) {
      // A corrupt/unavailable cache must not prevent a live connection.
    }
  }
  yield* ws.connect();
}



final connectionStateProvider = StateProvider<WsConnectionState>(
  (_) => AuthService.instance.endpoints.isEmpty
      ? WsConnectionState.disconnected
      : WsConnectionState.connecting,
);

final connectionMessageProvider = StateProvider<String?>((_) => null);
final connectionDetailProvider = StateProvider<ConnectionStatus>(
  (_) => const ConnectionStatus(phase: ConnectionPhase.idle),
);

String? connectionStatusMessage(ConnectionStatus status) {
  return switch (status.phase) {
    ConnectionPhase.idle => null,
    ConnectionPhase.discovering => 'Checking LAN and Tailscale endpoints.',
    ConnectionPhase.connecting =>
      status.endpoint == null
          ? 'Opening a secure command link.'
          : 'Connecting through ${status.endpoint}.',
    ConnectionPhase.authenticating => 'Authenticating this device.',
    ConnectionPhase.synchronizing => 'Synchronizing current machine state.',
    ConnectionPhase.connected => null,
    ConnectionPhase.retryWaiting =>
      status.reason ?? 'Connection interrupted; waiting to retry.',
    ConnectionPhase.suspended => 'Connection handed to the background service.',
    ConnectionPhase.incompatible =>
      status.reason ?? 'This AtomCLI protocol is not supported.',
    ConnectionPhase.stopped => status.reason,
  };
}

// ---------------------------------------------------------------------------
// Event dispatcher — wire the WS stream to state notifiers
// ---------------------------------------------------------------------------

/// Listen to backend events and dispatch to the correct notifiers.
/// Call this once after pairing in your root widget.
void dispatchBackendEvents(Ref ref) {
  final pendingMessageParts = <Map<String, dynamic>>[];
  Timer? messagePartTimer;

  void flushMessageParts() {
    messagePartTimer?.cancel();
    messagePartTimer = null;
    if (pendingMessageParts.isEmpty) return;
    final batch = List<Map<String, dynamic>>.from(pendingMessageParts);
    pendingMessageParts.clear();
    ref.read(conversationProvider.notifier).applyMessageParts(batch);
  }

  ref.onDispose(() {
    messagePartTimer?.cancel();
    pendingMessageParts.clear();
  });
  ref.listen<AsyncValue<BackendEvent>>(backendEventStreamProvider, (_, next) {
    next.whenData((event) {
      switch (event.type) {
        case 'snapshot':
          // Snapshots are authoritative. Replace state so items resolved while
          // the phone was offline cannot survive as stale cards.
          final dag = event.payload['dag'] as List? ?? [];
          ref
              .read(dagProvider.notifier)
              .setFromSnapshot(
                dag
                    .map(
                      (step) => DagStep.fromJson(step as Map<String, dynamic>),
                    )
                    .toList(),
              );
          final previousRequestIds = {
            ...ref.read(permissionsProvider).map((item) => item.reqId),
            ...ref.read(questionsProvider).map((item) => item.reqId),
          };
          final perms = event.payload['pending_permissions'] as List? ?? [];
          final pendingPermissions = perms
              .map(
                (perm) =>
                    PendingPermission.fromJson(perm as Map<String, dynamic>),
              )
              .toList();
          ref
              .read(permissionsProvider.notifier)
              .setFromSnapshot(pendingPermissions);
          final rawRouteProposals =
              event.payload['route_proposals'] as List? ?? [];
          ref
              .read(routeProposalsProvider.notifier)
              .setFromSnapshot(
                rawRouteProposals
                    .whereType<Map>()
                    .map(
                      (item) => RouteProposal.fromJson(
                        Map<String, dynamic>.from(item),
                      ),
                    )
                    .where(
                      (item) =>
                          item.expiresAt >
                          DateTime.now().millisecondsSinceEpoch,
                    )
                    .toList(),
              );
          final rawRoutes = event.payload['active_routes'] as List? ?? [];
          ref.read(activeRoutesProvider.notifier).state = {
            for (final item in rawRoutes.whereType<Map>())
              if (item['executionID'] is String)
                item['executionID'] as String: Map<String, dynamic>.from(item),
          };
          final rawSubAgents = event.payload['sub_agents'] as List? ?? [];
          ref
              .read(subAgentProvider.notifier)
              .setFromSnapshot(
                rawSubAgents
                    .map(
                      (sa) => SubAgentInfo.fromJson(sa as Map<String, dynamic>),
                    )
                    .toList(),
              );
          final offlineCache = event.payload['_offline_cache'] == true;
          if (offlineCache) {
            ref.read(connectionStateProvider.notifier).state =
                WsConnectionState.disconnected;
            ref.read(connectionMessageProvider.notifier).state =
                'Showing encrypted cached state while reconnecting.';
          } else {
            ref.read(connectionStateProvider.notifier).state =
                WsConnectionState.connected;
            ref.read(connectionMessageProvider.notifier).state = null;
          }
          final rawQuestions =
              event.payload['pending_questions'] as List? ?? [];
          final pendingQuestions = rawQuestions
              .map((q) => PendingQuestion.fromJson(q as Map<String, dynamic>))
              .toList();
          ref
              .read(questionsProvider.notifier)
              .setFromSnapshot(pendingQuestions);
          if (!offlineCache) {
            final currentRequestIds = {
              ...pendingPermissions.map((item) => item.reqId),
              ...pendingQuestions.map((item) => item.reqId),
            };
            // The OS may still show a notification whose resolution event was
            // missed while switching socket ownership. The live snapshot is
            // authoritative; cached snapshots intentionally do not cancel it.
            for (final requestId in previousRequestIds.difference(
              currentRequestIds,
            )) {
              unawaited(NotificationService.instance.cancelRequest(requestId));
            }
          }
          final rawArtifacts = event.payload['artifacts'] as List? ?? [];
          ref
              .read(artifactsProvider.notifier)
              .setFromSnapshot(
                rawArtifacts
                    .whereType<Map>()
                    .map(
                      (item) => CompanionArtifact.fromJson(
                        Map<String, dynamic>.from(item),
                      ),
                    )
                    .toList(),
              );
          final rawPreviews = event.payload['previews'] as List? ?? [];
          ref
              .read(previewsProvider.notifier)
              .setFromSnapshot(
                rawPreviews
                    .whereType<Map>()
                    .map(
                      (item) => CompanionPreview.fromJson(
                        Map<String, dynamic>.from(item),
                      ),
                    )
                    .toList(),
              );
          final rawCheckpoints =
              event.payload['recent_checkpoints'] as List? ?? const [];
          final checkpointParts = rawCheckpoints
              .whereType<Map>()
              .map((item) => item['part'])
              .whereType<Map>()
              .map((part) => {'part': Map<String, dynamic>.from(part)})
              .toList();
          if (checkpointParts.isNotEmpty) {
            ref
                .read(conversationProvider.notifier)
                .applyMessageParts(checkpointParts);
          }

        case 'event':
          // topic is a top-level field in BridgeEvent, NOT nested inside payload
          final topic = event.topic ?? event.payload['topic'] as String? ?? '';
          if (topic.startsWith('tui.chain')) {
            _handleDag(ref, topic, event.payload);
          }

        case 'session_list':
          final sessionsRaw = event.payload['sessions'] as List? ?? [];
          final sessions = sessionsRaw
              .map((s) => SessionInfo.fromJson(s as Map<String, dynamic>))
              .toList();
          ref.read(sessionListProvider.notifier).setSessions(sessions);
          final currentDirectory =
              event.payload['current_directory'] as String?;
          if (currentDirectory != null) {
            ref.read(currentDirectoryProvider.notifier).state =
                currentDirectory;
            if (CompanionPreferences.instance.lastDirectory == null) {
              ref
                  .read(conversationProvider.notifier)
                  .setDirectory(currentDirectory);
            }
          }
          unawaited(
            ref.read(conversationProvider.notifier).syncSessions(sessions),
          );

        case 'models_list':
          final modelsRaw = event.payload['models'] as List? ?? [];
          final models = modelsRaw
              .map((m) => ModelInfo.fromJson(m as Map<String, dynamic>))
              .toList();
          ref.read(modelsListProvider.notifier).setModels(models);
          // Pre-select the server's configured default model
          final defaultModel = event.payload['default_model'] as String?;
          if (defaultModel != null && defaultModel.isNotEmpty) {
            ref.read(defaultModelProvider.notifier).state = defaultModel;
          } else if (models.isNotEmpty) {
            // Fallback: pick first model if server didn't specify
            ref.read(defaultModelProvider.notifier).state = models.first.id;
          }
          ref
              .read(conversationProvider.notifier)
              .syncModels(models, defaultModel);

        case 'agents_list':
          final agentsRaw = event.payload['agents'] as List? ?? [];
          final agents = agentsRaw
              .map((a) => AgentInfo.fromJson(a as Map<String, dynamic>))
              .where(
                (a) =>
                    a.hidden != true &&
                    (a.mode == 'primary' || a.mode == 'all'),
              )
              .toList();
          ref.read(agentsListProvider.notifier).setAgents(agents);
          ref.read(conversationProvider.notifier).syncAgents(agents);

        case 'session_created':
          final newSessionId = event.payload['session_id'] as String?;
          final sessionTitle =
              event.payload['session_title'] as String? ?? 'New session';
          if (newSessionId != null) {
            ref
                .read(conversationProvider.notifier)
                .addCreatedSession(
                  sessionId: newSessionId,
                  initialText: event.payload['initial_text'] as String?,
                  directory: event.payload['directory'] as String?,
                );
            ref
                .read(logsProvider.notifier)
                .add(
                  LogEntry(
                    id: DateTime.now().millisecondsSinceEpoch.toString(),
                    sessionId: newSessionId,
                    role: 'system',
                    message: 'New session started ($newSessionId)',
                    timestamp: DateTime.now(),
                  ),
                );
            ref
                .read(sessionListProvider.notifier)
                .addOrUpdate(
                  SessionInfo(
                    id: newSessionId,
                    title: sessionTitle,
                    updated: DateTime.now().millisecondsSinceEpoch,
                    directory: event.payload['directory'] as String? ?? '',
                    status: 'busy',
                  ),
                );

            final initialText = event.payload['initial_text'] as String?;
            if (initialText != null && initialText.isNotEmpty) {
              ref
                  .read(logsProvider.notifier)
                  .add(
                    LogEntry(
                      id: "${DateTime.now().millisecondsSinceEpoch}_m",
                      sessionId: newSessionId,
                      role: 'user',
                      message: initialText,
                      timestamp: DateTime.now(),
                    ),
                  );
            }
          }

        case 'session_created_event':
        case 'session_updated':
          final rawInfo = event.payload['info'];
          if (rawInfo is Map) {
            final info = Map<String, dynamic>.from(rawInfo);
            final id = info['id'] as String?;
            if (id != null) {
              ref
                  .read(sessionListProvider.notifier)
                  .addOrUpdate(SessionInfo.fromJson(info));
            }
          }

        case 'session_deleted':
          final rawDeleted = event.payload['info'];
          final deletedId = rawDeleted is Map
              ? rawDeleted['id'] as String?
              : event.payload['sessionID'] as String?;
          if (deletedId != null) {
            ref.read(sessionListProvider.notifier).remove(deletedId);
            ref.read(conversationProvider.notifier).removeSession(deletedId);
          }

        case 'chat_message':
          ref.read(logsProvider.notifier).add(LogEntry.fromJson(event.payload));

        case 'messages_result':
          flushMessageParts();
          final sessionId = event.payload['session_id'] as String?;
          if (sessionId == null) break;
          final rawMessages = event.payload['messages'] as List? ?? const [];
          final messages = rawMessages
              .whereType<Map>()
              .map(
                (message) => ConversationMessage.fromJson(
                  Map<String, dynamic>.from(message),
                ),
              )
              .toList();
          ref
              .read(conversationProvider.notifier)
              .setMessages(sessionId, messages);

        case 'message_updated':
          final info = event.payload['info'];
          if (info is Map) {
            final message = ConversationMessage.fromJson(
              Map<String, dynamic>.from(info),
            );
            ref
                .read(conversationProvider.notifier)
                .applyMessageInfo(Map<String, dynamic>.from(info));
            if (message.failure != null) {
              ref
                  .read(promptErrorProvider.notifier)
                  .setError(
                    PromptErrorNotice(
                      sessionId: message.sessionId,
                      modelId: message.modelId,
                      failure: message.failure!,
                    ),
                  );
            }
          }

        case 'message_part':
          pendingMessageParts.add(event.payload);
          messagePartTimer ??= Timer(
            const Duration(milliseconds: 50),
            flushMessageParts,
          );

        case 'message_removed':
          final sessionId = event.payload['sessionID'] as String?;
          final messageId = event.payload['messageID'] as String?;
          if (sessionId != null && messageId != null) {
            ref
                .read(conversationProvider.notifier)
                .removeMessage(sessionId, messageId);
          }

        case 'message_part_removed':
          final sessionId = event.payload['sessionID'] as String?;
          final messageId = event.payload['messageID'] as String?;
          final partId = event.payload['partID'] as String?;
          if (sessionId != null && messageId != null && partId != null) {
            ref
                .read(conversationProvider.notifier)
                .removeMessagePart(sessionId, messageId, partId);
          }

        case 'artifact_shared':
          ref
              .read(artifactsProvider.notifier)
              .upsert(CompanionArtifact.fromJson(event.payload));

        case 'artifact_deleted':
          final id = event.payload['id'] as String?;
          if (id != null) ref.read(artifactsProvider.notifier).remove(id);

        case 'preview_updated':
          ref
              .read(previewsProvider.notifier)
              .upsert(CompanionPreview.fromJson(event.payload));

        case 'session_status':
          final sessionId = event.payload['sessionID'] as String?;
          final status = event.payload['status'];
          if (sessionId != null && status is Map) {
            ref
                .read(sessionListProvider.notifier)
                .updateStatus(sessionId, status['type'] as String? ?? 'idle');
          }

        case 'permission_request':
          final perm = PendingPermission.fromJson(event.payload);
          ref.read(permissionsProvider.notifier).add(perm);
          NotificationService.instance.showPermissionRequest(
            reqId: perm.reqId,
            permission: perm.permission,
            patterns: perm.patterns,
            sessionId: perm.sessionId,
            directory: perm.directory,
          );

        case 'permission_resolved':
          unawaited(
            NotificationService.instance.cancelRequest(
              event.payload['requestID'] as String,
            ),
          );
          ref
              .read(permissionsProvider.notifier)
              .remove(event.payload['requestID'] as String);

        case 'route_proposal':
          final raw = event.payload['proposal'];
          if (raw is Map) {
            final proposal = RouteProposal.fromJson({
              ...Map<String, dynamic>.from(raw),
              'sessionID': event.payload['sessionID'],
              'directory': event.payload['directory'],
            });
            if (['pending', 'accepted'].contains(raw['state']) &&
                proposal.expiresAt > DateTime.now().millisecondsSinceEpoch) {
              ref.read(routeProposalsProvider.notifier).upsert(proposal);
            } else {
              ref.read(routeProposalsProvider.notifier).remove(proposal.id);
            }
          }

        case 'route_changed':
          final executionId = event.payload['executionID'] as String?;
          if (executionId != null) {
            ref.read(activeRoutesProvider.notifier).state = {
              ...ref.read(activeRoutesProvider),
              executionId: Map<String, dynamic>.from(event.payload),
            };
          }

        case 'sub_agent_started':
          final sa = SubAgentInfo.fromJson(
            Map<String, dynamic>.from(event.payload),
          );
          ref.read(subAgentProvider.notifier).addOrUpdate(sa);

        case 'sub_agent_done':
          final sid = event.payload['sessionID'] as String?;
          if (sid != null) ref.read(subAgentProvider.notifier).markDone(sid);

        case 'sub_agent_activity':
          final sid = event.payload['sessionID'] as String?;
          if (sid != null) {
            ref
                .read(subAgentProvider.notifier)
                .addActivity(sid, SubAgentActivity.fromJson(event.payload));
          }

        case 'sub_agent_failed':
          final sid = event.payload['sessionID'] as String?;
          if (sid != null) ref.read(subAgentProvider.notifier).markFailed(sid);

        case 'sub_agent_removed':
          final sid = event.payload['sessionID'] as String?;
          if (sid != null) {
            ref.read(subAgentProvider.notifier).removeBySessionId(sid);
          }

        case 'question_request':
          final q = PendingQuestion.fromJson(event.payload);
          ref.read(questionsProvider.notifier).add(q);
          NotificationService.instance.showQuestionRequest(q);

        case 'question_resolved':
          final resolvedQuestionId =
              event.payload['requestID'] as String? ?? '';
          if (resolvedQuestionId.isNotEmpty) {
            unawaited(
              NotificationService.instance.cancelRequest(resolvedQuestionId),
            );
          }
          ref.read(questionsProvider.notifier).remove(resolvedQuestionId);

        case 'prompt_error':
          final sessionId = event.payload['session_id'] as String?;
          final selected = ref.read(conversationProvider);
          ref
              .read(promptErrorProvider.notifier)
              .setError(
                PromptErrorNotice(
                  sessionId: sessionId,
                  modelId: sessionId == selected.selectedSessionId
                      ? selected.selectedModelId
                      : null,
                  failure: ConversationFailure.fromJson({
                    'name': 'PromptError',
                    'data': {
                      'message':
                          event.payload['message'] as String? ??
                          'Unknown error from server',
                      if (event.payload['status_code'] is num)
                        'statusCode': event.payload['status_code'],
                      'isRetryable':
                          event.payload['is_rate_limit'] as bool? ?? false,
                    },
                  }),
                ),
              );

        case 'connection_error':
        case 'protocol_error':
        case 'resync_required':
          ref.read(connectionMessageProvider.notifier).state =
              event.payload['message'] as String? ??
              (event.type == 'resync_required'
                  ? 'Refreshing state after an event cursor mismatch.'
                  : null) ??
              event.payload['error'] as String? ??
              'Connection error';
      }
    });
  });
}

final backendSyncProvider = Provider<void>((ref) {
  dispatchBackendEvents(ref);
});

String _cleanError(Object error) => error.toString().replaceFirst(
  RegExp(r'^(Bad state|TimeoutException):\s*'),
  '',
);

void _handleDag(Ref ref, String topic, Map<String, dynamic> p) {
  final dag = ref.read(dagProvider.notifier);
  final sessionId = p['sessionID'] as String?;
  final directory = p['directory'] as String?;
  final workflowId = p['workflowId'] as String?;

  switch (topic) {
    case 'tui.chain.add_step':
      dag.upsert(DagStep.fromJson(p));

    case 'tui.chain.update_step':
      final status = p['status'] as String? ?? '';
      final name = p['name'] as String?;
      if (name != null && name.isNotEmpty) {
        dag.updateStatus(
          name,
          status,
          sessionId: sessionId,
          directory: directory,
          workflowId: workflowId,
        );
      } else {
        dag.updateBySessionId(
          sessionId,
          status,
          directory: directory,
          workflowId: workflowId,
        );
      }

    case 'tui.chain.complete_step':
      dag.updateBySessionId(
        sessionId,
        'complete',
        directory: directory,
        workflowId: workflowId,
      );

    case 'tui.chain.fail_step':
      dag.updateBySessionId(
        sessionId,
        'failed',
        directory: directory,
        workflowId: workflowId,
      );

    case 'tui.chain.set_todos':
      final rawTodos = p['todos'] as List? ?? [];
      final todos = rawTodos
          .map((t) => TodoItem.fromJson(t as Map<String, dynamic>))
          .toList();
      dag.setTodos(
        sessionId,
        todos,
        directory: directory,
        workflowId: workflowId,
      );

    case 'tui.chain.todo_done':
      final todoIndex = p['todoIndex'] as int? ?? -1;
      dag.markTodoDone(
        sessionId,
        todoIndex,
        directory: directory,
        workflowId: workflowId,
      );

    case 'tui.chain.start':
      dag.clear(
        directory: directory,
        sessionId: sessionId,
        workflowId: workflowId,
      );

    case 'tui.chain.parallel.update':
      final stepIndex = p['stepIndex'] as int? ?? -1;
      final status = p['status'] as String? ?? '';
      dag.updateByIndex(
        stepIndex,
        status,
        directory: directory,
        sessionId: sessionId,
        workflowId: workflowId,
      );

    case 'tui.chain.clear':
      dag.clear(
        directory: directory,
        sessionId: sessionId,
        workflowId: workflowId,
      );
  }
}
