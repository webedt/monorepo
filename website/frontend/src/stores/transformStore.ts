/**
 * Transform Store
 * Manages transform state and settings for position, rotation, and scale
 */

export interface TransformSettings {
  /** Link scaleX and scaleY together */
  linkScale: boolean;
  /** Snap position to grid */
  snapToGrid: boolean;
  /** Grid size for snapping */
  gridSize: number;
  /** Snap rotation to angles */
  snapRotation: boolean;
  /** Rotation snap increment (degrees) */
  rotationSnapIncrement: number;
  /** Show transform gizmos */
  showGizmos: boolean;
  /** Transform origin (0-1 range) */
  originX: number;
  originY: number;
}

export interface TransformState {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

type TransformSettingsListener = (settings: TransformSettings) => void;
type TransformStateListener = (state: TransformState) => void;

const SETTINGS_STORAGE_KEY = 'webedt_transform_settings';

const DEFAULT_SETTINGS: TransformSettings = {
  linkScale: true,
  snapToGrid: true,
  gridSize: 8,
  snapRotation: false,
  rotationSnapIncrement: 15,
  showGizmos: true,
  originX: 0.5,
  originY: 0.5,
};

const DEFAULT_STATE: TransformState = {
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
};

class TransformStore {
  private settings: TransformSettings;
  private state: TransformState;
  private settingsListeners: Set<TransformSettingsListener> = new Set();
  private stateListeners: Set<TransformStateListener> = new Set();

  constructor() {
    this.settings = this.loadSettingsFromStorage();
    this.state = { ...DEFAULT_STATE };
  }

  private loadSettingsFromStorage(): TransformSettings {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch (error) {
      console.error('Failed to load transform settings:', error);
    }
    return { ...DEFAULT_SETTINGS };
  }

  private saveSettingsToStorage(): void {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.settings));
    } catch (error) {
      console.error('Failed to save transform settings:', error);
    }
  }

  private notifySettingsListeners(): void {
    for (const listener of this.settingsListeners) {
      listener(this.settings);
    }
  }

  private notifyStateListeners(): void {
    for (const listener of this.stateListeners) {
      listener(this.state);
    }
  }

  // Settings getters/setters

  getSettings(): TransformSettings {
    return { ...this.settings };
  }

  updateSettings(updates: Partial<TransformSettings>): void {
    this.settings = { ...this.settings, ...updates };
    this.saveSettingsToStorage();
    this.notifySettingsListeners();
  }

  isLinkScaleEnabled(): boolean {
    return this.settings.linkScale;
  }

  setLinkScale(enabled: boolean): void {
    this.settings.linkScale = enabled;
    this.saveSettingsToStorage();
    this.notifySettingsListeners();
  }

  toggleLinkScale(): boolean {
    this.settings.linkScale = !this.settings.linkScale;
    this.saveSettingsToStorage();
    this.notifySettingsListeners();
    return this.settings.linkScale;
  }

  isSnapToGridEnabled(): boolean {
    return this.settings.snapToGrid;
  }

  setSnapToGrid(enabled: boolean): void {
    this.settings.snapToGrid = enabled;
    this.saveSettingsToStorage();
    this.notifySettingsListeners();
  }

  getGridSize(): number {
    return this.settings.gridSize;
  }

  setGridSize(size: number): void {
    if (size > 0) {
      this.settings.gridSize = size;
      this.saveSettingsToStorage();
      this.notifySettingsListeners();
    }
  }

  isSnapRotationEnabled(): boolean {
    return this.settings.snapRotation;
  }

  setSnapRotation(enabled: boolean): void {
    this.settings.snapRotation = enabled;
    this.saveSettingsToStorage();
    this.notifySettingsListeners();
  }

  getRotationSnapIncrement(): number {
    return this.settings.rotationSnapIncrement;
  }

  setRotationSnapIncrement(increment: number): void {
    if (increment > 0 && increment <= 90) {
      this.settings.rotationSnapIncrement = increment;
      this.saveSettingsToStorage();
      this.notifySettingsListeners();
    }
  }

  isShowGizmosEnabled(): boolean {
    return this.settings.showGizmos;
  }

  setShowGizmos(enabled: boolean): void {
    this.settings.showGizmos = enabled;
    this.saveSettingsToStorage();
    this.notifySettingsListeners();
  }

  getOrigin(): { x: number; y: number } {
    return { x: this.settings.originX, y: this.settings.originY };
  }

  setOrigin(x: number, y: number): void {
    this.settings.originX = Math.max(0, Math.min(1, x));
    this.settings.originY = Math.max(0, Math.min(1, y));
    this.saveSettingsToStorage();
    this.notifySettingsListeners();
  }

  // State getters/setters

  getState(): TransformState {
    return { ...this.state };
  }

  setState(state: Partial<TransformState>): void {
    this.state = { ...this.state, ...state };
    this.notifyStateListeners();
  }

  setPosition(x: number, y: number): void {
    let newX = x;
    let newY = y;

    if (this.settings.snapToGrid) {
      newX = Math.round(x / this.settings.gridSize) * this.settings.gridSize;
      newY = Math.round(y / this.settings.gridSize) * this.settings.gridSize;
    }

    this.state.x = newX;
    this.state.y = newY;
    this.notifyStateListeners();
  }

  setRotation(rotation: number): void {
    let newRotation = ((rotation % 360) + 360) % 360;

    if (this.settings.snapRotation) {
      const increment = this.settings.rotationSnapIncrement;
      newRotation = Math.round(newRotation / increment) * increment;
    }

    this.state.rotation = newRotation;
    this.notifyStateListeners();
  }

  setScale(scaleX: number, scaleY?: number): void {
    this.state.scaleX = scaleX;
    this.state.scaleY = this.settings.linkScale ? scaleX : (scaleY ?? scaleX);
    this.notifyStateListeners();
  }

  reset(): void {
    this.state = { ...DEFAULT_STATE };
    this.notifyStateListeners();
  }

  // Subscription methods

  subscribeToSettings(listener: TransformSettingsListener): () => void {
    this.settingsListeners.add(listener);
    listener(this.settings);
    return () => {
      this.settingsListeners.delete(listener);
    };
  }

  subscribeToState(listener: TransformStateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  // Utility methods

  snapPosition(x: number, y: number): { x: number; y: number } {
    if (!this.settings.snapToGrid) {
      return { x, y };
    }
    return {
      x: Math.round(x / this.settings.gridSize) * this.settings.gridSize,
      y: Math.round(y / this.settings.gridSize) * this.settings.gridSize,
    };
  }

  snapRotation(rotation: number): number {
    if (!this.settings.snapRotation) {
      return rotation;
    }
    const increment = this.settings.rotationSnapIncrement;
    return Math.round(rotation / increment) * increment;
  }

  resetSettings(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    this.saveSettingsToStorage();
    this.notifySettingsListeners();
  }
}

export const transformStore = new TransformStore();
