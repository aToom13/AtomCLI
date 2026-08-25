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
}
