/**
 * Tests for ListenerRegistry
 * Covers centralized event listener tracking and cleanup functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ListenerRegistry, createListenerRegistry } from '../../src/lib/listenerRegistry';

describe('ListenerRegistry', () => {
  let registry: ListenerRegistry;
  let mockTarget: EventTarget;

  beforeEach(() => {
    registry = new ListenerRegistry();
    mockTarget = new EventTarget();
  });

  describe('add', () => {
    it('should add an event listener to the target', () => {
      const handler = vi.fn();

      registry.add(mockTarget, 'click', handler);
      mockTarget.dispatchEvent(new Event('click'));

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should track the listener', () => {
      const handler = vi.fn();

      registry.add(mockTarget, 'click', handler);

      expect(registry.count).toBe(1);
      expect(registry.has(mockTarget, 'click', handler)).toBe(true);
    });

    it('should support chaining', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const result = registry
        .add(mockTarget, 'click', handler1)
        .add(mockTarget, 'mouseover', handler2);

      expect(result).toBe(registry);
      expect(registry.count).toBe(2);
    });

    it('should pass options to addEventListener', () => {
      const handler = vi.fn();
      const addEventListenerSpy = vi.spyOn(mockTarget, 'addEventListener');

      registry.add(mockTarget, 'click', handler, { capture: true, once: true });

      expect(addEventListenerSpy).toHaveBeenCalledWith('click', handler, { capture: true, once: true });
    });
  });

  describe('addWithAbort', () => {
    it('should add a listener with AbortController signal', () => {
      const handler = vi.fn();

      registry.addWithAbort(mockTarget, 'click', handler);
      mockTarget.dispatchEvent(new Event('click'));

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should remove listener when aborted via removeAll', () => {
      const handler = vi.fn();

      registry.addWithAbort(mockTarget, 'click', handler);
      registry.removeAll();
      mockTarget.dispatchEvent(new Event('click'));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('addBySelector', () => {
    it('should add listener to element found by selector', () => {
      const container = document.createElement('div');
      const button = document.createElement('button');
      button.className = 'test-btn';
      container.appendChild(button);

      const handler = vi.fn();

      const result = registry.addBySelector(container, '.test-btn', 'click', handler);

      expect(result).toBe(true);
      expect(registry.count).toBe(1);

      button.dispatchEvent(new Event('click'));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should return false when element not found', () => {
      const container = document.createElement('div');
      const handler = vi.fn();

      const result = registry.addBySelector(container, '.non-existent', 'click', handler);

      expect(result).toBe(false);
      expect(registry.count).toBe(0);
    });
  });

  describe('addAllBySelector', () => {
    it('should add listeners to all matching elements', () => {
      const container = document.createElement('div');
      const button1 = document.createElement('button');
      const button2 = document.createElement('button');
      const button3 = document.createElement('button');
      button1.className = 'test-btn';
      button2.className = 'test-btn';
      button3.className = 'other-btn';
      container.append(button1, button2, button3);

      const handler = vi.fn();

      const count = registry.addAllBySelector(container, '.test-btn', 'click', handler);

      expect(count).toBe(2);
      expect(registry.count).toBe(2);

      button1.dispatchEvent(new Event('click'));
      button2.dispatchEvent(new Event('click'));
      button3.dispatchEvent(new Event('click'));

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should return 0 when no elements match', () => {
      const container = document.createElement('div');
      const handler = vi.fn();

      const count = registry.addAllBySelector(container, '.non-existent', 'click', handler);

      expect(count).toBe(0);
      expect(registry.count).toBe(0);
    });
  });

  describe('remove', () => {
    it('should remove a specific listener', () => {
      const handler = vi.fn();

      registry.add(mockTarget, 'click', handler);
      const removed = registry.remove(mockTarget, 'click', handler);

      expect(removed).toBe(true);
      expect(registry.count).toBe(0);

      mockTarget.dispatchEvent(new Event('click'));
      expect(handler).not.toHaveBeenCalled();
    });

    it('should return false when listener not found', () => {
      const handler = vi.fn();

      const removed = registry.remove(mockTarget, 'click', handler);

      expect(removed).toBe(false);
    });
  });

  describe('removeAll', () => {
    it('should remove all tracked listeners', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const target2 = new EventTarget();

      registry.add(mockTarget, 'click', handler1);
      registry.add(mockTarget, 'mouseover', handler2);
      registry.add(target2, 'keydown', handler1);

      expect(registry.count).toBe(3);

      registry.removeAll();

      expect(registry.count).toBe(0);

      mockTarget.dispatchEvent(new Event('click'));
      mockTarget.dispatchEvent(new Event('mouseover'));
      target2.dispatchEvent(new Event('keydown'));

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    it('should be safe to call multiple times', () => {
      const handler = vi.fn();
      registry.add(mockTarget, 'click', handler);

      registry.removeAll();
      registry.removeAll();
      registry.removeAll();

      expect(registry.count).toBe(0);
    });
  });

  describe('removeByType', () => {
    it('should remove all listeners of a specific type from a target', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      registry.add(mockTarget, 'click', handler1);
      registry.add(mockTarget, 'click', handler2);
      registry.add(mockTarget, 'mouseover', handler3);

      const removed = registry.removeByType(mockTarget, 'click');

      expect(removed).toBe(2);
      expect(registry.count).toBe(1);
      expect(registry.has(mockTarget, 'mouseover')).toBe(true);
    });
  });

  describe('removeByTarget', () => {
    it('should remove all listeners from a specific target', () => {
      const target2 = new EventTarget();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      registry.add(mockTarget, 'click', handler1);
      registry.add(mockTarget, 'mouseover', handler2);
      registry.add(target2, 'click', handler1);

      const removed = registry.removeByTarget(mockTarget);

      expect(removed).toBe(2);
      expect(registry.count).toBe(1);
      expect(registry.has(target2, 'click')).toBe(true);
    });
  });

  describe('has', () => {
    it('should return true when listener is tracked', () => {
      const handler = vi.fn();
      registry.add(mockTarget, 'click', handler);

      expect(registry.has(mockTarget, 'click', handler)).toBe(true);
    });

    it('should return false when listener is not tracked', () => {
      const handler = vi.fn();

      expect(registry.has(mockTarget, 'click', handler)).toBe(false);
    });

    it('should check by target and type when handler is not provided', () => {
      const handler = vi.fn();
      registry.add(mockTarget, 'click', handler);

      expect(registry.has(mockTarget, 'click')).toBe(true);
      expect(registry.has(mockTarget, 'mouseover')).toBe(false);
    });
  });

  describe('getListeners', () => {
    it('should return a copy of tracked listeners', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      registry.add(mockTarget, 'click', handler1);
      registry.add(mockTarget, 'mouseover', handler2);

      const listeners = registry.getListeners();

      expect(listeners).toHaveLength(2);
      expect(listeners[0]).toEqual({
        target: mockTarget,
        type: 'click',
        handler: handler1,
        options: undefined,
      });

      // Verify it's a copy
      listeners.push({} as never);
      expect(registry.count).toBe(2);
    });
  });

  describe('count', () => {
    it('should return the number of tracked listeners', () => {
      expect(registry.count).toBe(0);

      registry.add(mockTarget, 'click', vi.fn());
      expect(registry.count).toBe(1);

      registry.add(mockTarget, 'mouseover', vi.fn());
      expect(registry.count).toBe(2);

      registry.removeAll();
      expect(registry.count).toBe(0);
    });
  });
});

describe('createListenerRegistry', () => {
  it('should create a new ListenerRegistry instance', () => {
    const registry = createListenerRegistry();

    expect(registry).toBeInstanceOf(ListenerRegistry);
  });

  it('should create independent instances', () => {
    const registry1 = createListenerRegistry();
    const registry2 = createListenerRegistry();

    registry1.add(new EventTarget(), 'click', vi.fn());

    expect(registry1.count).toBe(1);
    expect(registry2.count).toBe(0);
  });
});
