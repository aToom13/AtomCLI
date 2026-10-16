part of 'overview_screen.dart';

class _ActiveRouteStrip extends StatelessWidget {
  final Map<String, dynamic> route;
  const _ActiveRouteStrip({required this.route});

  @override
  Widget build(BuildContext context) {
    final active = route['active'] is Map
        ? Map<String, dynamic>.from(route['active'] as Map)
        : route['route'] is Map
        ? Map<String, dynamic>.from(route['route'] as Map)
        : <String, dynamic>{};
    return ControlPanel(
      child: Row(
        children: [
          Icon(Icons.route_outlined, color: AppPalette.primary),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              '${AppLocalizations.of(context).models}: ${active['providerID'] ?? '?'}/${active['modelID'] ?? '?'}${active['variant'] == null ? '' : ' · ${active['variant']}'}',
            ),
          ),
          if (route['manualModelPin'] == true ||
              route['manualThinkingPin'] == true)
            const Icon(Icons.push_pin_outlined, size: 18),
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
    final strings = AppLocalizations.of(context);
    final status = localizedExecutionStatus(strings, step.status);
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
    final status = localizedExecutionStatus(strings, agent.status);
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
                    sessionDate(context, session),
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
