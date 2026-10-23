part of 'chat_screen.dart';

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
      child: SingleChildScrollView(
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
              Wrap(
                alignment: WrapAlignment.center,
                spacing: 10,
                runSpacing: 8,
                children: [
                  OutlinedButton(
                    onPressed: onHistory,
                    child: Text(strings.openHistory),
                  ),
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
