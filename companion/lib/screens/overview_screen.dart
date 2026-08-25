import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models.dart';
import '../providers/app_providers.dart';
import '../theme/app_theme.dart';
import '../widgets/control_widgets.dart';
import '../services/transfer_service.dart';

class OverviewScreen extends ConsumerWidget {
  const OverviewScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connection = ref.watch(connectionStateProvider);
    final connectionMessage = ref.watch(connectionMessageProvider);
    final permissions = ref.watch(permissionsProvider);
    final questions = ref.watch(questionsProvider);
    final sessions = ref.watch(sessionListProvider);
    final steps = ref.watch(dagProvider);
    final subAgents = ref.watch(subAgentProvider);
    final artifacts = ref.watch(artifactsProvider);
    final previews = ref.watch(previewsProvider);
    final conversation = ref.watch(conversationProvider);
    final models = ref.watch(modelsListProvider);
    final selectedSession = sessions
        .where((session) => session.id == conversation.selectedSessionId)
        .firstOrNull;
    final selectedModel = models
        .where((model) => model.id == conversation.selectedModelId)
        .firstOrNull;
    final attentionCount = permissions.length + questions.length;
    final runningSteps = steps.where((step) => _isRunning(step.status)).length;
    final runningAgents = subAgents
        .where((agent) => agent.status == 'running')
        .length;

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          color: AppPalette.primary,
          backgroundColor: AppPalette.elevated,
          onRefresh: () async {
            final ws = ref.read(wsServiceProvider);
            if (ws?.isConnected == true) ws!.requestSnapshot();
            await Future<void>.delayed(const Duration(milliseconds: 350));
          },
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(18, 18, 18, 28),
                sliver: SliverList.list(
                  children: [
                    _Header(connection: connection),
                    const SizedBox(height: 22),
                    if (connection != WsConnectionState.connected)
                      _LinkHero(
                        state: connection,
                        message: connectionMessage,
                        onOpenLink: () =>
                            ref.read(shellTabProvider.notifier).state = 3,
                      )
                    else
                      _CommandContext(
                        session: selectedSession,
                        model: selectedModel,
                        variant: conversation.selectedVariant,
                        onContinue: () =>
                            ref.read(shellTabProvider.notifier).state = 1,
                      ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: _QuickAction(
                            icon: Icons.add_comment_outlined,
                            label: 'New session',
                            color: AppPalette.primary,
                            onTap: connection == WsConnectionState.connected
                                ? () {
                                    ref
                                        .read(
                                          newSessionRequestProvider.notifier,
                                        )
                                        .state++;
                                    ref.read(shellTabProvider.notifier).state =
                                        1;
                                  }
                                : null,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: _QuickAction(
                            icon: Icons.inbox_outlined,
                            label: attentionCount > 0
                                ? '$attentionCount decisions'
                                : 'Inbox clear',
                            color: attentionCount > 0
                                ? AppPalette.amber
                                : AppPalette.mint,
                            onTap: () =>
                                ref.read(shellTabProvider.notifier).state = 2,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: _QuickAction(
                            icon: Icons.hub_outlined,
                            label: 'Link status',
                            color: AppPalette.mint,
                            onTap: () =>
                                ref.read(shellTabProvider.notifier).state = 3,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),
                    _TransferHub(artifacts: artifacts, previews: previews),
                    if (attentionCount > 0) ...[
                      const SizedBox(height: 24),
                      const SectionLabel('Needs attention'),
                      const SizedBox(height: 10),
                      _AttentionCard(
                        permissions: permissions.length,
                        questions: questions.length,
                        onTap: () =>
                            ref.read(shellTabProvider.notifier).state = 2,
                      ),
                    ],
                    const SizedBox(height: 24),
                    SectionLabel(
                      runningSteps + runningAgents > 0
                          ? 'Live execution'
                          : 'Execution',
                      trailing: steps.isEmpty
                          ? null
                          : Text(
                              '${steps.where((step) => step.status == 'complete').length}/${steps.length}',
                              style: const TextStyle(
                                color: AppPalette.textMuted,
                                fontFamily: 'monospace',
                                fontSize: 11,
                              ),
                            ),
                    ),
                    const SizedBox(height: 10),
                    if (steps.isEmpty && subAgents.isEmpty)
                      const _QuietState(
                        icon: Icons.graphic_eq_rounded,
                        title: 'No active execution',
                        body:
                            'Workflow and agent activity will appear here in real time.',
                      )
                    else
                      ControlPanel(
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        child: Column(
                          children: [
                            for (final step in steps) _StepRow(step: step),
                            for (final agent in subAgents)
                              _AgentRow(
                                agent: agent,
                                onTap: () {
                                  ref
                                      .read(chatJumpToSessionProvider.notifier)
                                      .state = agent
                                      .sessionId;
                                  ref.read(shellTabProvider.notifier).state = 1;
                                },
                              ),
                          ],
                        ),
                      ),
                    const SizedBox(height: 24),
                    SectionLabel(
                      'Recent sessions',
                      trailing: TextButton(
                        onPressed: () =>
                            ref.read(shellTabProvider.notifier).state = 1,
                        child: const Text('View all'),
                      ),
                    ),
                    const SizedBox(height: 6),
                    if (sessions.isEmpty)
                      const _QuietState(
                        icon: Icons.chat_bubble_outline_rounded,
                        title: 'No sessions yet',
                        body:
                            'Create your first session from the Sessions tab.',
                      )
                    else
                      ControlPanel(
                        padding: EdgeInsets.zero,
                        child: Column(
                          children: [
                            for (final session in sessions.take(3))
                              _SessionRow(
                                session: session,
                                onTap: () {
                                  ref
                                      .read(chatJumpToSessionProvider.notifier)
                                      .state = session
                                      .id;
                                  ref.read(shellTabProvider.notifier).state = 1;
                                },
                              ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static bool _isRunning(String status) =>
      status == 'running' || status == 'in_progress' || status.endsWith('ing');
}

class _Header extends StatelessWidget {
  final WsConnectionState connection;

  const _Header({required this.connection});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const AtomMark(),
        const SizedBox(width: 12),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'ATOMCLI',
              style: Theme.of(
                context,
              ).textTheme.labelSmall?.copyWith(color: AppPalette.primary),
            ),
            const SizedBox(height: 2),
            Text('Command deck', style: Theme.of(context).textTheme.titleLarge),
          ],
        ),
        const Spacer(),
        ConnectionBadge(state: connection),
      ],
    );
  }
}

class _LinkHero extends StatelessWidget {
  final WsConnectionState state;
  final String? message;
  final VoidCallback onOpenLink;

  const _LinkHero({
    required this.state,
    required this.message,
    required this.onOpenLink,
  });

  @override
  Widget build(BuildContext context) {
    final connected = state == WsConnectionState.connected;
    final connecting = state == WsConnectionState.connecting;
    final color = connected
        ? AppPalette.mint
        : connecting
        ? AppPalette.amber
        : AppPalette.danger;
    final title = connected
        ? 'Your machine is within reach.'
        : connecting
        ? 'Negotiating a secure command link.'
        : 'Command link interrupted.';
    final body =
        message ??
        (connected
            ? 'Live activity, sessions and decisions are synchronized.'
            : 'Open Link to inspect endpoints or retry the connection.');

    return InkWell(
      onTap: onOpenLink,
      borderRadius: BorderRadius.circular(22),
      child: Ink(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [color.withValues(alpha: 0.16), AppPalette.panel],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: color.withValues(alpha: 0.35)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(
                connected ? Icons.hub_rounded : Icons.link_off_rounded,
                color: color,
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 5),
                  Text(body, style: Theme.of(context).textTheme.bodyMedium),
                ],
              ),
            ),
            const Icon(
              Icons.chevron_right_rounded,
              color: AppPalette.textMuted,
            ),
          ],
        ),
      ),
    );
  }
}

class _CommandContext extends StatelessWidget {
  final SessionInfo? session;
  final ModelInfo? model;
  final String? variant;
  final VoidCallback onContinue;

  const _CommandContext({
    required this.session,
    required this.model,
    required this.variant,
    required this.onContinue,
  });

  @override
  Widget build(BuildContext context) {
    final running = session?.isActive == true;
    final folder = session?.directory.split('/').lastOrNull;
    return InkWell(
      onTap: onContinue,
      borderRadius: BorderRadius.circular(22),
      child: Ink(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              AppPalette.primary.withValues(alpha: 0.18),
              AppPalette.panel,
            ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: AppPalette.primary.withValues(alpha: 0.38)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  running ? 'LIVE SESSION' : 'ACTIVE SESSION',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: running ? AppPalette.mint : AppPalette.primary,
                  ),
                ),
                const Spacer(),
                Icon(
                  running
                      ? Icons.graphic_eq_rounded
                      : Icons.arrow_forward_rounded,
                  color: running ? AppPalette.mint : AppPalette.primary,
                  size: 20,
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              session == null
                  ? 'Start a focused command session'
                  : _cleanSessionTitle(session!),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 7,
              runSpacing: 7,
              children: [
                _ContextTag(
                  Icons.memory_rounded,
                  model?.name ?? 'Choose model',
                ),
                _ContextTag(
                  Icons.psychology_alt_outlined,
                  variant?.toUpperCase() ?? 'DEFAULT',
                ),
                if (folder != null && folder.isNotEmpty)
                  _ContextTag(Icons.folder_outlined, folder),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ContextTag extends StatelessWidget {
  final IconData icon;
  final String label;

  const _ContextTag(this.icon, this.label);

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
    decoration: BoxDecoration(
      color: AppPalette.background.withValues(alpha: 0.72),
      borderRadius: BorderRadius.circular(9),
      border: Border.all(color: AppPalette.stroke),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: AppPalette.textMuted),
        const SizedBox(width: 5),
        ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 180),
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700),
          ),
        ),
      ],
    ),
  );
}

class _QuickAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback? onTap;

  const _QuickAction({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) => Material(
    color: AppPalette.surface,
    borderRadius: BorderRadius.circular(14),
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        height: 72,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppPalette.stroke),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              icon,
              color: onTap == null ? AppPalette.textMuted : color,
              size: 19,
            ),
            const Spacer(),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700),
            ),
          ],
        ),
      ),
    ),
  );
}

class _AttentionCard extends StatelessWidget {
  final int permissions;
  final int questions;
  final VoidCallback onTap;

  const _AttentionCard({
    required this.permissions,
    required this.questions,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final parts = [
      if (permissions > 0)
        '$permissions permission request${permissions == 1 ? '' : 's'}',
      if (questions > 0) '$questions question${questions == 1 ? '' : 's'}',
    ];
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: ControlPanel(
        borderColor: AppPalette.amber.withValues(alpha: 0.45),
        color: AppPalette.amber.withValues(alpha: 0.07),
        child: Row(
          children: [
            const Icon(Icons.inbox_rounded, color: AppPalette.amber),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Waiting for your decision',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 3),
                  Text(
                    parts.join(' and '),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            const Icon(
              Icons.arrow_forward_rounded,
              color: AppPalette.amber,
              size: 19,
            ),
          ],
        ),
      ),
    );
  }
}

String _cleanSessionTitle(SessionInfo session) {
  final title = session.title
      .replaceAll('New session - ', '')
      .replaceAll('Child session - ', '')
      .trim();
  return title.isEmpty ? 'Untitled session' : title;
}

class _QuietState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String body;

  const _QuietState({
    required this.icon,
    required this.title,
    required this.body,
  });

  @override
  Widget build(BuildContext context) {
    return ControlPanel(
      child: Row(
        children: [
          Icon(icon, color: AppPalette.textMuted),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 3),
                Text(body, style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StepRow extends StatelessWidget {
  final DagStep step;

  const _StepRow({required this.step});

  @override
  Widget build(BuildContext context) {
    final color = switch (step.status) {
      'complete' => AppPalette.mint,
      'failed' => AppPalette.danger,
      'running' || 'in_progress' => AppPalette.primary,
      _ => AppPalette.textMuted,
    };
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(step.name, style: Theme.of(context).textTheme.titleMedium),
                if (step.description.isNotEmpty)
                  Text(
                    step.description,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
              ],
            ),
          ),
          Text(
            step.status.toUpperCase(),
            style: TextStyle(
              color: color,
              fontFamily: 'monospace',
              fontSize: 9,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _AgentRow extends StatelessWidget {
  final SubAgentInfo agent;
  final VoidCallback onTap;

  const _AgentRow({required this.agent, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
        child: Row(
          children: [
            const Icon(
              Icons.memory_rounded,
              color: AppPalette.primary,
              size: 18,
            ),
            const SizedBox(width: 11),
            Expanded(
              child: Text(
                agent.name,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            Text(
              agent.status.toUpperCase(),
              style: const TextStyle(
                color: AppPalette.textMuted,
                fontFamily: 'monospace',
                fontSize: 9,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(width: 5),
            const Icon(
              Icons.chevron_right_rounded,
              color: AppPalette.textMuted,
              size: 18,
            ),
          ],
        ),
      ),
    );
  }
}

class _SessionRow extends StatelessWidget {
  final SessionInfo session;
  final VoidCallback onTap;

  const _SessionRow({required this.session, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final cleanTitle = session.title
        .replaceAll('New session - ', '')
        .replaceAll('Child session - ', '')
        .trim();
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 13),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: AppPalette.primarySoft,
                borderRadius: BorderRadius.circular(11),
              ),
              child: const Icon(
                Icons.chat_bubble_outline_rounded,
                color: AppPalette.primary,
                size: 17,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    cleanTitle.isEmpty ? 'Untitled session' : cleanTitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    session.formattedDate,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            const Icon(
              Icons.chevron_right_rounded,
              color: AppPalette.textMuted,
            ),
          ],
        ),
      ),
    );
  }
}

class _TransferHub extends StatelessWidget {
  final List<CompanionArtifact> artifacts;
  final List<CompanionPreview> previews;

  const _TransferHub({required this.artifacts, required this.previews});

  @override
  Widget build(BuildContext context) {
    final incoming = artifacts
        .where((artifact) => artifact.direction == 'pc_to_mobile')
        .toList();
    final sources = <String>{
      ...incoming.map((artifact) => artifact.sourceDevice),
      ...previews.map((preview) => preview.sourceDevice),
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionLabel('Received items'),
        const SizedBox(height: 5),
        Text(
          'Files and live sites sent by your paired machines.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 12),
        if (sources.isEmpty)
          const _QuietState(
            icon: Icons.move_to_inbox_outlined,
            title: 'Nothing received yet',
            body: 'Files and live previews sent from AtomCLI will appear here.',
          ),
        for (final source in sources) ...[
          Row(
            children: [
              const Icon(
                Icons.computer_rounded,
                size: 15,
                color: AppPalette.mint,
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  'From $source',
                  style: Theme.of(context).textTheme.labelLarge,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          for (final preview in previews.where(
            (item) => item.sourceDevice == source,
          ))
            _PreviewCard(preview: preview),
          for (final artifact in incoming.where(
            (item) => item.sourceDevice == source,
          ))
            _ArtifactCard(artifact: artifact),
          const SizedBox(height: 10),
        ],
      ],
    );
  }
}

class _ArtifactCard extends ConsumerStatefulWidget {
  final CompanionArtifact artifact;

  const _ArtifactCard({required this.artifact});

  @override
  ConsumerState<_ArtifactCard> createState() => _ArtifactCardState();
}

class _ArtifactCardState extends ConsumerState<_ArtifactCard> {
  bool _working = false;
  double? _progress;

  void _updateProgress(int transferred, int total) {
    if (!mounted) return;
    setState(() {
      _progress = total > 0 ? transferred / total : null;
    });
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_working) return;
    setState(() {
      _working = true;
      _progress = 0;
    });
    try {
      await action();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(error.toString().replaceFirst('Bad state: ', '')),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _working = false;
          _progress = null;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final artifact = widget.artifact;
    final socket = ref.watch(wsServiceProvider);
    Uri? imageUri;
    if (artifact.kind == 'image' && socket != null) {
      try {
        imageUri = socket.httpUriForPath(artifact.downloadPath);
      } catch (_) {}
    }
    return Container(
      margin: const EdgeInsets.only(bottom: 9),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppPalette.panel,
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: AppPalette.stroke),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (imageUri != null)
            AspectRatio(
              aspectRatio: 16 / 8,
              child: Image.network(
                imageUri.toString(),
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => const ColoredBox(
                  color: AppPalette.surface,
                  child: Center(
                    child: Icon(
                      Icons.broken_image_outlined,
                      color: AppPalette.textMuted,
                    ),
                  ),
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(13, 12, 10, 10),
            child: Row(
              children: [
                Icon(
                  artifact.kind == 'image'
                      ? Icons.image_outlined
                      : Icons.insert_drive_file_outlined,
                  color: AppPalette.primary,
                ),
                const SizedBox(width: 11),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        artifact.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      Text(
                        '${artifact.name}  ${_formatBytes(artifact.size)}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                if (_working)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        SizedBox.square(
                          dimension: 22,
                          child: CircularProgressIndicator(
                            value: _progress,
                            strokeWidth: 2.5,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          _progress == null
                              ? '...'
                              : '${(_progress! * 100).clamp(0, 100).round()}%',
                          style: Theme.of(context).textTheme.labelSmall,
                        ),
                      ],
                    ),
                  )
                else ...[
                  IconButton(
                    tooltip: 'Download and open',
                    onPressed: socket == null
                        ? null
                        : () => _run(
                            () => TransferService.downloadAndOpen(
                              socket: socket,
                              artifact: artifact,
                              onProgress: _updateProgress,
                            ),
                          ),
                    icon: const Icon(Icons.download_rounded),
                  ),
                  IconButton(
                    tooltip: 'Share',
                    onPressed: socket == null
                        ? null
                        : () => _run(
                            () => TransferService.share(
                              socket: socket,
                              artifact: artifact,
                              onProgress: _updateProgress,
                            ),
                          ),
                    icon: const Icon(Icons.share_outlined),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PreviewCard extends ConsumerStatefulWidget {
  final CompanionPreview preview;

  const _PreviewCard({required this.preview});

  @override
  ConsumerState<_PreviewCard> createState() => _PreviewCardState();
}

class _PreviewCardState extends ConsumerState<_PreviewCard> {
  bool _working = false;

  Future<void> _logs() async {
    final socket = ref.read(wsServiceProvider);
    if (socket == null) return;
    setState(() => _working = true);
    try {
      final result = await socket.previewLogs(
        previewId: widget.preview.id,
        directory: widget.preview.directory,
      );
      final raw = result.payload['preview'];
      final preview = raw is Map
          ? CompanionPreview.fromJson(Map<String, dynamic>.from(raw))
          : widget.preview;
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        backgroundColor: AppPalette.panel,
        builder: (_) => SafeArea(
          child: FractionallySizedBox(
            heightFactor: 0.78,
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    preview.title,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    preview.command,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 14),
                  Expanded(
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppPalette.background,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppPalette.stroke),
                      ),
                      child: SingleChildScrollView(
                        child: SelectableText(
                          preview.logTail.trim().isEmpty
                              ? 'No output yet.'
                              : preview.logTail,
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 12,
                            color: AppPalette.text,
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$error')));
      }
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  Future<void> _stop() async {
    final socket = ref.read(wsServiceProvider);
    if (socket == null) return;
    setState(() => _working = true);
    try {
      await socket.stopPreview(
        previewId: widget.preview.id,
        directory: widget.preview.directory,
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$error')));
      }
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final preview = widget.preview;
    final active = preview.status == 'running' || preview.status == 'starting';
    final endpoint = preview.endpoints.firstOrNull;
    final color = preview.status == 'failed'
        ? AppPalette.danger
        : active
        ? AppPalette.mint
        : AppPalette.textMuted;
    return Container(
      margin: const EdgeInsets.only(bottom: 9),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [color.withValues(alpha: 0.12), AppPalette.panel],
        ),
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: color.withValues(alpha: 0.32)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.language_rounded, color: color),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      preview.title,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    Text(
                      endpoint ?? 'Waiting for a reachable address',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(
                        context,
                      ).textTheme.bodySmall?.copyWith(fontFamily: 'monospace'),
                    ),
                  ],
                ),
              ),
              Text(
                preview.status.toUpperCase(),
                style: Theme.of(
                  context,
                ).textTheme.labelSmall?.copyWith(color: color),
              ),
            ],
          ),
          const SizedBox(height: 11),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: endpoint == null || !active || _working
                      ? null
                      : () => TransferService.openPreview(endpoint),
                  icon: const Icon(Icons.open_in_browser_rounded, size: 18),
                  label: const Text('Open'),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                onPressed: _working ? null : _logs,
                icon: const Icon(Icons.terminal_rounded, size: 18),
                label: const Text('Logs'),
              ),
              if (active) ...[
                const SizedBox(width: 8),
                IconButton.outlined(
                  tooltip: 'Stop preview',
                  onPressed: _working ? null : _stop,
                  icon: const Icon(
                    Icons.stop_rounded,
                    color: AppPalette.danger,
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

String _formatBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
  return '${(bytes / 1024 / 1024).toStringAsFixed(1)} MB';
}
