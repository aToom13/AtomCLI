import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:http/http.dart' as http;
import 'package:mime/mime.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models.dart';
import 'background_connection_service.dart';
import 'websocket_service.dart';

class TransferService {
  const TransferService._();

  static const _connectionTimeout = Duration(seconds: 20);
  static const _idleTimeout = Duration(seconds: 30);

  static Future<List<CompanionArtifact>> pickAndUpload({
    required WebSocketService socket,
    required String sessionId,
    String? directory,
    bool imageOnly = false,
    String? model,
    String? agent,
    String? variant,
    bool Function(String mime)? inputSupported,
    String? Function(String mime)? fallbackModel,
    void Function(String modelId, String mime)? onModelFallback,
    void Function(String mime)? onStoredWithoutModelSupport,
    void Function(int transferred, int total)? onProgress,
    void Function(CompanionArtifact artifact)? onUploaded,
    int maxFiles = 10,
  }) async {
    final picked = await FilePicker.pickFiles(
      type: imageOnly ? FileType.image : FileType.any,
      allowMultiple: true,
      withData: false,
    );
    final selections = picked?.files ?? const <PlatformFile>[];
    if (selections.isEmpty) return const [];
    if (selections.length > maxFiles) {
      throw StateError('You can stage up to $maxFiles more attachments.');
    }
    final totalSize = selections.fold<int>(0, (sum, item) => sum + item.size);
    final artifacts = <CompanionArtifact>[];
    var completedSize = 0;
    for (final selected in selections) {
      final artifact = await _uploadFile(
        socket: socket,
        sessionId: sessionId,
        selected: selected,
        directory: directory,
        model: model,
        agent: agent,
        variant: variant,
        inputSupported: inputSupported,
        fallbackModel: fallbackModel,
        onModelFallback: onModelFallback,
        onStoredWithoutModelSupport: onStoredWithoutModelSupport,
        onProgress: (transferred, _) =>
            onProgress?.call(completedSize + transferred, totalSize),
      );
      if (artifact != null) {
        artifacts.add(artifact);
        onUploaded?.call(artifact);
      }
      completedSize += selected.size;
    }
    return artifacts;
  }

  static Future<CompanionArtifact?> _uploadFile({
    required WebSocketService socket,
    required String sessionId,
    required PlatformFile selected,
    String? directory,
    String? model,
    String? agent,
    String? variant,
    bool Function(String mime)? inputSupported,
    String? Function(String mime)? fallbackModel,
    void Function(String modelId, String mime)? onModelFallback,
    void Function(String mime)? onStoredWithoutModelSupport,
    void Function(int transferred, int total)? onProgress,
  }) async {
    final path = selected.path;
    if (path == null) {
      throw StateError(
        'Android did not grant file access. Download the item to this phone and try again.',
      );
    }
    final file = File(path);
    final size = await file.length();
    final mime = lookupMimeType(path) ?? 'application/octet-stream';
    var uploadModel = model;
    var uploadVariant = variant;
    if (inputSupported?.call(mime) == false) {
      final fallback = fallbackModel?.call(mime);
      if (fallback != null) {
        uploadModel = fallback;
        uploadVariant = null;
        onModelFallback?.call(fallback, mime);
      } else {
        // Model compatibility must never prevent the actual phone-to-PC
        // transfer. The backend stores the file first and sends a text-only
        // path notification to models that cannot consume it natively.
        onStoredWithoutModelSupport?.call(mime);
      }
    }
    await BackgroundConnectionService.pauseForForeground();
    await socket.ensureConnected();
    final ticket = await socket.createUpload(
      sessionId: sessionId,
      filename: selected.name,
      mime: mime,
      size: size,
      directory: directory,
      model: uploadModel,
      agent: agent,
      variant: uploadVariant,
    );
    final uploadPath = ticket.payload['upload_path'] as String?;
    if (uploadPath == null) {
      throw StateError('AtomCLI did not create an upload address');
    }

    final client = HttpClient()..connectionTimeout = _connectionTimeout;
    var transferred = 0;
    onProgress?.call(0, size);
    try {
      final request = await client
          .putUrl(socket.httpUriForPath(uploadPath))
          .timeout(_connectionTimeout);
      request.contentLength = size;
      request.headers.set(HttpHeaders.contentTypeHeader, mime);
      final uploadStream = file.openRead().timeout(_idleTimeout).map((chunk) {
        transferred += chunk.length;
        onProgress?.call(transferred, size);
        return chunk;
      });
      await request.addStream(uploadStream);
      final response = await request.close().timeout(_connectionTimeout);
      final body = await utf8.decoder.bind(response).join();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw StateError(
          body.isEmpty ? 'Upload failed (${response.statusCode})' : body,
        );
      }
      if (body.isEmpty) return null;
      final json = jsonDecode(body) as Map<String, dynamic>;
      return CompanionArtifact.fromJson(
        Map<String, dynamic>.from(json['artifact'] as Map),
      );
    } finally {
      client.close(force: true);
    }
  }

  static Future<String> download({
    required WebSocketService socket,
    required CompanionArtifact artifact,
    void Function(int transferred, int total)? onProgress,
  }) async {
    await BackgroundConnectionService.pauseForForeground();
    await socket.ensureConnected();
    final client = http.Client();
    String? target;
    try {
      final response = await client
          .send(
            http.Request('GET', socket.httpUriForPath(artifact.downloadPath)),
          )
          .timeout(_connectionTimeout);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw StateError('Download failed (${response.statusCode})');
      }
      final root =
          await getDownloadsDirectory() ??
          await getApplicationDocumentsDirectory();
      final directory = Directory('${root.path}/AtomCLI');
      await directory.create(recursive: true);
      target = await _availablePath(directory.path, artifact.name);
      final sink = File(target).openWrite();
      final total = response.contentLength ?? artifact.size;
      var received = 0;
      onProgress?.call(0, total);
      try {
        await for (final chunk in response.stream.timeout(_idleTimeout)) {
          sink.add(chunk);
          received += chunk.length;
          onProgress?.call(received, total);
        }
      } finally {
        await sink.close();
      }
      final savedSize = await File(target).length();
      if (artifact.size > 0 && savedSize != artifact.size) {
        throw StateError(
          'Downloaded file size did not match the item sent by AtomCLI.',
        );
      }
      return target;
    } catch (_) {
      if (target != null) {
        try {
          await File(target).delete();
        } catch (_) {
          // A failed transfer should not leave a partial file when cleanup is possible.
        }
      }
      rethrow;
    } finally {
      client.close();
    }
  }

  static Future<void> downloadAndOpen({
    required WebSocketService socket,
    required CompanionArtifact artifact,
    void Function(int transferred, int total)? onProgress,
  }) async {
    final path = await download(
      socket: socket,
      artifact: artifact,
      onProgress: onProgress,
    );
    final result = await OpenFilex.open(path, type: artifact.mime);
    if (result.type != ResultType.done) throw StateError(result.message);
  }

  static Future<void> share({
    required WebSocketService socket,
    required CompanionArtifact artifact,
    void Function(int transferred, int total)? onProgress,
  }) async {
    final path = await download(
      socket: socket,
      artifact: artifact,
      onProgress: onProgress,
    );
    await SharePlus.instance.share(
      ShareParams(
        title: artifact.title,
        files: [XFile(path, mimeType: artifact.mime)],
      ),
    );
  }

  static Future<void> openPreview(String endpoint) async {
    final uri = Uri.parse(endpoint);
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      throw StateError('Could not open $endpoint');
    }
  }

  static Future<String> _availablePath(String directory, String rawName) async {
    final sanitized = rawName.replaceAll(RegExp(r'[^a-zA-Z0-9._ -]'), '_');
    final name = sanitized.trim().isEmpty ? 'atomcli-download' : sanitized;
    final dot = name.lastIndexOf('.');
    final base = dot > 0 ? name.substring(0, dot) : name;
    final extension = dot > 0 ? name.substring(dot) : '';
    var path = '$directory/$name';
    var suffix = 1;
    while (await File(path).exists()) {
      path = '$directory/$base ($suffix)$extension';
      suffix++;
    }
    return path;
  }
}
