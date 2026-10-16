part of '../models.dart';

class PendingPermission {
  final String reqId;
  final String sessionId;
  final String permission;
  final List<String> patterns;
  final List<String> always;
  final String? directory;
  final Map<String, dynamic> metadata;

  const PendingPermission({
    required this.reqId,
    required this.sessionId,
    required this.permission,
    required this.patterns,
    this.always = const [],
    this.directory,
    required this.metadata,
  });

  factory PendingPermission.fromJson(Map<String, dynamic> json) {
    return PendingPermission(
      reqId: json['req_id'] as String,
      sessionId: json['sessionID'] as String? ?? '',
      permission: json['permission'] as String,
      patterns: List<String>.from(json['patterns'] as List? ?? []),
      always: List<String>.from(json['always'] as List? ?? []),
      directory: json['directory'] as String?,
      metadata: Map<String, dynamic>.from(json['metadata'] as Map? ?? {}),
    );
  }
}

class RouteProposal {
  final String id;
  final String executionId;
  final String sessionId;
  final int version;
  final int routeRevision;
  final String scope;
  final String reasonCode;
  final int expiresAt;
  final Map<String, dynamic> fromRoute;
  final Map<String, dynamic> toRoute;
  final Map<String, dynamic> estimatedUsage;
  final bool uncertainty;
  final String? directory;

  const RouteProposal({
    required this.id,
    required this.executionId,
    required this.sessionId,
    required this.version,
    required this.routeRevision,
    required this.scope,
    required this.reasonCode,
    required this.expiresAt,
    required this.fromRoute,
    required this.toRoute,
    required this.estimatedUsage,
    required this.uncertainty,
    this.directory,
  });

  factory RouteProposal.fromJson(Map<String, dynamic> json) => RouteProposal(
    id: json['id'] as String,
    executionId: json['executionID'] as String,
    sessionId: json['sessionID'] as String? ?? '',
    version: json['version'] as int,
    routeRevision: json['routeRevision'] as int,
    scope: json['scope'] as String,
    reasonCode: json['reasonCode'] as String,
    expiresAt: json['expiresAt'] as int,
    fromRoute: Map<String, dynamic>.from(json['fromRoute'] as Map? ?? {}),
    toRoute: Map<String, dynamic>.from(json['toRoute'] as Map? ?? {}),
    estimatedUsage: Map<String, dynamic>.from(
      json['estimatedUsage'] as Map? ?? {},
    ),
    uncertainty: json['uncertainty'] == true,
    directory: json['directory'] as String?,
  );
}

/// A single todo checklist item inside a DAG step.

class QuestionOption {
  final String label;
  final String description;

  const QuestionOption({required this.label, required this.description});

  factory QuestionOption.fromJson(Map<String, dynamic> json) {
    return QuestionOption(
      label: json['label'] as String? ?? '',
      description: json['description'] as String? ?? '',
    );
  }
}

/// A single question from the question tool.
class QuestionInfo {
  final String question;
  final String header;
  final String type; // 'select', 'text', 'password'
  final String? placeholder;
  final List<QuestionOption> options;
  final bool multiple;

  const QuestionInfo({
    required this.question,
    required this.header,
    required this.type,
    this.placeholder,
    this.options = const [],
    this.multiple = false,
  });

  factory QuestionInfo.fromJson(Map<String, dynamic> json) {
    final rawOptions = json['options'] as List? ?? [];
    return QuestionInfo(
      question: json['question'] as String? ?? '',
      header: json['header'] as String? ?? '',
      type: json['type'] as String? ?? 'select',
      placeholder: json['placeholder'] as String?,
      options: rawOptions
          .map((o) => QuestionOption.fromJson(o as Map<String, dynamic>))
          .toList(),
      multiple: json['multiple'] as bool? ?? false,
    );
  }
}

/// A pending question request from the AI assistant.
class PendingQuestion {
  final String reqId;
  final String sessionId;
  final String? directory;
  final List<QuestionInfo> questions;

  const PendingQuestion({
    required this.reqId,
    required this.sessionId,
    this.directory,
    required this.questions,
  });

  factory PendingQuestion.fromJson(Map<String, dynamic> json) {
    final rawQuestions = json['questions'] as List? ?? [];
    return PendingQuestion(
      reqId: json['req_id'] as String? ?? '',
      sessionId:
          json['sessionID'] as String? ?? json['sessionId'] as String? ?? '',
      directory: json['directory'] as String?,
      questions: rawQuestions
          .map((q) => QuestionInfo.fromJson(q as Map<String, dynamic>))
          .toList(),
    );
  }
}

