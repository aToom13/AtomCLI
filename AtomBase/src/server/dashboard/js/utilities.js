// ===== UTILITIES =====
const BASE = window.location.origin;

// API wrapper
// API wrapper
async function api(path, opts = {}) {
  const url = new URL(path, BASE);
  if (opts.query) {
    Object.entries(opts.query).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  }

  console.log(`[API] Fetching ${url.toString()}`, opts);

  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[API] Error ${res.status}: ${text}`);
      throw new Error(`API ${res.status}: ${text}`);
    }

    const ct = res.headers.get('content-type');
    const data = ct && ct.includes('json') ? await res.json() : await res.text();
    console.log(`[API] Success ${path}`, data);
    return data;
  } catch (error) {
    console.error(`[API] Failed ${path}`, error);
    throw error;
  }
}

// Toast notifications
function toast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toastEl = document.createElement('div');
  toastEl.className = `toast toast-${type}`;
  toastEl.textContent = msg;
  container.appendChild(toastEl);

  setTimeout(() => {
    if (toastEl.parentNode === container) {
      container.removeChild(toastEl);
    }
  }, 3000);
}

// Escape HTML
function esc(s) {
  if (!s) return '';
  const div = document.createElement('div');
  div.textContent = String(s);
  return div.innerHTML;
}

// Format file size
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// Debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Throttle function
function throttle(func, limit) {
  let inThrottle;
  return function () {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// Generate unique ID
function generateId(length = 8) {
  return Math.random().toString(36).substring(2, 2 + length);
}

// Check if mobile
function isMobile() {
  return window.innerWidth <= 768;
}

// Check if tablet
function isTablet() {
  return window.innerWidth > 768 && window.innerWidth <= 1024;
}

// Check if desktop
function isDesktop() {
  return window.innerWidth > 1024;
}

// Local storage helpers
const storage = {
  get(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch {
      return defaultValue;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  remove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },

  clear() {
    try {
      localStorage.clear();
      return true;
    } catch {
      return false;
    }
  }
};

// Export utilities
window.Utils = {
  api,
  toast,
  esc,
  formatSize,
  debounce,
  throttle,
  generateId,
  isMobile,
  isTablet,
  isDesktop,
  storage
};