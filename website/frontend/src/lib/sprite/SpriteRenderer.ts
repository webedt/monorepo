/**
 * Sprite Renderer
 * Handles loading, caching, and rendering of image sprites
 */

export interface SpriteSource {
  /** Image URL, data URL, or blob URL */
  url: string;
  /** Optional source rectangle for sprite sheets */
  sourceRect?: SpriteRect;
}

export interface SpriteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteSheetConfig {
  /** Number of columns in the sprite sheet */
  columns: number;
  /** Number of rows in the sprite sheet */
  rows: number;
  /** Width of each frame (auto-calculated if not provided) */
  frameWidth?: number;
  /** Height of each frame (auto-calculated if not provided) */
  frameHeight?: number;
  /** Total number of frames (defaults to columns * rows) */
  frameCount?: number;
  /** Padding between frames */
  padding?: number;
  /** Margin around the sprite sheet */
  margin?: number;
}

export interface SpriteTransform {
  x: number;
  y: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  opacity?: number;
  /** Anchor point for rotation/scaling (0-1, default 0.5 = center) */
  anchorX?: number;
  anchorY?: number;
}

export interface SpriteRenderOptions {
  /** Destination width (uses source width if not specified) */
  width?: number;
  /** Destination height (uses source height if not specified) */
  height?: number;
  /** Flip horizontally */
  flipX?: boolean;
  /** Flip vertically */
  flipY?: boolean;
  /** Tint color (CSS color string) */
  tint?: string;
  /** Blend mode */
  blendMode?: GlobalCompositeOperation;
}

export type SpriteLoadState = 'pending' | 'loading' | 'loaded' | 'error';

export interface CachedSprite {
  image: HTMLImageElement;
  state: SpriteLoadState;
  error?: Error;
  width: number;
  height: number;
}

/**
 * SpriteRenderer class for loading and rendering image sprites
 *
 * Features:
 * - Async image loading with caching
 * - Sprite sheet support with frame extraction
 * - Transform support (position, rotation, scale, opacity)
 * - Anchor point for rotation/scaling
 * - Horizontal/vertical flipping
 * - Tinting and blend modes
 *
 * @example
 * ```typescript
 * const renderer = new SpriteRenderer();
 *
 * // Preload images
 * await renderer.load('player', 'assets/player.png');
 * await renderer.loadSheet('tiles', 'assets/tileset.png', { columns: 16, rows: 16 });
 *
 * // Render sprites
 * renderer.draw(ctx, 'player', { x: 100, y: 100, rotation: 45 });
 * renderer.drawFrame(ctx, 'tiles', 5, { x: 200, y: 200 });
 * ```
 */
export class SpriteRenderer {
  private cache: Map<string, CachedSprite> = new Map();
  private sheets: Map<string, SpriteSheetConfig> = new Map();
  private loadPromises: Map<string, Promise<HTMLImageElement>> = new Map();

  /**
   * Load a sprite image
   * @param id Unique identifier for the sprite
   * @param url Image URL, data URL, or blob URL
   * @returns Promise that resolves when the image is loaded
   */
  async load(id: string, url: string): Promise<HTMLImageElement> {
    // Return existing promise if already loading
    const existingPromise = this.loadPromises.get(id);
    if (existingPromise) {
      return existingPromise;
    }

    // Return cached image if already loaded
    const cached = this.cache.get(id);
    if (cached && cached.state === 'loaded') {
      return cached.image;
    }

    // Start loading
    const promise = this.loadImage(id, url);
    this.loadPromises.set(id, promise);

    try {
      const image = await promise;
      return image;
    } finally {
      this.loadPromises.delete(id);
    }
  }

  /**
   * Load a sprite sheet
   * @param id Unique identifier for the sprite sheet
   * @param url Image URL
   * @param config Sprite sheet configuration
   * @returns Promise that resolves when the image is loaded
   */
  async loadSheet(
    id: string,
    url: string,
    config: SpriteSheetConfig
  ): Promise<HTMLImageElement> {
    const image = await this.load(id, url);

    // Calculate frame dimensions if not provided
    const cached = this.cache.get(id)!;
    const finalConfig: SpriteSheetConfig = {
      ...config,
      frameWidth: config.frameWidth ?? Math.floor(cached.width / config.columns),
      frameHeight: config.frameHeight ?? Math.floor(cached.height / config.rows),
      frameCount: config.frameCount ?? config.columns * config.rows,
      padding: config.padding ?? 0,
      margin: config.margin ?? 0,
    };

    this.sheets.set(id, finalConfig);
    return image;
  }

  /**
   * Load image from URL
   */
  private loadImage(id: string, url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      // Set initial state
      this.cache.set(id, {
        image: new Image(),
        state: 'loading',
        width: 0,
        height: 0,
      });

      const image = new Image();
      image.crossOrigin = 'anonymous';

      image.onload = () => {
        this.cache.set(id, {
          image,
          state: 'loaded',
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
        resolve(image);
      };

      image.onerror = () => {
        const error = new Error(`Failed to load sprite: ${url}`);
        this.cache.set(id, {
          image,
          state: 'error',
          error,
          width: 0,
          height: 0,
        });
        reject(error);
      };

      image.src = url;
    });
  }

  /**
   * Load image from File object
   * @param id Unique identifier for the sprite
   * @param file File object (from file input or drag/drop)
   * @returns Promise that resolves when the image is loaded
   */
  async loadFromFile(id: string, file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) {
        reject(new Error('File is not an image'));
        return;
      }

      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const dataUrl = reader.result as string;
          const image = await this.load(id, dataUrl);
          resolve(image);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };
      reader.readAsDataURL(file);
    });
  }

  /**
   * Load image from ImageData
   * @param id Unique identifier for the sprite
   * @param imageData ImageData object
   * @returns Promise that resolves when the image is created
   */
  async loadFromImageData(id: string, imageData: ImageData): Promise<HTMLImageElement> {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(imageData, 0, 0);
    const dataUrl = canvas.toDataURL();
    return this.load(id, dataUrl);
  }

  /**
   * Check if a sprite is loaded
   */
  isLoaded(id: string): boolean {
    const cached = this.cache.get(id);
    return cached?.state === 'loaded';
  }

  /**
   * Get sprite info
   */
  getInfo(id: string): CachedSprite | undefined {
    return this.cache.get(id);
  }

  /**
   * Get sprite sheet config
   */
  getSheetConfig(id: string): SpriteSheetConfig | undefined {
    return this.sheets.get(id);
  }

  /**
   * Get frame rectangle for a sprite sheet frame
   */
  getFrameRect(id: string, frameIndex: number): SpriteRect | null {
    const config = this.sheets.get(id);
    if (!config) return null;

    const frameCount = config.frameCount ?? config.columns * config.rows;
    if (frameIndex < 0 || frameIndex >= frameCount) return null;

    const col = frameIndex % config.columns;
    const row = Math.floor(frameIndex / config.columns);
    const margin = config.margin ?? 0;
    const padding = config.padding ?? 0;
    const frameWidth = config.frameWidth!;
    const frameHeight = config.frameHeight!;

    return {
      x: margin + col * (frameWidth + padding),
      y: margin + row * (frameHeight + padding),
      width: frameWidth,
      height: frameHeight,
    };
  }

  /**
   * Draw a sprite to a canvas context
   */
  draw(
    ctx: CanvasRenderingContext2D,
    id: string,
    transform: SpriteTransform,
    sourceRect?: SpriteRect,
    options?: SpriteRenderOptions
  ): boolean {
    const cached = this.cache.get(id);
    if (!cached || cached.state !== 'loaded') {
      return false;
    }

    const { image, width: imgWidth, height: imgHeight } = cached;

    // Source rectangle (entire image if not specified)
    const sx = sourceRect?.x ?? 0;
    const sy = sourceRect?.y ?? 0;
    const sw = sourceRect?.width ?? imgWidth;
    const sh = sourceRect?.height ?? imgHeight;

    // Destination dimensions
    const dw = options?.width ?? sw;
    const dh = options?.height ?? sh;

    // Transform values
    const x = transform.x;
    const y = transform.y;
    const rotation = transform.rotation ?? 0;
    const scaleX = (transform.scaleX ?? 1) * (options?.flipX ? -1 : 1);
    const scaleY = (transform.scaleY ?? 1) * (options?.flipY ? -1 : 1);
    const opacity = transform.opacity ?? 1;
    const anchorX = transform.anchorX ?? 0.5;
    const anchorY = transform.anchorY ?? 0.5;

    ctx.save();

    // Apply opacity
    ctx.globalAlpha = opacity;

    // Apply blend mode
    if (options?.blendMode) {
      ctx.globalCompositeOperation = options.blendMode;
    }

    // Apply transforms
    ctx.translate(x, y);

    if (rotation !== 0) {
      ctx.rotate((rotation * Math.PI) / 180);
    }

    ctx.scale(scaleX, scaleY);

    // Calculate draw position based on anchor
    const drawX = -dw * anchorX;
    const drawY = -dh * anchorY;

    // Apply tint if specified
    if (options?.tint) {
      // Draw to offscreen canvas for tinting
      const tintCanvas = document.createElement('canvas');
      tintCanvas.width = sw;
      tintCanvas.height = sh;
      const tintCtx = tintCanvas.getContext('2d')!;

      // Draw the sprite
      tintCtx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);

      // Apply tint using multiply blend
      tintCtx.globalCompositeOperation = 'multiply';
      tintCtx.fillStyle = options.tint;
      tintCtx.fillRect(0, 0, sw, sh);

      // Restore alpha from original
      tintCtx.globalCompositeOperation = 'destination-in';
      tintCtx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);

      ctx.drawImage(tintCanvas, drawX, drawY, dw, dh);
    } else {
      ctx.drawImage(image, sx, sy, sw, sh, drawX, drawY, dw, dh);
    }

    ctx.restore();

    return true;
  }

  /**
   * Draw a specific frame from a sprite sheet
   */
  drawFrame(
    ctx: CanvasRenderingContext2D,
    id: string,
    frameIndex: number,
    transform: SpriteTransform,
    options?: SpriteRenderOptions
  ): boolean {
    const frameRect = this.getFrameRect(id, frameIndex);
    if (!frameRect) {
      // Fall back to full image if not a sprite sheet
      return this.draw(ctx, id, transform, undefined, options);
    }

    return this.draw(ctx, id, transform, frameRect, options);
  }

  /**
   * Draw a 9-slice sprite for scalable UI elements
   */
  draw9Slice(
    ctx: CanvasRenderingContext2D,
    id: string,
    transform: SpriteTransform,
    slices: { left: number; right: number; top: number; bottom: number },
    destWidth: number,
    destHeight: number
  ): boolean {
    const cached = this.cache.get(id);
    if (!cached || cached.state !== 'loaded') {
      return false;
    }

    const { image, width: imgWidth, height: imgHeight } = cached;
    const { left, right, top, bottom } = slices;
    const centerWidth = imgWidth - left - right;
    const centerHeight = imgHeight - top - bottom;
    const destCenterWidth = destWidth - left - right;
    const destCenterHeight = destHeight - top - bottom;

    const x = transform.x;
    const y = transform.y;
    const opacity = transform.opacity ?? 1;

    ctx.save();
    ctx.globalAlpha = opacity;

    // Top-left corner
    ctx.drawImage(image, 0, 0, left, top, x, y, left, top);
    // Top-center
    ctx.drawImage(image, left, 0, centerWidth, top, x + left, y, destCenterWidth, top);
    // Top-right corner
    ctx.drawImage(image, imgWidth - right, 0, right, top, x + destWidth - right, y, right, top);

    // Middle-left
    ctx.drawImage(image, 0, top, left, centerHeight, x, y + top, left, destCenterHeight);
    // Middle-center
    ctx.drawImage(image, left, top, centerWidth, centerHeight, x + left, y + top, destCenterWidth, destCenterHeight);
    // Middle-right
    ctx.drawImage(image, imgWidth - right, top, right, centerHeight, x + destWidth - right, y + top, right, destCenterHeight);

    // Bottom-left corner
    ctx.drawImage(image, 0, imgHeight - bottom, left, bottom, x, y + destHeight - bottom, left, bottom);
    // Bottom-center
    ctx.drawImage(image, left, imgHeight - bottom, centerWidth, bottom, x + left, y + destHeight - bottom, destCenterWidth, bottom);
    // Bottom-right corner
    ctx.drawImage(image, imgWidth - right, imgHeight - bottom, right, bottom, x + destWidth - right, y + destHeight - bottom, right, bottom);

    ctx.restore();

    return true;
  }

  /**
   * Draw a tiled sprite
   */
  drawTiled(
    ctx: CanvasRenderingContext2D,
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    options?: { offsetX?: number; offsetY?: number; opacity?: number }
  ): boolean {
    const cached = this.cache.get(id);
    if (!cached || cached.state !== 'loaded') {
      return false;
    }

    const { image, width: imgWidth, height: imgHeight } = cached;
    const offsetX = options?.offsetX ?? 0;
    const offsetY = options?.offsetY ?? 0;
    const opacity = options?.opacity ?? 1;

    ctx.save();
    ctx.globalAlpha = opacity;

    // Clip to destination rectangle
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    // Calculate starting position considering offset
    const startX = x - (offsetX % imgWidth);
    const startY = y - (offsetY % imgHeight);

    // Draw tiles
    for (let ty = startY; ty < y + height; ty += imgHeight) {
      for (let tx = startX; tx < x + width; tx += imgWidth) {
        ctx.drawImage(image, tx, ty);
      }
    }

    ctx.restore();

    return true;
  }

  /**
   * Unload a sprite from cache
   */
  unload(id: string): void {
    this.cache.delete(id);
    this.sheets.delete(id);
    this.loadPromises.delete(id);
  }

  /**
   * Clear all cached sprites
   */
  clear(): void {
    this.cache.clear();
    this.sheets.clear();
    this.loadPromises.clear();
  }

  /**
   * Get list of all loaded sprite IDs
   */
  getLoadedIds(): string[] {
    const ids: string[] = [];
    this.cache.forEach((value, key) => {
      if (value.state === 'loaded') {
        ids.push(key);
      }
    });
    return ids;
  }

  /**
   * Preload multiple sprites
   */
  async preload(sprites: Array<{ id: string; url: string }>): Promise<void> {
    await Promise.all(
      sprites.map(({ id, url }) => this.load(id, url))
    );
  }

  /**
   * Create an animated sprite helper
   */
  createAnimatedSprite(
    id: string,
    options: {
      frameStart?: number;
      frameEnd?: number;
      fps?: number;
      loop?: boolean;
    } = {}
  ): AnimatedSprite {
    return new AnimatedSprite(this, id, options);
  }
}

/**
 * Helper class for animated sprites
 */
export class AnimatedSprite {
  private renderer: SpriteRenderer;
  private id: string;
  private frameStart: number;
  private frameEnd: number;
  private fps: number;
  private loop: boolean;
  private currentFrame: number;
  private elapsedTime: number = 0;
  private playing: boolean = false;
  private lastTime: number = 0;

  constructor(
    renderer: SpriteRenderer,
    id: string,
    options: {
      frameStart?: number;
      frameEnd?: number;
      fps?: number;
      loop?: boolean;
    } = {}
  ) {
    this.renderer = renderer;
    this.id = id;
    this.frameStart = options.frameStart ?? 0;
    this.frameEnd = options.frameEnd ?? this.getMaxFrame();
    this.fps = options.fps ?? 12;
    this.loop = options.loop ?? true;
    this.currentFrame = this.frameStart;
  }

  private getMaxFrame(): number {
    const config = this.renderer.getSheetConfig(this.id);
    if (!config) return 0;
    return (config.frameCount ?? config.columns * config.rows) - 1;
  }

  play(): void {
    this.playing = true;
    this.lastTime = performance.now();
  }

  pause(): void {
    this.playing = false;
  }

  stop(): void {
    this.playing = false;
    this.currentFrame = this.frameStart;
    this.elapsedTime = 0;
  }

  reset(): void {
    this.currentFrame = this.frameStart;
    this.elapsedTime = 0;
  }

  setFrame(frame: number): void {
    this.currentFrame = Math.max(this.frameStart, Math.min(this.frameEnd, frame));
  }

  getFrame(): number {
    return this.currentFrame;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  update(deltaTime?: number): void {
    if (!this.playing) return;

    const now = performance.now();
    const dt = deltaTime ?? (now - this.lastTime);
    this.lastTime = now;

    this.elapsedTime += dt;
    const frameDuration = 1000 / this.fps;

    while (this.elapsedTime >= frameDuration) {
      this.elapsedTime -= frameDuration;
      this.currentFrame++;

      if (this.currentFrame > this.frameEnd) {
        if (this.loop) {
          this.currentFrame = this.frameStart;
        } else {
          this.currentFrame = this.frameEnd;
          this.playing = false;
        }
      }
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    transform: SpriteTransform,
    options?: SpriteRenderOptions
  ): boolean {
    return this.renderer.drawFrame(ctx, this.id, this.currentFrame, transform, options);
  }
}

// Global sprite renderer instance for convenience
let globalRenderer: SpriteRenderer | null = null;

/**
 * Get the global sprite renderer instance
 */
export function getSpriteRenderer(): SpriteRenderer {
  if (!globalRenderer) {
    globalRenderer = new SpriteRenderer();
  }
  return globalRenderer;
}

/**
 * Set the global sprite renderer instance
 */
export function setSpriteRenderer(renderer: SpriteRenderer): void {
  globalRenderer = renderer;
}
