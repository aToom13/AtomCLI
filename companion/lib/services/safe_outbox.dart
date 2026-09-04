import 'dart:math';

enum OutboxState { queued, sending, acknowledged, expired, failed }

class OutboxEntry {
  final String idempotencyKey;
  final String kind;
  final String targetMachineId;
  final String targetProfileId;
  final String? targetBridgeEpoch;
  final DateTime createdAt;
  final DateTime expiresAt;
  final Map<String, dynamic> payload;
  final OutboxState state;
  final String? error;

  const OutboxEntry({
    required this.idempotencyKey,
    required this.kind,
    required this.targetMachineId,
    required this.targetProfileId,
    this.targetBridgeEpoch,
    required this.createdAt,
    required this.expiresAt,
    required this.payload,
    this.state = OutboxState.queued,
    this.error,
  });

  OutboxEntry copyWith({
    OutboxState? state,
    String? error,
    bool clearError = false,
  }) => OutboxEntry(
    idempotencyKey: idempotencyKey,
    kind: kind,
    targetMachineId: targetMachineId,
    targetProfileId: targetProfileId,
    targetBridgeEpoch: targetBridgeEpoch,
    createdAt: createdAt,
    expiresAt: expiresAt,
    payload: payload,
    state: state ?? this.state,
    error: clearError ? null : error ?? this.error,
  );
}

class SafeOutbox {
  static const _chatTtl = Duration(minutes: 15);
  static const _maxEntries = 100;

  final List<OutboxEntry> _entries = [];

  List<OutboxEntry> get entries => List.unmodifiable(_entries);

  OutboxEntry? entryFor(String key) =>
      _entries.where((entry) => entry.idempotencyKey == key).firstOrNull;

  void restore(Iterable<OutboxEntry> entries) {
    for (final entry in entries) {
      final restored = entry.state == OutboxState.sending
          ? entry.copyWith(state: OutboxState.queued)
          : entry;
      final index = _entries.indexWhere(
        (candidate) => candidate.idempotencyKey == entry.idempotencyKey,
      );
      if (index < 0) {
        _entries.add(restored);
      } else {
        _entries[index] = restored;
      }
    }
    _entries.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    while (_entries.length > _maxEntries) {
      _entries.removeAt(0);
    }
  }

  OutboxEntry enqueueChat({
    required String targetMachineId,
    required String targetProfileId,
    required String? targetBridgeEpoch,
    required Map<String, dynamic> payload,
    DateTime? now,
  }) {
    if (targetMachineId.isEmpty) {
      throw StateError('The target machine identity is not known yet');
    }
    if (targetProfileId.isEmpty) {
      throw StateError('The target AtomCLI profile is not known yet');
    }
    if (payload['type'] != 'chat_message') {
      throw StateError('Only chat messages are allowed in the safe outbox');
    }
    if ((payload['attachments'] as List?)?.isNotEmpty == true) {
      throw StateError('Messages with temporary attachments cannot be queued');
    }
    final createdAt = now ?? DateTime.now();
    final entry = OutboxEntry(
      idempotencyKey: _uuidV4(),
      kind: 'chat_message',
      targetMachineId: targetMachineId,
      targetProfileId: targetProfileId,
      targetBridgeEpoch: targetBridgeEpoch,
      createdAt: createdAt,
      expiresAt: createdAt.add(_chatTtl),
      payload: Map.unmodifiable(Map<String, dynamic>.from(payload)),
    );
    _entries.add(entry);
    while (_entries.length > _maxEntries) {
      _entries.removeAt(0);
    }
    return entry;
  }

  List<OutboxEntry> pendingFor(
    String machineId, {
    required String profileId,
    String? currentBridgeEpoch,
    DateTime? now,
  }) {
    final checkedAt = now ?? DateTime.now();
    for (var index = 0; index < _entries.length; index++) {
      final entry = _entries[index];
      if (entry.state == OutboxState.acknowledged ||
          entry.state == OutboxState.expired ||
          entry.state == OutboxState.failed) {
        continue;
      }
      if (!entry.expiresAt.isAfter(checkedAt)) {
        _entries[index] = entry.copyWith(
          state: OutboxState.expired,
          error: 'Queue lifetime expired',
        );
        continue;
      }
      if (entry.targetMachineId == machineId &&
          entry.targetProfileId == profileId &&
          entry.targetBridgeEpoch != null &&
          currentBridgeEpoch != null &&
          entry.targetBridgeEpoch != currentBridgeEpoch) {
        _entries[index] = entry.copyWith(
          state: OutboxState.failed,
          error: 'AtomCLI restarted; review and resend this message',
        );
      }
    }
    return _entries
        .where(
          (entry) =>
              entry.targetMachineId == machineId &&
              entry.targetProfileId == profileId &&
              entry.state == OutboxState.queued,
        )
        .toList();
  }

  void markSending(String key) =>
      _update(key, OutboxState.sending, clearError: true);
  void markQueued(String key, [String? error]) =>
      _update(key, OutboxState.queued, error: error);
  void markAcknowledged(String key) =>
      _update(key, OutboxState.acknowledged, clearError: true);
  void markFailed(String key, String error) =>
      _update(key, OutboxState.failed, error: error);

  void _update(
    String key,
    OutboxState state, {
    String? error,
    bool clearError = false,
  }) {
    final index = _entries.indexWhere((entry) => entry.idempotencyKey == key);
    if (index < 0) return;
    _entries[index] = _entries[index].copyWith(
      state: state,
      error: error,
      clearError: clearError,
    );
  }

  static String _uuidV4() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes
        .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-'
        '${hex.substring(20)}';
  }
}
