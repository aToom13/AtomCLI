import 'package:flutter/widgets.dart';
import 'package:intl/intl.dart';

import '../services/connection_doctor_service.dart';
import '../services/connection_state_machine.dart';
import 'app_localizations.dart';

String? localizedConnectionStatus(
  BuildContext context,
  ConnectionStatus status,
) {
  final strings = AppLocalizations.of(context);
  return switch (status.phase) {
    ConnectionPhase.idle || ConnectionPhase.connected => null,
    ConnectionPhase.discovering => strings.discoveringEndpoints,
    ConnectionPhase.connecting => strings.connectingEndpoint(
      status.endpoint ?? 'AtomCLI',
      status.attempt + 1,
    ),
    ConnectionPhase.authenticating => strings.authenticatingDevice,
    ConnectionPhase.synchronizing => strings.synchronizingState,
    ConnectionPhase.retryWaiting => strings.retryingAt(
      status.retryAt == null
          ? '—'
          : DateFormat.Hm(
              Localizations.localeOf(context).toString(),
            ).format(status.retryAt!),
    ),
    ConnectionPhase.suspended => strings.backgroundHandoff,
    ConnectionPhase.incompatible => strings.incompatibleProtocol,
    ConnectionPhase.stopped => status.reason,
  };
}

String localizedDiagnosis(AppLocalizations strings, EndpointIssue issue) =>
    switch (issue) {
      EndpointIssue.none => strings.doctorReachable,
      EndpointIssue.invalidAddress => strings.doctorInvalidAddress,
      EndpointIssue.dnsFailure => strings.doctorDnsFailure,
      EndpointIssue.timedOut => strings.doctorTimedOut,
      EndpointIssue.refused => strings.doctorRefused,
      EndpointIssue.unreachable => strings.doctorUnreachable,
    };
