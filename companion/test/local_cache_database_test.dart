import 'dart:io';

import 'package:atomcli_companion/services/local_cache_database.dart';
import 'package:atomcli_companion/services/safe_outbox.dart';
import 'package:cryptography/cryptography.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

final _testKey = SecretKey(List<int>.generate(32, (index) => index));

SecureCachePayloadCodec _testCodec() =>
    SecureCachePayloadCodec(keyLoader: () async => _testKey);

void main() {
  sqfliteFfiInit();

  test('encrypts cached payloads and authenticates them on read', () async {
    final codec = _testCodec();
    final encoded = await codec.encode({'text': 'private prompt'});

    expect(encoded, isNot(contains('private prompt')));
    expect(await codec.decode(encoded), {'text': 'private prompt'});
  });

  test(
    'restores useful state without stale authority or temporary URLs',
    () async {
      final fixture = await _databaseFixture();
      addTearDown(fixture.dispose);

      await fixture.database.saveMachine(
        profileId: 'profile-1',
        machineId: 'machine-1',
      );
      await fixture.database.saveEvent(
        profileId: 'profile-1',
        machineId: 'machine-1',
        type: 'snapshot',
        payload: {
          'dag': [
            {'name': 'build', 'status': 'running'},
          ],
          'pending_permissions': [
            {'id': 'must-not-return'},
          ],
          'pending_questions': [
            {'id': 'must-not-return'},
          ],
          'artifacts': [
            {'url': 'http://temporary'},
          ],
          'previews': [
            {'url': 'http://temporary'},
          ],
        },
      );

      final cached = await fixture.database.loadEvents('profile-1');
      expect(cached, hasLength(1));
      expect(cached.single.payload['dag'], hasLength(1));
      expect(cached.single.payload['pending_permissions'], isEmpty);
      expect(cached.single.payload['pending_questions'], isEmpty);
      expect(cached.single.payload['artifacts'], isEmpty);
      expect(cached.single.payload['previews'], isEmpty);
    },
  );

  test('isolates cached state for two projects on one machine', () async {
    final fixture = await _databaseFixture();
    addTearDown(fixture.dispose);

    for (final profile in ['profile-a', 'profile-b']) {
      await fixture.database.saveMachine(
        profileId: profile,
        machineId: 'machine-1',
        projectDirectory: '/workspace/$profile',
      );
      await fixture.database.saveEvent(
        profileId: profile,
        machineId: 'machine-1',
        type: 'session_list',
        payload: {
          'sessions': [
            {'id': 'session-$profile'},
          ],
        },
      );
    }

    final first = await fixture.database.loadEvents('profile-a');
    final second = await fixture.database.loadEvents('profile-b');
    expect(
      (first.single.payload['sessions'] as List).single['id'],
      'session-profile-a',
    );
    expect(
      (second.single.payload['sessions'] as List).single['id'],
      'session-profile-b',
    );
  });

  test('durably restores queued messages after a database reopen', () async {
    final fixture = await _databaseFixture();
    addTearDown(fixture.dispose);
    final now = DateTime.utc(2026, 9, 2);
    final entry = OutboxEntry(
      idempotencyKey: 'request-1',
      kind: 'chat_message',
      targetMachineId: 'machine-1',
      targetProfileId: 'profile-1',
      targetBridgeEpoch: 'epoch-1',
      createdAt: now,
      expiresAt: now.add(const Duration(minutes: 15)),
      payload: const {
        'type': 'chat_message',
        'session_id': 'session-1',
        'text': 'continue',
      },
      state: OutboxState.sending,
    );

    await fixture.database.saveOutboxEntry(entry);
    await fixture.database.close();
    final reopened = LocalCacheDatabase(
      factory: databaseFactoryFfi,
      databasePath: fixture.path,
      codec: _testCodec(),
    );
    fixture.database = reopened;

    final restored = await reopened.loadOutbox('profile-1');
    expect(restored, hasLength(1));
    expect(restored.single.idempotencyKey, 'request-1');
    expect(restored.single.state, OutboxState.queued);
    expect(restored.single.payload['text'], 'continue');
  });

  test('durably restores encrypted resumable upload jobs', () async {
    final fixture = await _databaseFixture();
    addTearDown(fixture.dispose);
    final createdAt = DateTime.utc(2026, 9, 2, 12);
    final job = PendingUploadJob(
      id: 'upload-1',
      profileId: 'profile-1',
      machineId: 'machine-1',
      sessionId: 'session-1',
      directory: '/workspace/project',
      filename: 'large.bin',
      mime: 'application/octet-stream',
      size: 9000000,
      sha256: List.filled(64, 'a').join(),
      sourcePath: '/private/pending/upload-1',
      uploadPath: '/companion/upload/1?token=secret',
      chunkSize: 4194304,
      offset: 4194304,
      createdAt: createdAt,
      expiresAt: createdAt.add(const Duration(hours: 24)),
    );

    await fixture.database.savePendingUpload(job);
    await fixture.database.close();
    final reopened = LocalCacheDatabase(
      factory: databaseFactoryFfi,
      databasePath: fixture.path,
      codec: _testCodec(),
    );
    fixture.database = reopened;

    final restored = await reopened.loadPendingUploads('profile-1');
    expect(restored, hasLength(1));
    expect(restored.single.uploadPath, contains('token=secret'));
    expect(restored.single.offset, 4194304);
    expect(restored.single.sha256, List.filled(64, 'a').join());
    await reopened.deletePendingUpload(job.id);
    expect(await reopened.loadPendingUploads('profile-1'), isEmpty);
  });

  test('migrates machine-scoped v1 cache without dropping outbox rows', () async {
    final directory = await Directory.systemTemp.createTemp(
      'atomcli-cache-migration-',
    );
    addTearDown(() async {
      if (directory.existsSync()) await directory.delete(recursive: true);
    });
    final path = '${directory.path}/cache.db';
    final codec = _testCodec();
    final payload = await codec.encode(const {
      'type': 'chat_message',
      'session_id': 'session-1',
      'text': 'keep me',
    });
    final old = await databaseFactoryFfi.openDatabase(
      path,
      options: OpenDatabaseOptions(
        version: 1,
        onCreate: (db, _) async {
          await db.execute(
            'CREATE TABLE machines (machine_id TEXT PRIMARY KEY, details TEXT NOT NULL, last_seen_ms INTEGER NOT NULL)',
          );
          await db.execute(
            'CREATE TABLE cached_events (machine_id TEXT NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, cached_at_ms INTEGER NOT NULL, PRIMARY KEY(machine_id, event_type))',
          );
          await db.execute(
            'CREATE TABLE outbox (idempotency_key TEXT PRIMARY KEY, kind TEXT NOT NULL, machine_id TEXT NOT NULL, bridge_epoch TEXT, created_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, error TEXT)',
          );
        },
      ),
    );
    await old.insert('machines', {
      'machine_id': 'machine-legacy',
      'details': await codec.encode(const {'endpoints': []}),
      'last_seen_ms': 1,
    });
    await old.insert('outbox', {
      'idempotency_key': 'legacy-request',
      'kind': 'chat_message',
      'machine_id': 'machine-legacy',
      'bridge_epoch': 'epoch-1',
      'created_at_ms': 1,
      'expires_at_ms': 9999999999999,
      'payload': payload,
      'state': 'queued',
      'error': null,
    });
    await old.close();

    final migrated = LocalCacheDatabase(
      factory: databaseFactoryFfi,
      databasePath: path,
      codec: codec,
    );
    addTearDown(migrated.close);
    final restored = await migrated.loadOutbox('machine-legacy');
    expect(restored.single.idempotencyKey, 'legacy-request');
    expect(restored.single.targetProfileId, 'machine-legacy');
    expect(restored.single.payload['text'], 'keep me');
  });
}

class _DatabaseFixture {
  final Directory directory;
  final String path;
  LocalCacheDatabase database;

  _DatabaseFixture({
    required this.directory,
    required this.path,
    required this.database,
  });

  Future<void> dispose() async {
    await database.close();
    if (directory.existsSync()) await directory.delete(recursive: true);
  }
}

Future<_DatabaseFixture> _databaseFixture() async {
  final directory = await Directory.systemTemp.createTemp(
    'atomcli-cache-test-',
  );
  final path = '${directory.path}/cache.db';
  final database = LocalCacheDatabase(
    factory: databaseFactoryFfi,
    databasePath: path,
    codec: _testCodec(),
  );
  await database.initialize();
  return _DatabaseFixture(directory: directory, path: path, database: database);
}
