import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import '../models.dart';
import '../providers/app_providers.dart';
import '../services/auth_service.dart';
import '../services/websocket_service.dart';
import 'home_screen.dart' show chatJumpToSessionProvider;

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const _kBg = Color(0xFF0A0D13);
const _kSurface = Color(0xFF111720);
const _kCard = Color(0xFF161D28);
const _kBorder = Color(0xFF1E2A3A);
const _kAccent = Color(0xFF4F9EFF);
const _kGreen = Color(0xFF3FB950);
const _kRed = Color(0xFFFF6B6B);
const _kOrange = Color(0xFFFFA657);
const _kPurple = Color(0xFFA371F7);
const _kTextPrimary = Color(0xFFE6EDF3);
const _kTextSecondary = Color(0xFF8B949E);
const _kTextMuted = Color(0xFF484F58);

// ---------------------------------------------------------------------------
// Rich message models for display
// ---------------------------------------------------------------------------

class ChatMessage {
  final String id;
  final String sessionId;
  final String role;
  final List<ChatPart> parts;
  final DateTime time;

  ChatMessage({
    required this.id,
    required this.sessionId,
    required this.role,
    required this.parts,
    required this.time,
  });

  factory ChatMessage.fromJson(Map<String, dynamic> json) {
    final rawParts = json['parts'] as List? ?? [];
    return ChatMessage(
      id: json['id'] as String,
      sessionId: json['sessionID'] as String? ?? '',
      role: json['role'] as String? ?? 'system',
      parts: rawParts
          .map((p) => ChatPart.fromJson(p as Map<String, dynamic>))
          .where((p) => p.type != 'unknown')
          .toList(),
      time: () {
        final t = json['time'];
        if (t is Map) {
          final ts = t['created'] as int? ?? t['updated'] as int? ?? 0;
          return DateTime.fromMillisecondsSinceEpoch(ts);
        }
        return DateTime.now();
      }(),
    );
  }

  String get text =>
      parts.where((p) => p.type == 'text').map((p) => p.text ?? '').join('');

  static ChatMessage fromLogEntry(LogEntry e) => ChatMessage(
    id: e.id,
    sessionId: e.sessionId,
    role: e.role,
    parts: [ChatPart(type: 'text', text: e.message)],
    time: e.timestamp,
  );
}

class ChatPart {
  final String? id;
  final String type;
  final String? text;
  final String? toolName;
  final String? toolStatus;
  final Map<String, dynamic>? toolInput;
  final String? toolOutput;
  final String? toolError;

  ChatPart({
    this.id,
    required this.type,
    this.text,
    this.toolName,
    this.toolStatus,
    this.toolInput,
    this.toolOutput,
    this.toolError,
  });

  factory ChatPart.fromJson(Map<String, dynamic> json) {
    final type = json['type'] as String? ?? 'unknown';
    final state = json['state'] as Map<String, dynamic>?;
    return ChatPart(
      id: json['id'] as String?,
      type: type,
      text: json['text'] as String?,
      toolName: json['tool'] as String?,
      toolStatus: state?['status'] as String?,
      toolInput: state?['input'] as Map<String, dynamic>?,
      toolOutput: state?['output'] as String?,
      toolError: state?['error'] as String?,
    );
  }

  ChatPart applyDelta(ChatPart incoming, String? delta) {
    if (type != incoming.type) return incoming;
    if (type == 'text' && delta != null) {
      return ChatPart(id: id, type: type, text: (text ?? '') + delta);
    }
    return incoming;
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

final _sessionMessagesProvider =
    StateProvider.family<List<ChatMessage>, String>((ref, sessionId) => []);

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key});

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  String? _selectedSessionId;
  final TextEditingController _msgController = TextEditingController();
  final FocusNode _inputFocus = FocusNode();
  final ScrollController _scrollController = ScrollController();
  bool _isLoadingMessages = false;
  bool _isCreatingNewSession = false;
  bool _isSending = false;
  String? _selectedModel;
  String? _selectedAgent;
  bool _defaultModelInitialized = false;
  bool _autoSelectScheduled = false;
  int _loadToken = 0; // incremented on each session change to invalidate stale responses

  @override
  void dispose() {
    _msgController.dispose();
    _inputFocus.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollToBottom({bool animated = true}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      if (animated) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      } else {
        _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
      }
    });
  }

  void _loadMessages(String sessionId) {
    final ws = ref.read(wsServiceProvider);
    if (ws == null) {
      setState(() => _isLoadingMessages = false);
      return;
    }
    // Capture token at call time — if session changes before response arrives,
    // the messages_result handler will see a different token and discard stale data.
    final myToken = _loadToken;
    setState(() => _isLoadingMessages = true);
    ws.getMessages(sessionId: sessionId);
    // 8s fallback in case messages_result never arrives (e.g. network error)
    Future.delayed(const Duration(seconds: 8), () {
      if (mounted && _loadToken == myToken) {
        setState(() => _isLoadingMessages = false);
      }
    });
  }

  void _onSessionChanged(String? sessionId) {
    if (sessionId == null) return;
    // Invalidate any in-flight getMessages from a previous session
    _loadToken++;
    setState(() {
      _selectedSessionId = sessionId;
      _isLoadingMessages = false; // will be set true inside _loadMessages
    });
    ref.read(_sessionMessagesProvider(sessionId).notifier).state = [];
    _loadMessages(sessionId);
    Future.delayed(const Duration(milliseconds: 200), _scrollToBottom);
  }

  void _sendMessage() {
    final text = _msgController.text.trim();
    if (text.isEmpty || _isSending) return;

    HapticFeedback.lightImpact();

    final ws = ref.read(wsServiceProvider);
    if (ws == null) return;

    final auth = AuthService.instance;

    if (_selectedSessionId == null) {
      _createNewSession(text: text);
      _msgController.clear();
      return;
    }

    setState(() => _isSending = true);

    final payload = <String, dynamic>{
      'type': 'chat_message',
      'session_id': _selectedSessionId!,
      'text': text,
      'model': _selectedModel,
      'agent': _selectedAgent,
    }..removeWhere((_, v) => v == null);
    final sig = auth.sign(AuthService.canonicalPayload(payload));

    ws.sendChatMessage(
      sessionId: _selectedSessionId!,
      text: text,
      deviceName: auth.deviceName ?? 'companion',
      signature: sig,
      model: _selectedModel,
      agent: _selectedAgent,
    );

    final msg = ChatMessage(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      sessionId: _selectedSessionId!,
      role: 'user',
      parts: [ChatPart(type: 'text', text: text)],
      time: DateTime.now(),
    );
    ref
        .read(_sessionMessagesProvider(_selectedSessionId!).notifier)
        .update((list) => [...list, msg]);

    _msgController.clear();
    _scrollToBottom();

    // Keep send disabled for 2s to prevent double-tap. The guard is long enough
    // to cover network RTT but short enough to not feel sluggish.
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) setState(() => _isSending = false);
    });
  }

  void _createNewSession({String? text}) {
    if (text == null) {
      setState(() {
        _selectedSessionId = null;
        _isLoadingMessages = true;
        _isCreatingNewSession = true;
      });
    }

    final ws = ref.read(wsServiceProvider);
    if (ws == null) return;

    final auth = AuthService.instance;
    final payload = <String, dynamic>{
      'type': 'create_session',
      if (text != null && text.isNotEmpty) 'text': text,
      'model': _selectedModel,
      'agent': _selectedAgent,
    }..removeWhere((_, v) => v == null);
    final sig = auth.sign(AuthService.canonicalPayload(payload));

    ws.createSession(
      deviceName: auth.deviceName ?? 'companion',
      signature: sig,
      text: text,
      model: _selectedModel,
      agent: _selectedAgent,
    );
  }

  void _showAgentPicker() {
    final agents = ref.read(agentsListProvider);
    _showPickerSheet(
      title: 'Select Agent',
      accentColor: _kPurple,
      items: agents
          .map(
            (a) => _PickerItem(
              id: a.name,
              title: a.name,
              subtitle: a.description ?? 'No description',
              isSelected:
                  a.name == _selectedAgent ||
                  (_selectedAgent == null && a.name == 'agent'),
            ),
          )
          .toList(),
      emptyMessage: 'No agents available',
      onSelect: (id) => setState(() => _selectedAgent = id),
    );
  }

  void _showModelPicker() {
    final allModels = ref.read(modelsListProvider);
    final defaultModel = ref.read(defaultModelProvider);
    _showPickerSheet(
      title: 'Select Model',
      accentColor: _kAccent,
      items: allModels
          .map(
            (m) => _PickerItem(
              id: m.id,
              title: m.name,
              subtitle: m.providerName,
              isSelected: m.id == (_selectedModel ?? defaultModel),
            ),
          )
          .toList(),
      emptyMessage: 'No models available',
      onSelect: (id) => setState(() => _selectedModel = id),
      searchable: true,
    );
  }

  void _showPickerSheet({
    required String title,
    required Color accentColor,
    required List<_PickerItem> items,
    required String emptyMessage,
    required void Function(String) onSelect,
    bool searchable = false,
  }) {
    showModalBottomSheet(
      context: context,
      backgroundColor: _kCard,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => _PickerSheet(
        title: title,
        accentColor: accentColor,
        items: items,
        emptyMessage: emptyMessage,
        onSelect: onSelect,
        searchable: searchable,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final sessionInfos = ref.watch(sessionListProvider);

    // Initialize default model on first load (issue 3 fix)
    if (!_defaultModelInitialized) {
      final defaultModel = ref.watch(defaultModelProvider);
      if (defaultModel != null && _selectedModel == null) {
        _defaultModelInitialized = true;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) setState(() => _selectedModel = defaultModel);
        });
      }
    }

    // #12: Auto-select first session only once, guard against repeated scheduling
    if (_selectedSessionId == null &&
        sessionInfos.isNotEmpty &&
        !_isCreatingNewSession &&
        !_autoSelectScheduled) {
      _autoSelectScheduled = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _selectedSessionId == null) {
          _onSessionChanged(sessionInfos.first.id);
        }
        _autoSelectScheduled = false;
      });
    }

    final sessionMessages = _selectedSessionId != null
        ? ref.watch(_sessionMessagesProvider(_selectedSessionId!))
        : <ChatMessage>[];

    final hasValidSelection = sessionInfos.any(
      (s) => s.id == _selectedSessionId,
    );

    // Listen to backend events
    ref.listen<AsyncValue<BackendEvent>>(backendEventStreamProvider, (_, next) {
      next.whenData((event) {
        if (event.type == 'messages_result') {
          final sid = event.payload['session_id'] as String?;
          if (sid != _selectedSessionId) return; // stale result for wrong session
          // Check load token — if user switched session since request was sent, discard
          // (We can't attach token to server response, so we just check current session matches)
          final rawMsgs = event.payload['messages'] as List? ?? [];
          final msgs = rawMsgs
              .map((m) => ChatMessage.fromJson(m as Map<String, dynamic>))
              .where((m) => m.parts.isNotEmpty || m.role == 'user')
              .toList();
          if (mounted) {
            ref.read(_sessionMessagesProvider(sid!).notifier).state = msgs;
            setState(() => _isLoadingMessages = false);
            _scrollToBottom();
          }
        }

        if (event.type == 'message_part') {
          if (_selectedSessionId == null) return;
          final part = event.payload['part'] as Map<String, dynamic>?;
          if (part == null) return;
          final partSessionId = part['sessionID'] as String?;
          if (partSessionId != _selectedSessionId) return;

          final messageId = part['messageID'] as String?;
          final partId = part['id'] as String?;
          final newPart = ChatPart.fromJson(part);
          final delta = event.payload['delta'] as String?;

          final sid = _selectedSessionId!;
          final current = ref.read(_sessionMessagesProvider(sid));
          final existingIdx = current.indexWhere((m) => m.id == messageId);

          if (existingIdx >= 0) {
            final msg = current[existingIdx];
            final existingPartIdx = partId != null
                ? msg.parts.indexWhere((p) => p.id == partId)
                : msg.parts.indexWhere((p) => p.type == newPart.type);
            List<ChatPart> newParts;
            if (existingPartIdx >= 0) {
              newParts = [...msg.parts];
              final ep = newParts[existingPartIdx];
              if (delta != null && newPart.type == 'text') {
                newParts[existingPartIdx] = ChatPart(
                  id: ep.id,
                  type: ep.type,
                  text: (ep.text ?? '') + delta,
                );
              } else {
                newParts[existingPartIdx] = newPart;
              }
            } else {
              newParts = [...msg.parts, newPart];
            }
            final updated = [...current];
            updated[existingIdx] = ChatMessage(
              id: msg.id,
              sessionId: msg.sessionId,
              role: msg.role,
              parts: newParts,
              time: msg.time,
            );
            ref.read(_sessionMessagesProvider(sid).notifier).state = updated;
          } else if (messageId != null) {
            final newMsg = ChatMessage(
              id: messageId,
              sessionId: sid,
              role: 'assistant',
              parts: [newPart],
              time: DateTime.now(),
            );
            ref
                .read(_sessionMessagesProvider(sid).notifier)
                .update((list) => [...list, newMsg]);
          }
          _scrollToBottom();
        }

        // #4: Handle message_updated — update role/info of an existing message
        if (event.type == 'message_updated') {
          if (_selectedSessionId == null) return;
          final info = event.payload['info'] as Map<String, dynamic>?;
          if (info == null) return;
          final messageId = info['id'] as String?;
          if (messageId == null) return;
          final sid = _selectedSessionId!;
          final current = ref.read(_sessionMessagesProvider(sid));
          final idx = current.indexWhere((m) => m.id == messageId);
          if (idx >= 0 && mounted) {
            // Re-load messages to get the updated state
            _loadMessages(sid);
          }
        }

        if (event.type == 'session_created') {
          final newSid = event.payload['session_id'] as String?;
          if (newSid != null && mounted) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              _onSessionChanged(newSid);
              setState(() => _isCreatingNewSession = false);
            });
          }
        }

        // Issue 1 fix: Show error snackbar when prompt fails
        if (event.type == 'prompt_error') {
          final errMsg =
              event.payload['message'] as String? ??
              'Server error — check your model configuration.';
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Row(
                  children: [
                    const Icon(
                      Icons.error_outline_rounded,
                      color: Colors.white,
                      size: 18,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        errMsg,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  ],
                ),
                backgroundColor: _kRed,
                behavior: SnackBarBehavior.floating,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
                margin: const EdgeInsets.all(12),
                duration: const Duration(seconds: 5),
              ),
            );
            setState(() => _isSending = false);
          }
        }
      });
    });

    // Cross-tab navigation: when Workflow sub-agent card is tapped, jump to its session
    ref.listen<String?>(chatJumpToSessionProvider, (_, sessionId) {
      if (sessionId != null && mounted) {
        _onSessionChanged(sessionId);
        // Clear after consuming
        WidgetsBinding.instance.addPostFrameCallback((_) {
          ref.read(chatJumpToSessionProvider.notifier).state = null;
        });
      }
    });

    // Resolve display info for selected model / agent
    final allModels = ref.watch(modelsListProvider);
    final defaultModel = ref.watch(defaultModelProvider);
    final effectiveModel = _selectedModel ?? defaultModel;
    final modelLabel = effectiveModel != null
        ? (allModels
              .firstWhere(
                (m) => m.id == effectiveModel,
                orElse: () => ModelInfo(
                  id: effectiveModel,
                  name: effectiveModel.split('/').last,
                  providerName: '',
                ),
              )
              .name)
        : 'Auto';

    return Scaffold(
      backgroundColor: _kBg,
      appBar: AppBar(
        backgroundColor: _kSurface,
        elevation: 0,
        titleSpacing: 0,
        title: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              dropdownColor: _kCard,
              isExpanded: true,
              hint: const Text(
                'No active session',
                style: TextStyle(color: _kTextMuted, fontSize: 14),
              ),
              value: hasValidSelection ? _selectedSessionId : null,
              items: sessionInfos.map((s) {
                final label = s.title
                    .replaceAll('New session - ', '')
                    .replaceAll('Child session - ', '')
                    .trim();
                return DropdownMenuItem(
                  value: s.id,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        label.isEmpty ? s.id.substring(0, 20) : label,
                        style: const TextStyle(
                          color: _kTextPrimary,
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        s.formattedDate,
                        style: const TextStyle(
                          color: _kTextMuted,
                          fontSize: 10,
                        ),
                      ),
                    ],
                  ),
                );
              }).toList(),
              onChanged: _onSessionChanged,
              icon: const Icon(Icons.expand_more, color: _kTextMuted, size: 18),
            ),
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.add_comment_rounded),
            color: _kAccent,
            tooltip: 'New Session',
            onPressed: _createNewSession,
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(height: 1, color: _kBorder),
        ),
      ),
      body: Column(
        children: [
          // Chain/DAG panel (collapsible, shown when workflow is active)
          _ChainPanel(),

          // Message list
          Expanded(
            child: _isLoadingMessages
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        SizedBox(
                          width: 32,
                          height: 32,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: _kAccent,
                          ),
                        ),
                        const SizedBox(height: 12),
                        const Text(
                          'Loading messages…',
                          style: TextStyle(color: _kTextMuted, fontSize: 12),
                        ),
                      ],
                    ),
                  )
                : sessionMessages.isEmpty
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: 64,
                          height: 64,
                          decoration: BoxDecoration(
                            color: _kCard,
                            shape: BoxShape.circle,
                            border: Border.all(color: _kBorder),
                          ),
                          child: const Icon(
                            Icons.chat_bubble_outline_rounded,
                            color: _kTextMuted,
                            size: 26,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          _selectedSessionId == null
                              ? 'Select or create a session'
                              : 'No messages yet',
                          style: const TextStyle(
                            color: _kTextSecondary,
                            fontSize: 15,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        if (_selectedSessionId != null) ...[
                          const SizedBox(height: 6),
                          const Text(
                            'Send a message below to start',
                            style: TextStyle(color: _kTextMuted, fontSize: 12),
                          ),
                        ],
                      ],
                    ),
                  )
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 12,
                    ),
                    itemCount: sessionMessages.length,
                    itemBuilder: (context, index) {
                      final msg = sessionMessages[index];
                      return _MessageBubble(message: msg);
                    },
                  ),
          ),

          // Bottom input bar
          Container(
            decoration: BoxDecoration(
              color: _kSurface,
              border: const Border(top: BorderSide(color: _kBorder)),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.3),
                  blurRadius: 12,
                  offset: const Offset(0, -4),
                ),
              ],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Model / agent selector row
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                  child: Row(
                    children: [
                      _SelectorChip(
                        icon: Icons.psychology_rounded,
                        label: modelLabel,
                        color: _kAccent,
                        onTap: _showModelPicker,
                      ),
                      const SizedBox(width: 6),
                      _SelectorChip(
                        icon: Icons.people_outline,
                        label: _selectedAgent ?? 'Agent',
                        color: _kPurple,
                        onTap: _showAgentPicker,
                      ),
                    ],
                  ),
                ),
                // Input row
                Padding(
                  padding: EdgeInsets.only(
                    left: 12,
                    right: 8,
                    top: 8,
                    bottom: MediaQuery.of(context).viewInsets.bottom + 10,
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Expanded(
                        child: Container(
                          decoration: BoxDecoration(
                            color: _kCard,
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(color: _kBorder),
                          ),
                          child: TextField(
                            controller: _msgController,
                            focusNode: _inputFocus,
                            style: const TextStyle(
                              color: _kTextPrimary,
                              fontSize: 14,
                              height: 1.4,
                            ),
                            maxLines: 5,
                            minLines: 1,
                            textInputAction: TextInputAction.newline,
                            decoration: const InputDecoration(
                              hintText: 'Message the agent…',
                              hintStyle: TextStyle(
                                color: _kTextMuted,
                                fontSize: 14,
                              ),
                              border: InputBorder.none,
                              contentPadding: EdgeInsets.symmetric(
                                horizontal: 14,
                                vertical: 10,
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      // Send button
                      GestureDetector(
                        onTap: _isSending ? null : _sendMessage,
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 200),
                          width: 42,
                          height: 42,
                          decoration: BoxDecoration(
                            color: _isSending ? _kTextMuted : _kAccent,
                            borderRadius: BorderRadius.circular(12),
                            boxShadow: _isSending
                                ? null
                                : [
                                    BoxShadow(
                                      color: _kAccent.withValues(alpha: 0.35),
                                      blurRadius: 12,
                                      spreadRadius: 0,
                                    ),
                                  ],
                          ),
                          child: Icon(
                            _isSending
                                ? Icons.hourglass_top_rounded
                                : Icons.arrow_upward_rounded,
                            color: Colors.white,
                            size: 20,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Chain / DAG panel (collapsible, shown in chat when workflow is active)
// ---------------------------------------------------------------------------

class _ChainPanel extends ConsumerStatefulWidget {
  const _ChainPanel();

  @override
  ConsumerState<_ChainPanel> createState() => _ChainPanelState();
}

class _ChainPanelState extends ConsumerState<_ChainPanel>
    with SingleTickerProviderStateMixin {
  bool _expanded = true;
  late final AnimationController _anim;
  late final Animation<double> _arrow;

  @override
  void initState() {
    super.initState();
    _anim = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 220),
      value: 1.0,
    );
    _arrow = CurvedAnimation(parent: _anim, curve: Curves.easeOut);
  }

  @override
  void dispose() {
    _anim.dispose();
    super.dispose();
  }

  void _toggle() {
    setState(() => _expanded = !_expanded);
    if (_expanded) {
      _anim.forward();
    } else {
      _anim.reverse();
    }
  }

  @override
  Widget build(BuildContext context) {
    final dagSteps = ref.watch(dagProvider);
    if (dagSteps.isEmpty) return const SizedBox.shrink();

    final running = dagSteps.where((s) => s.status == 'running').length;
    final complete = dagSteps.where((s) => s.status == 'complete').length;

    return Container(
      decoration: BoxDecoration(
        color: _kSurface,
        border: const Border(
          bottom: BorderSide(color: _kBorder),
          top: BorderSide(color: _kBorder),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Header row
          InkWell(
            onTap: _toggle,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              child: Row(
                children: [
                  const Icon(Icons.account_tree, size: 13, color: _kAccent),
                  const SizedBox(width: 6),
                  const Text(
                    'WORKFLOW',
                    style: TextStyle(
                      color: _kAccent,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.1,
                    ),
                  ),
                  const SizedBox(width: 8),
                  if (running > 0)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 1,
                      ),
                      decoration: BoxDecoration(
                        color: _kOrange.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(
                          color: _kOrange.withValues(alpha: 0.3),
                        ),
                      ),
                      child: Text(
                        '$running running',
                        style: const TextStyle(
                          color: _kOrange,
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  if (running > 0) const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 1,
                    ),
                    decoration: BoxDecoration(
                      color: _kCard,
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(color: _kBorder),
                    ),
                    child: Text(
                      '$complete/${dagSteps.length}',
                      style: const TextStyle(
                        color: _kTextSecondary,
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  const Spacer(),
                  RotationTransition(
                    turns: Tween<double>(begin: 0.5, end: 0.0).animate(_arrow),
                    child: const Icon(
                      Icons.keyboard_arrow_up,
                      size: 16,
                      color: _kTextMuted,
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Steps list (collapses)
          SizeTransition(
            sizeFactor: _arrow,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 200),
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(14, 0, 14, 10),
                child: Column(
                  children: dagSteps.map((step) {
                    final isRunning = step.status == 'running';
                    final statusColor = switch (step.status) {
                      'complete' => _kGreen,
                      'failed' => _kRed,
                      'running' => _kOrange,
                      _ => _kTextMuted,
                    };
                    final icon = switch (step.status) {
                      'complete' => Icons.check_circle_rounded,
                      'failed' => Icons.cancel_rounded,
                      'running' => Icons.radio_button_checked,
                      _ => Icons.radio_button_unchecked,
                    };

                    return Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(icon, size: 12, color: statusColor),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  step.name,
                                  style: TextStyle(
                                    color: isRunning
                                        ? _kTextPrimary
                                        : _kTextSecondary,
                                    fontSize: 12,
                                    fontWeight: isRunning
                                        ? FontWeight.w600
                                        : FontWeight.normal,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              if (isRunning)
                                Container(
                                  width: 6,
                                  height: 6,
                                  decoration: BoxDecoration(
                                    color: _kOrange,
                                    shape: BoxShape.circle,
                                    boxShadow: [
                                      BoxShadow(
                                        color: _kOrange.withValues(alpha: 0.6),
                                        blurRadius: 6,
                                      ),
                                    ],
                                  ),
                                ),
                            ],
                          ),
                          if (step.todos.isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(left: 18, top: 3),
                              child: Column(
                                children: step.todos.map((todo) {
                                  final isDone = todo.status == 'complete';
                                  return Padding(
                                    padding: const EdgeInsets.only(bottom: 2),
                                    child: Row(
                                      children: [
                                        Icon(
                                          isDone
                                              ? Icons.check_box_rounded
                                              : Icons
                                                    .check_box_outline_blank_rounded,
                                          size: 11,
                                          color: isDone ? _kGreen : _kTextMuted,
                                        ),
                                        const SizedBox(width: 5),
                                        Expanded(
                                          child: Text(
                                            todo.content,
                                            style: TextStyle(
                                              color: isDone
                                                  ? _kTextMuted
                                                  : _kTextSecondary,
                                              fontSize: 11,
                                              decoration: isDone
                                                  ? TextDecoration.lineThrough
                                                  : null,
                                            ),
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                        ),
                                      ],
                                    ),
                                  );
                                }).toList(),
                              ),
                            ),
                        ],
                      ),
                    );
                  }).toList(),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Selector chip (model/agent)
// ---------------------------------------------------------------------------

class _SelectorChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;
  const _SelectorChip({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: color.withValues(alpha: 0.2)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: color, size: 12),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                color: color,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(width: 2),
            Icon(Icons.keyboard_arrow_down, color: color, size: 13),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Picker sheet
// ---------------------------------------------------------------------------

class _PickerItem {
  final String id;
  final String title;
  final String subtitle;
  final bool isSelected;
  const _PickerItem({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.isSelected,
  });
}

class _PickerSheet extends StatefulWidget {
  final String title;
  final Color accentColor;
  final List<_PickerItem> items;
  final String emptyMessage;
  final void Function(String) onSelect;
  final bool searchable;

  const _PickerSheet({
    required this.title,
    required this.accentColor,
    required this.items,
    required this.emptyMessage,
    required this.onSelect,
    this.searchable = false,
  });

  @override
  State<_PickerSheet> createState() => _PickerSheetState();
}

class _PickerSheetState extends State<_PickerSheet> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final filtered = _query.isEmpty
        ? widget.items
        : widget.items
              .where(
                (i) =>
                    i.title.toLowerCase().contains(_query.toLowerCase()) ||
                    i.subtitle.toLowerCase().contains(_query.toLowerCase()),
              )
              .toList();

    return DraggableScrollableSheet(
      initialChildSize: 0.55,
      minChildSize: 0.35,
      maxChildSize: 0.9,
      expand: false,
      builder: (_, controller) => Column(
        children: [
          // Handle
          const SizedBox(height: 10),
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: _kBorder,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 14),
          // Title
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 18),
            child: Row(
              children: [
                Text(
                  widget.title,
                  style: TextStyle(
                    color: widget.accentColor,
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          if (widget.searchable)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              child: TextField(
                style: const TextStyle(color: _kTextPrimary, fontSize: 13),
                autofocus: false,
                decoration: InputDecoration(
                  hintText: 'Search…',
                  hintStyle: const TextStyle(color: _kTextMuted),
                  prefixIcon: const Icon(
                    Icons.search,
                    color: _kTextMuted,
                    size: 18,
                  ),
                  filled: true,
                  fillColor: _kSurface,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: _kBorder),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: _kBorder),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: BorderSide(color: widget.accentColor),
                  ),
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(vertical: 8),
                ),
                onChanged: (val) => setState(() => _query = val),
              ),
            ),
          const Divider(color: _kBorder, height: 1),
          if (filtered.isEmpty)
            Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                widget.emptyMessage,
                style: const TextStyle(color: _kTextMuted, fontSize: 13),
              ),
            )
          else
            Expanded(
              child: ListView.builder(
                controller: controller,
                itemCount: filtered.length,
                itemBuilder: (_, index) {
                  final item = filtered[index];
                  return ListTile(
                    dense: true,
                    leading: Container(
                      width: 20,
                      height: 20,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: item.isSelected
                            ? widget.accentColor
                            : Colors.transparent,
                        border: Border.all(
                          color: item.isSelected
                              ? widget.accentColor
                              : _kBorder,
                          width: 1.5,
                        ),
                      ),
                      child: item.isSelected
                          ? const Icon(
                              Icons.check,
                              size: 12,
                              color: Colors.white,
                            )
                          : null,
                    ),
                    title: Text(
                      item.title,
                      style: TextStyle(
                        color: item.isSelected
                            ? widget.accentColor
                            : _kTextPrimary,
                        fontSize: 13,
                        fontWeight: item.isSelected
                            ? FontWeight.w700
                            : FontWeight.normal,
                      ),
                    ),
                    subtitle: Text(
                      item.subtitle,
                      style: const TextStyle(color: _kTextMuted, fontSize: 11),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    onTap: () {
                      widget.onSelect(item.id);
                      Navigator.pop(context);
                    },
                  );
                },
              ),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Message Bubble
// ---------------------------------------------------------------------------

class _MessageBubble extends StatelessWidget {
  final ChatMessage message;
  const _MessageBubble({required this.message});

  @override
  Widget build(BuildContext context) {
    final msg = message;
    final isUser = msg.role == 'user';

    final textParts = msg.parts.where((p) => p.type == 'text').toList();
    final reasoningParts = msg.parts
        .where((p) => p.type == 'reasoning')
        .toList();
    final toolParts = msg.parts.where((p) => p.type == 'tool').toList();

    final timeStr = DateFormat('HH:mm').format(msg.time);

    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: isUser
            ? CrossAxisAlignment.end
            : CrossAxisAlignment.start,
        children: [
          // Time + role header
          Padding(
            padding: EdgeInsets.only(
              bottom: 5,
              left: isUser ? 0 : 4,
              right: isUser ? 4 : 0,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (!isUser) ...[
                  Container(
                    width: 16,
                    height: 16,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [_kAccent, _kPurple],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: const Icon(
                      Icons.smart_toy,
                      color: Colors.white,
                      size: 10,
                    ),
                  ),
                  const SizedBox(width: 5),
                ],
                Text(
                  isUser
                      ? 'You'
                      : msg.role == 'system'
                      ? 'System'
                      : 'Agent',
                  style: TextStyle(
                    color: isUser ? _kAccent : _kGreen,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(width: 5),
                Text(
                  timeStr,
                  style: const TextStyle(color: _kTextMuted, fontSize: 10),
                ),
              ],
            ),
          ),

          // Reasoning
          if (reasoningParts.isNotEmpty)
            _ReasoningBlock(
              text: reasoningParts.map((p) => p.text ?? '').join(''),
            ),

          // Tool calls
          if (toolParts.isNotEmpty)
            ...toolParts.map((p) => _ToolBlock(part: p)),

          // Text bubble
          if (textParts.isNotEmpty)
            Container(
              constraints: BoxConstraints(
                maxWidth: MediaQuery.of(context).size.width * 0.82,
              ),
              decoration: BoxDecoration(
                gradient: isUser
                    ? const LinearGradient(
                        colors: [Color(0xFF1A3A6B), Color(0xFF142E5A)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      )
                    : null,
                color: isUser ? null : _kCard,
                borderRadius: BorderRadius.circular(14).copyWith(
                  bottomRight: isUser ? Radius.zero : const Radius.circular(14),
                  topLeft: !isUser ? Radius.zero : const Radius.circular(14),
                ),
                border: Border.all(
                  color: isUser ? _kAccent.withValues(alpha: 0.3) : _kBorder,
                ),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.2),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              child: MarkdownBody(
                data: textParts.map((p) => p.text ?? '').join(''),
                selectable: true,
                styleSheet: MarkdownStyleSheet(
                  p: const TextStyle(
                    color: _kTextPrimary,
                    fontSize: 14,
                    height: 1.5,
                  ),
                  code: const TextStyle(
                    backgroundColor: Color(0xFF0D1117),
                    color: _kAccent,
                    fontFamily: 'monospace',
                    fontSize: 12,
                  ),
                  codeblockDecoration: BoxDecoration(
                    color: const Color(0xFF0D1117),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: _kBorder),
                  ),
                  blockquoteDecoration: BoxDecoration(
                    color: _kSurface,
                    border: const Border(
                      left: BorderSide(color: _kAccent, width: 3),
                    ),
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Reasoning block
// ---------------------------------------------------------------------------

class _ReasoningBlock extends StatefulWidget {
  final String text;
  const _ReasoningBlock({required this.text});

  @override
  State<_ReasoningBlock> createState() => _ReasoningBlockState();
}

class _ReasoningBlockState extends State<_ReasoningBlock> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => setState(() => _expanded = !_expanded),
      child: Container(
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: _kPurple.withValues(alpha: 0.06),
          border: Border.all(color: _kPurple.withValues(alpha: 0.2)),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(
                  Icons.psychology_outlined,
                  size: 13,
                  color: _kPurple,
                ),
                const SizedBox(width: 5),
                const Text(
                  'Reasoning',
                  style: TextStyle(
                    color: _kPurple,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const Spacer(),
                Icon(
                  _expanded
                      ? Icons.keyboard_arrow_up
                      : Icons.keyboard_arrow_down,
                  size: 14,
                  color: _kTextMuted,
                ),
              ],
            ),
            if (_expanded) ...[
              const SizedBox(height: 7),
              Text(
                widget.text,
                style: const TextStyle(
                  color: _kTextSecondary,
                  fontSize: 12,
                  fontStyle: FontStyle.italic,
                  height: 1.5,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Tool block
// ---------------------------------------------------------------------------

class _ToolBlock extends StatefulWidget {
  final ChatPart part;
  const _ToolBlock({required this.part});

  @override
  State<_ToolBlock> createState() => _ToolBlockState();
}

class _ToolBlockState extends State<_ToolBlock> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final p = widget.part;
    final status = p.toolStatus ?? 'pending';
    final (statusColor, statusIcon) = switch (status) {
      'completed' => (_kGreen, Icons.check_circle_outline_rounded),
      'error' => (_kRed, Icons.error_outline_rounded),
      'running' => (_kOrange, Icons.sync_rounded),
      _ => (_kTextMuted, Icons.pending_outlined),
    };

    return GestureDetector(
      onTap: () => setState(() => _expanded = !_expanded),
      child: Container(
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: _kCard,
          border: Border.all(color: statusColor.withValues(alpha: 0.25)),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(statusIcon, size: 14, color: statusColor),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    p.toolName ?? 'tool',
                    style: const TextStyle(
                      color: Color(0xFF79C0FF),
                      fontSize: 12,
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w500,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Icon(
                  _expanded
                      ? Icons.keyboard_arrow_up
                      : Icons.keyboard_arrow_down,
                  size: 14,
                  color: _kTextMuted,
                ),
              ],
            ),
            if (_expanded) ...[
              const SizedBox(height: 8),
              if (p.toolInput != null && p.toolInput!.isNotEmpty)
                _CodeBlock(
                  text: p.toolInput!.entries
                      .take(5)
                      .map((e) => '${e.key}: ${e.value}')
                      .join('\n'),
                  color: _kTextSecondary,
                ),
              if (p.toolOutput != null && p.toolOutput!.isNotEmpty) ...[
                const SizedBox(height: 4),
                _CodeBlock(
                  text: p.toolOutput!.length > 500
                      ? '${p.toolOutput!.substring(0, 500)}…'
                      : p.toolOutput!,
                  color: _kGreen,
                ),
              ],
              if (p.toolError != null) ...[
                const SizedBox(height: 4),
                Text(
                  p.toolError!,
                  style: const TextStyle(color: _kRed, fontSize: 11),
                ),
              ],
            ],
          ],
        ),
      ),
    );
  }
}

class _CodeBlock extends StatelessWidget {
  final String text;
  final Color color;
  const _CodeBlock({required this.text, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: _kBg,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: _kBorder),
      ),
      child: SelectableText(
        text,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontFamily: 'monospace',
          height: 1.4,
        ),
      ),
    );
  }
}
