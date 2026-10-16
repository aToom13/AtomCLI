part of 'chat_screen.dart';

Future<String?> _pickNewSessionDirectory(
  BuildContext context,
  String? initial,
) {
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
                    final result = await showModalBottomSheet<String>(
                      context: context,
                      isScrollControlled: true,
                      backgroundColor: AppPalette.panel,
                      builder: (_) => _DirectoryPicker(initialPath: selected),
                    );
                    if (result != null) setSheetState(() => selected = result);
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
                          : () => Navigator.pop(sheetContext, selected),
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
