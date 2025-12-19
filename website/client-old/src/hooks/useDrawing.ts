import { useCallback, useRef } from 'react';
import { useCanvas, type UseCanvasReturn } from './useCanvas';
import type { Point, DrawingTool, CanvasConfig, CanvasState, Selection } from '@/types/editor';

export interface UseDrawingReturn extends UseCanvasReturn {
  // Touch event handlers
  handleTouchStart: (e: React.TouchEvent<HTMLCanvasElement>) => void;
  handleTouchMove: (e: React.TouchEvent<HTMLCanvasElement>) => void;
  handleTouchEnd: () => void;
}

// Get canvas position from touch event
function getTouchPosition(
  e: React.TouchEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement
): Point {
  const touch = e.touches[0] || e.changedTouches[0];
  if (!touch) return { x: 0, y: 0 };

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  return {
    x: Math.round((touch.clientX - rect.left) * scaleX),
    y: Math.round((touch.clientY - rect.top) * scaleY)
  };
}

/**
 * useDrawing - A hook for canvas drawing with both mouse and touch support
 *
 * This hook extends useCanvas with touch event handling for mobile/tablet support.
 * It provides a complete interface for drawing operations including:
 * - Drawing tools (brush, pencil, eraser, shapes)
 * - Color and brush settings
 * - Undo/redo history
 * - Zoom and pan
 * - Touch gestures
 *
 * @example
 * ```tsx
 * const drawing = useDrawing();
 *
 * return (
 *   <canvas
 *     ref={drawing.canvasRef}
 *     onMouseDown={drawing.handleMouseDown}
 *     onMouseMove={drawing.handleMouseMove}
 *     onMouseUp={drawing.handleMouseUp}
 *     onTouchStart={drawing.handleTouchStart}
 *     onTouchMove={drawing.handleTouchMove}
 *     onTouchEnd={drawing.handleTouchEnd}
 *   />
 * );
 * ```
 */
export function useDrawing(): UseDrawingReturn {
  const canvas = useCanvas();

  // Track touch drawing state
  const isTouchDrawing = useRef(false);
  const lastTouchPoint = useRef<Point | null>(null);

  // Convert touch event to mouse-like event for canvas operations
  const createMouseEventFromTouch = useCallback((
    e: React.TouchEvent<HTMLCanvasElement>,
    _eventType: 'mousedown' | 'mousemove' | 'mouseup'
  ): React.MouseEvent<HTMLCanvasElement> => {
    const touch = e.touches[0] || e.changedTouches[0];
    if (!touch) {
      // Return a minimal mock event
      return {
        ...e,
        clientX: 0,
        clientY: 0,
        button: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        preventDefault: () => e.preventDefault(),
        stopPropagation: () => e.stopPropagation(),
      } as unknown as React.MouseEvent<HTMLCanvasElement>;
    }

    return {
      ...e,
      clientX: touch.clientX,
      clientY: touch.clientY,
      button: 0, // Left click equivalent
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault: () => e.preventDefault(),
      stopPropagation: () => e.stopPropagation(),
    } as unknown as React.MouseEvent<HTMLCanvasElement>;
  }, []);

  // Touch start handler
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    // Prevent scrolling while drawing
    e.preventDefault();

    if (e.touches.length === 1) {
      // Single touch - treat as drawing
      isTouchDrawing.current = true;
      const mouseEvent = createMouseEventFromTouch(e, 'mousedown');
      canvas.handleMouseDown(mouseEvent);

      if (canvas.canvasRef.current) {
        lastTouchPoint.current = getTouchPosition(e, canvas.canvasRef.current);
      }
    }
    // Multi-touch could be used for pinch-zoom in future enhancement
  }, [canvas, createMouseEventFromTouch]);

  // Touch move handler
  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    if (isTouchDrawing.current && e.touches.length === 1) {
      const mouseEvent = createMouseEventFromTouch(e, 'mousemove');
      canvas.handleMouseMove(mouseEvent);

      if (canvas.canvasRef.current) {
        lastTouchPoint.current = getTouchPosition(e, canvas.canvasRef.current);
      }
    }
  }, [canvas, createMouseEventFromTouch]);

  // Touch end handler
  const handleTouchEnd = useCallback(() => {
    if (isTouchDrawing.current) {
      isTouchDrawing.current = false;
      lastTouchPoint.current = null;
      canvas.handleMouseUp();
    }
  }, [canvas]);

  return {
    ...canvas,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}

// Re-export types for convenience
export type {
  Point,
  DrawingTool,
  CanvasConfig,
  CanvasState,
  Selection,
};

export default useDrawing;
