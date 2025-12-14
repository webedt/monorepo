// Image Editor Utility Functions

export interface Point {
  x: number;
  y: number;
}

export interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DrawingTool = 'select' | 'pencil' | 'brush' | 'eraser' | 'rectangle' | 'circle' | 'line' | 'fill';

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';

// Convert hex color to RGBA array
export function hexToRgba(hex: string, alpha: number = 255): [number, number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return [
      parseInt(result[1], 16),
      parseInt(result[2], 16),
      parseInt(result[3], 16),
      alpha
    ];
  }
  return [0, 0, 0, alpha];
}

// Convert RGBA array to hex string
export function rgbaToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

// Get canvas coordinates from mouse event
export function getCanvasPosition(
  e: React.MouseEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement
): Point {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  return {
    x: Math.round((e.clientX - rect.left) * scaleX),
    y: Math.round((e.clientY - rect.top) * scaleY)
  };
}

// Draw a line between two points
export function drawLine(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  color: string,
  size: number,
  opacity: number = 100
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = opacity / 100;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

// Draw a point (for initial brush contact)
export function drawPoint(
  ctx: CanvasRenderingContext2D,
  point: Point,
  color: string,
  size: number,
  opacity: number = 100
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = opacity / 100;
  ctx.beginPath();
  ctx.arc(point.x, point.y, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Draw a rectangle
export function drawRectangle(
  ctx: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  color: string,
  lineWidth: number,
  filled: boolean = false,
  opacity: number = 100
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = opacity / 100;

  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  if (filled) {
    ctx.fillRect(x, y, width, height);
  } else {
    ctx.strokeRect(x, y, width, height);
  }
  ctx.restore();
}

// Draw an ellipse/circle
export function drawEllipse(
  ctx: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  color: string,
  lineWidth: number,
  filled: boolean = false,
  opacity: number = 100
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = opacity / 100;

  const radiusX = Math.abs(end.x - start.x) / 2;
  const radiusY = Math.abs(end.y - start.y) / 2;
  const centerX = start.x + (end.x - start.x) / 2;
  const centerY = start.y + (end.y - start.y) / 2;

  ctx.beginPath();
  ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);

  if (filled) {
    ctx.fill();
  } else {
    ctx.stroke();
  }
  ctx.restore();
}

// Flood fill algorithm
export function floodFill(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  startX: number,
  startY: number,
  fillColor: string
): void {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Convert fill color to RGBA
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return;
  tempCtx.fillStyle = fillColor;
  tempCtx.fillRect(0, 0, 1, 1);
  const fillRgba = tempCtx.getImageData(0, 0, 1, 1).data;

  const targetX = Math.floor(startX);
  const targetY = Math.floor(startY);
  const targetIndex = (targetY * canvas.width + targetX) * 4;
  const targetColor = [data[targetIndex], data[targetIndex + 1], data[targetIndex + 2], data[targetIndex + 3]];

  // Don't fill if clicking on the same color
  if (targetColor[0] === fillRgba[0] &&
      targetColor[1] === fillRgba[1] &&
      targetColor[2] === fillRgba[2]) {
    return;
  }

  const stack: [number, number][] = [[targetX, targetY]];
  const visited = new Set<string>();

  const matchesTarget = (index: number) => {
    return Math.abs(data[index] - targetColor[0]) < 10 &&
           Math.abs(data[index + 1] - targetColor[1]) < 10 &&
           Math.abs(data[index + 2] - targetColor[2]) < 10 &&
           Math.abs(data[index + 3] - targetColor[3]) < 10;
  };

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const key = `${x},${y}`;

    if (visited.has(key)) continue;
    if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) continue;

    const index = (y * canvas.width + x) * 4;
    if (!matchesTarget(index)) continue;

    visited.add(key);

    data[index] = fillRgba[0];
    data[index + 1] = fillRgba[1];
    data[index + 2] = fillRgba[2];
    data[index + 3] = 255;

    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  ctx.putImageData(imageData, 0, 0);
}

// Calculate zoom to fit image within container
export function calculateFitZoom(
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number,
  padding: number = 40
): number {
  const availableWidth = containerWidth - padding * 2;
  const availableHeight = containerHeight - padding * 2;

  const scaleX = availableWidth / imageWidth;
  const scaleY = availableHeight / imageHeight;
  const fitScale = Math.min(scaleX, scaleY, 1); // Don't zoom in past 100%

  // Round to 1 decimal place
  const fitZoom = Math.round(fitScale * 1000) / 10;

  // Ensure minimum zoom of 10% and max of 100% for fit
  return Math.max(10, Math.min(fitZoom, 100));
}

// Create a blank canvas with specified dimensions and background
export function createBlankCanvas(
  width: number,
  height: number,
  transparent: boolean = true,
  backgroundColor: string = '#FFFFFF'
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    if (transparent) {
      ctx.clearRect(0, 0, width, height);
    } else {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, width, height);
    }
  }

  return canvas;
}

// Convert canvas to data URL
export function canvasToDataUrl(
  canvas: HTMLCanvasElement,
  mimeType: string = 'image/png',
  quality: number = 0.92
): string {
  return canvas.toDataURL(mimeType, quality);
}

// Convert data URL to Blob
export function dataUrlToBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

// Get MIME type from file extension
export function getMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon'
  };
  return mimeTypes[extension.toLowerCase()] || 'image/png';
}

// Merge multiple canvas layers
export function mergeLayers(
  layers: { canvas: HTMLCanvasElement; opacity: number; blendMode: BlendMode; visible: boolean }[],
  width: number,
  height: number
): HTMLCanvasElement {
  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = width;
  resultCanvas.height = height;

  const ctx = resultCanvas.getContext('2d');
  if (!ctx) return resultCanvas;

  // Draw each visible layer
  for (const layer of layers) {
    if (!layer.visible) continue;

    ctx.save();
    ctx.globalAlpha = layer.opacity / 100;
    ctx.globalCompositeOperation = blendModeToCompositeOperation(layer.blendMode);
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.restore();
  }

  return resultCanvas;
}

// Convert blend mode to canvas composite operation
function blendModeToCompositeOperation(blendMode: BlendMode): GlobalCompositeOperation {
  const mapping: Record<BlendMode, GlobalCompositeOperation> = {
    normal: 'source-over',
    multiply: 'multiply',
    screen: 'screen',
    overlay: 'overlay',
    darken: 'darken',
    lighten: 'lighten'
  };
  return mapping[blendMode] || 'source-over';
}

// Download canvas as image file
export function downloadCanvas(
  canvas: HTMLCanvasElement,
  filename: string,
  mimeType: string = 'image/png'
): void {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL(mimeType);
  link.click();
}

// Load image from URL or data URL
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    // Only set crossOrigin for non-data URLs
    if (!src.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }

    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Draw checkerboard pattern for transparent backgrounds
export function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  squareSize: number = 10,
  lightColor: string = '#ffffff',
  darkColor: string = '#cccccc'
): void {
  for (let y = 0; y < height; y += squareSize) {
    for (let x = 0; x < width; x += squareSize) {
      const isLight = ((x / squareSize) + (y / squareSize)) % 2 === 0;
      ctx.fillStyle = isLight ? lightColor : darkColor;
      ctx.fillRect(x, y, squareSize, squareSize);
    }
  }
}

// Clamp value between min and max
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
