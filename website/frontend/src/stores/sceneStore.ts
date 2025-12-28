/**
 * Scene Store
 * Manages multiple scenes for multi-scene editing
 */

import { createStore } from '../lib/store';

import type { Transform } from '../components';

export type SceneObjectType = 'sprite' | 'shape' | 'text' | 'group' | 'empty';
export type ShapeType = 'rectangle' | 'circle' | 'ellipse' | 'polygon' | 'line';

export interface SceneObject {
  id: string;
  name: string;
  type: SceneObjectType;
  visible: boolean;
  locked: boolean;
  transform: Transform;
  zIndex: number;
  opacity: number;
  children?: SceneObject[];
  // Type-specific properties
  shapeType?: ShapeType;
  color?: string;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  spriteUrl?: string;
}

export interface SceneSettings {
  showGrid: boolean;
  gridSize: number;
  snapToGrid: boolean;
}

export interface Scene {
  id: string;
  name: string;
  objects: SceneObject[];
  settings: SceneSettings;
  isDirty: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SceneStoreState {
  scenes: Record<string, Scene>;
  openSceneIds: string[];
  activeSceneId: string | null;
  sceneOrder: string[];
}

const DEFAULT_SETTINGS: SceneSettings = {
  showGrid: true,
  gridSize: 32,
  snapToGrid: true,
};

function generateSceneId(): string {
  return `scene-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function createDefaultScene(name: string): Scene {
  const now = Date.now();
  return {
    id: generateSceneId(),
    name,
    objects: [],
    settings: { ...DEFAULT_SETTINGS },
    isDirty: false,
    createdAt: now,
    updatedAt: now,
  };
}

export const sceneStore = createStore<SceneStoreState, {
  // Scene Management
  createScene: (name?: string) => Scene;
  openScene: (sceneId: string) => void;
  closeScene: (sceneId: string) => void;
  setActiveScene: (sceneId: string) => void;
  renameScene: (sceneId: string, name: string) => void;
  deleteScene: (sceneId: string) => void;
  duplicateScene: (sceneId: string) => Scene | null;
  reorderScenes: (fromIndex: number, toIndex: number) => void;

  // Scene Content
  updateSceneObjects: (sceneId: string, objects: SceneObject[]) => void;
  updateSceneSettings: (sceneId: string, settings: Partial<SceneSettings>) => void;
  markSceneDirty: (sceneId: string) => void;
  markSceneSaved: (sceneId: string) => void;

  // Getters
  getScene: (sceneId: string) => Scene | null;
  getActiveScene: () => Scene | null;
  getOpenScenes: () => Scene[];
  hasUnsavedScenes: () => boolean;

  // Bulk Operations
  loadScenes: (scenes: Scene[]) => void;
  closeAllScenes: () => void;
  saveAllScenes: () => void;
}>(
  {
    scenes: {},
    openSceneIds: [],
    activeSceneId: null,
    sceneOrder: [],
  },
  (set, get) => ({
    createScene(name?: string): Scene {
      const state = get();
      const sceneCount = Object.keys(state.scenes).length;
      const sceneName = name || `Scene ${sceneCount + 1}`;
      const scene = createDefaultScene(sceneName);

      set({
        scenes: { ...state.scenes, [scene.id]: scene },
        openSceneIds: [...state.openSceneIds, scene.id],
        activeSceneId: scene.id,
        sceneOrder: [...state.sceneOrder, scene.id],
      });

      return scene;
    },

    openScene(sceneId: string): void {
      const state = get();
      if (!state.scenes[sceneId]) return;

      if (!state.openSceneIds.includes(sceneId)) {
        set({
          openSceneIds: [...state.openSceneIds, sceneId],
          activeSceneId: sceneId,
        });
      } else {
        set({ activeSceneId: sceneId });
      }
    },

    closeScene(sceneId: string): void {
      const state = get();
      const newOpenSceneIds = state.openSceneIds.filter(id => id !== sceneId);

      let newActiveSceneId = state.activeSceneId;
      if (state.activeSceneId === sceneId) {
        // Select adjacent scene if closing active
        const closedIndex = state.openSceneIds.indexOf(sceneId);
        if (newOpenSceneIds.length > 0) {
          newActiveSceneId = newOpenSceneIds[Math.min(closedIndex, newOpenSceneIds.length - 1)];
        } else {
          newActiveSceneId = null;
        }
      }

      set({
        openSceneIds: newOpenSceneIds,
        activeSceneId: newActiveSceneId,
      });
    },

    setActiveScene(sceneId: string): void {
      const state = get();
      if (state.scenes[sceneId] && state.openSceneIds.includes(sceneId)) {
        set({ activeSceneId: sceneId });
      }
    },

    renameScene(sceneId: string, name: string): void {
      const state = get();
      const scene = state.scenes[sceneId];
      if (!scene) return;

      set({
        scenes: {
          ...state.scenes,
          [sceneId]: {
            ...scene,
            name,
            isDirty: true,
            updatedAt: Date.now(),
          },
        },
      });
    },

    deleteScene(sceneId: string): void {
      const state = get();
      const { [sceneId]: _, ...remainingScenes } = state.scenes;
      const newOpenSceneIds = state.openSceneIds.filter(id => id !== sceneId);
      const newSceneOrder = state.sceneOrder.filter(id => id !== sceneId);

      let newActiveSceneId = state.activeSceneId;
      if (state.activeSceneId === sceneId) {
        newActiveSceneId = newOpenSceneIds.length > 0 ? newOpenSceneIds[0] : null;
      }

      set({
        scenes: remainingScenes,
        openSceneIds: newOpenSceneIds,
        activeSceneId: newActiveSceneId,
        sceneOrder: newSceneOrder,
      });
    },

    duplicateScene(sceneId: string): Scene | null {
      const state = get();
      const original = state.scenes[sceneId];
      if (!original) return null;

      const duplicatedScene: Scene = {
        ...createDefaultScene(`${original.name} (Copy)`),
        objects: JSON.parse(JSON.stringify(original.objects)),
        settings: { ...original.settings },
      };

      set({
        scenes: { ...state.scenes, [duplicatedScene.id]: duplicatedScene },
        openSceneIds: [...state.openSceneIds, duplicatedScene.id],
        activeSceneId: duplicatedScene.id,
        sceneOrder: [...state.sceneOrder, duplicatedScene.id],
      });

      return duplicatedScene;
    },

    reorderScenes(fromIndex: number, toIndex: number): void {
      const state = get();
      const newOrder = [...state.sceneOrder];
      const [removed] = newOrder.splice(fromIndex, 1);
      newOrder.splice(toIndex, 0, removed);
      set({ sceneOrder: newOrder });
    },

    updateSceneObjects(sceneId: string, objects: SceneObject[]): void {
      const state = get();
      const scene = state.scenes[sceneId];
      if (!scene) return;

      set({
        scenes: {
          ...state.scenes,
          [sceneId]: {
            ...scene,
            objects,
            isDirty: true,
            updatedAt: Date.now(),
          },
        },
      });
    },

    updateSceneSettings(sceneId: string, settings: Partial<SceneSettings>): void {
      const state = get();
      const scene = state.scenes[sceneId];
      if (!scene) return;

      set({
        scenes: {
          ...state.scenes,
          [sceneId]: {
            ...scene,
            settings: { ...scene.settings, ...settings },
            isDirty: true,
            updatedAt: Date.now(),
          },
        },
      });
    },

    markSceneDirty(sceneId: string): void {
      const state = get();
      const scene = state.scenes[sceneId];
      if (!scene || scene.isDirty) return;

      set({
        scenes: {
          ...state.scenes,
          [sceneId]: {
            ...scene,
            isDirty: true,
            updatedAt: Date.now(),
          },
        },
      });
    },

    markSceneSaved(sceneId: string): void {
      const state = get();
      const scene = state.scenes[sceneId];
      if (!scene) return;

      set({
        scenes: {
          ...state.scenes,
          [sceneId]: {
            ...scene,
            isDirty: false,
          },
        },
      });
    },

    getScene(sceneId: string): Scene | null {
      return get().scenes[sceneId] || null;
    },

    getActiveScene(): Scene | null {
      const state = get();
      return state.activeSceneId ? state.scenes[state.activeSceneId] || null : null;
    },

    getOpenScenes(): Scene[] {
      const state = get();
      return state.openSceneIds
        .map(id => state.scenes[id])
        .filter((scene): scene is Scene => !!scene);
    },

    hasUnsavedScenes(): boolean {
      const state = get();
      return Object.values(state.scenes).some(scene => scene.isDirty);
    },

    loadScenes(scenes: Scene[]): void {
      const state = get();
      const newScenes: Record<string, Scene> = { ...state.scenes };
      const newSceneOrder: string[] = [...state.sceneOrder];

      for (const scene of scenes) {
        newScenes[scene.id] = scene;
        if (!newSceneOrder.includes(scene.id)) {
          newSceneOrder.push(scene.id);
        }
      }

      set({
        scenes: newScenes,
        sceneOrder: newSceneOrder,
      });
    },

    closeAllScenes(): void {
      set({
        openSceneIds: [],
        activeSceneId: null,
      });
    },

    saveAllScenes(): void {
      const state = get();
      const updatedScenes: Record<string, Scene> = {};

      for (const [id, scene] of Object.entries(state.scenes)) {
        updatedScenes[id] = {
          ...scene,
          isDirty: false,
        };
      }

      set({ scenes: updatedScenes });
    },
  })
);

export default sceneStore;
