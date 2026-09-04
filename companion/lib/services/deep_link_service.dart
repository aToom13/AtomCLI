import 'dart:async';

import 'package:flutter/services.dart';

enum CompanionDestination { deck, sessions, inbox, link }

class CompanionDeepLink {
  static const _maxIdentifierLength = 200;

  final CompanionDestination destination;
  final String? profileId;
  final String? machineId;
  final String? sessionId;
  final String? requestId;
  final String? workflowId;

  const CompanionDeepLink({
    required this.destination,
    this.profileId,
    this.machineId,
    this.sessionId,
    this.requestId,
    this.workflowId,
  });

  Uri toUri() => Uri(
    scheme: 'atomcli',
    host: 'open',
    queryParameters: {
      'tab': destination.name,
      'profile': ?profileId,
      'machine': ?machineId,
      'session': ?sessionId,
      'request': ?requestId,
      'workflow': ?workflowId,
    },
  );

  static CompanionDeepLink? tryParse(Object? raw) {
    final uri = raw is Uri ? raw : Uri.tryParse(raw?.toString() ?? '');
    if (uri == null || uri.scheme != 'atomcli' || uri.host != 'open') {
      return null;
    }
    if (uri.path.isNotEmpty && uri.path != '/') return null;
    const allowed = {
      'tab',
      'profile',
      'machine',
      'session',
      'request',
      'workflow',
    };
    if (uri.queryParameters.keys.any((key) => !allowed.contains(key))) {
      return null;
    }
    String? field(String name) {
      final value = uri.queryParameters[name]?.trim();
      if (value == null || value.isEmpty) return null;
      if (value.length > _maxIdentifierLength || value.contains('\u0000')) {
        throw const FormatException('Deep link identifier is invalid');
      }
      return value;
    }

    try {
      final tab = field('tab');
      final destination = CompanionDestination.values
          .where((value) => value.name == tab)
          .firstOrNull;
      final sessionId = field('session');
      final requestId = field('request');
      final workflowId = field('workflow');
      final inferred = requestId != null
          ? CompanionDestination.inbox
          : sessionId != null
          ? CompanionDestination.sessions
          : workflowId != null
          ? CompanionDestination.deck
          : null;
      final resolved = destination ?? inferred;
      if (resolved == null) return null;
      return CompanionDeepLink(
        destination: resolved,
        profileId: field('profile'),
        machineId: field('machine'),
        sessionId: sessionId,
        requestId: requestId,
        workflowId: workflowId,
      );
    } on FormatException {
      return null;
    }
  }
}

class DeepLinkService {
  DeepLinkService._();
  static final instance = DeepLinkService._();

  static const _channel = MethodChannel('io.atomcli.companion/deep_links');
  final _links = StreamController<CompanionDeepLink>.broadcast();
  bool _initialized = false;

  Stream<CompanionDeepLink> get links => _links.stream;

  Future<CompanionDeepLink?> initialize() async {
    if (!_initialized) {
      _initialized = true;
      _channel.setMethodCallHandler((call) async {
        if (call.method != 'link') return;
        final link = CompanionDeepLink.tryParse(call.arguments);
        if (link != null) _links.add(link);
      });
    }
    try {
      return CompanionDeepLink.tryParse(
        await _channel.invokeMethod<String>('getInitialLink'),
      );
    } on MissingPluginException {
      return null;
    } on PlatformException {
      return null;
    }
  }
}
