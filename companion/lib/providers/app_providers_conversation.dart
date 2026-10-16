part of 'app_providers.dart';

class ConversationState {
  final String? selectedSessionId;
  final String? selectedModelId;
  final String? selectedAgentName;
  final String? selectedVariant;
  final String? selectedDirectory;
  final Map<String, List<ConversationMessage>> messages;
  final Set<String> loadingSessionIds;

  const ConversationState({
    this.selectedSessionId,
    this.selectedModelId,
    this.selectedAgentName,
    this.selectedVariant,
    this.selectedDirectory,
    this.messages = const {},
    this.loadingSessionIds = const {},
  });

  List<ConversationMessage> messagesFor(String? sessionId) =>
      sessionId == null ? const [] : messages[sessionId] ?? const [];

  ConversationState copyWith({
    String? selectedSessionId,
    bool clearSelectedSession = false,
    String? selectedModelId,
    String? selectedAgentName,
    String? selectedVariant,
    bool clearSelectedVariant = false,
    String? selectedDirectory,
    Map<String, List<ConversationMessage>>? messages,
    Set<String>? loadingSessionIds,
  }) {
    return ConversationState(
      selectedSessionId: clearSelectedSession
          ? null
          : selectedSessionId ?? this.selectedSessionId,
      selectedModelId: selectedModelId ?? this.selectedModelId,
      selectedAgentName: selectedAgentName ?? this.selectedAgentName,
      selectedVariant: clearSelectedVariant
          ? null
          : selectedVariant ?? this.selectedVariant,
      selectedDirectory: selectedDirectory ?? this.selectedDirectory,
      messages: messages ?? this.messages,
      loadingSessionIds: loadingSessionIds ?? this.loadingSessionIds,
    );
  }
}

class ConversationNotifier extends Notifier<ConversationState> {
  @override
  ConversationState build() => ConversationState(
    selectedModelId: CompanionPreferences.instance.lastModel,
    selectedAgentName: CompanionPreferences.instance.lastAgent,
    selectedDirectory: CompanionPreferences.instance.lastDirectory,
  );

  void resetForMachine() {
    state = ConversationState(
      selectedModelId: CompanionPreferences.instance.lastModel,
      selectedAgentName: CompanionPreferences.instance.lastAgent,
      selectedDirectory: CompanionPreferences.instance.lastDirectory,
    );
  }

  void removeSession(String sessionId) {
    final messages = {...state.messages}..remove(sessionId);
    final loading = {...state.loadingSessionIds}..remove(sessionId);
    final wasSelected = state.selectedSessionId == sessionId;
    state = state.copyWith(
      clearSelectedSession: wasSelected,
      messages: messages,
      loadingSessionIds: loading,
    );
  }

  Future<void> syncSessions(List<SessionInfo> sessions) async {
    if (sessions.isEmpty) {
      state = state.copyWith(clearSelectedSession: true);
      return;
    }
    final current = state.selectedSessionId;
    if (current != null && sessions.any((session) => session.id == current)) {
      await selectSession(current, reload: true);
      return;
    }
    await selectSession(sessions.first.id, reload: true);
  }

  Future<void> selectSession(String sessionId, {bool reload = false}) async {
    final session = ref
        .read(sessionListProvider)
        .where((candidate) => candidate.id == sessionId)
        .firstOrNull;
    final alreadyLoaded = state.messages.containsKey(sessionId);
    state = state.copyWith(
      selectedSessionId: sessionId,
      selectedDirectory: session?.directory.isNotEmpty == true
          ? session!.directory
          : null,
    );
    if (alreadyLoaded && !reload) return;

    final ws = ref.read(wsServiceProvider);
    if (ws == null || !ws.isConnected) return;
    state = state.copyWith(
      loadingSessionIds: {...state.loadingSessionIds, sessionId},
    );
    try {
      await ws.getMessages(sessionId: sessionId, directory: session?.directory);
    } catch (error) {
      ref.read(connectionMessageProvider.notifier).state = _cleanError(error);
      _finishLoading(sessionId);
    }
  }

  void setModel(String modelId) {
    final models = ref.read(modelsListProvider);
    final model = models.where((item) => item.id == modelId).firstOrNull;
    final savedVariant = CompanionPreferences.instance.modelVariants[modelId];
    state = state.copyWith(
      selectedModelId: modelId,
      selectedVariant: model?.variants.contains(savedVariant) == true
          ? savedVariant
          : null,
      clearSelectedVariant:
          model == null || model.variants.contains(savedVariant) != true,
    );
    CompanionPreferences.instance.selectModel(modelId);
  }

  void setVariant(String? variant) {
    final modelId = state.selectedModelId;
    if (modelId == null) return;
    state = state.copyWith(
      selectedVariant: variant,
      clearSelectedVariant: variant == null,
    );
    CompanionPreferences.instance.selectVariant(modelId, variant);
  }

  void setDirectory(String directory) {
    state = state.copyWith(selectedDirectory: directory);
    CompanionPreferences.instance.selectDirectory(directory);
  }

  void syncModels(List<ModelInfo> models, String? defaultModel) {
    if (models.isEmpty) return;
    final selected = state.selectedModelId;
    if (selected != null && models.any((model) => model.id == selected)) return;
    final saved = CompanionPreferences.instance.lastModel;
    final atomAuto = models.where(
      (model) => model.id == 'atomcli/atomcli-auto',
    );
    final resolvedDefault = models.any((model) => model.id == saved)
        ? saved
        : models.any((model) => model.id == defaultModel)
        ? defaultModel
        : atomAuto.isNotEmpty
        ? atomAuto.first.id
        : models.first.id;
    if (resolvedDefault != null) setModel(resolvedDefault);
  }

  void setAgent(String agentName) {
    state = state.copyWith(selectedAgentName: agentName);
    CompanionPreferences.instance.selectAgent(agentName);
  }

  void syncAgents(List<AgentInfo> agents) {
    if (agents.isEmpty) return;
    final selected = state.selectedAgentName;
    if (selected != null && agents.any((agent) => agent.name == selected)) {
      return;
    }
    final primary = agents.where((agent) => agent.name == 'agent');
    state = state.copyWith(
      selectedAgentName: primary.isNotEmpty
          ? primary.first.name
          : agents.first.name,
    );
  }

  void setMessages(String sessionId, List<ConversationMessage> messages) {
    var next = state.copyWith(
      messages: {...state.messages, sessionId: messages},
      loadingSessionIds: {...state.loadingSessionIds}..remove(sessionId),
    );
    if (sessionId == state.selectedSessionId) {
      final users = messages
          .where((message) => message.role == 'user')
          .toList();
      final last = users.isEmpty ? null : users.last;
      if (last?.modelId != null) {
        next = next.copyWith(
          selectedModelId: last!.modelId,
          selectedAgentName: last.agent,
          selectedVariant: last.variant,
          clearSelectedVariant: last.variant == null,
        );
        CompanionPreferences.instance.selectModel(last.modelId!);
        if (last.agent != null) {
          CompanionPreferences.instance.selectAgent(last.agent!);
        }
        CompanionPreferences.instance.selectVariant(
          last.modelId!,
          last.variant,
        );
      }
    }
    state = next;
  }

  void addCreatedSession({
    required String sessionId,
    required String? initialText,
    String? directory,
  }) {
    final messages = <ConversationMessage>[];
    if (initialText != null && initialText.trim().isNotEmpty) {
      messages.add(_optimisticMessage(sessionId, initialText));
    }
    state = state.copyWith(
      selectedSessionId: sessionId,
      messages: {...state.messages, sessionId: messages},
      loadingSessionIds: {...state.loadingSessionIds}..remove(sessionId),
      selectedDirectory: directory,
    );
  }

  String addOptimisticUserMessage(String sessionId, String text) {
    final current = state.messagesFor(sessionId);
    final message = _optimisticMessage(sessionId, text);
    state = state.copyWith(
      messages: {
        ...state.messages,
        sessionId: [...current, message],
      },
    );
    return message.id;
  }

  void removeMessage(String sessionId, String messageId) {
    state = state.copyWith(
      messages: {
        ...state.messages,
        sessionId: state
            .messagesFor(sessionId)
            .where((message) => message.id != messageId)
            .toList(),
      },
    );
  }

  void applyMessageInfo(Map<String, dynamic> info) {
    final messageId = info['id'] as String?;
    final sessionId = info['sessionID'] as String?;
    if (messageId == null || sessionId == null) return;
    final current = [...state.messagesFor(sessionId)];
    final index = current.indexWhere((message) => message.id == messageId);
    final incoming = ConversationMessage.fromJson(info);
    final role = incoming.role;
    if (index >= 0) {
      current[index] = current[index].copyWith(
        role: role,
        time: incoming.time,
        modelId: incoming.modelId,
        agent: incoming.agent,
        variant: incoming.variant,
        failure: incoming.failure,
      );
    } else {
      final localIndex = role == 'user'
          ? current.lastIndexWhere(
              (message) =>
                  message.role == 'user' && message.id.startsWith('local_'),
            )
          : -1;
      if (localIndex >= 0) {
        current[localIndex] = incoming;
      } else {
        current.add(incoming);
      }
    }
    state = state.copyWith(messages: {...state.messages, sessionId: current});
  }

  void applyMessagePart(Map<String, dynamic> payload) {
    applyMessageParts([payload]);
  }

  void applyMessageParts(Iterable<Map<String, dynamic>> payloads) {
    final messages = {...state.messages};
    var changed = false;
    for (final payload in payloads) {
      final rawPart = payload['part'];
      if (rawPart is! Map) continue;
      final part = ConversationPart.fromJson(
        Map<String, dynamic>.from(rawPart),
      );
      if (part.sessionId.isEmpty || part.messageId.isEmpty) continue;
      final current = <ConversationMessage>[
        ...(messages[part.sessionId] ?? const <ConversationMessage>[]),
      ];
      var messageIndex = current.indexWhere(
        (message) => message.id == part.messageId,
      );
      if (messageIndex < 0) {
        current.add(
          ConversationMessage(
            id: part.messageId,
            sessionId: part.sessionId,
            role: 'assistant',
            time: DateTime.now(),
          ),
        );
        messageIndex = current.length - 1;
      }
      final message = current[messageIndex];
      final parts = [...message.parts];
      var partIndex = part.id.isEmpty
          ? -1
          : parts.indexWhere((candidate) => candidate.id == part.id);
      final incomingCheckpoint = part.checkpoint;
      if (partIndex < 0 &&
          part.type == 'checkpoint' &&
          incomingCheckpoint != null) {
        // Snapshot-synthesized and live checkpoint parts carry different ids;
        // dedupe by sequence so a replayed event cannot duplicate the card.
        partIndex = parts.indexWhere(
          (candidate) =>
              candidate.type == 'checkpoint' &&
              candidate.checkpoint != null &&
              candidate.checkpoint!.sequence == incomingCheckpoint.sequence,
        );
      }
      if (partIndex < 0) {
        parts.add(part);
      } else {
        parts[partIndex] = parts[partIndex].merge(
          part,
          payload['delta'] as String?,
        );
      }
      current[messageIndex] = message.copyWith(parts: parts);
      messages[part.sessionId] = current;
      changed = true;
    }
    if (changed) state = state.copyWith(messages: messages);
  }

  void removeMessagePart(String sessionId, String messageId, String partId) {
    final current = [...state.messagesFor(sessionId)];
    final messageIndex = current.indexWhere(
      (message) => message.id == messageId,
    );
    if (messageIndex < 0) return;
    final message = current[messageIndex];
    final parts = message.parts.where((part) => part.id != partId).toList();
    if (parts.length == message.parts.length) return;
    current[messageIndex] = message.copyWith(parts: parts);
    state = state.copyWith(messages: {...state.messages, sessionId: current});
  }

  void _finishLoading(String sessionId) {
    state = state.copyWith(
      loadingSessionIds: {...state.loadingSessionIds}..remove(sessionId),
    );
  }

  ConversationMessage _optimisticMessage(String sessionId, String text) {
    final id = 'local_${DateTime.now().microsecondsSinceEpoch}';
    return ConversationMessage(
      id: id,
      sessionId: sessionId,
      role: 'user',
      time: DateTime.now(),
      parts: [
        ConversationPart(
          id: '${id}_text',
          messageId: id,
          sessionId: sessionId,
          type: 'text',
          text: text,
        ),
      ],
    );
  }
}

final conversationProvider =
    NotifierProvider<ConversationNotifier, ConversationState>(
      ConversationNotifier.new,
    );

// ---------------------------------------------------------------------------
// Connection State
// ---------------------------------------------------------------------------

enum WsConnectionState { disconnected, connecting, connected }

