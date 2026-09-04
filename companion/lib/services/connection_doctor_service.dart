import 'dart:async';
import 'dart:io';

enum EndpointRoute { localNetwork, tailscaleIp, tailscaleDns, other }

enum EndpointIssue {
  none,
  invalidAddress,
  dnsFailure,
  timedOut,
  refused,
  unreachable,
}

class EndpointDiagnosis {
  final String endpoint;
  final EndpointRoute route;
  final EndpointIssue issue;
  final Duration elapsed;
  final List<String> addresses;
  final String summary;

  const EndpointDiagnosis({
    required this.endpoint,
    required this.route,
    required this.issue,
    required this.elapsed,
    this.addresses = const [],
    required this.summary,
  });

  bool get reachable => issue == EndpointIssue.none;
}

typedef HostLookup = Future<List<InternetAddress>> Function(String host);
typedef TcpProbe =
    Future<void> Function(String host, int port, Duration timeout);

class ConnectionDoctorService {
  static const _probeTimeout = Duration(seconds: 2);
  static const _maxEndpoints = 8;

  final HostLookup _lookup;
  final TcpProbe _probe;

  ConnectionDoctorService({HostLookup? lookup, TcpProbe? probe})
    : _lookup = lookup ?? InternetAddress.lookup,
      _probe = probe ?? _defaultProbe;

  Future<List<EndpointDiagnosis>> diagnoseAll(
    Iterable<String> endpoints,
  ) async {
    final results = <EndpointDiagnosis>[];
    // Sequential probes avoid a burst of radios, DNS requests and sockets.
    for (final endpoint in endpoints.take(_maxEndpoints)) {
      results.add(await diagnose(endpoint));
    }
    return results;
  }

  Future<EndpointDiagnosis> diagnose(String endpoint) async {
    final stopwatch = Stopwatch()..start();
    final uri = Uri.tryParse(endpoint);
    if (uri == null ||
        (uri.scheme != 'ws' && uri.scheme != 'wss') ||
        uri.host.isEmpty) {
      return _result(
        endpoint,
        EndpointRoute.other,
        EndpointIssue.invalidAddress,
        stopwatch,
        'Saved address is not a valid WebSocket endpoint.',
      );
    }

    final route = classifyHost(uri.host);
    final port = uri.hasPort ? uri.port : (uri.scheme == 'wss' ? 443 : 80);
    var addresses = <InternetAddress>[];
    try {
      final literal = InternetAddress.tryParse(uri.host);
      addresses = literal == null
          ? await _lookup(uri.host).timeout(_probeTimeout)
          : [literal];
      if (addresses.isEmpty) throw const SocketException('No DNS records');
    } on TimeoutException {
      return _result(
        endpoint,
        route,
        EndpointIssue.timedOut,
        stopwatch,
        'DNS lookup timed out.',
      );
    } on SocketException {
      return _result(
        endpoint,
        route,
        EndpointIssue.dnsFailure,
        stopwatch,
        'Host name could not be resolved.',
      );
    }

    try {
      await _probe(uri.host, port, _probeTimeout).timeout(_probeTimeout);
      return _result(
        endpoint,
        route,
        EndpointIssue.none,
        stopwatch,
        'TCP port is reachable. Authentication was not tested.',
        addresses: addresses.map((address) => address.address).toList(),
      );
    } on TimeoutException {
      return _result(
        endpoint,
        route,
        EndpointIssue.timedOut,
        stopwatch,
        'The route timed out; firewall or network isolation may be blocking it.',
        addresses: addresses.map((address) => address.address).toList(),
      );
    } on SocketException catch (error) {
      final refused =
          error.osError?.errorCode == 111 ||
          error.osError?.errorCode == 61 ||
          error.message.toLowerCase().contains('refused');
      return _result(
        endpoint,
        route,
        refused ? EndpointIssue.refused : EndpointIssue.unreachable,
        stopwatch,
        refused
            ? 'The machine answered, but no service accepted this port.'
            : 'The endpoint is not reachable on the current network.',
        addresses: addresses.map((address) => address.address).toList(),
      );
    }
  }

  static EndpointRoute classifyHost(String host) {
    final lower = host.toLowerCase();
    if (lower.endsWith('.ts.net')) return EndpointRoute.tailscaleDns;
    final address = InternetAddress.tryParse(host);
    if (address?.type != InternetAddressType.IPv4) return EndpointRoute.other;
    final parts = host.split('.').map(int.parse).toList();
    if (parts[0] == 100 && parts[1] >= 64 && parts[1] <= 127) {
      return EndpointRoute.tailscaleIp;
    }
    if (parts[0] == 10 ||
        (parts[0] == 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] == 192 && parts[1] == 168)) {
      return EndpointRoute.localNetwork;
    }
    return EndpointRoute.other;
  }

  static EndpointDiagnosis _result(
    String endpoint,
    EndpointRoute route,
    EndpointIssue issue,
    Stopwatch stopwatch,
    String summary, {
    List<String> addresses = const [],
  }) {
    stopwatch.stop();
    return EndpointDiagnosis(
      endpoint: endpoint,
      route: route,
      issue: issue,
      elapsed: stopwatch.elapsed,
      addresses: addresses,
      summary: summary,
    );
  }

  static Future<void> _defaultProbe(
    String host,
    int port,
    Duration timeout,
  ) async {
    final socket = await Socket.connect(host, port, timeout: timeout);
    socket.destroy();
  }
}
