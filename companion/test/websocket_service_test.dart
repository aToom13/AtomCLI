import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:atomcli_companion/services/auth_service.dart';
import 'package:atomcli_companion/services/websocket_service.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    AuthService.resetForTests();
    await AuthService.instance.init('Test phone');
  });

  test(
    'upload ticket reconnects once with the same idempotency key when acknowledgement is lost',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      final requestIds = <String>[];
      var connectionCount = 0;

      final serverSubscription = server
          .transform(WebSocketTransformer())
          .listen((webSocket) {
            final connection = ++connectionCount;
            webSocket.add(
              jsonEncode({
                'type': 'auth_challenge',
                'protocol_version': 3,
                'protocol_min': 2,
                'capabilities': ['transfers.v2'],
                'challenge': 'challenge-$connection',
                'expires_at': DateTime.now()
                    .add(const Duration(minutes: 1))
                    .millisecondsSinceEpoch,
              }),
            );
            webSocket.listen((raw) async {
              final message = jsonDecode(raw as String) as Map<String, dynamic>;
              if (message['type'] == 'authenticate') {
                webSocket.add(
                  jsonEncode({
                    'type': 'auth_ok',
                    'protocol_version': 3,
                    'capabilities': ['transfers.v2'],
                    'bridge_epoch': 'test-epoch',
                    'connection_id': 'connection-$connection',
                    'endpoints': <String>[],
                  }),
                );
                return;
              }
              if (message['type'] != 'create_upload') return;

              requestIds.add(message['client_request_id'] as String);
              if (requestIds.length == 1) {
                // The server completed the operation, but the Android
                // foreground handoff replaced this socket before its result
                // reached the app.
                await webSocket.close();
                return;
              }
              webSocket.add(
                jsonEncode({
                  'type': 'action_result',
                  'action': 'create_upload',
                  'client_request_id': message['client_request_id'],
                  'status': 'ok',
                  'id': 'upload-1',
                  'upload_path': '/companion/upload/upload-1?token=test',
                  'offset': 0,
                  'chunk_size': 4194304,
                  'expires_at': DateTime.now()
                      .add(const Duration(hours: 1))
                      .millisecondsSinceEpoch,
                }),
              );
            });
          });

      final connected = Completer<void>();
      final socket = WebSocketService(
        endpoints: [
          'ws://${InternetAddress.loopbackIPv4.address}:${server.port}',
        ],
        onStateChange: (state) {
          if (state == WsLifecycle.connected && !connected.isCompleted) {
            connected.complete();
          }
        },
      );
      final events = socket.connect().listen((_) {});

      try {
        await connected.future.timeout(const Duration(seconds: 2));
        final result = await socket
            .createUpload(
              sessionId: 'session-1',
              filename: 'photo.jpg',
              mime: 'image/jpeg',
              size: 12,
              sha256: 'abc',
            )
            .timeout(const Duration(seconds: 4));

        expect(result.isOk, isTrue);
        expect(result.payload['upload_path'], contains('/companion/upload/'));
        expect(requestIds, hasLength(2));
        expect(requestIds.toSet(), hasLength(1));
      } finally {
        await socket.dispose();
        await events.cancel();
        await serverSubscription.cancel();
        await server.close(force: true);
      }
    },
  );
}
