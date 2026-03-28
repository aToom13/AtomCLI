import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'screens/qr_scan_screen.dart';
import 'screens/home_screen.dart';
import 'screens/permissions_screen.dart';
import 'screens/chat_screen.dart';
import 'services/auth_service.dart';
import 'services/notification_service.dart';
import 'providers/app_providers.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF0A0D13),
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );

  await NotificationService.instance.init();
  final alreadyPaired = await AuthService.instance.tryLoadExisting();

  runApp(ProviderScope(child: AtomCLICompanionApp(startPaired: alreadyPaired)));
}

class AtomCLICompanionApp extends StatelessWidget {
  final bool startPaired;
  const AtomCLICompanionApp({super.key, required this.startPaired});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AtomCLI Companion',
      debugShowCheckedModeBanner: false,
      theme: _buildTheme(),
      initialRoute: startPaired ? '/home' : '/scan',
      routes: {
        '/scan': (_) => const QrScanScreen(),
        '/home': (_) => const MainShell(),
      },
    );
  }

  ThemeData _buildTheme() {
    const bg = Color(0xFF0A0D13);
    const surface = Color(0xFF111720);
    const card = Color(0xFF161D28);
    const border = Color(0xFF1E2A3A);
    const accent = Color(0xFF4F9EFF);
    const accentGreen = Color(0xFF3FB950);
    const accentRed = Color(0xFFFF6B6B);
    const textPrimary = Color(0xFFE6EDF3);
    const textSecondary = Color(0xFF8B949E);

    return ThemeData(
      colorScheme: ColorScheme(
        brightness: Brightness.dark,
        primary: accent,
        onPrimary: Colors.white,
        secondary: accentGreen,
        onSecondary: Colors.white,
        error: accentRed,
        onError: Colors.white,
        surface: surface,
        onSurface: textPrimary,
        surfaceTint: accent.withValues(alpha: 0.05),
      ),
      useMaterial3: true,
      scaffoldBackgroundColor: bg,
      cardColor: card,
      dividerColor: border,
      textTheme: const TextTheme(
        bodyLarge: TextStyle(color: textPrimary, fontSize: 14, height: 1.5),
        bodyMedium: TextStyle(color: textSecondary, fontSize: 13, height: 1.4),
        bodySmall: TextStyle(color: textSecondary, fontSize: 11),
        titleLarge: TextStyle(
          color: textPrimary,
          fontSize: 18,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.3,
        ),
        titleMedium: TextStyle(
          color: textPrimary,
          fontSize: 15,
          fontWeight: FontWeight.w600,
        ),
        labelSmall: TextStyle(color: textSecondary, fontSize: 11),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: surface,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        iconTheme: IconThemeData(color: textPrimary),
        titleTextStyle: TextStyle(
          color: textPrimary,
          fontSize: 16,
          fontWeight: FontWeight.w700,
        ),
        systemOverlayStyle: SystemUiOverlayStyle(
          statusBarColor: Colors.transparent,
          statusBarIconBrightness: Brightness.light,
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: surface,
        elevation: 0,
        indicatorColor: accent.withValues(alpha: 0.15),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return const TextStyle(
              color: accent,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            );
          }
          return const TextStyle(color: textSecondary, fontSize: 11);
        }),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return const IconThemeData(color: accent, size: 22);
          }
          return const IconThemeData(color: textSecondary, size: 22);
        }),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: card,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
      ),
    );
  }
}

/// Main shell with bottom navigation: Workflow + Chat + Permissions.
class MainShell extends ConsumerStatefulWidget {
  const MainShell({super.key});

  @override
  ConsumerState<MainShell> createState() => _MainShellState();
}

class _MainShellState extends ConsumerState<MainShell> {
  int _index = 0;
  bool _dispatching = false;

  static const _screens = [HomeScreen(), ChatScreen(), PermissionsScreen()];

  @override
  Widget build(BuildContext context) {
    // Wire up event dispatch once per widget lifetime
    if (!_dispatching) {
      _dispatching = true;
      dispatchBackendEvents(ref);
    }
    final permCount = ref.watch(permissionsProvider).length;
    final questCount = ref.watch(questionsProvider).length;
    final totalActionCount = permCount + questCount;

    return Scaffold(
      body: IndexedStack(index: _index, children: _screens),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: const Color(0xFF111720),
          border: const Border(top: BorderSide(color: Color(0xFF1E2A3A))),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.4),
              blurRadius: 16,
              offset: const Offset(0, -4),
            ),
          ],
        ),
        child: SafeArea(
          child: NavigationBar(
            backgroundColor: Colors.transparent,
            elevation: 0,
            selectedIndex: _index,
            onDestinationSelected: (i) {
              HapticFeedback.selectionClick();
              setState(() => _index = i);
            },
            destinations: [
              const NavigationDestination(
                icon: Icon(Icons.account_tree_outlined),
                selectedIcon: Icon(Icons.account_tree),
                label: 'Workflow',
              ),
              const NavigationDestination(
                icon: Icon(Icons.chat_bubble_outline),
                selectedIcon: Icon(Icons.chat_bubble),
                label: 'Chat',
              ),
              NavigationDestination(
                icon: Badge(
                  isLabelVisible: totalActionCount > 0,
                  label: Text('$totalActionCount'),
                  child: const Icon(Icons.shield_outlined),
                ),
                selectedIcon: Badge(
                  isLabelVisible: totalActionCount > 0,
                  label: Text('$totalActionCount'),
                  child: const Icon(Icons.shield),
                ),
                label: 'Permissions',
              ),
            ],
          ),
        ),
      ),
    );
  }
}
