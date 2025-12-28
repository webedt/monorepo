/**
 * Main Entry Point
 * WebEDT - AI-Powered Code Editor
 */

import './styles/index.css';
import { router } from './lib/router';
import { theme, THEMES, THEME_META } from './lib/theme';
import type { Theme } from './lib/theme';
import { IconButton, Button } from './components';
import { authStore } from './stores/authStore';
import { TAGLINES } from './constants/taglines';
import { getVersion, getVersionSHA, getVersionTimestamp, GITHUB_REPO_URL } from './version';
import {
  LoginPage,
  RegisterPage,
  DashboardPage,
  AgentsPage,
  SettingsPage,
  ChatPage,
  CodePage,
  TrashPage,
  QuickAccessPage,
  WidgetsPage,
  StorePage,
  GameDetailPage,
  LibraryPage,
  CommunityPage,
} from './pages';

import { Page, type PageOptions } from './pages/base/Page';

/**
 * Get SVG icon for navigation
 */
function getNavIcon(name: string): string {
  const icons: Record<string, string> = {
    'cpu': `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>`,
    'layout-dashboard': `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>`,
    'zap': `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
    'widgets': `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
    'store': `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    'library': `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
    'community': `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  };
  return icons[name] || '';
}

// Type for Page constructor
type PageConstructor = new (options?: PageOptions) => Page;

// Current page instance
let currentPage: Page | null = null;

// Tagline state
let taglineIndex = Math.floor(Math.random() * TAGLINES.length);
let showVersionDetails = false;

/**
 * Get a random tagline
 */
function getTagline(): string {
  return TAGLINES[taglineIndex];
}

/**
 * Pick a new random tagline
 */
function nextTagline(): void {
  taglineIndex = Math.floor(Math.random() * TAGLINES.length);
  updateLogoTagline();
}

/**
 * Toggle version details display
 */
function toggleVersionDetails(): void {
  showVersionDetails = !showVersionDetails;
  updateLogoTagline();
}

/**
 * Get short SHA for display
 */
function getShortSha(): string {
  const sha = getVersionSHA();
  return sha?.substring(0, 7) ?? 'unknown';
}

/**
 * Format timestamp for display
 */
function getFormattedTimestamp(): string {
  const timestamp = getVersionTimestamp();
  if (!timestamp) return '';

  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  });
}

/**
 * Update the logo tagline and version display
 */
function updateLogoTagline(): void {
  const taglineEl = document.getElementById('app-tagline');
  const versionEl = document.getElementById('app-version');
  const githubLink = document.getElementById('app-github-link');

  if (taglineEl) {
    taglineEl.textContent = getTagline();
  }

  if (versionEl) {
    if (showVersionDetails) {
      const formattedTime = getFormattedTimestamp();
      versionEl.textContent = formattedTime
        ? `${getShortSha()} [${formattedTime}]`
        : getShortSha();
    } else {
      versionEl.textContent = `v${getVersion()}`;
    }
  }

  if (githubLink) {
    githubLink.style.display = showVersionDetails ? 'inline-flex' : 'none';
  }
}

/**
 * Create the app layout
 */
function createLayout(): HTMLElement {
  const app = document.createElement('div');
  app.className = 'app-layout';

  // Header
  const header = document.createElement('header');
  header.className = 'app-header';
  header.innerHTML = `
    <div class="app-header-content">
      <div class="app-logo-container">
        <a href="#/agents" class="app-logo">
          <span class="app-logo-text">WebEDT</span>
        </a>
        <div class="app-tagline" id="app-tagline">${getTagline()}</div>
        <div class="app-version-row">
          <span class="app-version" id="app-version">v${getVersion()}</span>
          <a href="${GITHUB_REPO_URL}" target="_blank" rel="noopener noreferrer" class="app-github-link" id="app-github-link" style="display: none;">
            <svg width="10" height="10" fill="currentColor" viewBox="0 0 16 16">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
          </a>
        </div>
      </div>
      <nav class="app-nav" id="app-nav"></nav>
      <div class="app-header-actions" id="header-actions"></div>
    </div>
  `;

  // Add click handlers for tagline and version
  const taglineEl = header.querySelector('#app-tagline');
  const versionEl = header.querySelector('#app-version');

  if (taglineEl) {
    taglineEl.addEventListener('click', nextTagline);
  }

  if (versionEl) {
    versionEl.addEventListener('click', toggleVersionDetails);
  }

  // Main content area
  const main = document.createElement('main');
  main.className = 'app-main';
  main.id = 'app-outlet';

  app.appendChild(header);
  app.appendChild(main);

  return app;
}

/**
 * Create the theme dropdown menu
 */
function createThemeDropdown(): HTMLElement {
  const currentTheme = theme.getTheme();
  const meta = THEME_META[currentTheme];

  const container = document.createElement('div');
  container.className = 'theme-dropdown';

  // Trigger button (shows emoji only when collapsed)
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'theme-dropdown-trigger';
  trigger.setAttribute('aria-label', 'Select theme');
  trigger.innerHTML = `<span class="theme-dropdown-emoji">${meta.emoji}</span>`;

  // Dropdown menu
  const menu = document.createElement('div');
  menu.className = 'theme-dropdown-menu';

  // Current theme header
  const header = document.createElement('div');
  header.className = 'theme-dropdown-header';
  header.innerHTML = `
    <span class="theme-dropdown-current-emoji">${meta.emoji}</span>
    <span class="theme-dropdown-current-label">${meta.label}</span>
  `;
  menu.appendChild(header);

  // Separator
  const separator = document.createElement('div');
  separator.className = 'theme-dropdown-separator';
  menu.appendChild(separator);

  // Theme options
  const optionsList = document.createElement('div');
  optionsList.className = 'theme-dropdown-options';

  for (const themeName of THEMES) {
    const themeMeta = THEME_META[themeName];
    const option = document.createElement('button');
    option.type = 'button';
    option.className = `theme-dropdown-option ${themeName === currentTheme ? 'active' : ''}`;
    option.dataset.theme = themeName;
    option.innerHTML = `
      <span class="theme-option-emoji">${themeMeta.emoji}</span>
      <span class="theme-option-label">${themeMeta.label}</span>
    `;
    option.addEventListener('click', () => {
      theme.setTheme(themeName as Theme);
      menu.classList.remove('open');
      updateHeader();
    });
    optionsList.appendChild(option);
  }
  menu.appendChild(optionsList);

  container.appendChild(trigger);
  container.appendChild(menu);

  // Toggle menu on trigger click
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target as Node)) {
      menu.classList.remove('open');
    }
  });

  return container;
}

/**
 * Update the header based on auth state
 */
function updateHeader(): void {
  const nav = document.getElementById('app-nav');
  const actions = document.getElementById('header-actions');

  if (!nav || !actions) return;

  // Clear existing content
  nav.innerHTML = '';
  actions.innerHTML = '';

  const isAuthenticated = authStore.isAuthenticated();

  // Nav links for all users (store is public)
  const publicNavLinks = [
    { path: '/store', text: 'Store', icon: 'store' },
    { path: '/community', text: 'Community', icon: 'community' },
  ];

  for (const link of publicNavLinks) {
    const a = document.createElement('a');
    a.href = `#${link.path}`;
    a.className = 'nav-link';

    const iconSvg = getNavIcon(link.icon);
    a.innerHTML = `${iconSvg}<span>${link.text}</span>`;

    if (window.location.hash === `#${link.path}`) {
      a.classList.add('active');
    }

    nav.appendChild(a);
  }

  if (isAuthenticated) {
    // Nav links for authenticated users with icons
    const navLinks = [
      { path: '/library', text: 'Library', icon: 'library' },
      { path: '/quick-access', text: 'Quick', icon: 'zap' },
      { path: '/agents', text: 'Agents', icon: 'cpu' },
      { path: '/widgets', text: 'Widgets', icon: 'widgets' },
      { path: '/dashboard', text: 'Dashboard', icon: 'layout-dashboard' },
    ];

    for (const link of navLinks) {
      const a = document.createElement('a');
      a.href = `#${link.path}`;
      a.className = 'nav-link';

      // Add icon
      const iconSvg = getNavIcon(link.icon);
      a.innerHTML = `${iconSvg}<span>${link.text}</span>`;

      // Mark active link
      if (window.location.hash === `#${link.path}`) {
        a.classList.add('active');
      }

      nav.appendChild(a);
    }

    // Settings icon
    const settingsBtn = new IconButton('settings', {
      label: 'Settings',
      onClick: () => router.navigate('/settings'),
    });
    actions.appendChild(settingsBtn.getElement());
  }

  // Theme dropdown
  const themeDropdown = createThemeDropdown();
  actions.appendChild(themeDropdown);

  // Auth button
  if (!isAuthenticated) {
    const loginBtn = new Button('Sign In', {
      variant: 'primary',
      size: 'sm',
      onClick: () => router.navigate('/login'),
    });
    actions.appendChild(loginBtn.getElement());
  }
}

/**
 * 404 page component
 */
function NotFoundPage(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'not-found-page';
  container.innerHTML = `
    <h1>404</h1>
    <p>Page not found</p>
    <a href="#/agents" class="btn btn--primary">Go to Agent Sessions</a>
  `;
  return container;
}

/**
 * Add app-specific styles
 */
function addAppStyles(): void {
  const style = document.createElement('style');
  style.textContent = `
    .app-layout {
      display: flex;
      flex-direction: column;
      height: 100vh;
      max-height: 100vh;
      overflow: hidden;
    }

    .app-header {
      position: sticky;
      top: 0;
      z-index: var(--z-sticky);
      background-color: var(--color-bg-primary);
      border-bottom: 1px solid var(--color-border);
    }

    .app-header-content {
      display: flex;
      align-items: center;
      gap: var(--spacing-lg);
      max-width: 1400px;
      margin: 0 auto;
      padding: var(--spacing-md) var(--spacing-lg);
    }

    .app-logo-container {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0;
    }

    .app-logo {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      text-decoration: none;
      line-height: 1.2;
    }

    .app-logo-text {
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
    }

    .app-tagline {
      font-size: 10px;
      color: var(--color-text-secondary);
      font-style: italic;
      cursor: pointer;
      transition: color var(--transition-fast);
      line-height: 1.2;
    }

    .app-tagline:hover {
      color: var(--color-text-primary);
    }

    .app-version-row {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .app-version {
      font-size: 9px;
      color: var(--color-text-secondary);
      cursor: pointer;
      transition: color var(--transition-fast);
      line-height: 1.2;
    }

    .app-version:hover {
      color: var(--color-text-primary);
    }

    .app-github-link {
      display: inline-flex;
      align-items: center;
      color: var(--color-text-secondary);
      transition: color var(--transition-fast);
    }

    .app-github-link:hover {
      color: var(--color-text-primary);
    }

    .app-nav {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1.5rem;
      flex: 1;
    }

    .nav-link {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      color: var(--color-text-secondary);
      text-decoration: none;
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      transition: color var(--transition-fast), background var(--transition-fast);
    }

    .nav-link svg {
      flex-shrink: 0;
    }

    .nav-link:hover {
      color: var(--color-text-primary);
      background: var(--color-bg-hover);
    }

    .nav-link.active {
      color: var(--color-primary);
      background: var(--color-primary-bg);
    }

    .app-header-actions {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
    }

    .app-main {
      flex: 1;
      min-height: 0; /* Allow flex item to shrink below content */
      display: flex;
      flex-direction: column;
      overflow: hidden; /* Prevent content from expanding beyond viewport */
      background: var(--color-bg-secondary);
    }

    .app-main > * {
      flex: 1;
      min-height: 0;
    }

    .app-main .page {
      display: flex;
      flex-direction: column;
      overflow: hidden; /* Contain children within page bounds */
    }

    /* Hide empty divs created by router */
    .app-main > div:empty {
      display: none;
    }

    .not-found-page {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-md);
      padding: var(--spacing-2xl) 0;
      text-align: center;
      min-height: 60vh;
    }

    .not-found-page h1 {
      font-size: 6rem;
      font-weight: var(--font-weight-bold);
      color: var(--color-text-muted);
      margin: 0;
    }

    .not-found-page p {
      font-size: var(--font-size-xl);
      color: var(--color-text-secondary);
      margin: 0;
    }

    /* Theme Dropdown */
    .theme-dropdown {
      position: relative;
    }

    .theme-dropdown-trigger {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      padding: 0;
      border: none;
      border-radius: var(--radius-md);
      background: transparent;
      color: var(--color-text-secondary);
      cursor: pointer;
      transition: color var(--transition-fast), background var(--transition-fast);
    }

    .theme-dropdown-trigger:hover {
      color: var(--color-text-primary);
      background: var(--color-bg-hover);
    }

    .theme-dropdown-emoji {
      font-size: 18px;
      line-height: 1;
    }

    .theme-dropdown-menu {
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      min-width: 160px;
      padding: var(--spacing-sm);
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      opacity: 0;
      visibility: hidden;
      transform: translateY(-8px);
      transition: opacity var(--transition-fast), transform var(--transition-fast), visibility var(--transition-fast);
      z-index: var(--z-dropdown);
    }

    .theme-dropdown-menu.open {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
    }

    .theme-dropdown-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-xs) var(--spacing-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
    }

    .theme-dropdown-current-emoji {
      font-size: 16px;
      line-height: 1;
    }

    .theme-dropdown-current-label {
      font-size: var(--font-size-sm);
    }

    .theme-dropdown-separator {
      height: 1px;
      margin: var(--spacing-sm) 0;
      background: var(--color-border);
    }

    .theme-dropdown-options {
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-height: 280px;
      overflow-y: auto;
    }

    .theme-dropdown-option {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      width: 100%;
      padding: var(--spacing-xs) var(--spacing-sm);
      border: none;
      border-radius: var(--radius-md);
      background: transparent;
      color: var(--color-text-secondary);
      cursor: pointer;
      text-align: left;
      transition: color var(--transition-fast), background var(--transition-fast);
    }

    .theme-dropdown-option:hover {
      color: var(--color-text-primary);
      background: var(--color-bg-hover);
    }

    .theme-dropdown-option.active {
      color: var(--color-primary);
      background: var(--color-primary-bg);
    }

    .theme-option-emoji {
      font-size: 14px;
      line-height: 1;
      width: 20px;
      text-align: center;
    }

    .theme-option-label {
      font-size: var(--font-size-sm);
    }
  `;
  document.head.appendChild(style);
}

/**
 * Mount a page to the outlet
 */
function mountPage(PageClass: PageConstructor, params: Record<string, string> = {}): void {
  const outlet = document.getElementById('app-outlet');
  if (!outlet) return;

  // Unmount current page
  if (currentPage) {
    currentPage.unmount();
    currentPage = null;
  }

  // Create query params
  const hash = window.location.hash.slice(1);
  const queryIndex = hash.indexOf('?');
  const query = queryIndex >= 0 ? new URLSearchParams(hash.slice(queryIndex + 1)) : new URLSearchParams();

  // Create and mount new page
  const page = new PageClass({ params, query });

  // Check access
  if (!page.canAccess()) {
    // Redirect to login
    router.navigate('/login');
    return;
  }

  outlet.innerHTML = '';
  page.mount(outlet);
  currentPage = page;

  // Load page data
  page.load();

  // Update header
  updateHeader();
}

/**
 * Initialize the application
 */
async function init(): Promise<void> {
  const appElement = document.getElementById('app');
  if (!appElement) {
    console.error('App element not found');
    return;
  }

  // Add app styles
  addAppStyles();

  // Create and mount layout
  const layout = createLayout();
  appElement.appendChild(layout);

  // Initialize auth
  await authStore.initialize();

  // Subscribe to auth changes
  authStore.subscribe(() => updateHeader());

  // Setup router
  router
    .setOutlet('#app-outlet')
    .setNotFound(NotFoundPage)
    .register([
      {
        path: '/',
        component: () => {
          // Redirect to agents or login
          if (authStore.isAuthenticated()) {
            router.navigate('/agents');
          } else {
            router.navigate('/login');
          }
          return document.createElement('div');
        },
      },
      {
        path: '/login',
        component: () => {
          mountPage(LoginPage);
          return document.createElement('div');
        },
        title: 'Login | WebEDT',
      },
      {
        path: '/register',
        component: () => {
          mountPage(RegisterPage);
          return document.createElement('div');
        },
        title: 'Register | WebEDT',
      },
      {
        path: '/dashboard',
        component: () => {
          mountPage(DashboardPage);
          return document.createElement('div');
        },
        title: 'Dashboard | WebEDT',
        guard: () => authStore.isAuthenticated(),
      },
      {
        path: '/agents',
        component: () => {
          mountPage(AgentsPage);
          return document.createElement('div');
        },
        title: 'Agent Sessions | WebEDT',
        guard: () => authStore.isAuthenticated(),
      },
      {
        path: '/trash',
        component: () => {
          mountPage(TrashPage);
          return document.createElement('div');
        },
        title: 'Trash | WebEDT',
        guard: () => authStore.isAuthenticated(),
      },
      {
        path: '/quick-access',
        component: () => {
          mountPage(QuickAccessPage);
          return document.createElement('div');
        },
        title: 'Quick Access | WebEDT',
        guard: () => authStore.isAuthenticated(),
      },
      {
        path: '/settings',
        component: () => {
          mountPage(SettingsPage);
          return document.createElement('div');
        },
        title: 'Settings | WebEDT',
        guard: () => authStore.isAuthenticated(),
      },
      {
        path: '/widgets',
        component: () => {
          mountPage(WidgetsPage);
          return document.createElement('div');
        },
        title: 'Widgets | WebEDT',
        guard: () => authStore.isAuthenticated(),
      },
      {
        path: '/session/:sessionId/chat',
        component: (params) => {
          mountPage(ChatPage, params);
          return document.createElement('div');
        },
        title: 'Chat | WebEDT',
        guard: () => authStore.isAuthenticated(),
      },
      {
        path: '/session/:sessionId/code',
        component: (params) => {
          mountPage(CodePage, params);
          return document.createElement('div');
        },
        title: 'Code | WebEDT',
        guard: () => authStore.isAuthenticated(),
      },
      // Players feature routes
      {
        path: '/store',
        component: () => {
          mountPage(StorePage);
          return document.createElement('div');
        },
        title: 'Store | WebEDT',
      },
      {
        path: '/game/:id',
        component: (params) => {
          mountPage(GameDetailPage, params);
          return document.createElement('div');
        },
        title: 'Game Details | WebEDT',
      },
      {
        path: '/library',
        component: () => {
          mountPage(LibraryPage);
          return document.createElement('div');
        },
        title: 'My Library | WebEDT',
        guard: () => authStore.isAuthenticated(),
      },
      {
        path: '/community',
        component: () => {
          mountPage(CommunityPage);
          return document.createElement('div');
        },
        title: 'Community | WebEDT',
      },
    ])
    .start();

  // Update header
  updateHeader();

  console.log('WebEDT initialized');
}

// Start the app
init();
