/**
 * Mock EventSource for SSE Testing
 * Provides a controllable mock for testing Server-Sent Events handling
 */

import { vi } from 'vitest';

/**
 * Mock EventSource class for testing
 */
export class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readonly url: string;
  readonly withCredentials: boolean;

  readyState: number = MockEventSource.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  private eventListeners: Map<string, Set<EventListener>> = new Map();
  private isClosed = false;

  constructor(url: string, options?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = options?.withCredentials ?? false;
  }

  addEventListener(type: string, listener: EventListener): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.eventListeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach((listener) => listener(event));
    }
    return true;
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED;
    this.isClosed = true;
  }

  // Test helper methods

  /**
   * Simulate connection open
   */
  simulateOpen(): void {
    if (this.isClosed) return;
    this.readyState = MockEventSource.OPEN;
    const event = new Event('open');
    this.onopen?.(event);
  }

  /**
   * Simulate receiving a message event
   */
  simulateMessage(data: string, eventId?: string): void {
    if (this.isClosed) return;
    const event = new MessageEvent('message', {
      data,
      lastEventId: eventId || '',
    });
    this.onmessage?.(event);
    this.dispatchEvent(event);
  }

  /**
   * Simulate receiving a typed event
   */
  simulateTypedEvent(type: string, data: string, eventId?: string): void {
    if (this.isClosed) return;
    const event = new MessageEvent(type, {
      data,
      lastEventId: eventId || '',
    });
    this.dispatchEvent(event);
  }

  /**
   * Simulate an error
   */
  simulateError(): void {
    if (this.isClosed) return;
    const event = new Event('error');
    this.onerror?.(event);
  }

  /**
   * Simulate connection closed by server
   */
  simulateClose(): void {
    this.readyState = MockEventSource.CLOSED;
    const event = new Event('error');
    this.onerror?.(event);
  }

  /**
   * Get registered event listener count for a type
   */
  getListenerCount(type: string): number {
    return this.eventListeners.get(type)?.size ?? 0;
  }

  /**
   * Check if closed
   */
  get closed(): boolean {
    return this.isClosed;
  }
}

/**
 * EventSource instance tracker for testing
 */
export class EventSourceTracker {
  private instances: MockEventSource[] = [];
  private originalEventSource: typeof EventSource | undefined;

  /**
   * Install the mock EventSource globally
   */
  install(): void {
    this.originalEventSource = globalThis.EventSource;
    const tracker = this;

    globalThis.EventSource = class extends MockEventSource {
      constructor(url: string, options?: { withCredentials?: boolean }) {
        super(url, options);
        tracker.instances.push(this);
      }
    } as unknown as typeof EventSource;

    // Copy static properties
    (globalThis.EventSource as unknown as typeof MockEventSource).CONNECTING = MockEventSource.CONNECTING;
    (globalThis.EventSource as unknown as typeof MockEventSource).OPEN = MockEventSource.OPEN;
    (globalThis.EventSource as unknown as typeof MockEventSource).CLOSED = MockEventSource.CLOSED;
  }

  /**
   * Uninstall the mock and restore original
   */
  uninstall(): void {
    if (this.originalEventSource) {
      globalThis.EventSource = this.originalEventSource;
    }
    this.instances = [];
  }

  /**
   * Get all created instances
   */
  getInstances(): MockEventSource[] {
    return [...this.instances];
  }

  /**
   * Get the most recently created instance
   */
  getLatest(): MockEventSource | undefined {
    return this.instances[this.instances.length - 1];
  }

  /**
   * Clear tracked instances
   */
  clear(): void {
    this.instances = [];
  }
}

/**
 * Create a mock EventSource factory for testing
 */
export function createMockEventSource() {
  const tracker = new EventSourceTracker();
  return {
    install: () => tracker.install(),
    uninstall: () => tracker.uninstall(),
    getInstances: () => tracker.getInstances(),
    getLatest: () => tracker.getLatest(),
    clear: () => tracker.clear(),
    MockEventSource,
  };
}

/**
 * Setup global EventSource mock
 */
export function setupEventSourceMock() {
  const mock = createMockEventSource();
  mock.install();

  return {
    ...mock,
    cleanup: () => mock.uninstall(),
  };
}
