part of 'chat_screen.dart';

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
              : part.type == 'file' ||
                    part.type == 'checkpoint' ||
                    part.text.trim().isNotEmpty,
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
            else if (part.type == 'checkpoint')
              _CheckpointPart(part: part)
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
      child: Material(
        type: MaterialType.transparency,
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
            style: Theme.of(
              context,
            ).textTheme.labelSmall?.copyWith(color: color),
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

class _CheckpointPart extends StatelessWidget {
  final ConversationPart part;

  const _CheckpointPart({required this.part});

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final checkpoint = part.checkpoint;
    if (checkpoint == null) return const SizedBox.shrink();
    final color = switch (checkpoint.decision) {
      'finish' => AppPalette.mint,
      'blocked' => AppPalette.danger,
      _ => AppPalette.amber,
    };
    final decisionLabel = switch (checkpoint.decision) {
      'finish' => strings.checkpointDecisionFinish,
      'blocked' => strings.checkpointDecisionBlocked,
      _ => strings.checkpointDecisionContinue,
    };
    Widget section(String title, List<String> items) => Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: Theme.of(
              context,
            ).textTheme.labelSmall?.copyWith(color: AppPalette.textMuted),
          ),
          const SizedBox(height: 3),
          for (final item in items)
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Text(
                '• $item',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
        ],
      ),
    );
    final allowance = checkpoint.runtime?.allowance;
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
      child: Material(
        type: MaterialType.transparency,
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 1),
          childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 13),
          leading: Icon(Icons.flag_outlined, color: color, size: 18),
          title: Text(
            strings.checkpointSequence(checkpoint.sequence),
            style: Theme.of(context).textTheme.labelLarge,
          ),
          subtitle: checkpoint.progressSummary.isEmpty
              ? null
              : Text(
                  checkpoint.progressSummary,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
          trailing: Text(
            decisionLabel.toUpperCase(),
            style: Theme.of(
              context,
            ).textTheme.labelSmall?.copyWith(color: color),
          ),
          children: [
            if (checkpoint.progressSummary.isNotEmpty)
              section(strings.checkpointProgress, [checkpoint.progressSummary]),
            if (checkpoint.objectiveAssessment.isNotEmpty)
              section(strings.checkpointObjective, [
                checkpoint.objectiveAssessment,
              ]),
            if (checkpoint.discoveries.isNotEmpty)
              section(strings.checkpointDiscoveries, checkpoint.discoveries),
            if (checkpoint.completedWork.isNotEmpty)
              section(strings.checkpointCompleted, checkpoint.completedWork),
            if (checkpoint.remainingWork.isNotEmpty)
              section(strings.checkpointRemaining, checkpoint.remainingWork),
            if (checkpoint.failures.isNotEmpty)
              section(strings.checkpointFailures, checkpoint.failures),
            if (checkpoint.blockers.isNotEmpty)
              section(strings.checkpointBlockers, checkpoint.blockers),
            if (checkpoint.routeAssessment.isNotEmpty)
              section(strings.checkpointRouteAssessment, [
                checkpoint.routeAssessment,
              ]),
            if (checkpoint.selfCritique.isNotEmpty)
              section(strings.checkpointSelfCritique, [checkpoint.selfCritique]),
            if (checkpoint.routeDecision == 'revise')
              section(strings.checkpointRouteDecision, [
                'revise',
              ]),
            if (checkpoint.failedApproaches.isNotEmpty)
              section(
                strings.checkpointFailedApproaches,
                checkpoint.failedApproaches,
              ),
            if (checkpoint.whatToChanges.isNotEmpty)
              section(strings.checkpointWhatToChanges, checkpoint.whatToChanges),
            if (checkpoint.nextActions.isNotEmpty)
              section(strings.checkpointNextActions, checkpoint.nextActions),
            if (allowance != null)
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  '${strings.checkpointAllowance}: '
                  '${allowance.used}/${allowance.limit} · '
                  '${allowance.toolCalls} · +${allowance.extensions}',
                  style: Theme.of(
                    context,
                  ).textTheme.labelSmall?.copyWith(color: AppPalette.textMuted),
                ),
              ),
          ],
        ),
      ),
    );
  }
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
      child: Material(
        type: MaterialType.transparency,
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


