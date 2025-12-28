/**
 * Editor Settings Store
 * Manages editor preferences including format-on-save
 */

export interface EditorSettings {
  formatOnSave: boolean;
  tabSize: number;
  useTabs: boolean;
}

type EditorSettingsListener = (settings: EditorSettings) => void;

const STORAGE_KEY = 'webedt_editor_settings';

const DEFAULT_SETTINGS: EditorSettings = {
  formatOnSave: true,
  tabSize: 2,
  useTabs: false,
};

class EditorSettingsStore {
  private settings: EditorSettings;
  private listeners: Set<EditorSettingsListener> = new Set();

  constructor() {
    this.settings = this.loadFromStorage();
  }

  private loadFromStorage(): EditorSettings {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch (error) {
      console.error('Failed to load editor settings:', error);
    }
    return { ...DEFAULT_SETTINGS };
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch (error) {
      console.error('Failed to save editor settings:', error);
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.settings);
    }
  }

  getSettings(): EditorSettings {
    return { ...this.settings };
  }

  getFormatOnSave(): boolean {
    return this.settings.formatOnSave;
  }

  getTabSize(): number {
    return this.settings.tabSize;
  }

  getUseTabs(): boolean {
    return this.settings.useTabs;
  }

  setFormatOnSave(value: boolean): void {
    this.settings.formatOnSave = value;
    this.saveToStorage();
    this.notifyListeners();
  }

  setTabSize(value: number): void {
    if (value >= 1 && value <= 8) {
      this.settings.tabSize = value;
      this.saveToStorage();
      this.notifyListeners();
    }
  }

  setUseTabs(value: boolean): void {
    this.settings.useTabs = value;
    this.saveToStorage();
    this.notifyListeners();
  }

  updateSettings(updates: Partial<EditorSettings>): void {
    this.settings = { ...this.settings, ...updates };
    this.saveToStorage();
    this.notifyListeners();
  }

  subscribe(listener: EditorSettingsListener): () => void {
    this.listeners.add(listener);
    // Immediately call with current settings
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

export const editorSettingsStore = new EditorSettingsStore();
