/**
 * Main Entry Point
 * WebEDT - AI-Powered Code Editor
 */

import './styles/index.css';
import { router } from './lib/router';
import { theme } from './lib/theme';
import { IconButton, Button } from './components';
import { authStore } from './stores/authStore';
import {
  LoginPage,
  RegisterPage,
  DashboardPage,
  AgentsPage,
  SettingsPage,
  ChatPage,
  CodePage,
} from './pages';

import { Page, type PageOptions } from './pages/base/Page';

// Type for Page constructor
type PageConstructor = new (options?: PageOptions) => Page;

// Current page instance
let currentPage: Page | null = null;

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
      <a href="#/agents" class="app-logo">
        <span class="app-logo-text">WebEDT</span>
      </a>
      <nav class="app-nav" id="app-nav"></nav>
      <div class="app-header-actions" id="header-actions"></div>
    </div>
  `;

  // Main content area
  const main = document.createElement('main');
  main.className = 'app-main';
  main.id = 'app-outlet';

  app.appendChild(header);
  app.appendChild(main);

  return app;
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

  if (isAuthenticated) {
    // Nav links for authenticated users
    const navLinks = [
      { path: '/agents', text: 'Agent Sessions' },
      { path: '/dashboard', text: 'Dashboard' },
    ];

    for (const link of navLinks) {
      const a = document.createElement('a');
      a.href = `#${link.path}`;
      a.className = 'nav-link';
      a.textContent = link.text;

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

  // Theme toggle
  const themeToggle = new IconButton(theme.getResolvedTheme() === 'dark' ? 'sun' : 'moon', {
    label: 'Toggle theme',
    onClick: () => {
      theme.toggle();
      updateHeader();
    },
  });
  actions.appendChild(themeToggle.getElement());

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
      min-height: 100vh;
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

    .app-logo {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      text-decoration: none;
    }

    .app-logo-text {
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
    }

    .app-nav {
      display: flex;
      align-items: center;
      gap: var(--spacing-xs);
      flex: 1;
    }

    .nav-link {
      padding: var(--spacing-sm) var(--spacing-md);
      color: var(--color-text-secondary);
      text-decoration: none;
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      transition: color var(--transition-fast), background var(--transition-fast);
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
      background: var(--color-bg-secondary);
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
        path: '/settings',
        component: () => {
          mountPage(SettingsPage);
          return document.createElement('div');
        },
        title: 'Settings | WebEDT',
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
    ])
    .start();

  // Update header
  updateHeader();

  console.log('WebEDT initialized');
}

// Start the app
init();
