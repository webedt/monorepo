/**
 * Onion Skinning Store
 * Manages onion skinning preferences for frame-by-frame animation
 */

import { z } from 'zod';

import { STORE_KEYS } from '../lib/storageKeys';
import { TypedStorage } from '../lib/typedStorage';

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

const OnionSkinningSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  showPrevious: z.boolean().default(true),
  showNext: z.boolean().default(true),
  previousCount: z.number().min(1).max(10).default(2),
  nextCount: z.number().min(1).max(10).default(2),
  previousOpacity: z.number().min(0).max(1).default(0.3),
  nextOpacity: z.number().min(0).max(1).default(0.3),
  previousColor: z.string().default('#ff0000'),
  nextColor: z.string().default('#0000ff'),
  useColors: z.boolean().default(false),
});

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

const onionSkinningStorage = new TypedStorage({
  key: STORE_KEYS.ONION_SKINNING,
  schema: OnionSkinningSettingsSchema,
  defaultValue: DEFAULT_SETTINGS,
  version: 1,
});

class OnionSkinningStore {
  private settings: OnionSkinningSettings;
  private listeners: Set<OnionSkinningListener> = new Set();

  constructor() {
    this.settings = onionSkinningStorage.get() as OnionSkinningSettings;
  }

  private saveToStorage(): void {
    onionSkinningStorage.set(this.settings);
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
