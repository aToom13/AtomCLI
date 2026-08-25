import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'providers/app_providers.dart';
import 'screens/chat_screen.dart';
import 'screens/link_screen.dart';
import 'screens/overview_screen.dart';
import 'screens/permissions_screen.dart';
import 'screens/qr_scan_screen.dart';
import 'services/auth_service.dart';
import 'services/background_connection_service.dart';
import 'services/companion_preferences.dart';
import 'services/notification_service.dart';
import 'theme/app_theme.dart';

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
  final alreadyPaired = await AuthService.instance.tryLoadExisting();
  await CompanionPreferences.instance.load();
  await BackgroundConnectionService.configure(startNow: false);
  runApp(ProviderScope(child: AtomCLIApp(startPaired: alreadyPaired)));
}

class AtomCLIApp extends StatelessWidget {
  final bool startPaired;

  const AtomCLIApp({super.key, required this.startPaired});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AtomCLI',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.dark,
      initialRoute: startPaired ? '/home' : '/scan',
      routes: {
        '/scan': (_) => const QrScanScreen(),
        '/home': (_) => const MainShell(),
      },
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
  static const _screens = [
    OverviewScreen(),
    ChatScreen(),
    PermissionsScreen(),
    LinkScreen(),
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    Future.microtask(_enterForeground);
  }

  @override
  void dispose() {
    _inactiveTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
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
    final inFlight = _foregroundInFlight;
    if (inFlight != null) return inFlight;
    final operation = () async {
      await _backgroundInFlight;
      await BackgroundConnectionService.pauseForForeground();
      if (!mounted) return;
      final socket = ref.read(wsServiceProvider);
      if (socket != null && !socket.isConnected) {
        await socket.ensureConnected();
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
        await BackgroundConnectionService.resumeForBackground();
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

  @override
  Widget build(BuildContext context) {
    ref.watch(backendSyncProvider);
    final selected = ref.watch(shellTabProvider);
    final actionCount =
        ref.watch(permissionsProvider).length +
        ref.watch(questionsProvider).length;

    return Scaffold(
      body: IndexedStack(index: selected, children: _screens),
      bottomNavigationBar: DecoratedBox(
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: AppPalette.stroke)),
        ),
        child: NavigationBar(
          selectedIndex: selected,
          onDestinationSelected: (index) {
            HapticFeedback.selectionClick();
            ref.read(shellTabProvider.notifier).state = index;
          },
          destinations: [
            const NavigationDestination(
              icon: Icon(Icons.space_dashboard_outlined),
              selectedIcon: Icon(Icons.space_dashboard_rounded),
              label: 'Deck',
            ),
            const NavigationDestination(
              icon: Icon(Icons.forum_outlined),
              selectedIcon: Icon(Icons.forum_rounded),
              label: 'Sessions',
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
              label: 'Inbox',
            ),
            const NavigationDestination(
              icon: Icon(Icons.hub_outlined),
              selectedIcon: Icon(Icons.hub_rounded),
              label: 'Link',
            ),
          ],
        ),
      ),
    );
  }
}
