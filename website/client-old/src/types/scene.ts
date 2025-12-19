// Scene Editor Types

// Basic transform for positioning objects in 2D space
export interface Transform2D {
  x: number;
  y: number;
  rotation: number; // in degrees
  scaleX: number;
  scaleY: number;
}

// Different types of scene objects
export type SceneObjectType = 'sprite' | 'shape' | 'text' | 'group' | 'empty';

// Shape types for shape objects
export type ShapeType = 'rectangle' | 'circle' | 'ellipse' | 'polygon' | 'line';

// Base scene object properties
export interface BaseSceneObject {
  id: string;
  name: string;
  type: SceneObjectType;
  transform: Transform2D;
  visible: boolean;
  locked: boolean;
  parentId: string | null;
  children: string[]; // IDs of child objects
  zIndex: number;
}

// Sprite object - displays an image
export interface SpriteObject extends BaseSceneObject {
  type: 'sprite';
  src: string; // path to image
  width: number;
  height: number;
  opacity: number;
  flipX: boolean;
  flipY: boolean;
  tint?: string; // optional color tint
}

// Shape object - basic geometric shapes
export interface ShapeObject extends BaseSceneObject {
  type: 'shape';
  shapeType: ShapeType;
  width: number;
  height: number;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  // For polygons
  points?: { x: number; y: number }[];
}

// Text object
export interface TextObject extends BaseSceneObject {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
  textAlign: 'left' | 'center' | 'right';
  opacity: number;
}

// Group object - container for other objects
export interface GroupObject extends BaseSceneObject {
  type: 'group';
}

// Empty object - used as a transform parent
export interface EmptyObject extends BaseSceneObject {
  type: 'empty';
}

// Union type for all scene objects
export type SceneObject =
  | SpriteObject
  | ShapeObject
  | TextObject
  | GroupObject
  | EmptyObject;

// Scene metadata
export interface SceneMetadata {
  name: string;
  description?: string;
  author?: string;
  createdAt: string;
  updatedAt: string;
  version: string;
}

// Scene viewport settings
export interface SceneViewport {
  width: number;
  height: number;
  backgroundColor: string;
}

// Complete scene data structure
export interface Scene {
  metadata: SceneMetadata;
  viewport: SceneViewport;
  objects: Record<string, SceneObject>; // Object ID -> Object
  rootObjects: string[]; // IDs of root-level objects (no parent)
}

// Editor tool types
export type EditorTool =
  | 'select'
  | 'move'
  | 'rotate'
  | 'scale'
  | 'pan'
  | 'zoom'
  | 'rectangle'
  | 'circle'
  | 'text';

// Selection state
export interface SelectionState {
  selectedIds: string[];
  hoveredId: string | null;
}

// Editor viewport state
export interface EditorViewport {
  zoom: number;
  panX: number;
  panY: number;
  showGrid: boolean;
  gridSize: number;
  snapToGrid: boolean;
}

// History entry for undo/redo
export interface HistoryEntry {
  objects: Record<string, SceneObject>;
  rootObjects: string[];
  timestamp: number;
  action: string;
}

// Scene editor state
export interface SceneEditorState {
  scene: Scene;
  selection: SelectionState;
  viewport: EditorViewport;
  tool: EditorTool;
  history: HistoryEntry[];
  historyIndex: number;
  isDirty: boolean;
}

// Object property panel configuration
export interface PropertyPanelConfig {
  showTransform: boolean;
  showAppearance: boolean;
  showHierarchy: boolean;
}

// Asset types for the asset browser
export type AssetType = 'image' | 'audio' | 'model' | 'scene' | 'prefab';

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  path: string;
  thumbnail?: string;
  size?: number;
}

// Scene file format for save/load
export interface SceneFile {
  version: '1.0';
  scene: Scene;
}

// Helper function to create a default transform
export function createDefaultTransform(): Transform2D {
  return {
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  };
}

// Helper function to create a new sprite object
export function createSpriteObject(
  id: string,
  name: string,
  src: string,
  width: number,
  height: number
): SpriteObject {
  return {
    id,
    name,
    type: 'sprite',
    transform: createDefaultTransform(),
    visible: true,
    locked: false,
    parentId: null,
    children: [],
    zIndex: 0,
    src,
    width,
    height,
    opacity: 1,
    flipX: false,
    flipY: false,
  };
}

// Helper function to create a new shape object
export function createShapeObject(
  id: string,
  name: string,
  shapeType: ShapeType,
  width: number,
  height: number
): ShapeObject {
  return {
    id,
    name,
    type: 'shape',
    transform: createDefaultTransform(),
    visible: true,
    locked: false,
    parentId: null,
    children: [],
    zIndex: 0,
    shapeType,
    width,
    height,
    fillColor: '#3b82f6',
    strokeColor: '#1e40af',
    strokeWidth: 2,
    opacity: 1,
  };
}

// Helper function to create a new text object
export function createTextObject(
  id: string,
  name: string,
  text: string
): TextObject {
  return {
    id,
    name,
    type: 'text',
    transform: createDefaultTransform(),
    visible: true,
    locked: false,
    parentId: null,
    children: [],
    zIndex: 0,
    text,
    fontSize: 24,
    fontFamily: 'Arial',
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#000000',
    textAlign: 'left',
    opacity: 1,
  };
}

// Helper function to create an empty scene
export function createEmptyScene(name: string = 'Untitled Scene'): Scene {
  return {
    metadata: {
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: '1.0',
    },
    viewport: {
      width: 1920,
      height: 1080,
      backgroundColor: '#1a1a2e',
    },
    objects: {},
    rootObjects: [],
  };
}

// Helper function to generate unique IDs
export function generateObjectId(): string {
  return `obj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
