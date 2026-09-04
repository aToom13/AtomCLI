import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../models.dart';
import '../l10n/app_localizations.dart';
import '../l10n/localized_status.dart';
import '../providers/app_providers.dart';
import 'preview_screen.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import '../widgets/control_widgets.dart';
import '../services/transfer_service.dart';

class OverviewScreen extends ConsumerWidget {
  const OverviewScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final connection = ref.watch(connectionStateProvider);
    final connectionMessage = ref.watch(connectionMessageProvider);
    final connectionDetail = ref.watch(connectionDetailProvider);
    final permissions = ref.watch(permissionsProvider);
    final questions = ref.watch(questionsProvider);
    final sessions = ref.watch(sessionListProvider);
    final steps = ref.watch(dagProvider);
    final subAgents = ref.watch(subAgentProvider);
    final conversation = ref.watch(conversationProvider);
    final activeProfile = AuthService.instance.activeProfile;
    final screenWidth = MediaQuery.sizeOf(context).width;
    final horizontalPadding = screenWidth > 1156
        ? (screenWidth - 1120) / 2
        : 18.0;
    final selectedSession = sessions
        .where((session) => session.id == conversation.selectedSessionId)
        .firstOrNull;
    final missionSessionIds = _missionSessionScope(
      selectedSession?.id,
      subAgents,
    );
    final scopedSteps = steps
        .where((step) => missionSessionIds.contains(step.sessionId))
        .toList();
    final scopedAgents = subAgents
        .where((agent) => missionSessionIds.contains(agent.sessionId))
        .toList();
    final scopedPermissions = permissions
        .where((item) => missionSessionIds.contains(item.sessionId))
        .toList();
    final scopedQuestions = questions
        .where((item) => missionSessionIds.contains(item.sessionId))
        .toList();
    final attentionCount = permissions.length + questions.length;
    final runningSteps = scopedSteps
        .where((step) => _isRunning(step.status))
        .length;
    final runningAgents = scopedAgents
        .where((agent) => agent.status == 'running')
        .length;
    final focusedWorkflow = ref.watch(missionFocusWorkflowProvider);
    final missions =
        MissionInfo.assemble(
          steps: scopedSteps,
          agents: scopedAgents,
          permissions: scopedPermissions,
          questions: scopedQuestions,
        )..sort(
          (a, b) => (a.workflowId == focusedWorkflow ? 0 : 1).compareTo(
            b.workflowId == focusedWorkflow ? 0 : 1,
          ),
        );

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
                padding: EdgeInsets.fromLTRB(
                  horizontalPadding,
                  18,
                  horizontalPadding,
                  28,
                ),
                sliver: SliverList.list(
                  children: [
                    _Header(connection: connection),
                    if (activeProfile != null) ...[
                      const SizedBox(height: 14),
                      _ProfileContextStrip(
                        profile: activeProfile,
                        onTap: () => ref.read(shellTabProvider.notifier).state =
                            ShellTab.devices,
                      ),
                    ],
                    const SizedBox(height: 18),
                    if (connection != WsConnectionState.connected)
                      _LinkHero(
                        state: connection,
                        message:
                            localizedConnectionStatus(
                              context,
                              connectionDetail,
                            ) ??
                            connectionMessage,
                        onOpenLink: () =>
                            ref.read(shellTabProvider.notifier).state =
                                ShellTab.devices,
                      )
                    else
                      _CommandContext(
                        session: selectedSession,
                        onContinue: () =>
                            ref.read(shellTabProvider.notifier).state =
                                ShellTab.chat,
                      ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: _QuickAction(
                            icon: Icons.add_comment_outlined,
                            label: strings.newSession,
                            color: AppPalette.primary,
                            onTap: connection == WsConnectionState.connected
                                ? () {
                                    ref
                                        .read(
                                          newSessionRequestProvider.notifier,
                                        )
                                        .state++;
                                    ref.read(shellTabProvider.notifier).state =
                                        ShellTab.chat;
                                  }
                                : null,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: _QuickAction(
                            icon: Icons.inbox_outlined,
                            label: attentionCount > 0
                                ? strings.decisionsWaiting(attentionCount)
                                : strings.tabInbox,
                            color: attentionCount > 0
                                ? AppPalette.amber
                                : AppPalette.mint,
                            onTap: () =>
                                ref.read(shellTabProvider.notifier).state =
                                    ShellTab.requests,
                          ),
                        ),
                      ],
                    ),
                    if (attentionCount > 0) ...[
                      const SizedBox(height: 24),
                      SectionLabel(strings.needsAttention),
                      const SizedBox(height: 10),
                      _AttentionCard(
                        permissions: permissions.length,
                        questions: questions.length,
                        onTap: () => ref.read(shellTabProvider.notifier).state =
                            ShellTab.requests,
                      ),
                    ],
                    const SizedBox(height: 24),
                    SectionLabel(
                      runningSteps + runningAgents > 0
                          ? strings.liveExecution
                          : strings.execution,
                      trailing: scopedSteps.isEmpty
                          ? null
                          : Text(
                              '${scopedSteps.where((step) => step.status == 'complete').length}/${scopedSteps.length}',
                              style: const TextStyle(
                                color: AppPalette.textMuted,
                                fontFamily: 'monospace',
                                fontSize: 11,
                              ),
                            ),
                    ),
                    const SizedBox(height: 10),
                    if (missions.isEmpty)
                      _QuietState(
                        icon: Icons.graphic_eq_rounded,
                        title: strings.noActiveExecution,
                        body: strings.executionEmptyBody,
                      )
                    else
                      Column(
                        children: [
                          for (final mission in missions) ...[
                            _MissionCard(
                              mission: mission,
                              focused: mission.workflowId == focusedWorkflow,
                            ),
                            if (mission != missions.last)
                              const SizedBox(height: 10),
                          ],
                        ],
                      ),
                    const SizedBox(height: 24),
                    SectionLabel(
                      strings.recentSessions,
                      trailing: TextButton(
                        onPressed: () =>
                            ref.read(shellTabProvider.notifier).state =
                                ShellTab.chat,
                        child: Text(strings.viewAll),
                      ),
                    ),
                    const SizedBox(height: 6),
                    if (sessions.isEmpty)
                      _QuietState(
                        icon: Icons.chat_bubble_outline_rounded,
                        title: strings.noSessionsYet,
                        body: strings.noSessionsBody,
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
                                  ref.read(shellTabProvider.notifier).state =
                                      ShellTab.chat;
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
    final strings = AppLocalizations.of(context);
    return Row(
      children: [
        const AtomMark(),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'ATOMCLI',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(
                  context,
                ).textTheme.labelSmall?.copyWith(color: AppPalette.primary),
              ),
              const SizedBox(height: 2),
              Text(
                strings.commandDeck,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        ConnectionBadge(state: connection),
      ],
    );
  }
}

Set<String> _missionSessionScope(
  String? selectedSessionId,
  List<SubAgentInfo> agents,
) {
  if (selectedSessionId == null) return const {};
  final sessionIds = <String>{selectedSessionId};
  var changed = true;
  while (changed) {
    changed = false;
    for (final agent in agents) {
      if (agent.parentSessionId != null &&
          sessionIds.contains(agent.parentSessionId) &&
          sessionIds.add(agent.sessionId)) {
        changed = true;
      }
    }
  }
  return sessionIds;
}

class _ProfileContextStrip extends StatelessWidget {
  final PairedMachineProfile profile;
  final VoidCallback onTap;

  const _ProfileContextStrip({required this.profile, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final directory = profile.projectDirectory.trim();
    final project = directory.isEmpty
        ? strings.unknownProjectShort
        : directory
                  .split(RegExp(r'[/\\]'))
                  .where((part) => part.isNotEmpty)
                  .lastOrNull ??
              directory;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Ink(
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
        decoration: BoxDecoration(
          color: AppPalette.panel,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppPalette.stroke),
        ),
        child: Row(
          children: [
            Icon(
              Icons.account_tree_outlined,
              size: 19,
              color: AppPalette.primary,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: profile.machineName,
                      style: const TextStyle(color: AppPalette.text),
                    ),
                    const TextSpan(text: '  ›  '),
                    TextSpan(
                      text: project,
                      style: const TextStyle(color: AppPalette.textSecondary),
                    ),
                  ],
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 11),
              ),
            ),
            const Icon(
              Icons.swap_horiz_rounded,
              size: 18,
              color: AppPalette.textMuted,
            ),
          ],
        ),
      ),
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
    final strings = AppLocalizations.of(context);
    final connected = state == WsConnectionState.connected;
    final connecting = state == WsConnectionState.connecting;
    final color = connected
        ? AppPalette.mint
        : connecting
        ? AppPalette.amber
        : AppPalette.danger;
    final title = connected
        ? strings.machineReachable
        : connecting
        ? strings.negotiatingLink
        : strings.linkInterrupted;
    final body =
        message ?? (connected ? strings.liveSyncBody : strings.openLinkHelp);

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
  final VoidCallback onContinue;

  const _CommandContext({required this.session, required this.onContinue});

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final running = session?.isActive == true;
    final folder = session?.directory.split('/').lastOrNull;
    return InkWell(
      onTap: onContinue,
      borderRadius: BorderRadius.circular(18),
      child: Ink(
        padding: const EdgeInsets.all(17),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              AppPalette.primary.withValues(alpha: 0.18),
              AppPalette.panel,
            ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: AppPalette.primary.withValues(alpha: 0.38)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  running ? strings.liveSession : strings.activeSession,
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
                  ? strings.startFocusedSession
                  : _cleanSessionTitle(session!, strings.untitledSession),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            if (folder != null && folder.isNotEmpty) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  const Icon(
                    Icons.folder_outlined,
                    size: 15,
                    color: AppPalette.textMuted,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      folder,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
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
        height: 58,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppPalette.stroke),
        ),
        child: Row(
          children: [
            Icon(
              icon,
              color: onTap == null ? AppPalette.textMuted : color,
              size: 19,
            ),
            const SizedBox(width: 9),
            Expanded(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const Icon(
              Icons.arrow_forward_rounded,
              size: 16,
              color: AppPalette.textMuted,
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
    final strings = AppLocalizations.of(context);
    final parts = [
      if (permissions > 0) strings.permissionCount(permissions),
      if (questions > 0) strings.questionCount(questions),
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
                    strings.waitingDecision,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 3),
                  Text(
                    parts.length == 2
                        ? strings.andJoin(parts.first, parts.last)
                        : parts.single,
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

String _cleanSessionTitle(SessionInfo session, String untitled) {
  final title = session.title
      .replaceAll('New session - ', '')
      .replaceAll('Child session - ', '')
      .trim();
  return title.isEmpty ? untitled : title;
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

class _MissionCard extends ConsumerStatefulWidget {
  final MissionInfo mission;
  final bool focused;

  const _MissionCard({required this.mission, required this.focused});

  @override
  ConsumerState<_MissionCard> createState() => _MissionCardState();
}

class _MissionCardState extends ConsumerState<_MissionCard> {
  bool _submitting = false;

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final mission = widget.mission;
    final socket = ref.watch(wsServiceProvider);
    final canPause =
        socket?.isConnected == true &&
        socket!.capabilities.contains('missions.control');
    final canStop =
        socket?.isConnected == true &&
        socket!.capabilities.contains('sessions.manage');
    final color = switch (mission.status) {
      MissionStatus.running => AppPalette.primary,
      MissionStatus.waiting => AppPalette.amber,
      MissionStatus.paused => AppPalette.amber,
      MissionStatus.completed => AppPalette.mint,
      MissionStatus.failed => AppPalette.danger,
    };
    final label = switch (mission.status) {
      MissionStatus.running => strings.statusLive,
      MissionStatus.waiting => strings.statusWait,
      MissionStatus.paused => strings.statusPaused,
      MissionStatus.completed => strings.statusDone,
      MissionStatus.failed => strings.statusFail,
    };
    final workflow = mission.workflowId;
    final title = workflow == null
        ? strings.sessionMission
        : workflow.length <= 22
        ? workflow
        : '${workflow.substring(0, 19)}…';
    final rootAgents = mission.agents
        .where(
          (agent) =>
              agent.parentStepId == null ||
              !mission.steps.any((step) => step.stepId == agent.parentStepId),
        )
        .toList();

    return ControlPanel(
      borderColor: widget.focused ? AppPalette.primary : AppPalette.stroke,
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 13, 14, 10),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 3),
                      Text(
                        mission.steps.isEmpty
                            ? strings.agentCount(mission.agents.length)
                            : strings.missionCounts(
                                mission.completedSteps,
                                mission.steps.length,
                                mission.agents.length,
                              ),
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    label,
                    style: TextStyle(
                      color: color,
                      fontFamily: 'monospace',
                      fontSize: 9,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (mission.steps.isNotEmpty)
            Semantics(
              container: true,
              label: strings.missionProgressAccessibility(
                mission.completedSteps,
                mission.steps.length,
              ),
              value:
                  '${((mission.completedSteps / mission.steps.length) * 100).round()}%',
              child: ExcludeSemantics(
                child: LinearProgressIndicator(
                  value: mission.completedSteps / mission.steps.length,
                  minHeight: 2,
                  color: color,
                  backgroundColor: AppPalette.stroke,
                ),
              ),
            ),
          for (final step in mission.steps) ...[
            _StepRow(step: step),
            for (final agent in mission.agents.where(
              (agent) =>
                  agent.parentStepId != null &&
                  agent.parentStepId == step.stepId,
            ))
              _AgentRow(
                agent: agent,
                onTap: () => _openSession(agent.sessionId),
                nested: true,
              ),
          ],
          for (final agent in rootAgents)
            _AgentRow(agent: agent, onTap: () => _openSession(agent.sessionId)),
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 7, 10, 10),
            child: Wrap(
              spacing: 7,
              runSpacing: 7,
              children: [
                if (mission.pendingDecisions > 0)
                  FilledButton.icon(
                    key: ValueKey('mission-decisions-${mission.id}'),
                    onPressed: () => ref.read(shellTabProvider.notifier).state =
                        ShellTab.requests,
                    icon: const Icon(Icons.rule_rounded, size: 17),
                    label: Text(
                      strings.decisionCount(mission.pendingDecisions),
                    ),
                  ),
                if (mission.sessionId != null &&
                    mission.status == MissionStatus.running &&
                    canPause)
                  OutlinedButton.icon(
                    key: ValueKey('mission-pause-${mission.id}'),
                    onPressed: _submitting ? null : () => _control(stop: false),
                    icon: const Icon(Icons.pause_rounded, size: 17),
                    label: Text(strings.pause),
                  ),
                if (mission.sessionId != null &&
                    mission.status != MissionStatus.completed &&
                    mission.status != MissionStatus.failed &&
                    canStop)
                  OutlinedButton.icon(
                    key: ValueKey('mission-stop-${mission.id}'),
                    onPressed: _submitting ? null : () => _control(stop: true),
                    icon: const Icon(Icons.stop_rounded, size: 17),
                    label: Text(strings.stop),
                  ),
                if (mission.sessionId != null)
                  TextButton.icon(
                    onPressed: () => _openSession(mission.sessionId!),
                    icon: const Icon(Icons.forum_outlined, size: 17),
                    label: Text(strings.open),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _openSession(String sessionId) {
    ref.read(chatJumpToSessionProvider.notifier).state = sessionId;
    ref.read(shellTabProvider.notifier).state = ShellTab.chat;
  }

  Future<void> _control({required bool stop}) async {
    final strings = AppLocalizations.of(context);
    final ws = ref.read(wsServiceProvider);
    final sessionId = widget.mission.sessionId;
    if (ws?.isConnected != true || sessionId == null) {
      _message(strings.missionOffline);
      return;
    }
    if (stop) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(strings.stopMissionQuestion),
          content: Text(strings.missionStopBody),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(strings.cancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(strings.stop),
            ),
          ],
        ),
      );
      if (confirmed != true || !mounted) return;
    }
    setState(() => _submitting = true);
    try {
      final result = stop
          ? await ws!.abortSession(
              sessionId: sessionId,
              directory: widget.mission.directory,
            )
          : await ws!.pauseSession(
              sessionId: sessionId,
              directory: widget.mission.directory,
            );
      if (!result.isOk) {
        throw StateError(result.error ?? strings.missionControlFailed);
      }
      if (mounted) {
        _message(stop ? strings.missionStopped : strings.missionPaused);
      }
    } catch (error) {
      if (mounted) _message(error.toString().replaceFirst('Bad state: ', ''));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  void _message(String value) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }
}

class _StepRow extends StatelessWidget {
  final DagStep step;

  const _StepRow({required this.step});

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final status = _localizedExecutionStatus(strings, step.status);
    final color = switch (step.status) {
      'complete' => AppPalette.mint,
      'failed' => AppPalette.danger,
      'running' || 'in_progress' => AppPalette.primary,
      _ => AppPalette.textMuted,
    };
    return Semantics(
      container: true,
      label: strings.stepStatusAccessibility(step.name, status),
      child: ExcludeSemantics(
        child: Padding(
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
                    Text(
                      step.name,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
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
                status.toUpperCase(),
                style: TextStyle(
                  color: color,
                  fontFamily: 'monospace',
                  fontSize: 9,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AgentRow extends StatelessWidget {
  final SubAgentInfo agent;
  final VoidCallback onTap;
  final bool nested;

  const _AgentRow({
    required this.agent,
    required this.onTap,
    this.nested = false,
  });

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final status = _localizedExecutionStatus(strings, agent.status);
    return Semantics(
      container: true,
      button: true,
      label: strings.agentStatusAccessibility(agent.name, status),
      onTap: onTap,
      excludeSemantics: true,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 48),
          child: Padding(
            padding: EdgeInsets.fromLTRB(nested ? 34 : 14, 9, 14, 9),
            child: Row(
              children: [
                Icon(Icons.memory_rounded, color: AppPalette.primary, size: 18),
                const SizedBox(width: 11),
                Expanded(
                  child: Text(
                    agent.name,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                Text(
                  status.toUpperCase(),
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
    final strings = AppLocalizations.of(context);
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
              child: Icon(
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
                    cleanTitle.isEmpty ? strings.untitledSession : cleanTitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _sessionDate(context, session),
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

enum _TransferFilter { all, images, files }

class TransfersScreen extends ConsumerWidget {
  const TransfersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final connection = ref.watch(connectionStateProvider);
    final activeProfile = AuthService.instance.activeProfile;
    return Scaffold(
      appBar: AppBar(
        title: Text(strings.tabTransfers),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Center(child: ConnectionBadge(state: connection)),
          ),
        ],
      ),
      body: RefreshIndicator(
        color: AppPalette.primary,
        backgroundColor: AppPalette.elevated,
        onRefresh: () async {
          ref.read(wsServiceProvider)?.requestSnapshot();
          await Future<void>.delayed(const Duration(milliseconds: 350));
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(18, 8, 18, 32),
          children: [
            _TransferHub(
              artifacts: ref.watch(artifactsProvider),
              previews: ref.watch(previewsProvider),
              projectDirectory: activeProfile?.projectDirectory,
            ),
          ],
        ),
      ),
    );
  }
}

class _TransferHub extends StatefulWidget {
  final List<CompanionArtifact> artifacts;
  final List<CompanionPreview> previews;
  final String? projectDirectory;

  const _TransferHub({
    required this.artifacts,
    required this.previews,
    this.projectDirectory,
  });

  @override
  State<_TransferHub> createState() => _TransferHubState();
}

class _TransferHubState extends State<_TransferHub> {
  String _query = '';
  _TransferFilter _filter = _TransferFilter.all;

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final query = _query.trim().toLowerCase();
    final transfers = widget.artifacts
        .where(
          (artifact) =>
              _filter == _TransferFilter.all ||
              (_filter == _TransferFilter.images && artifact.kind == 'image') ||
              (_filter == _TransferFilter.files && artifact.kind != 'image'),
        )
        .where(
          (artifact) =>
              query.isEmpty ||
              artifact.title.toLowerCase().contains(query) ||
              artifact.name.toLowerCase().contains(query) ||
              artifact.sourceDevice.toLowerCase().contains(query) ||
              (artifact.sessionId?.toLowerCase().contains(query) ?? false),
        )
        .toList();
    final previews = widget.previews
        .where(
          (preview) =>
              _filter == _TransferFilter.all &&
              (query.isEmpty ||
                  preview.title.toLowerCase().contains(query) ||
                  preview.sourceDevice.toLowerCase().contains(query) ||
                  preview.directory.toLowerCase().contains(query)),
        )
        .toList();
    final sources = <String>{
      ...transfers.map((artifact) => artifact.sourceDevice),
      ...previews.map((preview) => preview.sourceDevice),
    };
    final hasUnfilteredItems =
        widget.artifacts.isNotEmpty || widget.previews.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionLabel(strings.transferInbox),
        const SizedBox(height: 5),
        Text(
          strings.transferDescription,
          style: Theme.of(context).textTheme.bodySmall,
        ),
        if (widget.projectDirectory != null)
          Text(
            widget.projectDirectory!,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.labelSmall,
          ),
        const SizedBox(height: 10),
        TextField(
          key: const Key('transfer-search-field'),
          decoration: InputDecoration(
            prefixIcon: const Icon(Icons.search_rounded),
            hintText: strings.transferSearchHint,
            isDense: true,
          ),
          onChanged: (value) => setState(() => _query = value),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 7,
          children: [
            ChoiceChip(
              key: const Key('transfer-filter-all'),
              label: Text(strings.filterAll),
              selected: _filter == _TransferFilter.all,
              onSelected: (_) => setState(() => _filter = _TransferFilter.all),
            ),
            ChoiceChip(
              key: const Key('transfer-filter-images'),
              label: Text(strings.filterImages),
              selected: _filter == _TransferFilter.images,
              onSelected: (_) =>
                  setState(() => _filter = _TransferFilter.images),
            ),
            ChoiceChip(
              key: const Key('transfer-filter-files'),
              label: Text(strings.filterFiles),
              selected: _filter == _TransferFilter.files,
              onSelected: (_) =>
                  setState(() => _filter = _TransferFilter.files),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (sources.isEmpty)
          _QuietState(
            icon: Icons.move_to_inbox_outlined,
            title: hasUnfilteredItems
                ? strings.noMatchingTransfers
                : strings.noTransfers,
            body: hasUnfilteredItems
                ? strings.noMatchingTransfersBody
                : strings.noTransfersBody,
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
                  strings.fromSource(source),
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
          for (final artifact in transfers.where(
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
  int _partialBytes = 0;
  TransferCancellation? _cancellation;

  @override
  void initState() {
    super.initState();
    _refreshPartial();
  }

  Future<void> _refreshPartial() async {
    final bytes = await TransferService.partialDownloadBytes(widget.artifact);
    if (mounted) setState(() => _partialBytes = bytes);
  }

  void _updateProgress(int transferred, int total) {
    if (!mounted) return;
    setState(() {
      _progress = total > 0 ? transferred / total : null;
    });
  }

  Future<void> _run(
    Future<void> Function(TransferCancellation cancellation) action,
  ) async {
    if (_working) return;
    final cancellation = TransferCancellation();
    setState(() {
      _working = true;
      _progress = 0;
      _cancellation = cancellation;
    });
    try {
      await action(cancellation);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(error.toString().replaceFirst('Bad state: ', '')),
          ),
        );
      }
    } finally {
      await _refreshPartial();
      if (mounted) {
        setState(() {
          _working = false;
          _progress = null;
          _cancellation = null;
        });
      }
    }
  }

  Future<void> _discardPartial() async {
    await TransferService.discardPartialDownload(widget.artifact);
    await _refreshPartial();
  }

  Future<void> _removeFromInbox() async {
    final strings = AppLocalizations.of(context);
    final socket = ref.read(wsServiceProvider);
    if (socket == null || !socket.isConnected) {
      throw StateError(AppLocalizations.of(context).reconnectRemoveTransfer);
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(strings.removeFromInboxQuestion),
        content: Text(strings.removeFromInboxExplanation),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(strings.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(strings.remove),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final result = await socket.deleteArtifact(artifactId: widget.artifact.id);
    if (!result.isOk) {
      throw StateError(result.error ?? 'Transfer record could not be removed.');
    }
    await TransferService.discardPartialDownload(widget.artifact);
    ref.read(artifactsProvider.notifier).remove(widget.artifact.id);
  }

  @override
  Widget build(BuildContext context) {
    final artifact = widget.artifact;
    final strings = AppLocalizations.of(context);
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
                        '${artifact.name}  ${_formatBytes(context, artifact.size)}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      if (artifact.sessionId != null)
                        Text(
                          strings.sessionLabel(artifact.sessionId!),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.labelSmall,
                        ),
                      Text(
                        artifact.direction == 'mobile_to_pc'
                            ? strings.uploadedToComputer
                            : strings.availableOnPhone,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: artifact.direction == 'mobile_to_pc'
                              ? AppPalette.mint
                              : AppPalette.primary,
                        ),
                      ),
                      if (_partialBytes > 0)
                        Text(
                          strings.pausedAtBytes(
                            _formatBytes(context, _partialBytes),
                          ),
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(color: AppPalette.amber),
                        ),
                      if (artifact.sha256 != null)
                        Text(
                          strings.shaVerified,
                          style: Theme.of(context).textTheme.labelSmall
                              ?.copyWith(color: AppPalette.mint),
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
                        if (artifact.expiresAt != null)
                          Text(
                            _expiryLabel(strings, artifact.expiresAt!),
                            style: Theme.of(context).textTheme.labelSmall,
                          ),
                        const SizedBox(height: 3),
                        Text(
                          _progress == null
                              ? '...'
                              : '${(_progress! * 100).clamp(0, 100).round()}%',
                          style: Theme.of(context).textTheme.labelSmall,
                        ),
                        IconButton(
                          tooltip: strings.pauseTransfer,
                          onPressed: _cancellation?.cancel,
                          icon: const Icon(Icons.pause_rounded),
                        ),
                      ],
                    ),
                  )
                else if (artifact.direction == 'pc_to_mobile') ...[
                  IconButton(
                    tooltip: _partialBytes > 0
                        ? strings.resumeDownload
                        : strings.downloadAndOpen,
                    onPressed: socket == null
                        ? null
                        : () => _run(
                            (cancellation) => TransferService.downloadAndOpen(
                              socket: socket,
                              artifact: artifact,
                              onProgress: _updateProgress,
                              cancellation: cancellation,
                            ),
                          ),
                    icon: Icon(
                      _partialBytes > 0
                          ? Icons.play_arrow_rounded
                          : Icons.download_rounded,
                    ),
                  ),
                  IconButton(
                    tooltip: strings.share,
                    onPressed: socket == null
                        ? null
                        : () => _run(
                            (cancellation) => TransferService.share(
                              socket: socket,
                              artifact: artifact,
                              onProgress: _updateProgress,
                              cancellation: cancellation,
                            ),
                          ),
                    icon: const Icon(Icons.share_outlined),
                  ),
                  PopupMenuButton<String>(
                    tooltip: strings.transferOptions,
                    onSelected: (value) {
                      if (value == 'partial') {
                        _discardPartial();
                      } else if (value == 'remote') {
                        _run((_) => _removeFromInbox());
                      }
                    },
                    itemBuilder: (_) => [
                      if (_partialBytes > 0)
                        PopupMenuItem(
                          value: 'partial',
                          child: Text(strings.discardPartial),
                        ),
                      PopupMenuItem(
                        value: 'remote',
                        child: Text(strings.removeFromInbox),
                      ),
                    ],
                  ),
                ] else ...[
                  PopupMenuButton<String>(
                    tooltip: strings.transferOptions,
                    onSelected: (value) {
                      if (value == 'remote') {
                        _run((_) => _removeFromInbox());
                      }
                    },
                    itemBuilder: (_) => [
                      PopupMenuItem(
                        value: 'remote',
                        child: Text(strings.removeFromInbox),
                      ),
                    ],
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

  Future<void> _open() async {
    final strings = AppLocalizations.of(context);
    final socket = ref.read(wsServiceProvider);
    final fallback = widget.preview.endpoints.firstOrNull;
    if (socket == null || fallback == null) return;
    setState(() => _working = true);
    try {
      if (!socket.capabilities.contains('previews.v2')) {
        await TransferService.openPreview(fallback);
        return;
      }
      final result = await socket.previewAccess(
        previewId: widget.preview.id,
        directory: widget.preview.directory,
      );
      final raw = result.payload['preview'];
      if (raw is! Map) {
        throw StateError(strings.invalidPreviewResponse);
      }
      final preview = CompanionPreview.fromJson(Map<String, dynamic>.from(raw));
      final endpoint = preview.endpoints.firstOrNull;
      final accessUri = endpoint == null ? null : Uri.tryParse(endpoint);
      if (accessUri == null) {
        throw StateError(strings.noPreviewGateway);
      }
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => PreviewScreen(preview: preview, accessUri: accessUri),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString().replaceFirst('Bad state: ', '')),
        ),
      );
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

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
                              ? AppLocalizations.of(context).noOutputYet
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
    final strings = AppLocalizations.of(context);
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
                      endpoint == null
                          ? strings.waitingGateway
                          : strings.tokenGatedPreview(preview.sourceDevice),
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
                      : _open,
                  icon: const Icon(Icons.preview_rounded, size: 18),
                  label: Text(strings.inspect),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                onPressed: _working ? null : _logs,
                icon: const Icon(Icons.terminal_rounded, size: 18),
                label: Text(strings.logs),
              ),
              if (active) ...[
                const SizedBox(width: 8),
                IconButton.outlined(
                  tooltip: strings.stopPreview,
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

String _formatBytes(BuildContext context, int bytes) {
  final format = NumberFormat(
    '#,##0.#',
    Localizations.localeOf(context).toString(),
  );
  if (bytes < 1024) return '${format.format(bytes)} B';
  if (bytes < 1024 * 1024) return '${format.format(bytes / 1024)} KB';
  return '${format.format(bytes / 1024 / 1024)} MB';
}

String _sessionDate(BuildContext context, SessionInfo session) =>
    DateFormat.yMd(
      Localizations.localeOf(context).toString(),
    ).add_Hm().format(DateTime.fromMillisecondsSinceEpoch(session.updated));

String _expiryLabel(AppLocalizations strings, DateTime expiresAt) {
  final remaining = expiresAt.difference(DateTime.now());
  if (remaining.isNegative) return strings.transferExpired;
  if (remaining.inHours > 0) return strings.expiresHours(remaining.inHours);
  return strings.expiresMinutes(remaining.inMinutes.clamp(1, 59));
}

String _localizedExecutionStatus(AppLocalizations strings, String status) {
  return switch (status.toLowerCase()) {
    'running' || 'in_progress' || 'starting' => strings.statusLive,
    'waiting' || 'wait' => strings.statusWait,
    'paused' => strings.statusPaused,
    'complete' || 'completed' || 'done' => strings.statusDone,
    'failed' || 'fail' => strings.statusFail,
    _ => status,
  };
}
