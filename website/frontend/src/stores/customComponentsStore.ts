/**
 * Custom Components Store
 * Manages user-defined custom component definitions for the scene editor
 */

import { Store, persist } from '../lib/store';
import type {
  CustomComponentDefinition,
  CustomComponentChild,
  CustomComponentTransform,
  CreateCustomComponentRequest,
  UpdateCustomComponentRequest,
} from '../types';

interface CustomComponentsState {
  components: CustomComponentDefinition[];
  selectedComponent: CustomComponentDefinition | null;
  categories: string[];
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
}

const DEFAULT_TRANSFORM: CustomComponentTransform = {
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  pivotX: 0.5,
  pivotY: 0.5,
};

export class CustomComponentsStore extends Store<CustomComponentsState> {
  constructor() {
    super({
      components: [],
      selectedComponent: null,
      categories: [],
      isLoading: false,
      isInitialized: false,
      error: null,
    });

    // Initialize with localStorage persistence (loads synchronously)
    persist(this, 'webedt:custom-components', {
      include: ['components', 'categories'],
    });

    // Update categories from loaded data and mark as initialized
    // Note: persist() loads synchronously from localStorage, so data is already available
    this.updateCategories();
    this.setState({ isInitialized: true });
  }

  /**
   * Update categories from components
   */
  private updateCategories(): void {
    const categories = new Set<string>();
    for (const component of this.getState().components) {
      if (component.category) {
        categories.add(component.category);
      }
    }
    this.setState({ categories: Array.from(categories).sort() });
  }

  /**
   * Generate unique ID for new components
   */
  private generateId(): string {
    return `custom-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Create a new custom component from scene objects
   */
  createComponent(data: CreateCustomComponentRequest): CustomComponentDefinition {
    const now = new Date().toISOString();
    const component: CustomComponentDefinition = {
      id: this.generateId(),
      userId: 'local',
      name: data.name,
      description: data.description,
      icon: data.icon || '📦',
      category: data.category,
      tags: data.tags || [],
      children: data.children,
      properties: data.properties || [],
      defaultTransform: {
        ...DEFAULT_TRANSFORM,
        ...data.defaultTransform,
      },
      isPublic: data.isPublic || false,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    const components = [...this.getState().components, component];
    this.setState({ components });
    this.updateCategories();

    return component;
  }

  /**
   * Create component from selected scene objects
   */
  createFromSelection(
    name: string,
    selectedObjects: Array<{
      id: string;
      name: string;
      type: 'sprite' | 'shape' | 'text';
      shapeType?: 'rectangle' | 'circle' | 'ellipse' | 'polygon' | 'line';
      transform: CustomComponentTransform;
      opacity: number;
      color?: string;
      text?: string;
      fontSize?: number;
      fontFamily?: string;
      zIndex: number;
    }>,
    options?: {
      description?: string;
      icon?: string;
      category?: string;
    }
  ): CustomComponentDefinition | null {
    if (selectedObjects.length === 0) {
      this.setState({ error: 'No objects selected' });
      return null;
    }

    // Calculate center point of all objects for relative positioning
    const centerX = selectedObjects.reduce((sum, obj) => sum + obj.transform.x, 0) / selectedObjects.length;
    const centerY = selectedObjects.reduce((sum, obj) => sum + obj.transform.y, 0) / selectedObjects.length;

    // Convert to children with positions relative to center
    const children: CustomComponentChild[] = selectedObjects.map((obj, index) => ({
      id: `child-${index}`,
      name: obj.name,
      type: obj.type,
      shapeType: obj.shapeType,
      transform: {
        ...obj.transform,
        x: obj.transform.x - centerX,
        y: obj.transform.y - centerY,
      },
      opacity: obj.opacity,
      color: obj.color,
      text: obj.text,
      fontSize: obj.fontSize,
      fontFamily: obj.fontFamily,
      zIndex: obj.zIndex,
    }));

    return this.createComponent({
      name,
      children,
      description: options?.description,
      icon: options?.icon,
      category: options?.category,
    });
  }

  /**
   * Get a component by ID
   */
  getComponent(id: string): CustomComponentDefinition | undefined {
    return this.getState().components.find(c => c.id === id);
  }

  /**
   * Select a component
   */
  selectComponent(id: string | null): void {
    const component = id ? this.getComponent(id) || null : null;
    this.setState({ selectedComponent: component });
  }

  /**
   * Update a component
   */
  updateComponent(id: string, data: UpdateCustomComponentRequest): CustomComponentDefinition | null {
    const components = this.getState().components;
    const index = components.findIndex(c => c.id === id);

    if (index === -1) {
      this.setState({ error: 'Component not found' });
      return null;
    }

    const updated: CustomComponentDefinition = {
      ...components[index],
      ...data,
      defaultTransform: data.defaultTransform
        ? { ...components[index].defaultTransform, ...data.defaultTransform }
        : components[index].defaultTransform,
      updatedAt: new Date().toISOString(),
    };

    const newComponents = [...components];
    newComponents[index] = updated;

    this.setState({
      components: newComponents,
      selectedComponent: this.getState().selectedComponent?.id === id
        ? updated
        : this.getState().selectedComponent,
    });

    this.updateCategories();
    return updated;
  }

  /**
   * Delete a component
   */
  deleteComponent(id: string): boolean {
    const components = this.getState().components.filter(c => c.id !== id);

    if (components.length === this.getState().components.length) {
      return false;
    }

    this.setState({
      components,
      selectedComponent: this.getState().selectedComponent?.id === id
        ? null
        : this.getState().selectedComponent,
    });

    this.updateCategories();
    return true;
  }

  /**
   * Duplicate a component
   */
  duplicateComponent(id: string): CustomComponentDefinition | null {
    const original = this.getComponent(id);
    if (!original) {
      this.setState({ error: 'Component not found' });
      return null;
    }

    return this.createComponent({
      name: `${original.name} (Copy)`,
      description: original.description,
      icon: original.icon,
      category: original.category,
      tags: [...(original.tags || [])],
      children: original.children.map(child => ({ ...child, id: `child-${Date.now()}-${Math.random().toString(36).substring(2, 5)}` })),
      properties: [...original.properties],
      defaultTransform: { ...original.defaultTransform },
      isPublic: false,
    });
  }

  /**
   * Increment usage count when component is instantiated
   */
  recordUsage(id: string): void {
    const components = this.getState().components;
    const index = components.findIndex(c => c.id === id);

    if (index !== -1) {
      const newComponents = [...components];
      newComponents[index] = {
        ...newComponents[index],
        usageCount: newComponents[index].usageCount + 1,
      };
      this.setState({ components: newComponents });
    }
  }

  /**
   * Get components by category
   */
  getByCategory(category: string | null): CustomComponentDefinition[] {
    const components = this.getState().components;
    if (!category) {
      return components.filter(c => !c.category);
    }
    return components.filter(c => c.category === category);
  }

  /**
   * Search components
   */
  search(query: string): CustomComponentDefinition[] {
    const lowerQuery = query.toLowerCase();
    return this.getState().components.filter(c =>
      c.name.toLowerCase().includes(lowerQuery) ||
      c.description?.toLowerCase().includes(lowerQuery) ||
      c.tags?.some(t => t.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Get recently used components
   */
  getRecentlyUsed(limit = 5): CustomComponentDefinition[] {
    return this.getState().components
      .filter(c => c.usageCount > 0)
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit);
  }

  /**
   * Get all components sorted
   */
  getAll(sortBy: 'name' | 'usageCount' | 'createdAt' | 'updatedAt' = 'name'): CustomComponentDefinition[] {
    const components = [...this.getState().components];

    switch (sortBy) {
      case 'name':
        return components.sort((a, b) => a.name.localeCompare(b.name));
      case 'usageCount':
        return components.sort((a, b) => b.usageCount - a.usageCount);
      case 'createdAt':
        return components.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      case 'updatedAt':
        return components.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      default:
        return components;
    }
  }

  /**
   * Import components from JSON
   */
  importComponents(data: CustomComponentDefinition[]): number {
    const existingIds = new Set(this.getState().components.map(c => c.id));
    const now = new Date().toISOString();

    const newComponents: CustomComponentDefinition[] = [];
    for (const component of data) {
      // Assign new ID if it already exists
      const id = existingIds.has(component.id) ? this.generateId() : component.id;
      existingIds.add(id);

      newComponents.push({
        ...component,
        id,
        userId: 'local',
        createdAt: now,
        updatedAt: now,
      });
    }

    this.setState({
      components: [...this.getState().components, ...newComponents],
    });

    this.updateCategories();
    return newComponents.length;
  }

  /**
   * Export all components as JSON
   */
  exportComponents(): CustomComponentDefinition[] {
    return this.getState().components;
  }

  /**
   * Clear error
   */
  clearError(): void {
    this.setState({ error: null });
  }

  /**
   * Clear all components (use with caution)
   */
  clearAll(): void {
    this.setState({
      components: [],
      selectedComponent: null,
      categories: [],
    });
  }
}

// Singleton instance
export const customComponentsStore = new CustomComponentsStore();
