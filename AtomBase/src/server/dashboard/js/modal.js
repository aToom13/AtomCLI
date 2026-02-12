// ===== MODAL =====

// Show modal with content
function showModal(title, content, options = {}) {
  const modalOverlay = document.getElementById('modal-overlay');
  const modalContent = document.getElementById('modal-content');
  
  if (!modalOverlay || !modalContent) return;
  
  // Build modal HTML
  let modalHTML = `
    <div class="modal-title">${Utils.esc(title)}</div>
    <div class="modal-body">${content}</div>
    <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
  `;
  
  // Add buttons based on options
  if (options.buttons) {
    modalHTML += options.buttons.map(btn => `
      <button class="btn ${btn.class || 'btn-secondary'}" 
              onclick="${btn.onclick || 'closeModal()'}"
              ${btn.disabled ? 'disabled' : ''}>
        ${Utils.esc(btn.text)}
      </button>
    `).join('');
  } else {
    modalHTML += `
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="closeModal()">OK</button>
    `;
  }
  
  modalHTML += '</div>';
  
  // Set modal content and show
  modalContent.innerHTML = modalHTML;
  modalOverlay.classList.add('active');
  
  // Focus first input if any
  setTimeout(() => {
    const firstInput = modalContent.querySelector('input, textarea, select');
    if (firstInput) {
      firstInput.focus();
    }
  }, 10);
  
  // Handle escape key
  const handleEscape = (event) => {
    if (event.key === 'Escape') {
      closeModal();
    }
  };
  
  document.addEventListener('keydown', handleEscape);
  
  // Store handler for cleanup
  modalOverlay._escapeHandler = handleEscape;
}

// Close modal
function closeModal() {
  const modalOverlay = document.getElementById('modal-overlay');
  if (!modalOverlay) return;
  
  // Remove escape key handler
  if (modalOverlay._escapeHandler) {
    document.removeEventListener('keydown', modalOverlay._escapeHandler);
    delete modalOverlay._escapeHandler;
  }
  
  modalOverlay.classList.remove('active');
}

// Show add MCP server modal
function showAddMcpModal() {
  const content = `
    <div class="input-group">
      <label>Name</label>
      <input class="input" id="mcp-name" placeholder="e.g. memory">
    </div>
    <div class="input-group">
      <label>Command</label>
      <input class="input" id="mcp-cmd" placeholder="e.g. npx -y @modelcontextprotocol/server-memory">
    </div>
    <div class="input-group">
      <label>Arguments (optional, space-separated)</label>
      <input class="input" id="mcp-args" placeholder="--port 8080 --verbose">
    </div>
  `;
  
  const buttons = [
    {
      text: 'Cancel',
      class: 'btn-secondary',
      onclick: 'closeModal()'
    },
    {
      text: 'Add',
      class: 'btn-primary',
      onclick: 'addMcp()'
    }
  ];
  
  showModal('Add MCP Server', content, { buttons });
}

// Add MCP server
async function addMcp() {
  const nameInput = document.getElementById('mcp-name');
  const cmdInput = document.getElementById('mcp-cmd');
  const argsInput = document.getElementById('mcp-args');
  
  if (!nameInput || !cmdInput) return;
  
  const name = nameInput.value.trim();
  const command = cmdInput.value.trim();
  const args = argsInput?.value.trim();
  
  if (!name || !command) {
    Utils.toast('Please fill in all required fields', 'error');
    return;
  }
  
  try {
    const config = {
      type: 'local',
      command: command.split(' ')
    };
    
    if (args) {
      config.args = args.split(' ').filter(arg => arg.trim());
    }
    
    await Utils.api('/mcp', {
      method: 'POST',
      body: { name, config }
    });
    
    Utils.toast(`MCP server "${name}" added successfully`);
    closeModal();
    
    // Reload MCP page if active
    if (Navigation.getCurrentPage() === 'mcp' && window.PageLoaders.mcp) {
      window.PageLoaders.mcp();
    }
  } catch (error) {
    Utils.toast(`Failed to add MCP server: ${error.message}`, 'error');
  }
}

// MCP action (connect/disconnect)
async function mcpAction(name, action) {
  try {
    await Utils.api(`/mcp/${encodeURIComponent(name)}/${action}`, {
      method: 'POST'
    });
    
    Utils.toast(`MCP server "${name}" ${action}ed`);
    
    // Reload MCP page if active
    if (Navigation.getCurrentPage() === 'mcp' && window.PageLoaders.mcp) {
      window.PageLoaders.mcp();
    }
  } catch (error) {
    Utils.toast(`Failed to ${action} MCP server: ${error.message}`, 'error');
  }
}

// Save configuration
async function saveConfig() {
  const editor = document.getElementById('config-editor');
  if (!editor) return;
  
  try {
    const cfg = JSON.parse(editor.value);
    await Utils.api('/config', {
      method: 'PATCH',
      body: cfg
    });
    
    Utils.toast('Configuration saved successfully');
  } catch (error) {
    if (error instanceof SyntaxError) {
      Utils.toast('Invalid JSON format', 'error');
    } else {
      Utils.toast(`Failed to save configuration: ${error.message}`, 'error');
    }
  }
}

// Initialize modal functionality
function initModal() {
  const modalOverlay = document.getElementById('modal-overlay');
  if (!modalOverlay) return;
  
  // Close modal when clicking outside
  modalOverlay.addEventListener('click', (event) => {
    if (event.target === modalOverlay) {
      closeModal();
    }
  });
  
  // Setup config save button
  const saveConfigBtn = document.getElementById('save-config-btn');
  if (saveConfigBtn) {
    saveConfigBtn.addEventListener('click', saveConfig);
  }
  
  // Setup add MCP button
  const addMcpBtn = document.getElementById('add-mcp-btn');
  if (addMcpBtn) {
    addMcpBtn.addEventListener('click', showAddMcpModal);
  }
  
  // Setup files up button
  const filesUpBtn = document.getElementById('files-up-btn');
  if (filesUpBtn) {
    filesUpBtn.addEventListener('click', () => Navigation.navigateFiles('..'));
  }
  
  // Setup MCP action buttons dynamically
  document.addEventListener('click', (event) => {
    if (event.target.matches('button[onclick*="mcpAction"]')) {
      const onclick = event.target.getAttribute('onclick');
      const match = onclick.match(/mcpAction\('([^']+)','([^']+)'\)/);
      if (match) {
        event.preventDefault();
        mcpAction(match[1], match[2]);
      }
    }
  });
}

// Export modal functions
window.Modal = {
  init: initModal,
  show: showModal,
  close: closeModal,
  showAddMcpModal,
  addMcp,
  mcpAction,
  saveConfig
};