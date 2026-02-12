// ===== SERVER-SENT EVENTS =====
let sseAbortController = null;
let sseActive = true;
let sseRetryTimer = null;

// Initialize SSE connection using fetch-based approach for reliability
function initSSE() {
  // Clean up any existing connection
  if (sseAbortController) {
    sseAbortController.abort();
    sseAbortController = null;
  }
  if (sseRetryTimer) {
    clearTimeout(sseRetryTimer);
    sseRetryTimer = null;
  }

  sseAbortController = new AbortController();
  const signal = sseAbortController.signal;

  fetch(`${BASE}/global/event`, {
    signal,
    headers: { 'Accept': 'text/event-stream' },
  })
    .then(response => {
      if (!response.ok) {
        throw new Error(`SSE HTTP ${response.status}`);
      }
      updateConnectionStatus('connected');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      function processChunk() {
        return reader.read().then(({ done, value }) => {
          if (done || signal.aborted) return;

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE messages (separated by double newline)
          const messages = buffer.split('\n\n');
          buffer = messages.pop(); // Keep incomplete message in buffer

          for (const msg of messages) {
            if (!msg.trim()) continue;

            // Extract data lines from SSE format
            let data = '';
            for (const line of msg.split('\n')) {
              if (line.startsWith('data:')) {
                data += line.slice(5).trim();
              }
            }

            if (!data) continue;

            try {
              const raw = JSON.parse(data);
              // Backend wraps events as { directory, payload: { type, properties } }
              const event = raw.payload || raw;
              handleSSEEvent(event);
            } catch (e) {
              console.warn('SSE parse error:', e, data);
            }
          }

          return processChunk();
        });
      }

      return processChunk();
    })
    .catch(err => {
      if (signal.aborted) return; // Intentional close, don't retry
      console.warn('SSE connection error:', err.message);
      updateConnectionStatus('disconnected');

      // Retry after delay
      sseRetryTimer = setTimeout(() => {
        if (sseActive) initSSE();
      }, 3000);
    });
}

// Handle a parsed SSE event
function handleSSEEvent(data) {
  // Skip heartbeats from logging but use them to confirm connection
  if (data.type === 'server.heartbeat') return;

  // Log the event
  addEvent(data);

  // Handle streaming updates for chat
  if (data.type === 'message.part.updated') {
    const part = data.properties?.part;
    if (part?.sessionID === Navigation.getCurrentSession()) {
      const streamEl = document.getElementById('streaming-content');
      if (streamEl && part?.type === 'text') {
        streamEl.textContent = part.text || streamEl.textContent;
      }
    }
  }
}

// Update connection status UI
function updateConnectionStatus(status) {
  const statusDots = [
    document.getElementById('mobile-status-dot'),
    document.getElementById('desktop-status-dot'),
  ];
  const statusTexts = [
    document.getElementById('mobile-status-text'),
    document.getElementById('desktop-status-text'),
  ];

  let color, text;
  switch (status) {
    case 'connected':
      color = 'var(--success)';
      text = 'Connected';
      break;
    case 'disconnected':
      color = 'var(--warning)';
      text = 'Reconnecting...';
      break;
    case 'failed':
      color = 'var(--danger)';
      text = 'SSE Failed';
      break;
    default:
      color = 'var(--warning)';
      text = 'Connecting...';
  }

  statusDots.forEach(dot => {
    if (dot) dot.style.background = color;
  });
  statusTexts.forEach(el => {
    if (el) el.textContent = text;
  });
}

// Add event to event log
function addEvent(data) {
  const log = document.getElementById('event-log');
  if (!log) return;

  // Remove empty state if present
  const emptyEl = log.querySelector('.empty');
  if (emptyEl) {
    emptyEl.remove();
  }

  // Create event item
  const item = document.createElement('div');
  item.className = 'event-item';

  const time = new Date().toLocaleTimeString();
  const eventType = data.type || 'unknown';
  const properties = JSON.stringify(data.properties || {}).substring(0, 120);

  item.innerHTML = `
    <span class="event-time">${time}</span>
    <span class="event-type">${Utils.esc(eventType)}</span>
    <span style="color:var(--text3)">${Utils.esc(properties)}</span>
  `;

  // Add to top of log
  log.insertBefore(item, log.firstChild);

  // Limit log size
  while (log.children.length > 200) {
    log.removeChild(log.lastChild);
  }
}

// Clear event log
function clearEvents() {
  const log = document.getElementById('event-log');
  if (!log) return;

  log.innerHTML = `
    <div class="empty">
      <div class="empty-icon">📡</div>
      <div>Events cleared</div>
    </div>
  `;
}

// Toggle SSE connection
function toggleSSE() {
  sseActive = !sseActive;
  const btn = document.getElementById('sse-toggle');

  if (!btn) return;

  if (sseActive) {
    initSSE();
    btn.textContent = '● Listening';
    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-primary');
  } else {
    if (sseAbortController) {
      sseAbortController.abort();
      sseAbortController = null;
    }
    btn.textContent = '○ Paused';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-secondary');
    updateConnectionStatus('disconnected');
  }
}

// Initialize SSE on page load
function initSSEConnection() {
  // Set initial connection status
  updateConnectionStatus('connecting');

  // Start SSE connection
  initSSE();

  // Setup toggle button
  const toggleBtn = document.getElementById('sse-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleSSE);
  }

  // Setup clear button
  const clearBtn = document.getElementById('clear-events-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearEvents);
  }
}

// Export SSE functions
window.SSE = {
  init: initSSEConnection,
  addEvent,
  clearEvents,
  toggleSSE,
  getStatus: () => sseActive ? 'active' : 'paused',
  reconnect: initSSE
};