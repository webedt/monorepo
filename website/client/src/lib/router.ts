/**
 * Simple Client-Side Router
 * Hash-based routing for simplicity
 */

export interface Route {
  path: string;
  component: () => HTMLElement | Promise<HTMLElement>;
  title?: string;
  guard?: () => boolean | Promise<boolean>;
}

export interface RouteMatch {
  route: Route;
  params: Record<string, string>;
}

type RouteChangeCallback = (match: RouteMatch | null) => void;

class Router {
  private routes: Route[] = [];
  private currentMatch: RouteMatch | null = null;
  private listeners: Set<RouteChangeCallback> = new Set();
  private outlet: HTMLElement | null = null;
  private notFoundComponent: (() => HTMLElement) | null = null;

  constructor() {
    // Listen to hash changes
    window.addEventListener('hashchange', () => this.handleRouteChange());
    window.addEventListener('load', () => this.handleRouteChange());
  }

  /**
   * Register routes
   */
  register(routes: Route[]): this {
    this.routes = routes;
    return this;
  }

  /**
   * Add a single route
   */
  addRoute(route: Route): this {
    this.routes.push(route);
    return this;
  }

  /**
   * Set the outlet element where components will be rendered
   */
  setOutlet(element: HTMLElement | string): this {
    if (typeof element === 'string') {
      this.outlet = document.querySelector(element);
    } else {
      this.outlet = element;
    }
    return this;
  }

  /**
   * Set the 404 component
   */
  setNotFound(component: () => HTMLElement): this {
    this.notFoundComponent = component;
    return this;
  }

  /**
   * Start the router
   */
  start(): this {
    this.handleRouteChange();
    return this;
  }

  /**
   * Navigate to a path
   */
  navigate(path: string): void {
    window.location.hash = path.startsWith('#') ? path : `#${path}`;
  }

  /**
   * Go back in history
   */
  back(): void {
    window.history.back();
  }

  /**
   * Go forward in history
   */
  forward(): void {
    window.history.forward();
  }

  /**
   * Get current path (without hash)
   */
  getCurrentPath(): string {
    return window.location.hash.slice(1) || '/';
  }

  /**
   * Get current route match
   */
  getCurrentMatch(): RouteMatch | null {
    return this.currentMatch;
  }

  /**
   * Subscribe to route changes
   */
  onChange(callback: RouteChangeCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Match a path to a route
   */
  private matchRoute(path: string): RouteMatch | null {
    for (const route of this.routes) {
      const params = this.matchPath(route.path, path);
      if (params !== null) {
        return { route, params };
      }
    }
    return null;
  }

  /**
   * Match a route pattern to a path
   * Supports:
   * - Exact paths: /home
   * - Parameters: /user/:id
   * - Wildcards: /files/*
   */
  private matchPath(pattern: string, path: string): Record<string, string> | null {
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = path.split('/').filter(Boolean);

    // Handle root path
    if (patternParts.length === 0 && pathParts.length === 0) {
      return {};
    }

    const params: Record<string, string> = {};

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      const pathPart = pathParts[i];

      // Wildcard matches everything after
      if (patternPart === '*') {
        params['*'] = pathParts.slice(i).join('/');
        return params;
      }

      // No more path parts
      if (pathPart === undefined) {
        return null;
      }

      // Parameter
      if (patternPart.startsWith(':')) {
        const paramName = patternPart.slice(1);
        params[paramName] = pathPart;
        continue;
      }

      // Exact match
      if (patternPart !== pathPart) {
        return null;
      }
    }

    // Path has more parts than pattern
    if (pathParts.length > patternParts.length) {
      return null;
    }

    return params;
  }

  /**
   * Handle route changes
   */
  private async handleRouteChange(): Promise<void> {
    const path = this.getCurrentPath();
    const match = this.matchRoute(path);

    this.currentMatch = match;

    // Notify listeners
    for (const listener of this.listeners) {
      listener(match);
    }

    // Render to outlet
    if (this.outlet) {
      await this.renderToOutlet(match);
    }
  }

  /**
   * Render matched route to outlet
   */
  private async renderToOutlet(match: RouteMatch | null): Promise<void> {
    if (!this.outlet) return;

    // Clear outlet
    this.outlet.innerHTML = '';

    if (!match) {
      // 404
      if (this.notFoundComponent) {
        this.outlet.appendChild(this.notFoundComponent());
      } else {
        this.outlet.innerHTML = '<h1>404 - Page Not Found</h1>';
      }
      document.title = '404 - Not Found';
      return;
    }

    // Check guard
    if (match.route.guard) {
      const allowed = await match.route.guard();
      if (!allowed) {
        return;
      }
    }

    // Render component
    try {
      const component = await match.route.component();
      this.outlet.appendChild(component);

      // Update title
      if (match.route.title) {
        document.title = match.route.title;
      }
    } catch (error) {
      console.error('Error rendering route:', error);
      this.outlet.innerHTML = '<h1>Error loading page</h1>';
    }
  }
}

// Export singleton instance
export const router = new Router();

// Helper to create links
export function link(path: string, text: string, className?: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = `#${path}`;
  a.textContent = text;
  if (className) {
    a.className = className;
  }
  return a;
}
