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
 * Note: State restoration is handled by Store.enableHmr() to ensure subscribers are notified
 */
export function registerStore(
  id: string,
  getState: () => unknown
): void {
  storeRegistry.set(id, { getState });
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
 * Create a unique component ID for HMR tracking
 * Counter is persisted across HMR updates to prevent ID collisions
 */
const HMR_COUNTER_KEY = 'hmr:componentCounter';
let componentCounter = getHmrState<number>(HMR_COUNTER_KEY) ?? 0;

export function createHmrId(prefix: string = 'component'): string {
  componentCounter++;
  saveHmrState(HMR_COUNTER_KEY, componentCounter);
  return `${prefix}-${componentCounter}`;
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
