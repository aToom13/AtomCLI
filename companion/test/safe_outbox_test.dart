import 'package:atomcli_companion/services/safe_outbox.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('queues only short-lived chat messages for the intended machine', () {
    final outbox = SafeOutbox();
    final now = DateTime.utc(2026, 9, 2);
    final entry = outbox.enqueueChat(
      targetMachineId: 'machine-1',
      targetProfileId: 'profile-1',
      targetBridgeEpoch: 'epoch-1',
      payload: {'type': 'chat_message', 'session_id': 's1', 'text': 'hello'},
      now: now,
    );

    expect(
      outbox.pendingFor('machine-2', profileId: 'profile-1', now: now),
      isEmpty,
    );
    expect(outbox.pendingFor('machine-1', profileId: 'profile-1', now: now), [
      entry,
    ]);
    expect(entry.expiresAt, now.add(const Duration(minutes: 15)));
  });

  test('expires stale entries and never reports them as sent', () {
    final outbox = SafeOutbox();
    final now = DateTime.utc(2026, 9, 2);
    final entry = outbox.enqueueChat(
      targetMachineId: 'machine-1',
      targetProfileId: 'profile-1',
      targetBridgeEpoch: 'epoch-1',
      payload: {'type': 'chat_message', 'session_id': 's1', 'text': 'hello'},
      now: now,
    );

    expect(
      outbox.pendingFor(
        'machine-1',
        profileId: 'profile-1',
        now: now.add(const Duration(minutes: 16)),
      ),
      isEmpty,
    );
    expect(
      outbox.entries
          .singleWhere(
            (candidate) => candidate.idempotencyKey == entry.idempotencyKey,
          )
          .state,
      OutboxState.expired,
    );
  });

  test('does not replay a message into a restarted bridge epoch', () {
    final outbox = SafeOutbox();
    final now = DateTime.utc(2026, 9, 2);
    final entry = outbox.enqueueChat(
      targetMachineId: 'machine-1',
      targetProfileId: 'profile-1',
      targetBridgeEpoch: 'epoch-1',
      payload: {'type': 'chat_message', 'session_id': 's1', 'text': 'hello'},
      now: now,
    );

    expect(
      outbox.pendingFor(
        'machine-1',
        profileId: 'profile-1',
        currentBridgeEpoch: 'epoch-2',
        now: now,
      ),
      isEmpty,
    );
    expect(outbox.entryFor(entry.idempotencyKey)?.state, OutboxState.failed);
  });

  test('rejects permissions and messages with temporary attachments', () {
    final outbox = SafeOutbox();
    expect(
      () => outbox.enqueueChat(
        targetMachineId: 'machine-1',
        targetProfileId: 'profile-1',
        targetBridgeEpoch: null,
        payload: {'type': 'permission_resolve'},
      ),
      throwsStateError,
    );
    expect(
      () => outbox.enqueueChat(
        targetMachineId: 'machine-1',
        targetProfileId: 'profile-1',
        targetBridgeEpoch: null,
        payload: {
          'type': 'chat_message',
          'attachments': ['temporary-artifact'],
        },
      ),
      throwsStateError,
    );
  });
}
