# WebEDT Client Architecture

This document describes the architecture of the vanilla TypeScript client for WebEDT.

## Overview

The client is built with **vanilla TypeScript**, **CSS custom properties for theming**, and **Vite for bundling**. It deliberately avoids React or other frameworks to maintain simplicity and reduce bundle size.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Application                               │
├─────────────────────────────────────────────────────────────────┤
│  Pages          │  Components       │  Lib (Utilities)          │
│  ─────────────  │  ───────────────  │  ────────────────────     │
│  Login          │  Button           │  api.ts (API client)      │
│  Register       │  Input            │  router.ts (SPA routing)  │
│  Dashboard      │  Card             │  store.ts (state mgmt)    │
│  Agents         │  Modal            │  theme.ts (dark/light)    │
│  Chat           │  Toast            │  events.ts (SSE)          │
│  Code           │  Dropdown         │  utils.ts (helpers)       │
│  Settings       │  Icon             │                           │
│  ...            │  ...              │                           │
├─────────────────────────────────────────────────────────────────┤
│                     Styles (CSS Custom Properties)               │
│  theme.css │ reset.css │ utilities.css │ component styles        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
client/
├── src/
│   ├── main.ts                 # Application entry point
│   ├── app.ts                  # Main App class (layout, routing)
│   │
│   ├── components/             # Reusable UI components
│   │   ├── base/
│   │   │   └── Component.ts    # Base class for all components
│   │   ├── button/
│   │   │   ├── Button.ts
│   │   │   └── button.css
│   │   ├── input/
│   │   ├── card/
│   │   ├── modal/
│   │   ├── toast/
│   │   ├── dropdown/
│   │   ├── icon/
│   │   ├── loading/
│   │   └── index.ts            # Component exports
│   │
│   ├── pages/                  # Page components (routes)
│   │   ├── base/
│   │   │   └── Page.ts         # Base class for pages
│   │   ├── login/
│   │   │   ├── LoginPage.ts
│   │   │   └── login.css
│   │   ├── register/
│   │   ├── dashboard/
│   │   ├── agents/
│   │   ├── chat/
│   │   ├── code/
│   │   ├── settings/
│   │   └── index.ts            # Page exports
│   │
│   ├── lib/                    # Core utilities
│   │   ├── api.ts              # API client with fetch wrapper
│   │   ├── router.ts           # Hash-based SPA router
│   │   ├── store.ts            # Reactive state management
│   │   ├── theme.ts            # Theme manager (dark/light)
│   │   ├── events.ts           # SSE/EventSource utilities
│   │   └── utils.ts            # Helper functions
│   │
│   ├── stores/                 # Application state stores
│   │   ├── authStore.ts        # Authentication state
│   │   ├── workerStore.ts      # AI worker execution state
│   │   ├── repoStore.ts        # Selected repository
│   │   └── sessionStore.ts     # Current session state
│   │
│   ├── types/                  # TypeScript type definitions
│   │   ├── user.ts
│   │   ├── session.ts
│   │   ├── github.ts
│   │   └── index.ts
│   │
│   └── styles/                 # Global styles
│       ├── index.css           # Main CSS entry
│       ├── theme.css           # CSS custom properties
│       ├── reset.css           # CSS reset
│       └── utilities.css       # Utility classes
│
├── public/                     # Static assets
│   └── favicon.svg
│
├── index.html                  # HTML entry point
├── vite.config.ts              # Vite configuration
├── tsconfig.json               # TypeScript configuration
└── package.json
```

---

## Core Concepts

### 1. Component System

All UI components extend the base `Component` class which provides:

```typescript
class Component<T = {}> {
  protected element: HTMLElement;
  protected options: T;

  constructor(options?: T);

  // Lifecycle
  protected render(): string;           // Return HTML string
  protected onMount(): void;            // Called after DOM insertion
  protected onUnmount(): void;          // Called before removal

  // DOM Utilities
  protected $(selector: string): HTMLElement | null;
  protected $$(selector: string): HTMLElement[];
  protected on(event: string, selector: string, handler: Function): void;
  protected emit(event: string, detail?: any): void;

  // Public API
  mount(container: HTMLElement): void;
  unmount(): void;
  getElement(): HTMLElement;
  update(options: Partial<T>): void;
}
```

**Example Component:**

```typescript
import { Component } from '../base/Component';
import './my-component.css';

interface MyComponentOptions {
  title: string;
  onClick?: () => void;
}

export class MyComponent extends Component<MyComponentOptions> {
  protected render(): string {
    return `
      <div class="my-component">
        <h2 class="my-component__title">${this.options.title}</h2>
        <button class="my-component__button">Click Me</button>
      </div>
    `;
  }

  protected onMount(): void {
    this.on('click', '.my-component__button', () => {
      this.options.onClick?.();
    });
  }
}
```

### 2. Page System

Pages extend a `Page` base class and are registered with the router:

```typescript
abstract class Page extends Component {
  abstract readonly route: string;      // Route pattern (e.g., '/chat/:id')
  abstract readonly title: string;      // Page title

  // Called with route params when navigating to this page
  abstract load(params: Record<string, string>): Promise<void>;

  // Optional: Check if user can access this page
  canAccess(): boolean { return true; }
}
```

**Example Page:**

```typescript
import { Page } from '../base/Page';
import { authStore } from '../../stores/authStore';

export class ChatPage extends Page {
  readonly route = '/chat/:sessionId';
  readonly title = 'Chat';

  canAccess(): boolean {
    return authStore.isAuthenticated();
  }

  async load(params: Record<string, string>): Promise<void> {
    const session = await sessionsApi.get(params.sessionId);
    this.setState({ session });
  }

  protected render(): string {
    return `
      <div class="chat-page">
        <div class="chat-messages"></div>
        <div class="chat-input"></div>
      </div>
    `;
  }
}
```

### 3. Router

Hash-based SPA routing with support for:
- Route parameters (`:id`)
- Query strings
- Navigation guards
- History management

```typescript
import { router } from './lib/router';

// Register routes
router.register('/login', LoginPage);
router.register('/chat/:sessionId', ChatPage);
router.register('/code/:sessionId', CodePage);

// Navigate programmatically
router.navigate('/chat/abc123');
router.navigate('/chat/abc123', { replace: true });

// Get current route info
const { path, params, query } = router.current();

// Listen to route changes
router.on('change', (route) => {
  console.log('Navigated to:', route.path);
});
```

### 4. State Management

Reactive stores using a simple pub/sub pattern:

```typescript
import { Store } from './lib/store';

interface AuthState {
  user: User | null;
  isLoading: boolean;
}

class AuthStore extends Store<AuthState> {
  constructor() {
    super({
      user: null,
      isLoading: true,
    });
  }

  isAuthenticated(): boolean {
    return this.state.user !== null;
  }

  async login(email: string, password: string): Promise<void> {
    this.setState({ isLoading: true });
    const user = await authApi.login(email, password);
    this.setState({ user, isLoading: false });
  }

  logout(): void {
    this.setState({ user: null });
  }
}

export const authStore = new AuthStore();

// Subscribe to changes
authStore.subscribe((state) => {
  console.log('Auth state changed:', state);
});

// Subscribe to specific property
authStore.subscribe('user', (user) => {
  console.log('User changed:', user);
});
```

### 5. API Client

Centralized API client with automatic error handling:

```typescript
import { api } from './lib/api';

// Base fetch wrapper
const response = await api.fetch<User>('/api/auth/session');

// Convenience methods
await api.get<Session[]>('/api/sessions');
await api.post<Session>('/api/sessions', { title: 'New Session' });
await api.put<Session>('/api/sessions/123', { title: 'Updated' });
await api.delete('/api/sessions/123');

// API modules
import { authApi, sessionsApi, githubApi, userApi } from './lib/api';

await authApi.login(email, password);
await sessionsApi.list();
await githubApi.getRepos();
```

### 6. SSE/EventSource

Real-time event streaming for AI execution:

```typescript
import { EventSourceManager } from './lib/events';

const sse = new EventSourceManager('/api/execute', {
  onMessage: (event) => {
    console.log('Event:', event.type, event.data);
  },
  onError: (error) => {
    console.error('SSE Error:', error);
  },
  onClose: () => {
    console.log('SSE Closed');
  },
  // Auto-reconnect with exponential backoff
  reconnect: true,
  maxRetries: 5,
});

sse.connect();
sse.close();
```

### 7. Theming

CSS custom properties with JavaScript control:

```typescript
import { theme } from './lib/theme';

// Get/set theme
theme.set('dark');
theme.set('light');
theme.toggle();
const current = theme.get(); // 'dark' | 'light'

// Listen to changes
theme.subscribe((newTheme) => {
  console.log('Theme changed to:', newTheme);
});
```

**CSS Usage:**

```css
.my-component {
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
}
```

---

## Data Flow

### Authentication Flow

```
┌─────────┐     ┌──────────┐     ┌─────────┐     ┌──────────┐
│  Login  │────▶│ authApi  │────▶│ Server  │────▶│ authStore│
│  Page   │     │ .login() │     │ /api/   │     │ .setState│
└─────────┘     └──────────┘     │ auth/   │     └──────────┘
                                 │ login   │           │
                                 └─────────┘           ▼
                                              ┌──────────────┐
                                              │ UI Updates   │
                                              │ via subscribe│
                                              └──────────────┘
```

### SSE Event Flow

```
┌─────────┐     ┌───────────┐     ┌─────────┐     ┌──────────┐
│  Chat   │────▶│ EventSrc  │────▶│ Server  │────▶│ AI Worker│
│  Page   │     │ Manager   │     │ /api/   │     │ Execute  │
└─────────┘     └───────────┘     │ execute │     └──────────┘
     ▲                │           └─────────┘
     │                │
     │           SSE Events
     │                │
     │                ▼
     │         ┌───────────┐
     └─────────│  Update   │
               │  Messages │
               └───────────┘
```

---

## Component Patterns

### BEM Naming Convention

CSS classes follow BEM (Block Element Modifier):

```css
/* Block */
.button { }

/* Element */
.button__icon { }
.button__text { }

/* Modifier */
.button--primary { }
.button--large { }
.button--loading { }
```

### Event Delegation

Use event delegation for dynamic content:

```typescript
protected onMount(): void {
  // Good: Delegate to container
  this.on('click', '.item', (e, el) => {
    const id = el.dataset.id;
    this.handleItemClick(id);
  });

  // Bad: Direct binding (breaks on re-render)
  // this.$('.item').addEventListener('click', ...);
}
```

### Async Data Loading

Pages should handle loading states:

```typescript
async load(params: Record<string, string>): Promise<void> {
  this.setState({ loading: true, error: null });

  try {
    const data = await api.get(`/api/items/${params.id}`);
    this.setState({ data, loading: false });
  } catch (error) {
    this.setState({ error: error.message, loading: false });
  }
}

protected render(): string {
  if (this.state.loading) {
    return '<div class="loading-spinner"></div>';
  }

  if (this.state.error) {
    return `<div class="error">${this.state.error}</div>`;
  }

  return `<div class="content">...</div>`;
}
```

---

## Type Definitions

### Core Types

```typescript
// User
interface User {
  id: string;
  email: string;
  displayName?: string;
  githubId?: string;
  preferredProvider?: 'claude' | 'codex' | 'gemini';
  isAdmin: boolean;
  createdAt: string;
}

// Session
interface Session {
  id: string;
  userId: string;
  sessionPath: string;
  repositoryOwner?: string;
  repositoryName?: string;
  userRequest?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  branch?: string;
  baseBranch?: string;
  createdAt: string;
  completedAt?: string;
}

// GitHub
interface Repository {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
}

// SSE Event
interface CloudServiceEvent {
  type: string;
  timestamp: string;
  data: any;
}
```

---

## File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `Button.ts`, `ChatInput.ts` |
| Pages | PascalCase + Page suffix | `LoginPage.ts`, `DashboardPage.ts` |
| Stores | camelCase + Store suffix | `authStore.ts`, `sessionStore.ts` |
| Utilities | camelCase | `api.ts`, `router.ts`, `utils.ts` |
| Types | camelCase | `user.ts`, `session.ts` |
| CSS | kebab-case | `button.css`, `chat-input.css` |

---

## Build & Development

### Development

```bash
cd website/client
npm install
npm run dev     # Start dev server at localhost:5173
```

### Production Build

```bash
npm run build   # Output to dist/
npm run preview # Preview production build
```

### Type Checking

```bash
npx tsc --noEmit  # Check types without emitting
```

---

## Migration from React

| React Pattern | Vanilla Equivalent |
|--------------|-------------------|
| `useState` | `this.state` + `setState()` + `update()` |
| `useEffect` | `onMount()` / `onUnmount()` |
| `useContext` | Import stores directly |
| `useCallback` | Regular methods |
| `useMemo` | Cached properties |
| `React.createElement` | Template literals + `innerHTML` |
| `React Router` | `router.ts` hash routing |
| `Zustand` | `Store` class with pub/sub |
| Event handlers | `this.on()` delegation |

---

## Performance Considerations

1. **DOM Updates**: Use `update()` sparingly; prefer targeted updates via `this.$()` queries
2. **Event Listeners**: Always use delegation via `this.on()` to handle dynamic content
3. **Memory**: Call `unmount()` on components when removing them to clean up listeners
4. **Bundle Size**: Import only what you need; Vite tree-shakes unused exports
5. **CSS**: Use CSS custom properties for theming to avoid runtime style calculations

---

## Adding New Features

### Adding a New Component

1. Create folder: `src/components/my-component/`
2. Create files: `MyComponent.ts`, `my-component.css`
3. Export from `src/components/index.ts`

### Adding a New Page

1. Create folder: `src/pages/my-page/`
2. Create files: `MyPage.ts`, `my-page.css`
3. Register route in `src/app.ts`
4. Export from `src/pages/index.ts`

### Adding a New Store

1. Create file: `src/stores/myStore.ts`
2. Extend `Store` class with typed state
3. Export singleton instance

### Adding a New API Module

1. Add methods to `src/lib/api.ts`
2. Group related endpoints in an object (e.g., `sessionsApi`)
3. Export from the module

---

*Documentation last updated: 2024-12-19*
