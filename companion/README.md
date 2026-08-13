# AtomCLI mobile companion

This Flutter application is the mobile companion for AtomCLI. Its package metadata and supported Dart SDK are defined in `pubspec.yaml`.

The CLI enables pairing when started with the companion network option:

```sh
atomcli serve --companion
```

That mode binds the server for pairing, creates a pairing token, and prints companion connection information. The companion app uses the bridge and pairing facilities supplied by `libs/companion/`.

Use the standard Flutter workflow from this directory:

```sh
flutter pub get
flutter test
flutter run
```
