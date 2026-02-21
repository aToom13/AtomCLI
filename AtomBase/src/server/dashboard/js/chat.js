// ===== CHAT (Replaced by TUI Nexus) =====
let isStreaming = false;

let term = null;
let fitAddon = null;
let ws = null;
let ptySession = null;

// Provider State (needed by pageLoaders.js for Providers page)
let allProviders = [];
let connectedProviders = [];

async function loadProviders() {
  try {
    const data = await Utils.api('/provider');
    allProviders = data.all || [];
    connectedProviders = data.connected || [];
  } catch (error) {
    console.error('Failed to load providers:', error);
  }
}

// Stub for navigation.js compatibility
function renderMessages(messages) {
  // No-op for TUI, messages are handled by the PTY stream
}

// Initialize chat (Now initializes Web-PTY TUI)
async function initChat() {
  const tuiViewport = document.getElementById('nexus-tui-viewport');
  if (!tuiViewport) return;

  // Cleanup existing TUI
  tuiViewport.innerHTML = '';
  if (term) term.dispose();
  if (ws) ws.close();

  // Create terminal instance
  term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: '"JetBrains Mono", monospace',
    theme: {
      background: '#000000',
      foreground: '#e5e7eb',
      cursor: '#00E5FF',
      selectionBackground: 'rgba(0, 229, 255, 0.3)',
    }
  });

  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(tuiViewport);
  fitAddon.fit();

  term.write('\x1b[36m[ AtomCLI Nexus TUI Initializing... ]\x1b[0m\r\n');

  try {
    // 1. Check for existing PTY or spawn a new one representing the TUI
    const sessions = await Utils.api('/pty');
    ptySession = sessions.find(s => s.title === 'atomcli-tui');

    if (!ptySession) {
      const ptyRes = await fetch('/pty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (!ptyRes.ok) {
        const errText = await ptyRes.text();
        throw new Error(`PTY creation failed ${ptyRes.status}: ${errText}`);
      }
      ptySession = await ptyRes.json();
    }

    // 2. Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/pty/${ptySession.id}/connect`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      // Send initial resize after a brief delay for CSS layout to settle
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN && fitAddon) {
          fitAddon.fit();
          const resizeBody = JSON.stringify({ size: { rows: term.rows, cols: term.cols } });
          fetch(`/pty/${ptySession.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: resizeBody
          }).catch(err => console.error('Failed to resize initial PTY:', err));
        }
      }, 150);
    };

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    ws.onclose = () => {
      term.write('\r\n\x1b[31m[ TUI STREAM OFFLINE ]\x1b[0m\r\n');
    };

    ws.onerror = (error) => {
      console.error('TUI WebSocket Error:', error);
      term.write('\r\n\x1b[31m[ TUI CONNECTION ERROR ]\x1b[0m\r\n');
    };

    // 3. Forward Terminal Input to WebSocket
    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // 4. Handle Window Resize
    window.addEventListener('resize', Utils.debounce(() => {
      if (!term || !fitAddon || !ptySession) return;
      fitAddon.fit();

      fetch(`/pty/${ptySession.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ size: { rows: term.rows, cols: term.cols } })
      }).catch(err => console.error('Failed to resize PTY:', err));
    }, 200));

  } catch (error) {
    console.error('Failed to initialize TUI:', error);
    term.write(`\r\n\x1b[31m[ ERROR: ${error.message} ]\x1b[0m\r\n`);
  }
}

// Export minimal Chat functions required by Navigation or old scripts
window.Chat = {
  init: initChat,
  loadProviders: loadProviders,
  renderMessages: renderMessages,
  getIsStreaming: () => isStreaming,
  getAllProviders: () => allProviders,
  getConnectedProviders: () => connectedProviders
};