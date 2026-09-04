plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val atomcliReleaseKeystore = System.getenv("ATOMCLI_ANDROID_KEYSTORE_PATH")
val atomcliReleaseStorePassword = System.getenv("ATOMCLI_ANDROID_KEYSTORE_PASSWORD")
val atomcliReleaseKeyAlias = System.getenv("ATOMCLI_ANDROID_KEY_ALIAS")
val atomcliReleaseKeyPassword = System.getenv("ATOMCLI_ANDROID_KEY_PASSWORD")
val hasAtomcliReleaseSigning = listOf(
    atomcliReleaseKeystore,
    atomcliReleaseStorePassword,
    atomcliReleaseKeyAlias,
    atomcliReleaseKeyPassword,
).all { !it.isNullOrBlank() }

android {
    namespace = "io.atomcli.companion"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        // Required by flutter_local_notifications
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        applicationId = "io.atomcli.companion"
        // Minimum SDK 21 required for core library desugaring
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasAtomcliReleaseSigning) {
            create("atomcliRelease") {
                storeFile = file(atomcliReleaseKeystore!!)
                storePassword = atomcliReleaseStorePassword
                keyAlias = atomcliReleaseKeyAlias
                keyPassword = atomcliReleaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            // Local release builds remain installable for device testing. The
            // GitHub release workflow requires and injects the persistent
            // AtomCLI signing identity so published APKs stay upgradeable.
            signingConfig = if (hasAtomcliReleaseSigning) {
                signingConfigs.getByName("atomcliRelease")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}
