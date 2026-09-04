import 'dart:async';
import 'dart:io';

import 'package:atomcli_companion/services/connection_doctor_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('classifies LAN, Tailscale IP and MagicDNS routes', () {
    expect(
      ConnectionDoctorService.classifyHost('192.168.1.20'),
      EndpointRoute.localNetwork,
    );
    expect(
      ConnectionDoctorService.classifyHost('100.72.1.4'),
      EndpointRoute.tailscaleIp,
    );
    expect(
      ConnectionDoctorService.classifyHost('atom.tailnet.ts.net'),
      EndpointRoute.tailscaleDns,
    );
  });

  test(
    'reports a reachable TCP route without claiming authentication',
    () async {
      final doctor = ConnectionDoctorService(
        lookup: (_) async => [InternetAddress('100.72.1.4')],
        probe: (_, _, _) async {},
      );

      final result = await doctor.diagnose(
        'ws://atom.tailnet.ts.net:4096/companion/ws',
      );

      expect(result.reachable, isTrue);
      expect(result.addresses, ['100.72.1.4']);
      expect(result.summary, contains('Authentication was not tested'));
    },
  );

  test('separates DNS failure, timeout and invalid address', () async {
    final dnsFailure = ConnectionDoctorService(
      lookup: (_) => Future.error(const SocketException('DNS failed')),
    );
    final timeout = ConnectionDoctorService(
      lookup: (_) async => [InternetAddress('192.168.1.20')],
      probe: (_, _, _) => Future.error(TimeoutException('timeout')),
    );

    expect(
      (await dnsFailure.diagnose(
        'ws://atom.tailnet.ts.net:4096/companion/ws',
      )).issue,
      EndpointIssue.dnsFailure,
    );
    expect(
      (await timeout.diagnose('ws://192.168.1.20:4096/companion/ws')).issue,
      EndpointIssue.timedOut,
    );
    expect(
      (await timeout.diagnose('https://example.com')).issue,
      EndpointIssue.invalidAddress,
    );
  });
}
