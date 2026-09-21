pluginManagement {
    val flutterSdkPath =
        run {
            val properties = java.util.Properties()
            file("local.properties").inputStream().use { properties.load(it) }
            val configuredPath = properties.getProperty("flutter.sdk")
            val configuredSdk = configuredPath?.let(::file)
            val environmentPath = System.getenv("FLUTTER_ROOT")
            val flutterSdkPath = when {
                configuredSdk?.resolve("packages/flutter_tools/gradle")?.isDirectory == true -> configuredSdk.path
                environmentPath?.let(::file)?.resolve("packages/flutter_tools/gradle")?.isDirectory == true -> environmentPath
                else -> error("Flutter SDK not found. Run `flutter pub get` or set FLUTTER_ROOT.")
            }
            flutterSdkPath
        }

    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    id("com.android.application") version "8.11.1" apply false
    id("org.jetbrains.kotlin.android") version "2.2.20" apply false
}

include(":app")
