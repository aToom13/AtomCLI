enum ConnectionPhase {
  idle,
  discovering,
  connecting,
  authenticating,
  synchronizing,
  connected,
  retryWaiting,
  suspended,
  incompatible,
  stopped,
}

class ConnectionStatus {
  final ConnectionPhase phase;
  final String? endpoint;
  final int attempt;
  final String? reason;
  final DateTime? retryAt;

  const ConnectionStatus({
    required this.phase,
    this.endpoint,
    this.attempt = 0,
    this.reason,
    this.retryAt,
  });

  bool get isConnected => phase == ConnectionPhase.connected;
  bool get isTerminal =>
      phase == ConnectionPhase.incompatible || phase == ConnectionPhase.stopped;
}

class ConnectionStateMachine {
  static const Map<ConnectionPhase, Set<ConnectionPhase>> _allowed = {
    ConnectionPhase.idle: {
      ConnectionPhase.discovering,
      ConnectionPhase.suspended,
      ConnectionPhase.stopped,
    },
    ConnectionPhase.discovering: {
      ConnectionPhase.connecting,
      ConnectionPhase.retryWaiting,
      ConnectionPhase.suspended,
      ConnectionPhase.stopped,
    },
    ConnectionPhase.connecting: {
      ConnectionPhase.discovering,
      ConnectionPhase.authenticating,
      ConnectionPhase.retryWaiting,
      ConnectionPhase.suspended,
      ConnectionPhase.stopped,
    },
    ConnectionPhase.authenticating: {
      ConnectionPhase.discovering,
      ConnectionPhase.synchronizing,
      ConnectionPhase.retryWaiting,
      ConnectionPhase.incompatible,
      ConnectionPhase.suspended,
      ConnectionPhase.stopped,
    },
    ConnectionPhase.synchronizing: {
      ConnectionPhase.discovering,
      ConnectionPhase.connected,
      ConnectionPhase.retryWaiting,
      ConnectionPhase.suspended,
      ConnectionPhase.stopped,
    },
    ConnectionPhase.connected: {
      ConnectionPhase.discovering,
      ConnectionPhase.retryWaiting,
      ConnectionPhase.suspended,
      ConnectionPhase.stopped,
    },
    ConnectionPhase.retryWaiting: {
      ConnectionPhase.discovering,
      ConnectionPhase.connecting,
      ConnectionPhase.suspended,
      ConnectionPhase.stopped,
    },
    ConnectionPhase.suspended: {
      ConnectionPhase.discovering,
      ConnectionPhase.stopped,
    },
    ConnectionPhase.incompatible: {
      ConnectionPhase.discovering,
      ConnectionPhase.suspended,
      ConnectionPhase.stopped,
    },
    ConnectionPhase.stopped: {},
  };

  ConnectionStatus _value = const ConnectionStatus(phase: ConnectionPhase.idle);

  ConnectionStatus get value => _value;

  ConnectionStatus transition(
    ConnectionPhase phase, {
    String? endpoint,
    int? attempt,
    String? reason,
    DateTime? retryAt,
  }) {
    final current = _value.phase;
    if (phase != current && !_allowed[current]!.contains(phase)) {
      throw StateError('Invalid connection transition: $current -> $phase');
    }
    return _value = ConnectionStatus(
      phase: phase,
      endpoint: endpoint ?? _value.endpoint,
      attempt: attempt ?? _value.attempt,
      reason: reason,
      retryAt: retryAt,
    );
  }
}
