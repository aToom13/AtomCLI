// ===== CHAT =====
let isStreaming = false;
let allProviders = [];
let connectedProviders = [];
let modelFilter = {
  search: '',
  freeOnly: false,
  connectedOnly: false
};

// Initialize chat
function initChat() {
  // Load providers
  loadProviders();

  // Load session list
  loadSessionList();

  // Setup chat input handlers
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');

  if (chatInput) {
    chatInput.addEventListener('keydown', handleChatKey);
    chatInput.addEventListener('input', autoResizeTextarea);
  }

  if (chatSendBtn) {
    chatSendBtn.addEventListener('click', sendMessage);
  }

  // Setup model filter
  setupModelFilter();
}

// Auto-resize textarea
function autoResizeTextarea(event) {
  const textarea = event.target;
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// Handle chat keyboard shortcuts
function handleChatKey(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

// Load providers and populate model select
async function loadProviders() {
  try {
    const data = await Utils.api('/provider');
    allProviders = data.all || [];
    connectedProviders = data.connected || [];
    populateModelSelect();
    updateModelFilterUI();
  } catch (error) {
    console.error('Failed to load providers:', error);
  }
}

// Populate model select with filtering
function populateModelSelect() {
  const select = document.getElementById('chat-provider');
  if (!select) return;

  select.innerHTML = '';

  // Filter models
  const filteredModels = getFilteredModels();

  if (filteredModels.length === 0) {
    const option = document.createElement('option');
    option.textContent = 'No models match your filters';
    select.appendChild(option);
    return;
  }

  // Group by provider
  const modelsByProvider = {};
  filteredModels.forEach(model => {
    if (!modelsByProvider[model.providerName]) {
      modelsByProvider[model.providerName] = [];
    }
    modelsByProvider[model.providerName].push(model);
  });

  // Create optgroups
  Object.entries(modelsByProvider).forEach(([providerName, models]) => {
    const optgroup = document.createElement('optgroup');
    optgroup.label = providerName;

    models.forEach(model => {
      const option = document.createElement('option');
      option.value = `${model.providerId}::${model.modelId}`;
      option.textContent = model.modelName;

      if (!model.isConnected) {
        option.style.color = 'var(--text3)';
        option.title = 'Provider not connected';
      }

      if (model.isFree) {
        option.textContent += ' 🆓';
      }

      optgroup.appendChild(option);
    });

    select.appendChild(optgroup);
  });
}

// Get filtered models based on current filters
function getFilteredModels() {
  const models = [];

  allProviders.forEach(provider => {
    const isConnected = connectedProviders.includes(provider.id);

    Object.entries(provider.models || {}).forEach(([modelId, model]) => {
      const modelName = model.name || modelId;
      const isFree = model.free === true || model.pricing === 'free' || modelId.includes('free');

      // Apply filters
      if (modelFilter.search) {
        const searchLower = modelFilter.search.toLowerCase();
        const matchesSearch =
          modelName.toLowerCase().includes(searchLower) ||
          provider.name?.toLowerCase().includes(searchLower) ||
          provider.id.toLowerCase().includes(searchLower);
        if (!matchesSearch) return;
      }

      if (modelFilter.freeOnly && !isFree) return;
      if (modelFilter.connectedOnly && !isConnected) return;

      models.push({
        providerId: provider.id,
        providerName: provider.name || provider.id,
        modelId,
        modelName,
        isConnected,
        isFree
      });
    });
  });

  // Sort: connected first, then free, then by name
  return models.sort((a, b) => {
    if (a.isConnected !== b.isConnected) return b.isConnected - a.isConnected;
    if (a.isFree !== b.isFree) return b.isFree - a.isFree;
    return a.modelName.localeCompare(b.modelName);
  });
}

// Setup model filter UI
function setupModelFilter() {
  const filterContainer = document.getElementById('model-filter-container');
  if (!filterContainer) return;

  // Search input
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'input model-filter-input';
  searchInput.placeholder = 'Search models...';
  searchInput.value = modelFilter.search;

  searchInput.addEventListener('input', Utils.debounce((event) => {
    modelFilter.search = event.target.value;
    populateModelSelect();
    updateModelFilterUI();
  }, 300));

  // Filter badges container
  const badgesContainer = document.createElement('div');
  badgesContainer.className = 'model-filter-badges';

  // Free only badge
  const freeBadge = document.createElement('span');
  freeBadge.className = 'model-filter-badge';
  freeBadge.textContent = 'Free Only';
  freeBadge.title = 'Show only free models';

  freeBadge.addEventListener('click', () => {
    modelFilter.freeOnly = !modelFilter.freeOnly;
    populateModelSelect();
    updateModelFilterUI();
  });

  // Connected only badge
  const connectedBadge = document.createElement('span');
  connectedBadge.className = 'model-filter-badge';
  connectedBadge.textContent = 'Connected';
  connectedBadge.title = 'Show only connected providers';

  connectedBadge.addEventListener('click', () => {
    modelFilter.connectedOnly = !modelFilter.connectedOnly;
    populateModelSelect();
    updateModelFilterUI();
  });

  // Clear filters badge
  const clearBadge = document.createElement('span');
  clearBadge.className = 'model-filter-badge';
  clearBadge.textContent = 'Clear';
  clearBadge.title = 'Clear all filters';

  clearBadge.addEventListener('click', () => {
    modelFilter.search = '';
    modelFilter.freeOnly = false;
    modelFilter.connectedOnly = false;
    if (searchInput) searchInput.value = '';
    populateModelSelect();
    updateModelFilterUI();
  });

  badgesContainer.appendChild(freeBadge);
  badgesContainer.appendChild(connectedBadge);
  badgesContainer.appendChild(clearBadge);

  filterContainer.appendChild(searchInput);
  filterContainer.appendChild(badgesContainer);

  // Initial UI update
  updateModelFilterUI();
}

// Update model filter UI state
function updateModelFilterUI() {
  const badges = document.querySelectorAll('.model-filter-badge');
  badges.forEach(badge => {
    const text = badge.textContent;
    if (text === 'Free Only') {
      badge.classList.toggle('active', modelFilter.freeOnly);
    } else if (text === 'Connected') {
      badge.classList.toggle('active', modelFilter.connectedOnly);
    }
  });

  // Update filter count display
  const filteredModels = getFilteredModels();
  const totalModels = allProviders.reduce((sum, p) => sum + Object.keys(p.models || {}).length, 0);

  const filterInfo = document.getElementById('model-filter-info');
  if (filterInfo) {
    filterInfo.textContent = `Showing ${filteredModels.length} of ${totalModels} models`;
  }
}

// Render messages
function renderMessages(messages) {
  const el = document.getElementById('chat-messages');
  if (!el) return;

  if (!messages || !messages.length) {
    el.innerHTML = `
      <div class="chat-empty">
        <div class="chat-empty-icon">💬</div>
        <div style="font-size:18px;font-weight:600">Start a conversation</div>
        <div style="font-size:13px">Select a model and type your message below</div>
      </div>
    `;
    return;
  }

  el.innerHTML = messages.map(m => {
    const info = m.info || {};
    const role = info.role || 'unknown';
    const parts = m.parts || [];
    let html = '';

    parts.forEach(p => {
      if (p.type === 'text' && !p.ignored && !p.synthetic) {
        html += `<div class="chat-bubble">${Utils.esc(p.text)}</div>`;
      } else if (p.type === 'tool') {
        const toolName = p.tool || 'unknown';
        const status = p.state?.status || 'unknown';
        const icon = status === 'completed' ? '✅' : status === 'error' ? '❌' : status === 'running' ? '⏳' : '⏸';
        html += `<div class="chat-tool">${icon} Tool: ${Utils.esc(toolName)} — ${status}</div>`;
      } else if (p.type === 'reasoning') {
        html += `<div class="chat-tool" style="border-color:var(--accent);color:var(--accent2)">💭 ${Utils.esc(p.text?.substring(0, 200))}${p.text?.length > 200 ? '...' : ''}</div>`;
      }
    });

    if (!html) return '';

    return `
      <div class="chat-msg ${role}">
        <div class="chat-role">${role === 'assistant' ? '🤖 ' : '👤 '}${role}</div>
        ${html}
      </div>
    `;
  }).filter(Boolean).join('');

  el.scrollTop = el.scrollHeight;
}

// Send message
async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input?.value.trim();

  if (!text || isStreaming) return;

  const select = document.getElementById('chat-provider');
  const parts = (select?.value || '').split('::');
  const providerID = parts[0];
  const modelID = parts[1];

  if (!providerID || !modelID) {
    Utils.toast('Please select a model', 'error');
    return;
  }

  // Get current session ID
  let currentSessionID = window.Navigation ? window.Navigation.getCurrentSession() : null;

  // Create session if needed
  if (!currentSessionID) {
    try {
      await window.Navigation.createNewSession();
      currentSessionID = window.Navigation.getCurrentSession();
    } catch {
      return;
    }
  }

  // Clear input
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }

  // Add user message to UI immediately
  const messagesEl = document.getElementById('chat-messages');
  const emptyEl = messagesEl?.querySelector('.chat-empty');

  if (emptyEl) emptyEl.remove();

  if (messagesEl) {
    messagesEl.innerHTML += `
      <div class="chat-msg user">
        <div class="chat-role">👤 user</div>
        <div class="chat-bubble">${Utils.esc(text)}</div>
      </div>
      <div class="chat-msg assistant" id="streaming-msg">
        <div class="chat-role">🤖 assistant <span class="streaming-dot"></span></div>
        <div class="chat-bubble" id="streaming-content">Thinking...</div>
      </div>
    `;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  isStreaming = true;
  const sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const body = {
      parts: [{ type: 'text', text: text }],
      model: { providerID, modelID }
    };

    const res = await fetch(`${BASE}/session/${currentSessionID}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText);
    }

    // Read streaming response
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }

    // Parse the completed response
    try {
      const result = JSON.parse(buffer);
      // Reload all messages for clean display
      const updated = await Utils.api(`/session/${currentSessionID}/message`);
      renderMessages(updated);
    } catch {
      // Still reload to get proper state
      const updated = await Utils.api(`/session/${currentSessionID}/message`);
      renderMessages(updated);
    }

    loadSessionList();
    Utils.toast('Message sent');

  } catch (error) {
    console.error('Failed to send message:', error);
    const streamingEl = document.getElementById('streaming-msg');
    if (streamingEl) streamingEl.remove();
    Utils.toast('Failed to send message: ' + error.message?.substring(0, 100), 'error');

    // Reload messages to get current state
    try {
      const updated = await Utils.api(`/session/${currentSessionID}/message`);
      renderMessages(updated);
    } catch { }
  } finally {
    isStreaming = false;
    const sendBtn = document.getElementById('chat-send-btn');
    if (sendBtn) sendBtn.disabled = false;
  }
}

// Load session list
async function loadSessionList() {
  try {
    const sessions = await Utils.api('/session');
    const el = document.getElementById('session-sidebar-list');
    if (!el) return;

    const currentSessionID = window.Navigation ? window.Navigation.getCurrentSession() : null;

    el.innerHTML = sessions.slice(0, 20).map(s => `
      <div class="session-item ${s.id === currentSessionID ? 'active' : ''}" 
           onclick="Navigation.openSession('${s.id}')" 
           title="${Utils.esc(s.title || s.id)}">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;margin-right:4px">${Utils.esc(s.title || 'Untitled')}</span>
        <div class="session-delete-btn" onclick="Chat.deleteSession('${s.id}', event)" title="Delete Chat">×</div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Failed to load session list:', error);
  }
}


// Delete session
async function deleteSession(id, event) {
  if (event) event.stopPropagation();

  if (!confirm('Are you sure you want to delete this chat?')) return;

  try {
    await Utils.api(`/session/${id}`, { method: 'DELETE' });
    Utils.toast('Chat deleted', 'success');

    // If deleted current session, start new one
    if (window.Navigation && window.Navigation.getCurrentSession() === id) {
      window.Navigation.startNewChat();
    }

    // Reload list
    loadSessionList();
  } catch (error) {
    console.error('Failed to delete session:', error);
    Utils.toast('Failed to delete chat', 'error');
  }
}

// Export chat functions
window.Chat = {
  init: initChat,
  loadProviders,
  populateModelSelect,
  renderMessages,
  sendMessage,
  loadSessionList,
  deleteSession,
  getFilteredModels,
  updateModelFilterUI,
  getIsStreaming: () => isStreaming,
  getAllProviders: () => allProviders,
  getConnectedProviders: () => connectedProviders,
  getModelFilter: () => modelFilter
};