import 'dart:math' as math;
import 'package:flutter/material.dart' hide ConnectionState;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models.dart';
import '../providers/app_providers.dart';
import '../services/auth_service.dart';

// Cross-tab navigation: set this to navigate Chat to a specific session
final chatJumpToSessionProvider = StateProvider<String?>((ref) => null);

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const _kBg = Color(0xFF0A0D13);
const _kSurface = Color(0xFF111720);
const _kCard = Color(0xFF161D28);
const _kBorder = Color(0xFF1E2A3A);
const _kAccent = Color(0xFF4F9EFF);
const _kGreen = Color(0xFF3FB950);
const _kRed = Color(0xFFFF6B6B);
const _kOrange = Color(0xFFFFA657);
const _kPurple = Color(0xFFA371F7);
const _kTextPrimary = Color(0xFFE6EDF3);
const _kTextSecondary = Color(0xFF8B949E);
const _kTextMuted = Color(0xFF484F58);

/// Main dashboard shown after pairing.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final WsConnectionState connState = ref.watch(connectionStateProvider);
    final permissions = ref.watch(permissionsProvider);
    final dagSteps = ref.watch(dagProvider);

    return Scaffold(
      backgroundColor: _kBg,
      appBar: AppBar(
        backgroundColor: _kSurface,
        elevation: 0,
        title: Row(
          children: [
            // Animated gradient logo
            Container(
              width: 30,
              height: 30,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [_kAccent, _kPurple],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(8),
                boxShadow: [
                  BoxShadow(
                    color: _kAccent.withValues(alpha: 0.35),
                    blurRadius: 10,
                    spreadRadius: 0,
                  ),
                ],
              ),
              child: const Icon(Icons.terminal, color: Colors.white, size: 16),
            ),
            const SizedBox(width: 10),
            const Text(
              'AtomCLI',
              style: TextStyle(
                color: _kTextPrimary,
                fontWeight: FontWeight.w800,
                fontSize: 17,
                letterSpacing: -0.3,
              ),
            ),
            const Spacer(),
            _ConnectionPill(state: connState),
          ],
        ),
        automaticallyImplyLeading: false,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(height: 1, color: _kBorder),
        ),
      ),
      body: CustomScrollView(
        slivers: [
          // Permission alerts pinned at top
          if (permissions.isNotEmpty) ...[
            SliverToBoxAdapter(
              child: Container(
                margin: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 10,
                ),
                decoration: BoxDecoration(
                  color: _kRed.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: _kRed.withValues(alpha: 0.3)),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.warning_amber_rounded,
                      color: _kRed,
                      size: 16,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '${permissions.length} permission request${permissions.length > 1 ? 's' : ''} awaiting your action',
                        style: const TextStyle(
                          color: _kRed,
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
              sliver: SliverList(
                delegate: SliverChildBuilderDelegate(
                  (_, i) => _PermissionCard(permission: permissions[i]),
                  childCount: permissions.length,
                ),
              ),
            ),
          ],

          // Workflow section header
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 20, 16, 10),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: _kAccent.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(
                        color: _kAccent.withValues(alpha: 0.2),
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.account_tree,
                          color: _kAccent,
                          size: 13,
                        ),
                        const SizedBox(width: 5),
                        Text(
                          'WORKFLOW',
                          style: TextStyle(
                            color: _kAccent,
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 1.2,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (dagSteps.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 7,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: _kCard,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: _kBorder),
                      ),
                      child: Text(
                        '${dagSteps.length}',
                        style: const TextStyle(
                          color: _kTextSecondary,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),

          // Sub-agent section (shown when orchestrators are running)
          const _SubAgentSection(),

          // DAG step list or empty state
          if (dagSteps.isEmpty)
            const SliverFillRemaining(child: _EmptyWorkflow())
          else
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
              sliver: SliverList(
                delegate: SliverChildBuilderDelegate(
                  (_, i) => _DagStepCard(step: dagSteps[i], index: i),
                  childCount: dagSteps.length,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Sub-agent section
// ---------------------------------------------------------------------------

class _SubAgentSection extends ConsumerWidget {
  const _SubAgentSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final subAgents = ref.watch(subAgentProvider);
    if (subAgents.isEmpty) {
      return const SliverToBoxAdapter(child: SizedBox.shrink());
    }

    return SliverPadding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
      sliver: SliverList(
        delegate: SliverChildListDelegate([
          Padding(
            padding: const EdgeInsets.only(bottom: 8, top: 8),
            child: Row(
              children: [
                const Icon(Icons.people_outline, size: 13, color: _kPurple),
                const SizedBox(width: 6),
                const Text(
                  'SUB-AGENTS',
                  style: TextStyle(
                    color: _kPurple,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.1,
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: _kCard,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: _kBorder),
                  ),
                  child: Text(
                    '${subAgents.length}',
                    style: const TextStyle(
                      color: _kTextSecondary,
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ),
          ...subAgents.map((sa) => _SubAgentCard(agent: sa)),
        ]),
      ),
    );
  }
}

class _SubAgentCard extends ConsumerWidget {
  final SubAgentInfo agent;
  const _SubAgentCard({required this.agent});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isRunning = agent.status == 'running';
    final isFailed = agent.status == 'failed';
    final statusColor = isRunning
        ? _kOrange
        : isFailed
        ? _kRed
        : _kGreen;

    final duration = agent.finishedAt != null
        ? Duration(milliseconds: agent.finishedAt! - agent.startedAt)
        : null;
    final durationStr = duration != null
        ? '${duration.inSeconds}s'
        : isRunning
        ? 'running…'
        : '';

    return GestureDetector(
      onTap: () {
        // Jump to this sub-agent's session in the Chat tab
        ref.read(chatJumpToSessionProvider.notifier).state = agent.sessionId;
        // The main.dart navigation hook will pick this up
        DefaultTabController.of(context).animateTo(1);
      },
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: _kCard,
          border: Border.all(
            color: isRunning ? _kOrange.withValues(alpha: 0.3) : _kBorder,
          ),
          borderRadius: BorderRadius.circular(12),
          boxShadow: isRunning
              ? [
                  BoxShadow(
                    color: _kOrange.withValues(alpha: 0.08),
                    blurRadius: 12,
                  ),
                ]
              : null,
        ),
        child: Row(
          children: [
            // Status dot
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                color: statusColor,
                shape: BoxShape.circle,
                boxShadow: isRunning
                    ? [
                        BoxShadow(
                          color: statusColor.withValues(alpha: 0.5),
                          blurRadius: 6,
                        ),
                      ]
                    : null,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    agent.name,
                    style: const TextStyle(
                      color: _kTextPrimary,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 1,
                        ),
                        decoration: BoxDecoration(
                          color: _kPurple.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          agent.agentType,
                          style: const TextStyle(color: _kPurple, fontSize: 10),
                        ),
                      ),
                      if (durationStr.isNotEmpty) ...[
                        const SizedBox(width: 6),
                        Text(
                          durationStr,
                          style: const TextStyle(
                            color: _kTextMuted,
                            fontSize: 10,
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: _kTextMuted, size: 16),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Connection pill
// ---------------------------------------------------------------------------

class _ConnectionPill extends StatefulWidget {
  final WsConnectionState state;
  const _ConnectionPill({required this.state});

  @override
  State<_ConnectionPill> createState() => _ConnectionPillState();
}

class _ConnectionPillState extends State<_ConnectionPill>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    );
    _updateAnimation();
  }

  @override
  void didUpdateWidget(_ConnectionPill old) {
    super.didUpdateWidget(old);
    if (old.state != widget.state) _updateAnimation();
  }

  void _updateAnimation() {
    if (widget.state == WsConnectionState.connected) {
      _pulse.stop();
    } else if (widget.state == WsConnectionState.connecting) {
      _pulse.repeat(reverse: true);
    } else {
      _pulse.stop();
      _pulse.value = 0;
    }
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (widget.state) {
      WsConnectionState.connected => ('● Online', _kGreen),
      WsConnectionState.connecting => ('● Connecting', _kOrange),
      WsConnectionState.disconnected => ('● Offline', _kTextMuted),
    };

    return AnimatedBuilder(
      animation: _pulse,
      builder: (_, child) => Opacity(
        opacity: widget.state == WsConnectionState.connecting
            ? 0.5 + 0.5 * _pulse.value
            : 1.0,
        child: child,
      ),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: color.withValues(alpha: 0.3)),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: color,
            fontSize: 11,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Empty workflow
// ---------------------------------------------------------------------------

class _EmptyWorkflow extends StatelessWidget {
  const _EmptyWorkflow();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: _kCard,
              shape: BoxShape.circle,
              border: Border.all(color: _kBorder),
            ),
            child: const Icon(
              Icons.account_tree_outlined,
              color: _kTextMuted,
              size: 28,
            ),
          ),
          const SizedBox(height: 16),
          const Text(
            'No active workflow',
            style: TextStyle(
              color: _kTextSecondary,
              fontSize: 15,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Start an agent task to track progress here',
            style: TextStyle(color: _kTextMuted, fontSize: 12),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Permission card
// ---------------------------------------------------------------------------

class _PermissionCard extends ConsumerWidget {
  final PendingPermission permission;
  const _PermissionCard({required this.permission});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: _kCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _kRed.withValues(alpha: 0.4)),
        boxShadow: [
          BoxShadow(
            color: _kRed.withValues(alpha: 0.08),
            blurRadius: 12,
            spreadRadius: 0,
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: _kRed.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: _kRed.withValues(alpha: 0.3)),
                  ),
                  child: Text(
                    permission.permission,
                    style: const TextStyle(
                      color: _kRed,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const Spacer(),
                const Icon(Icons.lock_outline, color: _kRed, size: 14),
              ],
            ),
            if (permission.patterns.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 4,
                runSpacing: 4,
                children: permission.patterns
                    .take(4)
                    .map(
                      (p) => Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: _kSurface,
                          borderRadius: BorderRadius.circular(4),
                          border: Border.all(color: _kBorder),
                        ),
                        child: Text(
                          p,
                          style: const TextStyle(
                            fontSize: 10,
                            color: _kTextSecondary,
                            fontFamily: 'monospace',
                          ),
                        ),
                      ),
                    )
                    .toList(),
              ),
            ],
            const SizedBox(height: 12),
            Row(
              children: [
                _QuickBtn(
                  label: 'Allow',
                  color: _kGreen,
                  icon: Icons.check,
                  onTap: () => _resolve(ref, 'allow'),
                ),
                const SizedBox(width: 8),
                _QuickBtn(
                  label: 'Deny',
                  color: _kRed,
                  icon: Icons.close,
                  onTap: () => _resolve(ref, 'deny'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  void _resolve(WidgetRef ref, String resolution) {
    final ws = ref.read(wsServiceProvider);
    // #7: Guard against resolving when disconnected — would leave backend still
    // pending while removing the card from the mobile UI (inconsistency).
    if (ws == null) {
      ScaffoldMessenger.of(
        ref.context,
      ).showSnackBar(
        const SnackBar(
          content: Text('Not connected — cannot resolve permission'),
          backgroundColor: Color(0xFFFF6B6B),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }
    final auth = AuthService.instance;
    final payload = {
      'type': 'permission_resolve',
      'id': permission.reqId,
      'resolution': resolution,
    };
    final sig = auth.sign(AuthService.canonicalPayload(payload));
    ws.resolvePermission(
      reqId: permission.reqId,
      resolution: resolution,
      deviceName: auth.deviceName ?? '',
      signature: sig,
    );
    // Optimistic removal: backend will confirm via permission_resolved event,
    // which also triggers removal in dispatchBackendEvents. Removing here keeps
    // the UI snappy. If something fails, the next snapshot will re-add it.
    ref.read(permissionsProvider.notifier).remove(permission.reqId);
  }
}

class _QuickBtn extends StatelessWidget {
  final String label;
  final Color color;
  final IconData icon;
  final VoidCallback onTap;
  const _QuickBtn({
    required this.label,
    required this.color,
    required this.icon,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 9),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: color.withValues(alpha: 0.3)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 14, color: color),
              const SizedBox(width: 5),
              Text(
                label,
                style: TextStyle(
                  color: color,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// DAG Step card
// ---------------------------------------------------------------------------

class _DagStepCard extends StatefulWidget {
  final DagStep step;
  final int index;
  const _DagStepCard({required this.step, required this.index});

  @override
  State<_DagStepCard> createState() => _DagStepCardState();
}

class _DagStepCardState extends State<_DagStepCard>
    with SingleTickerProviderStateMixin {
  bool _expanded = false;
  late final AnimationController _spin;

  @override
  void initState() {
    super.initState();
    _spin = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    );
    _maybeAnimate();
  }

  @override
  void didUpdateWidget(_DagStepCard old) {
    super.didUpdateWidget(old);
    if (old.step.status != widget.step.status) _maybeAnimate();
  }

  void _maybeAnimate() {
    final running =
        widget.step.status == 'running' || widget.step.status.endsWith('ing');
    if (running) {
      _spin.repeat();
    } else {
      _spin.stop();
    }
  }

  @override
  void dispose() {
    _spin.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final step = widget.step;
    final isRunning = step.status == 'running' || step.status.endsWith('ing');
    final isComplete = step.status == 'complete' || step.status == 'done';
    final isFailed = step.status == 'failed';
    final hasTodos = step.todos.isNotEmpty;

    final statusColor = isRunning
        ? _kAccent
        : isComplete
        ? _kGreen
        : isFailed
        ? _kRed
        : _kTextMuted;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 250),
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: _kCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isRunning ? _kAccent.withValues(alpha: 0.4) : _kBorder,
          width: isRunning ? 1.5 : 1,
        ),
        boxShadow: isRunning
            ? [
                BoxShadow(
                  color: _kAccent.withValues(alpha: 0.1),
                  blurRadius: 16,
                  spreadRadius: 0,
                ),
              ]
            : null,
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: hasTodos ? () => setState(() => _expanded = !_expanded) : null,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  // Index badge
                  Container(
                    width: 26,
                    height: 26,
                    decoration: BoxDecoration(
                      color: statusColor.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Center(
                      child: Text(
                        '${widget.index + 1}',
                        style: TextStyle(
                          color: statusColor,
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  // Status icon
                  _buildStatusIcon(
                    isRunning,
                    isComplete,
                    isFailed,
                    statusColor,
                  ),
                  const SizedBox(width: 10),
                  // Text
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          step.name,
                          style: const TextStyle(
                            color: _kTextPrimary,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        if (step.description.isNotEmpty)
                          Text(
                            step.description,
                            style: const TextStyle(
                              color: _kTextSecondary,
                              fontSize: 11,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                      ],
                    ),
                  ),
                  // Agent chip
                  if (step.agentType != null) ...[
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: _kSurface,
                        borderRadius: BorderRadius.circular(5),
                        border: Border.all(color: _kBorder),
                      ),
                      child: Text(
                        step.agentType!,
                        style: const TextStyle(
                          fontSize: 9,
                          color: _kTextSecondary,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0.5,
                        ),
                      ),
                    ),
                  ],
                  if (hasTodos) ...[
                    const SizedBox(width: 6),
                    AnimatedRotation(
                      turns: _expanded ? 0.5 : 0,
                      duration: const Duration(milliseconds: 200),
                      child: const Icon(
                        Icons.keyboard_arrow_down,
                        color: _kTextMuted,
                        size: 18,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            // Todos
            if (hasTodos && _expanded) _TodoList(todos: step.todos),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusIcon(
    bool running,
    bool complete,
    bool failed,
    Color color,
  ) {
    if (running) {
      return AnimatedBuilder(
        animation: _spin,
        builder: (_, child) =>
            Transform.rotate(angle: _spin.value * 2 * math.pi, child: child),
        child: Icon(Icons.sync_rounded, color: color, size: 18),
      );
    }
    if (complete) {
      return Icon(Icons.check_circle_rounded, color: color, size: 18);
    }
    if (failed) {
      return Icon(Icons.error_rounded, color: color, size: 18);
    }
    return Icon(Icons.radio_button_unchecked_rounded, color: color, size: 18);
  }
}

// ---------------------------------------------------------------------------
// Todo list
// ---------------------------------------------------------------------------

class _TodoList extends StatelessWidget {
  final List<TodoItem> todos;
  const _TodoList({required this.todos});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: _kBorder)),
      ),
      child: Column(
        children: todos.asMap().entries.map((e) {
          final todo = e.value;
          final complete = todo.status == 'complete' || todo.status == 'done';
          final running =
              todo.status == 'in_progress' || todo.status == 'running';
          final failed = todo.status == 'failed';

          final (icon, color) = complete
              ? (Icons.check_box_rounded, _kGreen)
              : running
              ? (Icons.pending_rounded, _kAccent)
              : failed
              ? (Icons.cancel_rounded, _kRed)
              : (Icons.check_box_outline_blank_rounded, _kTextMuted);

          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Row(
              children: [
                Icon(icon, color: color, size: 15),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    todo.content,
                    style: TextStyle(
                      color: complete ? _kTextMuted : _kTextSecondary,
                      fontSize: 12,
                      decoration: complete ? TextDecoration.lineThrough : null,
                    ),
                  ),
                ),
              ],
            ),
          );
        }).toList(),
      ),
    );
  }
}
