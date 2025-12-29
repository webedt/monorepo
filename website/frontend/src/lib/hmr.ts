/**
 * Hot Module Replacement (HMR) Utilities
 *
 * Provides HMR support for vanilla TypeScript applications with Vite.
 * Handles state preservation, component re-rendering, and module updates.
 */

// HMR state storage - persisted across module updates
const hmrState = new Map<string, unknown>();

// Registry of mounted components for re-rendering
const mountedComponents = new Map<string, {
  element: HTMLElement;
  parent: HTMLElement;
  recreate: () => HTMLElement;
}>();

// Registry of page instances for hot-reloading
const pageRegistry = new Map<string, {
  container: HTMLElement;
  recreate: () => void;
}>();

// Store instances for state preservation
const storeRegistry = new Map<string, {
  getState: () => unknown;
  setState: (state: unknown) => void;
}>();

/**
 * Check if HMR is available
 */
export function isHmrEnabled(): boolean {
  return import.meta.hot !== undefined;
}

/**
 * Save state for HMR - state will persist across module updates
 */
export function saveHmrState<T>(key: string, value: T): void {
  hmrState.set(key, value);
}

/**
 * Get saved HMR state
 */
export function getHmrState<T>(key: string): T | undefined {
  return hmrState.get(key) as T | undefined;
}

/**
 * Clear HMR state for a key
 */
export function clearHmrState(key: string): void {
  hmrState.delete(key);
}

/**
 * Register a store for HMR state preservation
 */
export function registerStore(
  id: string,
  getState: () => unknown,
  setState: (state: unknown) => void
): void {
  storeRegistry.set(id, { getState, setState });

  // Restore state if it was saved
  const savedState = getHmrState(`store:${id}`);
  if (savedState !== undefined) {
    setState(savedState);
  }
}

/**
 * Save all registered store states before module update
 */
export function saveStoreStates(): void {
  for (const [id, store] of storeRegistry) {
    saveHmrState(`store:${id}`, store.getState());
  }
}

/**
 * Register a component for HMR re-rendering
 */
export function registerComponent(
  id: string,
  element: HTMLElement,
  parent: HTMLElement,
  recreate: () => HTMLElement
): void {
  mountedComponents.set(id, { element, parent, recreate });
}

/**
 * Unregister a component from HMR tracking
 */
export function unregisterComponent(id: string): void {
  mountedComponents.delete(id);
}

/**
 * Re-render a specific component
 */
export function rerenderComponent(id: string): boolean {
  const component = mountedComponents.get(id);
  if (!component) return false;

  const { element, parent, recreate } = component;
  const newElement = recreate();

  if (element.parentNode === parent) {
    parent.replaceChild(newElement, element);
    mountedComponents.set(id, { ...component, element: newElement });
    return true;
  }

  return false;
}

/**
 * Register a page for HMR re-rendering
 */
export function registerPage(
  id: string,
  container: HTMLElement,
  recreate: () => void
): void {
  pageRegistry.set(id, { container, recreate });
}

/**
 * Unregister a page from HMR tracking
 */
export function unregisterPage(id: string): void {
  pageRegistry.delete(id);
}

/**
 * Re-render the current page
 */
export function rerenderCurrentPage(): boolean {
  for (const [, page] of pageRegistry) {
    if (page.container.isConnected) {
      page.recreate();
      return true;
    }
  }
  return false;
}

/**
 * Setup HMR for a module that exports a component class
 * Call this at the end of component files
 */
export function setupComponentHmr(
  hot: ImportMeta['hot'],
  moduleId: string,
  callback?: () => void
): void {
  if (!hot) return;

  hot.accept((newModule: unknown) => {
    if (newModule) {
      console.log(`[HMR] Component updated: ${moduleId}`);
      callback?.();
    }
  });

  hot.dispose(() => {
    console.log(`[HMR] Component disposing: ${moduleId}`);
  });
}

/**
 * Setup HMR for a store module
 * Preserves state across module updates
 */
export function setupStoreHmr(
  hot: ImportMeta['hot'],
  storeId: string,
  getState: () => unknown,
  setState: (state: unknown) => void
): void {
  if (!hot) return;

  // Register the store for state preservation
  registerStore(storeId, getState, setState);

  hot.accept();

  hot.dispose(() => {
    // Save state before disposal
    saveHmrState(`store:${storeId}`, getState());
    console.log(`[HMR] Store state saved: ${storeId}`);
  });
}

/**
 * Setup HMR for the main entry point
 */
export function setupMainHmr(
  hot: ImportMeta['hot'],
  reinitialize: () => void
): void {
  if (!hot) return;

  hot.accept(() => {
    console.log('[HMR] Main module updated, reinitializing...');
    reinitialize();
  });

  hot.dispose(() => {
    // Save all store states before disposal
    saveStoreStates();
    console.log('[HMR] Main module disposing, states saved');
  });
}

/**
 * Setup HMR for the router module
 */
export function setupRouterHmr(
  hot: ImportMeta['hot'],
  getCurrentPath: () => string,
  navigate: (path: string) => void
): void {
  if (!hot) return;

  // Save current path before update
  hot.dispose(() => {
    saveHmrState('router:path', getCurrentPath());
    console.log('[HMR] Router path saved');
  });

  hot.accept(() => {
    // Restore navigation after update
    const savedPath = getHmrState<string>('router:path');
    if (savedPath) {
      console.log(`[HMR] Router restored to: ${savedPath}`);
      // Use setTimeout to ensure the new module is fully loaded
      setTimeout(() => navigate(savedPath), 0);
    }
  });
}

/**
 * Create a unique component ID for HMR tracking
 */
let componentCounter = 0;
export function createHmrId(prefix: string = 'component'): string {
  return `${prefix}-${++componentCounter}`;
}

/**
 * Debug: Log current HMR state
 */
export function debugHmrState(): void {
  console.group('[HMR] Current State');
  console.log('State entries:', [...hmrState.entries()]);
  console.log('Mounted components:', [...mountedComponents.keys()]);
  console.log('Registered pages:', [...pageRegistry.keys()]);
  console.log('Registered stores:', [...storeRegistry.keys()]);
  console.groupEnd();
}

// Export HMR state for debugging in development
if (import.meta.hot) {
  (window as unknown as { __HMR_DEBUG__: typeof debugHmrState }).__HMR_DEBUG__ = debugHmrState;
}
