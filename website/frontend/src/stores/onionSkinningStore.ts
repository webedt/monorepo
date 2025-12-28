/**
 * Onion Skinning Store
 * Manages onion skinning preferences for frame-by-frame animation
 */

export interface OnionSkinningSettings {
  enabled: boolean;
  showPrevious: boolean;
  showNext: boolean;
  previousCount: number;
  nextCount: number;
  previousOpacity: number;
  nextOpacity: number;
  previousColor: string;
  nextColor: string;
  useColors: boolean;
}

type OnionSkinningListener = (settings: OnionSkinningSettings) => void;

const STORAGE_KEY = 'webedt_onion_skinning';

const DEFAULT_SETTINGS: OnionSkinningSettings = {
  enabled: false,
  showPrevious: true,
  showNext: true,
  previousCount: 2,
  nextCount: 2,
  previousOpacity: 0.3,
  nextOpacity: 0.3,
  previousColor: '#ff0000',
  nextColor: '#0000ff',
  useColors: false,
};

class OnionSkinningStore {
  private settings: OnionSkinningSettings;
  private listeners: Set<OnionSkinningListener> = new Set();

  constructor() {
    this.settings = this.loadFromStorage();
  }

  private loadFromStorage(): OnionSkinningSettings {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch (error) {
      console.error('Failed to load onion skinning settings:', error);
    }
    return { ...DEFAULT_SETTINGS };
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch (error) {
      console.error('Failed to save onion skinning settings:', error);
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.settings);
    }
  }

  getSettings(): OnionSkinningSettings {
    return { ...this.settings };
  }

  isEnabled(): boolean {
    return this.settings.enabled;
  }

  setEnabled(value: boolean): void {
    this.settings.enabled = value;
    this.saveToStorage();
    this.notifyListeners();
  }

  toggleEnabled(): boolean {
    this.settings.enabled = !this.settings.enabled;
    this.saveToStorage();
    this.notifyListeners();
    return this.settings.enabled;
  }

  setShowPrevious(value: boolean): void {
    this.settings.showPrevious = value;
    this.saveToStorage();
    this.notifyListeners();
  }

  setShowNext(value: boolean): void {
    this.settings.showNext = value;
    this.saveToStorage();
    this.notifyListeners();
  }

  setPreviousCount(value: number): void {
    if (value >= 1 && value <= 10) {
      this.settings.previousCount = value;
      this.saveToStorage();
      this.notifyListeners();
    }
  }

  setNextCount(value: number): void {
    if (value >= 1 && value <= 10) {
      this.settings.nextCount = value;
      this.saveToStorage();
      this.notifyListeners();
    }
  }

  setPreviousOpacity(value: number): void {
    if (value >= 0 && value <= 1) {
      this.settings.previousOpacity = value;
      this.saveToStorage();
      this.notifyListeners();
    }
  }

  setNextOpacity(value: number): void {
    if (value >= 0 && value <= 1) {
      this.settings.nextOpacity = value;
      this.saveToStorage();
      this.notifyListeners();
    }
  }

  setPreviousColor(value: string): void {
    this.settings.previousColor = value;
    this.saveToStorage();
    this.notifyListeners();
  }

  setNextColor(value: string): void {
    this.settings.nextColor = value;
    this.saveToStorage();
    this.notifyListeners();
  }

  setUseColors(value: boolean): void {
    this.settings.useColors = value;
    this.saveToStorage();
    this.notifyListeners();
  }

  updateSettings(updates: Partial<OnionSkinningSettings>): void {
    this.settings = { ...this.settings, ...updates };
    this.saveToStorage();
    this.notifyListeners();
  }

  subscribe(listener: OnionSkinningListener): () => void {
    this.listeners.add(listener);
    listener(this.settings);
    return () => {
      this.listeners.delete(listener);
    };
  }

  reset(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    this.saveToStorage();
    this.notifyListeners();
  }
}

export const onionSkinningStore = new OnionSkinningStore();
