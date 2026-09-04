import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:speech_to_text/speech_to_text.dart';

import '../models.dart';
import '../l10n/app_localizations.dart';
import '../providers/app_providers.dart';
import 'image_annotation_screen.dart';
import '../theme/app_theme.dart';
import '../services/companion_preferences.dart';
import '../services/mobile_input_service.dart';
import '../services/transfer_service.dart';
import '../services/websocket_service.dart';
import '../widgets/adaptive_layout.dart';

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key});

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _messageController = TextEditingController();
  final _scrollController = ScrollController();
  bool _sending = false;
  _DeliveryState _deliveryState = _DeliveryState.idle;
  Timer? _deliveryResetTimer;
  bool _creating = false;
  bool _uploading = false;
  double? _uploadProgress;
  TransferCancellation? _uploadCancellation;
  final List<CompanionArtifact> _pendingAttachments = [];
  String? _attachmentSessionId;
  final SpeechToText _speech = SpeechToText();
  bool _listening = false;
  String _speechPrefix = '';
  IncomingShare? _pendingIncomingShare;
  bool _shareDialogOpen = false;
  bool _shareWaitingNoticeShown = false;

  @override
  void dispose() {
    _deliveryResetTimer?.cancel();
    _speech.cancel();
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final sessions = ref.watch(sessionListProvider);
    final conversation = ref.watch(conversationProvider);
    final connection = ref.watch(connectionStateProvider);
    final messages = conversation.messagesFor(conversation.selectedSessionId);
    final subAgents = ref
        .watch(subAgentProvider)
        .where(
          (agent) =>
              agent.parentSessionId == conversation.selectedSessionId &&
              (conversation.selectedDirectory == null ||
                  agent.directory == null ||
                  agent.directory == conversation.selectedDirectory),
        )
        .toList();
    final selectedSession = _findSession(
      sessions,
      conversation.selectedSessionId,
    );
    final loading =
        conversation.selectedSessionId != null &&
        conversation.loadingSessionIds.contains(conversation.selectedSessionId);

    ref.listen<String?>(chatJumpToSessionProvider, (_, sessionId) {
      if (sessionId == null) return;
      ref.read(conversationProvider.notifier).selectSession(sessionId);
      ref.read(chatJumpToSessionProvider.notifier).state = null;
    });
    ref.listen<int>(newSessionRequestProvider, (previous, next) {
      if (previous != null && next > previous) _createSession();
    });
    ref.listen<ConversationState>(conversationProvider, (previous, next) {
      final sessionId = next.selectedSessionId;
      if (sessionId == null) return;
      final before = previous?.messagesFor(sessionId).length ?? 0;
      if (next.messagesFor(sessionId).length != before) _scrollToEnd();
      if (_pendingIncomingShare != null) {
        WidgetsBinding.instance.addPostFrameCallback(
          (_) => _offerIncomingShare(),
        );
      }
    });
    ref.listen<IncomingShare?>(incomingShareProvider, (_, share) {
      if (share == null) return;
      ref.read(incomingShareProvider.notifier).state = null;
      _pendingIncomingShare = share;
      _shareWaitingNoticeShown = false;
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => _offerIncomingShare(),
      );
    });
    ref.listen<PromptErrorNotice?>(promptErrorProvider, (_, notice) {
      if (notice == null) return;
      ref.read(promptErrorProvider.notifier).clear();
      if (notice.sessionId != null &&
          notice.sessionId != conversation.selectedSessionId) {
        return;
      }
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        setState(() => _deliveryState = _DeliveryState.failed);
        _showError(_conversationFailureText(strings, notice.failure));
      });
    });

    return LayoutBuilder(
      builder: (context, constraints) {
        final conversationPane = Column(
          children: [
            _SessionHeader(
              session: selectedSession,
              sessionCount: sessions.length,
              connected: connection == WsConnectionState.connected,
              onTap: () => _showSessions(sessions),
              onRefresh: conversation.selectedSessionId == null
                  ? null
                  : () => ref
                        .read(conversationProvider.notifier)
                        .selectSession(
                          conversation.selectedSessionId!,
                          reload: true,
                        ),
              onStop: selectedSession?.isActive == true
                  ? () => _stopSession(selectedSession!)
                  : null,
            ),
            const _WorkflowStrip(),
            Expanded(
              child: loading && messages.isEmpty
                  ? const Center(
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : messages.isEmpty
                  ? _EmptyConversation(
                      hasSession: conversation.selectedSessionId != null,
                      onCreate: _creating ? null : _createSession,
                      onHistory: () => _showSessions(sessions),
                    )
                  : ListView.builder(
                      key: ValueKey(conversation.selectedSessionId),
                      controller: _scrollController,
                      padding: const EdgeInsets.fromLTRB(13, 10, 13, 20),
                      itemCount: messages.length + (subAgents.isEmpty ? 0 : 1),
                      itemBuilder: (_, index) {
                        if (index == messages.length) {
                          return _SubAgentWorkCard(
                            key: ValueKey(
                              subAgents
                                  .map((agent) => agent.sessionId)
                                  .join(','),
                            ),
                            agents: subAgents,
                          );
                        }
                        return _MessageCard(
                          key: ValueKey(messages[index].id),
                          message: messages[index],
                          onSelectModel: _showModels,
                          hideAgentTool: subAgents.isNotEmpty,
                        );
                      },
                    ),
            ),
            _Composer(
              controller: _messageController,
              sending: _sending,
              deliveryState: _deliveryState,
              uploading: _uploading,
              uploadProgress: _uploading ? _uploadProgress : null,
              onPauseUpload: _uploadCancellation?.cancel,
              attachments: _pendingAttachments,
              onRemoveAttachment: (artifact) {
                setState(() {
                  _pendingAttachments.removeWhere(
                    (candidate) => candidate.id == artifact.id,
                  );
                  if (_pendingAttachments.isEmpty) _attachmentSessionId = null;
                });
              },
              connected: connection == WsConnectionState.connected,
              onSend: _send,
              onAttach: _showAttachmentPicker,
              onSpeech: _toggleDictation,
              listening: _listening,
              onModel: _showModels,
              onAgent: _showAgents,
              onVariant: _showVariants,
            ),
          ],
        );
        return Scaffold(
          appBar: AppBar(
            title: Text(strings.tabSessions),
            actions: [
              IconButton(
                key: const Key('new-session-button'),
                tooltip: strings.newSession,
                onPressed:
                    _creating || connection != WsConnectionState.connected
                    ? null
                    : _createSession,
                icon: _creating
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.add_comment_outlined),
              ),
            ],
          ),
          body: AdaptiveTwoPane(
            compact: conversationPane,
            primary: _WideSessionPane(
              sessions: sessions,
              selectedId: conversation.selectedSessionId,
              connected: connection == WsConnectionState.connected,
              creating: _creating,
              onCreate: _createSession,
              onSelect: (sessionId) => ref
                  .read(conversationProvider.notifier)
                  .selectSession(sessionId),
              onDelete: _confirmDeleteSession,
            ),
            detail: conversationPane,
          ),
        );
      },
    );
  }

  Future<void> _showSessions(List<SessionInfo> sessions) async {
    final selected = await showModalBottomSheet<_SessionPickerResult>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppPalette.panel,
      builder: (_) => _SessionPicker(
        sessions: sessions,
        selectedId: ref.read(conversationProvider).selectedSessionId,
      ),
    );
    if (selected == null) return;
    final delete = selected.delete;
    if (delete != null) {
      await _confirmDeleteSession(delete);
      return;
    }
    if (selected.sessionId != null) {
      await ref
          .read(conversationProvider.notifier)
          .selectSession(selected.sessionId!);
    }
  }

  Future<void> _confirmDeleteSession(SessionInfo session) async {
    final strings = AppLocalizations.of(context);
    if (session.isActive) {
      _showError(strings.activeSessionCannotDelete);
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(strings.deleteSessionQuestion),
        content: Text(strings.deleteSessionExplanation(_sessionTitle(session))),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(strings.cancel),
          ),
          FilledButton(
            key: const Key('confirm-delete-session'),
            onPressed: () => Navigator.pop(dialogContext, true),
            style: FilledButton.styleFrom(backgroundColor: AppPalette.danger),
            child: Text(strings.delete),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      final result = await ref
          .read(wsServiceProvider)
          ?.deleteSession(sessionId: session.id, directory: session.directory);
      if (result == null || !result.isOk) {
        throw StateError(result?.error ?? strings.connectionOffline);
      }
      ref.read(sessionListProvider.notifier).remove(session.id);
      ref.read(conversationProvider.notifier).removeSession(session.id);
      final remaining = ref.read(sessionListProvider);
      if (remaining.isNotEmpty) {
        await ref
            .read(conversationProvider.notifier)
            .selectSession(remaining.first.id);
      }
      if (mounted) _showNotice(strings.sessionDeleted);
    } catch (error) {
      _showError(_errorText(error));
    }
  }

  Future<void> _showModels() async {
    var models = ref.read(modelsListProvider);
    if (models.isEmpty) {
      ref.read(wsServiceProvider)?.getModels();
      await Future<void>.delayed(const Duration(milliseconds: 300));
      models = ref.read(modelsListProvider);
    }
    if (!mounted) return;
    final selected = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppPalette.panel,
      builder: (_) => _ModelPicker(
        models: models,
        selectedId: ref.read(conversationProvider).selectedModelId,
      ),
    );
    if (selected != null) {
      ref.read(conversationProvider.notifier).setModel(selected);
      HapticFeedback.selectionClick();
    }
  }

  Future<void> _showVariants() async {
    final conversation = ref.read(conversationProvider);
    final model = ref
        .read(modelsListProvider)
        .where((item) => item.id == conversation.selectedModelId)
        .firstOrNull;
    if (model == null || model.variants.isEmpty) {
      _showError(AppLocalizations.of(context).thinkingUnavailable);
      return;
    }
    final selected = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppPalette.panel,
      builder: (_) => _VariantPicker(
        variants: model.variants,
        selected: conversation.selectedVariant,
      ),
    );
    if (!mounted || selected == null) return;
    ref
        .read(conversationProvider.notifier)
        .setVariant(selected == '__default__' ? null : selected);
  }

  Future<void> _showAgents() async {
    final agents = ref.read(agentsListProvider);
    final selected = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppPalette.panel,
      builder: (_) => _AgentPicker(
        agents: agents,
        selectedName: ref.read(conversationProvider).selectedAgentName,
      ),
    );
    if (selected != null) {
      ref.read(conversationProvider.notifier).setAgent(selected);
      HapticFeedback.selectionClick();
    }
  }

  Future<void> _createSession() async {
    final ws = ref.read(wsServiceProvider);
    if (ws == null || !ws.isConnected) {
      _showError(AppLocalizations.of(context).connectionOffline);
      return;
    }
    final selection = ref.read(conversationProvider);
    if (_pendingAttachments.isNotEmpty) {
      _showError(
        'Send or remove the staged attachments before creating a new session.',
      );
      return;
    }
    final directory = await _chooseNewSessionDirectory(
      selection.selectedDirectory ?? ref.read(currentDirectoryProvider),
    );
    if (directory == null || !mounted) return;
    setState(() => _creating = true);
    try {
      await ws.createSession(
        model: selection.selectedModelId,
        agent: selection.selectedAgentName,
        variant: selection.selectedVariant,
        directory: directory,
      );
    } catch (error) {
      _showError(_errorText(error));
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  Future<void> _send() async {
    final strings = AppLocalizations.of(context);
    final text = _messageController.text.trim();
    if ((text.isEmpty && _pendingAttachments.isEmpty) ||
        _sending ||
        _uploading) {
      return;
    }
    final ws = ref.read(wsServiceProvider);
    if (ws == null) {
      _showError(AppLocalizations.of(context).pairBeforeSending);
      return;
    }
    final selection = ref.read(conversationProvider);
    if (!ws.isConnected && selection.selectedSessionId == null) {
      _showError(AppLocalizations.of(context).reconnectBeforeSession);
      return;
    }
    if (!ws.isConnected && _pendingAttachments.isNotEmpty) {
      _showError(AppLocalizations.of(context).attachmentsOffline);
      return;
    }
    if (_pendingAttachments.isNotEmpty &&
        selection.selectedSessionId != _attachmentSessionId) {
      _showError(strings.attachmentsWrongSession);
      return;
    }
    var directory = selection.selectedDirectory;
    if (selection.selectedSessionId == null) {
      directory = await _chooseNewSessionDirectory(
        directory ?? ref.read(currentDirectoryProvider),
      );
      if (directory == null || !mounted) return;
    }
    setState(() {
      _deliveryResetTimer?.cancel();
      _sending = true;
      _deliveryState = _DeliveryState.sending;
    });
    ref.read(promptErrorProvider.notifier).clear();
    String? optimisticMessageId;
    final existingSessionId = selection.selectedSessionId;
    if (existingSessionId != null) {
      optimisticMessageId = ref
          .read(conversationProvider.notifier)
          .addOptimisticUserMessage(
            existingSessionId,
            text.isEmpty ? strings.reviewAttachments : text,
          );
      _messageController.clear();
      _scrollToEnd();
    }
    try {
      final attachments = List<CompanionArtifact>.from(_pendingAttachments);
      final sessionId = selection.selectedSessionId;
      if (sessionId == null) {
        final result = await ws.createSession(
          text: text.isEmpty ? strings.reviewAttachments : text,
          model: selection.selectedModelId,
          agent: selection.selectedAgentName,
          variant: selection.selectedVariant,
          directory: directory,
        );
        if (!result.isOk) {
          throw StateError(result.error ?? strings.messageFailed);
        }
        _showAcceptedDelivery();
      } else {
        final result = await ws.sendChatMessage(
          sessionId: sessionId,
          text: text.isEmpty ? strings.reviewAttachments : text,
          model: selection.selectedModelId,
          agent: selection.selectedAgentName,
          variant: selection.selectedVariant,
          directory: selection.selectedDirectory,
          attachments: attachments.map((artifact) => artifact.id).toList(),
        );
        if (result.status == 'queued') {
          if (mounted) setState(() => _deliveryState = _DeliveryState.queued);
          _showNotice(strings.queuedReceipt);
        } else {
          _showAcceptedDelivery();
        }
      }
      if (sessionId == null) _messageController.clear();
      if (mounted) {
        setState(() {
          _pendingAttachments.removeWhere(
            (candidate) =>
                attachments.any((attachment) => attachment.id == candidate.id),
          );
          if (_pendingAttachments.isEmpty) _attachmentSessionId = null;
        });
      }
      _scrollToEnd();
    } catch (error) {
      if (existingSessionId != null && optimisticMessageId != null) {
        ref
            .read(conversationProvider.notifier)
            .removeMessage(existingSessionId, optimisticMessageId);
        if (_messageController.text.isEmpty) {
          _messageController.text = text;
          _messageController.selection = TextSelection.collapsed(
            offset: text.length,
          );
        }
      }
      if (mounted) setState(() => _deliveryState = _DeliveryState.failed);
      _showError(_errorText(error));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _showAcceptedDelivery() {
    if (!mounted) return;
    setState(() => _deliveryState = _DeliveryState.accepted);
    _deliveryResetTimer = Timer(const Duration(seconds: 3), () {
      if (mounted && _deliveryState == _DeliveryState.accepted) {
        setState(() => _deliveryState = _DeliveryState.idle);
      }
    });
  }

  Future<void> _showAttachmentPicker() async {
    final strings = AppLocalizations.of(context);
    final action = await showModalBottomSheet<_MobileInputAction>(
      context: context,
      backgroundColor: AppPalette.panel,
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 18),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const _SheetHandle(),
              const SizedBox(height: 12),
              ListTile(
                leading: Icon(
                  Icons.photo_camera_outlined,
                  color: AppPalette.mint,
                ),
                title: Text(strings.camera),
                subtitle: Text(strings.cameraSubtitle),
                onTap: () =>
                    Navigator.pop(sheetContext, _MobileInputAction.camera),
              ),
              ListTile(
                leading: Icon(Icons.image_outlined, color: AppPalette.primary),
                title: Text(strings.photoOrImage),
                subtitle: Text(strings.photoOrImageSubtitle),
                onTap: () =>
                    Navigator.pop(sheetContext, _MobileInputAction.image),
              ),
              ListTile(
                leading: const Icon(
                  Icons.draw_outlined,
                  color: AppPalette.amber,
                ),
                title: Text(strings.markUpAnImage),
                subtitle: Text(strings.markUpImageSubtitle),
                onTap: () =>
                    Navigator.pop(sheetContext, _MobileInputAction.annotate),
              ),
              ListTile(
                leading: const Icon(
                  Icons.attach_file_rounded,
                  color: AppPalette.amber,
                ),
                title: Text(strings.anyFile),
                subtitle: Text(strings.anyFileSubtitle),
                onTap: () =>
                    Navigator.pop(sheetContext, _MobileInputAction.file),
              ),
            ],
          ),
        ),
      ),
    );
    if (action == null || !mounted) return;
    switch (action) {
      case _MobileInputAction.camera:
        await _captureOrAnnotate(ImageSource.camera);
        break;
      case _MobileInputAction.annotate:
        await _captureOrAnnotate(ImageSource.gallery);
        break;
      case _MobileInputAction.image:
        await _uploadAttachment(imageOnly: true);
        break;
      case _MobileInputAction.file:
        await _uploadAttachment(imageOnly: false);
        break;
    }
  }

  bool _canStageMobileInput() {
    final socket = ref.read(wsServiceProvider);
    final conversation = ref.read(conversationProvider);
    final sessionId = conversation.selectedSessionId;
    if (socket == null || !socket.isConnected) {
      _showError(AppLocalizations.of(context).connectionOffline);
      return false;
    }
    if (sessionId == null) {
      _showError(AppLocalizations.of(context).selectSessionForImage);
      return false;
    }
    if (_uploading || _pendingAttachments.length >= 10) {
      _showError(AppLocalizations.of(context).attachmentLimit);
      return false;
    }
    if (_pendingAttachments.isNotEmpty && sessionId != _attachmentSessionId) {
      _showError(
        'The staged attachments belong to another session. Remove them first.',
      );
      return false;
    }
    return true;
  }

  Future<void> _captureOrAnnotate(ImageSource source) async {
    if (!_canStageMobileInput()) return;
    try {
      final selected = await ImagePicker().pickImage(
        source: source,
        imageQuality: 85,
        maxWidth: 2048,
        maxHeight: 2048,
        requestFullMetadata: false,
      );
      if (selected == null || !mounted) return;
      final annotated = await Navigator.push<AnnotatedImage>(
        context,
        MaterialPageRoute(
          builder: (_) => ImageAnnotationScreen(
            imagePath: selected.path,
            filename: selected.name,
          ),
        ),
      );
      if (annotated == null || !mounted) return;
      await _uploadMobileImage(annotated);
    } catch (error) {
      _showError(_errorText(error));
    }
  }

  Future<void> _uploadMobileImage(AnnotatedImage image) async {
    if (!_canStageMobileInput()) return;
    final strings = AppLocalizations.of(context);
    final socket = ref.read(wsServiceProvider)!;
    final conversation = ref.read(conversationProvider);
    final sessionId = conversation.selectedSessionId!;
    setState(() {
      _uploading = true;
      _uploadProgress = 0;
      _uploadCancellation = TransferCancellation();
    });
    try {
      final artifact = await TransferService.uploadBytes(
        socket: socket,
        sessionId: sessionId,
        directory: conversation.selectedDirectory,
        bytes: image.bytes,
        filename: image.filename,
        mime: 'image/png',
        cancellation: _uploadCancellation,
        onProgress: (transferred, total) {
          if (!mounted) return;
          setState(
            () => _uploadProgress = total > 0 ? transferred / total : null,
          );
        },
      );
      if (artifact == null || !mounted) {
        throw StateError(strings.imageRejected);
      }
      setState(() {
        _attachmentSessionId = sessionId;
        _pendingAttachments.add(artifact);
      });
      _showNotice(strings.readyWithDraft(artifact.name));
    } catch (error) {
      _showError(_errorText(error));
    } finally {
      if (mounted) {
        setState(() {
          _uploading = false;
          _uploadProgress = null;
          _uploadCancellation = null;
        });
      }
    }
  }

  Future<void> _toggleDictation() async {
    final strings = AppLocalizations.of(context);
    if (_speech.isListening) {
      await _speech.stop();
      if (mounted) setState(() => _listening = false);
      return;
    }
    try {
      final available =
          _speech.isAvailable ||
          await _speech.initialize(
            onStatus: (status) {
              if (mounted) setState(() => _listening = status == 'listening');
            },
            onError: (error) {
              if (!mounted) return;
              setState(() => _listening = false);
              _showError(strings.speechFailed(error.errorMsg));
            },
            options: [SpeechToText.androidNoBluetooth],
          );
      if (!available) {
        throw StateError(strings.speechUnavailable);
      }
      _speechPrefix = _messageController.text.trimRight();
      if (_speechPrefix.isNotEmpty) _speechPrefix = '$_speechPrefix ';
      await _speech.listen(
        onResult: (result) {
          if (!mounted) return;
          _messageController.text = '$_speechPrefix${result.recognizedWords}';
          _messageController.selection = TextSelection.collapsed(
            offset: _messageController.text.length,
          );
        },
        listenOptions: SpeechListenOptions(
          onDevice: true,
          partialResults: true,
          cancelOnError: true,
          listenMode: ListenMode.dictation,
          listenFor: const Duration(seconds: 45),
          pauseFor: const Duration(seconds: 4),
        ),
      );
      if (mounted) setState(() => _listening = _speech.isListening);
    } catch (error) {
      if (mounted) setState(() => _listening = false);
      _showError(_errorText(error));
    }
  }

  Future<void> _offerIncomingShare() async {
    final strings = AppLocalizations.of(context);
    final share = _pendingIncomingShare;
    if (share == null || _shareDialogOpen || !mounted) return;
    final conversation = ref.read(conversationProvider);
    final sessionId = conversation.selectedSessionId;
    if (sessionId == null) {
      if (!_shareWaitingNoticeShown) {
        _shareWaitingNoticeShown = true;
        _showNotice(strings.selectTargetSession);
      }
      return;
    }
    final session = _findSession(ref.read(sessionListProvider), sessionId);
    _shareDialogOpen = true;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(strings.addSharedToDraft),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              strings.targetSession(
                session == null ? sessionId : _sessionTitle(session),
              ),
            ),
            if (conversation.selectedDirectory != null)
              Text(strings.projectLabel(conversation.selectedDirectory!)),
            const SizedBox(height: 12),
            if (share.text != null)
              Text(share.text!, maxLines: 3, overflow: TextOverflow.ellipsis),
            for (final file in share.files)
              Text(
                '• ${file.name} (${_attachmentBytes(context, file.size)})',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            for (final issue in share.issues)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  issue,
                  style: const TextStyle(color: AppPalette.amber),
                ),
              ),
            const SizedBox(height: 10),
            Text(strings.sendSafety),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(strings.discard),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(strings.addToDraft),
          ),
        ],
      ),
    );
    _shareDialogOpen = false;
    if (!mounted) return;
    if (accepted != true) {
      _pendingIncomingShare = null;
      await MobileInputService.instance.discard(share);
      return;
    }
    if (share.files.length > 10 - _pendingAttachments.length) {
      _showError(strings.sharedAttachmentLimit);
      return;
    }
    final socket = ref.read(wsServiceProvider);
    if (share.files.isNotEmpty && (socket == null || !socket.isConnected)) {
      _showError(strings.reconnectSharedFiles);
      return;
    }
    _pendingIncomingShare = null;
    if (share.text != null) {
      final current = _messageController.text.trimRight();
      _messageController.text = current.isEmpty
          ? share.text!
          : '$current\n${share.text!}';
      _messageController.selection = TextSelection.collapsed(
        offset: _messageController.text.length,
      );
    }
    if (share.files.isEmpty) return;
    await _uploadSharedFiles(
      share,
      socket: socket!,
      sessionId: sessionId,
      directory: conversation.selectedDirectory,
    );
  }

  Future<void> _uploadSharedFiles(
    IncomingShare share, {
    required WebSocketService socket,
    required String sessionId,
    required String? directory,
  }) async {
    final strings = AppLocalizations.of(context);
    final total = share.files.fold<int>(0, (sum, file) => sum + file.size);
    var completed = 0;
    setState(() {
      _uploading = true;
      _uploadProgress = 0;
      _uploadCancellation = TransferCancellation();
    });
    try {
      for (final file in share.files) {
        final artifact = await TransferService.uploadLocalFile(
          socket: socket,
          sessionId: sessionId,
          directory: directory,
          path: file.path,
          filename: file.name,
          size: file.size,
          mime: file.mime,
          cancellation: _uploadCancellation,
          onProgress: (transferred, _) {
            if (!mounted) return;
            setState(
              () => _uploadProgress = total > 0
                  ? (completed + transferred) / total
                  : null,
            );
          },
        );
        if (artifact == null) {
          throw StateError(strings.fileRejected(file.name));
        }
        completed += file.size;
        if (mounted) {
          setState(() {
            _attachmentSessionId = sessionId;
            _pendingAttachments.add(artifact);
          });
        }
        await MobileInputService.instance.discard(IncomingShare(files: [file]));
      }
      if (mounted) _showNotice(strings.sharedReady);
    } catch (error) {
      _showError(_errorText(error));
    } finally {
      if (mounted) {
        setState(() {
          _uploading = false;
          _uploadProgress = null;
          _uploadCancellation = null;
        });
      }
    }
  }

  Future<void> _uploadAttachment({required bool imageOnly}) async {
    final socket = ref.read(wsServiceProvider);
    final conversation = ref.read(conversationProvider);
    final sessionId = conversation.selectedSessionId;
    if (socket == null || !socket.isConnected) {
      _showError(AppLocalizations.of(context).connectionOffline);
      return;
    }
    if (sessionId == null) {
      _showError(AppLocalizations.of(context).selectSessionForFile);
      return;
    }
    if (_uploading || _pendingAttachments.length >= 10) {
      _showError(AppLocalizations.of(context).attachmentLimit);
      return;
    }
    if (_pendingAttachments.isNotEmpty && sessionId != _attachmentSessionId) {
      _showError(
        'The staged attachments belong to another session. Remove them first.',
      );
      return;
    }
    setState(() {
      _uploading = true;
      _uploadProgress = 0;
      _uploadCancellation = TransferCancellation();
    });
    try {
      final artifacts = await TransferService.pickAndUpload(
        socket: socket,
        sessionId: sessionId,
        directory: conversation.selectedDirectory,
        imageOnly: imageOnly,
        model: conversation.selectedModelId,
        agent: conversation.selectedAgentName,
        variant: conversation.selectedVariant,
        maxFiles: 10 - _pendingAttachments.length,
        cancellation: _uploadCancellation,
        onUploaded: (artifact) {
          if (!mounted) return;
          setState(() {
            _attachmentSessionId = sessionId;
            _pendingAttachments.add(artifact);
          });
        },
        onProgress: (transferred, total) {
          if (!mounted) return;
          setState(() {
            _uploadProgress = total > 0 ? transferred / total : null;
          });
        },
      );
      if (artifacts.isNotEmpty && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              artifacts.length == 1
                  ? '${artifacts.single.name} is ready with your draft'
                  : '${artifacts.length} attachments are ready with your draft',
            ),
          ),
        );
      }
    } catch (error) {
      _showError(_errorText(error));
    } finally {
      if (mounted) {
        setState(() {
          _uploading = false;
          _uploadProgress = null;
          _uploadCancellation = null;
        });
      }
    }
  }

  Future<String?> _chooseNewSessionDirectory(String? initial) async {
    var selected = initial;
    final strings = AppLocalizations.of(context);
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppPalette.panel,
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setSheetState) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 12, 18, 18),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const _SheetHandle(),
                const SizedBox(height: 18),
                Text(
                  strings.newSession,
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 6),
                Text(
                  strings.chooseMachineFolder,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 18),
                Material(
                  color: AppPalette.surface,
                  borderRadius: BorderRadius.circular(14),
                  child: ListTile(
                    leading: const Icon(
                      Icons.folder_open_rounded,
                      color: AppPalette.amber,
                    ),
                    title: Text(
                      selected?.split('/').lastOrNull ?? strings.chooseFolder,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(
                      selected ?? strings.browseDirectoryTree,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    trailing: const Icon(Icons.chevron_right_rounded),
                    onTap: () async {
                      final result = await _showDirectoryPicker(selected);
                      if (result != null) {
                        setSheetState(() => selected = result);
                      }
                    },
                  ),
                ),
                const SizedBox(height: 18),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => Navigator.pop(sheetContext),
                        child: Text(strings.cancel),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: selected == null
                            ? null
                            : () {
                                ref
                                    .read(conversationProvider.notifier)
                                    .setDirectory(selected!);
                                Navigator.pop(sheetContext, selected);
                              },
                        icon: const Icon(Icons.add_rounded),
                        label: Text(strings.createSession),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<String?> _showDirectoryPicker(String? initial) {
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppPalette.panel,
      builder: (_) => _DirectoryPicker(initialPath: initial),
    );
  }

  Future<void> _stopSession(SessionInfo session) async {
    try {
      await ref
          .read(wsServiceProvider)
          ?.abortSession(sessionId: session.id, directory: session.directory);
      ref.read(sessionListProvider.notifier).updateStatus(session.id, 'idle');
    } catch (error) {
      _showError(_errorText(error));
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    });
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  void _showNotice(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: AppPalette.primarySoft),
    );
  }
}

class _SessionHeader extends StatelessWidget {
  final SessionInfo? session;
  final int sessionCount;
  final bool connected;
  final VoidCallback onTap;
  final VoidCallback? onRefresh;
  final VoidCallback? onStop;

  const _SessionHeader({
    required this.session,
    required this.sessionCount,
    required this.connected,
    required this.onTap,
    required this.onRefresh,
    required this.onStop,
  });

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 4, 12, 8),
      padding: const EdgeInsets.fromLTRB(8, 7, 6, 7),
      decoration: BoxDecoration(
        color: AppPalette.panel,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppPalette.stroke),
      ),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: connected
                  ? AppPalette.mint.withValues(alpha: 0.12)
                  : AppPalette.elevated,
              borderRadius: BorderRadius.circular(13),
            ),
            child: Icon(
              connected ? Icons.forum_rounded : Icons.cloud_off_outlined,
              color: connected ? AppPalette.mint : AppPalette.textMuted,
              size: 20,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: InkWell(
              key: const Key('active-session-header'),
              onTap: onTap,
              borderRadius: BorderRadius.circular(12),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      session == null
                          ? strings.noActiveSession
                          : _sessionTitle(session!),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      session == null
                          ? strings.savedSessions(sessionCount)
                          : _sessionDate(context, session!),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (onStop != null)
            IconButton(
              key: const Key('stop-session-button'),
              tooltip: strings.stopRunningAgent,
              onPressed: onStop,
              icon: const Icon(
                Icons.stop_circle_outlined,
                color: AppPalette.danger,
                size: 22,
              ),
            )
          else if (onRefresh != null)
            IconButton(
              tooltip: strings.reloadMessages,
              onPressed: onRefresh,
              icon: const Icon(Icons.refresh_rounded, size: 20),
            ),
          IconButton(
            tooltip: strings.sessionHistory,
            onPressed: onTap,
            icon: const Icon(
              Icons.keyboard_arrow_down_rounded,
              color: AppPalette.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}

class _WorkflowStrip extends ConsumerWidget {
  const _WorkflowStrip();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final directory = ref.watch(
      conversationProvider.select((state) => state.selectedDirectory),
    );
    final sessionId = ref.watch(
      conversationProvider.select((state) => state.selectedSessionId),
    );
    final allSteps = ref.watch(dagProvider);
    final steps = sessionId == null
        ? const <DagStep>[]
        : allSteps
              .where(
                (step) =>
                    step.sessionId == sessionId &&
                    (directory == null || step.directory == directory),
              )
              .toList();
    if (steps.isEmpty) return const SizedBox.shrink();
    final complete = steps.where((step) => step.status == 'complete').length;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
      decoration: const BoxDecoration(
        color: AppPalette.panel,
        border: Border(
          top: BorderSide(color: AppPalette.stroke),
          bottom: BorderSide(color: AppPalette.stroke),
        ),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.account_tree_outlined,
            color: AppPalette.mint,
            size: 17,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              strings.workflowProgress(complete, steps.length),
              style: Theme.of(context).textTheme.labelLarge,
            ),
          ),
          SizedBox(
            width: 88,
            child: LinearProgressIndicator(
              value: complete / steps.length,
              minHeight: 4,
              borderRadius: BorderRadius.circular(2),
              color: AppPalette.mint,
              backgroundColor: AppPalette.stroke,
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyConversation extends StatelessWidget {
  final bool hasSession;
  final VoidCallback? onCreate;
  final VoidCallback onHistory;

  const _EmptyConversation({
    required this.hasSession,
    required this.onCreate,
    required this.onHistory,
  });

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.chat_bubble_outline_rounded,
              color: AppPalette.primary,
              size: 42,
            ),
            const SizedBox(height: 14),
            Text(
              hasSession ? strings.noMessages : strings.chooseSession,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 7),
            Text(
              hasSession ? strings.sendToBegin : strings.historyAvailable,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            if (!hasSession) ...[
              const SizedBox(height: 18),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  OutlinedButton(
                    onPressed: onHistory,
                    child: Text(strings.openHistory),
                  ),
                  const SizedBox(width: 10),
                  FilledButton(
                    onPressed: onCreate,
                    child: Text(strings.newSession),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

enum _DeliveryState { idle, sending, accepted, queued, failed }

class _DeliveryPill extends StatelessWidget {
  final _DeliveryState state;

  const _DeliveryPill({required this.state});

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final (label, icon, color) = switch (state) {
      _DeliveryState.sending => (
        strings.messageSending,
        Icons.sync_rounded,
        AppPalette.amber,
      ),
      _DeliveryState.accepted => (
        strings.messageDelivered,
        Icons.done_rounded,
        AppPalette.mint,
      ),
      _DeliveryState.queued => (
        strings.messageQueued,
        Icons.schedule_rounded,
        AppPalette.amber,
      ),
      _DeliveryState.failed => (
        strings.messageFailed,
        Icons.error_outline_rounded,
        AppPalette.danger,
      ),
      _DeliveryState.idle => ('', Icons.done_rounded, AppPalette.textMuted),
    };
    return AnimatedContainer(
      duration: const Duration(milliseconds: 140),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: color),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 9,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _Composer extends ConsumerWidget {
  final TextEditingController controller;
  final bool sending;
  final _DeliveryState deliveryState;
  final bool uploading;
  final double? uploadProgress;
  final VoidCallback? onPauseUpload;
  final List<CompanionArtifact> attachments;
  final ValueChanged<CompanionArtifact> onRemoveAttachment;
  final bool connected;
  final VoidCallback onSend;
  final VoidCallback onAttach;
  final VoidCallback onSpeech;
  final bool listening;
  final VoidCallback onModel;
  final VoidCallback onAgent;
  final VoidCallback onVariant;

  const _Composer({
    required this.controller,
    required this.sending,
    required this.deliveryState,
    required this.uploading,
    required this.uploadProgress,
    required this.onPauseUpload,
    required this.attachments,
    required this.onRemoveAttachment,
    required this.connected,
    required this.onSend,
    required this.onAttach,
    required this.onSpeech,
    required this.listening,
    required this.onModel,
    required this.onAgent,
    required this.onVariant,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final conversation = ref.watch(conversationProvider);
    final models = ref.watch(modelsListProvider);
    ModelInfo? model;
    for (final candidate in models) {
      if (candidate.id == conversation.selectedModelId) model = candidate;
    }
    void openRuntimeSettings() {
      showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        backgroundColor: AppPalette.panel,
        builder: (sheetContext) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ListTile(
                  leading: const Icon(Icons.memory_rounded),
                  title: Text(strings.models),
                  subtitle: Text(model?.id ?? strings.selectModel),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () {
                    Navigator.pop(sheetContext);
                    onModel();
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.psychology_alt_outlined),
                  title: Text(strings.thinkingEffort),
                  subtitle: Text(
                    conversation.selectedVariant?.toUpperCase() ??
                        strings.defaultLabel,
                  ),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () {
                    Navigator.pop(sheetContext);
                    onVariant();
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.smart_toy_outlined),
                  title: Text(strings.agent),
                  subtitle: Text(
                    conversation.selectedAgentName ?? strings.defaultLabel,
                  ),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () {
                    Navigator.pop(sheetContext);
                    onAgent();
                  },
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Container(
      padding: EdgeInsets.fromLTRB(
        12,
        9,
        12,
        MediaQuery.viewInsetsOf(context).bottom + 10,
      ),
      decoration: const BoxDecoration(
        color: AppPalette.surface,
        border: Border(top: BorderSide(color: AppPalette.stroke)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (uploadProgress != null) ...[
            Row(
              children: [
                Expanded(
                  child: LinearProgressIndicator(
                    value: uploadProgress,
                    minHeight: 3,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  '${(uploadProgress! * 100).clamp(0, 100).round()}%',
                  style: Theme.of(context).textTheme.labelSmall,
                ),
                IconButton(
                  key: const Key('pause-upload-button'),
                  tooltip: strings.pauseUpload,
                  onPressed: onPauseUpload,
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.pause_rounded, size: 18),
                ),
              ],
            ),
            const SizedBox(height: 9),
          ],
          if (attachments.isNotEmpty) ...[
            SizedBox(
              height: 58,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: attachments.length,
                separatorBuilder: (_, _) => const SizedBox(width: 8),
                itemBuilder: (_, index) => _DraftAttachment(
                  artifact: attachments[index],
                  onRemove: () => onRemoveAttachment(attachments[index]),
                ),
              ),
            ),
            const SizedBox(height: 9),
          ],
          Row(
            children: [
              Expanded(
                child: TextButton.icon(
                  key: const Key('model-selector'),
                  onPressed: onModel,
                  style: TextButton.styleFrom(
                    alignment: Alignment.centerLeft,
                    foregroundColor: AppPalette.textSecondary,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                  ),
                  icon: Icon(
                    Icons.auto_awesome_rounded,
                    size: 17,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                  label: Text(
                    model == null
                        ? strings.selectModel
                        : '${model.name} · ${model.providerName}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ),
              if (deliveryState != _DeliveryState.idle)
                _DeliveryPill(state: deliveryState),
              IconButton(
                key: const Key('runtime-settings-button'),
                tooltip: strings.agent,
                onPressed: openRuntimeSettings,
                icon: const Icon(Icons.tune_rounded, size: 19),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Container(
            decoration: BoxDecoration(
              color: AppPalette.panel,
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: AppPalette.stroke),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                IconButton(
                  key: const Key('attachment-input-button'),
                  tooltip: strings.attachFile,
                  onPressed: connected && !sending && !uploading
                      ? onAttach
                      : null,
                  icon: const Icon(Icons.add_rounded),
                ),
                Expanded(
                  child: TextField(
                    key: const Key('message-input'),
                    controller: controller,
                    enabled: connected,
                    minLines: 1,
                    maxLines: 5,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: InputDecoration(
                      filled: false,
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      contentPadding: const EdgeInsets.symmetric(vertical: 14),
                      hintText: connected
                          ? strings.messageAtomcli
                          : strings.waitingForAtomcli,
                    ),
                  ),
                ),
                IconButton(
                  key: const Key('speech-input-button'),
                  tooltip: listening
                      ? strings.stopDictation
                      : strings.startDictation,
                  onPressed: connected && !sending && !uploading
                      ? onSpeech
                      : null,
                  color: listening ? AppPalette.amber : null,
                  icon: Icon(
                    listening ? Icons.mic_rounded : Icons.mic_none_rounded,
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(right: 4, bottom: 4),
                  child: IconButton.filled(
                    key: const Key('send-message-button'),
                    tooltip: strings.send,
                    onPressed: connected && !sending && !uploading
                        ? onSend
                        : null,
                    icon: sending
                        ? const SizedBox.square(
                            dimension: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: AppPalette.background,
                            ),
                          )
                        : const Icon(Icons.arrow_upward_rounded),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

enum _MobileInputAction { camera, image, annotate, file }

class _DraftAttachment extends ConsumerWidget {
  final CompanionArtifact artifact;
  final VoidCallback onRemove;

  const _DraftAttachment({required this.artifact, required this.onRemove});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final socket = ref.watch(wsServiceProvider);
    Uri? thumbnail;
    if (artifact.kind == 'image' && socket != null) {
      try {
        thumbnail = socket.httpUriForPath(artifact.downloadPath);
      } catch (_) {}
    }
    return Container(
      constraints: const BoxConstraints(maxWidth: 210),
      padding: const EdgeInsets.fromLTRB(6, 6, 4, 6),
      decoration: BoxDecoration(
        color: AppPalette.panel,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppPalette.stroke),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: SizedBox.square(
              dimension: 42,
              child: thumbnail == null
                  ? const ColoredBox(
                      color: AppPalette.surface,
                      child: Icon(Icons.insert_drive_file_outlined, size: 20),
                    )
                  : Image.network(
                      thumbnail.toString(),
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => const ColoredBox(
                        color: AppPalette.surface,
                        child: Icon(Icons.broken_image_outlined, size: 20),
                      ),
                    ),
            ),
          ),
          const SizedBox(width: 8),
          Flexible(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  artifact.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelMedium,
                ),
                Text(
                  _attachmentBytes(context, artifact.size),
                  style: Theme.of(context).textTheme.labelSmall,
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: strings.removeAttachment,
            visualDensity: VisualDensity.compact,
            onPressed: onRemove,
            icon: const Icon(Icons.close_rounded, size: 17),
          ),
        ],
      ),
    );
  }
}

String _attachmentBytes(BuildContext context, int bytes) {
  final format = NumberFormat(
    '#,##0.#',
    Localizations.localeOf(context).toString(),
  );
  if (bytes < 1024) return '${format.format(bytes)} B';
  if (bytes < 1024 * 1024) return '${format.format(bytes / 1024)} KB';
  return '${format.format(bytes / (1024 * 1024))} MB';
}

String _sessionDate(BuildContext context, SessionInfo session) =>
    DateFormat.yMd(
      Localizations.localeOf(context).toString(),
    ).add_Hm().format(DateTime.fromMillisecondsSinceEpoch(session.updated));

class _WideSessionPane extends StatefulWidget {
  final List<SessionInfo> sessions;
  final String? selectedId;
  final bool connected;
  final bool creating;
  final VoidCallback onCreate;
  final ValueChanged<String> onSelect;
  final ValueChanged<SessionInfo> onDelete;

  const _WideSessionPane({
    required this.sessions,
    required this.selectedId,
    required this.connected,
    required this.creating,
    required this.onCreate,
    required this.onSelect,
    required this.onDelete,
  });

  @override
  State<_WideSessionPane> createState() => _WideSessionPaneState();
}

class _WideSessionPaneState extends State<_WideSessionPane> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final query = _query.trim().toLowerCase();
    final sessions = widget.sessions
        .where(
          (session) =>
              query.isEmpty ||
              session.title.toLowerCase().contains(query) ||
              session.id.toLowerCase().contains(query) ||
              session.directory.toLowerCase().contains(query),
        )
        .toList();
    return Material(
      key: const Key('tablet-session-pane'),
      color: AppPalette.surface,
      child: SafeArea(
        top: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 14, 14, 9),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      strings.sessionHistory,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  Text(
                    '${widget.sessions.length}',
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
              child: TextField(
                key: const Key('tablet-session-search'),
                decoration: InputDecoration(
                  prefixIcon: const Icon(Icons.search_rounded),
                  hintText: strings.searchSessions,
                  isDense: true,
                ),
                onChanged: (value) => setState(() => _query = value),
              ),
            ),
            Expanded(
              child: sessions.isEmpty
                  ? _PickerEmpty(strings.noMatchingSessions)
                  : ListView.separated(
                      itemCount: sessions.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final session = sessions[index];
                        final selected = session.id == widget.selectedId;
                        return ListTile(
                          selected: selected,
                          selectedTileColor: AppPalette.primarySoft,
                          leading: Icon(
                            session.isActive
                                ? Icons.motion_photos_on_rounded
                                : Icons.forum_outlined,
                            color: session.isActive ? AppPalette.mint : null,
                          ),
                          title: Text(
                            _sessionTitle(session),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          subtitle: Text(
                            _sessionDate(context, session),
                            maxLines: 1,
                          ),
                          trailing: PopupMenuButton<String>(
                            tooltip: strings.sessionOptions,
                            onSelected: (_) => widget.onDelete(session),
                            itemBuilder: (_) => [
                              PopupMenuItem(
                                value: 'delete',
                                enabled: !session.isActive,
                                child: Row(
                                  children: [
                                    const Icon(
                                      Icons.delete_outline_rounded,
                                      color: AppPalette.danger,
                                    ),
                                    const SizedBox(width: 10),
                                    Text(strings.deleteSession),
                                  ],
                                ),
                              ),
                            ],
                            icon: Icon(
                              selected
                                  ? Icons.check_rounded
                                  : Icons.more_horiz_rounded,
                            ),
                          ),
                          onTap: () => widget.onSelect(session.id),
                        );
                      },
                    ),
            ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: FilledButton.icon(
                onPressed: widget.connected && !widget.creating
                    ? widget.onCreate
                    : null,
                icon: widget.creating
                    ? const SizedBox.square(
                        dimension: 17,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.add_comment_outlined),
                label: Text(strings.newSession),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SessionPicker extends StatefulWidget {
  final List<SessionInfo> sessions;
  final String? selectedId;

  const _SessionPicker({required this.sessions, required this.selectedId});

  @override
  State<_SessionPicker> createState() => _SessionPickerState();
}

class _SessionPickerResult {
  final String? sessionId;
  final SessionInfo? delete;

  const _SessionPickerResult.select(this.sessionId) : delete = null;
  const _SessionPickerResult.delete(this.delete) : sessionId = null;
}

class _SessionPickerState extends State<_SessionPicker> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final query = _query.toLowerCase();
    final sessions = widget.sessions
        .where(
          (session) =>
              query.isEmpty ||
              session.title.toLowerCase().contains(query) ||
              session.id.toLowerCase().contains(query),
        )
        .toList();
    return _PickerFrame(
      title: AppLocalizations.of(context).sessionHistory,
      count: widget.sessions.length,
      searchHint: AppLocalizations.of(context).searchSessions,
      onSearch: (value) => setState(() => _query = value),
      child: sessions.isEmpty
          ? _PickerEmpty(AppLocalizations.of(context).noMatchingSessions)
          : ListView.separated(
              itemCount: sessions.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (_, index) {
                final session = sessions[index];
                final selected = session.id == widget.selectedId;
                return ListTile(
                  selected: selected,
                  selectedColor: AppPalette.primary,
                  leading: Icon(
                    session.isActive
                        ? Icons.motion_photos_on_rounded
                        : selected
                        ? Icons.forum_rounded
                        : Icons.forum_outlined,
                    color: session.isActive ? AppPalette.mint : null,
                  ),
                  title: Text(
                    _sessionTitle(session),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  subtitle: Text(
                    '${_sessionDate(context, session)}  ·  ${session.directory.split('/').last}\n${session.directory}',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (session.isActive)
                        Text(
                          AppLocalizations.of(context).running,
                          style: const TextStyle(
                            color: AppPalette.mint,
                            fontSize: 9,
                          ),
                        )
                      else if (selected)
                        const Icon(Icons.check_rounded),
                      PopupMenuButton<String>(
                        key: ValueKey('session-options-${session.id}'),
                        tooltip: AppLocalizations.of(context).sessionOptions,
                        onSelected: (_) => Navigator.pop(
                          context,
                          _SessionPickerResult.delete(session),
                        ),
                        itemBuilder: (_) => [
                          PopupMenuItem(
                            value: 'delete',
                            enabled: !session.isActive,
                            child: Row(
                              children: [
                                const Icon(
                                  Icons.delete_outline_rounded,
                                  color: AppPalette.danger,
                                ),
                                const SizedBox(width: 10),
                                Text(
                                  AppLocalizations.of(context).deleteSession,
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  onTap: () => Navigator.pop(
                    context,
                    _SessionPickerResult.select(session.id),
                  ),
                );
              },
            ),
    );
  }
}

class _ModelPicker extends StatefulWidget {
  final List<ModelInfo> models;
  final String? selectedId;

  const _ModelPicker({required this.models, required this.selectedId});

  @override
  State<_ModelPicker> createState() => _ModelPickerState();
}

class _ModelPickerState extends State<_ModelPicker> {
  String _query = '';
  bool _freeOnly = false;
  bool _reasoningOnly = false;
  bool _favoritesOnly = false;

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final query = _query.toLowerCase();
    final preferences = CompanionPreferences.instance;
    final filtered = widget.models
        .where(
          (model) =>
              (!_freeOnly || model.free) &&
              (!_reasoningOnly || model.reasoning) &&
              (!_favoritesOnly ||
                  preferences.favoriteModels.contains(model.id)) &&
              (query.isEmpty ||
                  model.name.toLowerCase().contains(query) ||
                  model.id.toLowerCase().contains(query) ||
                  model.providerName.toLowerCase().contains(query) ||
                  (model.family?.toLowerCase().contains(query) ?? false)),
        )
        .toList();
    final sections = _modelSections(filtered, preferences, strings);
    return _PickerFrame(
      title: strings.models,
      count: widget.models.length,
      searchHint: strings.searchModels,
      onSearch: (value) => setState(() => _query = value),
      filters: [
        FilterChip(
          selected: _freeOnly,
          onSelected: (value) => setState(() => _freeOnly = value),
          avatar: const Icon(Icons.savings_outlined, size: 15),
          label: Text(strings.free),
        ),
        FilterChip(
          selected: _reasoningOnly,
          onSelected: (value) => setState(() => _reasoningOnly = value),
          avatar: const Icon(Icons.psychology_alt_outlined, size: 15),
          label: Text(strings.reasoning),
        ),
        FilterChip(
          selected: _favoritesOnly,
          onSelected: (value) => setState(() => _favoritesOnly = value),
          avatar: const Icon(Icons.star_outline_rounded, size: 15),
          label: Text(strings.favorites),
        ),
      ],
      child: filtered.isEmpty
          ? _PickerEmpty(strings.noModels)
          : ListView(
              padding: const EdgeInsets.only(bottom: 24),
              children: [
                for (final section in sections) ...[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(18, 18, 18, 7),
                    child: Text(
                      section.$1.toUpperCase(),
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: section.$1 == 'AtomCLI'
                            ? AppPalette.primary
                            : AppPalette.textMuted,
                      ),
                    ),
                  ),
                  for (final model in section.$2)
                    _ModelRow(
                      model: model,
                      selected: model.id == widget.selectedId,
                      favorite: preferences.favoriteModels.contains(model.id),
                      onFavorite: () {
                        preferences.toggleFavorite(model.id);
                        setState(() {});
                      },
                      onTap: () => Navigator.pop(context, model.id),
                    ),
                ],
              ],
            ),
    );
  }

  List<(String, List<ModelInfo>)> _modelSections(
    List<ModelInfo> models,
    CompanionPreferences preferences,
    AppLocalizations strings,
  ) {
    final byId = {for (final model in models) model.id: model};
    final used = <String>{};
    List<ModelInfo> take(Iterable<String> ids) => ids
        .map((id) => byId[id])
        .whereType<ModelInfo>()
        .where((model) => used.add(model.id))
        .toList();

    final result = <(String, List<ModelInfo>)>[];
    final recent = take(preferences.recentModels);
    if (recent.isNotEmpty) result.add((strings.recent, recent));
    final favorites = take(preferences.favoriteModels);
    if (favorites.isNotEmpty) result.add((strings.favorites, favorites));

    final providers = <String, List<ModelInfo>>{};
    for (final model in models.where((model) => used.add(model.id))) {
      providers.putIfAbsent(model.providerName, () => []).add(model);
    }
    final names = providers.keys.toList()
      ..sort((a, b) {
        if (providers[a]!.first.providerId == 'atomcli') return -1;
        if (providers[b]!.first.providerId == 'atomcli') return 1;
        return a.compareTo(b);
      });
    for (final name in names) {
      final items = providers[name]!
        ..sort((a, b) {
          if (a.free != b.free) return a.free ? -1 : 1;
          return a.name.compareTo(b.name);
        });
      result.add((
        providers[name]!.first.providerId == 'atomcli' ? 'AtomCLI' : name,
        items,
      ));
    }
    return result;
  }
}

class _ModelRow extends StatelessWidget {
  final ModelInfo model;
  final bool selected;
  final bool favorite;
  final VoidCallback onFavorite;
  final VoidCallback onTap;

  const _ModelRow({
    required this.model,
    required this.selected,
    required this.favorite,
    required this.onFavorite,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    return Material(
      color: selected ? AppPalette.primarySoft : Colors.transparent,
      child: InkWell(
        key: ValueKey('model-${model.id}'),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(17, 11, 8, 11),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: model.providerId == 'atomcli'
                      ? AppPalette.primarySoft
                      : AppPalette.surface,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppPalette.stroke),
                ),
                child: Icon(
                  model.reasoning
                      ? Icons.psychology_alt_rounded
                      : Icons.memory_rounded,
                  color: selected
                      ? AppPalette.primary
                      : AppPalette.textSecondary,
                  size: 18,
                ),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      model.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 3),
                    Wrap(
                      spacing: 7,
                      children: [
                        Text(
                          model.id,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        if (model.free)
                          Text(
                            strings.freeBadge,
                            style: const TextStyle(
                              color: AppPalette.mint,
                              fontSize: 9,
                            ),
                          ),
                        if (model.reasoning)
                          Text(
                            strings.thinkBadge,
                            style: const TextStyle(
                              color: AppPalette.amber,
                              fontSize: 9,
                            ),
                          ),
                        if (model.contextLimit > 0)
                          Text(
                            _tokens(model.contextLimit),
                            style: Theme.of(context).textTheme.labelSmall,
                          ),
                      ],
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: favorite
                    ? strings.removeFavorite
                    : strings.addFavorite,
                onPressed: onFavorite,
                icon: Icon(
                  favorite ? Icons.star_rounded : Icons.star_outline_rounded,
                  color: favorite ? AppPalette.amber : AppPalette.textMuted,
                ),
              ),
              if (selected)
                Icon(Icons.check_rounded, color: AppPalette.primary),
            ],
          ),
        ),
      ),
    );
  }
}

class _VariantPicker extends StatelessWidget {
  final List<String> variants;
  final String? selected;

  const _VariantPicker({required this.variants, required this.selected});

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final levels = ['__default__', ...variants];
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(18, 12, 18, 18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const _SheetHandle(),
            const SizedBox(height: 18),
            Text(
              strings.thinkingEffort,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 5),
            Text(
              strings.thinkingEffortBody,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: 13),
            for (final level in levels)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(
                  (level == '__default__' && selected == null) ||
                          level == selected
                      ? Icons.radio_button_checked_rounded
                      : Icons.radio_button_off_rounded,
                  color: AppPalette.amber,
                ),
                title: Text(
                  level == '__default__'
                      ? strings.modelDefault
                      : level.toUpperCase(),
                ),
                subtitle: level == '__default__'
                    ? Text(strings.providerDefault)
                    : null,
                onTap: () => Navigator.pop(context, level),
              ),
          ],
        ),
      ),
    );
  }
}

class _DirectoryPicker extends ConsumerStatefulWidget {
  final String? initialPath;

  const _DirectoryPicker({this.initialPath});

  @override
  ConsumerState<_DirectoryPicker> createState() => _DirectoryPickerState();
}

class _DirectoryPickerState extends ConsumerState<_DirectoryPicker> {
  DirectoryListing? _listing;
  String? _error;
  bool _loading = true;
  bool _showHidden = false;
  bool _initialized = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_initialized) return;
    _initialized = true;
    _load(widget.initialPath);
  }

  Future<void> _load(String? path) async {
    final strings = AppLocalizations.of(context);
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final ws = ref.read(wsServiceProvider);
      if (ws == null) {
        throw StateError(strings.connectionOffline);
      }
      final listing = await ws.listDirectories(path: path);
      if (!mounted) return;
      setState(() => _listing = listing);
    } catch (error) {
      if (path != null) {
        try {
          final ws = ref.read(wsServiceProvider);
          if (ws == null) {
            throw StateError(strings.connectionOffline);
          }
          final fallback = await ws.listDirectories();
          if (mounted) setState(() => _listing = fallback);
        } catch (fallbackError) {
          if (mounted) setState(() => _error = _errorText(fallbackError));
        }
      } else if (mounted) {
        setState(() => _error = _errorText(error));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final listing = _listing;
    final directories =
        listing?.directories
            .where((entry) => _showHidden || !entry.hidden)
            .toList() ??
        const <DirectoryEntry>[];
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.9,
        child: Column(
          children: [
            const SizedBox(height: 10),
            const _SheetHandle(),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 8, 5),
              child: Row(
                children: [
                  IconButton(
                    tooltip: strings.parentFolder,
                    onPressed: listing?.parent == null || _loading
                        ? null
                        : () => _load(listing!.parent),
                    icon: const Icon(Icons.arrow_upward_rounded),
                  ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          strings.workingDirectory,
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        Text(
                          listing?.path ??
                              widget.initialPath ??
                              strings.loadingFolders,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(fontFamily: 'monospace'),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: _showHidden
                        ? strings.hideHiddenFolders
                        : strings.showHiddenFolders,
                    onPressed: () => setState(() => _showHidden = !_showHidden),
                    icon: Icon(
                      _showHidden
                          ? Icons.visibility_off_outlined
                          : Icons.visibility_outlined,
                    ),
                  ),
                  IconButton(
                    tooltip: strings.close,
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            if (listing != null && listing.roots.isNotEmpty)
              SizedBox(
                height: 46,
                child: ListView.separated(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 4,
                  ),
                  scrollDirection: Axis.horizontal,
                  itemCount: listing.roots.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 7),
                  itemBuilder: (_, index) {
                    final root = listing.roots[index];
                    return ActionChip(
                      avatar: const Icon(Icons.workspaces_outline, size: 15),
                      label: Text(root.name),
                      onPressed: () => _load(root.path),
                    );
                  },
                ),
              ),
            const Divider(height: 1),
            Expanded(
              child: _loading && listing == null
                  ? const Center(
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : _error != null
                  ? _PickerEmpty(_error!)
                  : directories.isEmpty
                  ? _PickerEmpty(strings.noChildFolders)
                  : ListView.separated(
                      itemCount: directories.length,
                      separatorBuilder: (_, _) =>
                          const Divider(height: 1, indent: 58),
                      itemBuilder: (_, index) {
                        final entry = directories[index];
                        return ListTile(
                          leading: Icon(
                            entry.hidden
                                ? Icons.folder_off_outlined
                                : Icons.folder_outlined,
                            color: entry.hidden
                                ? AppPalette.textMuted
                                : AppPalette.amber,
                          ),
                          title: Text(entry.name),
                          subtitle: Text(
                            entry.path,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          trailing: const Icon(Icons.chevron_right_rounded),
                          onTap: () => _load(entry.path),
                        );
                      },
                    ),
            ),
            Padding(
              padding: const EdgeInsets.all(14),
              child: FilledButton.icon(
                onPressed: listing == null
                    ? null
                    : () => Navigator.pop(context, listing.path),
                icon: const Icon(Icons.check_rounded),
                label: Text(strings.useFolder),
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SheetHandle extends StatelessWidget {
  const _SheetHandle();

  @override
  Widget build(BuildContext context) => Center(
    child: Container(
      width: 40,
      height: 4,
      decoration: BoxDecoration(
        color: AppPalette.strokeStrong,
        borderRadius: BorderRadius.circular(2),
      ),
    ),
  );
}

class _AgentPicker extends StatelessWidget {
  final List<AgentInfo> agents;
  final String? selectedName;

  const _AgentPicker({required this.agents, required this.selectedName});

  @override
  Widget build(BuildContext context) {
    return _PickerFrame(
      title: AppLocalizations.of(context).agent,
      count: agents.length,
      child: agents.isEmpty
          ? _PickerEmpty(AppLocalizations.of(context).noAgents)
          : ListView.separated(
              itemCount: agents.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (_, index) {
                final agent = agents[index];
                final selected = agent.name == selectedName;
                return ListTile(
                  key: ValueKey('agent-${agent.name}'),
                  selected: selected,
                  selectedColor: AppPalette.mint,
                  leading: Icon(
                    selected
                        ? Icons.smart_toy_rounded
                        : Icons.smart_toy_outlined,
                  ),
                  title: Text(agent.name),
                  subtitle: Text(agent.description ?? agent.mode),
                  onTap: () => Navigator.pop(context, agent.name),
                );
              },
            ),
    );
  }
}

class _PickerFrame extends StatelessWidget {
  final String title;
  final int count;
  final Widget child;
  final String? searchHint;
  final ValueChanged<String>? onSearch;
  final List<Widget> filters;

  const _PickerFrame({
    required this.title,
    required this.count,
    required this.child,
    this.searchHint,
    this.onSearch,
    this.filters = const [],
  });

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.78,
        child: Column(
          children: [
            const SizedBox(height: 10),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppPalette.strokeStrong,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 14, 8, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '$title  $count',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                  ),
                  IconButton(
                    tooltip: strings.close,
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            if (onSearch != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 0, 14, 10),
                child: TextField(
                  key: Key('${title.toLowerCase()}-search'),
                  onChanged: onSearch,
                  decoration: InputDecoration(
                    hintText: searchHint,
                    prefixIcon: const Icon(Icons.search_rounded),
                  ),
                ),
              ),
            if (filters.isNotEmpty)
              SizedBox(
                height: 47,
                child: ListView.separated(
                  padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
                  scrollDirection: Axis.horizontal,
                  itemCount: filters.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 7),
                  itemBuilder: (_, index) => filters[index],
                ),
              ),
            const Divider(height: 1),
            Expanded(child: child),
          ],
        ),
      ),
    );
  }
}

class _PickerEmpty extends StatelessWidget {
  final String text;

  const _PickerEmpty(this.text);

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodyMedium,
        ),
      ),
    );
  }
}

class _SubAgentWorkCard extends StatefulWidget {
  final List<SubAgentInfo> agents;

  const _SubAgentWorkCard({super.key, required this.agents});

  @override
  State<_SubAgentWorkCard> createState() => _SubAgentWorkCardState();
}

class _SubAgentWorkCardState extends State<_SubAgentWorkCard> {
  final _activityController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scrollToLatest();
  }

  @override
  void didUpdateWidget(covariant _SubAgentWorkCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    final before = oldWidget.agents.fold<int>(
      0,
      (count, agent) => count + agent.activities.length,
    );
    final after = widget.agents.fold<int>(
      0,
      (count, agent) => count + agent.activities.length,
    );
    if (before != after) _scrollToLatest();
  }

  @override
  void dispose() {
    _activityController.dispose();
    super.dispose();
  }

  void _scrollToLatest() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_activityController.hasClients) return;
      _activityController.animateTo(
        _activityController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOutCubic,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final activities = [
      for (final agent in widget.agents)
        for (final activity in agent.activities)
          (agent: agent, activity: activity),
    ]..sort((a, b) => a.activity.time.compareTo(b.activity.time));
    final running = widget.agents
        .where((agent) => agent.status == 'running')
        .length;
    final failed = widget.agents.any((agent) => agent.status == 'failed');
    final accent = failed
        ? AppPalette.danger
        : running > 0
        ? AppPalette.mint
        : AppPalette.primary;

    return Semantics(
      container: true,
      label: strings.subAgentActivity,
      child: Container(
        key: const Key('sub-agent-work-card'),
        margin: const EdgeInsets.only(bottom: 13),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * 0.92,
        ),
        decoration: BoxDecoration(
          color: AppPalette.panel,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: accent.withValues(alpha: 0.38)),
          boxShadow: [
            BoxShadow(
              color: accent.withValues(alpha: 0.06),
              blurRadius: 24,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(17),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 12, 12, 10),
                child: Row(
                  children: [
                    Container(
                      width: 34,
                      height: 34,
                      decoration: BoxDecoration(
                        color: accent.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(11),
                      ),
                      child: Icon(
                        Icons.account_tree_rounded,
                        color: accent,
                        size: 18,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            strings.subAgentActivity,
                            style: Theme.of(context).textTheme.titleSmall
                                ?.copyWith(
                                  color: AppPalette.text,
                                  fontWeight: FontWeight.w800,
                                ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            widget.agents
                                .map((agent) => agent.name)
                                .join(' · '),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                    _AgentWorkStatus(
                      label: running > 0
                          ? strings.running
                          : failed
                          ? strings.statusFail
                          : strings.statusDone,
                      color: accent,
                      pulse: running > 0,
                    ),
                  ],
                ),
              ),
              Divider(
                height: 1,
                color: AppPalette.stroke.withValues(alpha: 0.8),
              ),
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 236),
                child: activities.isEmpty
                    ? Padding(
                        padding: const EdgeInsets.all(14),
                        child: Row(
                          children: [
                            SizedBox.square(
                              dimension: 14,
                              child: CircularProgressIndicator(
                                strokeWidth: 1.8,
                                color: accent,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                strings.waitingForAgentActivity,
                                style: Theme.of(context).textTheme.bodyMedium,
                              ),
                            ),
                          ],
                        ),
                      )
                    : Scrollbar(
                        controller: _activityController,
                        thumbVisibility: activities.length > 4,
                        child: ListView.builder(
                          key: const Key('sub-agent-activity-list'),
                          controller: _activityController,
                          shrinkWrap: true,
                          padding: const EdgeInsets.symmetric(vertical: 7),
                          itemCount: activities.length,
                          itemBuilder: (context, index) {
                            final entry = activities[index];
                            return _SubAgentActivityRow(
                              agent: entry.agent,
                              activity: entry.activity,
                              isLast: index == activities.length - 1,
                            );
                          },
                        ),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AgentWorkStatus extends StatelessWidget {
  final String label;
  final Color color;
  final bool pulse;

  const _AgentWorkStatus({
    required this.label,
    required this.color,
    required this.pulse,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 9,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.7,
            ),
          ),
        ],
      ),
    );
  }
}

class _SubAgentActivityRow extends StatelessWidget {
  final SubAgentInfo agent;
  final SubAgentActivity activity;
  final bool isLast;

  const _SubAgentActivityRow({
    required this.agent,
    required this.activity,
    required this.isLast,
  });

  @override
  Widget build(BuildContext context) {
    final color = switch (activity.status) {
      'error' => AppPalette.danger,
      'completed' => AppPalette.mint,
      'pending' => AppPalette.textMuted,
      _ => AppPalette.primary,
    };
    final icon = switch (activity.kind) {
      'tool' => Icons.build_rounded,
      'command' => Icons.terminal_rounded,
      _ => Icons.notes_rounded,
    };
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 7, 14, 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 26,
            height: 26,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(icon, size: 14, color: color),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  activity.label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: AppPalette.text,
                    fontWeight: isLast ? FontWeight.w700 : FontWeight.w500,
                  ),
                ),
                if (activity.output?.trim().isNotEmpty == true) ...[
                  const SizedBox(height: 2),
                  Text(
                    activity.output!.replaceAll(RegExp(r'\s+'), ' ').trim(),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
                if (widgetAgentLabel(agent, context).isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    widgetAgentLabel(agent, context),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppPalette.textMuted,
                      fontSize: 9,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  String widgetAgentLabel(SubAgentInfo value, BuildContext context) {
    return value.name;
  }
}

class _MessageCard extends StatelessWidget {
  final ConversationMessage message;
  final VoidCallback onSelectModel;
  final bool hideAgentTool;

  const _MessageCard({
    super.key,
    required this.message,
    required this.onSelectModel,
    this.hideAgentTool = false,
  });

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final user = message.role == 'user';
    final visibleParts = message.parts
        .where(
          (part) => part.type == 'tool'
              ? !(hideAgentTool && part.tool == 'agent')
              : part.type == 'file' || part.text.trim().isNotEmpty,
        )
        .toList();
    if (visibleParts.isEmpty && message.failure == null) {
      return const SizedBox.shrink();
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 13),
      child: Column(
        crossAxisAlignment: user
            ? CrossAxisAlignment.end
            : CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
            child: Text(
              '${user ? strings.you : 'AtomCLI'}  ${DateFormat.Hm(Localizations.localeOf(context).toString()).format(message.time)}',
              style: TextStyle(
                color: user ? AppPalette.primary : AppPalette.mint,
                fontSize: 10,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          for (final part in visibleParts)
            if (part.type == 'tool')
              _ToolPart(part: part)
            else if (part.type == 'file')
              _FilePart(part: part)
            else if (part.type == 'reasoning')
              _ReasoningPart(text: part.text)
            else
              Container(
                constraints: BoxConstraints(
                  maxWidth: MediaQuery.sizeOf(context).width * 0.88,
                ),
                margin: const EdgeInsets.only(bottom: 5),
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 11,
                ),
                decoration: BoxDecoration(
                  color: user ? AppPalette.primarySoft : AppPalette.panel,
                  border: Border.all(
                    color: user
                        ? AppPalette.primary.withValues(alpha: 0.35)
                        : AppPalette.stroke,
                  ),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: MarkdownBody(
                  data: part.text,
                  selectable: true,
                  styleSheet: MarkdownStyleSheet(
                    p: const TextStyle(
                      color: AppPalette.text,
                      fontSize: 14,
                      height: 1.45,
                    ),
                    code: TextStyle(
                      color: AppPalette.primary,
                      backgroundColor: AppPalette.background,
                      fontFamily: 'monospace',
                    ),
                    codeblockDecoration: BoxDecoration(
                      color: AppPalette.background,
                      borderRadius: BorderRadius.circular(9),
                      border: Border.all(color: AppPalette.stroke),
                    ),
                  ),
                ),
              ),
          if (message.failure != null)
            _AssistantFailureCard(
              failure: message.failure!,
              modelId: message.modelId,
              onSelectModel: onSelectModel,
            ),
        ],
      ),
    );
  }
}

class _AssistantFailureCard extends StatelessWidget {
  final ConversationFailure failure;
  final String? modelId;
  final VoidCallback onSelectModel;

  const _AssistantFailureCard({
    required this.failure,
    required this.modelId,
    required this.onSelectModel,
  });

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    return Container(
      key: const Key('assistant-failure-card'),
      constraints: BoxConstraints(
        maxWidth: MediaQuery.sizeOf(context).width * 0.92,
      ),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppPalette.danger.withValues(alpha: 0.08),
        border: Border.all(color: AppPalette.danger.withValues(alpha: 0.45)),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.error_outline_rounded,
                size: 19,
                color: AppPalette.danger,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  strings.responseFailedTitle,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: AppPalette.text,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              if (failure.statusCode != null)
                Text(
                  'HTTP ${failure.statusCode}',
                  style: const TextStyle(
                    color: AppPalette.danger,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 9),
          Text(
            _conversationFailureText(strings, failure),
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: AppPalette.text,
              height: 1.4,
            ),
          ),
          if (modelId?.isNotEmpty == true) ...[
            const SizedBox(height: 8),
            SelectableText(
              modelId!,
              key: const Key('assistant-failure-model'),
              style: const TextStyle(
                color: AppPalette.textMuted,
                fontSize: 11,
                fontFamily: 'monospace',
              ),
            ),
          ],
          const SizedBox(height: 8),
          Text(
            strings.responseFailureHint,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 7),
          TextButton.icon(
            key: const Key('failure-select-model'),
            onPressed: onSelectModel,
            icon: const Icon(Icons.tune_rounded, size: 18),
            label: Text(strings.selectAnotherModel),
          ),
        ],
      ),
    );
  }
}

String _conversationFailureText(
  AppLocalizations strings,
  ConversationFailure failure,
) {
  return switch (failure.statusCode) {
    401 || 403 => strings.providerAuthenticationRequired,
    402 => strings.providerCreditsRequired,
    429 => strings.providerRateLimited,
    _ => failure.message,
  };
}

class _FilePart extends ConsumerWidget {
  final ConversationPart part;

  const _FilePart({required this.part});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final image = part.mime?.startsWith('image/') == true;
    final socket = ref.watch(wsServiceProvider);
    final artifact = ref
        .watch(artifactsProvider)
        .where(
          (item) =>
              item.name == part.filename &&
              (item.sessionId == null || item.sessionId == part.sessionId),
        )
        .firstOrNull;
    Uri? imageUri;
    if (image && socket != null && artifact != null) {
      try {
        imageUri = socket.httpUriForPath(artifact.downloadPath);
      } catch (_) {}
    }
    return Container(
      constraints: BoxConstraints(
        maxWidth: MediaQuery.sizeOf(context).width * 0.88,
      ),
      margin: const EdgeInsets.only(bottom: 5),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppPalette.panel,
        border: Border.all(color: AppPalette.stroke),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (imageUri != null) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Image.network(
                imageUri.toString(),
                width: double.infinity,
                height: 160,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => const SizedBox.shrink(),
              ),
            ),
            const SizedBox(height: 10),
          ],
          Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: AppPalette.primarySoft,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(
                  image
                      ? Icons.image_outlined
                      : Icons.insert_drive_file_outlined,
                  color: AppPalette.primary,
                ),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      part.filename ?? strings.attachment,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.labelLarge,
                    ),
                    const SizedBox(height: 3),
                    Text(
                      part.mime ?? strings.fileAttached,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ToolPart extends StatelessWidget {
  final ConversationPart part;

  const _ToolPart({required this.part});

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final state = part.toolState ?? const <String, dynamic>{};
    final status = state['status'] as String? ?? 'pending';
    final input = state['input'];
    final output = state['output'];
    final error = state['error'];
    final title = state['title'] as String?;
    final command = input is Map ? input['command']?.toString() : null;
    final detail = [
      if (input != null) '${strings.inputLabel}\n${_prettyValue(input)}',
      if (output != null && output.toString().isNotEmpty)
        '${strings.outputLabel}\n${_prettyValue(output)}',
      if (error != null && error.toString().isNotEmpty)
        '${strings.errorLabel}\n${_prettyValue(error)}',
    ].join('\n\n');
    final color = switch (status) {
      'completed' => AppPalette.mint,
      'error' => AppPalette.danger,
      _ => AppPalette.amber,
    };
    return Container(
      constraints: BoxConstraints(
        maxWidth: MediaQuery.sizeOf(context).width * 0.9,
      ),
      margin: const EdgeInsets.only(bottom: 5),
      decoration: BoxDecoration(
        color: AppPalette.surface,
        border: Border.all(color: AppPalette.stroke),
        borderRadius: BorderRadius.circular(12),
      ),
      child: ExpansionTile(
        tilePadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 1),
        childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 13),
        leading: Icon(
          status == 'completed'
              ? Icons.check_circle_outline
              : status == 'error'
              ? Icons.error_outline_rounded
              : Icons.terminal_rounded,
          color: color,
          size: 18,
        ),
        title: Text(
          title ?? part.tool ?? strings.toolLabel,
          style: Theme.of(context).textTheme.labelLarge,
        ),
        subtitle: command == null
            ? null
            : Text(
                command,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(
                  context,
                ).textTheme.bodySmall?.copyWith(fontFamily: 'monospace'),
              ),
        trailing: Text(
          status.toUpperCase(),
          style: Theme.of(context).textTheme.labelSmall?.copyWith(color: color),
        ),
        children: [
          if (detail.isEmpty)
            Align(
              alignment: Alignment.centerLeft,
              child: Text(AppLocalizations.of(context).noCommandDetails),
            )
          else
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(11),
              decoration: BoxDecoration(
                color: AppPalette.background,
                borderRadius: BorderRadius.circular(9),
                border: Border.all(color: AppPalette.stroke),
              ),
              child: SelectableText(
                detail,
                style: const TextStyle(
                  color: AppPalette.textSecondary,
                  fontFamily: 'monospace',
                  fontSize: 11,
                  height: 1.45,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

String _prettyValue(Object value) {
  if (value is String) return value;
  try {
    return const JsonEncoder.withIndent('  ').convert(value);
  } catch (_) {
    return value.toString();
  }
}

String _tokens(int value) {
  if (value >= 1000000) {
    return '${(value / 1000000).toStringAsFixed(value % 1000000 == 0 ? 0 : 1)}M';
  }
  if (value >= 1000) {
    return '${(value / 1000).toStringAsFixed(value % 1000 == 0 ? 0 : 1)}K';
  }
  return '$value';
}

class _ReasoningPart extends StatelessWidget {
  final String text;

  const _ReasoningPart({required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(
        maxWidth: MediaQuery.sizeOf(context).width * 0.9,
      ),
      margin: const EdgeInsets.only(bottom: 5),
      decoration: BoxDecoration(
        color: AppPalette.surface,
        border: Border.all(color: AppPalette.stroke),
        borderRadius: BorderRadius.circular(12),
      ),
      child: ExpansionTile(
        dense: true,
        leading: const Icon(
          Icons.psychology_outlined,
          color: AppPalette.textMuted,
          size: 18,
        ),
        title: Text(
          AppLocalizations.of(context).reasoning,
          style: const TextStyle(fontSize: 12),
        ),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
            child: Text(text, style: Theme.of(context).textTheme.bodySmall),
          ),
        ],
      ),
    );
  }
}

SessionInfo? _findSession(List<SessionInfo> sessions, String? id) {
  if (id == null) return null;
  for (final session in sessions) {
    if (session.id == id) return session;
  }
  return null;
}

String _sessionTitle(SessionInfo session) {
  final title = session.title
      .replaceFirst('New session - ', '')
      .replaceFirst('Child session - ', '')
      .trim();
  return title.isEmpty ? session.id : title;
}

String _errorText(Object error) => error.toString().replaceFirst(
  RegExp(r'^(Bad state|TimeoutException):\s*'),
  '',
);
