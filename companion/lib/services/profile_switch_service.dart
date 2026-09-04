import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/app_providers.dart';
import 'auth_service.dart';
import 'background_connection_service.dart';
import 'websocket_service.dart';

class ProfileSwitchService {
  static Future<PairedMachineProfile> select(
    WidgetRef ref,
    String profileId,
  ) async {
    final profile = AuthService.instance.profiles
        .where((candidate) => candidate.profileId == profileId)
        .firstOrNull;
    if (profile == null) throw StateError('Unknown AtomCLI link');
    if (profile.profileId == AuthService.instance.activeProfileId) {
      return profile;
    }

    await BackgroundConnectionService.stopAndWait();
    await ref.read(wsServiceProvider)?.dispose();
    await AuthService.instance.selectProfile(profile.profileId);
    clearMachineState(ref);
    ref.read(wsServiceProvider.notifier).state = createSocket(ref, profile);
    return profile;
  }

  static WebSocketService createSocket(
    WidgetRef ref,
    PairedMachineProfile profile,
  ) => WebSocketService(
    endpoints: [...profile.endpoints],
    initialSequence: AuthService.instance.lastSequence,
    onSequenceChange: AuthService.instance.recordSequence,
    onStateChange: (lifecycle) {
      final mapped = switch (lifecycle) {
        WsLifecycle.connecting => WsConnectionState.connecting,
        WsLifecycle.connected => WsConnectionState.connected,
        WsLifecycle.disconnected => WsConnectionState.disconnected,
      };
      Future.microtask(() {
        try {
          ref.read(connectionStateProvider.notifier).state = mapped;
        } catch (_) {}
      });
    },
    onConnectionChange: (status) {
      Future.microtask(() {
        try {
          ref.read(connectionDetailProvider.notifier).state = status;
          ref.read(connectionMessageProvider.notifier).state =
              connectionStatusMessage(status);
        } catch (_) {}
      });
    },
  );

  static void clearMachineState(WidgetRef ref) {
    ref.read(permissionsProvider.notifier).setFromSnapshot(const []);
    ref.read(questionsProvider.notifier).setFromSnapshot(const []);
    ref.read(dagProvider.notifier).clear();
    ref.read(subAgentProvider.notifier).clearAll();
    ref.read(artifactsProvider.notifier).setFromSnapshot(const []);
    ref.read(previewsProvider.notifier).setFromSnapshot(const []);
    ref.read(sessionListProvider.notifier).setSessions(const []);
    ref.read(logsProvider.notifier).clearAll();
    ref.read(modelsListProvider.notifier).setModels(const []);
    ref.read(agentsListProvider.notifier).setAgents(const []);
    ref.read(conversationProvider.notifier).resetForMachine();
    ref.read(currentDirectoryProvider.notifier).state = null;
    ref.read(defaultModelProvider.notifier).state = null;
    ref.read(connectionStateProvider.notifier).state =
        WsConnectionState.connecting;
    ref.read(connectionMessageProvider.notifier).state =
        'Switching to ${AuthService.instance.activeProfile?.machineName ?? 'machine'}.';
  }
}
