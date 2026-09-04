import 'package:atomcli_companion/services/auth_service.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    AuthService.resetForTests();
  });

  test('persists and switches independent machine project profiles', () async {
    final auth = AuthService.instance;
    await auth.init('Test phone');
    final first = await auth.saveMachineProfile(
      machineId: 'machine-a',
      machineName: 'Workstation',
      projectDirectory: '/code/alpha',
      processId: 'process-a',
      bridgeId: 'bridge-a',
      endpoints: ['ws://192.168.1.20:4096/companion/ws'],
    );
    await auth.resetForBridgeEpoch('epoch-a');
    await auth.recordSequence(12);
    final second = await auth.saveMachineProfile(
      machineId: 'machine-b',
      machineName: 'Laptop',
      projectDirectory: '/code/beta',
      processId: 'process-b',
      bridgeId: 'bridge-b',
      endpoints: ['ws://100.70.1.2:5096/companion/ws'],
    );

    expect(auth.profiles, hasLength(2));
    expect(auth.activeProfileId, second.profileId);
    expect(auth.lastSequence, 0);
    await auth.selectProfile(first.profileId);
    expect(auth.machineId, 'machine-a');
    expect(auth.bridgeEpoch, 'epoch-a');
    expect(auth.lastSequence, 12);

    AuthService.resetForTests();
    final restored = AuthService.instance;
    expect(await restored.tryLoadExisting(), isTrue);
    expect(restored.profiles, hasLength(2));
    expect(restored.activeProfileId, first.profileId);
    expect(restored.activeProfile?.projectDirectory, '/code/alpha');
    expect(restored.lastSequence, 12);
  });

  test(
    'rescanning the same machine project and port updates one profile',
    () async {
      final auth = AuthService.instance;
      await auth.init('Test phone');
      final original = await auth.saveMachineProfile(
        machineId: 'machine-a',
        projectDirectory: '/code/alpha',
        processId: 'old-process',
        bridgeId: 'old-bridge',
        endpoints: ['ws://192.168.1.20:4096/companion/ws'],
      );
      final refreshed = await auth.saveMachineProfile(
        machineId: 'machine-a',
        projectDirectory: '/code/alpha',
        processId: 'new-process',
        bridgeId: 'new-bridge',
        endpoints: ['ws://100.70.1.2:4096/companion/ws'],
      );

      expect(refreshed.profileId, original.profileId);
      expect(auth.profiles, hasLength(1));
      expect(auth.activeProfile?.processId, 'new-process');

      await auth.saveMachineProfile(
        machineId: 'machine-a',
        projectDirectory: '/code/alpha',
        processId: 'parallel-process',
        bridgeId: 'parallel-bridge',
        endpoints: ['ws://192.168.1.20:5096/companion/ws'],
      );
      expect(auth.profiles, hasLength(2));
    },
  );
}
