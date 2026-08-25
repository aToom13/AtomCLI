import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models.dart';
import '../providers/app_providers.dart';
import '../theme/app_theme.dart';
import '../widgets/control_widgets.dart';

class PermissionsScreen extends ConsumerWidget {
  const PermissionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final permissions = ref.watch(permissionsProvider);
    final questions = ref.watch(questionsProvider);
    final connection = ref.watch(connectionStateProvider);
    final total = permissions.length + questions.length;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Inbox'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Center(child: ConnectionBadge(state: connection)),
          ),
        ],
      ),
      body: total == 0
          ? const _EmptyInbox()
          : ListView(
              padding: const EdgeInsets.fromLTRB(18, 8, 18, 32),
              children: [
                Text(
                  '$total decision${total == 1 ? '' : 's'} waiting',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 6),
                Text(
                  'Nothing is removed until AtomCLI confirms your action.',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                if (permissions.isNotEmpty) ...[
                  const SizedBox(height: 26),
                  const SectionLabel('Permission requests'),
                  const SizedBox(height: 10),
                  for (final permission in permissions) ...[
                    _PermissionCard(
                      key: ValueKey(permission.reqId),
                      permission: permission,
                    ),
                    const SizedBox(height: 10),
                  ],
                ],
                if (questions.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  const SectionLabel('Questions'),
                  const SizedBox(height: 10),
                  for (final question in questions) ...[
                    _QuestionCard(
                      key: ValueKey(question.reqId),
                      request: question,
                    ),
                    const SizedBox(height: 10),
                  ],
                ],
              ],
            ),
    );
  }
}

class _PermissionCard extends ConsumerStatefulWidget {
  final PendingPermission permission;

  const _PermissionCard({super.key, required this.permission});

  @override
  ConsumerState<_PermissionCard> createState() => _PermissionCardState();
}

class _PermissionCardState extends ConsumerState<_PermissionCard> {
  String? _pendingAction;

  @override
  Widget build(BuildContext context) {
    final permission = widget.permission;
    final busy = _pendingAction != null;
    return ControlPanel(
      borderColor: AppPalette.amber.withValues(alpha: 0.36),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: AppPalette.amber.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.shield_outlined,
                  color: AppPalette.amber,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      permission.permission,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    if (permission.sessionId.isNotEmpty)
                      Text(
                        _shortSession(permission.sessionId),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          fontFamily: 'monospace',
                        ),
                      ),
                  ],
                ),
              ),
              const Text(
                'REVIEW',
                style: TextStyle(
                  color: AppPalette.amber,
                  fontFamily: 'monospace',
                  fontSize: 9,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          if (permission.patterns.isNotEmpty) ...[
            const SizedBox(height: 15),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: permission.patterns
                  .map(
                    (pattern) => Container(
                      constraints: const BoxConstraints(maxWidth: 290),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 9,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: AppPalette.surface,
                        borderRadius: BorderRadius.circular(9),
                        border: Border.all(color: AppPalette.stroke),
                      ),
                      child: Text(
                        pattern,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppPalette.textSecondary,
                          fontFamily: 'monospace',
                          fontSize: 10,
                        ),
                      ),
                    ),
                  )
                  .toList(),
            ),
          ],
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: busy ? null : () => _resolve('deny'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppPalette.danger,
                    side: BorderSide(
                      color: AppPalette.danger.withValues(alpha: 0.45),
                    ),
                    minimumSize: const Size.fromHeight(46),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(13),
                    ),
                  ),
                  icon: _pendingAction == 'deny'
                      ? const _ButtonProgress()
                      : const Icon(Icons.close_rounded, size: 18),
                  label: const Text('Deny'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  onPressed: busy ? null : () => _resolve('allow'),
                  icon: _pendingAction == 'allow'
                      ? const _ButtonProgress(dark: true)
                      : const Icon(Icons.check_rounded, size: 18),
                  label: const Text('Allow once'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 9),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: busy ? null : () => _resolve('allow_always'),
                  icon: _pendingAction == 'allow_always'
                      ? const _ButtonProgress()
                      : const Icon(Icons.verified_user_outlined, size: 17),
                  label: const Text('Always allow'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: busy ? null : _confirmAutonomous,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppPalette.amber,
                  ),
                  icon: _pendingAction == 'autonomous'
                      ? const _ButtonProgress()
                      : const Icon(Icons.bolt_rounded, size: 17),
                  label: const Text('Full autonomous'),
                ),
              ),
            ],
          ),
          if (permission.always.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              'Always allow applies to: ${permission.always.join(', ')}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _resolve(String resolution) async {
    final ws = ref.read(wsServiceProvider);
    if (ws == null || !ws.isConnected) {
      _showError('AtomCLI is offline. The permission remains pending.');
      return;
    }
    setState(() => _pendingAction = resolution);
    try {
      await ws.resolvePermission(
        reqId: widget.permission.reqId,
        resolution: resolution,
        directory: widget.permission.directory,
      );
      ref.read(permissionsProvider.notifier).remove(widget.permission.reqId);
    } catch (error) {
      if (mounted) _showError(_cleanError(error));
    } finally {
      if (mounted) setState(() => _pendingAction = null);
    }
  }

  Future<void> _confirmAutonomous() async {
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: AppPalette.panel,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Enable full autonomous mode?',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 8),
              Text(
                'AtomCLI will allow subsequent tools in this session without asking again. Explicit agent safety denials remain enforced.',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(context, false),
                      child: const Text('Cancel'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      onPressed: () => Navigator.pop(context, true),
                      child: const Text('Enable'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
    if (confirmed == true) await _resolve('autonomous');
  }

  void _showError(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }
}

class _QuestionCard extends ConsumerStatefulWidget {
  final PendingQuestion request;

  const _QuestionCard({super.key, required this.request});

  @override
  ConsumerState<_QuestionCard> createState() => _QuestionCardState();
}

class _QuestionCardState extends ConsumerState<_QuestionCard> {
  late final List<List<String>> _answers;
  late final List<TextEditingController> _controllers;
  bool _submitting = false;
  bool _rejecting = false;

  @override
  void initState() {
    super.initState();
    _answers = List.generate(widget.request.questions.length, (_) => []);
    _controllers = List.generate(
      widget.request.questions.length,
      (_) => TextEditingController(),
    );
  }

  @override
  void dispose() {
    for (final controller in _controllers) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final busy = _submitting || _rejecting;
    return ControlPanel(
      borderColor: AppPalette.primary.withValues(alpha: 0.36),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: AppPalette.primarySoft,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.question_answer_outlined,
                  color: AppPalette.primary,
                  size: 19,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  widget.request.questions.length == 1
                      ? 'AtomCLI needs an answer'
                      : '${widget.request.questions.length} questions from AtomCLI',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
            ],
          ),
          const SizedBox(height: 17),
          for (
            var index = 0;
            index < widget.request.questions.length;
            index++
          ) ...[
            _QuestionInput(
              question: widget.request.questions[index],
              controller: _controllers[index],
              selected: _answers[index],
              enabled: !busy,
              onToggle: (value) => _toggleAnswer(index, value),
            ),
            if (index < widget.request.questions.length - 1)
              const SizedBox(height: 20),
          ],
          const SizedBox(height: 18),
          Row(
            children: [
              OutlinedButton(
                onPressed: busy ? null : _reject,
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppPalette.danger,
                  side: BorderSide(
                    color: AppPalette.danger.withValues(alpha: 0.4),
                  ),
                  minimumSize: const Size(90, 46),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(13),
                  ),
                ),
                child: _rejecting
                    ? const _ButtonProgress()
                    : const Text('Reject'),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  onPressed: busy ? null : _submit,
                  icon: _submitting
                      ? const _ButtonProgress(dark: true)
                      : const Icon(Icons.send_rounded, size: 17),
                  label: const Text('Send answer'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _toggleAnswer(int questionIndex, String value) {
    final question = widget.request.questions[questionIndex];
    setState(() {
      if (question.multiple) {
        if (_answers[questionIndex].contains(value)) {
          _answers[questionIndex].remove(value);
        } else {
          _answers[questionIndex].add(value);
        }
      } else {
        _answers[questionIndex] = [value];
      }
    });
  }

  Future<void> _submit() async {
    final finalAnswers = <List<String>>[];
    for (var index = 0; index < widget.request.questions.length; index++) {
      final question = widget.request.questions[index];
      if (question.type == 'select') {
        if (_answers[index].isEmpty) {
          _showError('Choose an option for ${question.header}.');
          return;
        }
        finalAnswers.add(List<String>.from(_answers[index]));
      } else {
        final value = _controllers[index].text.trim();
        if (value.isEmpty) {
          _showError('Enter an answer for ${question.header}.');
          return;
        }
        finalAnswers.add([value]);
      }
    }

    final ws = ref.read(wsServiceProvider);
    if (ws == null || !ws.isConnected) {
      _showError('AtomCLI is offline. Your answer was not sent.');
      return;
    }
    setState(() => _submitting = true);
    try {
      await ws.replyQuestion(
        id: widget.request.reqId,
        answers: finalAnswers,
        directory: widget.request.directory,
      );
      ref.read(questionsProvider.notifier).remove(widget.request.reqId);
    } catch (error) {
      if (mounted) _showError(_cleanError(error));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _reject() async {
    final ws = ref.read(wsServiceProvider);
    if (ws == null || !ws.isConnected) {
      _showError('AtomCLI is offline. The question remains pending.');
      return;
    }
    setState(() => _rejecting = true);
    try {
      await ws.rejectQuestion(
        id: widget.request.reqId,
        directory: widget.request.directory,
      );
      ref.read(questionsProvider.notifier).remove(widget.request.reqId);
    } catch (error) {
      if (mounted) _showError(_cleanError(error));
    } finally {
      if (mounted) setState(() => _rejecting = false);
    }
  }

  void _showError(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }
}

class _QuestionInput extends StatelessWidget {
  final QuestionInfo question;
  final TextEditingController controller;
  final List<String> selected;
  final bool enabled;
  final ValueChanged<String> onToggle;

  const _QuestionInput({
    required this.question,
    required this.controller,
    required this.selected,
    required this.enabled,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          question.header.toUpperCase(),
          style: Theme.of(
            context,
          ).textTheme.labelSmall?.copyWith(color: AppPalette.primary),
        ),
        const SizedBox(height: 5),
        Text(question.question, style: Theme.of(context).textTheme.bodyLarge),
        const SizedBox(height: 11),
        if (question.type == 'select')
          Wrap(
            spacing: 7,
            runSpacing: 7,
            children: question.options
                .map(
                  (option) => FilterChip(
                    selected: selected.contains(option.label),
                    onSelected: enabled ? (_) => onToggle(option.label) : null,
                    label: Text(option.label),
                    tooltip: option.description,
                    selectedColor: AppPalette.primarySoft,
                    checkmarkColor: AppPalette.primary,
                    side: const BorderSide(color: AppPalette.stroke),
                  ),
                )
                .toList(),
          )
        else
          TextField(
            controller: controller,
            enabled: enabled,
            obscureText: question.type == 'password',
            maxLines: question.type == 'password' ? 1 : 3,
            minLines: question.type == 'password' ? 1 : 1,
            decoration: InputDecoration(
              hintText: question.placeholder ?? 'Type your answer',
            ),
          ),
      ],
    );
  }
}

class _EmptyInbox extends StatelessWidget {
  const _EmptyInbox();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(34),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                color: AppPalette.mint.withValues(alpha: 0.08),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.done_all_rounded,
                color: AppPalette.mint,
                size: 30,
              ),
            ),
            const SizedBox(height: 18),
            Text(
              'Inbox clear',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 7),
            Text(
              'Permission requests and questions will arrive here.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
        ),
      ),
    );
  }
}

class _ButtonProgress extends StatelessWidget {
  final bool dark;

  const _ButtonProgress({this.dark = false});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 16,
      height: 16,
      child: CircularProgressIndicator(
        strokeWidth: 2,
        color: dark ? AppPalette.background : AppPalette.textSecondary,
      ),
    );
  }
}

String _shortSession(String value) {
  if (value.length <= 14) return value;
  return '${value.substring(0, 6)}…${value.substring(value.length - 5)}';
}

String _cleanError(Object error) => error.toString().replaceFirst(
  RegExp(r'^(Bad state|TimeoutException):\s*'),
  '',
);
