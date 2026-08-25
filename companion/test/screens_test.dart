import 'package:atomcli_companion/models.dart';
import 'package:atomcli_companion/providers/app_providers.dart';
import 'package:atomcli_companion/screens/chat_screen.dart';
import 'package:atomcli_companion/screens/overview_screen.dart';
import 'package:atomcli_companion/screens/permissions_screen.dart';
import 'package:atomcli_companion/theme/app_theme.dart';
import 'package:atomcli_companion/services/websocket_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

Widget testApp(Widget child) {
  return ProviderScope(
    child: MaterialApp(theme: AppTheme.dark, home: child),
  );
}

class TestSessionsNotifier extends SessionListNotifier {
  @override
  List<SessionInfo> build() => [
    SessionInfo(id: 'session_one', title: 'First project', updated: 1),
    SessionInfo(id: 'session_two', title: 'Second project', updated: 2),
  ];
}

class TestModelsNotifier extends ModelsListNotifier {
  @override
  List<ModelInfo> build() => [
    ModelInfo(
      id: 'one/model-a',
      name: 'Model A',
      providerName: 'One',
      free: true,
    ),
    ModelInfo(id: 'two/model-b', name: 'Model B', providerName: 'Two'),
  ];
}

class TestAgentsNotifier extends AgentsListNotifier {
  @override
  List<AgentInfo> build() => [
    AgentInfo(name: 'agent', description: 'Primary agent', mode: 'primary'),
  ];
}

class TestArtifactsNotifier extends ArtifactsNotifier {
  @override
  List<CompanionArtifact> build() => [
    CompanionArtifact.fromJson({
      'id': 'artifact_1',
      'kind': 'file',
      'direction': 'pc_to_mobile',
      'sourceDevice': 'cachyos-atom13',
      'title': 'Build report',
      'name': 'report.txt',
      'mime': 'text/plain',
      'size': 42,
      'createdAt': 1000,
      'downloadPath': '/companion/artifact/artifact_1?token=test',
    }),
  ];
}

class TestPreviewsNotifier extends PreviewsNotifier {
  @override
  List<CompanionPreview> build() => [
    CompanionPreview.fromJson({
      'id': 'preview_1',
      'title': 'Project site',
      'command': 'bun run dev',
      'port': 3000,
      'status': 'running',
      'endpoints': ['http://100.64.0.1:3000'],
      'logTail': 'ready',
      'createdAt': 1000,
      'sourceDevice': 'cachyos-atom13',
      'directory': '/home/user/project',
    }),
  ];
}

Widget chatTestApp() {
  return ProviderScope(
    overrides: [
      sessionListProvider.overrideWith(TestSessionsNotifier.new),
      modelsListProvider.overrideWith(TestModelsNotifier.new),
      agentsListProvider.overrideWith(TestAgentsNotifier.new),
      connectionStateProvider.overrideWith(
        (ref) => WsConnectionState.connected,
      ),
    ],
    child: MaterialApp(theme: AppTheme.dark, home: const ChatScreen()),
  );
}

void main() {
  testWidgets('overview exposes connection and working product areas', (
    tester,
  ) async {
    await tester.pumpWidget(testApp(const OverviewScreen()));

    expect(find.text('Command deck'), findsOneWidget);
    expect(find.text('OFFLINE'), findsOneWidget);
    expect(find.text('RECEIVED ITEMS'), findsOneWidget);
    expect(find.text('Nothing received yet'), findsOneWidget);
    expect(find.text('No active execution'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('No sessions yet'),
      180,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('No sessions yet'), findsOneWidget);
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
        child: MaterialApp(theme: AppTheme.dark, home: const OverviewScreen()),
      ),
    );
    await tester.pump();

    for (var attempt = 0; attempt < 10; attempt++) {
      if (find.text('RECEIVED ITEMS').evaluate().isNotEmpty) break;
      await tester.drag(find.byType(CustomScrollView), const Offset(0, -90));
      await tester.pump();
    }

    expect(find.text('RECEIVED ITEMS'), findsOneWidget);
    expect(find.text('From cachyos-atom13'), findsOneWidget);
    expect(find.text('Build report'), findsOneWidget);
    expect(find.text('Project site'), findsOneWidget);
    expect(find.text('Open'), findsOneWidget);
    expect(find.text('Logs'), findsOneWidget);
    await socket.dispose();
  });

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

      await tester.tap(find.byKey(const Key('session-history-button')));
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
      expect(find.text('Model B'), findsOneWidget);
      expect(find.text('Models  2'), findsNothing);
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
          home: const PermissionsScreen(),
        ),
      ),
    );

    expect(find.text('Allow once'), findsOneWidget);
    expect(find.text('Always allow'), findsOneWidget);
    expect(find.text('Full autonomous'), findsOneWidget);
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
