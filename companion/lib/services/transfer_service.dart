import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart' as crypto;
import 'package:file_picker/file_picker.dart';
import 'package:flutter/services.dart';
import 'package:mime/mime.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../generated/companion_protocol.g.dart';
import '../models.dart';
import 'auth_service.dart';
import 'background_connection_service.dart';
import 'local_cache_database.dart';
import 'websocket_service.dart';

class TransferCancellation {
  bool _cancelled = false;

  bool get isCancelled => _cancelled;

  void cancel() => _cancelled = true;
}

class TransferPausedException implements Exception {
  final int transferred;
  final int total;

  const TransferPausedException(this.transferred, this.total);

  @override
  String toString() => 'Transfer paused at $transferred of $total bytes.';
}

class UploadResumeUnavailable implements Exception {
  const UploadResumeUnavailable();
}

class TransferService {
  const TransferService._();

  static const _connectionTimeout = Duration(seconds: 20);
  static const _idleTimeout = Duration(seconds: 30);
  static const _defaultChunkSize = 4 * 1024 * 1024;
  static const _partialRetention = Duration(hours: 24);
  static bool _resumingPendingUploads = false;

  static Future<CompanionArtifact?> uploadBytes({
    required WebSocketService socket,
    required String sessionId,
    required List<int> bytes,
    required String filename,
    required String mime,
    String? directory,
    void Function(int transferred, int total)? onProgress,
    TransferCancellation? cancellation,
  }) async {
    final tempDirectory = await getTemporaryDirectory();
    final file = File(
      '${tempDirectory.path}${Platform.pathSeparator}${DateTime.now().microsecondsSinceEpoch}-$filename',
    );
    await file.writeAsBytes(bytes, flush: true);
    try {
      return await _uploadFile(
        socket: socket,
        sessionId: sessionId,
        selected: PlatformFile(
          name: filename,
          size: bytes.length,
          path: file.path,
        ),
        directory: directory,
        mimeOverride: mime,
        onProgress: onProgress,
        cancellation: cancellation,
      );
    } finally {
      await file.delete().catchError((_) => file);
    }
  }

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
    TransferCancellation? cancellation,
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
        cancellation: cancellation,
      );
      if (artifact != null) {
        artifacts.add(artifact);
        onUploaded?.call(artifact);
      }
      completedSize += selected.size;
    }
    return artifacts;
  }

  static Future<CompanionArtifact?> uploadLocalFile({
    required WebSocketService socket,
    required String sessionId,
    required String path,
    required String filename,
    required int size,
    required String mime,
    String? directory,
    void Function(int transferred, int total)? onProgress,
    TransferCancellation? cancellation,
  }) => _uploadFile(
    socket: socket,
    sessionId: sessionId,
    selected: PlatformFile(name: filename, size: size, path: path),
    directory: directory,
    mimeOverride: mime,
    onProgress: onProgress,
    cancellation: cancellation,
  );

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
    String? mimeOverride,
    TransferCancellation? cancellation,
  }) async {
    final path = selected.path;
    if (path == null) {
      throw StateError(
        'Android did not grant file access. Download the item to this phone and try again.',
      );
    }
    final file = File(path);
    final size = await file.length();
    final mime =
        mimeOverride ?? lookupMimeType(path) ?? 'application/octet-stream';
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
    // The system picker briefly backgrounds the Flutter activity. It can
    // therefore start the service isolate before this Future resumes. A
    // foreground transfer must stop that isolate completely; merely pausing
    // it starts a second socket first and can lose the upload acknowledgement.
    await BackgroundConnectionService.stopAndWait();
    await socket.ensureConnected();
    final fileSha256 = await _sha256File(file);
    final ticket = await socket.createUpload(
      sessionId: sessionId,
      filename: selected.name,
      mime: mime,
      size: size,
      sha256: fileSha256,
      directory: directory,
      model: uploadModel,
      agent: agent,
      variant: uploadVariant,
    );
    if (!ticket.isOk) {
      throw StateError(ticket.error ?? 'AtomCLI rejected the upload');
    }
    final uploadPath = ticket.payload['upload_path'] as String?;
    if (uploadPath == null) {
      throw StateError('AtomCLI did not create an upload address');
    }

    onProgress?.call(0, size);
    if (socket.capabilities.contains(CompanionCapability.transfersV2)) {
      final requestedChunkSize = ticket.payload['chunk_size'] as int?;
      final chunkSize = requestedChunkSize != null && requestedChunkSize > 0
          ? requestedChunkSize.clamp(1, _defaultChunkSize)
          : _defaultChunkSize;
      final profile = AuthService.instance.activeProfile;
      PendingUploadJob? job;
      File? durableSource;
      if (profile != null) {
        final support = await getApplicationSupportDirectory();
        final stagingDirectory = Directory(
          '${support.path}${Platform.pathSeparator}pending_uploads',
        );
        await stagingDirectory.create(recursive: true);
        final ticketId = Uri.parse(uploadPath).pathSegments.last;
        durableSource = File(
          '${stagingDirectory.path}${Platform.pathSeparator}$ticketId.upload',
        );
        await file.copy(durableSource.path);
        job = PendingUploadJob(
          id: ticketId,
          profileId: profile.profileId,
          machineId: profile.machineId,
          sessionId: sessionId,
          directory: directory,
          filename: selected.name,
          mime: mime,
          size: size,
          sha256: fileSha256,
          sourcePath: durableSource.path,
          uploadPath: uploadPath,
          chunkSize: chunkSize,
          offset: ticket.payload['offset'] as int? ?? 0,
          createdAt: DateTime.now(),
          expiresAt: DateTime.fromMillisecondsSinceEpoch(
            ticket.payload['expires_at'] as int? ??
                DateTime.now().add(_partialRetention).millisecondsSinceEpoch,
          ),
        );
        await LocalCacheDatabase.instance.savePendingUpload(job);
      }
      try {
        final artifact = await _uploadChunks(
          socket: socket,
          uploadPath: uploadPath,
          file: durableSource ?? file,
          size: size,
          mime: mime,
          chunkSize: chunkSize,
          initialOffset: ticket.payload['offset'] as int? ?? 0,
          onProgress: onProgress,
          cancellation: cancellation,
          onOffset: job == null
              ? null
              : (offset) async {
                  job = job!.copyWith(offset: offset);
                  await LocalCacheDatabase.instance.savePendingUpload(job!);
                },
        );
        if (job != null) {
          await LocalCacheDatabase.instance.deletePendingUpload(job!.id);
          await durableSource?.delete().catchError((_) => durableSource!);
        }
        return artifact;
      } catch (_) {
        // The encrypted journal and app-private source are intentionally kept.
        // A later foreground connection resumes from the server's offset.
        rethrow;
      }
    }
    return _uploadLegacy(
      socket: socket,
      uploadPath: uploadPath,
      file: file,
      size: size,
      mime: mime,
      onProgress: onProgress,
    );
  }

  static Future<CompanionArtifact?> _uploadChunks({
    required WebSocketService socket,
    required String uploadPath,
    required File file,
    required int size,
    required String mime,
    required int chunkSize,
    required int initialOffset,
    void Function(int transferred, int total)? onProgress,
    Future<void> Function(int offset)? onOffset,
    TransferCancellation? cancellation,
  }) async {
    var offset = initialOffset.clamp(0, size);
    var failures = 0;
    CompanionArtifact? artifact;
    final source = await file.open();
    try {
      do {
        if (cancellation?.isCancelled == true) {
          throw TransferPausedException(offset, size);
        }
        await source.setPosition(offset);
        final bytes = await source.read((size - offset).clamp(0, chunkSize));
        try {
          final client = HttpClient()..connectionTimeout = _connectionTimeout;
          try {
            final request = await client
                .openUrl('PATCH', socket.httpUriForPath(uploadPath))
                .timeout(_connectionTimeout);
            request.contentLength = bytes.length;
            request.headers.set(HttpHeaders.contentTypeHeader, mime);
            request.headers.set('upload-offset', offset.toString());
            request.headers.set(
              'x-chunk-sha256',
              crypto.sha256.convert(bytes).toString(),
            );
            request.add(bytes);
            final response = await request.close().timeout(_connectionTimeout);
            final body = await utf8.decoder
                .bind(response.timeout(_idleTimeout))
                .join();
            if (response.statusCode < 200 || response.statusCode >= 300) {
              throw StateError(
                body.isEmpty ? 'Upload failed (${response.statusCode})' : body,
              );
            }
            final payload = body.isEmpty
                ? <String, dynamic>{}
                : Map<String, dynamic>.from(jsonDecode(body) as Map);
            final acknowledged = payload['offset'] as int?;
            if (acknowledged == null ||
                acknowledged < offset ||
                acknowledged > size) {
              throw StateError('AtomCLI returned an invalid upload offset.');
            }
            offset = acknowledged;
            await onOffset?.call(offset);
            final rawArtifact = payload['artifact'];
            if (rawArtifact is Map) {
              artifact = CompanionArtifact.fromJson(
                Map<String, dynamic>.from(rawArtifact),
              );
            }
            failures = 0;
            onProgress?.call(offset, size);
          } finally {
            client.close(force: true);
          }
        } catch (_) {
          failures++;
          if (failures > 3) rethrow;
          await socket.ensureConnected();
          offset = await _queryUploadOffset(socket, uploadPath, size);
          onProgress?.call(offset, size);
        }
      } while (offset < size || (size == 0 && artifact == null));
    } finally {
      await source.close();
    }
    if (artifact == null) {
      throw StateError('AtomCLI completed the bytes without an artifact.');
    }
    return artifact;
  }

  static Future<int> _queryUploadOffset(
    WebSocketService socket,
    String uploadPath,
    int size,
  ) async {
    final client = HttpClient()..connectionTimeout = _connectionTimeout;
    try {
      final request = await client
          .getUrl(socket.httpUriForPath(uploadPath))
          .timeout(_connectionTimeout);
      final response = await request.close().timeout(_connectionTimeout);
      final body = await utf8.decoder
          .bind(response.timeout(_idleTimeout))
          .join();
      if (response.statusCode == HttpStatus.notFound) {
        throw const UploadResumeUnavailable();
      }
      if (response.statusCode != HttpStatus.ok) {
        throw StateError('Upload can no longer be resumed.');
      }
      final payload = Map<String, dynamic>.from(jsonDecode(body) as Map);
      final offset = payload['offset'] as int?;
      final length = payload['size'] as int?;
      if (offset == null || length != size || offset < 0 || offset > size) {
        throw StateError('AtomCLI returned inconsistent resume metadata.');
      }
      return offset;
    } finally {
      client.close(force: true);
    }
  }

  static Future<List<CompanionArtifact>> resumePendingUploads({
    required WebSocketService socket,
    void Function(String filename, int transferred, int total)? onProgress,
  }) async {
    if (_resumingPendingUploads ||
        !socket.capabilities.contains(CompanionCapability.transfersV2)) {
      return const [];
    }
    final profile = AuthService.instance.activeProfile;
    if (profile == null) return const [];
    _resumingPendingUploads = true;
    final completed = <CompanionArtifact>[];
    try {
      final jobs = await LocalCacheDatabase.instance.loadPendingUploads(
        profile.profileId,
      );
      for (var job in jobs) {
        if (job.machineId != profile.machineId) continue;
        final source = File(job.sourcePath);
        if (!await source.exists()) {
          await LocalCacheDatabase.instance.deletePendingUpload(job.id);
          continue;
        }
        try {
          await socket.ensureConnected();
          int offset;
          try {
            offset = await _queryUploadOffset(socket, job.uploadPath, job.size);
          } on UploadResumeUnavailable {
            final ticket = await socket.createUpload(
              sessionId: job.sessionId,
              filename: job.filename,
              mime: job.mime,
              size: job.size,
              sha256: job.sha256,
              directory: job.directory,
            );
            final replacementPath = ticket.payload['upload_path'] as String?;
            if (replacementPath == null) continue;
            job = job.copyWith(
              uploadPath: replacementPath,
              chunkSize: ticket.payload['chunk_size'] as int? ?? job.chunkSize,
              offset: ticket.payload['offset'] as int? ?? 0,
              expiresAt: DateTime.fromMillisecondsSinceEpoch(
                ticket.payload['expires_at'] as int? ??
                    DateTime.now()
                        .add(_partialRetention)
                        .millisecondsSinceEpoch,
              ),
            );
            await LocalCacheDatabase.instance.savePendingUpload(job);
            offset = job.offset;
          }
          final artifact = await _uploadChunks(
            socket: socket,
            uploadPath: job.uploadPath,
            file: source,
            size: job.size,
            mime: job.mime,
            chunkSize: job.chunkSize.clamp(1, _defaultChunkSize),
            initialOffset: offset,
            onProgress: (transferred, total) =>
                onProgress?.call(job.filename, transferred, total),
            onOffset: (acknowledged) async {
              job = job.copyWith(offset: acknowledged);
              await LocalCacheDatabase.instance.savePendingUpload(job);
            },
          );
          if (artifact != null) completed.add(artifact);
          await LocalCacheDatabase.instance.deletePendingUpload(job.id);
          await source.delete().catchError((_) => source);
        } catch (_) {
          // A transient network/server failure keeps this job for the next
          // foreground connection. Other queued transfers may still proceed.
        }
      }
      return completed;
    } finally {
      _resumingPendingUploads = false;
    }
  }

  static Future<CompanionArtifact?> _uploadLegacy({
    required WebSocketService socket,
    required String uploadPath,
    required File file,
    required int size,
    required String mime,
    void Function(int transferred, int total)? onProgress,
  }) async {
    final client = HttpClient()..connectionTimeout = _connectionTimeout;
    var transferred = 0;
    try {
      final request = await client
          .putUrl(socket.httpUriForPath(uploadPath))
          .timeout(_connectionTimeout);
      request.contentLength = size;
      request.headers.set(HttpHeaders.contentTypeHeader, mime);
      await request.addStream(
        file.openRead().timeout(_idleTimeout).map((chunk) {
          transferred += chunk.length;
          onProgress?.call(transferred, size);
          return chunk;
        }),
      );
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
    TransferCancellation? cancellation,
  }) async {
    await BackgroundConnectionService.stopAndWait();
    await socket.ensureConnected();
    final client = HttpClient()..connectionTimeout = _connectionTimeout;
    try {
      final root = await _downloadRoot();
      final directory = Directory('${root.path}/AtomCLI');
      await directory.create(recursive: true);
      final partialDirectory = Directory('${directory.path}/.partial');
      await partialDirectory.create(recursive: true);
      await _cleanupPartialDownloads(partialDirectory);
      final partial = File(
        '${partialDirectory.path}/${_safeName(artifact.id)}.part',
      );
      var received = await partial.exists() ? await partial.length() : 0;
      if (received > artifact.size) {
        await partial.delete();
        received = 0;
      }
      if (received == artifact.size && artifact.size > 0) {
        return await _finalizeDownload(partial, directory, artifact);
      }
      final request = await client
          .getUrl(socket.httpUriForPath(artifact.downloadPath))
          .timeout(_connectionTimeout);
      if (received > 0) {
        request.headers.set(HttpHeaders.rangeHeader, 'bytes=$received-');
        final checksum = artifact.sha256;
        if (checksum != null) {
          request.headers.set('if-range', '"sha256-$checksum"');
        }
      }
      final response = await request.close().timeout(_connectionTimeout);
      if (response.statusCode != HttpStatus.ok &&
          response.statusCode != HttpStatus.partialContent) {
        await response.drain<void>();
        throw StateError('Download failed (${response.statusCode})');
      }
      if (response.statusCode == HttpStatus.ok && received > 0) {
        await partial.writeAsBytes(const [], flush: true);
        received = 0;
      } else if (response.statusCode == HttpStatus.partialContent) {
        final range = response.headers.value(HttpHeaders.contentRangeHeader);
        if (range == null || !range.startsWith('bytes $received-')) {
          await response.drain<void>();
          await partial.delete().catchError((_) => partial);
          throw StateError('AtomCLI returned an inconsistent download range.');
        }
      }
      onProgress?.call(received, artifact.size);
      final sink = partial.openWrite(mode: FileMode.append);
      try {
        await for (final chunk in response.timeout(_idleTimeout)) {
          if (cancellation?.isCancelled == true) {
            throw TransferPausedException(received, artifact.size);
          }
          sink.add(chunk);
          received += chunk.length;
          onProgress?.call(received, artifact.size);
        }
      } finally {
        await sink.close();
      }
      if (received != artifact.size) {
        throw StateError(
          'Download paused at $received of ${artifact.size} bytes; retry to resume.',
        );
      }
      return await _finalizeDownload(partial, directory, artifact);
    } finally {
      client.close();
    }
  }

  static Future<int> partialDownloadBytes(CompanionArtifact artifact) async {
    final file = await _partialDownloadFile(artifact);
    return await file.exists() ? await file.length() : 0;
  }

  static Future<void> discardPartialDownload(CompanionArtifact artifact) async {
    final file = await _partialDownloadFile(artifact);
    if (await file.exists()) await file.delete();
  }

  static Future<File> _partialDownloadFile(CompanionArtifact artifact) async {
    final root = await _downloadRoot();
    return File('${root.path}/AtomCLI/.partial/${_safeName(artifact.id)}.part');
  }

  static Future<String> _finalizeDownload(
    File partial,
    Directory directory,
    CompanionArtifact artifact,
  ) async {
    final savedSize = await partial.length();
    if (savedSize != artifact.size) {
      throw StateError('Downloaded file size did not match the transfer item.');
    }
    final expected = artifact.sha256;
    if (expected != null && expected.isNotEmpty) {
      final actual = await _sha256File(partial);
      if (actual != expected) {
        await partial.delete().catchError((_) => partial);
        throw StateError(
          'Downloaded bytes failed SHA-256 verification and were discarded.',
        );
      }
    }
    final target = await _availablePath(directory.path, artifact.name);
    return (await partial.rename(target)).path;
  }

  static Future<void> _cleanupPartialDownloads(Directory directory) async {
    final cutoff = DateTime.now().subtract(_partialRetention);
    await for (final entity in directory.list()) {
      if (entity is! File) continue;
      try {
        if ((await entity.lastModified()).isBefore(cutoff)) {
          await entity.delete();
        }
      } catch (_) {
        // A concurrent resume may own the file; leave it for the next cleanup.
      }
    }
  }

  static Future<String> _sha256File(File file) async =>
      (await crypto.sha256.bind(file.openRead()).first).toString();

  static Future<Directory> _downloadRoot() async {
    try {
      final downloads = await getDownloadsDirectory();
      if (downloads != null) return downloads;
    } on UnsupportedError {
      // Desktop test hosts and some embedders do not expose Downloads.
    } on MissingPluginException {
      // Fall through to a platform-neutral writable directory.
    }
    try {
      return await getApplicationDocumentsDirectory();
    } on UnsupportedError {
      return Directory.systemTemp;
    } on MissingPluginException {
      return Directory.systemTemp;
    }
  }

  static Future<void> downloadAndOpen({
    required WebSocketService socket,
    required CompanionArtifact artifact,
    void Function(int transferred, int total)? onProgress,
    TransferCancellation? cancellation,
  }) async {
    final path = await download(
      socket: socket,
      artifact: artifact,
      onProgress: onProgress,
      cancellation: cancellation,
    );
    final result = await OpenFilex.open(path, type: artifact.mime);
    if (result.type != ResultType.done) throw StateError(result.message);
  }

  static Future<void> share({
    required WebSocketService socket,
    required CompanionArtifact artifact,
    void Function(int transferred, int total)? onProgress,
    TransferCancellation? cancellation,
  }) async {
    final path = await download(
      socket: socket,
      artifact: artifact,
      onProgress: onProgress,
      cancellation: cancellation,
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
    final name = _safeName(rawName);
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

  static String _safeName(String rawName) {
    final sanitized = rawName.replaceAll(RegExp(r'[^a-zA-Z0-9._ -]'), '_');
    return sanitized.trim().isEmpty ? 'atomcli-download' : sanitized;
  }
}
