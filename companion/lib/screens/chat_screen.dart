import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../models.dart';
import '../providers/app_providers.dart';
import '../theme/app_theme.dart';
import '../services/companion_preferences.dart';
import '../services/transfer_service.dart';

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key});

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _messageController = TextEditingController();
  final _scrollController = ScrollController();
  bool _sending = false;
  bool _creating = false;
  bool _uploading = false;
  double? _uploadProgress;
  final List<CompanionArtifact> _pendingAttachments = [];
  String? _attachmentSessionId;

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sessions = ref.watch(sessionListProvider);
    final conversation = ref.watch(conversationProvider);
    final connection = ref.watch(connectionStateProvider);
    final messages = conversation.messagesFor(conversation.selectedSessionId);
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
    });

    return Scaffold(
      appBar: AppBar(
        title: const Text('Sessions'),
        actions: [
          IconButton(
            key: const Key('session-history-button'),
            tooltip: 'Session history',
            onPressed: () => _showSessions(sessions),
            icon: Badge(
              isLabelVisible: sessions.isNotEmpty,
              smallSize: 7,
              backgroundColor: AppPalette.amber,
              child: const Icon(Icons.history_rounded),
            ),
          ),
          IconButton(
            key: const Key('new-session-button'),
            tooltip: 'New session',
            onPressed: _creating || connection != WsConnectionState.connected
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
      body: Column(
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
                ? const Center(child: CircularProgressIndicator(strokeWidth: 2))
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
                    itemCount: messages.length,
                    itemBuilder: (_, index) => _MessageCard(
                      key: ValueKey(messages[index].id),
                      message: messages[index],
                    ),
                  ),
          ),
          _Composer(
            controller: _messageController,
            sending: _sending,
            uploading: _uploading,
            uploadProgress: _uploading ? _uploadProgress : null,
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
            onModel: _showModels,
            onAgent: _showAgents,
            onVariant: _showVariants,
          ),
        ],
      ),
    );
  }

  Future<void> _showSessions(List<SessionInfo> sessions) async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppPalette.panel,
      builder: (_) => _SessionPicker(
        sessions: sessions,
        selectedId: ref.read(conversationProvider).selectedSessionId,
      ),
    );
    if (selected != null) {
      await ref.read(conversationProvider.notifier).selectSession(selected);
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
      _showError('This model does not expose configurable thinking levels.');
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
      _showError('AtomCLI is offline.');
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
    final text = _messageController.text.trim();
    if ((text.isEmpty && _pendingAttachments.isEmpty) ||
        _sending ||
        _uploading) {
      return;
    }
    final ws = ref.read(wsServiceProvider);
    if (ws == null || !ws.isConnected) {
      _showError('AtomCLI is offline. Your message was not sent.');
      return;
    }
    final selection = ref.read(conversationProvider);
    if (_pendingAttachments.isNotEmpty &&
        selection.selectedSessionId != _attachmentSessionId) {
      _showError(
        'These attachments belong to another session. Remove them or return to that session.',
      );
      return;
    }
    var directory = selection.selectedDirectory;
    if (selection.selectedSessionId == null) {
      directory = await _chooseNewSessionDirectory(
        directory ?? ref.read(currentDirectoryProvider),
      );
      if (directory == null || !mounted) return;
    }
    setState(() => _sending = true);
    try {
      final attachments = List<CompanionArtifact>.from(_pendingAttachments);
      final sessionId = selection.selectedSessionId;
      if (sessionId == null) {
        await ws.createSession(
          text: text.isEmpty ? 'Review the attached file(s).' : text,
          model: selection.selectedModelId,
          agent: selection.selectedAgentName,
          variant: selection.selectedVariant,
          directory: directory,
        );
      } else {
        await ws.sendChatMessage(
          sessionId: sessionId,
          text: text.isEmpty ? 'Review the attached file(s).' : text,
          model: selection.selectedModelId,
          agent: selection.selectedAgentName,
          variant: selection.selectedVariant,
          directory: selection.selectedDirectory,
          attachments: attachments.map((artifact) => artifact.id).toList(),
        );
      }
      _messageController.clear();
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
      _showError(_errorText(error));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _showAttachmentPicker() async {
    final imageOnly = await showModalBottomSheet<bool>(
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
                leading: const Icon(
                  Icons.image_outlined,
                  color: AppPalette.primary,
                ),
                title: const Text('Photo or image'),
                subtitle: const Text('Attach an image from this phone'),
                onTap: () => Navigator.pop(sheetContext, true),
              ),
              ListTile(
                leading: const Icon(
                  Icons.attach_file_rounded,
                  color: AppPalette.amber,
                ),
                title: const Text('Any file'),
                subtitle: const Text(
                  'Upload a document, archive or source file',
                ),
                onTap: () => Navigator.pop(sheetContext, false),
              ),
            ],
          ),
        ),
      ),
    );
    if (imageOnly == null || !mounted) return;
    await _uploadAttachment(imageOnly: imageOnly);
  }

  Future<void> _uploadAttachment({required bool imageOnly}) async {
    final socket = ref.read(wsServiceProvider);
    final conversation = ref.read(conversationProvider);
    final sessionId = conversation.selectedSessionId;
    if (socket == null || !socket.isConnected) {
      _showError('AtomCLI is offline.');
      return;
    }
    if (sessionId == null) {
      _showError('Create or select a session before attaching a file.');
      return;
    }
    if (_uploading || _pendingAttachments.length >= 10) {
      _showError('You can stage up to 10 attachments at a time.');
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
        });
      }
    }
  }

  Future<String?> _chooseNewSessionDirectory(String? initial) async {
    var selected = initial;
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
                  'New session',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 6),
                Text(
                  'Choose the machine folder AtomCLI should work in.',
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
                      selected?.split('/').lastOrNull ?? 'Choose a folder',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(
                      selected ?? 'Browse the directory tree on your machine',
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
                        child: const Text('Cancel'),
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
                        label: const Text('Create session'),
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
    return Material(
      color: AppPalette.surface,
      child: InkWell(
        key: const Key('active-session-header'),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 11, 8, 11),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                connected ? Icons.forum_rounded : Icons.cloud_off_outlined,
                color: connected ? AppPalette.mint : AppPalette.textMuted,
                size: 20,
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      session == null
                          ? 'No active session'
                          : _sessionTitle(session!),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    Text(
                      session == null
                          ? '$sessionCount saved sessions'
                          : '${session!.formattedDate}  ·  tap for history',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              if (onStop != null)
                IconButton.filledTonal(
                  key: const Key('stop-session-button'),
                  tooltip: 'Stop running agent',
                  onPressed: onStop,
                  icon: const Icon(
                    Icons.stop_rounded,
                    color: AppPalette.danger,
                    size: 19,
                  ),
                )
              else if (onRefresh != null)
                IconButton(
                  tooltip: 'Reload messages',
                  onPressed: onRefresh,
                  icon: const Icon(Icons.refresh_rounded, size: 19),
                ),
              const Icon(
                Icons.unfold_more_rounded,
                color: AppPalette.textMuted,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _WorkflowStrip extends ConsumerWidget {
  const _WorkflowStrip();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final directory = ref.watch(
      conversationProvider.select((state) => state.selectedDirectory),
    );
    final allSteps = ref.watch(dagProvider);
    final steps = directory == null
        ? allSteps
        : allSteps.where((step) => step.directory == directory).toList();
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
              'Workflow  $complete/${steps.length}',
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
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.chat_bubble_outline_rounded,
              color: AppPalette.primary,
              size: 42,
            ),
            const SizedBox(height: 14),
            Text(
              hasSession
                  ? 'This session has no messages'
                  : 'Choose a session or start a new one',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 7),
            Text(
              hasSession
                  ? 'Send a message below to begin.'
                  : 'Your full AtomCLI session history is available here.',
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
                    child: const Text('Open history'),
                  ),
                  const SizedBox(width: 10),
                  FilledButton(
                    onPressed: onCreate,
                    child: const Text('New session'),
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

class _Composer extends ConsumerWidget {
  final TextEditingController controller;
  final bool sending;
  final bool uploading;
  final double? uploadProgress;
  final List<CompanionArtifact> attachments;
  final ValueChanged<CompanionArtifact> onRemoveAttachment;
  final bool connected;
  final VoidCallback onSend;
  final VoidCallback onAttach;
  final VoidCallback onModel;
  final VoidCallback onAgent;
  final VoidCallback onVariant;

  const _Composer({
    required this.controller,
    required this.sending,
    required this.uploading,
    required this.uploadProgress,
    required this.attachments,
    required this.onRemoveAttachment,
    required this.connected,
    required this.onSend,
    required this.onAttach,
    required this.onModel,
    required this.onAgent,
    required this.onVariant,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final conversation = ref.watch(conversationProvider);
    final models = ref.watch(modelsListProvider);
    ModelInfo? model;
    for (final candidate in models) {
      if (candidate.id == conversation.selectedModelId) model = candidate;
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
          Container(
            height: 42,
            decoration: BoxDecoration(
              color: AppPalette.panel,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppPalette.stroke),
            ),
            child: Row(
              children: [
                Expanded(
                  child: _RuntimeButton(
                    key: const Key('model-selector'),
                    icon: Icons.memory_rounded,
                    label: model?.name ?? 'Select model',
                    accent: AppPalette.primary,
                    onTap: onModel,
                  ),
                ),
                const VerticalDivider(width: 1),
                _RuntimeButton(
                  key: const Key('variant-selector'),
                  icon: Icons.psychology_alt_outlined,
                  label:
                      conversation.selectedVariant?.toUpperCase() ?? 'DEFAULT',
                  accent: AppPalette.amber,
                  onTap: onVariant,
                ),
                const VerticalDivider(width: 1),
                _RuntimeButton(
                  key: const Key('agent-selector'),
                  icon: Icons.smart_toy_outlined,
                  label: conversation.selectedAgentName ?? 'Agent',
                  accent: AppPalette.mint,
                  onTap: onAgent,
                ),
              ],
            ),
          ),
          const SizedBox(height: 9),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              IconButton(
                tooltip: 'Attach file',
                onPressed: connected && !sending && !uploading
                    ? onAttach
                    : null,
                icon: const Icon(Icons.add_circle_outline_rounded),
              ),
              const SizedBox(width: 4),
              Expanded(
                child: TextField(
                  key: const Key('message-input'),
                  controller: controller,
                  enabled: connected && !sending,
                  minLines: 1,
                  maxLines: 5,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: InputDecoration(
                    hintText: connected
                        ? 'Message AtomCLI'
                        : 'Waiting for AtomCLI',
                  ),
                ),
              ),
              const SizedBox(width: 8),
              IconButton.filled(
                key: const Key('send-message-button'),
                tooltip: 'Send',
                onPressed: connected && !sending && !uploading ? onSend : null,
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
            ],
          ),
        ],
      ),
    );
  }
}

class _DraftAttachment extends ConsumerWidget {
  final CompanionArtifact artifact;
  final VoidCallback onRemove;

  const _DraftAttachment({required this.artifact, required this.onRemove});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
                  _attachmentBytes(artifact.size),
                  style: Theme.of(context).textTheme.labelSmall,
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Remove attachment',
            visualDensity: VisualDensity.compact,
            onPressed: onRemove,
            icon: const Icon(Icons.close_rounded, size: 17),
          ),
        ],
      ),
    );
  }
}

String _attachmentBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}

class _RuntimeButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color accent;
  final VoidCallback onTap;

  const _RuntimeButton({
    super.key,
    required this.icon,
    required this.label,
    required this.accent,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10),
          child: Row(
            children: [
              Icon(icon, color: accent, size: 16),
              const SizedBox(width: 6),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 150),
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
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

class _SessionPicker extends StatefulWidget {
  final List<SessionInfo> sessions;
  final String? selectedId;

  const _SessionPicker({required this.sessions, required this.selectedId});

  @override
  State<_SessionPicker> createState() => _SessionPickerState();
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
      title: 'Session history',
      count: widget.sessions.length,
      searchHint: 'Search sessions',
      onSearch: (value) => setState(() => _query = value),
      child: sessions.isEmpty
          ? const _PickerEmpty('No matching sessions')
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
                    '${session.formattedDate}  ·  ${session.directory.split('/').last}\n${session.directory}',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  trailing: session.isActive
                      ? const Text(
                          'RUNNING',
                          style: TextStyle(color: AppPalette.mint, fontSize: 9),
                        )
                      : selected
                      ? const Icon(Icons.check_rounded)
                      : null,
                  onTap: () => Navigator.pop(context, session.id),
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
    final sections = _modelSections(filtered, preferences);
    return _PickerFrame(
      title: 'Models',
      count: widget.models.length,
      searchHint: 'Search model, provider or family',
      onSearch: (value) => setState(() => _query = value),
      filters: [
        FilterChip(
          selected: _freeOnly,
          onSelected: (value) => setState(() => _freeOnly = value),
          avatar: const Icon(Icons.savings_outlined, size: 15),
          label: const Text('Free'),
        ),
        FilterChip(
          selected: _reasoningOnly,
          onSelected: (value) => setState(() => _reasoningOnly = value),
          avatar: const Icon(Icons.psychology_alt_outlined, size: 15),
          label: const Text('Reasoning'),
        ),
        FilterChip(
          selected: _favoritesOnly,
          onSelected: (value) => setState(() => _favoritesOnly = value),
          avatar: const Icon(Icons.star_outline_rounded, size: 15),
          label: const Text('Favorites'),
        ),
      ],
      child: filtered.isEmpty
          ? const _PickerEmpty('No connected models were returned by AtomCLI')
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
    if (recent.isNotEmpty) result.add(('Recent', recent));
    final favorites = take(preferences.favoriteModels);
    if (favorites.isNotEmpty) result.add(('Favorites', favorites));

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
                          const Text(
                            'FREE',
                            style: TextStyle(
                              color: AppPalette.mint,
                              fontSize: 9,
                            ),
                          ),
                        if (model.reasoning)
                          const Text(
                            'THINK',
                            style: TextStyle(
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
                tooltip: favorite ? 'Remove favorite' : 'Add favorite',
                onPressed: onFavorite,
                icon: Icon(
                  favorite ? Icons.star_rounded : Icons.star_outline_rounded,
                  color: favorite ? AppPalette.amber : AppPalette.textMuted,
                ),
              ),
              if (selected)
                const Icon(Icons.check_rounded, color: AppPalette.primary),
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
              'Thinking effort',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 5),
            Text(
              'Only levels supported by the selected model are shown.',
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
                      ? 'Model default'
                      : level.toUpperCase(),
                ),
                subtitle: level == '__default__'
                    ? const Text('Use the provider model default')
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

  @override
  void initState() {
    super.initState();
    _load(widget.initialPath);
  }

  Future<void> _load(String? path) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final ws = ref.read(wsServiceProvider);
      if (ws == null) throw StateError('AtomCLI is offline');
      final listing = await ws.listDirectories(path: path);
      if (!mounted) return;
      setState(() => _listing = listing);
    } catch (error) {
      if (path != null) {
        try {
          final ws = ref.read(wsServiceProvider);
          if (ws == null) throw StateError('AtomCLI is offline');
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
                    tooltip: 'Parent folder',
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
                          'Working directory',
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        Text(
                          listing?.path ??
                              widget.initialPath ??
                              'Loading machine folders',
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
                        ? 'Hide hidden folders'
                        : 'Show hidden folders',
                    onPressed: () => setState(() => _showHidden = !_showHidden),
                    icon: Icon(
                      _showHidden
                          ? Icons.visibility_off_outlined
                          : Icons.visibility_outlined,
                    ),
                  ),
                  IconButton(
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
                  ? const _PickerEmpty('This folder has no child folders')
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
                label: const Text('Use this folder'),
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
      title: 'Agent',
      count: agents.length,
      child: agents.isEmpty
          ? const _PickerEmpty('No primary agents were returned by AtomCLI')
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

class _MessageCard extends StatelessWidget {
  final ConversationMessage message;

  const _MessageCard({super.key, required this.message});

  @override
  Widget build(BuildContext context) {
    final user = message.role == 'user';
    final visibleParts = message.parts
        .where(
          (part) =>
              part.type == 'tool' ||
              part.type == 'file' ||
              part.text.trim().isNotEmpty,
        )
        .toList();
    if (visibleParts.isEmpty) return const SizedBox.shrink();
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
              '${user ? 'You' : 'AtomCLI'}  ${DateFormat('HH:mm').format(message.time)}',
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
                    code: const TextStyle(
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
        ],
      ),
    );
  }
}

class _FilePart extends ConsumerWidget {
  final ConversationPart part;

  const _FilePart({required this.part});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
                      part.filename ?? 'Attachment',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.labelLarge,
                    ),
                    const SizedBox(height: 3),
                    Text(
                      part.mime ?? 'File attached to this session',
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
    final state = part.toolState ?? const <String, dynamic>{};
    final status = state['status'] as String? ?? 'pending';
    final input = state['input'];
    final output = state['output'];
    final error = state['error'];
    final title = state['title'] as String?;
    final command = input is Map ? input['command']?.toString() : null;
    final detail = [
      if (input != null) 'INPUT\n${_prettyValue(input)}',
      if (output != null && output.toString().isNotEmpty)
        'OUTPUT\n${_prettyValue(output)}',
      if (error != null && error.toString().isNotEmpty)
        'ERROR\n${_prettyValue(error)}',
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
          title ?? part.tool ?? 'tool',
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
            const Align(
              alignment: Alignment.centerLeft,
              child: Text('No command details were returned.'),
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
        title: const Text('Reasoning', style: TextStyle(fontSize: 12)),
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
