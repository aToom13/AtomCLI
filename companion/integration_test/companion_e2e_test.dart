import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'package:atomcli_companion/main.dart' as app;
import 'package:atomcli_companion/l10n/app_localizations.dart';
import 'package:atomcli_companion/models.dart';
import 'package:atomcli_companion/providers/app_providers.dart';
import 'package:atomcli_companion/services/auth_service.dart';
import 'package:atomcli_companion/services/companion_preferences.dart';
import 'package:atomcli_companion/services/power_policy.dart';
import 'package:atomcli_companion/services/profile_switch_service.dart';
import 'package:atomcli_companion/services/transfer_service.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  WidgetController.hitTestWarningShouldBeFatal = true;
  const first = String.fromEnvironment('ATOMCLI_E2E_CONTROL_A');
  const second = String.fromEnvironment('ATOMCLI_E2E_CONTROL_B');

  testWidgets('real Android Companion and concurrent AtomCLI servers', (
    tester,
  ) async {
    expect(first, isNotEmpty, reason: 'Use tool/test_android_integration.py');
    expect(second, isNotEmpty);

    Future<Map<String, dynamic>> remote(String base, String path) async {
      return (await tester.runAsync(() async {
        final client = HttpClient();
        try {
          final response = await (await client.getUrl(
            Uri.parse('$base$path'),
          )).close();
          expect(response.statusCode, 200);
          return jsonDecode(await response.transform(utf8.decoder).join())
              as Map<String, dynamic>;
        } finally {
          client.close(force: true);
        }
      }))!;
    }

    Future<void> until(bool Function() condition, String reason) async {
      final deadline = DateTime.now().add(const Duration(seconds: 40));
      while (!condition() && DateTime.now().isBefore(deadline)) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 100)),
        );
        await tester.pump();
      }
      expect(condition(), isTrue, reason: reason);
    }

    Future<Map<String, dynamic>> serverUntil(
      bool Function(Map<String, dynamic>) condition,
      String reason,
    ) async {
      final deadline = DateTime.now().add(const Duration(seconds: 60));
      var state = await remote(first, '/state');
      while (!condition(state) && DateTime.now().isBefore(deadline)) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 100)),
        );
        await tester.pump();
        state = await remote(first, '/state');
      }
      expect(condition(state), isTrue, reason: reason);
      return state;
    }

    Future<void> pair(String base) async {
      final payload = await remote(base, '/pairing');
      final expectedDirectory = (await remote(base, '/state'))['directory'];
      await Clipboard.setData(ClipboardData(text: jsonEncode(payload)));
      await until(
        () => find.byIcon(Icons.content_paste_rounded).evaluate().isNotEmpty,
        'pairing UI',
      );
      await tester.tap(find.byIcon(Icons.content_paste_rounded));
      await until(
        () =>
            find.byType(app.MainShell).evaluate().isNotEmpty &&
            find.byIcon(Icons.content_paste_rounded).evaluate().isEmpty &&
            AuthService.instance.activeProfile?.projectDirectory ==
                expectedDirectory,
        'authenticated home',
      );
    }

    Future<T> online<T>(Future<T> Function() action) async {
      final result = await tester.runAsync(action);
      if (result == null) throw StateError('Device action returned no result');
      return result;
    }

    void passed(String name) => debugPrint('COMPANION_CASE_PASS $name');

    await app.main();
    await tester.pump();
    await pair(first);
    ProviderContainer container() => ProviderScope.containerOf(
      tester.element(find.byType(app.MainShell).last),
    );
    WebSocketService socket() => container().read(wsServiceProvider)!;
    await until(() => socket().isConnected, 'signed WebSocket authentication');
    await until(
      () => container().read(defaultModelProvider) != null,
      'model synchronization',
    );
    expect((await remote(first, '/state'))['clients'], 1);
    final firstProfile = AuthService.instance.activeProfileId!;
    final firstDirectory = AuthService.instance.activeProfile!.projectDirectory;
    passed('pairing-authentication-model-sync');

    await tester.tap(find.byIcon(Icons.forum_outlined).last);
    await tester.pump(const Duration(milliseconds: 500));
    final send = find.byKey(const Key('send-message-button'));
    await until(
      () => tester.widget<IconButton>(send).onPressed != null,
      'chat is ready to send',
    );
    await tester.enterText(
      find.byKey(const Key('message-input')),
      'Reply E2E_CHAT_UI. Do not use tools.',
    );
    await tester.pump();
    await tester.tap(send);
    final strings = AppLocalizations.of(
      tester.element(find.byType(app.MainShell).last),
    );
    final create = find.widgetWithText(FilledButton, strings.createSession);
    await until(
      () => create.hitTestable().evaluate().isNotEmpty,
      'new session directory confirmation',
    );
    await tester.tap(create);
    await until(
      () => container()
          .read(conversationProvider)
          .messages
          .values
          .expand((items) => items)
          .any(
            (message) =>
                message.role == 'assistant' &&
                message.parts.any(
                  (part) => part.text.contains('Completed E2E_CHAT_UI'),
                ),
          ),
      'real UI chat response',
    );
    passed('chat-ui-server-response');

    final results = await online(
      () => Future.wait([
        socket().createSession(
          text:
              'Write E2E_WRITE_A into $firstDirectory/E2E_WRITE_A.txt then reply E2E_WRITE_A.',
          model: 'device-fixture/model',
        ),
        socket().createSession(
          text:
              'Write E2E_WRITE_B into $firstDirectory/E2E_WRITE_B.txt then reply E2E_WRITE_B.',
          model: 'device-fixture/model',
        ),
      ]),
    );
    expect(results.every((item) => item.isOk), isTrue);
    final a = results[0].payload['session_id'] as String;
    final b = results[1].payload['session_id'] as String;
    expect(a, isNot(b));
    Map<String, dynamic> state = {};
    final deadline = DateTime.now().add(const Duration(seconds: 60));
    do {
      state = await remote(first, '/state');
      if ((state['files'] as Map).length >= 2) break;
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 200)),
      );
      await tester.pump();
    } while (DateTime.now().isBefore(deadline));
    expect(state['files'], containsPair('E2E_WRITE_A.txt', 'E2E_WRITE_A'));
    expect(state['files'], containsPair('E2E_WRITE_B.txt', 'E2E_WRITE_B'));
    expect(state['peakCalls'], greaterThanOrEqualTo(2));
    for (final entry in [
      (a, 'E2E_WRITE_A', 'E2E_WRITE_B'),
      (b, 'E2E_WRITE_B', 'E2E_WRITE_A'),
    ]) {
      final session = (state['sessions'] as List).singleWhere(
        (item) => item['id'] == entry.$1,
      );
      expect(jsonEncode(session['messages']), contains(entry.$2));
      expect(jsonEncode(session['messages']), isNot(contains(entry.$3)));
    }
    passed('parallel-sessions-real-tool-writes-isolated');

    final slow = await online(
      () => socket().createSession(
        text: 'Reply E2E_SLOW_CANCEL. Do not use tools.',
        model: 'device-fixture/model',
      ),
    );
    expect(slow.isOk, isTrue);
    final slowId = slow.payload['session_id'] as String;
    await serverUntil(
      (state) => (state['activeMarkers'] as List).contains('E2E_SLOW_CANCEL'),
      'slow model request started',
    );
    expect(
      (await online(() => socket().abortSession(sessionId: slowId))).isOk,
      isTrue,
    );
    state = await serverUntil(
      (state) => state['activeCalls'] == 0,
      'cancelled model response finished',
    );
    final cancelled = (state['sessions'] as List).singleWhere(
      (item) => item['id'] == slowId,
    );
    expect(
      jsonEncode(cancelled['messages']),
      isNot(contains('Completed E2E_SLOW_CANCEL')),
    );
    passed('abort-active-turn-no-late-completion');

    await remote(first, '/requests');
    await until(
      () =>
          container().read(questionsProvider).isNotEmpty &&
          container().read(permissionsProvider).isNotEmpty,
      'question and permission delivery',
    );
    final question = container().read(questionsProvider).first;
    final permission = container().read(permissionsProvider).first;
    expect(
      (await online(
        () => socket().replyQuestion(
          id: question.reqId,
          answers: [
            ['Approved'],
          ],
        ),
      )).isOk,
      isTrue,
    );
    expect(
      (await online(
        () => socket().resolvePermission(
          reqId: permission.reqId,
          resolution: 'allow_once',
        ),
      )).isOk,
      isTrue,
    );
    await until(
      () =>
          container().read(questionsProvider).isEmpty &&
          container().read(permissionsProvider).isEmpty,
      'resolved requests removed',
    );
    state = await remote(first, '/state');
    expect(
      state['resolved'],
      containsPair('question', [
        ['Approved'],
      ]),
    );
    expect(state['resolved'], containsPair('permission', 'allowed'));
    await tester.runAsync(
      () => expectLater(
        socket().resolvePermission(
          reqId: permission.reqId,
          resolution: 'allow_once',
        ),
        throwsA(
          isA<StateError>().having(
            (error) => error.message,
            'stale decision',
            contains('Already handled'),
          ),
        ),
      ),
    );
    passed('question-permission-signed-acknowledgements');

    final artifact = CompanionArtifact.fromJson(await remote(first, '/share'));
    final download = await online(
      () => TransferService.download(socket: socket(), artifact: artifact),
    );
    expect(await File(download).readAsString(), 'E2E_DOWNLOAD_CONTENT');
    final uploaded = await online(
      () => TransferService.uploadBytes(
        socket: socket(),
        sessionId: a,
        bytes: utf8.encode('E2E_UPLOAD_CONTENT'),
        filename: 'upload.txt',
        mime: 'text/plain',
      ),
    );
    expect(uploaded, isNotNull);
    expect(uploaded!.title, 'upload.txt');
    final returnedUpload = await online(
      () => TransferService.download(socket: socket(), artifact: uploaded),
    );
    expect(await File(returnedUpload).readAsString(), 'E2E_UPLOAD_CONTENT');
    passed('bidirectional-file-transfer');

    await remote(first, '/disconnect');
    await until(() => !socket().isConnected, 'connection drop visible');
    final queued = await online(
      () => socket().sendChatMessage(
        sessionId: b,
        text: 'Reply E2E_OUTBOX. Do not use tools.',
        model: 'device-fixture/model',
      ),
    );
    expect(queued.status, 'queued');
    await until(() => socket().isConnected, 'signed reconnect');
    await until(
      () => container().read(questionsProvider).isEmpty,
      'authoritative pending state after reconnect',
    );
    expect((await remote(first, '/state'))['clients'], 1);
    passed('reconnect-no-duplicate-client');

    state = await serverUntil((state) {
      final session = (state['sessions'] as List).singleWhere(
        (item) => item['id'] == b,
      );
      return jsonEncode(session['messages']).contains('Completed E2E_OUTBOX');
    }, 'offline message delivered after reconnect');
    final outboxSession = (state['sessions'] as List).singleWhere(
      (item) => item['id'] == b,
    );
    final outboxMessages = (outboxSession['messages'] as List).where(
      (message) =>
          message['info']['role'] == 'user' &&
          jsonEncode(message['parts']).contains('E2E_OUTBOX'),
    );
    expect(outboxMessages.length, 1);
    passed('offline-outbox-delivered-once');

    CompanionPreferences.instance.powerMode = ConnectionPowerMode.manual;
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await until(() => !socket().isConnected, 'app-only background suspension');
    await serverUntil(
      (state) => state['clients'] == 0,
      'background socket released',
    );
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await until(
      () => socket().isConnected,
      'foreground authentication restored',
    );
    await serverUntil(
      (state) => state['clients'] == 1,
      'single foreground socket',
    );
    CompanionPreferences.instance.powerMode = ConnectionPowerMode.balanced;
    passed('lifecycle-app-only-suspend-foreground-restore');

    Navigator.of(
      tester.element(find.byType(app.MainShell).last),
    ).pushNamed('/scan');
    await tester.pump(const Duration(milliseconds: 500));
    await pair(second);
    await until(() => socket().isConnected, 'second server authentication');
    await until(
      () =>
          container().read(currentDirectoryProvider) ==
          AuthService.instance.activeProfile!.projectDirectory,
      'second project snapshot',
    );
    expect(AuthService.instance.activeProfileId, isNot(firstProfile));
    expect(
      AuthService.instance.activeProfile!.projectDirectory,
      isNot(firstDirectory),
    );
    expect((await remote(second, '/state'))['clients'], 1);
    expect((await remote(first, '/state'))['clients'], 0);
    expect(
      container().read(conversationProvider).messages,
      isEmpty,
      reason: 'the new project must not inherit another project transcript',
    );
    final shell =
        tester.state(find.byType(app.MainShell).last) as ConsumerState;
    await online(() => ProfileSwitchService.select(shell.ref, firstProfile));
    await until(() => socket().isConnected, 'switch back to first project');
    expect(
      AuthService.instance.activeProfile!.projectDirectory,
      firstDirectory,
    );
    expect((await remote(first, '/state'))['clients'], 1);
    expect((await remote(second, '/state'))['clients'], 0);
    passed('two-processes-profile-switch-no-leaked-socket');

    expect(tester.takeException(), isNull);
  }, timeout: const Timeout(Duration(minutes: 10)));
}
