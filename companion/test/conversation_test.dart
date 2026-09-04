import 'package:atomcli_companion/models.dart';
import 'package:atomcli_companion/providers/app_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('model metadata exposes free, reasoning and supported variants', () {
    final model = ModelInfo.fromJson({
      'id': 'atomcli/reasoning-free',
      'name': 'Reasoning Free',
      'providerId': 'atomcli',
      'providerName': 'AtomCLI',
      'free': true,
      'reasoning': true,
      'capabilities': {
        'images': true,
        'pdf': true,
        'audio': true,
        'video': true,
      },
      'cost': {'input': 0, 'output': 0},
      'limit': {'context': 128000, 'output': 16000},
      'variants': ['low', 'high', 'max'],
    });

    expect(model.free, isTrue);
    expect(model.reasoning, isTrue);
    expect(model.images, isTrue);
    expect(model.pdf, isTrue);
    expect(model.audio, isTrue);
    expect(model.video, isTrue);
    expect(model.variants, ['low', 'high', 'max']);
    expect(model.contextLimit, 128000);
  });

  test(
    'model selection is retained and streaming parts merge into one message',
    () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      final notifier = container.read(conversationProvider.notifier);

      notifier.syncModels([
        ModelInfo(id: 'one/model-a', name: 'Model A', providerName: 'One'),
        ModelInfo(id: 'two/model-b', name: 'Model B', providerName: 'Two'),
      ], 'one/model-a');
      notifier.setModel('two/model-b');
      notifier.applyMessageInfo({
        'id': 'message_1',
        'sessionID': 'session_1',
        'role': 'assistant',
      });
      notifier.applyMessagePart({
        'part': {
          'id': 'part_1',
          'messageID': 'message_1',
          'sessionID': 'session_1',
          'type': 'text',
          'text': 'Hello',
        },
      });
      notifier.applyMessagePart({
        'part': {
          'id': 'part_1',
          'messageID': 'message_1',
          'sessionID': 'session_1',
          'type': 'text',
          'text': 'Hello world',
        },
        'delta': ' world',
      });

      final state = container.read(conversationProvider);
      expect(state.selectedModelId, 'two/model-b');
      expect(
        state.messagesFor('session_1').single.parts.single.text,
        'Hello world',
      );
    },
  );

  test('streaming part batches publish one conversation state update', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    var updates = 0;
    final subscription = container.listen(
      conversationProvider,
      (_, _) => updates++,
    );
    addTearDown(subscription.close);

    container.read(conversationProvider.notifier).applyMessageParts([
      {
        'part': {
          'id': 'part_batch',
          'messageID': 'message_batch',
          'sessionID': 'session_batch',
          'type': 'text',
          'text': 'Hello',
        },
      },
      {
        'part': {
          'id': 'part_batch',
          'messageID': 'message_batch',
          'sessionID': 'session_batch',
          'type': 'text',
          'text': 'Hello world',
        },
        'delta': ' world',
      },
    ]);

    expect(updates, 1);
    expect(
      container
          .read(conversationProvider)
          .messagesFor('session_batch')
          .single
          .parts
          .single
          .text,
      'Hello world',
    );
  });

  test('workflow and question state stays deduplicated across projects', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final dag = container.read(dagProvider.notifier);
    dag.upsert(
      const DagStep(
        name: 'build',
        description: 'Project A',
        status: 'running',
        directory: '/project/a',
        sessionId: 'session_a',
      ),
    );
    dag.upsert(
      const DagStep(
        name: 'build',
        description: 'Project B',
        status: 'running',
        directory: '/project/b',
        sessionId: 'session_b',
      ),
    );
    dag.updateStatus(
      'build',
      'complete',
      sessionId: 'session_a',
      directory: '/project/a',
    );

    expect(container.read(dagProvider), hasLength(2));
    expect(
      container
          .read(dagProvider)
          .singleWhere((step) => step.sessionId == 'session_a')
          .status,
      'complete',
    );
    expect(
      container
          .read(dagProvider)
          .singleWhere((step) => step.sessionId == 'session_b')
          .status,
      'running',
    );

    const question = PendingQuestion(
      reqId: 'question_1',
      sessionId: 'session_a',
      questions: [],
    );
    final questions = container.read(questionsProvider.notifier);
    questions.add(question);
    questions.add(question);
    expect(container.read(questionsProvider), hasLength(1));

    dag.clear(directory: '/project/a');
    expect(container.read(dagProvider).single.sessionId, 'session_b');
  });

  test(
    'Mission Control isolates workflows and attaches decisions and agents',
    () {
      const steps = [
        DagStep(
          stepId: 'inspect',
          workflowId: 'wf_one',
          name: 'inspect',
          description: 'Inspect',
          status: 'complete',
          directory: '/project/a',
          sessionId: 'session_parent',
        ),
        DagStep(
          stepId: 'fix',
          workflowId: 'wf_one',
          name: 'fix',
          description: 'Fix',
          status: 'running',
          directory: '/project/a',
          sessionId: 'session_parent',
        ),
        DagStep(
          stepId: 'other',
          workflowId: 'wf_two',
          name: 'other',
          description: 'Other',
          status: 'pending',
          directory: '/project/a',
          sessionId: 'session_parent',
        ),
      ];
      final missions = MissionInfo.assemble(
        steps: steps,
        agents: [
          SubAgentInfo(
            sessionId: 'session_child',
            parentSessionId: 'session_parent',
            parentStepId: 'fix',
            directory: '/project/a',
            agentType: 'reviewer',
            name: 'Review fix',
            status: 'running',
            startedAt: 1,
          ),
        ],
        permissions: const [
          PendingPermission(
            reqId: 'permission_1',
            sessionId: 'session_child',
            permission: 'bash',
            patterns: ['bun test'],
            metadata: {},
          ),
        ],
        questions: const [],
      );

      expect(missions, hasLength(2));
      final first = missions.singleWhere((mission) => mission.id == 'wf_one');
      expect(first.completedSteps, 1);
      expect(first.agents.single.parentStepId, 'fix');
      expect(first.pendingDecisions, 1);
      expect(first.status, MissionStatus.waiting);
      expect(
        missions.singleWhere((mission) => mission.id == 'wf_two').steps,
        hasLength(1),
      );
      expect(
        missions.singleWhere((mission) => mission.id == 'wf_two').agents,
        isEmpty,
      );
    },
  );
}
