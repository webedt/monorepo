import { useRef, useEffect, useCallback, useState } from 'react';
import type { Scene, SceneObject, EditorViewport, SelectionState, EditorTool } from '@/types/scene';

interface SceneCanvasProps {
  scene: Scene;
  viewport: EditorViewport;
  selection: SelectionState;
  tool: EditorTool;
  onSelectObject: (id: string, addToSelection?: boolean) => void;
  onDeselectAll: () => void;
  onUpdateTransform: (id: string, transform: { x?: number; y?: number; rotation?: number; scaleX?: number; scaleY?: number }) => void;
  onSetHovered: (id: string | null) => void;
  onAddRectangle: (x: number, y: number) => void;
  onAddCircle: (x: number, y: number) => void;
  onAddText: (x: number, y: number) => void;
  onSetPan: (panX: number, panY: number) => void;
  onSetZoom: (zoom: number) => void;
}

export default function SceneCanvas({
  scene,
  viewport,
  selection,
  tool,
  onSelectObject,
  onDeselectAll,
  onUpdateTransform,
  onSetHovered,
  onAddRectangle,
  onAddCircle,
  onAddText,
  onSetPan,
  onSetZoom,
}: SceneCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; objX: number; objY: number } | null>(null);
  const [panStart, setPanStart] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // Get canvas position from mouse event
  const getCanvasPosition = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scale = viewport.zoom / 100;
    return {
      x: (e.clientX - rect.left - viewport.panX) / scale,
      y: (e.clientY - rect.top - viewport.panY) / scale,
    };
  }, [viewport]);

  // Find object at position
  const findObjectAtPosition = useCallback((x: number, y: number): SceneObject | null => {
    const objects = Object.values(scene.objects);
    // Sort by z-index descending to get topmost object first
    const sortedObjects = [...objects].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));

    for (const obj of sortedObjects) {
      if (!obj.visible || obj.locked) continue;

      const objX = obj.transform.x;
      const objY = obj.transform.y;
      let width = 100;
      let height = 100;

      if ('width' in obj && 'height' in obj) {
        width = (obj as any).width;
        height = (obj as any).height;
      }

      if (x >= objX && x <= objX + width && y >= objY && y <= objY + height) {
        return obj;
      }
    }

    return null;
  }, [scene.objects]);

  // Draw the scene
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const scale = viewport.zoom / 100;

    // Clear canvas
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(viewport.panX, viewport.panY);
    ctx.scale(scale, scale);

    // Draw scene background
    ctx.fillStyle = scene.viewport.backgroundColor;
    ctx.fillRect(0, 0, scene.viewport.width, scene.viewport.height);

    // Draw grid
    if (viewport.showGrid) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1 / scale;

      const gridSize = viewport.gridSize;
      for (let x = 0; x <= scene.viewport.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, scene.viewport.height);
        ctx.stroke();
      }
      for (let y = 0; y <= scene.viewport.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(scene.viewport.width, y);
        ctx.stroke();
      }
    }

    // Draw objects sorted by z-index
    const objects = Object.values(scene.objects);
    const sortedObjects = [...objects].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

    for (const obj of sortedObjects) {
      if (!obj.visible) continue;

      ctx.save();
      ctx.translate(obj.transform.x, obj.transform.y);
      ctx.rotate((obj.transform.rotation * Math.PI) / 180);
      ctx.scale(obj.transform.scaleX, obj.transform.scaleY);

      const isSelected = selection.selectedIds.includes(obj.id);
      const isHovered = selection.hoveredId === obj.id;

      if (obj.type === 'shape') {
        const shape = obj as any;
        ctx.fillStyle = shape.fillColor;
        ctx.strokeStyle = shape.strokeColor;
        ctx.lineWidth = shape.strokeWidth;
        ctx.globalAlpha = shape.opacity;

        if (shape.shapeType === 'rectangle') {
          ctx.fillRect(0, 0, shape.width, shape.height);
          ctx.strokeRect(0, 0, shape.width, shape.height);
        } else if (shape.shapeType === 'circle' || shape.shapeType === 'ellipse') {
          ctx.beginPath();
          ctx.ellipse(shape.width / 2, shape.height / 2, shape.width / 2, shape.height / 2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      } else if (obj.type === 'text') {
        const text = obj as any;
        ctx.globalAlpha = text.opacity;
        ctx.fillStyle = text.color;
        ctx.font = `${text.fontStyle} ${text.fontWeight} ${text.fontSize}px ${text.fontFamily}`;
        ctx.textAlign = text.textAlign;
        ctx.textBaseline = 'top';
        ctx.fillText(text.text, 0, 0);
      }

      ctx.globalAlpha = 1;

      // Draw selection/hover indicator
      if (isSelected || isHovered) {
        let width = 100;
        let height = 100;
        if ('width' in obj && 'height' in obj) {
          width = (obj as any).width;
          height = (obj as any).height;
        }

        ctx.strokeStyle = isSelected ? '#3b82f6' : '#60a5fa';
        ctx.lineWidth = 2 / scale;
        ctx.setLineDash(isHovered && !isSelected ? [5 / scale, 5 / scale] : []);
        ctx.strokeRect(-2 / scale, -2 / scale, width + 4 / scale, height + 4 / scale);
        ctx.setLineDash([]);

        // Draw resize handles for selected objects
        if (isSelected) {
          const handleSize = 8 / scale;
          ctx.fillStyle = '#3b82f6';
          const handles = [
            { x: -handleSize / 2, y: -handleSize / 2 },
            { x: width / 2 - handleSize / 2, y: -handleSize / 2 },
            { x: width - handleSize / 2, y: -handleSize / 2 },
            { x: width - handleSize / 2, y: height / 2 - handleSize / 2 },
            { x: width - handleSize / 2, y: height - handleSize / 2 },
            { x: width / 2 - handleSize / 2, y: height - handleSize / 2 },
            { x: -handleSize / 2, y: height - handleSize / 2 },
            { x: -handleSize / 2, y: height / 2 - handleSize / 2 },
          ];
          handles.forEach(handle => {
            ctx.fillRect(handle.x, handle.y, handleSize, handleSize);
          });
        }
      }

      ctx.restore();
    }

    ctx.restore();
  }, [scene, viewport, selection]);

  // Handle canvas resize
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeObserver = new ResizeObserver(() => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      draw();
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [draw]);

  // Redraw on state change
  useEffect(() => {
    draw();
  }, [draw]);

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const pos = getCanvasPosition(e);

    // Middle mouse or space+click for panning
    if (e.button === 1 || tool === 'pan') {
      setIsPanning(true);
      setPanStart({
        x: e.clientX,
        y: e.clientY,
        panX: viewport.panX,
        panY: viewport.panY,
      });
      return;
    }

    // Left click
    if (e.button === 0) {
      // Creation tools
      if (tool === 'rectangle') {
        onAddRectangle(pos.x, pos.y);
        return;
      }
      if (tool === 'circle') {
        onAddCircle(pos.x, pos.y);
        return;
      }
      if (tool === 'text') {
        onAddText(pos.x, pos.y);
        return;
      }

      // Selection/Move
      const obj = findObjectAtPosition(pos.x, pos.y);
      if (obj) {
        onSelectObject(obj.id, e.shiftKey);
        if (tool === 'select' || tool === 'move') {
          setIsDragging(true);
          setDragStart({
            x: pos.x,
            y: pos.y,
            objX: obj.transform.x,
            objY: obj.transform.y,
          });
        }
      } else {
        onDeselectAll();
      }
    }
  }, [getCanvasPosition, tool, viewport, findObjectAtPosition, onSelectObject, onDeselectAll, onAddRectangle, onAddCircle, onAddText]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const pos = getCanvasPosition(e);

    // Panning
    if (isPanning && panStart) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      onSetPan(panStart.panX + dx, panStart.panY + dy);
      return;
    }

    // Dragging objects
    if (isDragging && dragStart && selection.selectedIds.length > 0) {
      const dx = pos.x - dragStart.x;
      const dy = pos.y - dragStart.y;

      selection.selectedIds.forEach(id => {
        const obj = scene.objects[id];
        if (obj) {
          let newX = dragStart.objX + dx;
          let newY = dragStart.objY + dy;

          // Snap to grid
          if (viewport.snapToGrid) {
            newX = Math.round(newX / viewport.gridSize) * viewport.gridSize;
            newY = Math.round(newY / viewport.gridSize) * viewport.gridSize;
          }

          onUpdateTransform(id, { x: newX, y: newY });
        }
      });
      return;
    }

    // Hover detection
    const obj = findObjectAtPosition(pos.x, pos.y);
    onSetHovered(obj?.id || null);
  }, [getCanvasPosition, isPanning, panStart, isDragging, dragStart, selection, scene.objects, viewport, onSetPan, onUpdateTransform, findObjectAtPosition, onSetHovered]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsPanning(false);
    setDragStart(null);
    setPanStart(null);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -10 : 10;
      onSetZoom(viewport.zoom + delta);
    } else {
      onSetPan(viewport.panX - e.deltaX, viewport.panY - e.deltaY);
    }
  }, [viewport, onSetZoom, onSetPan]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden bg-base-300 cursor-crosshair"
      style={{ cursor: isPanning ? 'grabbing' : isDragging ? 'move' : tool === 'pan' ? 'grab' : 'default' }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
    </div>
  );
}
