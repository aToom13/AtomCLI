import 'dart:async';

import 'package:atomcli_android_live_updates/atomcli_android_live_updates.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/app_providers.dart';
import '../l10n/app_localizations.dart';
import '../l10n/localized_status.dart';
import '../services/auth_service.dart';
import '../services/background_connection_service.dart';
import '../services/connection_doctor_service.dart';
import '../services/local_cache_database.dart';
import '../services/companion_preferences.dart';
import '../services/power_policy.dart';
import '../services/privacy_policy.dart';
import '../services/privacy_service.dart';
import '../services/profile_switch_service.dart';
import '../theme/app_theme.dart';
import '../widgets/control_widgets.dart';

class LinkScreen extends ConsumerStatefulWidget {
  const LinkScreen({super.key});

  @override
  ConsumerState<LinkScreen> createState() => _LinkScreenState();
}

class _LinkScreenState extends ConsumerState<LinkScreen>
    with WidgetsBindingObserver {
  bool _retrying = false;
  bool _forgetting = false;
  bool _diagnosing = false;
  String? _switchingProfileId;
  Map<String, EndpointDiagnosis> _diagnostics = const {};
  AndroidLiveUpdateResult? _liveUpdateStatus;
  bool _checkingLiveUpdates = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_refreshLiveUpdateStatus());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_refreshLiveUpdateStatus());
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final state = ref.watch(connectionStateProvider);
    final message = ref.watch(connectionMessageProvider);
    final detail = ref.watch(connectionDetailProvider);
    final ws = ref.watch(wsServiceProvider);
    final endpoints = AuthService.instance.endpoints;
    final profiles = AuthService.instance.profiles;
    final groupedProfiles = <String, List<PairedMachineProfile>>{};
    for (final profile in profiles) {
      groupedProfiles.putIfAbsent(profile.machineId, () => []).add(profile);
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(strings.tabLink),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Center(child: ConnectionBadge(state: state)),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 8, 18, 32),
        children: [
          Text(
            strings.commandLink,
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 6),
          Text(
            strings.commandLinkDescription,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 22),
          _StatusPanel(
            state: state,
            endpoint: null,
            message:
                localizedConnectionStatus(context, detail) ??
                message ??
                ws?.lastError,
          ),
          const SizedBox(height: 14),
          Align(
            alignment: Alignment.centerRight,
            child: OutlinedButton.icon(
              onPressed: _retrying || ws == null ? null : _retry,
              icon: _retrying
                  ? const SizedBox(
                      width: 17,
                      height: 17,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.sync_rounded),
              label: Text(
                _retrying ? strings.retryingLink : strings.retryConnection,
              ),
            ),
          ),
          const SizedBox(height: 28),
          SectionLabel(
            strings.machinesAndProjects,
            trailing: Text(
              strings.machineLinkCounts(
                groupedProfiles.length,
                profiles.length,
              ),
              style: const TextStyle(color: AppPalette.textMuted, fontSize: 11),
            ),
          ),
          const SizedBox(height: 10),
          for (final group in groupedProfiles.values) ...[
            _MachineGroupCard(
              profiles: group,
              activeProfileId: AuthService.instance.activeProfileId,
              switchingProfileId: _switchingProfileId,
              onSelect: _switchProfile,
            ),
            const SizedBox(height: 9),
          ],
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _switchingProfileId == null
                  ? () => Navigator.of(context).pushNamed('/scan')
                  : null,
              icon: const Icon(Icons.add_link_rounded),
              label: Text(strings.pairAnother),
            ),
          ),
          const SizedBox(height: 28),
          SectionLabel(strings.appearance),
          const SizedBox(height: 10),
          ControlPanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  strings.accentColor,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 4),
                Text(
                  strings.accentColorDescription,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: _AccentChoice(
                        accent: AppAccent.azure,
                        label: strings.accentAzure,
                        color: const Color(0xFF63AFFF),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _AccentChoice(
                        accent: AppAccent.violet,
                        label: strings.accentViolet,
                        color: const Color(0xFFA78BFA),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _AccentChoice(
                        accent: AppAccent.coral,
                        label: strings.accentCoral,
                        color: const Color(0xFFFF8A70),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          ControlPanel(
            padding: EdgeInsets.zero,
            child: Material(
              color: Colors.transparent,
              child: ExpansionTile(
                key: const Key('connection-details'),
                leading: const Icon(
                  Icons.route_outlined,
                  color: AppPalette.textMuted,
                ),
                title: Text(strings.reachableAddresses),
                subtitle: Text(
                  endpoints.isEmpty
                      ? strings.noEndpoints
                      : strings.machineLinkCounts(1, endpoints.length),
                ),
                childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 14),
                children: [
                  if (endpoints.isNotEmpty)
                    Column(
                      children: [
                        for (var index = 0; index < endpoints.length; index++)
                          _EndpointRow(
                            endpoint: endpoints[index],
                            diagnosis: _diagnostics[endpoints[index]],
                            current: endpoints[index] == ws?.currentEndpoint,
                            connected: state == WsConnectionState.connected,
                            showDivider: index < endpoints.length - 1,
                          ),
                      ],
                    ),
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: _diagnosing || endpoints.isEmpty
                          ? null
                          : _runDoctor,
                      icon: _diagnosing
                          ? const SizedBox(
                              width: 17,
                              height: 17,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.health_and_safety_outlined),
                      label: Text(
                        _diagnosing
                            ? strings.checkingRoutes
                            : strings.runConnectionDoctor,
                      ),
                    ),
                  ),
                  if (_diagnostics.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text(
                      strings.doctorCaveat,
                      style: const TextStyle(
                        color: AppPalette.textMuted,
                        fontSize: 10,
                        height: 1.4,
                      ),
                    ),
                  ],
                  const SizedBox(height: 10),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(
                        Icons.shield_outlined,
                        color: AppPalette.mint,
                        size: 20,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          strings.transportSecurity,
                          style: const TextStyle(
                            color: AppPalette.textSecondary,
                            fontSize: 12,
                            height: 1.45,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 28),
          SectionLabel(strings.powerProfile),
          const SizedBox(height: 10),
          ControlPanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                DropdownButtonFormField<ConnectionPowerMode>(
                  key: const Key('power-mode-selector'),
                  initialValue: CompanionPreferences.instance.powerMode,
                  isExpanded: true,
                  items: [
                    DropdownMenuItem(
                      value: ConnectionPowerMode.balanced,
                      child: Text(strings.powerBalanced),
                    ),
                    DropdownMenuItem(
                      value: ConnectionPowerMode.realtime,
                      child: Text(strings.powerRealtime),
                    ),
                    DropdownMenuItem(
                      value: ConnectionPowerMode.manual,
                      child: Text(strings.powerManual),
                    ),
                  ],
                  onChanged: (mode) async {
                    if (mode == null) return;
                    await CompanionPreferences.instance.selectPowerMode(mode);
                    if (mounted) setState(() {});
                  },
                ),
                const SizedBox(height: 10),
                Text(
                  _powerDescription(
                    strings,
                    CompanionPreferences.instance.powerMode,
                  ),
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 7),
                Text(
                  strings.powerSelectionNote,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          const SizedBox(height: 28),
          if (Theme.of(context).platform == TargetPlatform.android) ...[
            SectionLabel(strings.liveUpdatesAndNowBar),
            const SizedBox(height: 10),
            ControlPanel(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    _liveUpdateStatus?.allowed == true
                        ? Icons.notifications_active_outlined
                        : Icons.notifications_off_outlined,
                    color: _liveUpdateStatus?.allowed == true
                        ? AppPalette.mint
                        : AppPalette.amber,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _liveUpdateLabel(strings),
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          strings.liveUpdatesDescription,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  TextButton(
                    key: const Key('live-update-settings'),
                    onPressed: _checkingLiveUpdates ? null : _openLiveUpdates,
                    child: Text(strings.openSettings),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 28),
          ],
          SectionLabel(strings.privacyControls),
          const SizedBox(height: 10),
          ControlPanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                DropdownButtonFormField<NotificationPrivacyMode>(
                  key: const Key('notification-privacy-selector'),
                  initialValue:
                      CompanionPreferences.instance.notificationPrivacy,
                  decoration: InputDecoration(
                    labelText: strings.notificationPrivacy,
                  ),
                  isExpanded: true,
                  items: [
                    DropdownMenuItem(
                      value: NotificationPrivacyMode.details,
                      child: Text(strings.privacyDetails),
                    ),
                    DropdownMenuItem(
                      value: NotificationPrivacyMode.protected,
                      child: Text(strings.privacyProtected),
                    ),
                    DropdownMenuItem(
                      value: NotificationPrivacyMode.hidden,
                      child: Text(strings.privacyHidden),
                    ),
                  ],
                  onChanged: (mode) async {
                    if (mode == null) return;
                    await CompanionPreferences.instance
                        .selectNotificationPrivacy(mode);
                    if (mounted) setState(() {});
                  },
                ),
                const SizedBox(height: 10),
                Text(
                  _privacyDescription(
                    strings,
                    CompanionPreferences.instance.notificationPrivacy,
                  ),
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 10),
                Material(
                  type: MaterialType.transparency,
                  child: SwitchListTile.adaptive(
                    key: const Key('screen-protection-switch'),
                    contentPadding: EdgeInsets.zero,
                    title: Text(strings.screenProtection),
                    subtitle: Text(strings.screenProtectionDescription),
                    value: CompanionPreferences.instance.protectScreenPreviews,
                    onChanged: (enabled) async {
                      await CompanionPreferences.instance
                          .selectScreenProtection(enabled);
                      await PrivacyService.applyScreenProtection(enabled);
                      if (mounted) setState(() {});
                    },
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  strings.privacyPlatformCaveat,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          const SizedBox(height: 28),
          SectionLabel(strings.thisDevice),
          const SizedBox(height: 10),
          ControlPanel(
            child: Column(
              children: [
                _DetailRow(
                  label: strings.nameLabel,
                  value:
                      AuthService.instance.deviceName ?? strings.androidDevice,
                ),
                const SizedBox(height: 14),
                _DetailRow(
                  label: strings.deviceIdLabel,
                  value: _shortDeviceId(
                    AuthService.instance.deviceId,
                    strings.unavailable,
                  ),
                  monospace: true,
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          OutlinedButton.icon(
            onPressed: _forgetting ? null : _confirmForget,
            style: OutlinedButton.styleFrom(
              foregroundColor: AppPalette.danger,
              side: BorderSide(
                color: AppPalette.danger.withValues(alpha: 0.45),
              ),
              minimumSize: const Size.fromHeight(48),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
            icon: const Icon(Icons.link_off_rounded),
            label: Text(
              _forgetting ? strings.removingLink : strings.forgetLink,
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _retry() async {
    final ws = ref.read(wsServiceProvider);
    if (ws == null) return;
    setState(() => _retrying = true);
    ref.read(connectionMessageProvider.notifier).state = null;
    try {
      await ws.reconnect();
    } catch (error) {
      ref.read(connectionMessageProvider.notifier).state = error.toString();
    } finally {
      if (mounted) setState(() => _retrying = false);
    }
  }

  Future<void> _switchProfile(PairedMachineProfile profile) async {
    if (profile.profileId == AuthService.instance.activeProfileId ||
        _switchingProfileId != null) {
      return;
    }
    setState(() {
      _switchingProfileId = profile.profileId;
      _diagnostics = const {};
    });
    try {
      await ProfileSwitchService.select(ref, profile.profileId);
    } catch (error) {
      ref.read(connectionMessageProvider.notifier).state = error.toString();
    } finally {
      if (mounted) setState(() => _switchingProfileId = null);
    }
  }

  Future<void> _runDoctor() async {
    setState(() => _diagnosing = true);
    final results = await ConnectionDoctorService().diagnoseAll(
      AuthService.instance.endpoints,
    );
    if (!mounted) return;
    setState(() {
      _diagnostics = {for (final result in results) result.endpoint: result};
      _diagnosing = false;
    });
  }

  Future<void> _refreshLiveUpdateStatus() async {
    if (_checkingLiveUpdates) return;
    if (mounted) setState(() => _checkingLiveUpdates = true);
    try {
      final status = await AtomcliAndroidLiveUpdates.status();
      if (mounted) setState(() => _liveUpdateStatus = status);
    } catch (_) {
      if (mounted) setState(() => _liveUpdateStatus = null);
    } finally {
      if (mounted) setState(() => _checkingLiveUpdates = false);
    }
  }

  Future<void> _openLiveUpdates() async {
    try {
      await AtomcliAndroidLiveUpdates.openSettings();
    } catch (_) {
      // Some Android variants do not expose the dedicated settings surface.
    }
  }

  String _liveUpdateLabel(AppLocalizations strings) {
    if (_checkingLiveUpdates) return strings.checkingLiveUpdates;
    final status = _liveUpdateStatus;
    if (status == null || !status.supported) {
      return strings.liveUpdatesUnsupported;
    }
    return status.allowed
        ? strings.liveUpdatesReady
        : strings.liveUpdatesNeedsPermission;
  }

  Future<void> _confirmForget() async {
    final strings = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppPalette.panel,
        title: Text(strings.forgetLinkQuestion),
        content: Text(strings.forgetLinkExplanation),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(strings.cancel),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: AppPalette.danger,
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.pop(context, true),
            child: Text(strings.forget),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _forgetting = true);
    final ws = ref.read(wsServiceProvider);
    final active = AuthService.instance.activeProfile;
    final sameMachineProfiles = AuthService.instance.profiles
        .where((profile) => profile.machineId == active?.machineId)
        .length;
    try {
      // Device authorization is machine-wide. Revoking one of several process
      // links on the same PC would unexpectedly break the remaining links.
      if (sameMachineProfiles <= 1 && ws?.isConnected == true) {
        await ws!.unpair();
      }
    } catch (_) {
      // Local cleanup remains available when the old machine is unreachable.
    }
    await ws?.dispose();
    final profileId = AuthService.instance.activeProfileId;
    if (profileId != null) {
      try {
        await LocalCacheDatabase.instance.clearProfile(profileId);
      } catch (_) {
        // A damaged cache must not trap the user in a pairing they revoked.
      }
    }
    final hasRemaining = profileId == null
        ? AuthService.instance.profiles.isNotEmpty
        : await AuthService.instance.forgetProfile(profileId);
    if (!mounted) return;
    ProfileSwitchService.clearMachineState(ref);
    if (hasRemaining) {
      final next = AuthService.instance.activeProfile!;
      ref.read(wsServiceProvider.notifier).state =
          ProfileSwitchService.createSocket(ref, next);
      setState(() => _forgetting = false);
      return;
    }
    BackgroundConnectionService.stop();
    await AuthService.instance.clearPairing();
    ref.read(wsServiceProvider.notifier).state = null;
    ref.read(connectionStateProvider.notifier).state =
        WsConnectionState.disconnected;
    ref.read(connectionMessageProvider.notifier).state = null;
    if (mounted) {
      Navigator.of(context).pushNamedAndRemoveUntil('/scan', (_) => false);
    }
  }

  static String _shortDeviceId(String? id, String unavailable) {
    if (id == null || id.isEmpty) return unavailable;
    return id.length <= 12
        ? id
        : '${id.substring(0, 6)}…${id.substring(id.length - 4)}';
  }
}

class _AccentChoice extends StatefulWidget {
  final AppAccent accent;
  final String label;
  final Color color;

  const _AccentChoice({
    required this.accent,
    required this.label,
    required this.color,
  });

  @override
  State<_AccentChoice> createState() => _AccentChoiceState();
}

class _AccentChoiceState extends State<_AccentChoice> {
  @override
  Widget build(BuildContext context) {
    final selected = AppPalette.accentSelection.value == widget.accent;
    return InkWell(
      onTap: () async {
        await CompanionPreferences.instance.selectAccent(widget.accent);
        if (mounted) setState(() {});
      },
      borderRadius: BorderRadius.circular(14),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 11),
        decoration: BoxDecoration(
          color: selected
              ? widget.color.withValues(alpha: 0.12)
              : AppPalette.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: selected ? widget.color : AppPalette.stroke,
          ),
        ),
        child: Column(
          children: [
            Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                color: widget.color,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: widget.color.withValues(alpha: 0.32),
                    blurRadius: 12,
                  ),
                ],
              ),
              child: selected
                  ? const Icon(
                      Icons.check_rounded,
                      size: 16,
                      color: AppPalette.background,
                    )
                  : null,
            ),
            const SizedBox(height: 7),
            Text(
              widget.label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelSmall,
            ),
          ],
        ),
      ),
    );
  }
}

String _powerDescription(AppLocalizations strings, ConnectionPowerMode mode) {
  return switch (mode) {
    ConnectionPowerMode.balanced => strings.powerBalancedDescription,
    ConnectionPowerMode.realtime => strings.powerRealtimeDescription,
    ConnectionPowerMode.manual => strings.powerManualDescription,
  };
}

String _privacyDescription(
  AppLocalizations strings,
  NotificationPrivacyMode mode,
) => switch (mode) {
  NotificationPrivacyMode.details => strings.privacyDetailsDescription,
  NotificationPrivacyMode.protected => strings.privacyProtectedDescription,
  NotificationPrivacyMode.hidden => strings.privacyHiddenDescription,
};

class _MachineGroupCard extends StatelessWidget {
  final List<PairedMachineProfile> profiles;
  final String? activeProfileId;
  final String? switchingProfileId;
  final ValueChanged<PairedMachineProfile> onSelect;

  const _MachineGroupCard({
    required this.profiles,
    required this.activeProfileId,
    required this.switchingProfileId,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    final machine = profiles.first;
    final strings = AppLocalizations.of(context);
    return ControlPanel(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(15, 13, 15, 10),
            child: Row(
              children: [
                Icon(
                  Icons.computer_rounded,
                  size: 20,
                  color: AppPalette.primary,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        machine.machineName,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      Text(
                        _shortIdentity(machine.machineId),
                        style: const TextStyle(
                          color: AppPalette.textMuted,
                          fontFamily: 'monospace',
                          fontSize: 10,
                        ),
                      ),
                    ],
                  ),
                ),
                Text(
                  strings.processCount(profiles.length),
                  style: const TextStyle(
                    color: AppPalette.textMuted,
                    fontSize: 10,
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          for (var index = 0; index < profiles.length; index++) ...[
            _ProfileRow(
              profile: profiles[index],
              active: profiles[index].profileId == activeProfileId,
              switching: profiles[index].profileId == switchingProfileId,
              onTap: () => onSelect(profiles[index]),
            ),
            if (index < profiles.length - 1) const Divider(height: 1),
          ],
        ],
      ),
    );
  }

  static String _shortIdentity(String value) => value.length <= 12
      ? value
      : '${value.substring(0, 8)}…${value.substring(value.length - 4)}';
}

class _ProfileRow extends StatelessWidget {
  final PairedMachineProfile profile;
  final bool active;
  final bool switching;
  final VoidCallback onTap;

  const _ProfileRow({
    required this.profile,
    required this.active,
    required this.switching,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final directory = profile.projectDirectory.trim();
    final project = directory.isEmpty
        ? strings.unknownProject
        : directory
                  .split(RegExp(r'[/\\]'))
                  .where((part) => part.isNotEmpty)
                  .lastOrNull ??
              directory;
    final endpoint = profile.endpoints.firstOrNull;
    return InkWell(
      onTap: active || switching ? null : onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(15, 11, 11, 11),
        child: Row(
          children: [
            Icon(
              active ? Icons.radio_button_checked : Icons.radio_button_off,
              size: 18,
              color: active ? AppPalette.mint : AppPalette.textMuted,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(project, style: Theme.of(context).textTheme.bodyLarge),
                  const SizedBox(height: 2),
                  Text(
                    directory.isEmpty
                        ? endpoint ?? strings.noEndpoint
                        : directory,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppPalette.textMuted,
                      fontFamily: 'monospace',
                      fontSize: 10,
                    ),
                  ),
                  if (profile.processId != null)
                    Text(
                      strings.processBridge(
                        _short(profile.processId!),
                        _short(profile.bridgeId ?? strings.pending),
                      ),
                      style: const TextStyle(
                        color: AppPalette.textMuted,
                        fontFamily: 'monospace',
                        fontSize: 9,
                      ),
                    ),
                ],
              ),
            ),
            if (switching)
              const SizedBox.square(
                dimension: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            else if (active)
              Text(
                strings.active,
                style: const TextStyle(
                  color: AppPalette.mint,
                  fontSize: 9,
                  fontWeight: FontWeight.w700,
                ),
              )
            else
              const Icon(
                Icons.chevron_right_rounded,
                color: AppPalette.textMuted,
              ),
          ],
        ),
      ),
    );
  }

  static String _short(String value) =>
      value.length <= 8 ? value : value.substring(0, 8);
}

class _StatusPanel extends StatelessWidget {
  final WsConnectionState state;
  final String? endpoint;
  final String? message;

  const _StatusPanel({required this.state, this.endpoint, this.message});

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final (title, body, color, icon) = switch (state) {
      WsConnectionState.connected => (
        strings.linkOperational,
        strings.linkOperationalBody,
        AppPalette.mint,
        Icons.hub_rounded,
      ),
      WsConnectionState.connecting => (
        strings.tryingRoutes,
        strings.tryingRoutesBody,
        AppPalette.amber,
        Icons.sync_rounded,
      ),
      WsConnectionState.disconnected => (
        strings.linkOffline,
        message ?? strings.linkOfflineBody,
        AppPalette.danger,
        Icons.link_off_rounded,
      ),
    };

    return ControlPanel(
      borderColor: color.withValues(alpha: 0.4),
      color: color.withValues(alpha: 0.06),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(13),
            ),
            child: Icon(icon, color: color),
          ),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 4),
                Text(body, style: Theme.of(context).textTheme.bodySmall),
                if (endpoint != null) ...[
                  const SizedBox(height: 9),
                  Text(
                    endpoint!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppPalette.textSecondary,
                      fontFamily: 'monospace',
                      fontSize: 10,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _EndpointRow extends StatelessWidget {
  final String endpoint;
  final bool current;
  final bool connected;
  final bool showDivider;
  final EndpointDiagnosis? diagnosis;

  const _EndpointRow({
    required this.endpoint,
    required this.current,
    required this.connected,
    required this.showDivider,
    this.diagnosis,
  });

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final uri = Uri.tryParse(endpoint);
    final host = uri?.host ?? endpoint;
    final kind = _kind(host, strings.localNetwork);
    final stateColor = connected ? AppPalette.mint : AppPalette.amber;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 13),
          child: Row(
            children: [
              Icon(
                kind.$2,
                color: current ? stateColor : AppPalette.textMuted,
                size: 19,
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      kind.$1,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      host,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(
                        context,
                      ).textTheme.bodySmall?.copyWith(fontFamily: 'monospace'),
                    ),
                    if (diagnosis != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        localizedDiagnosis(strings, diagnosis!.issue),
                        style: TextStyle(
                          color: diagnosis!.reachable
                              ? AppPalette.mint
                              : AppPalette.danger,
                          fontSize: 10,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (current)
                Text(
                  connected ? strings.active : strings.trying,
                  style: TextStyle(
                    color: stateColor,
                    fontFamily: 'monospace',
                    fontSize: 9,
                    fontWeight: FontWeight.w700,
                  ),
                ),
            ],
          ),
        ),
        if (showDivider) const Divider(height: 1, indent: 45),
      ],
    );
  }

  static (String, IconData) _kind(String host, String localNetwork) {
    if (RegExp(r'^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.').hasMatch(host) ||
        !RegExp(r'^\d+\.').hasMatch(host)) {
      return ('Tailscale', Icons.shield_outlined);
    }
    return (localNetwork, Icons.wifi_rounded);
  }
}

class _DetailRow extends StatelessWidget {
  final String label;
  final String value;
  final bool monospace;

  const _DetailRow({
    required this.label,
    required this.value,
    this.monospace = false,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(label, style: Theme.of(context).textTheme.labelSmall),
        const Spacer(),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.end,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: AppPalette.textSecondary,
              fontSize: 12,
              fontFamily: monospace ? 'monospace' : null,
            ),
          ),
        ),
      ],
    );
  }
}
