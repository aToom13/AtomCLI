// ===== NAVIGATION =====
let currentPage = 'chat';
let currentSessionID = null;
let currentFilePath = '.';

// Page titles mapping
const PAGE_TITLES = {
  chat: 'Chat',
  dashboard: 'Dashboard',
  providers: 'Providers',
  agents: 'Agents',
  tools: 'Tools',
  mcp: 'MCP Servers',
  config: 'Configuration',
  files: 'File Browser',
  events: 'Live Events',
  skills: 'Skills & Agents'
};

// Initialize navigation
function initNavigation() {
  // Add click handlers to nav items
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;

      // Special handling for chat page - start new chat
      if (page === 'chat') {
        startNewChat();
      } else {
        navigate(page);
      }
    });
  });

  // Set initial active page
  const initialPage = window.location.hash.substring(1) || 'chat';
  navigate(initialPage);
}

// Start a new chat session
function startNewChat() {
  // Clear current session
  currentSessionID = null;

  // Navigate to chat page
  navigate('chat');

  // Clear session info
  const sessionInfoEl = document.getElementById('chat-session-info');
  if (sessionInfoEl) {
    sessionInfoEl.textContent = '';
  }

  // Clear messages and show empty state
  const messagesEl = document.getElementById('chat-messages');
  if (messagesEl) {
    messagesEl.innerHTML = `
      <div class="chat-empty">
        <div class="chat-empty-icon">💬</div>
        <div style="font-size:18px;font-weight:600">Start a conversation</div>
        <div style="font-size:13px">Select a model and type your message below</div>
      </div>
    `;
  }

  // Clear active session in sidebar
  document.querySelectorAll('.session-item').forEach(s => {
    s.classList.remove('active');
  });

  // Focus on input
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    setTimeout(() => chatInput.focus(), 100);
  }
}

// Navigate to page
function navigate(page) {
  if (currentPage === page) return;

  // Update current page
  currentPage = page;

  // Update URL hash
  window.location.hash = page;

  // Update active nav item
  document.querySelectorAll('.nav-item[data-page]').forEach(n => {
    n.classList.toggle('active', n.dataset.page === page);
  });

  // Show/hide pages
  document.querySelectorAll('.page').forEach(p => {
    p.classList.toggle('active', p.id === `page-${page}`);
  });

  // Update page title
  const titleEl = document.getElementById('page-title');
  if (titleEl) {
    titleEl.textContent = PAGE_TITLES[page] || page;
  }

  // Load page content
  if (window.PageLoaders && window.PageLoaders[page]) {
    window.PageLoaders[page]();
  }

  // Update mobile sidebar state
  updateMobileSidebar();
}

// Update mobile sidebar visibility
function updateMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  if (Utils.isMobile()) {
    // On mobile, add toggle functionality
    setupMobileSidebarToggle();
  } else {
    // On desktop/tablet, ensure sidebar is visible
    sidebar.classList.remove('expanded');
    const sidebarHeader = sidebar.querySelector('.sidebar-header');
    if (sidebarHeader) {
      sidebarHeader.style.cursor = 'default';
    }
  }
}

// Setup mobile sidebar toggle
function setupMobileSidebarToggle() {
  const sidebar = document.querySelector('.sidebar');
  const sidebarHeader = sidebar?.querySelector('.sidebar-header');

  if (!sidebar || !sidebarHeader) return;

  // Add toggle functionality to header
  sidebarHeader.style.cursor = 'pointer';
  sidebarHeader.addEventListener('click', () => {
    sidebar.classList.toggle('expanded');
  });

  // Close sidebar when clicking outside on mobile
  document.addEventListener('click', (event) => {
    if (!Utils.isMobile()) return;

    const isClickInsideSidebar = sidebar.contains(event.target);
    const isClickOnHeader = sidebarHeader.contains(event.target);

    if (!isClickInsideSidebar && sidebar.classList.contains('expanded')) {
      sidebar.classList.remove('expanded');
    }
  });
}

// Session navigation
async function openSession(id) {
  currentSessionID = id;
  navigate('chat');

  const sessionInfoEl = document.getElementById('chat-session-info');
  if (sessionInfoEl) {
    sessionInfoEl.textContent = `Session: ${id.substring(0, 16)}...`;
  }

  // Update active session in sidebar
  document.querySelectorAll('.session-item').forEach(s => {
    const onclick = s.getAttribute('onclick') || '';
    s.classList.toggle('active', onclick.includes(id));
  });

  try {
    const messages = await Utils.api(`/session/${id}/message`);
    if (window.Chat && window.Chat.renderMessages) {
      window.Chat.renderMessages(messages);
    }
  } catch (error) {
    console.error('Failed to load session messages:', error);
    Utils.toast('Failed to load messages', 'error');
  }
}

async function createNewSession() {
  try {
    const session = await Utils.api('/session', { method: 'POST', body: {} });
    currentSessionID = session.id;

    const sessionInfoEl = document.getElementById('chat-session-info');
    if (sessionInfoEl) {
      sessionInfoEl.textContent = `Session: ${session.id.substring(0, 16)}...`;
    }

    loadSessionList();
    return session;
  } catch (error) {
    Utils.toast('Failed to create session', 'error');
    throw error;
  }
}

// File navigation
function navigateFiles(name) {
  if (name === '..') {
    const parts = currentFilePath.split('/');
    parts.pop();
    currentFilePath = parts.join('/') || '.';
  } else {
    currentFilePath = currentFilePath === '.' ? name : `${currentFilePath}/${name}`;
  }

  const fileContentSection = document.getElementById('file-content-section');
  if (fileContentSection) {
    fileContentSection.style.display = 'none';
  }

  if (window.PageLoaders && window.PageLoaders.files) {
    window.PageLoaders.files();
  }
}

async function viewFile(path) {
  try {
    const content = await Utils.api('/file/content', { query: { path } });

    const fileContentSection = document.getElementById('file-content-section');
    const fileContentTitle = document.getElementById('file-content-title');
    const fileContentArea = document.getElementById('file-content-area');

    if (fileContentSection) fileContentSection.style.display = 'block';
    if (fileContentTitle) fileContentTitle.textContent = path.split('/').pop();
    if (fileContentArea) {
      fileContentArea.textContent = content.content || content.text || JSON.stringify(content, null, 2);
    }
  } catch (error) {
    Utils.toast('Failed to read file', 'error');
  }
}

// Export navigation functions
window.Navigation = {
  init: initNavigation,
  navigate,
  startNewChat,
  openSession,
  createNewSession,
  navigateFiles,
  viewFile,
  getCurrentPage: () => currentPage,
  getCurrentSession: () => currentSessionID,
  getCurrentFilePath: () => currentFilePath,
  setCurrentSession: (id) => { currentSessionID = id; },
  setCurrentFilePath: (path) => { currentFilePath = path; }
};