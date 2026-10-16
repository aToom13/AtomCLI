part of 'screens_test.dart';

Widget testApp(Widget child) {
  return ProviderScope(
    child: MaterialApp(
      theme: AppTheme.dark,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: child,
    ),
  );
}

class TestSessionsNotifier extends SessionListNotifier {
  @override
  List<SessionInfo> build() => [
    SessionInfo(id: 'session_one', title: 'First project', updated: 1),
    SessionInfo(id: 'session_two', title: 'Second project', updated: 2),
  ];
}

class TestModelsNotifier extends ModelsListNotifier {
  @override
  List<ModelInfo> build() => [
    ModelInfo(
      id: 'one/model-a',
      name: 'Model A',
      providerName: 'One',
      free: true,
    ),
    ModelInfo(id: 'two/model-b', name: 'Model B', providerName: 'Two'),
  ];
}

class TestAgentsNotifier extends AgentsListNotifier {
  @override
  List<AgentInfo> build() => [
    AgentInfo(name: 'agent', description: 'Primary agent', mode: 'primary'),
  ];
}

class TestArtifactsNotifier extends ArtifactsNotifier {
  @override
  List<CompanionArtifact> build() => [
    CompanionArtifact.fromJson({
      'id': 'artifact_1',
      'kind': 'file',
      'direction': 'pc_to_mobile',
      'sourceDevice': 'cachyos-atom13',
      'title': 'Build report',
      'name': 'report.txt',
      'mime': 'text/plain',
      'size': 42,
      'createdAt': 1000,
      'downloadPath': '/companion/artifact/artifact_1?token=test',
    }),
  ];
}

class TestPreviewsNotifier extends PreviewsNotifier {
  @override
  List<CompanionPreview> build() => [
    CompanionPreview.fromJson({
      'id': 'preview_1',
      'title': 'Project site',
      'command': 'bun run dev',
      'port': 3000,
      'status': 'running',
      'endpoints': ['http://100.64.0.1:3000'],
      'logTail': 'ready',
      'createdAt': 1000,
      'sourceDevice': 'cachyos-atom13',
      'directory': '/home/user/project',
    }),
  ];
}

class TestMissionDagNotifier extends DagNotifier {
  @override
  List<DagStep> build() => const [
    DagStep(
      stepId: 'inspect',
      workflowId: 'wf_mission',
      name: 'inspect',
      description: 'Inspect the project',
      status: 'complete',
      sessionId: 'session_parent',
      directory: '/code/project',
    ),
    DagStep(
      stepId: 'fix',
      workflowId: 'wf_mission',
      name: 'fix',
      description: 'Apply the fix',
      status: 'running',
      sessionId: 'session_parent',
      directory: '/code/project',
    ),
    DagStep(
      stepId: 'other',
      workflowId: 'wf_other_process',
      name: 'other',
      description: 'Task from another AtomCLI session',
      status: 'running',
      sessionId: 'session_other',
      directory: '/code/project',
    ),
  ];
}

class TestMissionSessionsNotifier extends SessionListNotifier {
  @override
  List<SessionInfo> build() => [
    SessionInfo(
      id: 'session_parent',
      title: 'Selected mission',
      directory: '/code/project',
      updated: 2,
    ),
    SessionInfo(
      id: 'session_other',
      title: 'Other process',
      directory: '/code/project',
      updated: 1,
    ),
  ];
}

class TestMissionConversationNotifier extends ConversationNotifier {
  @override
  ConversationState build() => const ConversationState(
    selectedSessionId: 'session_parent',
    selectedDirectory: '/code/project',
  );
}

class TestCheckpointConversationNotifier extends ConversationNotifier {
  @override
  ConversationState build() => ConversationState(
    selectedSessionId: 'session_one',
    selectedDirectory: '/code/project',
    messages: {
      'session_one': [
        ConversationMessage(
          id: 'checkpoint_message',
          sessionId: 'session_one',
          role: 'assistant',
          time: DateTime.fromMillisecondsSinceEpoch(1),
          parts: const [
            ConversationPart(
              id: 'part_checkpoint',
              messageId: 'checkpoint_message',
              sessionId: 'session_one',
              type: 'checkpoint',
              checkpoint: CheckpointData(
                sequence: 2,
                decision: 'blocked',
                objectiveAssessment: 'objective intact',
                progressSummary: 'Blocked on environment',
                completedWork: ['implemented parser'],
                remainingWork: ['wire the renderer'],
                failures: ['network unavailable'],
                blockers: ['no network access'],
                routeAssessment: 'keep route',
                nextActions: ['retry environment setup'],
                runtime: CheckpointRuntime(
                  executionID: 'exec_cp',
                  reason: 'requested',
                  model: 'xai/grok-4',
                  allowance: CheckpointAllowance(
                    limit: 50,
                    used: 20,
                    extensions: 1,
                    toolCalls: 20,
                  ),
                ),
              ),
            ),
          ],
        ),
      ],
    },
  );
}

class TestSessionScopedDagNotifier extends DagNotifier {
  @override
  List<DagStep> build() => const [
    DagStep(
      name: 'selected-task',
      description: 'Selected session task',
      status: 'complete',
      sessionId: 'session_one',
      directory: '/code/project',
    ),
    DagStep(
      name: 'other-task',
      description: 'Other process task',
      status: 'running',
      sessionId: 'session_two',
      directory: '/code/project',
    ),
  ];
}

class TestSelectedConversationNotifier extends ConversationNotifier {
  @override
  ConversationState build() => const ConversationState(
    selectedSessionId: 'session_one',
    selectedDirectory: '/code/project',
  );
}

class TestFailureConversationNotifier extends ConversationNotifier {
  @override
  ConversationState build() => ConversationState(
    selectedSessionId: 'session_one',
    selectedModelId: 'kilocode/z-ai/glm-5.3-flash',
    selectedDirectory: '/code/project',
    messages: {
      'session_one': [
        ConversationMessage(
          id: 'failed_assistant_message',
          sessionId: 'session_one',
          role: 'assistant',
          time: DateTime.fromMillisecondsSinceEpoch(1),
          modelId: 'kilocode/z-ai/glm-5.3-flash',
          failure: const ConversationFailure(
            code: 'APIError',
            message: 'Add credits to continue',
            statusCode: 402,
          ),
        ),
      ],
    },
  );
}

class TestMissionAgentsNotifier extends SubAgentNotifier {
  @override
  List<SubAgentInfo> build() => [
    SubAgentInfo(
      sessionId: 'session_child',
      parentSessionId: 'session_parent',
      parentStepId: 'fix',
      directory: '/code/project',
      agentType: 'reviewer',
      name: 'Review the fix',
      status: 'running',
      startedAt: 1,
    ),
  ];
}

class TestChatAgentsNotifier extends SubAgentNotifier {
  @override
  List<SubAgentInfo> build() => [
    SubAgentInfo(
      sessionId: 'session_child',
      parentSessionId: 'session_one',
      directory: '/code/project',
      agentType: 'coder',
      name: 'Build game',
      status: 'running',
      startedAt: 1,
      activities: const [
        SubAgentActivity(
          kind: 'tool',
          label: 'Created game.js',
          status: 'completed',
          output: '6098 bytes',
          time: 2,
        ),
        SubAgentActivity(
          kind: 'command',
          label: 'Running Playwright tests',
          status: 'running',
          time: 3,
        ),
      ],
    ),
  ];
}

class TestChatAgentConversationNotifier extends ConversationNotifier {
  @override
  ConversationState build() => ConversationState(
    selectedSessionId: 'session_one',
    selectedDirectory: '/code/project',
    messages: {
      'session_one': [
        ConversationMessage(
          id: 'user_prompt',
          sessionId: 'session_one',
          role: 'user',
          time: DateTime.fromMillisecondsSinceEpoch(1),
          parts: const [
            ConversationPart(
              id: 'prompt_part',
              messageId: 'user_prompt',
              sessionId: 'session_one',
              type: 'text',
              text: 'Build a game',
            ),
          ],
        ),
        ConversationMessage(
          id: 'assistant_agent_tool',
          sessionId: 'session_one',
          role: 'assistant',
          time: DateTime.fromMillisecondsSinceEpoch(2),
          parts: const [
            ConversationPart(
              id: 'agent_tool_part',
              messageId: 'assistant_agent_tool',
              sessionId: 'session_one',
              type: 'tool',
              tool: 'agent',
              toolState: {'status': 'running'},
            ),
          ],
        ),
      ],
    },
  );
}

class TestMissionPermissionsNotifier extends PermissionsNotifier {
  @override
  List<PendingPermission> build() => const [
    PendingPermission(
      reqId: 'mission_permission',
      sessionId: 'session_child',
      permission: 'bash',
      patterns: ['bun test'],
      metadata: {},
    ),
  ];
}

Widget chatTestApp() {
  return ProviderScope(
    overrides: [
      sessionListProvider.overrideWith(TestSessionsNotifier.new),
      modelsListProvider.overrideWith(TestModelsNotifier.new),
      agentsListProvider.overrideWith(TestAgentsNotifier.new),
      connectionStateProvider.overrideWith(
        (ref) => WsConnectionState.connected,
      ),
    ],
    child: MaterialApp(
      theme: AppTheme.dark,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: const ChatScreen(),
    ),
  );
}
