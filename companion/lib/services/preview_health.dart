enum PreviewHealthKind { console, runtime, network }

enum PreviewHealthSeverity { warning, error }

class PreviewHealthIssue {
  static const maxOccurrences = 999;

  final PreviewHealthKind kind;
  final PreviewHealthSeverity severity;
  final String message;
  final String? resource;
  final int? statusCode;
  final DateTime occurredAt;
  final int occurrences;

  const PreviewHealthIssue({
    required this.kind,
    required this.severity,
    required this.message,
    this.resource,
    this.statusCode,
    required this.occurredAt,
    this.occurrences = 1,
  });

  PreviewHealthIssue repeated(DateTime now) => PreviewHealthIssue(
    kind: kind,
    severity: severity,
    message: message,
    resource: resource,
    statusCode: statusCode,
    occurredAt: now,
    occurrences: occurrences >= maxOccurrences
        ? maxOccurrences
        : occurrences + 1,
  );
}

/// Bounded, in-memory diagnostics for the currently visible preview page.
///
/// Preview pages are untrusted and can emit secrets through console messages
/// or request URLs. This tracker removes URL credentials/query/fragment data,
/// redacts common credential assignments and never persists the result.
class PreviewHealthTracker {
  static const maxIssues = 24;
  static const maxMessageLength = 240;
  static const correlationWindow = Duration(seconds: 2);

  final List<PreviewHealthIssue> _issues = [];

  List<PreviewHealthIssue> get issues => List.unmodifiable(_issues);
  bool get hasIssues => _issues.isNotEmpty;
  int get errorCount => _issues
      .where((issue) => issue.severity == PreviewHealthSeverity.error)
      .fold(0, (total, issue) => total + issue.occurrences);
  int get warningCount => _issues
      .where((issue) => issue.severity == PreviewHealthSeverity.warning)
      .fold(0, (total, issue) => total + issue.occurrences);
  int get occurrenceCount => errorCount + warningCount;

  void clear() => _issues.clear();

  void record({
    required PreviewHealthKind kind,
    required PreviewHealthSeverity severity,
    required String message,
    Uri? resource,
    int? statusCode,
    DateTime? occurredAt,
  }) {
    final safeMessage = sanitizePreviewDiagnostic(message);
    if (safeMessage.isEmpty) return;
    final safeResource = sanitizePreviewResource(resource);
    final now = occurredAt ?? DateTime.now();
    final existing = _issues.indexWhere(
      (issue) =>
          issue.kind == kind &&
          issue.severity == severity &&
          issue.message == safeMessage &&
          issue.resource == safeResource &&
          issue.statusCode == statusCode,
    );
    if (existing >= 0) {
      final repeated = _issues.removeAt(existing).repeated(now);
      _issues.insert(0, repeated);
      return;
    }

    final correlated = _issues.indexWhere(
      (issue) =>
          now.difference(issue.occurredAt).abs() <= correlationWindow &&
          issue.severity == severity &&
          _isCorrelated(
            issue,
            kind: kind,
            message: safeMessage,
            resource: safeResource,
            statusCode: statusCode,
          ),
    );
    if (correlated >= 0) {
      final previous = _issues.removeAt(correlated);
      final preferIncoming =
          (kind == PreviewHealthKind.runtime &&
              previous.kind == PreviewHealthKind.console) ||
          (kind == PreviewHealthKind.network &&
              statusCode != null &&
              previous.statusCode == null);
      _issues.insert(
        0,
        preferIncoming
            ? PreviewHealthIssue(
                kind: kind,
                severity: severity,
                message: safeMessage,
                resource: safeResource,
                statusCode: statusCode,
                occurredAt: now,
                occurrences: previous.occurrences,
              )
            : previous,
      );
      return;
    }
    _issues.insert(
      0,
      PreviewHealthIssue(
        kind: kind,
        severity: severity,
        message: safeMessage,
        resource: safeResource,
        statusCode: statusCode,
        occurredAt: now,
      ),
    );
    if (_issues.length > maxIssues) {
      _issues.removeRange(maxIssues, _issues.length);
    }
  }

  bool _isCorrelated(
    PreviewHealthIssue issue, {
    required PreviewHealthKind kind,
    required String message,
    required String resource,
    required int? statusCode,
  }) {
    final runtimeAndConsole =
        {issue.kind, kind}.contains(PreviewHealthKind.runtime) &&
        {issue.kind, kind}.contains(PreviewHealthKind.console) &&
        _diagnosticFingerprint(issue.message) ==
            _diagnosticFingerprint(message);
    if (runtimeAndConsole) return true;

    return issue.kind == PreviewHealthKind.network &&
        kind == PreviewHealthKind.network &&
        resource.isNotEmpty &&
        issue.resource == resource &&
        ((issue.statusCode == null) != (statusCode == null));
  }
}

String _diagnosticFingerprint(String message) => message
    .replaceFirst(
      RegExp(
        r'^(?:Uncaught(?:\s+\(in promise\))?\s+)?(?:Error:\s*)?',
        caseSensitive: false,
      ),
      '',
    )
    .trim()
    .toLowerCase();

String sanitizePreviewResource(Uri? resource) {
  if (resource == null) return '';
  if (resource.scheme.isNotEmpty &&
      resource.scheme != 'http' &&
      resource.scheme != 'https') {
    return resource.scheme == 'about'
        ? _bounded(resource.toString())
        : '${resource.scheme}:<redacted>';
  }
  if (!resource.hasScheme || resource.host.isEmpty) {
    return _bounded(resource.path.isEmpty ? '/' : resource.path);
  }
  final port = resource.hasPort ? ':${resource.port}' : '';
  final path = resource.path.isEmpty ? '/' : resource.path;
  return _bounded('${resource.scheme}://${resource.host}$port$path');
}

String sanitizePreviewDiagnostic(String input) {
  var value = input.replaceAll(RegExp(r'[\r\n\t]+'), ' ').trim();
  value = value.replaceAllMapped(
    RegExp(r'''https?://[^\s<>"']+''', caseSensitive: false),
    (match) {
      final raw = match.group(0)!;
      return sanitizePreviewResource(Uri.tryParse(raw));
    },
  );
  value = value.replaceAllMapped(
    RegExp(r'\bbearer\s+[^\s,;]+', caseSensitive: false),
    (_) => 'Bearer <redacted>',
  );
  value = value.replaceAllMapped(
    RegExp(
      r'''\b(token|secret|password|authorization|api[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)''',
      caseSensitive: false,
    ),
    (match) => '${match.group(1)}=<redacted>',
  );
  return _bounded(value);
}

String _bounded(String value) {
  if (value.length <= PreviewHealthTracker.maxMessageLength) return value;
  return '${value.substring(0, PreviewHealthTracker.maxMessageLength - 1)}…';
}
