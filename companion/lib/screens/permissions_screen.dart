import 'package:flutter/material.dart' hide ConnectionState;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models.dart';
import '../providers/app_providers.dart';
import '../services/auth_service.dart';

/// Dedicated action-center screen for pending permission requests.
/// Displayed as a bottom sheet or full route from the home screen.
class PermissionsScreen extends ConsumerWidget {
  const PermissionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final permissions = ref.watch(permissionsProvider);
    final questions = ref.watch(questionsProvider);
    final totalCount = permissions.length + questions.length;

    return Scaffold(
      backgroundColor: const Color(0xFF0D1117),
      appBar: AppBar(
        backgroundColor: const Color(0xFF161B22),
        elevation: 0,
        title: Row(
          children: [
            const Icon(Icons.security, color: Color(0xFFFF7B72), size: 18),
            const SizedBox(width: 8),
            Text(
              'Actions${totalCount == 0 ? '' : ' ($totalCount)'}',
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
      ),
      body: totalCount == 0
          ? const _EmptyPermissions()
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // Questions section
                if (questions.isNotEmpty) ...[
                  const _SectionHeader(icon: Icons.help_outline, label: 'Questions', color: Color(0xFF79C0FF)),
                  const SizedBox(height: 8),
                  for (final q in questions)
                    _QuestionCard(
                      key: ValueKey('q_${q.reqId}'),
                      question: q,
                      onReject: () => _rejectQuestion(ref, q),
                    ),
                  const SizedBox(height: 16),
                ],
                // Permissions section
                if (permissions.isNotEmpty) ...[
                  const _SectionHeader(icon: Icons.shield_outlined, label: 'Permissions', color: Color(0xFFFF7B72)),
                  const SizedBox(height: 8),
                  for (final perm in permissions)
                    _SwipeablePermissionCard(
                      key: ValueKey(perm.reqId),
                      permission: perm,
                      onAllow: () => _resolve(ref, context, perm, 'allow'),
                      onDeny: () => _resolve(ref, context, perm, 'deny'),
                      onIntervene: () => _showInterveneModal(context, ref, perm),
                    ),
                ],
              ],
            ),
    );
  }

  void _resolve(
    WidgetRef ref,
    BuildContext context,
    PendingPermission perm,
    String resolution, {
    String? interventionParams,
  }) {
    final ws = ref.read(wsServiceProvider);
    if (ws == null) return;
    final auth = AuthService.instance;
    final payload = <String, dynamic>{
      'type': 'permission_resolve',
      'id': perm.reqId,
      'resolution': resolution,
    };
    if (interventionParams != null) {
      payload['intervention_params'] = interventionParams;
    }
    final sig = auth.sign(AuthService.canonicalPayload(payload));
    ws.resolvePermission(
      reqId: perm.reqId,
      resolution: resolution,
      deviceName: auth.deviceName ?? '',
      signature: sig,
      interventionParams: interventionParams,
    );
    ref.read(permissionsProvider.notifier).remove(perm.reqId);
  }

  Future<void> _showInterveneModal(
    BuildContext context,
    WidgetRef ref,
    PendingPermission perm,
  ) async {
    final controller = TextEditingController(
      text: perm.metadata['default_params'] as String? ?? '',
    );
    final result = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF161B22),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) =>
          _InterveneModal(permission: perm, controller: controller),
    );
    if (result != null && context.mounted) {
      _resolve(ref, context, perm, 'intervene', interventionParams: result);
    }
  }

  void _rejectQuestion(WidgetRef ref, PendingQuestion q) {
    final ws = ref.read(wsServiceProvider);
    if (ws == null) return;
    final auth = AuthService.instance;
    final payload = <String, dynamic>{
      'type': 'question_reject',
      'id': q.reqId,
    };
    final sig = auth.sign(AuthService.canonicalPayload(payload));
    ws.rejectQuestion(
      id: q.reqId,
      deviceName: auth.deviceName ?? '',
      signature: sig,
    );
    ref.read(questionsProvider.notifier).remove(q.reqId);
  }
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

class _SectionHeader extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;

  const _SectionHeader({required this.icon, required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, color: color, size: 16),
        const SizedBox(width: 6),
        Text(
          label,
          style: TextStyle(
            color: color,
            fontSize: 13,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.5,
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

class _EmptyPermissions extends StatelessWidget {
  const _EmptyPermissions();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.verified_user_rounded, color: Color(0xFF3FB950), size: 56),
          SizedBox(height: 16),
          Text(
            'No pending actions',
            style: TextStyle(color: Colors.white70, fontSize: 16),
          ),
          SizedBox(height: 8),
          Text(
            'Permission requests & questions will appear here',
            style: TextStyle(color: Colors.white38, fontSize: 13),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Swipeable permission card
// ---------------------------------------------------------------------------

class _SwipeablePermissionCard extends StatelessWidget {
  final PendingPermission permission;
  final VoidCallback onAllow;
  final VoidCallback onDeny;
  final VoidCallback onIntervene;

  const _SwipeablePermissionCard({
    super.key,
    required this.permission,
    required this.onAllow,
    required this.onDeny,
    required this.onIntervene,
  });

  @override
  Widget build(BuildContext context) {
    return Dismissible(
      key: ValueKey(permission.reqId),
      direction: DismissDirection.horizontal,
      background: _swipeHint(
        alignment: Alignment.centerLeft,
        color: const Color(0xFF238636),
        icon: Icons.check,
        label: 'Allow',
      ),
      secondaryBackground: _swipeHint(
        alignment: Alignment.centerRight,
        color: const Color(0xFFDA3633),
        icon: Icons.close,
        label: 'Deny',
      ),
      confirmDismiss: (dir) async {
        if (dir == DismissDirection.startToEnd) {
          onAllow();
          return true;
        } else {
          onDeny();
          return true;
        }
      },
      child: Card(
        color: const Color(0xFF161B22),
        margin: const EdgeInsets.only(bottom: 10),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
          side: BorderSide(
            color: const Color(0xFFFF7B72).withValues(alpha: 0.4),
            width: 1,
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header row
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFF7B72).withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(4),
                      border: Border.all(
                        color: const Color(0xFFFF7B72).withValues(alpha: 0.4),
                      ),
                    ),
                    child: Text(
                      permission.permission,
                      style: const TextStyle(
                        color: Color(0xFFFF7B72),
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  const Spacer(),
                  if (permission.sessionId.isNotEmpty)
                    Text(
                      permission.sessionId.length > 10
                          ? '…${permission.sessionId.substring(permission.sessionId.length - 6)}'
                          : permission.sessionId,
                      style: const TextStyle(
                        color: Colors.white24,
                        fontSize: 10,
                        fontFamily: 'monospace',
                      ),
                    ),
                ],
              ),
              // Patterns
              if (permission.patterns.isNotEmpty) ...[
                const SizedBox(height: 10),
                Wrap(
                  spacing: 4,
                  runSpacing: 4,
                  children: permission.patterns
                      .take(6)
                      .map(
                        (p) => Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: const Color(0xFF21262D),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            p,
                            style: const TextStyle(
                              fontSize: 11,
                              color: Colors.white60,
                              fontFamily: 'monospace',
                            ),
                          ),
                        ),
                      )
                      .toList(),
                ),
              ],
              const SizedBox(height: 12),
              // Action buttons
              Row(
                children: [
                  _ActionButton(
                    label: 'Allow',
                    icon: Icons.check_circle_outline,
                    color: const Color(0xFF238636),
                    onTap: onAllow,
                  ),
                  const SizedBox(width: 6),
                  _ActionButton(
                    label: 'Deny',
                    icon: Icons.cancel_outlined,
                    color: const Color(0xFFDA3633),
                    onTap: onDeny,
                  ),
                  const SizedBox(width: 6),
                  _ActionButton(
                    label: 'Intervene',
                    icon: Icons.edit_outlined,
                    color: const Color(0xFFFFA657),
                    onTap: onIntervene,
                    flex: 2,
                  ),
                ],
              ),
              const SizedBox(height: 6),
              const Text(
                'Swipe → Allow  |  Swipe ← Deny',
                style: TextStyle(color: Colors.white24, fontSize: 10),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _swipeHint({
    required AlignmentGeometry alignment,
    required Color color,
    required IconData icon,
    required String label,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(10),
      ),
      alignment: alignment,
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: Colors.white, size: 24),
          const SizedBox(height: 4),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Action button
// ---------------------------------------------------------------------------

class _ActionButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;
  final int flex;

  const _ActionButton({
    required this.label,
    required this.icon,
    required this.color,
    required this.onTap,
    this.flex = 1,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      flex: flex,
      child: TextButton.icon(
        style: TextButton.styleFrom(
          foregroundColor: color,
          backgroundColor: color.withValues(alpha: 0.1),
          padding: const EdgeInsets.symmetric(vertical: 8),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(6),
            side: BorderSide(color: color.withValues(alpha: 0.3)),
          ),
        ),
        onPressed: onTap,
        icon: Icon(icon, size: 15),
        label: Text(label, style: const TextStyle(fontSize: 12)),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Intervene modal
// ---------------------------------------------------------------------------

class _InterveneModal extends StatelessWidget {
  final PendingPermission permission;
  final TextEditingController controller;

  const _InterveneModal({required this.permission, required this.controller});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 24,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Handle bar
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.white24,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 20),
          const Text(
            'Intervene',
            style: TextStyle(
              color: Color(0xFFFFA657),
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Modify the operation parameters before allowing. '
            'The result will be ED25519-signed with your device key.',
            style: const TextStyle(color: Colors.white54, fontSize: 12),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: const Color(0xFF21262D),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(
              permission.permission,
              style: const TextStyle(
                color: Color(0xFFFFA657),
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: controller,
            maxLines: 4,
            style: const TextStyle(
              color: Colors.white,
              fontFamily: 'monospace',
              fontSize: 13,
            ),
            decoration: InputDecoration(
              hintText: 'Enter modified parameters (JSON or plain text)…',
              hintStyle: const TextStyle(color: Colors.white38, fontSize: 12),
              filled: true,
              fillColor: const Color(0xFF21262D),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: const BorderSide(color: Color(0xFF30363D)),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: const BorderSide(color: Color(0xFFFFA657)),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: TextButton(
                  onPressed: () => Navigator.pop(context),
                  style: TextButton.styleFrom(foregroundColor: Colors.white54),
                  child: const Text('Cancel'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                flex: 2,
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFFFFA657),
                    foregroundColor: Colors.black,
                  ),
                  onPressed: () {
                    final params = controller.text.trim();
                    Navigator.pop(context, params.isEmpty ? null : params);
                  },
                  icon: const Icon(Icons.send_rounded, size: 16),
                  label: const Text(
                    'Sign & Send',
                    style: TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Question card — renders question(s) with type-appropriate input
// ---------------------------------------------------------------------------

class _QuestionCard extends ConsumerStatefulWidget {
  final PendingQuestion question;
  final VoidCallback onReject;

  const _QuestionCard({
    super.key,
    required this.question,
    required this.onReject,
  });

  @override
  ConsumerState<_QuestionCard> createState() => _QuestionCardState();
}

class _QuestionCardState extends ConsumerState<_QuestionCard> {
  // For each question, store the user's answer(s)
  late List<List<String>> _answers;
  late List<TextEditingController> _textControllers;

  @override
  void initState() {
    super.initState();
    _answers = List.generate(widget.question.questions.length, (_) => []);
    _textControllers = List.generate(
      widget.question.questions.length,
      (i) => TextEditingController(),
    );
  }

  @override
  void dispose() {
    for (final c in _textControllers) {
      c.dispose();
    }
    super.dispose();
  }

  void _submit() {
    // Build final answers from controllers/selections
    final finalAnswers = <List<String>>[];
    for (int i = 0; i < widget.question.questions.length; i++) {
      final qi = widget.question.questions[i];
      if (qi.type == 'select') {
        // #6: Validate that at least one option is selected
        if (_answers[i].isEmpty) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Please select an option for: ${qi.header}'),
              backgroundColor: const Color(0xFFDA3633),
              behavior: SnackBarBehavior.floating,
              duration: const Duration(seconds: 3),
            ),
          );
          return;
        }
        finalAnswers.add(List<String>.from(_answers[i]));
      } else {
        // text or password
        finalAnswers.add([_textControllers[i].text]);
      }
    }

    final ws = ref.read(wsServiceProvider);
    if (ws == null) return;
    final auth = AuthService.instance;
    // CRITICAL: The server's canonicalPayload strips only 'signature'/'device_name'
    // and signs everything else. So we must include 'answers' in the signed payload
    // to match what the server will verify.
    final payload = <String, dynamic>{
      'type': 'question_reply',
      'id': widget.question.reqId,
      'answers': finalAnswers,
    };
    final sig = auth.sign(AuthService.canonicalPayload(payload));
    ws.replyQuestion(
      id: widget.question.reqId,
      answers: finalAnswers,
      deviceName: auth.deviceName ?? '',
      signature: sig,
    );
    ref.read(questionsProvider.notifier).remove(widget.question.reqId);
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFF161B22),
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(
          color: const Color(0xFF79C0FF).withValues(alpha: 0.4),
          width: 1,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: const Color(0xFF79C0FF).withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(4),
                    border: Border.all(
                      color: const Color(0xFF79C0FF).withValues(alpha: 0.4),
                    ),
                  ),
                  child: const Text(
                    'question',
                    style: TextStyle(
                      color: Color(0xFF79C0FF),
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const Spacer(),
                if (widget.question.sessionId.isNotEmpty)
                  Text(
                    widget.question.sessionId.length > 10
                        ? '…${widget.question.sessionId.substring(widget.question.sessionId.length - 6)}'
                        : widget.question.sessionId,
                    style: const TextStyle(
                      color: Colors.white24,
                      fontSize: 10,
                      fontFamily: 'monospace',
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            // Each question
            for (int i = 0; i < widget.question.questions.length; i++)
              _buildQuestionInput(i, widget.question.questions[i]),
            const SizedBox(height: 12),
            // Action buttons
            Row(
              children: [
                Expanded(
                  flex: 2,
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF238636),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(6),
                      ),
                    ),
                    onPressed: _submit,
                    icon: const Icon(Icons.send_rounded, size: 16),
                    label: const Text('Answer', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextButton.icon(
                    style: TextButton.styleFrom(
                      foregroundColor: const Color(0xFFDA3633),
                      backgroundColor: const Color(0xFFDA3633).withValues(alpha: 0.1),
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(6),
                        side: BorderSide(color: const Color(0xFFDA3633).withValues(alpha: 0.3)),
                      ),
                    ),
                    onPressed: widget.onReject,
                    icon: const Icon(Icons.close, size: 15),
                    label: const Text('Reject', style: TextStyle(fontSize: 12)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildQuestionInput(int index, QuestionInfo qi) {
    return Padding(
      padding: EdgeInsets.only(bottom: index < widget.question.questions.length - 1 ? 12 : 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Question header + text
          Text(
            qi.header,
            style: const TextStyle(
              color: Color(0xFF79C0FF),
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            qi.question,
            style: const TextStyle(color: Colors.white, fontSize: 13),
          ),
          const SizedBox(height: 8),
          // Input based on type
          if (qi.type == 'select' && qi.options.isNotEmpty)
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: qi.options.map((opt) {
                final isSelected = _answers[index].contains(opt.label);
                return FilterChip(
                  selected: isSelected,
                  label: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(opt.label, style: const TextStyle(fontSize: 12)),
                      if (opt.description.isNotEmpty)
                        Text(
                          opt.description,
                          style: const TextStyle(fontSize: 10, color: Colors.white54),
                        ),
                    ],
                  ),
                  selectedColor: const Color(0xFF79C0FF).withValues(alpha: 0.2),
                  checkmarkColor: const Color(0xFF79C0FF),
                  backgroundColor: const Color(0xFF21262D),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(6),
                    side: BorderSide(
                      color: isSelected
                          ? const Color(0xFF79C0FF).withValues(alpha: 0.6)
                          : const Color(0xFF30363D),
                    ),
                  ),
                  onSelected: (selected) {
                    setState(() {
                      if (qi.multiple) {
                        if (selected) {
                          _answers[index].add(opt.label);
                        } else {
                          _answers[index].remove(opt.label);
                        }
                      } else {
                        _answers[index] = selected ? [opt.label] : [];
                      }
                    });
                  },
                );
              }).toList(),
            )
          else
            TextField(
              controller: _textControllers[index],
              obscureText: qi.type == 'password',
              style: const TextStyle(color: Colors.white, fontSize: 13),
              decoration: InputDecoration(
                hintText: qi.placeholder ?? 'Type your answer…',
                hintStyle: const TextStyle(color: Colors.white38, fontSize: 12),
                filled: true,
                fillColor: const Color(0xFF21262D),
                contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: Color(0xFF30363D)),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: Color(0xFF79C0FF)),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
