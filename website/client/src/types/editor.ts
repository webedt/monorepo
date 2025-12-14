// Editor Types for Image Editor
// This file contains type definitions for the image editor canvas and drawing tools

// Drawing tool types
export type DrawingTool = 'select' | 'pencil' | 'brush' | 'eraser' | 'fill' | 'rectangle' | 'circle' | 'line';

// Blend modes for layers
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';

// Point coordinates
export interface Point {
  x: number;
  y: number;
}

// Selection area
export interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Layer definition
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0-100
  blendMode: BlendMode;
  locked: boolean;
  imageData?: string; // Base64 data URL of the layer content
}

// Canvas configuration
export interface CanvasConfig {
  tool: DrawingTool;
  brushSize: number;
  brushOpacity: number;
  primaryColor: string;
  secondaryColor: string;
}

// Canvas state
export interface CanvasState {
  width: number;
  height: number;
  zoom: number;
  panX: number;
  panY: number;
  history: ImageData[];
  historyIndex: number;
}

// Drawing event handlers
export interface DrawingEventHandlers {
  onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseUp: () => void;
  onMouseLeave: () => void;
  onTouchStart?: (e: React.TouchEvent<HTMLCanvasElement>) => void;
  onTouchMove?: (e: React.TouchEvent<HTMLCanvasElement>) => void;
  onTouchEnd?: () => void;
  onWheel?: (e: React.WheelEvent<HTMLDivElement>) => void;
}

// Export format types
export type ImageExportFormat = 'png' | 'jpg' | 'jpeg' | 'gif' | 'webp';

// Export options
export interface ExportOptions {
  filename: string;
  format: ImageExportFormat;
  quality?: number; // 0-1 for jpg/webp
}

// Image editor session data (for session management integration)
export interface ImageEditorSession {
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  sessionId?: string;
  currentFile?: string;
}

// Tool definition for toolbar
export interface ToolDefinition {
  id: DrawingTool;
  label: string;
  icon: string;
  shortcut?: string;
}

// Available drawing tools
export const DRAWING_TOOLS: ToolDefinition[] = [
  { id: 'select', label: 'Select', icon: '⬚', shortcut: 'V' },
  { id: 'pencil', label: 'Pencil', icon: '✏️', shortcut: 'P' },
  { id: 'brush', label: 'Brush', icon: '🖌️', shortcut: 'B' },
  { id: 'eraser', label: 'Eraser', icon: '🧹', shortcut: 'E' },
  { id: 'fill', label: 'Fill', icon: '🪣', shortcut: 'G' },
  { id: 'rectangle', label: 'Rectangle', icon: '▭', shortcut: 'R' },
  { id: 'circle', label: 'Circle', icon: '○', shortcut: 'C' },
  { id: 'line', label: 'Line', icon: '/', shortcut: 'L' }
];

// Zoom levels
export const ZOOM_LEVELS = [10, 25, 50, 75, 100, 150, 200, 300, 400];

// Default canvas dimensions
export const DEFAULT_CANVAS_DIMENSIONS = {
  width: 800,
  height: 600
};

// Maximum canvas dimensions (8K as per SPEC)
export const MAX_CANVAS_DIMENSIONS = {
  width: 8192,
  height: 8192
};
