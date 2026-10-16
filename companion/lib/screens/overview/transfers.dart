import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../models.dart';
import '../../l10n/app_localizations.dart';
import '../../providers/app_providers.dart';
import '../preview_screen.dart';
import '../../theme/app_theme.dart';
import '../../services/auth_service.dart';
import '../../widgets/control_widgets.dart';
import '../../services/transfer_service.dart';
import 'shared.dart';

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
          QuietState(
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

String _expiryLabel(AppLocalizations strings, DateTime expiresAt) {
  final remaining = expiresAt.difference(DateTime.now());
  if (remaining.isNegative) return strings.transferExpired;
  if (remaining.inHours > 0) return strings.expiresHours(remaining.inHours);
  return strings.expiresMinutes(remaining.inMinutes.clamp(1, 59));
}
