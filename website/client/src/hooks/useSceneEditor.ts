import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Scene,
  SceneObject,
  EditorTool,
  EditorViewport,
  SelectionState,
  HistoryEntry,
  Transform2D,
  createEmptyScene,
  createShapeObject,
  createTextObject,
  generateObjectId,
} from '@/types/scene';

// Default viewport settings
const DEFAULT_VIEWPORT: EditorViewport = {
  zoom: 100,
  panX: 0,
  panY: 0,
  showGrid: true,
  gridSize: 32,
  snapToGrid: false,
};

// Default selection state
const DEFAULT_SELECTION: SelectionState = {
  selectedIds: [],
  hoveredId: null,
};

// Maximum history entries
const MAX_HISTORY = 50;

export interface UseSceneEditorReturn {
  // State
  scene: Scene;
  selection: SelectionState;
  viewport: EditorViewport;
  tool: EditorTool;
  isDirty: boolean;

  // Scene operations
  loadScene: (scene: Scene) => void;
  newScene: (name?: string) => void;
  getSceneJson: () => string;
  importSceneJson: (json: string) => boolean;

  // Object operations
  addObject: (object: SceneObject) => void;
  removeObject: (id: string) => void;
  duplicateObject: (id: string) => void;
  updateObject: (id: string, updates: Partial<SceneObject>) => void;
  updateObjectTransform: (id: string, transform: Partial<Transform2D>) => void;
  setObjectParent: (objectId: string, parentId: string | null) => void;
  reorderObject: (id: string, newZIndex: number) => void;

  // Quick creation helpers
  addRectangle: (x: number, y: number, width?: number, height?: number) => string;
  addCircle: (x: number, y: number, radius?: number) => string;
  addText: (x: number, y: number, text?: string) => string;

  // Selection operations
  selectObject: (id: string, addToSelection?: boolean) => void;
  selectObjects: (ids: string[]) => void;
  deselectAll: () => void;
  selectAll: () => void;
  setHoveredObject: (id: string | null) => void;
  getSelectedObjects: () => SceneObject[];

  // Viewport operations
  setZoom: (zoom: number) => void;
  setPan: (panX: number, panY: number) => void;
  resetViewport: () => void;
  fitToContent: () => void;
  toggleGrid: () => void;
  setGridSize: (size: number) => void;
  toggleSnapToGrid: () => void;

  // Tool operations
  setTool: (tool: EditorTool) => void;

  // History operations
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // Utility
  screenToCanvas: (screenX: number, screenY: number) => { x: number; y: number };
  canvasToScreen: (canvasX: number, canvasY: number) => { x: number; y: number };

  // Scene viewport
  updateSceneViewport: (updates: { width?: number; height?: number; backgroundColor?: string }) => void;
}

export function useSceneEditor(initialScene?: Scene): UseSceneEditorReturn {
  // Core state
  const [scene, setScene] = useState<Scene>(initialScene || createEmptyScene());
  const [selection, setSelection] = useState<SelectionState>(DEFAULT_SELECTION);
  const [viewport, setViewport] = useState<EditorViewport>(DEFAULT_VIEWPORT);
  const [tool, setTool] = useState<EditorTool>('select');
  const [isDirty, setIsDirty] = useState(false);

  // History state
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Refs for canvas calculations
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Save current state to history
  const saveToHistory = useCallback((action: string) => {
    const entry: HistoryEntry = {
      objects: JSON.parse(JSON.stringify(scene.objects)),
      rootObjects: [...scene.rootObjects],
      timestamp: Date.now(),
      action,
    };

    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(entry);
      if (newHistory.length > MAX_HISTORY) {
        newHistory.shift();
      }
      return newHistory;
    });
    setHistoryIndex(prev => Math.min(prev + 1, MAX_HISTORY - 1));
    setIsDirty(true);
  }, [scene.objects, scene.rootObjects, historyIndex]);

  // Load a scene
  const loadScene = useCallback((newScene: Scene) => {
    setScene(newScene);
    setSelection(DEFAULT_SELECTION);
    setHistory([]);
    setHistoryIndex(-1);
    setIsDirty(false);
  }, []);

  // Create a new scene
  const newScene = useCallback((name?: string) => {
    const fresh = createEmptyScene(name);
    loadScene(fresh);
  }, [loadScene]);

  // Export scene as JSON
  const getSceneJson = useCallback(() => {
    return JSON.stringify({ version: '1.0', scene }, null, 2);
  }, [scene]);

  // Import scene from JSON
  const importSceneJson = useCallback((json: string): boolean => {
    try {
      const parsed = JSON.parse(json);
      if (parsed.version && parsed.scene) {
        loadScene(parsed.scene);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [loadScene]);

  // Add an object to the scene
  const addObject = useCallback((object: SceneObject) => {
    setScene(prev => {
      const newObjects = { ...prev.objects, [object.id]: object };
      const newRootObjects = object.parentId
        ? prev.rootObjects
        : [...prev.rootObjects, object.id];

      return {
        ...prev,
        objects: newObjects,
        rootObjects: newRootObjects,
        metadata: { ...prev.metadata, updatedAt: new Date().toISOString() },
      };
    });
    saveToHistory(`Add ${object.type}`);
  }, [saveToHistory]);

  // Remove an object
  const removeObject = useCallback((id: string) => {
    setScene(prev => {
      const obj = prev.objects[id];
      if (!obj) return prev;

      // Also remove all children recursively
      const idsToRemove = new Set<string>([id]);
      const collectChildren = (objId: string) => {
        const o = prev.objects[objId];
        if (o?.children) {
          o.children.forEach(childId => {
            idsToRemove.add(childId);
            collectChildren(childId);
          });
        }
      };
      collectChildren(id);

      const newObjects = { ...prev.objects };
      idsToRemove.forEach(removeId => delete newObjects[removeId]);

      // Update parent's children array
      if (obj.parentId && prev.objects[obj.parentId]) {
        const parent = { ...prev.objects[obj.parentId] };
        parent.children = parent.children.filter(cid => cid !== id);
        newObjects[obj.parentId] = parent;
      }

      return {
        ...prev,
        objects: newObjects,
        rootObjects: prev.rootObjects.filter(rid => !idsToRemove.has(rid)),
        metadata: { ...prev.metadata, updatedAt: new Date().toISOString() },
      };
    });

    // Deselect removed objects
    setSelection(prev => ({
      ...prev,
      selectedIds: prev.selectedIds.filter(sid => sid !== id),
      hoveredId: prev.hoveredId === id ? null : prev.hoveredId,
    }));

    saveToHistory('Delete object');
  }, [saveToHistory]);

  // Duplicate an object
  const duplicateObject = useCallback((id: string) => {
    const obj = scene.objects[id];
    if (!obj) return;

    const newId = generateObjectId();
    const newObj: SceneObject = {
      ...JSON.parse(JSON.stringify(obj)),
      id: newId,
      name: `${obj.name} Copy`,
      transform: {
        ...obj.transform,
        x: obj.transform.x + 20,
        y: obj.transform.y + 20,
      },
      children: [],
    };

    addObject(newObj);
    setSelection({ selectedIds: [newId], hoveredId: null });
  }, [scene.objects, addObject]);

  // Update an object
  const updateObject = useCallback((id: string, updates: Partial<SceneObject>) => {
    setScene(prev => {
      const obj = prev.objects[id];
      if (!obj) return prev;

      return {
        ...prev,
        objects: {
          ...prev.objects,
          [id]: { ...obj, ...updates } as SceneObject,
        },
        metadata: { ...prev.metadata, updatedAt: new Date().toISOString() },
      };
    });
    setIsDirty(true);
  }, []);

  // Update object transform
  const updateObjectTransform = useCallback((id: string, transform: Partial<Transform2D>) => {
    setScene(prev => {
      const obj = prev.objects[id];
      if (!obj) return prev;

      return {
        ...prev,
        objects: {
          ...prev.objects,
          [id]: {
            ...obj,
            transform: { ...obj.transform, ...transform },
          } as SceneObject,
        },
      };
    });
    setIsDirty(true);
  }, []);

  // Set object parent (for hierarchy)
  const setObjectParent = useCallback((objectId: string, parentId: string | null) => {
    setScene(prev => {
      const obj = prev.objects[objectId];
      if (!obj) return prev;

      const newObjects = { ...prev.objects };

      // Remove from old parent
      if (obj.parentId && prev.objects[obj.parentId]) {
        const oldParent = { ...prev.objects[obj.parentId] };
        oldParent.children = oldParent.children.filter(cid => cid !== objectId);
        newObjects[obj.parentId] = oldParent;
      }

      // Add to new parent
      if (parentId && prev.objects[parentId]) {
        const newParent = { ...prev.objects[parentId] };
        newParent.children = [...newParent.children, objectId];
        newObjects[parentId] = newParent;
      }

      // Update object
      newObjects[objectId] = { ...obj, parentId };

      // Update rootObjects
      let newRootObjects = prev.rootObjects;
      if (!obj.parentId && parentId) {
        // Moving to a parent, remove from root
        newRootObjects = newRootObjects.filter(rid => rid !== objectId);
      } else if (obj.parentId && !parentId) {
        // Moving to root
        newRootObjects = [...newRootObjects, objectId];
      }

      return {
        ...prev,
        objects: newObjects,
        rootObjects: newRootObjects,
        metadata: { ...prev.metadata, updatedAt: new Date().toISOString() },
      };
    });
    saveToHistory('Move in hierarchy');
  }, [saveToHistory]);

  // Reorder object (z-index)
  const reorderObject = useCallback((id: string, newZIndex: number) => {
    updateObject(id, { zIndex: newZIndex });
    saveToHistory('Reorder object');
  }, [updateObject, saveToHistory]);

  // Quick creation: Rectangle
  const addRectangle = useCallback((x: number, y: number, width = 100, height = 100): string => {
    const id = generateObjectId();
    const obj = createShapeObject(id, 'Rectangle', 'rectangle', width, height);
    obj.transform.x = x;
    obj.transform.y = y;
    addObject(obj);
    return id;
  }, [addObject]);

  // Quick creation: Circle
  const addCircle = useCallback((x: number, y: number, radius = 50): string => {
    const id = generateObjectId();
    const obj = createShapeObject(id, 'Circle', 'circle', radius * 2, radius * 2);
    obj.transform.x = x;
    obj.transform.y = y;
    addObject(obj);
    return id;
  }, [addObject]);

  // Quick creation: Text
  const addText = useCallback((x: number, y: number, text = 'Text'): string => {
    const id = generateObjectId();
    const obj = createTextObject(id, 'Text', text);
    obj.transform.x = x;
    obj.transform.y = y;
    addObject(obj);
    return id;
  }, [addObject]);

  // Selection: Select single object
  const selectObject = useCallback((id: string, addToSelection = false) => {
    setSelection(prev => {
      if (addToSelection) {
        if (prev.selectedIds.includes(id)) {
          return { ...prev, selectedIds: prev.selectedIds.filter(sid => sid !== id) };
        }
        return { ...prev, selectedIds: [...prev.selectedIds, id] };
      }
      return { ...prev, selectedIds: [id] };
    });
  }, []);

  // Selection: Select multiple objects
  const selectObjects = useCallback((ids: string[]) => {
    setSelection(prev => ({ ...prev, selectedIds: ids }));
  }, []);

  // Selection: Deselect all
  const deselectAll = useCallback(() => {
    setSelection(prev => ({ ...prev, selectedIds: [] }));
  }, []);

  // Selection: Select all
  const selectAll = useCallback(() => {
    setSelection(prev => ({ ...prev, selectedIds: Object.keys(scene.objects) }));
  }, [scene.objects]);

  // Selection: Set hovered object
  const setHoveredObject = useCallback((id: string | null) => {
    setSelection(prev => ({ ...prev, hoveredId: id }));
  }, []);

  // Get selected objects
  const getSelectedObjects = useCallback((): SceneObject[] => {
    return selection.selectedIds
      .map(id => scene.objects[id])
      .filter((obj): obj is SceneObject => obj !== undefined);
  }, [selection.selectedIds, scene.objects]);

  // Viewport: Set zoom
  const setZoom = useCallback((zoom: number) => {
    setViewport(prev => ({ ...prev, zoom: Math.max(10, Math.min(400, zoom)) }));
  }, []);

  // Viewport: Set pan
  const setPan = useCallback((panX: number, panY: number) => {
    setViewport(prev => ({ ...prev, panX, panY }));
  }, []);

  // Viewport: Reset
  const resetViewport = useCallback(() => {
    setViewport(DEFAULT_VIEWPORT);
  }, []);

  // Viewport: Fit to content
  const fitToContent = useCallback(() => {
    const objects = Object.values(scene.objects);
    if (objects.length === 0) {
      resetViewport();
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    objects.forEach(obj => {
      const width = 'width' in obj ? (obj as any).width : 100;
      const height = 'height' in obj ? (obj as any).height : 100;
      minX = Math.min(minX, obj.transform.x);
      minY = Math.min(minY, obj.transform.y);
      maxX = Math.max(maxX, obj.transform.x + width);
      maxY = Math.max(maxY, obj.transform.y + height);
    });

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const padding = 50;

    // Calculate zoom to fit
    const containerWidth = 800; // Default, would come from actual container
    const containerHeight = 600;
    const zoomX = (containerWidth - padding * 2) / contentWidth;
    const zoomY = (containerHeight - padding * 2) / contentHeight;
    const newZoom = Math.min(zoomX, zoomY, 1) * 100;

    setViewport(prev => ({
      ...prev,
      zoom: Math.max(10, Math.min(400, newZoom)),
      panX: -minX + padding,
      panY: -minY + padding,
    }));
  }, [scene.objects, resetViewport]);

  // Viewport: Toggle grid
  const toggleGrid = useCallback(() => {
    setViewport(prev => ({ ...prev, showGrid: !prev.showGrid }));
  }, []);

  // Viewport: Set grid size
  const setGridSize = useCallback((size: number) => {
    setViewport(prev => ({ ...prev, gridSize: Math.max(8, Math.min(128, size)) }));
  }, []);

  // Viewport: Toggle snap to grid
  const toggleSnapToGrid = useCallback(() => {
    setViewport(prev => ({ ...prev, snapToGrid: !prev.snapToGrid }));
  }, []);

  // History: Undo
  const undo = useCallback(() => {
    if (historyIndex < 0) return;

    const entry = history[historyIndex];
    setScene(prev => ({
      ...prev,
      objects: JSON.parse(JSON.stringify(entry.objects)),
      rootObjects: [...entry.rootObjects],
      metadata: { ...prev.metadata, updatedAt: new Date().toISOString() },
    }));
    setHistoryIndex(prev => prev - 1);
  }, [history, historyIndex]);

  // History: Redo
  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;

    const entry = history[historyIndex + 1];
    setScene(prev => ({
      ...prev,
      objects: JSON.parse(JSON.stringify(entry.objects)),
      rootObjects: [...entry.rootObjects],
      metadata: { ...prev.metadata, updatedAt: new Date().toISOString() },
    }));
    setHistoryIndex(prev => prev + 1);
  }, [history, historyIndex]);

  // Coordinate conversion: Screen to Canvas
  const screenToCanvas = useCallback((screenX: number, screenY: number) => {
    const scale = viewport.zoom / 100;
    return {
      x: (screenX - viewport.panX) / scale,
      y: (screenY - viewport.panY) / scale,
    };
  }, [viewport]);

  // Coordinate conversion: Canvas to Screen
  const canvasToScreen = useCallback((canvasX: number, canvasY: number) => {
    const scale = viewport.zoom / 100;
    return {
      x: canvasX * scale + viewport.panX,
      y: canvasY * scale + viewport.panY,
    };
  }, [viewport]);

  // Update scene viewport settings
  const updateSceneViewport = useCallback((updates: { width?: number; height?: number; backgroundColor?: string }) => {
    setScene(prev => ({
      ...prev,
      viewport: { ...prev.viewport, ...updates },
      metadata: { ...prev.metadata, updatedAt: new Date().toISOString() },
    }));
    setIsDirty(true);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // Prevent shortcuts when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (isCtrlOrCmd && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (isCtrlOrCmd && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (isCtrlOrCmd && e.key === 'a') {
        e.preventDefault();
        selectAll();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.selectedIds.length > 0) {
          e.preventDefault();
          selection.selectedIds.forEach(id => removeObject(id));
        }
      } else if (isCtrlOrCmd && e.key === 'd') {
        e.preventDefault();
        selection.selectedIds.forEach(id => duplicateObject(id));
      } else if (e.key === 'Escape') {
        deselectAll();
        setTool('select');
      } else if (e.key === 'v' && !isCtrlOrCmd) {
        setTool('select');
      } else if (e.key === 'm' && !isCtrlOrCmd) {
        setTool('move');
      } else if (e.key === 'r' && !isCtrlOrCmd) {
        setTool('rotate');
      } else if (e.key === 's' && !isCtrlOrCmd) {
        setTool('scale');
      } else if (e.key === 'g' && !isCtrlOrCmd) {
        toggleGrid();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, selectAll, deselectAll, selection.selectedIds, removeObject, duplicateObject, toggleGrid]);

  return {
    // State
    scene,
    selection,
    viewport,
    tool,
    isDirty,

    // Scene operations
    loadScene,
    newScene,
    getSceneJson,
    importSceneJson,

    // Object operations
    addObject,
    removeObject,
    duplicateObject,
    updateObject,
    updateObjectTransform,
    setObjectParent,
    reorderObject,

    // Quick creation helpers
    addRectangle,
    addCircle,
    addText,

    // Selection operations
    selectObject,
    selectObjects,
    deselectAll,
    selectAll,
    setHoveredObject,
    getSelectedObjects,

    // Viewport operations
    setZoom,
    setPan,
    resetViewport,
    fitToContent,
    toggleGrid,
    setGridSize,
    toggleSnapToGrid,

    // Tool operations
    setTool,

    // History operations
    undo,
    redo,
    canUndo: historyIndex >= 0,
    canRedo: historyIndex < history.length - 1,

    // Utility
    screenToCanvas,
    canvasToScreen,

    // Scene viewport
    updateSceneViewport,
  };
}
