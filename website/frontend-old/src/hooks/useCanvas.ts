import { useState, useRef, useCallback, useEffect } from 'react';
import type { Point, Selection, DrawingTool } from '@/utils/imageEditor';
import {
  getCanvasPosition as getPosition,
  drawLine,
  drawPoint,
  drawRectangle,
  drawEllipse,
  floodFill,
  calculateFitZoom,
  loadImage
} from '@/utils/imageEditor';

export interface CanvasState {
  width: number;
  height: number;
  zoom: number;
  panX: number;
  panY: number;
  history: ImageData[];
  historyIndex: number;
}

export interface CanvasConfig {
  tool: DrawingTool;
  brushSize: number;
  brushOpacity: number;
  primaryColor: string;
  secondaryColor: string;
}

export interface UseCanvasReturn {
  // Refs
  canvasRef: React.RefObject<HTMLCanvasElement>;
  drawingLayerRef: React.RefObject<HTMLCanvasElement>;
  containerRef: React.RefObject<HTMLDivElement>;

  // State
  canvasState: CanvasState;
  config: CanvasConfig;
  isDrawing: boolean;
  selection: Selection | null;
  isDirty: boolean;

  // State setters
  setTool: (tool: DrawingTool) => void;
  setBrushSize: (size: number) => void;
  setBrushOpacity: (opacity: number) => void;
  setPrimaryColor: (color: string) => void;
  setSecondaryColor: (color: string) => void;
  setZoom: (zoom: number) => void;
  setPan: (panX: number, panY: number) => void;
  resetPan: () => void;
  setSelection: (selection: Selection | null) => void;

  // Canvas operations
  initializeCanvas: (width: number, height: number, backgroundColor?: string) => void;
  loadImageToCanvas: (imageUrl: string) => Promise<void>;
  saveToHistory: () => void;
  undo: () => void;
  redo: () => void;
  clearCanvas: () => void;
  fitToContainer: () => void;
  getCanvasDataUrl: (mimeType?: string) => string | null;
  mergeDrawingLayer: () => void;

  // Event handlers
  handleMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  handleMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  handleMouseUp: () => void;
  handleMouseLeave: () => void;
  handleWheel: (e: React.WheelEvent<HTMLDivElement>) => void;

  // Pan state
  isPanning: boolean;

  // Helpers
  canUndo: boolean;
  canRedo: boolean;
}

export function useCanvas(): UseCanvasReturn {
  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingLayerRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Drawing state refs (to avoid re-renders during drawing)
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const shapeStartRef = useRef<Point | null>(null);
  const selectionStartRef = useRef<Point | null>(null);

  // Pan state refs
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // Canvas state
  const [canvasState, setCanvasState] = useState<CanvasState>({
    width: 800,
    height: 600,
    zoom: 100,
    panX: 0,
    panY: 0,
    history: [],
    historyIndex: -1
  });

  // Config state
  const [config, setConfig] = useState<CanvasConfig>({
    tool: 'brush',
    brushSize: 4,
    brushOpacity: 100,
    primaryColor: '#000000',
    secondaryColor: '#FFFFFF'
  });

  // UI state
  const [isDrawing, setIsDrawing] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  // Config setters
  const setTool = useCallback((tool: DrawingTool) => {
    setConfig(prev => ({ ...prev, tool }));
  }, []);

  const setBrushSize = useCallback((brushSize: number) => {
    setConfig(prev => ({ ...prev, brushSize }));
  }, []);

  const setBrushOpacity = useCallback((brushOpacity: number) => {
    setConfig(prev => ({ ...prev, brushOpacity }));
  }, []);

  const setPrimaryColor = useCallback((primaryColor: string) => {
    setConfig(prev => ({ ...prev, primaryColor }));
  }, []);

  const setSecondaryColor = useCallback((secondaryColor: string) => {
    setConfig(prev => ({ ...prev, secondaryColor }));
  }, []);

  const setZoom = useCallback((zoom: number) => {
    setCanvasState(prev => ({ ...prev, zoom: Math.max(10, Math.min(400, zoom)) }));
  }, []);

  const setPan = useCallback((panX: number, panY: number) => {
    setCanvasState(prev => ({ ...prev, panX, panY }));
  }, []);

  const resetPan = useCallback(() => {
    setCanvasState(prev => ({ ...prev, panX: 0, panY: 0 }));
  }, []);

  // Initialize canvas with dimensions
  const initializeCanvas = useCallback((width: number, height: number, backgroundColor?: string) => {
    const canvas = canvasRef.current;
    const drawingCanvas = drawingLayerRef.current;

    if (!canvas || !drawingCanvas) return;

    canvas.width = width;
    canvas.height = height;
    drawingCanvas.width = width;
    drawingCanvas.height = height;

    const ctx = canvas.getContext('2d');
    const drawingCtx = drawingCanvas.getContext('2d');

    if (ctx) {
      if (backgroundColor) {
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.clearRect(0, 0, width, height);
      }

      // Save initial state to history
      const imageData = ctx.getImageData(0, 0, width, height);
      setCanvasState(prev => ({
        ...prev,
        width,
        height,
        panX: 0,
        panY: 0,
        history: [imageData],
        historyIndex: 0
      }));
    }

    if (drawingCtx) {
      drawingCtx.clearRect(0, 0, width, height);
    }

    setIsDirty(false);
  }, []);

  // Load image to canvas
  const loadImageToCanvas = useCallback(async (imageUrl: string) => {
    const canvas = canvasRef.current;
    const drawingCanvas = drawingLayerRef.current;

    if (!canvas || !drawingCanvas) return;

    try {
      const img = await loadImage(imageUrl);

      canvas.width = img.width;
      canvas.height = img.height;
      drawingCanvas.width = img.width;
      drawingCanvas.height = img.height;

      const ctx = canvas.getContext('2d');
      const drawingCtx = drawingCanvas.getContext('2d');

      if (ctx) {
        ctx.drawImage(img, 0, 0);

        // Save initial state to history
        const imageData = ctx.getImageData(0, 0, img.width, img.height);

        // Calculate fit zoom
        let fitZoom = 100;
        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          fitZoom = calculateFitZoom(img.width, img.height, rect.width, rect.height);
        }

        setCanvasState(prev => ({
          ...prev,
          width: img.width,
          height: img.height,
          zoom: fitZoom,
          panX: 0,
          panY: 0,
          history: [imageData],
          historyIndex: 0
        }));
      }

      if (drawingCtx) {
        drawingCtx.clearRect(0, 0, img.width, img.height);
      }

      setSelection(null);
      setIsDirty(false);
    } catch (error) {
      console.error('[useCanvas] Failed to load image:', error);
    }
  }, []);

  // Save current state to history
  const saveToHistory = useCallback(() => {
    const canvas = canvasRef.current;
    const drawingCanvas = drawingLayerRef.current;

    if (!canvas || !drawingCanvas) return;

    const ctx = canvas.getContext('2d');
    const drawingCtx = drawingCanvas.getContext('2d');

    if (!ctx || !drawingCtx) return;

    // Merge drawing layer onto main canvas
    ctx.drawImage(drawingCanvas, 0, 0);
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);

    // Save to history
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    setCanvasState(prev => {
      const newHistory = prev.history.slice(0, prev.historyIndex + 1);
      newHistory.push(imageData);

      // Limit history size
      if (newHistory.length > 50) {
        newHistory.shift();
      }

      return {
        ...prev,
        history: newHistory,
        historyIndex: newHistory.length - 1
      };
    });

    setIsDirty(true);
  }, []);

  // Merge drawing layer without saving to history
  const mergeDrawingLayer = useCallback(() => {
    const canvas = canvasRef.current;
    const drawingCanvas = drawingLayerRef.current;

    if (!canvas || !drawingCanvas) return;

    const ctx = canvas.getContext('2d');
    const drawingCtx = drawingCanvas.getContext('2d');

    if (!ctx || !drawingCtx) return;

    ctx.drawImage(drawingCanvas, 0, 0);
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  }, []);

  // Undo
  const undo = useCallback(() => {
    if (canvasState.historyIndex <= 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prevIndex = canvasState.historyIndex - 1;
    ctx.putImageData(canvasState.history[prevIndex], 0, 0);

    setCanvasState(prev => ({
      ...prev,
      historyIndex: prevIndex
    }));
  }, [canvasState.history, canvasState.historyIndex]);

  // Redo
  const redo = useCallback(() => {
    if (canvasState.historyIndex >= canvasState.history.length - 1) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const nextIndex = canvasState.historyIndex + 1;
    ctx.putImageData(canvasState.history[nextIndex], 0, 0);

    setCanvasState(prev => ({
      ...prev,
      historyIndex: nextIndex
    }));
  }, [canvasState.history, canvasState.historyIndex]);

  // Clear canvas
  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const drawingCanvas = drawingLayerRef.current;

    if (!canvas || !drawingCanvas) return;

    const ctx = canvas.getContext('2d');
    const drawingCtx = drawingCanvas.getContext('2d');

    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (drawingCtx) {
      drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    }

    saveToHistory();
  }, [saveToHistory]);

  // Fit to container
  const fitToContainer = useCallback(() => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const fitZoom = calculateFitZoom(
      canvasState.width,
      canvasState.height,
      rect.width,
      rect.height
    );

    setCanvasState(prev => ({ ...prev, zoom: fitZoom }));
  }, [canvasState.width, canvasState.height]);

  // Get canvas data URL
  const getCanvasDataUrl = useCallback((mimeType: string = 'image/png'): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.toDataURL(mimeType);
  }, []);

  // Get canvas position helper
  const getCanvasPosition = useCallback((e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    return getPosition(e, canvas);
  }, []);

  // Mouse down handler
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Handle middle mouse button for panning
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      isPanningRef.current = true;
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: canvasState.panX,
        panY: canvasState.panY
      };
      return;
    }

    const pos = getCanvasPosition(e);
    const drawingCanvas = drawingLayerRef.current;
    const baseCanvas = canvasRef.current;

    if (!drawingCanvas || !baseCanvas) return;

    // Ensure drawing canvas has same dimensions as base canvas
    if (drawingCanvas.width !== baseCanvas.width || drawingCanvas.height !== baseCanvas.height) {
      drawingCanvas.width = baseCanvas.width;
      drawingCanvas.height = baseCanvas.height;
    }

    const ctx = drawingCanvas.getContext('2d');
    if (!ctx) return;

    // Handle select tool
    if (config.tool === 'select') {
      setIsSelecting(true);
      selectionStartRef.current = pos;
      setSelection(null);
      return;
    }

    // Handle fill tool
    if (config.tool === 'fill') {
      const baseCtx = baseCanvas.getContext('2d');
      if (baseCtx) {
        floodFill(baseCtx, baseCanvas, pos.x, pos.y, config.primaryColor);
        saveToHistory();
      }
      return;
    }

    // Handle shape tools
    if (config.tool === 'rectangle' || config.tool === 'circle' || config.tool === 'line') {
      shapeStartRef.current = pos;
      isDrawingRef.current = true;
      setIsDrawing(true);
      return;
    }

    // Handle brush/pencil/eraser
    isDrawingRef.current = true;
    setIsDrawing(true);
    lastPointRef.current = pos;

    // Set up drawing context
    if (config.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }

    // Draw initial point
    drawPoint(ctx, pos, config.primaryColor, config.brushSize, config.brushOpacity);
  }, [config, getCanvasPosition, saveToHistory, canvasState.panX, canvasState.panY]);

  // Mouse move handler
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Handle panning
    if (isPanningRef.current && panStartRef.current) {
      const deltaX = e.clientX - panStartRef.current.x;
      const deltaY = e.clientY - panStartRef.current.y;
      setCanvasState(prev => ({
        ...prev,
        panX: panStartRef.current!.panX + deltaX,
        panY: panStartRef.current!.panY + deltaY
      }));
      return;
    }

    const pos = getCanvasPosition(e);

    // Handle selection
    if (isSelecting && selectionStartRef.current) {
      const start = selectionStartRef.current;
      setSelection({
        x: Math.min(start.x, pos.x),
        y: Math.min(start.y, pos.y),
        width: Math.abs(pos.x - start.x),
        height: Math.abs(pos.y - start.y)
      });
      return;
    }

    if (!isDrawingRef.current) return;

    const drawingCanvas = drawingLayerRef.current;
    if (!drawingCanvas) return;

    const ctx = drawingCanvas.getContext('2d');
    if (!ctx) return;

    // Handle shape tools
    if (shapeStartRef.current && (config.tool === 'rectangle' || config.tool === 'circle' || config.tool === 'line')) {
      ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);

      if (config.tool === 'rectangle') {
        drawRectangle(ctx, shapeStartRef.current, pos, config.primaryColor, config.brushSize, false, config.brushOpacity);
      } else if (config.tool === 'circle') {
        drawEllipse(ctx, shapeStartRef.current, pos, config.primaryColor, config.brushSize, false, config.brushOpacity);
      } else if (config.tool === 'line') {
        drawLine(ctx, shapeStartRef.current, pos, config.primaryColor, config.brushSize, config.brushOpacity);
      }
      return;
    }

    // Handle freehand drawing
    if (lastPointRef.current) {
      const color = config.tool === 'eraser' ? 'rgba(255,255,255,1)' : config.primaryColor;

      if (config.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
      } else {
        ctx.globalCompositeOperation = 'source-over';
      }

      drawLine(ctx, lastPointRef.current, pos, color, config.brushSize, config.tool === 'eraser' ? 100 : config.brushOpacity);
    }

    lastPointRef.current = pos;
  }, [config, getCanvasPosition, isSelecting]);

  // Mouse up handler
  const handleMouseUp = useCallback(() => {
    // Handle end of panning
    if (isPanningRef.current) {
      isPanningRef.current = false;
      setIsPanning(false);
      panStartRef.current = null;
      return;
    }

    if (isSelecting) {
      setIsSelecting(false);
      selectionStartRef.current = null;
      return;
    }

    if (!isDrawingRef.current) return;

    isDrawingRef.current = false;
    setIsDrawing(false);
    lastPointRef.current = null;
    shapeStartRef.current = null;

    // Save to history after drawing completes
    saveToHistory();
  }, [isSelecting, saveToHistory]);

  // Mouse leave handler
  const handleMouseLeave = useCallback(() => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      setIsPanning(false);
      panStartRef.current = null;
      return;
    }
    if (isDrawingRef.current) {
      handleMouseUp();
    }
  }, [handleMouseUp]);

  // Wheel handler for zoom
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    // Ctrl+scroll for zoom
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -10 : 10;
      setCanvasState(prev => ({
        ...prev,
        zoom: Math.max(10, Math.min(400, prev.zoom + delta))
      }));
    } else {
      // Regular scroll for panning
      setCanvasState(prev => ({
        ...prev,
        panX: prev.panX - e.deltaX,
        panY: prev.panY - e.deltaY
      }));
    }
  }, []);

  // Restore canvas from history after re-renders
  useEffect(() => {
    if (canvasState.history.length === 0 || canvasState.historyIndex < 0) return;

    const timeoutId = setTimeout(() => {
      const canvas = canvasRef.current;
      const drawingCanvas = drawingLayerRef.current;

      if (!canvas || !drawingCanvas) return;

      const currentImageData = canvasState.history[canvasState.historyIndex];

      // Set canvas dimensions if needed
      if (canvas.width !== currentImageData.width || canvas.height !== currentImageData.height) {
        canvas.width = currentImageData.width;
        canvas.height = currentImageData.height;
        drawingCanvas.width = currentImageData.width;
        drawingCanvas.height = currentImageData.height;
      }

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.putImageData(currentImageData, 0, 0);
      }
    }, 10);

    return () => clearTimeout(timeoutId);
  }, [canvasState.history, canvasState.historyIndex]);

  return {
    // Refs
    canvasRef,
    drawingLayerRef,
    containerRef,

    // State
    canvasState,
    config,
    isDrawing,
    selection,
    isDirty,

    // State setters
    setTool,
    setBrushSize,
    setBrushOpacity,
    setPrimaryColor,
    setSecondaryColor,
    setZoom,
    setPan,
    resetPan,
    setSelection,

    // Canvas operations
    initializeCanvas,
    loadImageToCanvas,
    saveToHistory,
    undo,
    redo,
    clearCanvas,
    fitToContainer,
    getCanvasDataUrl,
    mergeDrawingLayer,

    // Event handlers
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    handleWheel,

    // Pan state
    isPanning,

    // Helpers
    canUndo: canvasState.historyIndex > 0,
    canRedo: canvasState.historyIndex < canvasState.history.length - 1
  };
}
