import 'package:atomcli_companion/services/connection_state_machine.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'connection state machine models a complete authenticated connection',
    () {
      final machine = ConnectionStateMachine();
      machine.transition(ConnectionPhase.discovering, attempt: 1);
      machine.transition(
        ConnectionPhase.connecting,
        endpoint: 'ws://192.168.1.2:4096/companion/ws',
      );
      machine.transition(ConnectionPhase.authenticating);
      machine.transition(ConnectionPhase.synchronizing);
      final connected = machine.transition(ConnectionPhase.connected);

      expect(connected.isConnected, isTrue);
      expect(connected.attempt, 1);
      expect(connected.endpoint, contains('192.168.1.2'));
    },
  );

  test(
    'invalid transitions are rejected instead of producing false UI state',
    () {
      final machine = ConnectionStateMachine();
      expect(
        () => machine.transition(ConnectionPhase.connected),
        throwsStateError,
      );
    },
  );

  test('an incompatible protocol is terminal until an explicit retry', () {
    final machine = ConnectionStateMachine();
    machine.transition(ConnectionPhase.discovering);
    machine.transition(ConnectionPhase.connecting);
    machine.transition(ConnectionPhase.authenticating);
    final incompatible = machine.transition(
      ConnectionPhase.incompatible,
      reason: 'Unsupported protocol',
    );

    expect(incompatible.isTerminal, isTrue);
    expect(incompatible.reason, 'Unsupported protocol');
    expect(
      machine.transition(ConnectionPhase.discovering).phase,
      ConnectionPhase.discovering,
    );
  });
}
