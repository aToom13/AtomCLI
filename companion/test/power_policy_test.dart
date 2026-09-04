import 'package:atomcli_companion/services/power_policy.dart';
import 'package:atomcli_companion/services/companion_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('background modes distinguish idle, active and manual operation', () {
    expect(
      CompanionPowerPolicy.shouldRunInBackground(
        ConnectionPowerMode.balanced,
        hasActiveWork: false,
      ),
      isFalse,
    );
    expect(
      CompanionPowerPolicy.shouldRunInBackground(
        ConnectionPowerMode.balanced,
        hasActiveWork: true,
      ),
      isTrue,
    );
    expect(
      CompanionPowerPolicy.shouldRunInBackground(
        ConnectionPowerMode.realtime,
        hasActiveWork: false,
      ),
      isTrue,
    );
    expect(
      CompanionPowerPolicy.shouldRunInBackground(
        ConnectionPowerMode.manual,
        hasActiveWork: true,
      ),
      isFalse,
    );
  });

  test('background heartbeat is slower and failed retries are capped', () {
    expect(
      CompanionPowerPolicy.balancedBackgroundHeartbeat,
      greaterThan(CompanionPowerPolicy.foregroundHeartbeat),
    );
    expect(
      CompanionPowerPolicy.retryDelay(
        20,
        cap: CompanionPowerPolicy.backgroundRetryCap,
      ),
      CompanionPowerPolicy.backgroundRetryCap,
    );
    expect(
      CompanionPowerPolicy.retryDelay(
        1,
        cap: CompanionPowerPolicy.backgroundRetryCap,
        jitterMilliseconds: 9999,
      ),
      const Duration(milliseconds: 1200),
    );
  });

  test('unknown persisted power mode safely falls back to balanced', () {
    expect(
      ConnectionPowerModeCodec.parse('future_mode'),
      ConnectionPowerMode.balanced,
    );
    expect(
      ConnectionPowerModeCodec.parse('realtime'),
      ConnectionPowerMode.realtime,
    );
  });

  test('selected power mode survives preference reload', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final preferences = CompanionPreferences.instance;
    await preferences.selectPowerMode(ConnectionPowerMode.manual);
    preferences.powerMode = ConnectionPowerMode.balanced;

    await preferences.load();

    expect(preferences.powerMode, ConnectionPowerMode.manual);
    preferences.powerMode = ConnectionPowerMode.balanced;
  });
}
