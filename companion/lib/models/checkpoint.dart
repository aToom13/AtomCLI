part of '../models.dart';

class CheckpointAllowance {
  final int limit;
  final int used;
  final int extensions;
  final int toolCalls;

  const CheckpointAllowance({
    this.limit = 0,
    this.used = 0,
    this.extensions = 0,
    this.toolCalls = 0,
  });

  factory CheckpointAllowance.fromJson(Map<String, dynamic> json) {
    return CheckpointAllowance(
      limit: (json['limit'] as num?)?.toInt() ?? 0,
      used: (json['used'] as num?)?.toInt() ?? 0,
      extensions: (json['extensions'] as num?)?.toInt() ?? 0,
      toolCalls: (json['toolCalls'] as num?)?.toInt() ?? 0,
    );
  }
}

class CheckpointRuntime {
  final String executionID;
  final String reason;
  final String model;
  final CheckpointAllowance allowance;

  const CheckpointRuntime({
    this.executionID = '',
    this.reason = '',
    this.model = '',
    this.allowance = const CheckpointAllowance(),
  });

  factory CheckpointRuntime.fromJson(Map<String, dynamic> json) {
    return CheckpointRuntime(
      executionID: json['executionID'] as String? ?? '',
      reason: json['reason'] as String? ?? '',
      model: json['model'] as String? ?? '',
      allowance: json['allowance'] is Map
          ? CheckpointAllowance.fromJson(
              Map<String, dynamic>.from(json['allowance'] as Map),
            )
          : const CheckpointAllowance(),
    );
  }
}

class CheckpointData {
  final int sequence;
  final String decision;
  final int? requestedCalls;
  final int? grantedCalls;
  final String objectiveAssessment;
  final String progressSummary;
  final List<String> discoveries;
  final List<String> completedWork;
  final List<String> remainingWork;
  final List<String> failures;
  final List<String> blockers;
  final String routeAssessment;
  final String routeDecision;
  final String selfCritique;
  final List<String> failedApproaches;
  final List<String> whatToChanges;
  final List<String> nextActions;
  final CheckpointRuntime? runtime;

  const CheckpointData({
    this.sequence = 0,
    this.decision = 'continue',
    this.requestedCalls,
    this.grantedCalls,
    this.objectiveAssessment = '',
    this.progressSummary = '',
    this.discoveries = const [],
    this.completedWork = const [],
    this.remainingWork = const [],
    this.failures = const [],
    this.blockers = const [],
    this.routeAssessment = '',
    this.routeDecision = 'keep',
    this.selfCritique = '',
    this.failedApproaches = const [],
    this.whatToChanges = const [],
    this.nextActions = const [],
    this.runtime,
  });

  factory CheckpointData.fromJson(Map<String, dynamic> json) {
    List<String> strings(Object? value) =>
        value is List ? value.whereType<String>().toList() : const <String>[];
    return CheckpointData(
      sequence: (json['sequence'] as num?)?.toInt() ?? 0,
      decision: json['decision'] as String? ?? 'continue',
      requestedCalls: (json['requestedCalls'] as num?)?.toInt(),
      grantedCalls: (json['grantedCalls'] as num?)?.toInt(),
      objectiveAssessment: json['objectiveAssessment'] as String? ?? '',
      progressSummary: json['progressSummary'] as String? ?? '',
      discoveries: strings(json['discoveries']),
      completedWork: strings(json['completedWork']),
      remainingWork: strings(json['remainingWork']),
      failures: strings(json['failures']),
      blockers: strings(json['blockers']),
      routeAssessment: json['routeAssessment'] as String? ?? '',
      routeDecision: json['routeDecision'] as String? ?? 'keep',
      selfCritique: json['selfCritique'] as String? ?? '',
      failedApproaches: strings(json['failedApproaches']),
      whatToChanges: strings(json['whatToChanges']),
      nextActions: strings(json['nextActions']),
      runtime: json['runtime'] is Map
          ? CheckpointRuntime.fromJson(
              Map<String, dynamic>.from(json['runtime'] as Map),
            )
          : null,
    );
  }
}

