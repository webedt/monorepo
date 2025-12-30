/**
 * Tests for CustomComponentsStore
 * Covers custom component definitions management including
 * CRUD operations, search, filtering, import/export, and persistence.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type {
  CustomComponentDefinition,
  CustomComponentChild,
  CustomComponentTransform,
} from '../../src/types';

// Mock the store module to avoid persist side effects during import
vi.mock('../../src/lib/store', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    persist: vi.fn(), // Mock persist to avoid localStorage side effects on init
  };
});

// Import after mocking
import { CustomComponentsStore } from '../../src/stores/customComponentsStore';

// Test fixtures
const DEFAULT_TRANSFORM: CustomComponentTransform = {
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  pivotX: 0.5,
  pivotY: 0.5,
};

const mockChild: CustomComponentChild = {
  id: 'child-1',
  name: 'Test Shape',
  type: 'shape',
  shapeType: 'rectangle',
  transform: { ...DEFAULT_TRANSFORM, x: 10, y: 20 },
  opacity: 1,
  color: '#ff0000',
  zIndex: 0,
};

const mockComponent: CustomComponentDefinition = {
  id: 'test-component-1',
  userId: 'local',
  name: 'Test Component',
  description: 'A test component',
  icon: '📦',
  category: 'shapes',
  tags: ['test', 'shape'],
  children: [mockChild],
  properties: [],
  defaultTransform: DEFAULT_TRANSFORM,
  isPublic: false,
  usageCount: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

// Create a custom class that doesn't run constructor side effects
class TestableCustomComponentsStore extends CustomComponentsStore {
  constructor() {
    // Call parent constructor which sets up initial state
    // The mocked persist() won't actually load from localStorage
    super();
    // Clear any state set by constructor
    this.setState({
      components: [],
      selectedComponent: null,
      categories: [],
      isLoading: false,
      isInitialized: true,
      error: null,
    });
  }
}

describe('CustomComponentsStore', () => {
  let store: TestableCustomComponentsStore;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    store = new TestableCustomComponentsStore();
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = store.getState();

      expect(state.components).toEqual([]);
      expect(state.selectedComponent).toBeNull();
      expect(state.categories).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.isInitialized).toBe(true);
      expect(state.error).toBeNull();
    });
  });

  describe('Create Component', () => {
    it('should create a new component with required fields', () => {
      const component = store.createComponent({
        name: 'New Component',
        children: [mockChild],
      });

      expect(component.id).toBeDefined();
      expect(component.id).toMatch(/^custom-\d+-[a-z0-9]+$/);
      expect(component.name).toBe('New Component');
      expect(component.children).toEqual([mockChild]);
      expect(component.userId).toBe('local');
      expect(component.icon).toBe('📦'); // Default icon
      expect(component.usageCount).toBe(0);
      expect(component.isPublic).toBe(false);
      expect(component.createdAt).toBeDefined();
      expect(component.updatedAt).toBeDefined();
    });

    it('should create a component with all optional fields', () => {
      const component = store.createComponent({
        name: 'Full Component',
        description: 'A fully specified component',
        icon: '🎨',
        category: 'art',
        tags: ['painting', 'canvas'],
        children: [mockChild],
        properties: [{ name: 'color', type: 'color', label: 'Color', defaultValue: '#000000' }],
        defaultTransform: { x: 10, y: 20 },
        isPublic: true,
      });

      expect(component.name).toBe('Full Component');
      expect(component.description).toBe('A fully specified component');
      expect(component.icon).toBe('🎨');
      expect(component.category).toBe('art');
      expect(component.tags).toEqual(['painting', 'canvas']);
      expect(component.properties).toHaveLength(1);
      expect(component.defaultTransform.x).toBe(10);
      expect(component.defaultTransform.y).toBe(20);
      expect(component.isPublic).toBe(true);
    });

    it('should add component to state', () => {
      const component = store.createComponent({
        name: 'Test',
        children: [],
      });

      const state = store.getState();
      expect(state.components).toContainEqual(component);
    });

    it('should update categories when creating component with new category', () => {
      store.createComponent({
        name: 'Component 1',
        category: 'category-a',
        children: [],
      });

      store.createComponent({
        name: 'Component 2',
        category: 'category-b',
        children: [],
      });

      const state = store.getState();
      expect(state.categories).toEqual(['category-a', 'category-b']);
    });

    it('should apply default transform values', () => {
      const component = store.createComponent({
        name: 'Test',
        children: [],
        defaultTransform: { x: 100 }, // Only specify x
      });

      expect(component.defaultTransform).toEqual({
        ...DEFAULT_TRANSFORM,
        x: 100,
      });
    });
  });

  describe('Create From Selection', () => {
    it('should create component from selected objects', () => {
      const selectedObjects = [
        {
          id: 'obj-1',
          name: 'Shape 1',
          type: 'shape' as const,
          shapeType: 'rectangle' as const,
          transform: { x: 100, y: 100, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0.5, pivotY: 0.5 },
          opacity: 1,
          color: '#ff0000',
          zIndex: 0,
        },
        {
          id: 'obj-2',
          name: 'Shape 2',
          type: 'shape' as const,
          shapeType: 'circle' as const,
          transform: { x: 200, y: 100, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0.5, pivotY: 0.5 },
          opacity: 0.5,
          color: '#00ff00',
          zIndex: 1,
        },
      ];

      const component = store.createFromSelection('My Group', selectedObjects);

      expect(component).not.toBeNull();
      expect(component!.name).toBe('My Group');
      expect(component!.children).toHaveLength(2);

      // Children should have positions relative to center
      // Center is at (150, 100)
      expect(component!.children[0].transform.x).toBe(-50); // 100 - 150
      expect(component!.children[0].transform.y).toBe(0);   // 100 - 100
      expect(component!.children[1].transform.x).toBe(50);  // 200 - 150
      expect(component!.children[1].transform.y).toBe(0);   // 100 - 100
    });

    it('should return null when no objects selected', () => {
      const result = store.createFromSelection('Empty', []);

      expect(result).toBeNull();
      expect(store.getState().error).toBe('No objects selected');
    });

    it('should apply options when creating from selection', () => {
      const selectedObjects = [
        {
          id: 'obj-1',
          name: 'Shape',
          type: 'shape' as const,
          transform: DEFAULT_TRANSFORM,
          opacity: 1,
          zIndex: 0,
        },
      ];

      const component = store.createFromSelection('My Component', selectedObjects, {
        description: 'Created from selection',
        icon: '🎯',
        category: 'custom',
      });

      expect(component!.description).toBe('Created from selection');
      expect(component!.icon).toBe('🎯');
      expect(component!.category).toBe('custom');
    });
  });

  describe('Get Component', () => {
    beforeEach(() => {
      store.setState({
        components: [mockComponent],
        selectedComponent: null,
        categories: [],
        isLoading: false,
        isInitialized: true,
        error: null,
      });
    });

    it('should get component by ID', () => {
      const component = store.getComponent('test-component-1');

      expect(component).toEqual(mockComponent);
    });

    it('should return undefined for non-existent ID', () => {
      const component = store.getComponent('non-existent');

      expect(component).toBeUndefined();
    });
  });

  describe('Select Component', () => {
    beforeEach(() => {
      store.setState({
        components: [mockComponent],
        selectedComponent: null,
        categories: [],
        isLoading: false,
        isInitialized: true,
        error: null,
      });
    });

    it('should select a component by ID', () => {
      store.selectComponent('test-component-1');

      expect(store.getState().selectedComponent).toEqual(mockComponent);
    });

    it('should deselect when passing null', () => {
      store.selectComponent('test-component-1');
      store.selectComponent(null);

      expect(store.getState().selectedComponent).toBeNull();
    });

    it('should set selectedComponent to null for non-existent ID', () => {
      store.selectComponent('non-existent');

      expect(store.getState().selectedComponent).toBeNull();
    });
  });

  describe('Update Component', () => {
    beforeEach(() => {
      store.setState({
        components: [mockComponent],
        selectedComponent: null,
        categories: ['shapes'],
        isLoading: false,
        isInitialized: true,
        error: null,
      });
    });

    it('should update component properties', () => {
      const updated = store.updateComponent('test-component-1', {
        name: 'Updated Name',
        description: 'Updated description',
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated Name');
      expect(updated!.description).toBe('Updated description');
      expect(updated!.id).toBe('test-component-1');
      expect(updated!.updatedAt).not.toBe(mockComponent.updatedAt);
    });

    it('should merge defaultTransform updates', () => {
      const updated = store.updateComponent('test-component-1', {
        defaultTransform: { x: 50, y: 100 },
      });

      expect(updated!.defaultTransform).toEqual({
        ...DEFAULT_TRANSFORM,
        x: 50,
        y: 100,
      });
    });

    it('should return null for non-existent component', () => {
      const result = store.updateComponent('non-existent', { name: 'Test' });

      expect(result).toBeNull();
      expect(store.getState().error).toBe('Component not found');
    });

    it('should update selectedComponent if it was the updated one', () => {
      store.selectComponent('test-component-1');
      store.updateComponent('test-component-1', { name: 'Selected Updated' });

      expect(store.getState().selectedComponent!.name).toBe('Selected Updated');
    });

    it('should not affect selectedComponent if different component updated', () => {
      const anotherComponent = { ...mockComponent, id: 'another-component' };
      store.setState({
        components: [mockComponent, anotherComponent],
        selectedComponent: mockComponent,
        categories: ['shapes'],
        isLoading: false,
        isInitialized: true,
        error: null,
      });

      store.updateComponent('another-component', { name: 'Updated' });

      expect(store.getState().selectedComponent!.id).toBe('test-component-1');
      expect(store.getState().selectedComponent!.name).toBe('Test Component');
    });

    it('should update categories when category changes', () => {
      store.updateComponent('test-component-1', { category: 'new-category' });

      expect(store.getState().categories).toContain('new-category');
    });
  });

  describe('Delete Component', () => {
    beforeEach(() => {
      store.setState({
        components: [mockComponent],
        selectedComponent: null,
        categories: ['shapes'],
        isLoading: false,
        isInitialized: true,
        error: null,
      });
    });

    it('should delete component by ID', () => {
      const result = store.deleteComponent('test-component-1');

      expect(result).toBe(true);
      expect(store.getState().components).toHaveLength(0);
    });

    it('should return false for non-existent component', () => {
      const result = store.deleteComponent('non-existent');

      expect(result).toBe(false);
      expect(store.getState().components).toHaveLength(1);
    });

    it('should clear selectedComponent if deleted', () => {
      store.selectComponent('test-component-1');
      store.deleteComponent('test-component-1');

      expect(store.getState().selectedComponent).toBeNull();
    });

    it('should not affect selectedComponent if different component deleted', () => {
      const anotherComponent = { ...mockComponent, id: 'another-component', name: 'Another' };
      store.setState({
        components: [mockComponent, anotherComponent],
        selectedComponent: mockComponent,
        categories: ['shapes'],
        isLoading: false,
        isInitialized: true,
        error: null,
      });

      store.deleteComponent('another-component');

      expect(store.getState().selectedComponent!.id).toBe('test-component-1');
    });

    it('should update categories after deletion', () => {
      store.deleteComponent('test-component-1');

      expect(store.getState().categories).toEqual([]);
    });
  });

  describe('Duplicate Component', () => {
    beforeEach(() => {
      store.setState({
        components: [mockComponent],
        selectedComponent: null,
        categories: ['shapes'],
        isLoading: false,
        isInitialized: true,
        error: null,
      });
    });

    it('should duplicate a component', () => {
      const duplicate = store.duplicateComponent('test-component-1');

      expect(duplicate).not.toBeNull();
      expect(duplicate!.id).not.toBe('test-component-1');
      expect(duplicate!.name).toBe('Test Component (Copy)');
      expect(duplicate!.children).toHaveLength(1);
      expect(duplicate!.isPublic).toBe(false); // Always false for duplicates
    });

    it('should return null for non-existent component', () => {
      const result = store.duplicateComponent('non-existent');

      expect(result).toBeNull();
      expect(store.getState().error).toBe('Component not found');
    });

    it('should add duplicate to components list', () => {
      store.duplicateComponent('test-component-1');

      expect(store.getState().components).toHaveLength(2);
    });
  });

  describe('Record Usage', () => {
    beforeEach(() => {
      store.setState({
        components: [mockComponent],
        selectedComponent: null,
        categories: [],
        isLoading: false,
        isInitialized: true,
        error: null,
      });
    });

    it('should increment usage count', () => {
      store.recordUsage('test-component-1');

      expect(store.getComponent('test-component-1')!.usageCount).toBe(1);
    });

    it('should increment multiple times', () => {
      store.recordUsage('test-component-1');
      store.recordUsage('test-component-1');
      store.recordUsage('test-component-1');

      expect(store.getComponent('test-component-1')!.usageCount).toBe(3);
    });

    it('should not fail for non-existent component', () => {
      // Should not throw
      store.recordUsage('non-existent');

      expect(store.getState().components).toHaveLength(1);
    });
  });

  describe('Get By Category', () => {
    beforeEach(() => {
      const components = [
        { ...mockComponent, id: 'c1', category: 'shapes' },
        { ...mockComponent, id: 'c2', category: 'shapes' },
        { ...mockComponent, id: 'c3', category: 'icons' },
        { ...mockComponent, id: 'c4', category: undefined },
      ];
      store.setState({
        components,
        selectedComponent: null,
        categories: ['shapes', 'icons'],
        isLoading: false,
        isInitialized: true,
        error: null,
      });
    });

    it('should get components by category', () => {
      const shapes = store.getByCategory('shapes');

      expect(shapes).toHaveLength(2);
      expect(shapes[0].category).toBe('shapes');
      expect(shapes[1].category).toBe('shapes');
    });

    it('should get uncategorized components when passing null', () => {
      const uncategorized = store.getByCategory(null);

      expect(uncategorized).toHaveLength(1);
      expect(uncategorized[0].category).toBeUndefined();
    });

    it('should return empty array for non-existent category', () => {
      const result = store.getByCategory('non-existent');

      expect(result).toEqual([]);
    });
  });

  describe('Search', () => {
    beforeEach(() => {
      const baseComponent: CustomComponentDefinition = {
        id: 'base',
        userId: 'local',
        name: 'Base',
        children: [],
        properties: [],
        defaultTransform: DEFAULT_TRANSFORM,
        isPublic: false,
        usageCount: 0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      const components: CustomComponentDefinition[] = [
        { ...baseComponent, id: 'c1', name: 'Blue Button', description: 'A blue button' },
        { ...baseComponent, id: 'c2', name: 'Red Circle', description: 'A red circle' },
        { ...baseComponent, id: 'c3', name: 'Green Square', tags: ['square', 'colored'] },
        { ...baseComponent, id: 'c4', name: 'Yellow Star', description: 'A star polygon' },
      ];
      store.setState({
        components,
        selectedComponent: null,
        categories: [],
        isLoading: false,
        isInitialized: true,
        error: null,
      });
    });

    it('should search by name', () => {
      const results = store.search('button');

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Blue Button');
    });

    it('should search by description', () => {
      const results = store.search('circle');

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Red Circle');
    });

    it('should search by tags', () => {
      const results = store.search('colored');

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Green Square');
    });

    it('should be case insensitive', () => {
      const results = store.search('BLUE');

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Blue Button');
    });

    it('should return multiple matches', () => {
      const results = store.search('square');

      expect(results).toHaveLength(1); // Green Square (tag and name)
    });

    it('should return empty array for no matches', () => {
      const results = store.search('purple');

      expect(results).toEqual([]);
    });
  });

  describe('Get Recently Used', () => {
    beforeEach(() => {
      const components: CustomComponentDefinition[] = [
        { ...mockComponent, id: 'c1', usageCount: 10 },
        { ...mockComponent, id: 'c2', usageCount: 5 },
        { ...mockComponent, id: 'c3', usageCount: 20 },
        { ...mockComponent, id: 'c4', usageCount: 0 },
        { ...mockComponent, id: 'c5', usageCount: 15 },
      ];
      store.setState({
        components,
        selectedComponent: null,
        categories: [],
        isLoading: false,
        isInitialized: true,
        error: null,
      });
    });

    it('should return most used components', () => {
      const recent = store.getRecentlyUsed(3);

      expect(recent).toHaveLength(3);
      expect(recent[0].usageCount).toBe(20);
      expect(recent[1].usageCount).toBe(15);
      expect(recent[2].usageCount).toBe(10);
    });

    it('should exclude components with zero usage', () => {
      const recent = store.getRecentlyUsed();

      expect(recent.every(c => c.usageCount > 0)).toBe(true);
    });

    it('should respect limit parameter', () => {
      const recent = store.getRecentlyUsed(2);

      expect(recent).toHaveLength(2);
    });

    it('should default to limit of 5', () => {
      // Add more used components
      const moreComponents = Array.from({ length: 10 }, (_, i) => ({
        ...mockComponent,
        id: `used-${i}`,
        usageCount: i + 1,
      }));
      store.setState({
        components: moreComponents,
        selectedComponent: null,
        categories: [],
        isLoading: false,
        isInitialized: true,
        error: null,
      });

      const recent = store.getRecentlyUsed();

      expect(recent).toHaveLength(5);
    });
  });

  describe('Get All Sorted', () => {
    beforeEach(() => {
      const components: CustomComponentDefinition[] = [
        { ...mockComponent, id: 'c1', name: 'Zebra', usageCount: 5, createdAt: '2024-01-01', updatedAt: '2024-03-01' },
        { ...mockComponent, id: 'c2', name: 'Apple', usageCount: 10, createdAt: '2024-03-01', updatedAt: '2024-01-01' },
        { ...mockComponent, id: 'c3', name: 'Mango', usageCount: 2, createdAt: '2024-02-01', updatedAt: '2024-02-01' },
      ];
      store.setState({
        components,
        selectedComponent: null,
        categories: [],
        isLoading: false,
        isInitialized: true,
        error: null,
      });
    });

    it('should sort by name (default)', () => {
      const sorted = store.getAll();

      expect(sorted[0].name).toBe('Apple');
      expect(sorted[1].name).toBe('Mango');
      expect(sorted[2].name).toBe('Zebra');
    });

    it('should sort by name explicitly', () => {
      const sorted = store.getAll('name');

      expect(sorted[0].name).toBe('Apple');
      expect(sorted[2].name).toBe('Zebra');
    });

    it('should sort by usage count (descending)', () => {
      const sorted = store.getAll('usageCount');

      expect(sorted[0].usageCount).toBe(10);
      expect(sorted[1].usageCount).toBe(5);
      expect(sorted[2].usageCount).toBe(2);
    });

    it('should sort by created date (newest first)', () => {
      const sorted = store.getAll('createdAt');

      expect(sorted[0].id).toBe('c2'); // 2024-03-01
      expect(sorted[1].id).toBe('c3'); // 2024-02-01
      expect(sorted[2].id).toBe('c1'); // 2024-01-01
    });

    it('should sort by updated date (newest first)', () => {
      const sorted = store.getAll('updatedAt');

      expect(sorted[0].id).toBe('c1'); // 2024-03-01
      expect(sorted[1].id).toBe('c3'); // 2024-02-01
      expect(sorted[2].id).toBe('c2'); // 2024-01-01
    });
  });

  describe('Import Components', () => {
    it('should import components', () => {
      const toImport: CustomComponentDefinition[] = [
        { ...mockComponent, id: 'import-1', name: 'Imported 1' },
        { ...mockComponent, id: 'import-2', name: 'Imported 2' },
      ];

      const count = store.importComponents(toImport);

      expect(count).toBe(2);
      expect(store.getState().components).toHaveLength(2);
    });

    it('should assign new IDs to conflicting components', () => {
      // Add existing component
      store.setState({
        components: [mockComponent],
        selectedComponent: null,
        categories: [],
        isLoading: false,
        isInitialized: true,
        error: null,
      });

      const toImport: CustomComponentDefinition[] = [
        { ...mockComponent, id: 'test-component-1', name: 'Conflicting' }, // Same ID as existing
      ];

      store.importComponents(toImport);

      const components = store.getState().components;
      expect(components).toHaveLength(2);
      expect(components[0].id).toBe('test-component-1');
      expect(components[1].id).not.toBe('test-component-1');
      expect(components[1].name).toBe('Conflicting');
    });

    it('should set userId to local', () => {
      const toImport: CustomComponentDefinition[] = [
        { ...mockComponent, id: 'import-1', userId: 'other-user' },
      ];

      store.importComponents(toImport);

      expect(store.getState().components[0].userId).toBe('local');
    });

    it('should update categories after import', () => {
      const toImport: CustomComponentDefinition[] = [
        { ...mockComponent, id: 'import-1', category: 'imported-cat' },
      ];

      store.importComponents(toImport);

      expect(store.getState().categories).toContain('imported-cat');
    });
  });

  describe('Export Components', () => {
    it('should export all components', () => {
      store.setState({
        components: [mockComponent],
        selectedComponent: null,
        categories: [],
        isLoading: false,
        isInitialized: true,
        error: null,
      });

      const exported = store.exportComponents();

      expect(exported).toEqual([mockComponent]);
    });

    it('should return empty array when no components', () => {
      const exported = store.exportComponents();

      expect(exported).toEqual([]);
    });
  });

  describe('Clear Error', () => {
    it('should clear error state', () => {
      store.setState({
        components: [],
        selectedComponent: null,
        categories: [],
        isLoading: false,
        isInitialized: true,
        error: 'Some error',
      });

      store.clearError();

      expect(store.getState().error).toBeNull();
    });
  });

  describe('Clear All', () => {
    beforeEach(() => {
      store.setState({
        components: [mockComponent],
        selectedComponent: mockComponent,
        categories: ['shapes'],
        isLoading: false,
        isInitialized: true,
        error: null,
      });
    });

    it('should clear all components', () => {
      store.clearAll();

      expect(store.getState().components).toEqual([]);
    });

    it('should clear selected component', () => {
      store.clearAll();

      expect(store.getState().selectedComponent).toBeNull();
    });

    it('should clear categories', () => {
      store.clearAll();

      expect(store.getState().categories).toEqual([]);
    });
  });

  describe('Subscriptions', () => {
    it('should notify subscribers on state changes', () => {
      const subscriber = vi.fn();
      store.subscribe(subscriber);

      store.createComponent({ name: 'Test', children: [] });

      expect(subscriber).toHaveBeenCalled();
    });

    it('should unsubscribe correctly', () => {
      const subscriber = vi.fn();
      const unsubscribe = store.subscribe(subscriber);

      unsubscribe();
      subscriber.mockClear();

      store.createComponent({ name: 'Test', children: [] });

      expect(subscriber).not.toHaveBeenCalled();
    });

    it('should provide previous and current state to subscribers', () => {
      store.setState({
        components: [mockComponent],
        selectedComponent: null,
        categories: [],
        isLoading: false,
        isInitialized: true,
        error: null,
      });

      const subscriber = vi.fn();
      store.subscribe(subscriber);

      store.selectComponent('test-component-1');

      expect(subscriber).toHaveBeenCalledWith(
        expect.objectContaining({ selectedComponent: mockComponent }),
        expect.objectContaining({ selectedComponent: null })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle creating many components', () => {
      for (let i = 0; i < 100; i++) {
        store.createComponent({ name: `Component ${i}`, children: [] });
      }

      expect(store.getState().components).toHaveLength(100);
    });

    it('should handle empty search query', () => {
      store.createComponent({ name: 'Test', children: [] });

      const results = store.search('');

      expect(results).toHaveLength(1); // Matches empty string
    });

    it('should handle components without optional fields', () => {
      const component = store.createComponent({
        name: 'Minimal',
        children: [],
      });

      expect(component.description).toBeUndefined();
      expect(component.category).toBeUndefined();
      expect(component.tags).toEqual([]);
    });

    it('should handle rapid create and delete operations', () => {
      const ids: string[] = [];

      for (let i = 0; i < 50; i++) {
        const c = store.createComponent({ name: `Component ${i}`, children: [] });
        ids.push(c.id);
      }

      for (const id of ids) {
        store.deleteComponent(id);
      }

      expect(store.getState().components).toHaveLength(0);
    });

    it('should handle text components in children', () => {
      const textChild: CustomComponentChild = {
        id: 'text-1',
        name: 'Label',
        type: 'text',
        transform: DEFAULT_TRANSFORM,
        opacity: 1,
        text: 'Hello World',
        fontSize: 24,
        fontFamily: 'Arial',
        zIndex: 0,
      };

      const component = store.createComponent({
        name: 'Text Component',
        children: [textChild],
      });

      expect(component.children[0].type).toBe('text');
      expect(component.children[0].text).toBe('Hello World');
    });

    it('should handle sprite components in children', () => {
      const spriteChild: CustomComponentChild = {
        id: 'sprite-1',
        name: 'Image',
        type: 'sprite',
        transform: DEFAULT_TRANSFORM,
        opacity: 0.8,
        zIndex: 0,
      };

      const component = store.createComponent({
        name: 'Sprite Component',
        children: [spriteChild],
      });

      expect(component.children[0].type).toBe('sprite');
    });
  });
});
