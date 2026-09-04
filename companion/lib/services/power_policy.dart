import 'dart:math';

enum ConnectionPowerMode { balanced, realtime, manual }

extension ConnectionPowerModeCodec on ConnectionPowerMode {
  String get wireName => name;

  static ConnectionPowerMode parse(Object? value) {
    return ConnectionPowerMode.values.firstWhere(
      (mode) => mode.name == value,
      orElse: () => ConnectionPowerMode.balanced,
    );
  }
}

abstract final class CompanionPowerPolicy {
  static const foregroundHeartbeat = Duration(seconds: 25);
  static const foregroundHeartbeatTimeout = Duration(seconds: 65);
  static const balancedBackgroundHeartbeat = Duration(seconds: 45);
  static const balancedBackgroundTimeout = Duration(seconds: 110);
  static const realtimeBackgroundHeartbeat = Duration(seconds: 30);
  static const realtimeBackgroundTimeout = Duration(seconds: 75);
  static const foregroundRetryCap = Duration(seconds: 30);
  static const backgroundRetryCap = Duration(minutes: 5);

  static bool shouldRunInBackground(
    ConnectionPowerMode mode, {
    required bool hasActiveWork,
  }) {
    return switch (mode) {
      ConnectionPowerMode.realtime => true,
      ConnectionPowerMode.balanced => hasActiveWork,
      ConnectionPowerMode.manual => false,
    };
  }

  static Duration backgroundHeartbeat(ConnectionPowerMode mode) {
    return mode == ConnectionPowerMode.realtime
        ? realtimeBackgroundHeartbeat
        : balancedBackgroundHeartbeat;
  }

  static Duration backgroundHeartbeatTimeout(ConnectionPowerMode mode) {
    return mode == ConnectionPowerMode.realtime
        ? realtimeBackgroundTimeout
        : balancedBackgroundTimeout;
  }

  static Duration retryDelay(
    int retryCount, {
    required Duration cap,
    int jitterMilliseconds = 0,
  }) {
    final exponent = max(0, min(retryCount - 1, 16));
    final seconds = min(1 << exponent, cap.inSeconds);
    final remaining = cap.inMilliseconds - seconds * 1000;
    final jitter = jitterMilliseconds
        .clamp(0, max(0, min(seconds * 200, remaining)))
        .toInt();
    return Duration(seconds: seconds, milliseconds: jitter);
  }
}
