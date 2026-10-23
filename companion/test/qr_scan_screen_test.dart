import 'package:atomcli_companion/l10n/app_localizations.dart';
import 'package:atomcli_companion/screens/qr_scan_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

void main() {
  testWidgets(
    'camera-free pairing keeps paste and retry without starting scanner',
    (tester) async {
      final messenger = tester.binding.defaultBinaryMessenger;
      const inputs = MethodChannel('io.atomcli.companion/mobile_inputs');
      const scanner = MethodChannel(
        'dev.steenbakker.mobile_scanner/scanner/method',
      );
      final scannerCalls = <String>[];
      messenger.setMockMethodCallHandler(inputs, (call) async {
        expect(call.method, 'hasCamera');
        return false;
      });
      messenger.setMockMethodCallHandler(scanner, (call) async {
        scannerCalls.add(call.method);
        return null;
      });
      messenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.getData') {
          return {'text': 'invalid pairing'};
        }
        return null;
      });
      addTearDown(() {
        messenger.setMockMethodCallHandler(inputs, null);
        messenger.setMockMethodCallHandler(scanner, null);
        messenger.setMockMethodCallHandler(SystemChannels.platform, null);
      });
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const QrScanScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(MobileScanner), findsNothing);
      expect(
        find.text('Camera unavailable. Paste a pairing code to continue.'),
        findsOneWidget,
      );
      expect(
        tester.widget<IconButton>(find.byType(IconButton)).onPressed,
        isNull,
      );
      await tester.tap(find.text('Paste pairing code'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(find.text('Paste pairing code'), findsOneWidget);
      expect(scannerCalls, isNot(contains('start')));
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );
}
