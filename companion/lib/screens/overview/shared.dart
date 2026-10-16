import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../l10n/app_localizations.dart';
import '../../models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/control_widgets.dart';

class QuietState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String body;

  const QuietState({super.key,
    required this.icon,
    required this.title,
    required this.body,
  });

  @override
  Widget build(BuildContext context) {
    return ControlPanel(
      child: Row(
        children: [
          Icon(icon, color: AppPalette.textMuted),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 3),
                Text(body, style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

String sessionDate(BuildContext context, SessionInfo session) =>
    DateFormat.yMd(Localizations.localeOf(context).toString())
        .add_Hm()
        .format(DateTime.fromMillisecondsSinceEpoch(session.updated));

String localizedExecutionStatus(AppLocalizations strings, String status) {
  return switch (status.toLowerCase()) {
    'running' || 'in_progress' || 'starting' => strings.statusLive,
    'waiting' || 'wait' => strings.statusWait,
    'paused' => strings.statusPaused,
    'complete' || 'completed' || 'done' => strings.statusDone,
    'failed' || 'fail' => strings.statusFail,
    _ => status,
  };
}
