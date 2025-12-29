/**
 * Editor Settings Store
 * Manages editor preferences including format-on-save
 */

import { z } from 'zod';

import { STORE_KEYS } from '../lib/storageKeys';
import { TypedStorage } from '../lib/typedStorage';

export interface EditorSettings {
  formatOnSave: boolean;
  tabSize: number;
  useTabs: boolean;
}

type EditorSettingsListener = (settings: EditorSettings) => void;

const EditorSettingsSchema = z.object({
  formatOnSave: z.boolean().default(true),
  tabSize: z.number().min(1).max(8).default(2),
  useTabs: z.boolean().default(false),
});

const DEFAULT_SETTINGS: EditorSettings = {
  formatOnSave: true,
  tabSize: 2,
  useTabs: false,
};

const editorSettingsStorage = new TypedStorage({
  key: STORE_KEYS.EDITOR_SETTINGS,
  schema: EditorSettingsSchema,
  defaultValue: DEFAULT_SETTINGS,
  version: 1,
});

class EditorSettingsStore {
  private settings: EditorSettings;
  private listeners: Set<EditorSettingsListener> = new Set();

  constructor() {
    this.settings = editorSettingsStorage.get();
  }

  private saveToStorage(): void {
    editorSettingsStorage.set(this.settings);
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
