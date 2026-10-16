import 'dart:ui' show DisplayFeature, DisplayFeatureState, DisplayFeatureType;

import 'package:atomcli_companion/models.dart';
import 'package:atomcli_companion/main.dart' show MainShell;
import 'package:atomcli_companion/l10n/app_localizations.dart';
import 'package:atomcli_companion/providers/app_providers.dart';
import 'package:atomcli_companion/screens/chat_screen.dart';
import 'package:atomcli_companion/screens/image_annotation_screen.dart';
import 'package:atomcli_companion/screens/link_screen.dart';
import 'package:atomcli_companion/screens/overview_screen.dart';
import 'package:atomcli_companion/screens/permissions_screen.dart';
import 'package:atomcli_companion/theme/app_theme.dart';
import 'package:atomcli_companion/widgets/adaptive_layout.dart';
import 'package:atomcli_companion/services/auth_service.dart';
import 'package:atomcli_companion/services/companion_preferences.dart';
import 'package:atomcli_companion/services/power_policy.dart';
import 'package:atomcli_companion/services/privacy_policy.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

part 'screens_test_support.dart';

void main() {
  testWidgets('overview exposes connection and working product areas', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(testApp(const OverviewScreen()));

    expect(find.text('Command deck'), findsOneWidget);
    expect(find.text('OFFLINE'), findsOneWidget);
    expect(find.bySemanticsLabel('Connection status: Offline'), findsOneWidget);
    expect(find.text('New session'), findsOneWidget);
    expect(find.text('Requests'), findsOneWidget);
    expect(find.text('No active execution'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('No sessions yet'),
      180,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('No sessions yet'), findsOneWidget);
    semantics.dispose();
  });

  testWidgets('core companion surfaces render in Turkish', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          locale: const Locale('tr'),
          theme: AppTheme.dark,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const TransfersScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('DOSYALAR VE ÖNİZLEMELER'), findsOneWidget);
    expect(find.text('Henüz transfer yok'), findsOneWidget);
    expect(find.text('Dosya, oturum veya makine ara'), findsOneWidget);
  });

  testWidgets('deck groups files and previews by paired machine', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1080, 1920);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final socket = WebSocketService(
      endpoints: ['ws://100.64.0.1:4096/companion/ws'],
    );
    final container = ProviderContainer(
      overrides: [
        artifactsProvider.overrideWith(() => TestArtifactsNotifier()),
        previewsProvider.overrideWith(() => TestPreviewsNotifier()),
        wsServiceProvider.overrideWith((ref) => socket),
      ],
    );
    addTearDown(container.dispose);
    expect(container.read(artifactsProvider), hasLength(1));
    expect(container.read(previewsProvider), hasLength(1));
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          theme: AppTheme.dark,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const TransfersScreen(),
        ),
      ),
    );
    await tester.pump();

    for (var attempt = 0; attempt < 10; attempt++) {
      if (find.text('RECEIVED ITEMS').evaluate().isNotEmpty) break;
      await tester.drag(find.byType(ListView), const Offset(0, -90));
      await tester.pump();
    }

    expect(find.text('FILES AND PREVIEWS'), findsOneWidget);
    expect(find.text('From cachyos-atom13'), findsOneWidget);
    expect(find.text('Build report'), findsOneWidget);
    expect(find.text('Project site'), findsOneWidget);
    expect(find.byKey(const Key('transfer-search-field')), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('transfer-search-field')),
      'missing item',
    );
    await tester.pump();
    expect(find.text('Build report'), findsNothing);
    await tester.enterText(
      find.byKey(const Key('transfer-search-field')),
      'report',
    );
    await tester.pump();
    expect(find.text('Build report'), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('transfer-filter-images')));
    await tester.tap(find.byKey(const Key('transfer-filter-images')));
    await tester.pump();
    expect(find.text('Build report'), findsNothing);
    await tester.tap(find.byKey(const Key('transfer-filter-all')));
    await tester.pump();
    await socket.dispose();
  });

  testWidgets(
    'Mission Control shows progress, nested agents and real decisions',
    (tester) async {
      final semantics = tester.ensureSemantics();
      tester.view.physicalSize = const Size(1080, 2200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            sessionListProvider.overrideWith(TestMissionSessionsNotifier.new),
            conversationProvider.overrideWith(
              TestMissionConversationNotifier.new,
            ),
            dagProvider.overrideWith(TestMissionDagNotifier.new),
            subAgentProvider.overrideWith(TestMissionAgentsNotifier.new),
            permissionsProvider.overrideWith(
              () => TestMissionPermissionsNotifier(),
            ),
            wsServiceProvider.overrideWith((ref) => null),
          ],
          child: MaterialApp(
            theme: AppTheme.dark,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const OverviewScreen(),
          ),
        ),
      );
      await tester.scrollUntilVisible(
        find.text('wf_mission'),
        180,
        scrollable: find.byType(Scrollable).first,
      );

      expect(find.text('wf_mission'), findsOneWidget);
      expect(find.text('wf_other_process'), findsNothing);
      expect(find.text('1/2 steps · 1 agents'), findsOneWidget);
      expect(find.text('WAIT'), findsOneWidget);
      expect(find.text('Review the fix'), findsOneWidget);
      expect(
        find.bySemanticsLabel('Mission progress: 1 of 2 steps complete'),
        findsOneWidget,
      );
      expect(find.bySemanticsLabel('inspect, status DONE'), findsOneWidget);
      expect(
        find.bySemanticsLabel('Open agent Review the fix, status LIVE'),
        findsOneWidget,
      );
      expect(find.text('1 decision'), findsOneWidget);
      expect(find.text('Pause'), findsNothing);
      expect(find.text('Stop'), findsNothing);
      semantics.dispose();
    },
  );

  testWidgets('empty inbox clearly communicates its state', (tester) async {
    await tester.pumpWidget(testApp(const PermissionsScreen()));

    expect(find.text('Inbox clear'), findsOneWidget);
    expect(
      find.text('Permission requests and questions will arrive here.'),
      findsOneWidget,
    );
  });

  testWidgets(
    'sessions exposes searchable history and applies model selection',
    (tester) async {
      await tester.pumpWidget(chatTestApp());
      await tester.pump();

      await tester.tap(find.byKey(const Key('active-session-header')));
      await tester.pumpAndSettle();
      expect(find.text('Session history  2'), findsOneWidget);
      expect(find.text('First project'), findsOneWidget);
      expect(find.text('Second project'), findsOneWidget);
      await tester.tap(find.text('Second project'));
      await tester.pumpAndSettle();
      expect(find.text('Second project'), findsOneWidget);

      await tester.tap(find.byKey(const Key('model-selector')));
      await tester.pumpAndSettle();
      expect(find.text('Models  2'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilterChip, 'Free'));
      await tester.pumpAndSettle();
      expect(find.text('Model A'), findsOneWidget);
      expect(find.text('Model B'), findsNothing);
      await tester.tap(find.widgetWithText(FilterChip, 'Free'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Model B'));
      await tester.pumpAndSettle();
      expect(find.text('Model B · Two'), findsOneWidget);
      expect(find.text('Models  2'), findsNothing);
    },
  );

  testWidgets('chat exposes provider failures and their exact model route', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1080, 2200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sessionListProvider.overrideWith(TestSessionsNotifier.new),
          modelsListProvider.overrideWith(TestModelsNotifier.new),
          conversationProvider.overrideWith(
            TestFailureConversationNotifier.new,
          ),
          connectionStateProvider.overrideWith(
            (ref) => WsConnectionState.connected,
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.dark,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const ChatScreen(),
        ),
      ),
    );
    await tester.pump();

    expect(find.byKey(const Key('assistant-failure-card')), findsOneWidget);
    expect(find.text('AtomCLI could not answer'), findsOneWidget);
    expect(find.text('HTTP 402'), findsOneWidget);
    expect(find.text('kilocode/z-ai/glm-5.3-flash'), findsOneWidget);

    await tester.tap(find.byKey(const Key('failure-select-model')));
    await tester.pumpAndSettle();
    expect(find.text('Models  2'), findsOneWidget);
  });

  testWidgets('chat renders checkpoint cards with progress and blockers', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1080, 2200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sessionListProvider.overrideWith(TestSessionsNotifier.new),
          modelsListProvider.overrideWith(TestModelsNotifier.new),
          conversationProvider.overrideWith(
            TestCheckpointConversationNotifier.new,
          ),
          connectionStateProvider.overrideWith(
            (ref) => WsConnectionState.connected,
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.dark,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const ChatScreen(),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Checkpoint #2'), findsOneWidget);
    expect(find.text('BLOCKED'), findsOneWidget);
    expect(find.text('Blocked on environment'), findsOneWidget);

    await tester.tap(find.text('Checkpoint #2'));
    await tester.pumpAndSettle();

    expect(find.text('Progress'), findsOneWidget);
    expect(find.text('Completed work'), findsOneWidget);
    expect(find.text('• implemented parser'), findsOneWidget);
    expect(find.text('Remaining work'), findsOneWidget);
    expect(find.text('• wire the renderer'), findsOneWidget);
    expect(find.text('Failures'), findsOneWidget);
    expect(find.text('• network unavailable'), findsOneWidget);
    expect(find.text('Blockers'), findsOneWidget);
    expect(find.text('• no network access'), findsOneWidget);
    expect(find.text('Next actions'), findsOneWidget);
    expect(find.text('• retry environment setup'), findsOneWidget);
  });

  testWidgets('idle sessions expose a confirmation-gated delete action', (
    tester,
  ) async {
    await tester.pumpWidget(chatTestApp());
    await tester.pump();

    await tester.tap(find.byKey(const Key('active-session-header')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('session-options-session_one')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete session'));
    await tester.pumpAndSettle();

    expect(find.text('Delete this session?'), findsOneWidget);
    expect(find.byKey(const Key('confirm-delete-session')), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.text('Delete this session?'), findsNothing);
  });

  testWidgets('composer exposes mobile input controls and attachment choices', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1080, 1920);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(chatTestApp());
    await tester.pump();

    expect(find.byKey(const Key('speech-input-button')), findsOneWidget);
    expect(find.byKey(const Key('attachment-input-button')), findsOneWidget);
    expect(
      tester.getSize(find.byKey(const Key('speech-input-button'))).height,
      greaterThanOrEqualTo(48),
    );
    expect(
      tester.getSize(find.byKey(const Key('attachment-input-button'))).width,
      greaterThanOrEqualTo(48),
    );
    expect(
      tester.getSize(find.byKey(const Key('model-selector'))).height,
      greaterThanOrEqualTo(48),
    );
    await tester.tap(find.byKey(const Key('attachment-input-button')));
    await tester.pumpAndSettle();

    expect(find.text('Camera'), findsOneWidget);
    expect(find.text('Photo or image'), findsOneWidget);
    expect(find.text('Mark up an image'), findsOneWidget);
    expect(find.text('Any file'), findsOneWidget);
  });

  testWidgets('chat workflow progress is scoped to the selected session', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sessionListProvider.overrideWith(TestSessionsNotifier.new),
          conversationProvider.overrideWith(
            TestSelectedConversationNotifier.new,
          ),
          dagProvider.overrideWith(TestSessionScopedDagNotifier.new),
          connectionStateProvider.overrideWith(
            (ref) => WsConnectionState.connected,
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.dark,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const ChatScreen(),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Workflow 1/1'), findsOneWidget);
    expect(find.text('Workflow 1/2'), findsNothing);
  });

  testWidgets('chat groups live sub-agent work in one bounded activity card', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1080, 2200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sessionListProvider.overrideWith(TestSessionsNotifier.new),
          conversationProvider.overrideWith(
            TestChatAgentConversationNotifier.new,
          ),
          subAgentProvider.overrideWith(TestChatAgentsNotifier.new),
          connectionStateProvider.overrideWith(
            (ref) => WsConnectionState.connected,
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.dark,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const ChatScreen(),
        ),
      ),
    );
    await tester.pump();

    expect(find.byKey(const Key('sub-agent-work-card')), findsOneWidget);
    expect(find.byKey(const Key('sub-agent-activity-list')), findsOneWidget);
    expect(find.text('Sub-agent work'), findsOneWidget);
    expect(find.text('Build game'), findsWidgets);
    expect(find.text('Created game.js'), findsOneWidget);
    expect(find.text('Running Playwright tests'), findsOneWidget);
    expect(find.text('agent'), findsNothing);
  });

  testWidgets('core deck remains usable at large system text scale', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(720, 1280);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      testApp(
        MediaQuery(
          data: const MediaQueryData(
            size: Size(360, 640),
            textScaler: TextScaler.linear(2),
          ),
          child: const OverviewScreen(),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Command deck'), findsOneWidget);
    final exception = tester.takeException();
    expect(
      exception,
      isNull,
      reason: exception is FlutterError
          ? exception.toStringDeep()
          : exception?.toString(),
    );
  });

  testWidgets('wide sessions keeps history and conversation in two panes', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(chatTestApp());
    await tester.pump();

    expect(find.byKey(const Key('tablet-session-pane')), findsOneWidget);
    expect(find.byKey(const Key('tablet-session-search')), findsOneWidget);
    expect(find.byKey(const Key('session-history-button')), findsNothing);
    expect(find.text('First project'), findsOneWidget);
    expect(find.text('Second project'), findsOneWidget);
    expect(find.byKey(const Key('message-input')), findsOneWidget);
  });

  testWidgets('two-pane layout reserves a separating fold or hinge', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    const hinge = DisplayFeature(
      bounds: Rect.fromLTWH(580, 0, 24, 800),
      type: DisplayFeatureType.hinge,
      state: DisplayFeatureState.unknown,
    );
    await tester.pumpWidget(
      testApp(
        MediaQuery(
          data: const MediaQueryData(
            size: Size(1200, 800),
            displayFeatures: [hinge],
          ),
          child: const AdaptiveTwoPane(
            compact: SizedBox(key: Key('compact-pane')),
            primary: ColoredBox(key: Key('primary-pane'), color: Colors.red),
            detail: ColoredBox(key: Key('detail-pane'), color: Colors.blue),
          ),
        ),
      ),
    );

    expect(find.byKey(const Key('compact-pane')), findsNothing);
    expect(tester.getSize(find.byKey(const Key('primary-pane'))).width, 592);
    expect(tester.getSize(find.byKey(const Key('detail-pane'))).width, 584);
  });

  testWidgets('tablet shell uses a persistent navigation rail', (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(testApp(const MainShell()));
    await tester.pump();

    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.byKey(const Key('adaptive-navigation-rail')), findsNothing);

    tester.view.physicalSize = const Size(1000, 800);
    await tester.pump();
    expect(find.byKey(const Key('adaptive-navigation-rail')), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
  });

  testWidgets(
    'image annotation offers draw arrow box and explicit draft safety',
    (tester) async {
      await tester.pumpWidget(
        testApp(
          const ImageAnnotationScreen(
            imagePath: '/missing-test-image.png',
            filename: 'capture.jpg',
          ),
        ),
      );
      await tester.pump();

      expect(find.text('Draw'), findsOneWidget);
      expect(find.text('Arrow'), findsOneWidget);
      expect(find.text('Box'), findsOneWidget);
      expect(find.text('Use image'), findsOneWidget);
      expect(
        find.text(
          'Nothing is sent until you return to the draft and press Send.',
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets('permission inbox exposes once, always and autonomous actions', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          permissionsProvider.overrideWith(() => TestPermissionsNotifier()),
        ],
        child: MaterialApp(
          theme: AppTheme.dark,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const PermissionsScreen(),
        ),
      ),
    );

    expect(find.text('Allow once'), findsOneWidget);
    expect(find.text('Always allow'), findsOneWidget);
    expect(find.text('Full autonomous'), findsOneWidget);
  });

  testWidgets('link center groups projects under their physical machine', (
    tester,
  ) async {
    FlutterSecureStorage.setMockInitialValues({});
    AuthService.resetForTests();
    final auth = AuthService.instance;
    await auth.init('Test phone');
    await auth.saveMachineProfile(
      machineId: 'machine-a',
      machineName: 'CachyOS workstation',
      projectDirectory: '/code/alpha',
      processId: 'process-alpha',
      bridgeId: 'bridge-alpha',
      endpoints: ['ws://192.168.1.20:4096/companion/ws'],
    );
    await auth.saveMachineProfile(
      machineId: 'machine-a',
      machineName: 'CachyOS workstation',
      projectDirectory: '/code/beta',
      processId: 'process-beta',
      bridgeId: 'bridge-beta',
      endpoints: ['ws://192.168.1.20:5096/companion/ws'],
    );
    addTearDown(AuthService.resetForTests);
    final originalPowerMode = CompanionPreferences.instance.powerMode;
    final originalPrivacy = CompanionPreferences.instance.notificationPrivacy;
    final originalScreenProtection =
        CompanionPreferences.instance.protectScreenPreviews;
    addTearDown(
      () => CompanionPreferences.instance.powerMode = originalPowerMode,
    );
    addTearDown(() {
      CompanionPreferences.instance.notificationPrivacy = originalPrivacy;
      CompanionPreferences.instance.protectScreenPreviews =
          originalScreenProtection;
    });

    await tester.pumpWidget(
      ProviderScope(
        overrides: [wsServiceProvider.overrideWith((ref) => null)],
        child: MaterialApp(
          theme: AppTheme.dark,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const LinkScreen(),
        ),
      ),
    );
    await tester.scrollUntilVisible(
      find.text('CachyOS workstation'),
      180,
      scrollable: find.byType(Scrollable).first,
    );

    expect(find.text('1 machines · 2 links'), findsOneWidget);
    expect(find.text('CachyOS workstation'), findsOneWidget);
    expect(find.text('alpha'), findsOneWidget);
    expect(find.text('beta'), findsOneWidget);
    expect(find.text('Pair another AtomCLI process'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.byKey(const Key('power-mode-selector')),
      180,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(const Key('power-mode-selector')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Real time').last);
    await tester.pumpAndSettle();
    expect(
      CompanionPreferences.instance.powerMode,
      ConnectionPowerMode.realtime,
    );
    expect(
      find.text(
        'Keep one background connection for the active machine. Uses more battery.',
      ),
      findsOneWidget,
    );
    await tester.scrollUntilVisible(
      find.byKey(const Key('live-update-settings')),
      180,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.byKey(const Key('live-update-settings')), findsOneWidget);
    await tester.scrollUntilVisible(
      find.byKey(const Key('notification-privacy-selector')),
      180,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(const Key('notification-privacy-selector')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Hide on lock screen').last);
    await tester.pumpAndSettle();
    expect(
      CompanionPreferences.instance.notificationPrivacy,
      NotificationPrivacyMode.hidden,
    );
    expect(find.byKey(const Key('screen-protection-switch')), findsOneWidget);
  });
}

class TestPermissionsNotifier extends PermissionsNotifier {
  @override
  List<PendingPermission> build() => const [
    PendingPermission(
      reqId: 'permission_1',
      sessionId: 'session_1',
      permission: 'bash',
      patterns: ['bun test'],
      metadata: {},
    ),
  ];
}
