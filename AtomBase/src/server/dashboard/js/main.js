// ===== MAIN INITIALIZATION =====

// Global state
window.AppState = {
  isInitialized: false,
  isMobile: false,
  isTablet: false,
  isDesktop: false,
  isSidebarOpen: false,
  currentTheme: "dark",
  sidebarCollapsed: false,
}

// Initialize application
async function initApp() {
  try {
    console.log("Initializing AtomCLI Dashboard...")

    // Setup hamburger menu
    setupHamburgerMenu()

    // Check viewport
    updateViewportState()

    // Initialize utilities
    if (typeof Utils !== "undefined") {
      console.log("Utilities initialized")
    }

    // Initialize navigation
    if (typeof Navigation !== "undefined") {
      Navigation.init()
      console.log("Navigation initialized")
    }

    // Initialize chat
    if (typeof Chat !== "undefined") {
      Chat.init()
      console.log("Chat initialized")
    }

    // Initialize modal
    if (typeof Modal !== "undefined") {
      Modal.init()
      console.log("Modal initialized")
    }

    // Initialize SSE
    if (typeof SSE !== "undefined") {
      SSE.init()
      console.log("SSE initialized")
    }

    // Setup refresh button
    setupRefreshButton()

    // Load initial health info
    loadInitialHealth()

    // Setup window resize handler
    window.addEventListener("resize", Utils.throttle(handleResize, 250))

    // Setup beforeunload handler
    window.addEventListener("beforeunload", handleBeforeUnload)

    // Mark as initialized
    AppState.isInitialized = true

    console.log("AtomCLI Dashboard initialized successfully")
  } catch (error) {
    console.error("Failed to initialize application:", error)
    Utils.toast("Failed to initialize dashboard", "error")
  }
}

// Setup hamburger menu
function setupHamburgerMenu() {
  const hamburgerBtn = document.getElementById("hamburger-btn")
  const sidebarOverlay = document.getElementById("sidebar-overlay")
  const sidebar = document.querySelector(".sidebar")

  if (hamburgerBtn) {
    hamburgerBtn.addEventListener("click", toggleMobileSidebar)
  }

  if (sidebarOverlay) {
    sidebarOverlay.addEventListener("click", closeMobileSidebar)
  }

  // Close sidebar on navigation (mobile)
  if (sidebar) {
    sidebar.querySelectorAll(".nav-item").forEach((item) => {
      item.addEventListener("click", () => {
        if (AppState.isMobile) {
          closeMobileSidebar()
        }
      })
    })
  }

  // Close sidebar when clicking outside (global listener)
  document.addEventListener("click", (e) => {
    if (AppState.isMobile && AppState.isSidebarOpen) {
      const inSidebar = sidebar ? sidebar.contains(e.target) : false;
      const inHamburger = hamburgerBtn ? hamburgerBtn.contains(e.target) : false;

      if (!inSidebar && !inHamburger) {
        closeMobileSidebar();
      }
    }
  });
}

// Toggle mobile sidebar
function toggleMobileSidebar() {
  const hamburgerBtn = document.getElementById("hamburger-btn")
  const sidebar = document.querySelector(".sidebar")
  const sidebarOverlay = document.getElementById("sidebar-overlay")

  if (!sidebar) return

  AppState.isSidebarOpen = !AppState.isSidebarOpen

  if (AppState.isSidebarOpen) {
    sidebar.classList.add("mobile-open")
    sidebar.classList.remove("mobile-closed")
    if (sidebarOverlay) {
      sidebarOverlay.classList.add("active")
    }
    if (hamburgerBtn) {
      hamburgerBtn.classList.add("active")
    }
    document.body.style.overflow = "hidden"
  } else {
    sidebar.classList.remove("mobile-open")
    sidebar.classList.add("mobile-closed")
    if (sidebarOverlay) {
      sidebarOverlay.classList.remove("active")
    }
    if (hamburgerBtn) {
      hamburgerBtn.classList.remove("active")
    }
    document.body.style.overflow = ""
  }
}

// Close mobile sidebar
function closeMobileSidebar() {
  const hamburgerBtn = document.getElementById("hamburger-btn")
  const sidebar = document.querySelector(".sidebar")
  const sidebarOverlay = document.getElementById("sidebar-overlay")

  if (!sidebar) return

  AppState.isSidebarOpen = false
  sidebar.classList.remove("mobile-open")
  sidebar.classList.add("mobile-closed")
  if (sidebarOverlay) {
    sidebarOverlay.classList.remove("active")
  }
  if (hamburgerBtn) {
    hamburgerBtn.classList.remove("active")
  }
  document.body.style.overflow = ""
}

// Update viewport state
function updateViewportState() {
  AppState.isMobile = Utils.isMobile()
  AppState.isTablet = Utils.isTablet()
  AppState.isDesktop = Utils.isDesktop()

  // Update body class for responsive styling
  document.body.classList.toggle("is-mobile", AppState.isMobile)
  document.body.classList.toggle("is-tablet", AppState.isTablet)
  document.body.classList.toggle("is-desktop", AppState.isDesktop)

  // Update sidebar state for mobile
  const sidebar = document.querySelector(".sidebar")
  if (sidebar && AppState.isMobile) {
    sidebar.classList.add("mobile-closed")
    sidebar.classList.remove("collapsed")
  } else if (sidebar && !AppState.isMobile) {
    sidebar.classList.remove("mobile-closed")
    sidebar.classList.remove("mobile-open")
  }
}

// Handle window resize
function handleResize() {
  updateViewportState()

  // Close mobile sidebar when resizing to desktop
  if (!AppState.isMobile && AppState.isSidebarOpen) {
    closeMobileSidebar()
  }

  // Re-initialize components if needed
  if (AppState.isMobile !== Utils.isMobile()) {
    updateMobileUI()
  }
}

// Update mobile UI
function updateMobileUI() {
  // Add mobile-specific UI adjustments here
  const sidebar = document.querySelector(".sidebar")
  const main = document.querySelector(".main")

  if (AppState.isMobile) {
    // Mobile optimizations
    if (sidebar) {
      sidebar.classList.add("mobile-closed")
      sidebar.classList.remove("collapsed")
    }
  } else {
    // Desktop/tablet restore
    if (sidebar) {
      sidebar.classList.remove("mobile-closed")
      sidebar.classList.remove("mobile-open")
    }
  }
}

// Load initial health info
async function loadInitialHealth() {
  try {
    const health = await Utils.api("/global/health")

    // Update sidebar version
    const versionEl = document.getElementById("sidebar-version")
    if (versionEl) {
      versionEl.textContent = "v" + (health.version || "?")
    }

    // Update connection status (both mobile and desktop)
    if (health.healthy) {
      const statusDots = [
        document.getElementById("mobile-status-dot"),
        document.getElementById("desktop-status-dot"),
      ]
      const statusTexts = [
        document.getElementById("mobile-status-text"),
        document.getElementById("desktop-status-text"),
      ]

      statusDots.forEach((dot) => {
        if (dot) dot.style.background = "var(--success)"
      })
      statusTexts.forEach((text) => {
        if (text) text.textContent = "Connected"
      })
    }
  } catch (error) {
    console.error("Failed to load health info:", error)
  }
}

// Handle beforeunload
function handleBeforeUnload(event) {
  // Clean up resources
  if (window.SSE && window.SSE.getStatus() === "active") {
    // SSE will automatically reconnect, but we can clean up if needed
  }

  // Save any unsaved state
  saveAppState()
}

// Save app state to localStorage
function saveAppState() {
  const state = {
    currentPage: Navigation.getCurrentPage(),
    currentSession: Navigation.getCurrentSession(),
    currentFilePath: Navigation.getCurrentFilePath(),
    modelFilter: Chat.getModelFilter(),
    sidebarCollapsed: AppState.sidebarCollapsed,
    theme: AppState.currentTheme,
    lastVisited: new Date().toISOString(),
  }

  Utils.storage.set("atomcli-dashboard-state", state)
}

// Load app state from localStorage
function loadAppState() {
  const state = Utils.storage.get("atomcli-dashboard-state")

  if (state) {
    // Restore navigation state
    if (state.currentPage && state.currentPage !== Navigation.getCurrentPage()) {
      Navigation.navigate(state.currentPage)
    }

    if (state.currentSession) {
      Navigation.setCurrentSession(state.currentSession)
    }

    if (state.currentFilePath) {
      Navigation.setCurrentFilePath(state.currentFilePath)
    }

    // Restore sidebar state
    if (state.sidebarCollapsed) {
      toggleSidebar(true)
    }

    // Restore theme
    if (state.theme && state.theme !== AppState.currentTheme) {
      setTheme(state.theme)
    }
  }
}

// Toggle sidebar collapse
function toggleSidebar(collapsed = null) {
  const sidebar = document.querySelector(".sidebar")
  if (!sidebar) return

  AppState.sidebarCollapsed = collapsed !== null ? collapsed : !AppState.sidebarCollapsed

  if (AppState.sidebarCollapsed) {
    sidebar.classList.add("collapsed")
    sidebar.style.width = "60px"
  } else {
    sidebar.classList.remove("collapsed")
    sidebar.style.width = AppState.isTablet ? "80px" : "260px"
  }

  // Save state
  saveAppState()
}

// Set theme
function setTheme(theme) {
  if (!["dark", "light"].includes(theme)) return

  AppState.currentTheme = theme
  document.body.setAttribute("data-theme", theme)

  // Save state
  saveAppState()
}

// Toggle theme
function toggleTheme() {
  const newTheme = AppState.currentTheme === "dark" ? "light" : "dark"
  setTheme(newTheme)
}

// Refresh page
function refreshPage() {
  window.location.reload()
}

// Setup refresh button
function setupRefreshButton() {
  const refreshBtn = document.querySelector('.topbar-btn[onclick*="refresh"]')
  if (refreshBtn) {
    refreshBtn.addEventListener("click", refreshPage)
  }
}

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  // Load saved state first
  if (typeof Utils !== "undefined") {
    loadAppState()
  }

  // Initialize app
  setTimeout(initApp, 100)
})

// Export main functions
window.App = {
  init: initApp,
  toggleSidebar,
  toggleMobileSidebar,
  closeMobileSidebar,
  setTheme,
  toggleTheme,
  refreshPage,
  getState: () => AppState,
  saveState: saveAppState,
  loadState: loadAppState,
}
