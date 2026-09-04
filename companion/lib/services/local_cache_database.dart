import 'dart:convert';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:sqflite/sqflite.dart';

import 'safe_outbox.dart';

const _databaseVersion = 3;
const _databaseName = 'atomcli_companion.db';
const _cacheKeyStorageKey = 'atomcli_companion_cache_key_v1';
const _maxCachedEventsPerProfile = 8;

abstract class CachePayloadCodec {
  Future<String> encode(Map<String, dynamic> payload);
  Future<Map<String, dynamic>> decode(String payload);
}

/// Encrypts cache payloads before SQLite sees them. The encryption key remains
/// in Android/iOS secure storage and is never stored beside the database.
class SecureCachePayloadCodec implements CachePayloadCodec {
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  final AesGcm _algorithm = AesGcm.with256bits();
  final Future<SecretKey> Function()? _keyLoader;
  SecretKey? _cachedKey;

  SecureCachePayloadCodec({Future<SecretKey> Function()? keyLoader})
    : _keyLoader = keyLoader;

  @override
  Future<String> encode(Map<String, dynamic> payload) async {
    final box = await _algorithm.encrypt(
      utf8.encode(jsonEncode(payload)),
      secretKey: await _key(),
    );
    return jsonEncode({
      'v': 1,
      'nonce': base64Encode(box.nonce),
      'ciphertext': base64Encode(box.cipherText),
      'mac': base64Encode(box.mac.bytes),
    });
  }

  @override
  Future<Map<String, dynamic>> decode(String payload) async {
    final envelope = jsonDecode(payload) as Map<String, dynamic>;
    if (envelope['v'] != 1) throw const FormatException('Unknown cache format');
    final cleartext = await _algorithm.decrypt(
      SecretBox(
        base64Decode(envelope['ciphertext'] as String),
        nonce: base64Decode(envelope['nonce'] as String),
        mac: Mac(base64Decode(envelope['mac'] as String)),
      ),
      secretKey: await _key(),
    );
    return Map<String, dynamic>.from(jsonDecode(utf8.decode(cleartext)) as Map);
  }

  Future<SecretKey> _key() async {
    final existing = _cachedKey;
    if (existing != null) return existing;
    final injectedLoader = _keyLoader;
    if (injectedLoader != null) {
      final key = await injectedLoader();
      _cachedKey = key;
      return key;
    }
    var encoded = await _storage.read(key: _cacheKeyStorageKey);
    if (encoded == null) {
      encoded = base64Encode(
        await (await _algorithm.newSecretKey()).extractBytes(),
      );
      await _storage.write(key: _cacheKeyStorageKey, value: encoded);
    }
    final key = SecretKey(base64Decode(encoded));
    _cachedKey = key;
    return key;
  }
}

class CachedCompanionEvent {
  final String machineId;
  final String profileId;
  final String type;
  final Map<String, dynamic> payload;
  final DateTime cachedAt;

  const CachedCompanionEvent({
    required this.machineId,
    required this.profileId,
    required this.type,
    required this.payload,
    required this.cachedAt,
  });
}

class PendingUploadJob {
  final String id;
  final String profileId;
  final String machineId;
  final String sessionId;
  final String? directory;
  final String filename;
  final String mime;
  final int size;
  final String sha256;
  final String sourcePath;
  final String uploadPath;
  final int chunkSize;
  final int offset;
  final DateTime createdAt;
  final DateTime expiresAt;

  const PendingUploadJob({
    required this.id,
    required this.profileId,
    required this.machineId,
    required this.sessionId,
    this.directory,
    required this.filename,
    required this.mime,
    required this.size,
    required this.sha256,
    required this.sourcePath,
    required this.uploadPath,
    required this.chunkSize,
    required this.offset,
    required this.createdAt,
    required this.expiresAt,
  });

  PendingUploadJob copyWith({
    String? uploadPath,
    int? chunkSize,
    int? offset,
    DateTime? expiresAt,
  }) => PendingUploadJob(
    id: id,
    profileId: profileId,
    machineId: machineId,
    sessionId: sessionId,
    directory: directory,
    filename: filename,
    mime: mime,
    size: size,
    sha256: sha256,
    sourcePath: sourcePath,
    uploadPath: uploadPath ?? this.uploadPath,
    chunkSize: chunkSize ?? this.chunkSize,
    offset: offset ?? this.offset,
    createdAt: createdAt,
    expiresAt: expiresAt ?? this.expiresAt,
  );

  Map<String, dynamic> toPayload() => {
    'session_id': sessionId,
    if (directory != null) 'directory': directory,
    'filename': filename,
    'mime': mime,
    'size': size,
    'sha256': sha256,
    'source_path': sourcePath,
    'upload_path': uploadPath,
    'chunk_size': chunkSize,
    'offset': offset,
    'created_at_ms': createdAt.millisecondsSinceEpoch,
  };
}

class LocalCacheDatabase {
  static LocalCacheDatabase? _instance;
  static LocalCacheDatabase get instance =>
      _instance ??= LocalCacheDatabase(codec: SecureCachePayloadCodec());

  final DatabaseFactory? _factory;
  final String? _databasePath;
  final CachePayloadCodec _codec;
  Future<Database>? _database;

  LocalCacheDatabase({
    DatabaseFactory? factory,
    String? databasePath,
    required CachePayloadCodec codec,
  }) : _factory = factory,
       _databasePath = databasePath,
       _codec = codec;

  Future<void> initialize() async {
    await _db();
  }

  Future<void> saveMachine({
    required String profileId,
    required String machineId,
    String? machineName,
    String? projectDirectory,
    String? processId,
    String? bridgeId,
    String? bridgeEpoch,
    List<String> endpoints = const [],
  }) async {
    if (profileId.isEmpty || machineId.isEmpty) return;
    final machineDetails = <String, dynamic>{'endpoints': endpoints};
    if (machineName != null) machineDetails['machine_name'] = machineName;
    if (processId != null) machineDetails['process_id'] = processId;
    if (bridgeId != null) machineDetails['bridge_id'] = bridgeId;
    if (bridgeEpoch != null) machineDetails['bridge_epoch'] = bridgeEpoch;
    final details = await _codec.encode(machineDetails);
    final db = await _db();
    await _ensureMachine(db, machineId);
    await db.rawInsert(
      '''INSERT INTO machines(machine_id, details, last_seen_ms)
         VALUES(?, ?, ?)
         ON CONFLICT(machine_id) DO UPDATE SET
           details = excluded.details,
           last_seen_ms = excluded.last_seen_ms''',
      [machineId, details, DateTime.now().millisecondsSinceEpoch],
    );
    final rawProfileDetails = <String, dynamic>{'endpoints': endpoints};
    if (projectDirectory != null) {
      rawProfileDetails['project_directory'] = projectDirectory;
    }
    if (processId != null) rawProfileDetails['process_id'] = processId;
    if (bridgeId != null) rawProfileDetails['bridge_id'] = bridgeId;
    if (bridgeEpoch != null) rawProfileDetails['bridge_epoch'] = bridgeEpoch;
    final profileDetails = await _codec.encode(rawProfileDetails);
    await db.rawInsert(
      '''INSERT INTO profiles(profile_id, machine_id, details, last_seen_ms)
         VALUES(?, ?, ?, ?)
         ON CONFLICT(profile_id) DO UPDATE SET
           machine_id = excluded.machine_id,
           details = excluded.details,
           last_seen_ms = excluded.last_seen_ms''',
      [
        profileId,
        machineId,
        profileDetails,
        DateTime.now().millisecondsSinceEpoch,
      ],
    );
  }

  Future<void> saveEvent({
    required String profileId,
    required String machineId,
    required String type,
    required Map<String, dynamic> payload,
  }) async {
    if (profileId.isEmpty ||
        machineId.isEmpty ||
        (type != 'snapshot' && type != 'session_list')) {
      return;
    }
    final safePayload = _offlineSafePayload(type, payload);
    final encoded = await _codec.encode(safePayload);
    final db = await _db();
    await _ensureProfile(db, profileId, machineId);
    await db.insert('cached_events', {
      'profile_id': profileId,
      'machine_id': machineId,
      'event_type': type,
      'payload': encoded,
      'cached_at_ms': DateTime.now().millisecondsSinceEpoch,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
    await db.rawDelete(
      '''DELETE FROM cached_events
         WHERE profile_id = ? AND rowid NOT IN (
           SELECT rowid FROM cached_events WHERE profile_id = ?
           ORDER BY cached_at_ms DESC LIMIT ?
         )''',
      [profileId, profileId, _maxCachedEventsPerProfile],
    );
  }

  Future<List<CachedCompanionEvent>> loadEvents(String profileId) async {
    if (profileId.isEmpty) return const [];
    final db = await _db();
    final rows = await db.query(
      'cached_events',
      where: 'profile_id = ?',
      whereArgs: [profileId],
      orderBy: "CASE event_type WHEN 'snapshot' THEN 0 ELSE 1 END ASC",
    );
    final events = <CachedCompanionEvent>[];
    for (final row in rows) {
      try {
        events.add(
          CachedCompanionEvent(
            machineId: row['machine_id'] as String,
            profileId: profileId,
            type: row['event_type'] as String,
            payload: await _codec.decode(row['payload'] as String),
            cachedAt: DateTime.fromMillisecondsSinceEpoch(
              row['cached_at_ms'] as int,
            ),
          ),
        );
      } catch (_) {
        await db.delete(
          'cached_events',
          where: 'profile_id = ? AND event_type = ?',
          whereArgs: [profileId, row['event_type']],
        );
      }
    }
    return events;
  }

  Future<void> saveOutboxEntry(OutboxEntry entry) async {
    final db = await _db();
    if (entry.state == OutboxState.acknowledged) {
      await db.delete(
        'outbox',
        where: 'idempotency_key = ?',
        whereArgs: [entry.idempotencyKey],
      );
      return;
    }
    await _ensureProfile(db, entry.targetProfileId, entry.targetMachineId);
    final payload = await _codec.encode(entry.payload);
    await db.insert('outbox', {
      'idempotency_key': entry.idempotencyKey,
      'kind': entry.kind,
      'profile_id': entry.targetProfileId,
      'machine_id': entry.targetMachineId,
      'bridge_epoch': entry.targetBridgeEpoch,
      'created_at_ms': entry.createdAt.millisecondsSinceEpoch,
      'expires_at_ms': entry.expiresAt.millisecondsSinceEpoch,
      'payload': payload,
      'state': entry.state.name,
      'error': entry.error,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<void> saveOutboxEntries(Iterable<OutboxEntry> entries) async {
    for (final entry in entries) {
      await saveOutboxEntry(entry);
    }
  }

  Future<List<OutboxEntry>> loadOutbox(String profileId) async {
    if (profileId.isEmpty) return const [];
    final db = await _db();
    final rows = await db.query(
      'outbox',
      where: 'profile_id = ?',
      whereArgs: [profileId],
      orderBy: 'created_at_ms ASC',
      limit: 100,
    );
    final entries = <OutboxEntry>[];
    for (final row in rows) {
      try {
        var state = OutboxState.values.byName(row['state'] as String);
        if (state == OutboxState.sending) state = OutboxState.queued;
        entries.add(
          OutboxEntry(
            idempotencyKey: row['idempotency_key'] as String,
            kind: row['kind'] as String,
            targetMachineId: row['machine_id'] as String,
            targetProfileId: row['profile_id'] as String,
            targetBridgeEpoch: row['bridge_epoch'] as String?,
            createdAt: DateTime.fromMillisecondsSinceEpoch(
              row['created_at_ms'] as int,
            ),
            expiresAt: DateTime.fromMillisecondsSinceEpoch(
              row['expires_at_ms'] as int,
            ),
            payload: await _codec.decode(row['payload'] as String),
            state: state,
            error: row['error'] as String?,
          ),
        );
      } catch (_) {
        await db.delete(
          'outbox',
          where: 'idempotency_key = ?',
          whereArgs: [row['idempotency_key']],
        );
      }
    }
    return entries;
  }

  Future<void> savePendingUpload(PendingUploadJob job) async {
    final db = await _db();
    await _ensureProfile(db, job.profileId, job.machineId);
    await db.insert('transfer_uploads', {
      'job_id': job.id,
      'profile_id': job.profileId,
      'machine_id': job.machineId,
      'payload': await _codec.encode(job.toPayload()),
      'updated_at_ms': DateTime.now().millisecondsSinceEpoch,
      'expires_at_ms': job.expiresAt.millisecondsSinceEpoch,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<List<PendingUploadJob>> loadPendingUploads(String profileId) async {
    if (profileId.isEmpty) return const [];
    final db = await _db();
    final rows = await db.query(
      'transfer_uploads',
      where: 'profile_id = ?',
      whereArgs: [profileId],
      orderBy: 'updated_at_ms ASC',
    );
    final jobs = <PendingUploadJob>[];
    for (final row in rows) {
      try {
        final payload = await _codec.decode(row['payload'] as String);
        jobs.add(
          PendingUploadJob(
            id: row['job_id'] as String,
            profileId: row['profile_id'] as String,
            machineId: row['machine_id'] as String,
            sessionId: payload['session_id'] as String,
            directory: payload['directory'] as String?,
            filename: payload['filename'] as String,
            mime: payload['mime'] as String,
            size: payload['size'] as int,
            sha256: payload['sha256'] as String,
            sourcePath: payload['source_path'] as String,
            uploadPath: payload['upload_path'] as String,
            chunkSize: payload['chunk_size'] as int,
            offset: payload['offset'] as int? ?? 0,
            createdAt: DateTime.fromMillisecondsSinceEpoch(
              payload['created_at_ms'] as int,
            ),
            expiresAt: DateTime.fromMillisecondsSinceEpoch(
              row['expires_at_ms'] as int,
            ),
          ),
        );
      } catch (_) {
        await db.delete(
          'transfer_uploads',
          where: 'job_id = ?',
          whereArgs: [row['job_id']],
        );
      }
    }
    return jobs;
  }

  Future<void> deletePendingUpload(String id) async {
    final db = await _db();
    await db.delete('transfer_uploads', where: 'job_id = ?', whereArgs: [id]);
  }

  Future<void> clearProfile(String profileId) async {
    final db = await _db();
    await db.transaction((txn) async {
      final profile = await txn.query(
        'profiles',
        columns: ['machine_id'],
        where: 'profile_id = ?',
        whereArgs: [profileId],
        limit: 1,
      );
      await txn.delete(
        'profiles',
        where: 'profile_id = ?',
        whereArgs: [profileId],
      );
      if (profile.isEmpty) return;
      final machineId = profile.single['machine_id'] as String;
      final remaining = Sqflite.firstIntValue(
        await txn.rawQuery(
          'SELECT COUNT(*) FROM profiles WHERE machine_id = ?',
          [machineId],
        ),
      );
      if ((remaining ?? 0) == 0) {
        await txn.delete(
          'machines',
          where: 'machine_id = ?',
          whereArgs: [machineId],
        );
      }
    });
  }

  Future<void> close() async {
    final pending = _database;
    _database = null;
    if (pending != null) await (await pending).close();
  }

  Future<Database> _db() {
    return _database ??= _open();
  }

  Future<Database> _open() async {
    final path = _databasePath ?? '${await getDatabasesPath()}/$_databaseName';
    final resolvedFactory = _factory ?? databaseFactory;
    return resolvedFactory.openDatabase(
      path,
      options: OpenDatabaseOptions(
        version: _databaseVersion,
        onConfigure: (db) => db.execute('PRAGMA foreign_keys = ON'),
        onCreate: (db, _) => _createSchema(db),
        onUpgrade: (db, oldVersion, _) async {
          if (oldVersion < 2) await _upgradeFromMachineScopedCache(db);
          if (oldVersion < 3) await _createTransferUploads(db);
        },
      ),
    );
  }

  Future<void> _createSchema(DatabaseExecutor db) async {
    await db.execute('''
            CREATE TABLE machines (
              machine_id TEXT PRIMARY KEY,
              details TEXT NOT NULL,
              last_seen_ms INTEGER NOT NULL
            )
          ''');
    await db.execute('''
            CREATE TABLE profiles (
              profile_id TEXT PRIMARY KEY,
              machine_id TEXT NOT NULL,
              details TEXT NOT NULL,
              last_seen_ms INTEGER NOT NULL,
              FOREIGN KEY (machine_id) REFERENCES machines(machine_id)
                ON DELETE CASCADE
            )
          ''');
    await db.execute('''
            CREATE TABLE cached_events (
              profile_id TEXT NOT NULL,
              machine_id TEXT NOT NULL,
              event_type TEXT NOT NULL,
              payload TEXT NOT NULL,
              cached_at_ms INTEGER NOT NULL,
              PRIMARY KEY (profile_id, event_type),
              FOREIGN KEY (profile_id) REFERENCES profiles(profile_id)
                ON DELETE CASCADE
            )
          ''');
    await db.execute('''
            CREATE TABLE outbox (
              idempotency_key TEXT PRIMARY KEY,
              kind TEXT NOT NULL,
              profile_id TEXT NOT NULL,
              machine_id TEXT NOT NULL,
              bridge_epoch TEXT,
              created_at_ms INTEGER NOT NULL,
              expires_at_ms INTEGER NOT NULL,
              payload TEXT NOT NULL,
              state TEXT NOT NULL,
              error TEXT,
              FOREIGN KEY (profile_id) REFERENCES profiles(profile_id)
                ON DELETE CASCADE
            )
          ''');
    await db.execute(
      'CREATE INDEX outbox_profile_state ON outbox(profile_id, state)',
    );
    await _createTransferUploads(db);
  }

  Future<void> _createTransferUploads(DatabaseExecutor db) async {
    await db.execute('''
          CREATE TABLE IF NOT EXISTS transfer_uploads (
            job_id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            machine_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            expires_at_ms INTEGER NOT NULL,
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id)
              ON DELETE CASCADE
          )
        ''');
    await db.execute(
      'CREATE INDEX IF NOT EXISTS transfer_uploads_profile ON transfer_uploads(profile_id, updated_at_ms)',
    );
  }

  Future<void> _upgradeFromMachineScopedCache(Database db) async {
    // v1 used the physical machine ID as the cache scope. Preserve those rows
    // under a legacy profile instead of dropping queued messages during upgrade.
    // Sqflite already wraps onUpgrade in a transaction, so these statements
    // deliberately use the provided database directly.
    await db.execute('''
          CREATE TABLE profiles (
            profile_id TEXT PRIMARY KEY,
            machine_id TEXT NOT NULL,
            details TEXT NOT NULL,
            last_seen_ms INTEGER NOT NULL,
            FOREIGN KEY (machine_id) REFERENCES machines(machine_id)
              ON DELETE CASCADE
          )
        ''');
    await db.execute('''
          INSERT INTO profiles(profile_id, machine_id, details, last_seen_ms)
          SELECT machine_id, machine_id, details, last_seen_ms FROM machines
        ''');
    await db.execute('''
          CREATE TABLE cached_events_v2 (
            profile_id TEXT NOT NULL,
            machine_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            cached_at_ms INTEGER NOT NULL,
            PRIMARY KEY (profile_id, event_type),
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id)
              ON DELETE CASCADE
          )
        ''');
    await db.execute('''
          INSERT INTO cached_events_v2
          SELECT machine_id, machine_id, event_type, payload, cached_at_ms
          FROM cached_events
        ''');
    await db.execute('''
          CREATE TABLE outbox_v2 (
            idempotency_key TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            profile_id TEXT NOT NULL,
            machine_id TEXT NOT NULL,
            bridge_epoch TEXT,
            created_at_ms INTEGER NOT NULL,
            expires_at_ms INTEGER NOT NULL,
            payload TEXT NOT NULL,
            state TEXT NOT NULL,
            error TEXT,
            FOREIGN KEY (profile_id) REFERENCES profiles(profile_id)
              ON DELETE CASCADE
          )
        ''');
    await db.execute('''
          INSERT INTO outbox_v2
          SELECT idempotency_key, kind, machine_id, machine_id, bridge_epoch,
                 created_at_ms, expires_at_ms, payload, state, error
          FROM outbox
        ''');
    await db.execute('DROP TABLE cached_events');
    await db.execute('ALTER TABLE cached_events_v2 RENAME TO cached_events');
    await db.execute('DROP TABLE outbox');
    await db.execute('ALTER TABLE outbox_v2 RENAME TO outbox');
    await db.execute(
      'CREATE INDEX outbox_profile_state ON outbox(profile_id, state)',
    );
  }

  Future<void> _ensureMachine(Database db, String machineId) async {
    final details = await _codec.encode(const {'endpoints': []});
    await db.insert('machines', {
      'machine_id': machineId,
      'details': details,
      'last_seen_ms': DateTime.now().millisecondsSinceEpoch,
    }, conflictAlgorithm: ConflictAlgorithm.ignore);
  }

  Future<void> _ensureProfile(
    Database db,
    String profileId,
    String machineId,
  ) async {
    await _ensureMachine(db, machineId);
    final details = await _codec.encode(const {'endpoints': []});
    await db.insert('profiles', {
      'profile_id': profileId,
      'machine_id': machineId,
      'details': details,
      'last_seen_ms': DateTime.now().millisecondsSinceEpoch,
    }, conflictAlgorithm: ConflictAlgorithm.ignore);
  }

  Map<String, dynamic> _offlineSafePayload(
    String type,
    Map<String, dynamic> payload,
  ) {
    if (type == 'session_list') {
      return {
        'sessions': payload['sessions'] as List? ?? const [],
        if (payload['current_directory'] is String)
          'current_directory': payload['current_directory'],
      };
    }
    return {
      for (final key in [
        'snapshot_id',
        'generated_at',
        'bridge_epoch',
        'current_seq_id',
        'cursor',
        'dag',
        'sub_agents',
      ])
        if (payload.containsKey(key)) key: payload[key],
      // Stale authority must never be restored from disk.
      'pending_permissions': const [],
      'pending_questions': const [],
      // Transfer and preview URLs are deliberately short lived.
      'artifacts': const [],
      'previews': const [],
    };
  }
}
