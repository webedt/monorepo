import { useRef, useEffect } from 'react';
import type { Selection } from '@/utils/imageEditor';

interface CanvasProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  drawingLayerRef: React.RefObject<HTMLCanvasElement>;
  containerRef: React.RefObject<HTMLDivElement>;
  width: number;
  height: number;
  zoom: number;
  selection: Selection | null;
  onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseUp: () => void;
  onMouseLeave: () => void;
}

export default function Canvas({
  canvasRef,
  drawingLayerRef,
  containerRef,
  width,
  height,
  zoom,
  selection,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseLeave
}: CanvasProps) {
  const checkerboardRef = useRef<HTMLCanvasElement>(null);

  // Draw checkerboard pattern for transparency
  useEffect(() => {
    const canvas = checkerboardRef.current;
    if (!canvas) return;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const squareSize = 10;
    const lightColor = '#ffffff';
    const darkColor = '#e0e0e0';

    for (let y = 0; y < height; y += squareSize) {
      for (let x = 0; x < width; x += squareSize) {
        const isLight = ((x / squareSize) + (y / squareSize)) % 2 === 0;
        ctx.fillStyle = isLight ? lightColor : darkColor;
        ctx.fillRect(x, y, squareSize, squareSize);
      }
    }
  }, [width, height]);

  const scaledWidth = (width * zoom) / 100;
  const scaledHeight = (height * zoom) / 100;

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto bg-base-300 flex items-center justify-center p-4"
    >
      <div
        className="relative bg-white shadow-lg"
        style={{
          width: scaledWidth,
          height: scaledHeight
        }}
      >
        {/* Checkerboard background for transparency */}
        <canvas
          ref={checkerboardRef}
          className="absolute inset-0 pointer-events-none"
          style={{
            width: scaledWidth,
            height: scaledHeight
          }}
        />

        {/* Main canvas */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          style={{
            width: scaledWidth,
            height: scaledHeight,
            imageRendering: zoom > 100 ? 'pixelated' : 'auto'
          }}
        />

        {/* Drawing layer */}
        <canvas
          ref={drawingLayerRef}
          className="absolute inset-0 cursor-crosshair"
          style={{
            width: scaledWidth,
            height: scaledHeight,
            imageRendering: zoom > 100 ? 'pixelated' : 'auto'
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
        />

        {/* Selection overlay */}
        {selection && selection.width > 0 && selection.height > 0 && (
          <div
            className="absolute border-2 border-dashed border-blue-500 bg-blue-500/10 pointer-events-none"
            style={{
              left: (selection.x * zoom) / 100,
              top: (selection.y * zoom) / 100,
              width: (selection.width * zoom) / 100,
              height: (selection.height * zoom) / 100
            }}
          />
        )}
      </div>
    </div>
  );
}
