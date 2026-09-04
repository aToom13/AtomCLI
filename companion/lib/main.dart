import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'l10n/app_localizations.dart';
import 'providers/app_providers.dart';
import 'screens/chat_screen.dart';
import 'screens/link_screen.dart';
import 'screens/overview_screen.dart';
import 'screens/permissions_screen.dart';
import 'screens/qr_scan_screen.dart';
import 'services/auth_service.dart';
import 'services/background_connection_service.dart';
import 'services/companion_preferences.dart';
import 'services/deep_link_service.dart';
import 'services/notification_service.dart';
import 'services/local_cache_database.dart';
import 'services/mobile_input_service.dart';
import 'services/power_policy.dart';
import 'services/privacy_service.dart';
import 'services/profile_switch_service.dart';
import 'services/transfer_service.dart';
import 'theme/app_theme.dart';
import 'widgets/adaptive_layout.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: AppPalette.surface,
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );
  await NotificationService.instance.init();
  try {
    await LocalCacheDatabase.instance.initialize();
  } catch (_) {
    // Pairing and live control remain usable if the optional cache is damaged.
  }
  final alreadyPaired = await AuthService.instance.tryLoadExisting();
  await CompanionPreferences.instance.load();
  AppPalette.selectAccent(CompanionPreferences.instance.accent);
  await PrivacyService.applyScreenProtection(
    CompanionPreferences.instance.protectScreenPreviews,
  );
  await BackgroundConnectionService.configure(startNow: false);
  runApp(ProviderScope(child: AtomCLIApp(startPaired: alreadyPaired)));
}

class AtomCLIApp extends StatelessWidget {
  final bool startPaired;

  const AtomCLIApp({super.key, required this.startPaired});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AppAccent>(
      valueListenable: AppPalette.accentSelection,
      builder: (context, _, _) => MaterialApp(
        onGenerateTitle: (context) => AppLocalizations.of(context).appTitle,
        debugShowCheckedModeBanner: false,
        theme: AppTheme.dark,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        initialRoute: startPaired ? '/home' : '/scan',
        routes: {
          '/scan': (_) => const QrScanScreen(),
          '/home': (_) => const MainShell(),
        },
      ),
    );
  }
}

class MainShell extends ConsumerStatefulWidget {
  const MainShell({super.key});

  @override
  ConsumerState<MainShell> createState() => _MainShellState();
}

class _MainShellState extends ConsumerState<MainShell>
    with WidgetsBindingObserver {
  bool _inBackground = false;
  Timer? _inactiveTimer;
  Future<void>? _foregroundInFlight;
  Future<void>? _backgroundInFlight;
  StreamSubscription<NotificationActionRequest>? _notificationActions;
  StreamSubscription<Map<String, dynamic>?>? _serviceNotificationActions;
  StreamSubscription<CompanionDeepLink>? _deepLinks;
  StreamSubscription<CompanionDeepLink>? _notificationLinks;
  StreamSubscription<IncomingShare>? _incomingShares;
  bool _routingDeepLink = false;
  bool get _supportsBackgroundConnection =>
      !kIsWeb && (Platform.isAndroid || Platform.isIOS);
  static const _screens = [
    OverviewScreen(),
    ChatScreen(),
    PermissionsScreen(),
    TransfersScreen(),
    LinkScreen(),
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _notificationActions = NotificationService.instance.actions.listen(
      _handleNotificationAction,
    );
    if (_supportsBackgroundConnection) {
      _serviceNotificationActions = BackgroundConnectionService
          .notificationActions
          .listen((event) {
            if (event == null) return;
            try {
              unawaited(
                _handleNotificationAction(
                  NotificationActionRequest.fromJson(event),
                ),
              );
            } catch (_) {
              // Ignore malformed cross-isolate notification callbacks.
            }
          });
    }
    _deepLinks = DeepLinkService.instance.links.listen(_handleDeepLink);
    _notificationLinks = NotificationService.instance.navigationLinks.listen(
      _handleDeepLink,
    );
    _incomingShares = MobileInputService.instance.shares.listen(
      _handleIncomingShare,
    );
    unawaited(
      MobileInputService.instance.initialize().then((share) {
        if (share != null) _handleIncomingShare(share);
      }),
    );
    unawaited(
      DeepLinkService.instance.initialize().then((link) {
        if (link != null) return _handleDeepLink(link);
      }),
    );
    if (_supportsBackgroundConnection) Future.microtask(_enterForeground);
  }

  @override
  void dispose() {
    _inactiveTimer?.cancel();
    _notificationActions?.cancel();
    _serviceNotificationActions?.cancel();
    _deepLinks?.cancel();
    _notificationLinks?.cancel();
    _incomingShares?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _handleNotificationAction(
    NotificationActionRequest request,
  ) async {
    final strings = AppLocalizations.of(context);
    final socket = ref.read(wsServiceProvider);
    if (socket?.isConnected != true) {
      await NotificationService.instance.showActionResult(
        request,
        success: false,
        error: strings.permissionOffline,
      );
      return;
    }
    try {
      final result = await executeNotificationAction(
        socket!,
        request,
      ).timeout(const Duration(seconds: 12));
      await NotificationService.instance.showActionResult(
        request,
        success: result.isOk,
        error: result.error,
      );
      if (result.isOk) socket.requestSnapshot();
    } catch (error) {
      await NotificationService.instance.showActionResult(
        request,
        success: false,
        error: error.toString().replaceFirst('Bad state: ', ''),
      );
    }
  }

  Future<void> _handleDeepLink(CompanionDeepLink link) async {
    if (_routingDeepLink) return;
    final strings = AppLocalizations.of(context);
    _routingDeepLink = true;
    try {
      PairedMachineProfile? profile;
      if (link.profileId != null) {
        final candidate = AuthService.instance.profiles
            .where((item) => item.profileId == link.profileId)
            .firstOrNull;
        if (candidate == null) throw StateError(strings.unknownLink);
        if (link.machineId != null && candidate.machineId != link.machineId) {
          throw StateError(strings.wrongMachineLink);
        }
        profile = await ProfileSwitchService.select(ref, link.profileId!);
      } else {
        profile = AuthService.instance.activeProfile;
      }
      if (link.machineId != null && profile?.machineId != link.machineId) {
        throw StateError(strings.wrongMachineLink);
      }
      if (!mounted) return;
      switch (link.destination) {
        case CompanionDestination.deck:
          ref.read(missionFocusWorkflowProvider.notifier).state =
              link.workflowId;
          ref.read(shellTabProvider.notifier).state = ShellTab.control;
        case CompanionDestination.sessions:
          if (link.sessionId != null) {
            ref.read(chatJumpToSessionProvider.notifier).state = link.sessionId;
          }
          ref.read(shellTabProvider.notifier).state = ShellTab.chat;
        case CompanionDestination.inbox:
          ref.read(inboxFocusRequestProvider.notifier).state = link.requestId;
          ref.read(shellTabProvider.notifier).state = ShellTab.requests;
        case CompanionDestination.link:
          ref.read(shellTabProvider.notifier).state = ShellTab.devices;
      }
    } catch (error) {
      if (!mounted) return;
      ref.read(shellTabProvider.notifier).state = ShellTab.devices;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString().replaceFirst('Bad state: ', '')),
        ),
      );
    } finally {
      _routingDeepLink = false;
    }
  }

  void _handleIncomingShare(IncomingShare share) {
    if (!mounted) return;
    ref.read(incomingShareProvider.notifier).state = share;
    ref.read(shellTabProvider.notifier).state = ShellTab.chat;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _inactiveTimer?.cancel();
      _inBackground = false;
      unawaited(_enterForeground());
      return;
    }
    if (state == AppLifecycleState.inactive) {
      _inactiveTimer?.cancel();
      _inactiveTimer = Timer(
        const Duration(milliseconds: 900),
        _enterBackground,
      );
      return;
    }
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden ||
        state == AppLifecycleState.detached) {
      _enterBackground();
    }
  }

  Future<void> _enterForeground() {
    if (!_supportsBackgroundConnection) return Future.value();
    final inFlight = _foregroundInFlight;
    if (inFlight != null) return inFlight;
    final operation = () async {
      await _backgroundInFlight;
      // The visible app is the sole socket owner. Fully stopping the Android
      // service avoids a cross-isolate reconnect race in which both clients
      // authenticate with the same device identity and repeatedly replace
      // each other. A later background lifecycle transition starts it again
      // only when the selected power policy requires it.
      await BackgroundConnectionService.stopAndWait();
      if (!mounted) return;
      final socket = ref.read(wsServiceProvider);
      if (socket != null && !socket.isConnected) {
        await socket.ensureConnected();
      }
      if (socket != null && socket.isConnected) {
        final resumed = await TransferService.resumePendingUploads(
          socket: socket,
        );
        if (!mounted) return;
        for (final artifact in resumed) {
          ref.read(artifactsProvider.notifier).upsert(artifact);
        }
        if (resumed.isNotEmpty) {
          final strings = AppLocalizations.of(context);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                resumed.length == 1
                    ? strings.uploadResumedOne(resumed.single.name)
                    : strings.uploadResumedMany(resumed.length),
              ),
            ),
          );
        }
      }
    }();
    _foregroundInFlight = operation;
    return operation.whenComplete(() {
      if (identical(_foregroundInFlight, operation)) {
        _foregroundInFlight = null;
      }
    });
  }

  void _enterBackground() {
    if (!_supportsBackgroundConnection) return;
    if (_inBackground) return;
    _inBackground = true;
    final socket = ref.read(wsServiceProvider);
    final operation = () async {
      try {
        await socket?.suspend();
        // `detached` may dispose the Flutter widget before the WebSocket close
        // handshake finishes. The already-running Android service still must
        // take ownership so notifications continue after the UI is gone.
        if (!_inBackground) return;
        final mode = CompanionPreferences.instance.powerMode;
        final hasActiveWork =
            ref.read(dagProvider).any((step) => _isActive(step.status)) ||
            ref
                .read(subAgentProvider)
                .any((agent) => _isActive(agent.status)) ||
            ref.read(permissionsProvider).isNotEmpty ||
            ref.read(questionsProvider).isNotEmpty;
        if (!CompanionPowerPolicy.shouldRunInBackground(
          mode,
          hasActiveWork: hasActiveWork,
        )) {
          BackgroundConnectionService.stop();
          return;
        }
        await BackgroundConnectionService.resumeForBackground(mode);
      } catch (_) {
        // Lifecycle handoff will be retried on the next state transition.
      }
    }();
    _backgroundInFlight = operation;
    unawaited(
      operation.whenComplete(() {
        if (identical(_backgroundInFlight, operation)) {
          _backgroundInFlight = null;
        }
      }),
    );
  }

  static bool _isActive(String status) {
    final normalized = status.toLowerCase();
    return normalized == 'running' ||
        normalized == 'in_progress' ||
        normalized == 'waiting' ||
        normalized.endsWith('ing');
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(backendSyncProvider);
    final selected = ref.watch(shellTabProvider);
    final actionCount =
        ref.watch(permissionsProvider).length +
        ref.watch(questionsProvider).length;
    final strings = AppLocalizations.of(context);

    void select(int index) {
      HapticFeedback.selectionClick();
      ref.read(shellTabProvider.notifier).state = index;
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final useRail =
            constraints.maxWidth >= AdaptiveBreakpoints.navigationRail;
        final content = IndexedStack(index: selected, children: _screens);
        return Scaffold(
          body: useRail
              ? SafeArea(
                  child: Row(
                    children: [
                      NavigationRail(
                        key: const Key('adaptive-navigation-rail'),
                        selectedIndex: selected,
                        onDestinationSelected: select,
                        labelType: NavigationRailLabelType.all,
                        destinations: [
                          NavigationRailDestination(
                            icon: const Icon(Icons.space_dashboard_outlined),
                            selectedIcon: const Icon(
                              Icons.space_dashboard_rounded,
                            ),
                            label: Text(strings.tabDeck),
                          ),
                          NavigationRailDestination(
                            icon: const Icon(Icons.forum_outlined),
                            selectedIcon: const Icon(Icons.forum_rounded),
                            label: Text(strings.tabSessions),
                          ),
                          NavigationRailDestination(
                            icon: Badge(
                              isLabelVisible: actionCount > 0,
                              label: Text('$actionCount'),
                              child: const Icon(Icons.inbox_outlined),
                            ),
                            selectedIcon: Badge(
                              isLabelVisible: actionCount > 0,
                              label: Text('$actionCount'),
                              child: const Icon(Icons.inbox_rounded),
                            ),
                            label: Text(strings.tabInbox),
                          ),
                          NavigationRailDestination(
                            icon: const Icon(Icons.folder_outlined),
                            selectedIcon: const Icon(Icons.folder_rounded),
                            label: Text(strings.tabTransfers),
                          ),
                          NavigationRailDestination(
                            icon: const Icon(Icons.devices_outlined),
                            selectedIcon: const Icon(Icons.devices_rounded),
                            label: Text(strings.tabLink),
                          ),
                        ],
                      ),
                      const VerticalDivider(width: 1),
                      Expanded(child: content),
                    ],
                  ),
                )
              : content,
          bottomNavigationBar: useRail
              ? null
              : DecoratedBox(
                  decoration: const BoxDecoration(
                    border: Border(top: BorderSide(color: AppPalette.stroke)),
                  ),
                  child: NavigationBar(
                    selectedIndex: selected,
                    onDestinationSelected: select,
                    destinations: [
                      NavigationDestination(
                        icon: const Icon(Icons.space_dashboard_outlined),
                        selectedIcon: const Icon(Icons.space_dashboard_rounded),
                        label: strings.tabDeck,
                      ),
                      NavigationDestination(
                        icon: const Icon(Icons.forum_outlined),
                        selectedIcon: const Icon(Icons.forum_rounded),
                        label: strings.tabSessions,
                      ),
                      NavigationDestination(
                        icon: Badge(
                          isLabelVisible: actionCount > 0,
                          label: Text('$actionCount'),
                          child: const Icon(Icons.inbox_outlined),
                        ),
                        selectedIcon: Badge(
                          isLabelVisible: actionCount > 0,
                          label: Text('$actionCount'),
                          child: const Icon(Icons.inbox_rounded),
                        ),
                        label: strings.tabInbox,
                      ),
                      NavigationDestination(
                        icon: const Icon(Icons.folder_outlined),
                        selectedIcon: const Icon(Icons.folder_rounded),
                        label: strings.tabTransfers,
                      ),
                      NavigationDestination(
                        icon: const Icon(Icons.devices_outlined),
                        selectedIcon: const Icon(Icons.devices_rounded),
                        label: strings.tabLink,
                      ),
                    ],
                  ),
                ),
        );
      },
    );
  }
}
