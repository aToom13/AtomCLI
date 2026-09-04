import 'package:flutter/material.dart';

enum AppAccent { azure, violet, coral }

abstract final class AppPalette {
  static const background = Color(0xFF080B0F);
  static const surface = Color(0xFF0E141B);
  static const panel = Color(0xFF131B24);
  static const elevated = Color(0xFF19232E);
  static const stroke = Color(0xFF263442);
  static const strokeStrong = Color(0xFF38516A);
  static final accentSelection = ValueNotifier<AppAccent>(AppAccent.azure);
  static Color get primary => switch (accentSelection.value) {
    AppAccent.azure => const Color(0xFF63AFFF),
    AppAccent.violet => const Color(0xFFA78BFA),
    AppAccent.coral => const Color(0xFFFF8A70),
  };
  static Color get primarySoft => switch (accentSelection.value) {
    AppAccent.azure => const Color(0xFF173A59),
    AppAccent.violet => const Color(0xFF312552),
    AppAccent.coral => const Color(0xFF512A27),
  };
  static const mint = Color(0xFF55D6BE);
  static const amber = Color(0xFFFFBE55);
  static const danger = Color(0xFFFF6B76);
  static const text = Color(0xFFF2F6FA);
  static const textSecondary = Color(0xFFA9B7C5);
  // Keeps small secondary labels above WCAG AA contrast on `panel`.
  static const textMuted = Color(0xFF7C8B9B);

  static void selectAccent(AppAccent accent) {
    if (accentSelection.value == accent) return;
    accentSelection.value = accent;
  }
}

abstract final class AppTheme {
  static ThemeData get dark {
    final scheme = ColorScheme.dark(
      primary: AppPalette.primary,
      onPrimary: Color(0xFF04111E),
      secondary: AppPalette.mint,
      onSecondary: Color(0xFF041410),
      error: AppPalette.danger,
      onError: Colors.white,
      surface: AppPalette.surface,
      onSurface: AppPalette.text,
      outline: AppPalette.stroke,
    );

    return ThemeData(
      brightness: Brightness.dark,
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: AppPalette.background,
      canvasColor: AppPalette.background,
      dividerColor: AppPalette.stroke,
      splashColor: AppPalette.primary.withValues(alpha: 0.08),
      highlightColor: AppPalette.primary.withValues(alpha: 0.04),
      focusColor: AppPalette.primary.withValues(alpha: 0.22),
      materialTapTargetSize: MaterialTapTargetSize.padded,
      textTheme: const TextTheme(
        displaySmall: TextStyle(
          color: AppPalette.text,
          fontSize: 32,
          height: 1.05,
          fontWeight: FontWeight.w800,
          letterSpacing: -1.2,
        ),
        headlineSmall: TextStyle(
          color: AppPalette.text,
          fontSize: 22,
          height: 1.15,
          fontWeight: FontWeight.w800,
          letterSpacing: -0.6,
        ),
        titleLarge: TextStyle(
          color: AppPalette.text,
          fontSize: 18,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.3,
        ),
        titleMedium: TextStyle(
          color: AppPalette.text,
          fontSize: 15,
          fontWeight: FontWeight.w600,
        ),
        bodyLarge: TextStyle(
          color: AppPalette.text,
          fontSize: 15,
          height: 1.45,
        ),
        bodyMedium: TextStyle(
          color: AppPalette.textSecondary,
          fontSize: 13,
          height: 1.45,
        ),
        bodySmall: TextStyle(
          color: AppPalette.textMuted,
          fontSize: 11,
          height: 1.35,
        ),
        labelLarge: TextStyle(
          color: AppPalette.text,
          fontSize: 13,
          fontWeight: FontWeight.w700,
        ),
        labelSmall: TextStyle(
          color: AppPalette.textMuted,
          fontSize: 10,
          fontWeight: FontWeight.w700,
          letterSpacing: 1.2,
        ),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: AppPalette.background,
        foregroundColor: AppPalette.text,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        surfaceTintColor: Colors.transparent,
      ),
      cardTheme: CardThemeData(
        color: AppPalette.panel,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: const BorderSide(color: AppPalette.stroke),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppPalette.surface,
        hintStyle: const TextStyle(color: AppPalette.textMuted),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 14,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: AppPalette.stroke),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: AppPalette.stroke),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: AppPalette.primary, width: 1.5),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppPalette.primary,
          foregroundColor: const Color(0xFF04111E),
          minimumSize: const Size(0, 48),
          textStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(minimumSize: const Size(0, 48)),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(minimumSize: const Size.square(48)),
      ),
      navigationBarTheme: NavigationBarThemeData(
        height: 68,
        backgroundColor: AppPalette.surface,
        elevation: 0,
        indicatorColor: AppPalette.primarySoft,
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            color: selected ? AppPalette.primary : AppPalette.textMuted,
            fontSize: 10,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.2,
          );
        }),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            color: selected ? AppPalette.primary : AppPalette.textMuted,
            size: 21,
          );
        }),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: AppPalette.elevated,
        contentTextStyle: const TextStyle(color: AppPalette.text),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    );
  }
}
