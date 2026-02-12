// ===== PAGE LOADERS =====
const PageLoaders = {
  // Chat page
  chat() {
    Chat.loadSessionList();
  },

  // Dashboard page
  async dashboard() {
    try {
      const [health, paths, agents, toolIds] = await Promise.all([
        Utils.api('/global/health'),
        Utils.api('/path').catch(() => null),
        Utils.api('/agent').catch(() => []),
        Utils.api('/experimental/tool/ids').catch(() => [])
      ]);

      // Get provider/model counts from cached data
      const allProviders = Chat.getAllProviders ? Chat.getAllProviders() : [];
      const connectedProviders = Chat.getConnectedProviders ? Chat.getConnectedProviders() : [];
      const totalModels = allProviders.reduce((sum, p) => sum + Object.keys(p.models || {}).length, 0);

      // Update version in sidebar
      const versionEl = document.getElementById('sidebar-version');
      if (versionEl) {
        versionEl.textContent = 'v' + (health.version || '?');
      }

      // Update dashboard cards with richer stats
      const cardsEl = document.getElementById('dashboard-cards');
      if (cardsEl) {
        cardsEl.innerHTML = `
          <div class="card">
            <div class="card-header">
              <span class="card-icon">💚</span>
              <span class="card-title">Status</span>
            </div>
            <div class="card-value">${health.healthy ? 'Healthy' : 'Unhealthy'}</div>
            <div class="card-subtitle">v${health.version || '?'}</div>
          </div>
          <div class="card">
            <div class="card-header">
              <span class="card-icon">🤖</span>
              <span class="card-title">Models</span>
            </div>
            <div class="card-value">${totalModels}</div>
            <div class="card-subtitle">${connectedProviders.length} provider${connectedProviders.length !== 1 ? 's' : ''} connected</div>
          </div>
          <div class="card">
            <div class="card-header">
              <span class="card-icon">🎯</span>
              <span class="card-title">Agents</span>
            </div>
            <div class="card-value">${agents.length}</div>
            <div class="card-subtitle">Available agents</div>
          </div>
          <div class="card">
            <div class="card-header">
              <span class="card-icon">🛠️</span>
              <span class="card-title">Tools</span>
            </div>
            <div class="card-value">${toolIds.length}</div>
            <div class="card-subtitle">Registered tools</div>
          </div>
          <div class="card">
            <div class="card-header">
              <span class="card-icon">📂</span>
              <span class="card-title">Directory</span>
            </div>
            <div class="card-value" style="font-size:14px;word-break:break-all">${paths?.directory || 'N/A'}</div>
            <div class="card-subtitle">Working Directory</div>
          </div>
          <div class="card">
            <div class="card-header">
              <span class="card-icon">🌿</span>
              <span class="card-title">VCS</span>
            </div>
            <div class="card-value" id="vcs-branch" style="font-size:18px">Loading...</div>
            <div class="card-subtitle">Git Branch</div>
          </div>
        `;
      }

      // Update connected providers section
      const providersEl = document.getElementById('dashboard-providers');
      if (providersEl) {
        if (connectedProviders.length > 0) {
          const providerCards = allProviders
            .filter(p => connectedProviders.includes(p.id))
            .map(p => {
              const modelCount = Object.keys(p.models || {}).length;
              return `
                <div class="card cursor-pointer" onclick="Navigation.navigate('providers')">
                  <div class="card-header">
                    <span class="card-icon">⚡</span>
                    <span class="card-title">${Utils.esc(p.name || p.id)}</span>
                  </div>
                  <div class="card-subtitle">${modelCount} model${modelCount !== 1 ? 's' : ''} available</div>
                </div>
              `;
            }).join('');
          providersEl.innerHTML = `<div class="cards-grid">${providerCards}</div>`;
        } else {
          providersEl.innerHTML = `
            <div class="empty">
              <div class="empty-icon">🔌</div>
              <div>No providers connected</div>
              <div style="font-size:12px;color:var(--text3);margin-top:8px">Configure providers in settings</div>
            </div>
          `;
        }
      }

      // Update system info table
      const tableBody = document.querySelector('#system-info-table tbody');
      if (tableBody) {
        tableBody.innerHTML = `
          <tr><td style="font-weight:500">Home</td><td>${paths?.home || '—'}</td></tr>
          <tr><td style="font-weight:500">State</td><td>${paths?.state || '—'}</td></tr>
          <tr><td style="font-weight:500">Config</td><td>${paths?.config || '—'}</td></tr>
          <tr><td style="font-weight:500">Worktree</td><td>${paths?.worktree || '—'}</td></tr>
        `;
      }

      // Load VCS info
      Utils.api('/vcs').then(vcs => {
        const branchEl = document.getElementById('vcs-branch');
        if (branchEl) {
          branchEl.textContent = vcs.branch || 'N/A';
        }
      }).catch(() => {
        const branchEl = document.getElementById('vcs-branch');
        if (branchEl) {
          branchEl.textContent = 'N/A';
        }
      });

    } catch (error) {
      console.error('Failed to load dashboard:', error);
    }
  },

  // Providers page
  async providers() {
    const el = document.getElementById('providers-list');
    if (!el) return;

    // Ensure provider data is loaded
    let allProviders = Chat.getAllProviders();
    let connectedProviders = Chat.getConnectedProviders();
    if (!allProviders.length) {
      await Chat.loadProviders();
      allProviders = Chat.getAllProviders();
      connectedProviders = Chat.getConnectedProviders();
    }

    if (!allProviders.length) {
      el.innerHTML = `
        <div class="empty">
          <div class="empty-icon">🤖</div>
          <div>No providers available</div>
          <div style="font-size:0.8rem;color:var(--text3);margin-top:4px">Check your configuration or network connection</div>
        </div>
      `;
      return;
    }

    // --- Helper functions ---
    function formatCost(cost) {
      if (!cost) return '—';
      if (cost === 0) return 'Free';
      if (cost < 0.01) return '$' + cost.toFixed(4);
      return '$' + cost.toFixed(2);
    }

    function formatContext(limit) {
      if (!limit?.context) return '—';
      const ctx = limit.context;
      if (ctx >= 1000000) return (ctx / 1000000).toFixed(1) + 'M';
      if (ctx >= 1000) return Math.round(ctx / 1000) + 'k';
      return ctx.toString();
    }

    function getModelBadges(model) {
      const badges = [];
      if (model.cost && model.cost.input === 0 && model.cost.output === 0) badges.push('🆓 Free');
      if (model.reasoning) badges.push('🧠 Reasoning');
      if (model.tool_call) badges.push('🔧 Tools');
      if (model.attachment) badges.push('📎 Attachments');
      if (model.modalities?.input?.includes('image')) badges.push('🖼️ Vision');
      if (model.status === 'deprecated') badges.push('⚠️ Deprecated');
      if (model.status === 'beta') badges.push('🧪 Beta');
      return badges;
    }

    function hasFreeModels(provider) {
      return Object.values(provider.models || {}).some(m =>
        m.cost && m.cost.input === 0 && m.cost.output === 0
      );
    }

    // --- Filter state ---
    let searchTerm = '';
    let filterConnected = false;
    let filterFree = false;

    function getFiltered() {
      return allProviders.filter(p => {
        const name = (p.name || p.id).toLowerCase();
        const connected = connectedProviders.includes(p.id);
        if (searchTerm && !name.includes(searchTerm.toLowerCase())) return false;
        if (filterConnected && !connected) return false;
        if (filterFree && !hasFreeModels(p)) return false;
        return true;
      });
    }

    function render() {
      const filtered = getFiltered();
      const totalModels = allProviders.reduce((s, p) => s + Object.keys(p.models || {}).length, 0);
      const shownModels = filtered.reduce((s, p) => s + Object.keys(p.models || {}).length, 0);

      const filterInfoEl = document.getElementById('model-filter-info');
      if (filterInfoEl) {
        filterInfoEl.textContent = `${filtered.length} providers · ${shownModels} of ${totalModels} models`;
      }

      const tableBody = document.getElementById('providers-tbody');
      if (!tableBody) return;

      tableBody.innerHTML = filtered.map(p => {
        const connected = connectedProviders.includes(p.id);
        const models = Object.entries(p.models || {});
        const modelCount = models.length;
        const freeCount = models.filter(([, m]) => m.cost && m.cost.input === 0 && m.cost.output === 0).length;
        const envVars = (p.env || []).join(', ');

        // Summary badges for the main row
        const summaryBadges = [];
        if (freeCount > 0) summaryBadges.push(`<span class="badge badge-success" style="font-size:0.65rem;padding:2px 6px">🆓 ${freeCount} free</span>`);
        if (models.some(([, m]) => m.reasoning)) summaryBadges.push('<span class="badge badge-info" style="font-size:0.65rem;padding:2px 6px">🧠</span>');
        if (models.some(([, m]) => m.modalities?.input?.includes('image'))) summaryBadges.push('<span class="badge badge-info" style="font-size:0.65rem;padding:2px 6px">🖼️</span>');

        // Model detail rows (hidden by default)
        const modelRows = models
          .sort(([, a], [, b]) => (a.name || '').localeCompare(b.name || ''))
          .map(([modelId, m]) => {
            const badges = getModelBadges(m).map(b =>
              `<span class="badge badge-info" style="font-size:0.6rem;padding:2px 5px">${b}</span>`
            ).join(' ');
            return `
              <tr class="provider-model-row" data-provider="${Utils.esc(p.id)}" style="display:none">
                <td style="padding-left:40px;font-size:0.8rem;color:var(--text2)">${Utils.esc(m.name || modelId)}</td>
                <td style="font-size:0.75rem;font-family:var(--font-mono);color:var(--text3)">${Utils.esc(modelId)}</td>
                <td style="font-size:0.8rem;text-align:center">${formatContext(m.limit)}</td>
                <td style="font-size:0.75rem;text-align:center">
                  ${m.cost ? `${formatCost(m.cost.input)} / ${formatCost(m.cost.output)}` : '—'}
                </td>
                <td>${badges}</td>
              </tr>`;
          }).join('');

        return `
          <tr class="provider-main-row clickable" data-provider-id="${Utils.esc(p.id)}" title="Click to see models">
            <td style="font-weight:500">
              <div style="display:flex;align-items:center;gap:8px">
                <span class="provider-chevron" style="transition:transform 0.2s;display:inline-block;font-size:0.7rem;color:var(--text3)">▶</span>
                ${Utils.esc(p.name || p.id)}
              </div>
            </td>
            <td>
              <span class="badge ${connected ? 'badge-success' : 'badge-warning'}">
                ${connected ? 'Connected' : 'Available'}
              </span>
            </td>
            <td>${modelCount} model${modelCount !== 1 ? 's' : ''}</td>
            <td style="display:flex;gap:4px;flex-wrap:wrap">${summaryBadges.join('')}</td>
            <td>
              ${connected
            ? '<span class="badge badge-success" style="font-size:0.7rem">✓ Active</span>'
            : `<button class="btn btn-sm btn-secondary provider-connect-btn" data-provider="${Utils.esc(p.id)}" data-env="${Utils.esc(envVars)}" onclick="event.stopPropagation()">🔑 Connect</button>`
          }
            </td>
          </tr>
          ${modelRows}
          <tr class="provider-key-row" data-key-provider="${Utils.esc(p.id)}" style="display:none">
            <td colspan="5" style="padding:12px 40px;background:var(--bg3)">
              <div style="display:flex;align-items:center;gap:8px;max-width:500px">
                <label style="font-size:0.75rem;color:var(--text3);white-space:nowrap">${envVars ? Utils.esc(envVars) : 'API Key'}:</label>
                <input type="password" class="input" placeholder="Enter API key…" style="flex:1;font-size:0.8rem;padding:6px 10px" id="key-input-${Utils.esc(p.id)}">
                <button class="btn btn-sm btn-primary provider-save-key-btn" data-provider="${Utils.esc(p.id)}">Save</button>
                <button class="btn btn-sm btn-secondary provider-cancel-key-btn" data-provider="${Utils.esc(p.id)}">✕</button>
              </div>
              <div class="provider-key-msg" data-msg-provider="${Utils.esc(p.id)}" style="font-size:0.7rem;margin-top:6px;color:var(--text3)"></div>
            </td>
          </tr>
        `;
      }).join('');

      // Attach event listeners
      attachProviderListeners();
    }

    function attachProviderListeners() {
      // Expand/collapse model rows
      document.querySelectorAll('.provider-main-row').forEach(row => {
        row.addEventListener('click', () => {
          const pid = row.dataset.providerId;
          const modelRows = document.querySelectorAll(`.provider-model-row[data-provider="${pid}"]`);
          const chevron = row.querySelector('.provider-chevron');
          const isOpen = modelRows[0]?.style.display !== 'none';

          modelRows.forEach(r => r.style.display = isOpen ? 'none' : 'table-row');
          if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(90deg)';
        });
      });

      // Connect buttons → show key input row
      document.querySelectorAll('.provider-connect-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const pid = btn.dataset.provider;
          const keyRow = document.querySelector(`.provider-key-row[data-key-provider="${pid}"]`);
          if (keyRow) {
            keyRow.style.display = keyRow.style.display === 'none' ? 'table-row' : 'none';
            const input = document.getElementById(`key-input-${pid}`);
            if (input && keyRow.style.display !== 'none') input.focus();
          }
        });
      });

      // Cancel key input
      document.querySelectorAll('.provider-cancel-key-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const pid = btn.dataset.provider;
          const keyRow = document.querySelector(`.provider-key-row[data-key-provider="${pid}"]`);
          if (keyRow) keyRow.style.display = 'none';
        });
      });

      // Save key
      document.querySelectorAll('.provider-save-key-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const pid = btn.dataset.provider;
          const input = document.getElementById(`key-input-${pid}`);
          const msgEl = document.querySelector(`.provider-key-msg[data-msg-provider="${pid}"]`);

          if (!input?.value.trim()) {
            if (msgEl) { msgEl.textContent = 'Please enter an API key.'; msgEl.style.color = 'var(--danger)'; }
            return;
          }

          btn.disabled = true;
          btn.textContent = '…';
          try {
            await fetch(`${BASE}/provider/${pid}/key`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: input.value.trim() })
            });
            if (msgEl) { msgEl.textContent = '✓ API key saved! Reloading…'; msgEl.style.color = 'var(--success)'; }
            // Reload providers
            await Chat.loadProviders();
            setTimeout(() => PageLoaders.providers(), 500);
          } catch (err) {
            if (msgEl) { msgEl.textContent = '✕ Failed: ' + (err.message || 'Unknown error'); msgEl.style.color = 'var(--danger)'; }
          } finally {
            btn.disabled = false;
            btn.textContent = 'Save';
          }
        });
      });
    }

    // --- Build the full UI ---
    el.innerHTML = `
      <div class="provider-toolbar" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
        <input type="text" class="input" id="provider-search" placeholder="Search providers…" style="flex:1;min-width:180px;max-width:300px;font-size:0.85rem;padding:8px 12px">
        <span class="model-filter-badge" id="provider-filter-connected">Connected</span>
        <span class="model-filter-badge" id="provider-filter-free">Has Free Models</span>
      </div>
      <div class="table-container">
        <table class="table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Status</th>
              <th>Models</th>
              <th>Capabilities</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="providers-tbody"></tbody>
        </table>
      </div>
    `;

    // Wire up search + filter
    const searchInput = document.getElementById('provider-search');
    if (searchInput) {
      searchInput.addEventListener('input', Utils.debounce((e) => {
        searchTerm = e.target.value;
        render();
      }, 200));
    }

    const connBtn = document.getElementById('provider-filter-connected');
    if (connBtn) {
      connBtn.addEventListener('click', () => {
        filterConnected = !filterConnected;
        connBtn.classList.toggle('active', filterConnected);
        render();
      });
    }

    const freeBtn = document.getElementById('provider-filter-free');
    if (freeBtn) {
      freeBtn.addEventListener('click', () => {
        filterFree = !filterFree;
        freeBtn.classList.toggle('active', filterFree);
        render();
      });
    }

    // Initial render
    render();
  },

  // Agents page
  async agents() {
    try {
      const agents = await Utils.api('/agent');
      const el = document.getElementById('agents-list');
      if (!el) return;

      if (!agents.length) {
        el.innerHTML = `
          <div class="empty">
            <div class="empty-icon">🎯</div>
            <div>No agents found</div>
          </div>
        `;
        return;
      }

      el.innerHTML = `
        <div class="cards-grid">
          ${agents.map(a => `
            <div class="card">
              <div class="card-header">
                <span class="card-icon">🎯</span>
                <span class="card-title">${Utils.esc(a.name || a.id)}</span>
              </div>
              <p style="font-size:12px;color:var(--text2);line-height:1.5">
                ${Utils.esc((a.description || a.instructions || 'No description').substring(0, 120))}
              </p>
              ${a.tools?.length ? `
                <div style="margin-top:8px">
                  <span style="font-size:10px;color:var(--text3)">Tools: ${a.tools.length}</span>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `;
    } catch (error) {
      Utils.toast('Failed to load agents', 'error');
    }
  },

  // Tools page
  async tools() {
    try {
      const ids = await Utils.api('/experimental/tool/ids');
      const el = document.getElementById('tools-list');
      if (!el) return;

      el.innerHTML = `
        <div class="table-container">
          <table class="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Tool ID</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              ${ids.map((id, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td style="font-family:'JetBrains Mono';font-size:12px">${Utils.esc(id)}</td>
                  <td style="font-size:11px;color:var(--text3)">
                    ${id.includes('.') ? id.split('.').pop() : id}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (error) {
      Utils.toast('Failed to load tools', 'error');
    }
  },

  // MCP page
  async mcp() {
    try {
      const status = await Utils.api('/mcp');
      const el = document.getElementById('mcp-list');
      if (!el) return;

      const entries = Object.entries(status);

      if (!entries.length) {
        el.innerHTML = `
          <div class="empty">
            <div class="empty-icon">🔌</div>
            <div>No MCP servers configured</div>
          </div>
        `;
        return;
      }

      el.innerHTML = `
        <div class="table-container">
          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Tools</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${entries.map(([name, s]) => `
                <tr>
                  <td style="font-weight:500">${Utils.esc(name)}</td>
                  <td>
                    <span class="badge ${s.status === 'connected' ? 'badge-success' : s.status === 'error' ? 'badge-danger' : 'badge-warning'}">
                      ${s.status || 'unknown'}
                    </span>
                  </td>
                  <td>${(s.tools || []).length}</td>
                  <td>
                    ${s.status === 'connected' ?
          `<button class="btn btn-secondary btn-sm" onclick="mcpAction('${Utils.esc(name)}','disconnect')">Disconnect</button>` :
          `<button class="btn btn-primary btn-sm" onclick="mcpAction('${Utils.esc(name)}','connect')">Connect</button>`
        }
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (error) {
      Utils.toast('Failed to load MCP', 'error');
    }
  },

  // Config page
  async config() {
    try {
      const cfg = await Utils.api('/config');
      const editor = document.getElementById('config-editor');
      if (editor) {
        editor.value = JSON.stringify(cfg, null, 2);
      }
    } catch (error) {
      Utils.toast('Failed to load config', 'error');
    }
  },

  // Files page
  async files() {
    try {
      const files = await Utils.api('/file', { query: { path: Navigation.getCurrentFilePath() } });

      const currentPathEl = document.getElementById('current-path');
      if (currentPathEl) {
        currentPathEl.textContent = Navigation.getCurrentFilePath();
      }

      const el = document.getElementById('files-list');
      if (!el) return;

      if (!files.length) {
        el.innerHTML = `
          <div class="empty">
            <div class="empty-icon">📁</div>
            <div>Empty directory</div>
          </div>
        `;
        return;
      }

      const sorted = files.sort((a, b) =>
        (b.type === 'directory') - (a.type === 'directory') ||
        (a.name || '').localeCompare(b.name || '')
      );

      el.innerHTML = `
        <div class="table-container">
          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Size</th>
                <th>Modified</th>
              </tr>
            </thead>
            <tbody>
              ${sorted.map(f => `
                <tr onclick="${f.type === 'directory' ?
          `Navigation.navigateFiles('${Utils.esc(f.name)}')` :
          `Navigation.viewFile('${Utils.esc(f.path || f.name)}')`}" 
                  style="cursor:pointer">
                  <td>
                    <span style="margin-right:8px">${f.type === 'directory' ? '📁' : '📄'}</span>
                    ${Utils.esc(f.name)}
                  </td>
                  <td>${f.type}</td>
                  <td>${f.size != null ? Utils.formatSize(f.size) : '—'}</td>
                  <td style="font-size:11px;color:var(--text3)">
                    ${f.modified ? new Date(f.modified).toLocaleDateString() : '—'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (error) {
      Utils.toast('Failed to load files', 'error');
    }
  },

  // Events page (legacy, kept for backwards compat)
  events() { },

  // Skills page
  async skills() {
    const el = document.getElementById('skills-list');
    if (!el) return;

    try {
      const agents = await Utils.api('/agent');

      if (!agents || !agents.length) {
        el.innerHTML = `
          <div class="empty">
            <div class="empty-icon">⚡</div>
            <div>No skills found</div>
          </div>
        `;
        return;
      }

      // Filter out hidden agents
      const visible = agents.filter(a => !a.hidden);

      el.innerHTML = `
        <div class="cards-grid">
          ${visible.map(agent => {
        const modeColors = {
          primary: 'badge-success',
          subagent: 'badge-info',
          all: 'badge-warning'
        };
        const modeBadge = modeColors[agent.mode] || 'badge-info';
        const modelInfo = agent.model
          ? `<span style="font-family:var(--font-mono);font-size:0.7rem;color:var(--text3)">${Utils.esc(agent.model.providerID)}/${Utils.esc(agent.model.modelID)}</span>`
          : '<span style="font-size:0.7rem;color:var(--text3)">Default model</span>';

        // Count permissions
        const permCount = (agent.permission || []).length;

        return `
              <div class="card skill-card" style="cursor:default">
                <div class="card-header">
                  <span class="card-icon" style="background:${agent.color ? agent.color + '20' : 'var(--success-bg)'};font-size:20px;display:flex;align-items:center;justify-content:center">
                    ${agent.mode === 'primary' ? '🎯' : agent.mode === 'subagent' ? '🔗' : '⚡'}
                  </span>
                  <div>
                    <div class="card-title">${Utils.esc(agent.name)}</div>
                    <div style="display:flex;gap:4px;margin-top:4px">
                      <span class="badge ${modeBadge}" style="font-size:0.6rem;padding:2px 6px">${Utils.esc(agent.mode)}</span>
                      ${agent.native ? '<span class="badge badge-info" style="font-size:0.6rem;padding:2px 6px">Built-in</span>' : '<span class="badge badge-warning" style="font-size:0.6rem;padding:2px 6px">Custom</span>'}
                    </div>
                  </div>
                </div>
                <div class="card-subtitle" style="margin-top:8px;min-height:32px">${Utils.esc(agent.description || 'No description')}</div>
                <div style="margin-top:12px;padding-top:8px;border-top:1px solid var(--glass-border);display:flex;justify-content:space-between;align-items:center">
                  ${modelInfo}
                  <span style="font-size:0.65rem;color:var(--text3)">${permCount} rules</span>
                </div>
                ${agent.temperature != null || agent.steps != null ? `
                  <div style="margin-top:6px;display:flex;gap:8px">
                    ${agent.temperature != null ? `<span class="badge badge-info" style="font-size:0.55rem;padding:1px 4px">temp: ${agent.temperature}</span>` : ''}
                    ${agent.steps != null ? `<span class="badge badge-info" style="font-size:0.55rem;padding:1px 4px">steps: ${agent.steps}</span>` : ''}
                  </div>
                ` : ''}
              </div>
            `;
      }).join('')}
        </div>
      `;
    } catch (error) {
      console.error('Failed to load skills:', error);
      el.innerHTML = `
        <div class="empty">
          <div class="empty-icon">⚠️</div>
          <div>Failed to load skills</div>
        </div>
      `;
    }
  }
};

// Export page loaders
window.PageLoaders = PageLoaders;