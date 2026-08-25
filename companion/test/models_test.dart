import 'package:atomcli_companion/models.dart';
import 'package:atomcli_companion/services/auth_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
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
      'createdAt': 1000,
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
    });

    expect(artifact.sourceDevice, 'cachyos-atom13');
    expect(artifact.sessionId, 'session_1');
    expect(preview.endpoints.single, 'http://100.64.0.1:3000');
    expect(preview.status, 'running');
  });
}
