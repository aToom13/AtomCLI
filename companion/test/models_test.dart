import 'dart:convert';
import 'dart:io';

import 'package:atomcli_companion/models.dart';
import 'package:atomcli_companion/l10n/app_localizations.dart';
import 'package:atomcli_companion/l10n/localized_status.dart';
import 'package:atomcli_companion/services/connection_doctor_service.dart';
import 'package:atomcli_companion/services/mobile_input_service.dart';
import 'package:atomcli_companion/generated/companion_protocol.g.dart';
import 'package:atomcli_companion/services/auth_service.dart';
import 'package:atomcli_companion/services/websocket_service.dart';
import 'package:atomcli_companion/services/notification_service.dart';
import 'package:atomcli_companion/services/deep_link_service.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('shared TypeScript and Dart contract fixtures stay equivalent', () {
    final fixtures =
        jsonDecode(
              File(
                '../libs/companion/protocol/contract-fixtures.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    final challenge = CompanionAuthChallenge.fromJson(
      Map<String, dynamic>.from(fixtures['authChallenge'] as Map),
    );
    final signed = Map<String, dynamic>.from(
      (fixtures['signedMutation'] as Map)['message'] as Map,
    );

    expect(challenge.protocolVersion, CompanionProtocolVersion.current);
    expect(
      challenge.identity?.machineId,
      '11111111-1111-4111-8111-111111111111',
    );
    expect(
      AuthService.canonicalPayload(signed),
      (fixtures['signedMutation'] as Map)['canonical'],
    );
  });

  test('English and Turkish catalogs cover core and notification surfaces', () {
    final english = lookupAppLocalizations(const Locale('en'));
    final turkish = lookupAppLocalizations(const Locale('tr'));

    expect(english.transferInbox, 'Files and previews');
    expect(turkish.transferInbox, 'Dosyalar ve önizlemeler');
    expect(turkish.tabTransfers, 'Dosyalar');
    expect(turkish.permissionRequest, 'İzin isteği');
    expect(turkish.questionsFromAtomcli(3), contains('3'));
    expect(turkish.machineLinkCounts(2, 4), '2 makine · 4 bağlantı');
    expect(turkish.expiresMinutes(5), contains('5'));
    expect(english.previewHealth, 'Preview health');
    expect(turkish.previewHealth, 'Önizleme sağlığı');
    expect(turkish.previewIssues(3), contains('3'));
    expect(
      localizedDiagnosis(turkish, EndpointIssue.refused),
      contains('hiçbir hizmet'),
    );
  });

  test('generated protocol negotiates capabilities and peer identities', () {
    expect(CompanionProtocolVersion.supports(2), isTrue);
    expect(
      CompanionCapability.supported,
      contains(CompanionCapability.identityV1),
    );

    final challenge = CompanionAuthChallenge.fromJson({
      'type': 'auth_challenge',
      'protocol': CompanionProtocolVersion.current,
      'protocol_version': CompanionProtocolVersion.current,
      'protocol_min': CompanionProtocolVersion.minimum,
      'capabilities': ['core.sync', 'identity.v1'],
      'identity': {
        'machine_id': 'machine-1',
        'process_id': 'process-1',
        'bridge_id': 'bridge-1',
        'machine_name': 'CachyOS workstation',
        'project_directory': '/code/atomcli',
      },
      'challenge': 'challenge',
      'expires_at': 42,
    });

    expect(challenge.capabilities, contains('identity.v1'));
    expect(challenge.identity?.machineId, 'machine-1');
    expect(challenge.identity?.processId, 'process-1');
    expect(challenge.identity?.bridgeId, 'bridge-1');
    expect(challenge.identity?.machineName, 'CachyOS workstation');
    expect(challenge.identity?.projectDirectory, '/code/atomcli');
  });

  group('PairingPayload', () {
    test('accepts Tailscale and local network endpoints', () {
      final payload = PairingPayload.fromJson({
        'v': 2,
        'endpoints': [
          'ws://100.72.1.4:4096/companion/ws',
          'ws://192.168.1.20:4096/companion/ws',
        ],
        'pairing_token': 'one-time-token',
        'http_pair': 'http://100.72.1.4:4096/companion/pair',
      });

      expect(payload.v, 2);
      expect(payload.endpoints, hasLength(2));
      expect(payload.httpPair, startsWith('http://'));
    });

    test('rejects payloads without a reachable websocket endpoint', () {
      expect(
        () => PairingPayload.fromJson({
          'v': 2,
          'endpoints': ['https://example.com'],
          'pairing_token': 'token',
          'http_pair': 'http://192.168.1.20:4096/companion/pair',
        }),
        throwsFormatException,
      );
    });

    test('rejects malformed pairing addresses', () {
      expect(
        () => PairingPayload.fromJson({
          'v': 2,
          'endpoints': ['ws://192.168.1.20:4096/companion/ws'],
          'pairing_token': 'token',
          'http_pair': '',
        }),
        throwsFormatException,
      );
    });
  });

  test('canonical payload is stable and excludes device identity fields', () {
    final canonical = AuthService.canonicalPayload({
      'type': 'permission_resolve',
      'timestamp': 42,
      'device_name': 'phone',
      'signature': 'signature',
      'counter': 1,
    });

    expect(
      canonical,
      '{"counter":1,"timestamp":42,"type":"permission_resolve"}',
    );
  });

  test('backend events retain bridge epoch cursor metadata', () {
    final event = BackendEvent.fromJson({
      'type': 'event',
      'seq_id': 8,
      'bridge_epoch': 'epoch-1',
      'payload': {'message': 'updated'},
    });

    expect(event.seqId, 8);
    expect(event.bridgeEpoch, 'epoch-1');
  });

  test('conversation messages retain provider routes and safe failures', () {
    final message = ConversationMessage.fromJson({
      'id': 'message_1',
      'sessionID': 'session_1',
      'role': 'assistant',
      'providerID': 'kilocode',
      'modelID': 'z-ai/glm-5.3-flash',
      'error': {
        'name': 'APIError',
        'data': {
          'message': 'Add credits to continue',
          'statusCode': 402,
          'isRetryable': false,
        },
      },
    });

    expect(message.modelId, 'kilocode/z-ai/glm-5.3-flash');
    expect(message.failure?.code, 'APIError');
    expect(message.failure?.message, 'Add credits to continue');
    expect(message.failure?.statusCode, 402);
    expect(message.failure?.retryable, isFalse);
  });

  test('conversation messages accept object-shaped user model metadata', () {
    final message = ConversationMessage.fromJson({
      'id': 'message_2',
      'sessionID': 'session_1',
      'role': 'user',
      'model': {'providerID': 'zai', 'modelID': 'glm-5.3-flash'},
    });

    expect(message.modelId, 'zai/glm-5.3-flash');
  });

  test('connection endpoints prefer LAN before Tailscale routes', () {
    expect(
      AuthService.orderEndpoints([
        'ws://host.tail1234.ts.net:4096/companion/ws',
        'ws://100.109.110.5:4096/companion/ws',
        'ws://10.46.214.192:4096/companion/ws',
      ]),
      [
        'ws://10.46.214.192:4096/companion/ws',
        'ws://100.109.110.5:4096/companion/ws',
        'ws://host.tail1234.ts.net:4096/companion/ws',
      ],
    );
  });

  test('permission and question requests preserve their project directory', () {
    final permission = PendingPermission.fromJson({
      'req_id': 'permission_1',
      'sessionID': 'session_1',
      'permission': 'bash',
      'patterns': ['bun test'],
      'always': ['bun *'],
      'directory': '/home/user/project',
      'metadata': {'command': 'bun test'},
    });
    final question = PendingQuestion.fromJson({
      'req_id': 'question_1',
      'sessionID': 'session_1',
      'directory': '/home/user/project',
      'questions': [
        {'header': 'Choice', 'question': 'Continue?', 'type': 'select'},
      ],
    });

    expect(permission.always, ['bun *']);
    expect(permission.directory, '/home/user/project');
    expect(question.directory, '/home/user/project');
  });

  test('directory listings retain roots, children and hidden state', () {
    final listing = DirectoryListing.fromJson({
      'path': '/home/user/project',
      'home': '/home/user',
      'parent': '/home/user',
      'roots': [
        {'name': 'project', 'path': '/home/user/project'},
      ],
      'directories': [
        {'name': '.git', 'path': '/home/user/project/.git', 'hidden': true},
      ],
    });

    expect(listing.roots.single.name, 'project');
    expect(listing.directories.single.hidden, isTrue);
    expect(listing.parent, '/home/user');
  });

  test('transfer and preview events retain machine-scoped metadata', () {
    final artifact = CompanionArtifact.fromJson({
      'id': 'artifact_1',
      'kind': 'image',
      'direction': 'pc_to_mobile',
      'sourceDevice': 'cachyos-atom13',
      'title': 'Screenshot',
      'name': 'screen.png',
      'mime': 'image/png',
      'size': 2048,
      'sha256':
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'createdAt': 1000,
      'expiresAt': 86401000,
      'sessionID': 'session_1',
      'downloadPath': '/companion/artifact/artifact_1?token=test',
    });
    final preview = CompanionPreview.fromJson({
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
      'accessExpiresAt': 121000,
    });

    expect(artifact.sourceDevice, 'cachyos-atom13');
    expect(artifact.sessionId, 'session_1');
    expect(artifact.sha256, hasLength(64));
    expect(artifact.expiresAt?.millisecondsSinceEpoch, 86401000);
    expect(preview.endpoints.single, 'http://100.64.0.1:3000');
    expect(preview.status, 'running');
    expect(preview.accessExpiresAt?.millisecondsSinceEpoch, 121000);
    expect(
      CompanionCapability.supported,
      contains(CompanionCapability.previewsV2),
    );
    expect(
      CompanionCapability.supported,
      contains(CompanionCapability.transfersV2),
    );
  });

  test('incoming Android shares reject malformed files and stay as drafts', () {
    final share = IncomingShare.fromJson({
      'text': 'Review this URL',
      'files': [
        {
          'path': '/cache/screenshot.png',
          'name': 'screenshot.png',
          'mime': 'image/png',
          'size': 2048,
        },
        {'path': '/cache/malformed'},
      ],
      'issues': ['One item could not be read.', '', 42],
    });

    expect(share?.text, 'Review this URL');
    expect(share?.files, hasLength(1));
    expect(share?.files.single.mime, 'image/png');
    expect(share?.issues, ['One item could not be read.']);
    expect(IncomingShare.fromJson({'text': '  ', 'files': []}), isNull);
  });

  test('notification actions preserve request scope and direct reply safety', () {
    final response = NotificationActionRequest.fromResponse(
      const NotificationResponse(
        notificationResponseType:
            NotificationResponseType.selectedNotificationAction,
        id: 42,
        actionId: 'permission_allow_once',
        input: null,
        payload:
            '{"notification_id":42,"request_id":"permission_1","directory":"/code/project"}',
      ),
    );
    expect(response?.requestId, 'permission_1');
    expect(response?.directory, '/code/project');
    expect(response?.dedupeKey, contains('permission_allow_once'));
    final deepLink = CompanionDeepLink.tryParse(
      const CompanionDeepLink(
        destination: CompanionDestination.inbox,
        profileId: 'profile-1',
        requestId: 'permission_1',
      ).toUri(),
    );
    expect(deepLink?.requestId, 'permission_1');
    expect(
      NotificationActionRequest.fromResponse(
        const NotificationResponse(
          notificationResponseType:
              NotificationResponseType.selectedNotification,
          id: 42,
          payload: '{"request_id":"permission_1"}',
        ),
      ),
      isNull,
    );

    const safeQuestion = PendingQuestion(
      reqId: 'question_1',
      sessionId: 'session_1',
      questions: [
        QuestionInfo(
          question: 'What should change?',
          header: 'Reply',
          type: 'text',
        ),
      ],
    );
    const passwordQuestion = PendingQuestion(
      reqId: 'question_2',
      sessionId: 'session_1',
      questions: [
        QuestionInfo(question: 'Secret?', header: 'Password', type: 'password'),
      ],
    );
    expect(supportsDirectNotificationReply(safeQuestion), isTrue);
    expect(supportsDirectNotificationReply(passwordQuestion), isFalse);
    expect(liveTaskShortText('Implementing notifications (3/6)'), '3/6');
    expect(liveTaskShortText('Waiting for the agent'), 'LIVE');
    expect(liveTaskShortText('Invalid 123/1000 progress'), 'LIVE');
    expect(liveTaskTitle('Bildirimleri uygula · 3/6'), 'Bildirimleri uygula');
    expect(liveTaskTitle('Waiting for the agent'), 'Waiting for the agent');
    expect(liveTaskProgress('Implementing notifications (3/6)'), (
      completed: 3,
      total: 6,
    ));
    expect(liveTaskProgress('Waiting for the agent'), isNull);
    expect(liveTaskProgress('Invalid 7/6 progress'), isNull);
    expect(liveTaskProgress('Inspect API 1/2 results · 4/6'), (
      completed: 4,
      total: 6,
    ));
  });

  test(
    'live task tracker retains pending DAG steps and reports real progress',
    () {
      final tracker = LiveTaskTracker();
      tracker.apply('tui.chain.add_step', {
        'stepId': 'one',
        'workflowId': 'workflow-1',
        'name': 'Inspect',
        'description': 'Inspect the project',
        'status': 'pending',
        'directory': '/code',
        'sessionID': 'session-1',
      });
      tracker.apply('tui.chain.add_step', {
        'stepId': 'two',
        'workflowId': 'workflow-1',
        'name': 'Test',
        'description': 'Run the tests',
        'status': 'pending',
        'directory': '/code',
        'sessionID': 'session-1',
      });

      expect(tracker.activeTasks.values.single, contains('0/2'));
      expect(
        tracker.apply('tui.chain.parallel.update', {
          'workflowId': 'workflow-1',
          'sessionID': 'session-1',
          'directory': '/code',
          'stepIndex': 0,
          'status': 'running',
        }),
        isTrue,
      );
      tracker.apply('tui.chain.parallel.update', {
        'workflowId': 'workflow-1',
        'sessionID': 'session-1',
        'directory': '/code',
        'stepIndex': 0,
        'status': 'complete',
      });
      expect(tracker.activeTasks.values.single, contains('1/2'));

      tracker.apply('tui.chain.parallel.update', {
        'workflowId': 'workflow-1',
        'sessionID': 'session-1',
        'directory': '/code',
        'stepIndex': 1,
        'status': 'complete',
      });
      expect(tracker.activeTasks, isEmpty);
    },
  );
}
