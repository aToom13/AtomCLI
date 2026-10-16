part of '../models.dart';

class TodoItem {
  final String id;
  final String content;
  final String status; // pending | in_progress | complete | failed

  const TodoItem({
    required this.id,
    required this.content,
    required this.status,
  });

  factory TodoItem.fromJson(Map<String, dynamic> json) {
    return TodoItem(
      id: json['id'] as String,
      content: json['content'] as String,
      status: json['status'] as String? ?? 'pending',
    );
  }

  TodoItem copyWith({String? status}) =>
      TodoItem(id: id, content: content, status: status ?? this.status);
}

/// A DAG step from the orchestrator.
class DagStep {
  final String? stepId;
  final String? workflowId;
  final String name;
  final String description;
  final String
  status; // pending | running | complete | failed | <tool-specific>
  final String? directory;
  final String? sessionId;
  final String? agentType;
  final List<String> dependsOn;
  final List<TodoItem> todos;

  const DagStep({
    this.stepId,
    this.workflowId,
    required this.name,
    required this.description,
    required this.status,
    this.directory,
    this.sessionId,
    this.agentType,
    this.dependsOn = const [],
    this.todos = const [],
  });

  factory DagStep.fromJson(Map<String, dynamic> json) {
    final rawTodos = json['todos'] as List? ?? [];
    return DagStep(
      stepId: json['stepId'] as String?,
      workflowId: json['workflowId'] as String?,
      name: json['name'] as String,
      description: json['description'] as String,
      status: json['status'] as String? ?? 'pending',
      directory: json['directory'] as String?,
      sessionId: json['sessionID'] as String?,
      agentType: json['agentType'] as String?,
      dependsOn: List<String>.from(json['dependsOn'] as List? ?? []),
      todos: rawTodos
          .map((t) => TodoItem.fromJson(t as Map<String, dynamic>))
          .toList(),
    );
  }

  DagStep copyWith({String? status, List<TodoItem>? todos}) {
    return DagStep(
      stepId: stepId,
      workflowId: workflowId,
      name: name,
      description: description,
      status: status ?? this.status,
      directory: directory,
      sessionId: sessionId,
      agentType: agentType,
      dependsOn: dependsOn,
      todos: todos ?? this.todos,
    );
  }
}

class LogEntry {
  final String id;
  final String sessionId;
  final String role; // 'user', 'assistant', 'system'
  final String message;
  final DateTime timestamp;

  LogEntry({
    required this.id,
    required this.sessionId,
    required this.role,
    required this.message,
    required this.timestamp,
  });

  factory LogEntry.fromJson(Map<String, dynamic> json) {
    return LogEntry(
      id:
          json['id'] as String? ??
          DateTime.now().millisecondsSinceEpoch.toString(),
      sessionId:
          json['sessionID'] as String? ?? json['sessionId'] as String? ?? '',
      role: json['role'] as String? ?? 'system',
      message: json['message'] as String? ?? json['text'] as String? ?? '',
      timestamp: json['timestamp'] != null
          ? DateTime.fromMillisecondsSinceEpoch(json['timestamp'] as int)
          : DateTime.now(),
    );
  }
}


class SubAgentInfo {
  final String sessionId;
  final String? parentSessionId;
  final String? parentStepId;
  final String? directory;
  final String agentType;
  final String name;
  final String status; // 'running' | 'done' | 'failed'
  final int startedAt;
  final int? finishedAt;
  final List<SubAgentActivity> activities;

  SubAgentInfo({
    required this.sessionId,
    this.parentSessionId,
    this.parentStepId,
    this.directory,
    required this.agentType,
    required this.name,
    required this.status,
    required this.startedAt,
    this.finishedAt,
    this.activities = const [],
  });

  factory SubAgentInfo.fromJson(Map<String, dynamic> json) {
    return SubAgentInfo(
      sessionId: json['sessionID'] as String,
      parentSessionId: json['parentSessionID'] as String?,
      parentStepId: json['parentStepId'] as String?,
      directory: json['directory'] as String?,
      agentType: json['agentType'] as String? ?? 'unknown',
      name: json['name'] as String? ?? json['agentType'] as String? ?? 'Agent',
      status: json['status'] as String? ?? 'running',
      startedAt: json['startedAt'] as int? ?? 0,
      finishedAt: json['finishedAt'] as int?,
      activities: (json['activities'] as List? ?? const [])
          .whereType<Map>()
          .map(
            (item) =>
                SubAgentActivity.fromJson(Map<String, dynamic>.from(item)),
          )
          .toList(),
    );
  }

  SubAgentInfo copyWith({
    String? status,
    int? finishedAt,
    List<SubAgentActivity>? activities,
  }) => SubAgentInfo(
    sessionId: sessionId,
    parentSessionId: parentSessionId,
    parentStepId: parentStepId,
    directory: directory,
    agentType: agentType,
    name: name,
    status: status ?? this.status,
    startedAt: startedAt,
    finishedAt: finishedAt ?? this.finishedAt,
    activities: activities ?? this.activities,
  );
}

class SubAgentActivity {
  final String kind;
  final String label;
  final String status;
  final String? output;
  final int time;

  const SubAgentActivity({
    required this.kind,
    required this.label,
    required this.status,
    this.output,
    required this.time,
  });

  factory SubAgentActivity.fromJson(Map<String, dynamic> json) {
    return SubAgentActivity(
      kind: json['kind'] as String? ?? 'transcript',
      label: json['label'] as String? ?? '',
      status: json['status'] as String? ?? 'running',
      output: json['output'] as String?,
      time: json['time'] as int? ?? 0,
    );
  }
}

enum MissionStatus { waiting, running, paused, completed, failed }

/// A display-ready workflow assembled from chain, child-agent and decision
/// events. This is deliberately derived state: reconnect snapshots remain the
/// source of truth and the phone never invents a second workflow database.
class MissionInfo {
  final String id;
  final String? workflowId;
  final String? sessionId;
  final String? directory;
  final List<DagStep> steps;
  final List<SubAgentInfo> agents;
  final int pendingDecisions;
  final MissionStatus status;

  const MissionInfo({
    required this.id,
    this.workflowId,
    this.sessionId,
    this.directory,
    required this.steps,
    required this.agents,
    required this.pendingDecisions,
    required this.status,
  });

  int get completedSteps =>
      steps.where((step) => step.status == 'complete').length;

  static List<MissionInfo> assemble({
    required List<DagStep> steps,
    required List<SubAgentInfo> agents,
    required List<PendingPermission> permissions,
    required List<PendingQuestion> questions,
  }) {
    final groupedSteps = <String, List<DagStep>>{};
    for (final step in steps) {
      final key = _missionKey(
        workflowId: step.workflowId,
        sessionId: step.sessionId,
        directory: step.directory,
      );
      groupedSteps.putIfAbsent(key, () => []).add(step);
    }

    final missions = <MissionInfo>[];
    final assignedAgents = <String>{};
    for (final entry in groupedSteps.entries) {
      final missionSteps = entry.value;
      final first = missionSteps.first;
      final missionAgents = agents.where((agent) {
        final stepMatches =
            agent.parentStepId == null ||
            missionSteps.any((step) => step.stepId == agent.parentStepId);
        final matches =
            stepMatches &&
            agent.parentSessionId == first.sessionId &&
            (agent.directory == null ||
                first.directory == null ||
                agent.directory == first.directory);
        if (matches) assignedAgents.add(agent.sessionId);
        return matches;
      }).toList();
      missions.add(
        _build(
          id: entry.key,
          workflowId: first.workflowId,
          sessionId: first.sessionId,
          directory: first.directory,
          steps: missionSteps,
          agents: missionAgents,
          permissions: permissions,
          questions: questions,
        ),
      );
    }

    for (final agent in agents) {
      if (assignedAgents.contains(agent.sessionId)) continue;
      final sessionId = agent.parentSessionId ?? agent.sessionId;
      missions.add(
        _build(
          id: _missionKey(sessionId: sessionId, directory: agent.directory),
          sessionId: sessionId,
          directory: agent.directory,
          steps: const [],
          agents: [agent],
          permissions: permissions,
          questions: questions,
        ),
      );
    }
    return missions;
  }

  static MissionInfo _build({
    required String id,
    String? workflowId,
    String? sessionId,
    String? directory,
    required List<DagStep> steps,
    required List<SubAgentInfo> agents,
    required List<PendingPermission> permissions,
    required List<PendingQuestion> questions,
  }) {
    final relatedSessions = <String>{
      ?sessionId,
      ...agents.map((agent) => agent.sessionId),
    };
    final decisions =
        permissions
            .where((item) => relatedSessions.contains(item.sessionId))
            .length +
        questions
            .where((item) => relatedSessions.contains(item.sessionId))
            .length;
    final states = [
      ...steps.map((step) => step.status),
      ...agents.map((agent) => agent.status),
    ];
    final status =
        states.any((state) => state == 'failed' || state == 'stopped')
        ? MissionStatus.failed
        : states.any((state) => state == 'paused')
        ? MissionStatus.paused
        : decisions > 0
        ? MissionStatus.waiting
        : states.any(_isRunning)
        ? MissionStatus.running
        : states.isNotEmpty &&
              states.every((state) => state == 'complete' || state == 'done')
        ? MissionStatus.completed
        : MissionStatus.waiting;
    return MissionInfo(
      id: id,
      workflowId: workflowId,
      sessionId: sessionId,
      directory: directory,
      steps: steps,
      agents: agents,
      pendingDecisions: decisions,
      status: status,
    );
  }

  static bool _isRunning(String status) =>
      status == 'running' || status == 'in_progress' || status.endsWith('ing');

  static String _missionKey({
    String? workflowId,
    String? sessionId,
    String? directory,
  }) => workflowId ?? '${directory ?? ''}\u0000${sessionId ?? 'unassigned'}';
}

/// An option for a select-type question.
