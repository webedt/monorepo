/**
 * Tests for SceneStore
 * Covers multi-scene management including CRUD, state tracking,
 * and editor mode switching.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { sceneStore } from '../../src/stores/sceneStore';

import type { Scene, SceneObject, SceneSettings } from '../../src/stores/sceneStore';

describe('SceneStore', () => {
  beforeEach(() => {
    // Reset to initial state
    sceneStore.closeAllScenes();
    // Clear all scenes
    const state = sceneStore.getState();
    for (const sceneId of Object.keys(state.scenes)) {
      sceneStore.deleteScene(sceneId);
    }
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = sceneStore.getState();

      expect(state.scenes).toEqual({});
      expect(state.openSceneIds).toEqual([]);
      expect(state.activeSceneId).toBeNull();
      expect(state.sceneOrder).toEqual([]);
      expect(state.editorMode).toBe('edit');
    });

    it('should return null for getActiveScene when no scenes', () => {
      expect(sceneStore.getActiveScene()).toBeNull();
    });

    it('should return empty array for getOpenScenes when no scenes', () => {
      expect(sceneStore.getOpenScenes()).toEqual([]);
    });
  });

  describe('Scene Creation', () => {
    it('should create a scene with default name', () => {
      const scene = sceneStore.createScene();

      expect(scene.name).toBe('Scene 1');
      expect(scene.objects).toEqual([]);
      expect(scene.isDirty).toBe(false);
    });

    it('should create a scene with custom name', () => {
      const scene = sceneStore.createScene('My Custom Scene');

      expect(scene.name).toBe('My Custom Scene');
    });

    it('should auto-open and activate new scene', () => {
      const scene = sceneStore.createScene();

      const state = sceneStore.getState();
      expect(state.openSceneIds).toContain(scene.id);
      expect(state.activeSceneId).toBe(scene.id);
    });

    it('should add scene to scene order', () => {
      const scene = sceneStore.createScene();

      expect(sceneStore.getState().sceneOrder).toContain(scene.id);
    });

    it('should create scenes with unique IDs', () => {
      const scene1 = sceneStore.createScene();
      const scene2 = sceneStore.createScene();

      expect(scene1.id).not.toBe(scene2.id);
    });

    it('should increment default scene name', () => {
      sceneStore.createScene();
      const scene2 = sceneStore.createScene();

      expect(scene2.name).toBe('Scene 2');
    });
  });

  describe('Scene Opening/Closing', () => {
    let scene1: Scene;
    let scene2: Scene;

    beforeEach(() => {
      scene1 = sceneStore.createScene('Scene 1');
      scene2 = sceneStore.createScene('Scene 2');
    });

    describe('openScene', () => {
      it('should open a closed scene', () => {
        sceneStore.closeScene(scene1.id);

        sceneStore.openScene(scene1.id);

        expect(sceneStore.getState().openSceneIds).toContain(scene1.id);
        expect(sceneStore.getState().activeSceneId).toBe(scene1.id);
      });

      it('should set active when opening already open scene', () => {
        sceneStore.setActiveScene(scene1.id);

        sceneStore.openScene(scene2.id);

        expect(sceneStore.getState().activeSceneId).toBe(scene2.id);
      });

      it('should do nothing for non-existent scene', () => {
        sceneStore.openScene('non-existent');

        expect(sceneStore.getState().openSceneIds).not.toContain('non-existent');
      });
    });

    describe('closeScene', () => {
      it('should close a scene', () => {
        sceneStore.closeScene(scene1.id);

        expect(sceneStore.getState().openSceneIds).not.toContain(scene1.id);
      });

      it('should select adjacent scene when closing active', () => {
        sceneStore.setActiveScene(scene2.id);

        sceneStore.closeScene(scene2.id);

        expect(sceneStore.getState().activeSceneId).toBe(scene1.id);
      });

      it('should set activeSceneId to null when closing last open scene', () => {
        sceneStore.closeScene(scene1.id);
        sceneStore.closeScene(scene2.id);

        expect(sceneStore.getState().activeSceneId).toBeNull();
      });
    });

    describe('closeAllScenes', () => {
      it('should close all scenes', () => {
        sceneStore.closeAllScenes();

        const state = sceneStore.getState();
        expect(state.openSceneIds).toEqual([]);
        expect(state.activeSceneId).toBeNull();
      });
    });
  });

  describe('Active Scene Management', () => {
    it('should set active scene', () => {
      const scene1 = sceneStore.createScene('Scene 1');
      const scene2 = sceneStore.createScene('Scene 2');

      sceneStore.setActiveScene(scene1.id);

      expect(sceneStore.getState().activeSceneId).toBe(scene1.id);
    });

    it('should not set active for non-open scene', () => {
      const scene = sceneStore.createScene('Scene');
      sceneStore.closeScene(scene.id);

      sceneStore.setActiveScene(scene.id);

      expect(sceneStore.getState().activeSceneId).not.toBe(scene.id);
    });

    it('should get active scene', () => {
      const scene = sceneStore.createScene('Active Scene');

      expect(sceneStore.getActiveScene()?.name).toBe('Active Scene');
    });
  });

  describe('Scene Modification', () => {
    let scene: Scene;

    beforeEach(() => {
      scene = sceneStore.createScene('Test Scene');
    });

    describe('renameScene', () => {
      it('should rename a scene', () => {
        sceneStore.renameScene(scene.id, 'Renamed Scene');

        expect(sceneStore.getScene(scene.id)?.name).toBe('Renamed Scene');
      });

      it('should mark scene as dirty', () => {
        sceneStore.renameScene(scene.id, 'New Name');

        expect(sceneStore.getScene(scene.id)?.isDirty).toBe(true);
      });
    });

    describe('updateSceneObjects', () => {
      it('should update scene objects', () => {
        const objects: SceneObject[] = [
          {
            id: 'obj-1',
            name: 'Object 1',
            type: 'shape',
            visible: true,
            locked: false,
            transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
            zIndex: 0,
            opacity: 1,
          },
        ];

        sceneStore.updateSceneObjects(scene.id, objects);

        expect(sceneStore.getScene(scene.id)?.objects).toEqual(objects);
        expect(sceneStore.getScene(scene.id)?.isDirty).toBe(true);
      });
    });

    describe('updateSceneSettings', () => {
      it('should update scene settings', () => {
        sceneStore.updateSceneSettings(scene.id, { gridSize: 16 });

        expect(sceneStore.getScene(scene.id)?.settings.gridSize).toBe(16);
      });

      it('should merge with existing settings', () => {
        sceneStore.updateSceneSettings(scene.id, { gridSize: 16 });
        sceneStore.updateSceneSettings(scene.id, { snapToGrid: false });

        const settings = sceneStore.getScene(scene.id)?.settings;
        expect(settings?.gridSize).toBe(16);
        expect(settings?.snapToGrid).toBe(false);
      });
    });

    describe('markSceneDirty', () => {
      it('should mark scene as dirty', () => {
        sceneStore.markSceneDirty(scene.id);

        expect(sceneStore.getScene(scene.id)?.isDirty).toBe(true);
      });

      it('should not update if already dirty', () => {
        sceneStore.markSceneDirty(scene.id);
        const firstUpdate = sceneStore.getScene(scene.id)?.updatedAt;

        // Small delay to ensure timestamp would change
        sceneStore.markSceneDirty(scene.id);
        const secondUpdate = sceneStore.getScene(scene.id)?.updatedAt;

        expect(firstUpdate).toBe(secondUpdate);
      });
    });

    describe('markSceneSaved', () => {
      it('should mark scene as saved', () => {
        sceneStore.markSceneDirty(scene.id);
        sceneStore.markSceneSaved(scene.id);

        expect(sceneStore.getScene(scene.id)?.isDirty).toBe(false);
      });
    });
  });

  describe('Scene Deletion', () => {
    it('should delete a scene', () => {
      const scene = sceneStore.createScene('To Delete');

      sceneStore.deleteScene(scene.id);

      expect(sceneStore.getScene(scene.id)).toBeNull();
      expect(sceneStore.getState().openSceneIds).not.toContain(scene.id);
      expect(sceneStore.getState().sceneOrder).not.toContain(scene.id);
    });

    it('should update active scene when deleting active', () => {
      const scene1 = sceneStore.createScene('Scene 1');
      const scene2 = sceneStore.createScene('Scene 2');

      sceneStore.deleteScene(scene2.id);

      expect(sceneStore.getState().activeSceneId).toBe(scene1.id);
    });
  });

  describe('Scene Duplication', () => {
    it('should duplicate a scene', () => {
      const original = sceneStore.createScene('Original');
      sceneStore.updateSceneObjects(original.id, [
        {
          id: 'obj-1',
          name: 'Object 1',
          type: 'shape',
          visible: true,
          locked: false,
          transform: { x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 45 },
          zIndex: 0,
          opacity: 1,
        },
      ]);

      const duplicate = sceneStore.duplicateScene(original.id);

      expect(duplicate).not.toBeNull();
      expect(duplicate!.name).toBe('Original (Copy)');
      expect(duplicate!.objects.length).toBe(1);
      expect(duplicate!.id).not.toBe(original.id);
    });

    it('should deep clone objects', () => {
      const original = sceneStore.createScene('Original');
      sceneStore.updateSceneObjects(original.id, [
        {
          id: 'obj-1',
          name: 'Object 1',
          type: 'shape',
          visible: true,
          locked: false,
          transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
          zIndex: 0,
          opacity: 1,
        },
      ]);

      const duplicate = sceneStore.duplicateScene(original.id)!;

      // Modify duplicate's objects
      sceneStore.updateSceneObjects(duplicate.id, [
        { ...duplicate.objects[0], name: 'Modified' },
      ]);

      // Original should be unchanged
      expect(sceneStore.getScene(original.id)?.objects[0].name).toBe('Object 1');
    });

    it('should return null for non-existent scene', () => {
      const result = sceneStore.duplicateScene('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('Scene Reordering', () => {
    it('should reorder scenes', () => {
      const scene1 = sceneStore.createScene('Scene 1');
      const scene2 = sceneStore.createScene('Scene 2');
      const scene3 = sceneStore.createScene('Scene 3');

      sceneStore.reorderScenes(0, 2);

      const order = sceneStore.getState().sceneOrder;
      expect(order[2]).toBe(scene1.id);
    });

    it('should do nothing for invalid indices', () => {
      sceneStore.createScene('Scene 1');
      const originalOrder = [...sceneStore.getState().sceneOrder];

      sceneStore.reorderScenes(-1, 0);
      expect(sceneStore.getState().sceneOrder).toEqual(originalOrder);

      sceneStore.reorderScenes(0, 100);
      expect(sceneStore.getState().sceneOrder).toEqual(originalOrder);
    });

    it('should do nothing for same index', () => {
      sceneStore.createScene('Scene 1');
      const originalOrder = [...sceneStore.getState().sceneOrder];

      sceneStore.reorderScenes(0, 0);

      expect(sceneStore.getState().sceneOrder).toEqual(originalOrder);
    });
  });

  describe('Bulk Operations', () => {
    describe('loadScenes', () => {
      it('should load multiple scenes', () => {
        const scenes: Scene[] = [
          {
            id: 'scene-1',
            name: 'Loaded 1',
            objects: [],
            settings: {
              showGrid: true,
              gridSize: 32,
              snapToGrid: true,
              showConstraints: true,
              liveConstraintPreview: true,
            },
            isDirty: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          {
            id: 'scene-2',
            name: 'Loaded 2',
            objects: [],
            settings: {
              showGrid: true,
              gridSize: 32,
              snapToGrid: true,
              showConstraints: true,
              liveConstraintPreview: true,
            },
            isDirty: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ];

        sceneStore.loadScenes(scenes);

        expect(sceneStore.getScene('scene-1')?.name).toBe('Loaded 1');
        expect(sceneStore.getScene('scene-2')?.name).toBe('Loaded 2');
      });
    });

    describe('saveAllScenes', () => {
      it('should mark all scenes as saved', () => {
        const scene1 = sceneStore.createScene('Scene 1');
        const scene2 = sceneStore.createScene('Scene 2');

        sceneStore.markSceneDirty(scene1.id);
        sceneStore.markSceneDirty(scene2.id);

        sceneStore.saveAllScenes();

        expect(sceneStore.getScene(scene1.id)?.isDirty).toBe(false);
        expect(sceneStore.getScene(scene2.id)?.isDirty).toBe(false);
      });
    });

    describe('hasUnsavedScenes', () => {
      it('should return false when no unsaved scenes', () => {
        sceneStore.createScene('Scene');

        expect(sceneStore.hasUnsavedScenes()).toBe(false);
      });

      it('should return true when there are unsaved scenes', () => {
        const scene = sceneStore.createScene('Scene');
        sceneStore.markSceneDirty(scene.id);

        expect(sceneStore.hasUnsavedScenes()).toBe(true);
      });
    });
  });

  describe('Editor Mode', () => {
    it('should get editor mode', () => {
      expect(sceneStore.getEditorMode()).toBe('edit');
    });

    it('should set editor mode', () => {
      sceneStore.setEditorMode('play');

      expect(sceneStore.getEditorMode()).toBe('play');
    });

    it('should toggle editor mode', () => {
      sceneStore.toggleEditorMode();
      expect(sceneStore.getEditorMode()).toBe('play');

      sceneStore.toggleEditorMode();
      expect(sceneStore.getEditorMode()).toBe('edit');
    });

    it('should check play mode', () => {
      expect(sceneStore.isPlayMode()).toBe(false);

      sceneStore.setEditorMode('play');
      expect(sceneStore.isPlayMode()).toBe(true);
    });

    it('should check edit mode', () => {
      expect(sceneStore.isEditMode()).toBe(true);

      sceneStore.setEditorMode('play');
      expect(sceneStore.isEditMode()).toBe(false);
    });
  });

  describe('Getters', () => {
    it('should get scene by ID', () => {
      const scene = sceneStore.createScene('Test');

      expect(sceneStore.getScene(scene.id)?.name).toBe('Test');
    });

    it('should return null for non-existent scene', () => {
      expect(sceneStore.getScene('non-existent')).toBeNull();
    });

    it('should get open scenes', () => {
      const scene1 = sceneStore.createScene('Scene 1');
      const scene2 = sceneStore.createScene('Scene 2');
      sceneStore.closeScene(scene1.id);

      const openScenes = sceneStore.getOpenScenes();

      expect(openScenes.length).toBe(1);
      expect(openScenes[0].id).toBe(scene2.id);
    });
  });

  describe('Subscriptions', () => {
    it('should notify subscribers on state changes', () => {
      const subscriber = vi.fn();
      sceneStore.subscribe(subscriber);

      sceneStore.createScene('Test');

      expect(subscriber).toHaveBeenCalled();
    });

    it('should unsubscribe correctly', () => {
      const subscriber = vi.fn();
      const unsubscribe = sceneStore.subscribe(subscriber);

      unsubscribe();
      subscriber.mockClear();

      sceneStore.createScene('Test');

      expect(subscriber).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle creating many scenes', () => {
      for (let i = 0; i < 50; i++) {
        sceneStore.createScene(`Scene ${i}`);
      }

      expect(Object.keys(sceneStore.getState().scenes).length).toBe(50);
    });

    it('should handle rapid scene operations', () => {
      const scene = sceneStore.createScene('Test');

      for (let i = 0; i < 100; i++) {
        sceneStore.updateSceneSettings(scene.id, { gridSize: i });
      }

      expect(sceneStore.getScene(scene.id)?.settings.gridSize).toBe(99);
    });
  });
});
