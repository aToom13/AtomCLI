import 'package:atomcli_companion/services/deep_link_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('round-trips scoped Companion navigation targets', () {
    const target = CompanionDeepLink(
      destination: CompanionDestination.inbox,
      profileId: 'profile-1',
      machineId: 'machine-1',
      sessionId: 'session-1',
      requestId: 'request-1',
    );

    final parsed = CompanionDeepLink.tryParse(target.toUri());
    expect(parsed?.destination, CompanionDestination.inbox);
    expect(parsed?.profileId, 'profile-1');
    expect(parsed?.machineId, 'machine-1');
    expect(parsed?.sessionId, 'session-1');
    expect(parsed?.requestId, 'request-1');
  });

  test('infers destinations but rejects ambiguous or expanded link scope', () {
    expect(
      CompanionDeepLink.tryParse('atomcli://open?session=ses_1')?.destination,
      CompanionDestination.sessions,
    );
    expect(
      CompanionDeepLink.tryParse('atomcli://open?request=req_1')?.destination,
      CompanionDestination.inbox,
    );
    expect(
      CompanionDeepLink.tryParse('atomcli://open?workflow=wf_1')?.destination,
      CompanionDestination.deck,
    );
    expect(CompanionDeepLink.tryParse('https://open?session=ses_1'), isNull);
    expect(CompanionDeepLink.tryParse('atomcli://admin?session=ses_1'), isNull);
    expect(CompanionDeepLink.tryParse('atomcli://open?command=delete'), isNull);
    expect(CompanionDeepLink.tryParse('atomcli://open'), isNull);
    expect(
      CompanionDeepLink.tryParse(
        'atomcli://open?session=${List.filled(201, 'a').join()}',
      ),
      isNull,
    );
  });

  test('explicit tab does not turn identifiers into actions', () {
    final target = CompanionDeepLink.tryParse(
      'atomcli://open?tab=link&request=req_1&workflow=wf_1',
    );
    expect(target?.destination, CompanionDestination.link);
    expect(target?.requestId, 'req_1');
    expect(target?.workflowId, 'wf_1');
  });
}
