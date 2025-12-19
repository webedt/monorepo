/**
 * Main Entry Point
 * WebEDT - AI-Powered Code Editor
 */

import './styles/index.css';
import { router } from './lib/router';
import { theme } from './lib/theme';
import { Button, Card, Icon, IconButton, toast, type IconName } from './components';

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
      <a href="#/" class="app-logo">
        <span class="app-logo-text">WebEDT</span>
      </a>
      <nav class="app-nav" id="app-nav"></nav>
      <div class="app-header-actions" id="header-actions"></div>
    </div>
  `;

  // Add theme toggle to header actions
  const headerActions = header.querySelector('#header-actions')!;
  const themeToggle = new IconButton(theme.getResolvedTheme() === 'dark' ? 'sun' : 'moon', {
    label: 'Toggle theme',
    onClick: () => {
      theme.toggle();
      themeToggle.setIcon(theme.getResolvedTheme() === 'dark' ? 'sun' : 'moon');
    },
  });
  headerActions.appendChild(themeToggle.getElement());

  // Main content area
  const main = document.createElement('main');
  main.className = 'app-main';
  main.id = 'app-outlet';

  app.appendChild(header);
  app.appendChild(main);

  return app;
}

/**
 * Home page component
 */
function HomePage(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'home-page';

  // Hero section
  const hero = document.createElement('section');
  hero.className = 'hero';
  hero.innerHTML = `
    <h1 class="hero-title">WebEDT</h1>
    <p class="hero-subtitle">AI-Powered Code Editor</p>
  `;

  // Demo card
  const card = new Card({ elevated: true });
  card.header({ title: 'Component Demo' });
  const body = card.body();

  // Button examples
  const buttonRow = document.createElement('div');
  buttonRow.className = 'flex gap-2 flex-wrap mb-4';

  const primaryBtn = new Button('Primary', {
    variant: 'primary',
    onClick: () => toast.success('Primary button clicked!'),
  });

  const secondaryBtn = new Button('Secondary', {
    variant: 'secondary',
    onClick: () => toast.info('Secondary button clicked!'),
  });

  const dangerBtn = new Button('Danger', {
    variant: 'danger',
    onClick: () => toast.error('Danger button clicked!'),
  });

  const ghostBtn = new Button('Ghost', {
    variant: 'ghost',
    onClick: () => toast.warning('Ghost button clicked!'),
  });

  buttonRow.appendChild(primaryBtn.getElement());
  buttonRow.appendChild(secondaryBtn.getElement());
  buttonRow.appendChild(dangerBtn.getElement());
  buttonRow.appendChild(ghostBtn.getElement());
  body.getElement().appendChild(buttonRow);

  // Icon examples
  const iconRow = document.createElement('div');
  iconRow.className = 'flex gap-3 items-center';

  const icons: IconName[] = ['code', 'terminal', 'github', 'settings', 'user'];
  for (const name of icons) {
    const icon = new Icon(name, { size: 'lg' });
    iconRow.appendChild(icon.getElement());
  }

  body.getElement().appendChild(iconRow);

  container.appendChild(hero);
  container.appendChild(card.getElement());

  return container;
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
    <a href="#/" class="btn btn--primary">Go Home</a>
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
      background-color: var(--color-bg);
      border-bottom: 1px solid var(--color-border);
    }

    .app-header-content {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
      max-width: 80rem;
      margin: 0 auto;
      padding: var(--spacing-3) var(--spacing-4);
    }

    .app-logo {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      text-decoration: none;
    }

    .app-logo-text {
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-bold);
      color: var(--color-text);
    }

    .app-nav {
      display: flex;
      align-items: center;
      gap: var(--spacing-1);
      flex: 1;
    }

    .app-header-actions {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
    }

    .app-main {
      flex: 1;
      max-width: 80rem;
      width: 100%;
      margin: 0 auto;
      padding: var(--spacing-6) var(--spacing-4);
    }

    .home-page {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-8);
    }

    .hero {
      text-align: center;
      padding: var(--spacing-12) 0;
    }

    .hero-title {
      font-size: var(--font-size-4xl);
      font-weight: var(--font-weight-bold);
      margin-bottom: var(--spacing-2);
    }

    .hero-subtitle {
      font-size: var(--font-size-xl);
      color: var(--color-text-secondary);
    }

    .not-found-page {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-4);
      padding: var(--spacing-16) 0;
      text-align: center;
    }

    .not-found-page h1 {
      font-size: 6rem;
      font-weight: var(--font-weight-bold);
      color: var(--color-text-tertiary);
    }

    .not-found-page p {
      font-size: var(--font-size-xl);
      color: var(--color-text-secondary);
    }
  `;
  document.head.appendChild(style);
}

/**
 * Initialize the application
 */
function init(): void {
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

  // Setup router
  router
    .setOutlet('#app-outlet')
    .setNotFound(NotFoundPage)
    .register([
      {
        path: '/',
        component: HomePage,
        title: 'WebEDT - Home',
      },
    ])
    .start();

  console.log('WebEDT initialized');
}

// Start the app
init();
