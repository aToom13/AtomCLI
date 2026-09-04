import 'dart:async';
import 'dart:collection';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models.dart';
import '../l10n/app_localizations.dart';
import '../providers/app_providers.dart';
import '../services/preview_health.dart';
import '../services/transfer_service.dart';
import '../theme/app_theme.dart';

enum PreviewViewport {
  phone('Phone', 390),
  tablet('Tablet', 768),
  desktop('Desktop', 1280);

  final String label;
  final int width;

  const PreviewViewport(this.label, this.width);
}

class PreviewScreen extends ConsumerStatefulWidget {
  final CompanionPreview preview;
  final Uri accessUri;

  const PreviewScreen({
    super.key,
    required this.preview,
    required this.accessUri,
  });

  @override
  ConsumerState<PreviewScreen> createState() => _PreviewScreenState();
}

class _PreviewScreenState extends ConsumerState<PreviewScreen>
    with WidgetsBindingObserver {
  InAppWebViewController? _controller;
  PreviewViewport _viewport = PreviewViewport.phone;
  double _progress = 0;
  bool _capturing = false;
  bool _pageLoaded = false;
  String? _error;
  final PreviewHealthTracker _health = PreviewHealthTracker();
  Timer? _healthRefreshTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _healthRefreshTimer?.cancel();
    final controller = _controller;
    if (controller != null) unawaited(controller.resumeTimers());
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final active = state == AppLifecycleState.resumed;
    unawaited(_setRenderingActive(active));
  }

  Future<void> _setRenderingActive(bool active) async {
    final controller = _controller;
    if (controller == null) return;
    try {
      if (active) {
        await controller.resumeTimers();
        await controller.resume();
      } else {
        await controller.pause();
        await controller.pauseTimers();
      }
    } catch (_) {
      // Unsupported desktop WebView implementations may not expose lifecycle
      // controls; Android/iOS still suspend them natively.
    }
  }

  bool _isPreviewGateway(Uri target) {
    final access = widget.accessUri;
    return (target.scheme == 'http' || target.scheme == 'https') &&
        target.scheme == access.scheme &&
        target.host == access.host &&
        target.port == access.port;
  }

  Future<void> _applyViewport(PreviewViewport viewport) async {
    setState(() => _viewport = viewport);
    await _controller?.evaluateJavascript(
      source:
          '''
        (() => {
          let viewport = document.querySelector('meta[name="viewport"]');
          if (!viewport) {
            viewport = document.createElement('meta');
            viewport.name = 'viewport';
            document.head.appendChild(viewport);
          }
          viewport.content = 'width=${viewport.width}, initial-scale=1';
          window.dispatchEvent(new Event('resize'));
        })();
      ''',
    );
  }

  Future<void> _capture() async {
    final strings = AppLocalizations.of(context);
    final controller = _controller;
    final sessionId = widget.preview.sessionId;
    final socket = ref.read(wsServiceProvider);
    if (controller == null || sessionId == null || socket == null) return;
    setState(() => _capturing = true);
    try {
      final Uint8List? screenshot = await controller.takeScreenshot(
        screenshotConfiguration: ScreenshotConfiguration(
          compressFormat: CompressFormat.PNG,
        ),
      );
      if (screenshot == null || screenshot.isEmpty) {
        throw StateError(strings.captureFailed);
      }
      final artifact = await TransferService.uploadBytes(
        socket: socket,
        sessionId: sessionId,
        directory: widget.preview.directory,
        bytes: screenshot,
        filename:
            'preview-${_viewport.name}-${DateTime.now().millisecondsSinceEpoch}.png',
        mime: 'image/png',
      );
      if (artifact == null) {
        throw StateError(strings.screenshotRejected);
      }
      final result = await socket.sendChatMessage(
        sessionId: sessionId,
        directory: widget.preview.directory,
        text:
            'Review this ${_viewport.label.toLowerCase()} viewport screenshot (${_viewport.width}px) from Preview 2.0. Identify visible UI problems and use it as feedback for the current task.',
        attachments: [artifact.id],
      );
      if (!result.isOk) {
        throw StateError(result.error ?? strings.screenshotUploadedNotSent);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context).screenshotSent)),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString().replaceFirst('Bad state: ', '')),
        ),
      );
    } finally {
      if (mounted) setState(() => _capturing = false);
    }
  }

  void _recordHealthIssue({
    required PreviewHealthKind kind,
    required PreviewHealthSeverity severity,
    required String message,
    Uri? resource,
    int? statusCode,
  }) {
    if (!mounted) return;
    _health.record(
      kind: kind,
      severity: severity,
      message: message,
      resource: resource,
      statusCode: statusCode,
    );
    if (_healthRefreshTimer != null) return;
    _healthRefreshTimer = Timer(const Duration(milliseconds: 120), () {
      _healthRefreshTimer = null;
      if (mounted) setState(() {});
    });
  }

  Future<void> _showHealth() async {
    final strings = AppLocalizations.of(context);
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppPalette.panel,
      builder: (sheetContext) => SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(sheetContext).height * 0.68,
          child: Column(
            children: [
              const SizedBox(height: 10),
              Container(
                width: 42,
                height: 4,
                decoration: BoxDecoration(
                  color: AppPalette.strokeStrong,
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 16, 8, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        strings.previewHealth,
                        style: Theme.of(sheetContext).textTheme.titleLarge,
                      ),
                    ),
                    if (_health.hasIssues)
                      TextButton(
                        onPressed: () {
                          setState(_health.clear);
                          Navigator.pop(sheetContext);
                        },
                        child: Text(strings.previewClearIssues),
                      ),
                    IconButton(
                      tooltip: strings.close,
                      onPressed: () => Navigator.pop(sheetContext),
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 0, 18, 12),
                child: Text(
                  strings.previewHealthCaveat,
                  style: Theme.of(sheetContext).textTheme.bodySmall,
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: _health.hasIssues
                    ? ListView.separated(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        itemCount: _health.issues.length,
                        separatorBuilder: (_, _) => const Divider(height: 1),
                        itemBuilder: (_, index) => _PreviewHealthIssueRow(
                          issue: _health.issues[index],
                        ),
                      )
                    : Center(
                        child: Padding(
                          padding: const EdgeInsets.all(28),
                          child: Text(
                            _pageLoaded
                                ? strings.previewNoCapturedIssues
                                : strings.previewHealthMonitoring,
                            textAlign: TextAlign.center,
                            style: Theme.of(sheetContext).textTheme.bodyLarge,
                          ),
                        ),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final landscape =
        MediaQuery.orientationOf(context) == Orientation.landscape;
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: landscape ? 48 : null,
        title: Text(widget.preview.title),
        actions: [
          PopupMenuButton<PreviewViewport>(
            tooltip: strings.viewportWidth,
            initialValue: _viewport,
            onSelected: _applyViewport,
            itemBuilder: (_) => [
              for (final viewport in PreviewViewport.values)
                PopupMenuItem(
                  value: viewport,
                  child: Text(
                    '${_viewportLabel(strings, viewport)} · ${viewport.width}px',
                  ),
                ),
            ],
            icon: const Icon(Icons.devices_rounded),
          ),
          IconButton(
            tooltip: widget.preview.sessionId == null
                ? strings.noPreviewSession
                : strings.captureToSession,
            onPressed: _capturing || widget.preview.sessionId == null
                ? null
                : _capture,
            icon: _capturing
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.screenshot_monitor_rounded),
          ),
          IconButton(
            key: const Key('preview-health-button'),
            tooltip: strings.previewHealth,
            onPressed: _showHealth,
            icon: Badge(
              isLabelVisible: _health.hasIssues,
              label: Text('${_health.occurrenceCount}'),
              backgroundColor: _health.errorCount > 0
                  ? AppPalette.danger
                  : AppPalette.amber,
              child: Icon(
                _health.hasIssues
                    ? Icons.monitor_heart_outlined
                    : Icons.monitor_heart_rounded,
              ),
            ),
          ),
          IconButton(
            tooltip: strings.reload,
            onPressed: () => _controller?.reload(),
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: Column(
        children: [
          if (_progress < 1) LinearProgressIndicator(value: _progress),
          if (!landscape)
            Container(
              width: double.infinity,
              color: AppPalette.panel,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      strings.previewViewportStatus(
                        _viewportLabel(strings, _viewport),
                        _viewport.width,
                      ),
                      style: Theme.of(context).textTheme.labelSmall,
                    ),
                  ),
                  const SizedBox(width: 8),
                  InkWell(
                    key: const Key('preview-health-summary'),
                    borderRadius: BorderRadius.circular(999),
                    onTap: _showHealth,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 5,
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            _health.hasIssues
                                ? Icons.warning_amber_rounded
                                : Icons.check_circle_outline_rounded,
                            size: 14,
                            color: _health.hasIssues
                                ? AppPalette.amber
                                : AppPalette.mint,
                          ),
                          const SizedBox(width: 5),
                          Text(
                            _health.hasIssues
                                ? strings.previewIssues(_health.occurrenceCount)
                                : _pageLoaded
                                ? strings.previewNoCapturedIssues
                                : strings.previewHealthMonitoring,
                            style: Theme.of(context).textTheme.labelSmall,
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          if (_error != null)
            MaterialBanner(
              content: Text(_error!),
              actions: [
                TextButton(
                  onPressed: () {
                    setState(() => _error = null);
                    _controller?.reload();
                  },
                  child: Text(strings.retry),
                ),
              ],
            ),
          Expanded(
            child: InAppWebView(
              initialUserScripts: UnmodifiableListView([
                UserScript(
                  injectionTime: UserScriptInjectionTime.AT_DOCUMENT_START,
                  source: _previewHealthScript,
                ),
              ]),
              initialUrlRequest: URLRequest(
                url: WebUri(widget.accessUri.toString()),
              ),
              initialSettings: InAppWebViewSettings(
                javaScriptEnabled: true,
                cacheEnabled: false,
                clearCache: true,
                useShouldOverrideUrlLoading: true,
                allowFileAccessFromFileURLs: false,
                allowUniversalAccessFromFileURLs: false,
                allowFileAccess: false,
                allowContentAccess: false,
                mixedContentMode: MixedContentMode.MIXED_CONTENT_NEVER_ALLOW,
                mediaPlaybackRequiresUserGesture: true,
              ),
              onWebViewCreated: (controller) {
                _controller = controller;
                controller.addJavaScriptHandler(
                  handlerName: 'previewRuntimeIssue',
                  callback: (arguments) {
                    if (arguments.isEmpty || arguments.first is! Map) return;
                    final payload = Map<String, dynamic>.from(
                      arguments.first as Map,
                    );
                    final source = payload['source']?.toString();
                    final reportedKind = payload['kind']?.toString();
                    _recordHealthIssue(
                      kind: switch (reportedKind) {
                        'resource' => PreviewHealthKind.network,
                        'console_warning' ||
                        'console_error' => PreviewHealthKind.console,
                        _ => PreviewHealthKind.runtime,
                      },
                      severity: reportedKind == 'console_warning'
                          ? PreviewHealthSeverity.warning
                          : PreviewHealthSeverity.error,
                      message:
                          payload['message']?.toString() ??
                          strings.previewUnknownRuntimeError,
                      resource: source == null || source.isEmpty
                          ? null
                          : Uri.tryParse(source),
                    );
                  },
                );
                if (WidgetsBinding.instance.lifecycleState !=
                    AppLifecycleState.resumed) {
                  unawaited(_setRenderingActive(false));
                }
              },
              onLoadStart: (_, _) {
                if (!mounted) return;
                setState(() {
                  _pageLoaded = false;
                  _health.clear();
                  _error = null;
                });
              },
              onLoadStop: (_, _) {
                if (mounted) setState(() => _pageLoaded = true);
                _applyViewport(_viewport);
              },
              onProgressChanged: (_, value) {
                if (mounted) setState(() => _progress = value / 100);
              },
              shouldOverrideUrlLoading: (_, action) async {
                final target = action.request.url;
                if (target == null || !_isPreviewGateway(target.uriValue)) {
                  if (mounted) {
                    setState(() => _error = strings.previewNavigationBlocked);
                  }
                  return NavigationActionPolicy.CANCEL;
                }
                return NavigationActionPolicy.ALLOW;
              },
              onPermissionRequest: (_, _) async => PermissionResponse(
                resources: const [],
                action: PermissionResponseAction.DENY,
              ),
              onReceivedError: (_, request, error) {
                _recordHealthIssue(
                  kind: PreviewHealthKind.network,
                  severity: PreviewHealthSeverity.error,
                  message: error.description,
                  resource: Uri.tryParse(request.url.toString()),
                );
                if (request.isForMainFrame == true && mounted) {
                  setState(() => _error = error.description);
                }
              },
              onReceivedHttpError: (_, request, response) {
                final status = response.statusCode;
                final message = status == null
                    ? response.reasonPhrase ??
                          strings.previewUnknownNetworkError
                    : strings.previewHttpError(status);
                _recordHealthIssue(
                  kind: PreviewHealthKind.network,
                  severity: PreviewHealthSeverity.error,
                  message: message,
                  resource: Uri.tryParse(request.url.toString()),
                  statusCode: status,
                );
                if (request.isForMainFrame == true && mounted) {
                  setState(() => _error = message);
                }
              },
              onConsoleMessage: (_, message) {
                if (message.message.contains(_previewConsoleMarker)) return;
                final level = message.messageLevel;
                if (level != ConsoleMessageLevel.ERROR &&
                    level != ConsoleMessageLevel.WARNING) {
                  return;
                }
                _recordHealthIssue(
                  kind: PreviewHealthKind.console,
                  severity: level == ConsoleMessageLevel.ERROR
                      ? PreviewHealthSeverity.error
                      : PreviewHealthSeverity.warning,
                  message: message.message,
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _PreviewHealthIssueRow extends StatelessWidget {
  final PreviewHealthIssue issue;

  const _PreviewHealthIssueRow({required this.issue});

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final color = issue.severity == PreviewHealthSeverity.error
        ? AppPalette.danger
        : AppPalette.amber;
    final type = switch (issue.kind) {
      PreviewHealthKind.console => strings.previewConsoleIssue,
      PreviewHealthKind.runtime => strings.previewRuntimeIssue,
      PreviewHealthKind.network => strings.previewNetworkIssue,
    };
    return ListTile(
      leading: Icon(
        issue.severity == PreviewHealthSeverity.error
            ? Icons.error_outline_rounded
            : Icons.warning_amber_rounded,
        color: color,
      ),
      title: Text(issue.message, maxLines: 3, overflow: TextOverflow.ellipsis),
      subtitle: Text(
        [
          type,
          if (issue.resource?.isNotEmpty == true) issue.resource!,
        ].join(' · '),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: issue.occurrences > 1
          ? Text(
              '×${issue.occurrences}',
              style: TextStyle(color: color, fontWeight: FontWeight.w700),
            )
          : null,
    );
  }
}

const _previewHealthScript = r'''
(() => {
  if (window.__atomcliPreviewHealthInstalled) return;
  window.__atomcliPreviewHealthInstalled = true;
  const report = (kind, message, source) => {
    try {
      window.flutter_inappwebview.callHandler('previewRuntimeIssue', {
        kind,
        message: String(message || 'Unknown runtime error'),
        source: String(source || ''),
      });
    } catch (_) {}
  };
  const marker = '__ATOMCLI_PREVIEW_CAPTURED__';
  const printable = (value) => {
    try {
      if (typeof value === 'string') return value;
      return JSON.stringify(value) || String(value);
    } catch (_) {
      return String(value);
    }
  };
  for (const level of ['warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...values) => {
      report(
        level === 'warn' ? 'console_warning' : 'console_error',
        values.map(printable).join(' '),
        ''
      );
      original(...values, marker);
    };
  }
  window.addEventListener('error', (event) => {
    if (event.target && event.target !== window) {
      report(
        'resource',
        'Resource failed to load',
        event.target.src || event.target.href || ''
      );
      return;
    }
    report('runtime', event.message, event.filename);
  }, true);
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    report(
      'runtime',
      reason && reason.message ? reason.message : reason,
      ''
    );
  });
})();
''';

const _previewConsoleMarker = '__ATOMCLI_PREVIEW_CAPTURED__';

String _viewportLabel(AppLocalizations strings, PreviewViewport viewport) {
  return switch (viewport) {
    PreviewViewport.phone => strings.viewportPhone,
    PreviewViewport.tablet => strings.viewportTablet,
    PreviewViewport.desktop => strings.viewportDesktop,
  };
}
