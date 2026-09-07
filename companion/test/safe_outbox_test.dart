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

  test('terminal history never evicts an active message and a full active queue fails visibly', () {
    final outbox = SafeOutbox();
    final now = DateTime.utc(2026, 9, 2);
    for (var index = 0; index < 100; index++) {
      outbox.enqueueChat(
        targetMachineId: 'machine-1',
        targetProfileId: 'profile-1',
        targetBridgeEpoch: 'epoch-1',
        payload: {'type': 'chat_message', 'text': '$index'},
        now: now.add(Duration(seconds: index)),
      );
    }
    final first = outbox.entries.first;

    expect(
      () => outbox.enqueueChat(
        targetMachineId: 'machine-1',
        targetProfileId: 'profile-1',
        targetBridgeEpoch: 'epoch-1',
        payload: const {'type': 'chat_message', 'text': 'overflow'},
        now: now.add(const Duration(minutes: 2)),
      ),
      throwsStateError,
    );
    expect(outbox.entryFor(first.idempotencyKey), isNotNull);

    outbox.markFailed(first.idempotencyKey, 'user cancelled');
    final replacement = outbox.enqueueChat(
      targetMachineId: 'machine-1',
      targetProfileId: 'profile-1',
      targetBridgeEpoch: 'epoch-1',
      payload: const {'type': 'chat_message', 'text': 'replacement'},
      now: now.add(const Duration(minutes: 3)),
    );
    expect(outbox.entryFor(first.idempotencyKey), isNull);
    expect(outbox.entryFor(replacement.idempotencyKey), isNotNull);
  });
}
