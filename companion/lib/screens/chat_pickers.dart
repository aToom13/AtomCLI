part of 'chat_screen.dart';

Future<void> _showModelPicker(BuildContext context, WidgetRef ref) async {
  var models = ref.read(modelsListProvider);
  if (models.isEmpty) {
    ref.read(wsServiceProvider)?.getModels();
    await Future<void>.delayed(const Duration(milliseconds: 300));
    models = ref.read(modelsListProvider);
  }
  if (!context.mounted) return;
  final selected = await showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppPalette.panel,
    builder: (_) => _ModelPicker(
      models: models,
      selectedId: ref.read(conversationProvider).selectedModelId,
    ),
  );
  if (selected != null && context.mounted) {
    ref.read(conversationProvider.notifier).setModel(selected);
    HapticFeedback.selectionClick();
  }
}

Future<void> _showVariantPicker(BuildContext context, WidgetRef ref) async {
  final conversation = ref.read(conversationProvider);
  final model = ref
      .read(modelsListProvider)
      .where((item) => item.id == conversation.selectedModelId)
      .firstOrNull;
  if (model == null || model.variants.isEmpty) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(AppLocalizations.of(context).thinkingUnavailable)),
    );
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
  if (!context.mounted || selected == null) return;
  ref
      .read(conversationProvider.notifier)
      .setVariant(selected == '__default__' ? null : selected);
}

Future<void> _showAgentPicker(BuildContext context, WidgetRef ref) async {
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
  if (selected != null && context.mounted) {
    ref.read(conversationProvider.notifier).setAgent(selected);
    HapticFeedback.selectionClick();
  }
}

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
