import 'package:atomcli_companion/services/preview_health.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('preview diagnostics redact credentials and URL query data', () {
    final sanitized = sanitizePreviewDiagnostic(
      'Fetch https://user:pass@example.test/api/items?token=secret#private '
      'failed with Bearer abc.def, token="a secret value" and '
      'api_key=super-secret',
    );

    expect(sanitized, contains('https://example.test/api/items'));
    expect(sanitized, contains('Bearer <redacted>'));
    expect(sanitized, contains('api_key=<redacted>'));
    expect(sanitized, contains('token=<redacted>'));
    expect(sanitized, isNot(contains('user:pass')));
    expect(sanitized, isNot(contains('secret value')));
    expect(sanitized, isNot(contains('super-secret')));
    expect(sanitized, isNot(contains('token=secret')));
  });

  test('non-network resource schemes never expose embedded content', () {
    expect(
      sanitizePreviewResource(Uri.parse('data:text/plain,token=secret')),
      'data:<redacted>',
    );
    expect(sanitizePreviewResource(Uri.parse('about:blank')), 'about:blank');
  });

  test('correlates duplicate WebView signals without hiding real repeats', () {
    final tracker = PreviewHealthTracker();
    final now = DateTime(2026, 9, 4, 12);
    tracker.record(
      kind: PreviewHealthKind.console,
      severity: PreviewHealthSeverity.error,
      message: 'Uncaught (in promise) Error: Save failed',
      occurredAt: now,
    );
    tracker.record(
      kind: PreviewHealthKind.runtime,
      severity: PreviewHealthSeverity.error,
      message: 'Save failed',
      occurredAt: now.add(const Duration(milliseconds: 20)),
    );
    tracker.record(
      kind: PreviewHealthKind.runtime,
      severity: PreviewHealthSeverity.error,
      message: 'Save failed',
      occurredAt: now.add(const Duration(seconds: 3)),
    );

    expect(tracker.issues, hasLength(1));
    expect(tracker.issues.single.kind, PreviewHealthKind.runtime);
    expect(tracker.issues.single.occurrences, 2);

    tracker.record(
      kind: PreviewHealthKind.network,
      severity: PreviewHealthSeverity.error,
      message: 'Resource failed to load',
      resource: Uri.parse('https://preview.test/missing.png?token=secret'),
      occurredAt: now,
    );
    tracker.record(
      kind: PreviewHealthKind.network,
      severity: PreviewHealthSeverity.error,
      message: 'HTTP request failed (404)',
      resource: Uri.parse('https://preview.test/missing.png?token=other'),
      statusCode: 404,
      occurredAt: now.add(const Duration(milliseconds: 40)),
    );

    expect(tracker.issues, hasLength(2));
    expect(tracker.issues.first.statusCode, 404);
  });

  test('preview health deduplicates and bounds untrusted events', () {
    final tracker = PreviewHealthTracker();
    tracker.record(
      kind: PreviewHealthKind.network,
      severity: PreviewHealthSeverity.error,
      message: 'Not found',
      resource: Uri.parse('https://preview.test/missing.js?token=secret'),
      statusCode: 404,
    );
    tracker.record(
      kind: PreviewHealthKind.network,
      severity: PreviewHealthSeverity.error,
      message: 'Not found',
      resource: Uri.parse('https://preview.test/missing.js?token=another'),
      statusCode: 404,
    );

    expect(tracker.issues, hasLength(1));
    expect(tracker.issues.single.occurrences, 2);
    expect(tracker.issues.single.resource, 'https://preview.test/missing.js');
    expect(tracker.errorCount, 2);

    for (var index = 0; index < 1200; index++) {
      tracker.record(
        kind: PreviewHealthKind.network,
        severity: PreviewHealthSeverity.error,
        message: 'Not found',
        resource: Uri.parse('https://preview.test/missing.js'),
        statusCode: 404,
      );
    }
    expect(
      tracker.issues.single.occurrences,
      PreviewHealthIssue.maxOccurrences,
    );

    for (var index = 0; index < PreviewHealthTracker.maxIssues + 8; index++) {
      tracker.record(
        kind: PreviewHealthKind.console,
        severity: PreviewHealthSeverity.warning,
        message: 'warning-$index ${'x' * 300}',
      );
    }
    expect(tracker.issues, hasLength(PreviewHealthTracker.maxIssues));
    expect(
      tracker.issues.every(
        (issue) =>
            issue.message.length <= PreviewHealthTracker.maxMessageLength,
      ),
      isTrue,
    );
  });
}
