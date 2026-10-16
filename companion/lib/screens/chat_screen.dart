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
import '../widgets/adaptive_layout.dart';

part 'chat_widgets.dart';
part 'chat_pickers.dart';
part 'chat_directory_picker.dart';
part 'chat_messages.dart';

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
    final selected = await _pickNewSessionDirectory(context, initial);
    if (selected != null && mounted) {
      ref.read(conversationProvider.notifier).setDirectory(selected);
    }
    return selected;
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

  Future<void> _showModels() => _showModelPicker(context, ref);

  Future<void> _showVariants() => _showVariantPicker(context, ref);

  Future<void> _showAgents() => _showAgentPicker(context, ref);

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
