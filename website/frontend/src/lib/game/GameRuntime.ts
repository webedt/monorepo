/**
 * Game Runtime
 * Manages the game loop, timing, and state for play mode
 */

import type { SceneObject } from '../../stores/sceneStore';

import { InputManager } from './InputManager';

export type PlayState = 'stopped' | 'playing' | 'paused';

export interface GameRuntimeConfig {
  canvas: HTMLCanvasElement;
  screenToWorld: (screenX: number, screenY: number) => { x: number; y: number };
  onRender: (runtime: GameRuntime) => void;
  targetFps?: number;
}

export interface RuntimeObject {
  id: string;
  original: SceneObject;
  // Runtime state (mutable during play)
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  visible: boolean;
  // Velocity for physics
  velocityX: number;
  velocityY: number;
  // Custom user data
  data: Record<string, unknown>;
}

export interface GameTime {
  /** Total time elapsed since play started (ms) */
  totalTime: number;
  /** Time since last frame (ms) */
  deltaTime: number;
  /** Current frame number */
  frame: number;
  /** Target frames per second */
  targetFps: number;
  /** Actual frames per second */
  fps: number;
  /** Time scale (1.0 = normal, 0.5 = half speed, 2.0 = double speed) */
  timeScale: number;
}

export class GameRuntime {
  private config: GameRuntimeConfig;
  private state: PlayState = 'stopped';
  private rafId: number | null = null;
  private lastFrameTime = 0;
  private fpsUpdateTime = 0;
  private frameCount = 0;
  private actualFps = 0;

  public readonly input: InputManager;
  public readonly objects: Map<string, RuntimeObject> = new Map();
  public readonly time: GameTime;

  constructor(config: GameRuntimeConfig) {
    this.config = config;

    this.input = new InputManager({
      canvas: config.canvas,
      screenToWorld: config.screenToWorld,
    });

    this.time = {
      totalTime: 0,
      deltaTime: 0,
      frame: 0,
      targetFps: config.targetFps ?? 60,
      fps: 0,
      timeScale: 1.0,
    };
  }

  /**
   * Get current play state
   */
  getState(): PlayState {
    return this.state;
  }

  /**
   * Check if game is currently playing
   */
  isPlaying(): boolean {
    return this.state === 'playing';
  }

  /**
   * Check if game is paused
   */
  isPaused(): boolean {
    return this.state === 'paused';
  }

  /**
   * Check if game is stopped
   */
  isStopped(): boolean {
    return this.state === 'stopped';
  }

  /**
   * Initialize runtime objects from scene objects
   */
  initializeObjects(sceneObjects: SceneObject[]): void {
    this.objects.clear();

    for (const obj of sceneObjects) {
      const runtimeObj: RuntimeObject = {
        id: obj.id,
        original: obj,
        x: obj.transform.x,
        y: obj.transform.y,
        rotation: obj.transform.rotation,
        scaleX: obj.transform.scaleX,
        scaleY: obj.transform.scaleY,
        opacity: obj.opacity,
        visible: obj.visible,
        velocityX: 0,
        velocityY: 0,
        data: {},
      };
      this.objects.set(obj.id, runtimeObj);
    }
  }

  /**
   * Start playing
   */
  play(sceneObjects: SceneObject[]): void {
    if (this.state === 'playing') return;

    if (this.state === 'stopped') {
      // Initialize from scene objects
      this.initializeObjects(sceneObjects);
      this.time.totalTime = 0;
      this.time.frame = 0;
      this.lastFrameTime = performance.now();
      this.fpsUpdateTime = this.lastFrameTime;
      this.frameCount = 0;
    }

    this.state = 'playing';
    this.input.enable();
    this.scheduleFrame();
  }

  /**
   * Pause the game
   */
  pause(): void {
    if (this.state !== 'playing') return;

    this.state = 'paused';
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Resume from pause
   */
  resume(): void {
    if (this.state !== 'paused') return;

    this.state = 'playing';
    this.lastFrameTime = performance.now();
    this.scheduleFrame();
  }

  /**
   * Stop the game and reset
   */
  stop(): void {
    if (this.state === 'stopped') return;

    this.state = 'stopped';
    this.input.disable();

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Reset timing
    this.time.totalTime = 0;
    this.time.deltaTime = 0;
    this.time.frame = 0;
    this.time.fps = 0;

    // Clear runtime objects
    this.objects.clear();
  }

  /**
   * Set time scale
   */
  setTimeScale(scale: number): void {
    this.time.timeScale = Math.max(0.1, Math.min(10, scale));
  }

  /**
   * Get a runtime object by ID
   */
  getObject(id: string): RuntimeObject | undefined {
    return this.objects.get(id);
  }

  /**
   * Get all visible runtime objects sorted by z-index
   */
  getVisibleObjects(): RuntimeObject[] {
    return Array.from(this.objects.values())
      .filter(obj => obj.visible)
      .sort((a, b) => (a.original.zIndex || 0) - (b.original.zIndex || 0));
  }

  /**
   * Simple physics update - apply velocity to position
   */
  applyPhysics(deltaTime: number): void {
    const dt = deltaTime / 1000; // Convert to seconds

    for (const obj of this.objects.values()) {
      obj.x += obj.velocityX * dt;
      obj.y += obj.velocityY * dt;
    }
  }

  /**
   * Check if a point is inside an object (for click detection)
   * Handles rotation by transforming the point into object-local space
   */
  isPointInObject(obj: RuntimeObject, worldX: number, worldY: number): boolean {
    const original = obj.original;

    // Get object dimensions
    let width = 100;
    let height = 100;

    if (original.type === 'sprite') {
      width = original.spriteWidth ?? 100;
      height = original.spriteHeight ?? 100;
    } else if (original.type === 'shape') {
      width = 100;
      height = original.shapeType === 'circle' ? 100 : 80;
    } else if (original.type === 'text') {
      width = (original.text?.length ?? 4) * (original.fontSize ?? 24) * 0.6;
      height = original.fontSize ?? 24;
    } else if (original.type.startsWith('ui-')) {
      width = original.uiWidth ?? 100;
      height = original.uiHeight ?? 40;
    }

    // Apply pivot
    const pivotX = original.transform.pivotX ?? 0.5;
    const pivotY = original.transform.pivotY ?? 0.5;

    // Transform world point to object-local space
    // 1. Translate relative to object position
    let localX = worldX - obj.x;
    let localY = worldY - obj.y;

    // 2. Apply inverse rotation if rotated
    if (obj.rotation !== 0) {
      const radians = -(obj.rotation * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const rotatedX = localX * cos - localY * sin;
      const rotatedY = localX * sin + localY * cos;
      localX = rotatedX;
      localY = rotatedY;
    }

    // 3. Apply inverse scale
    localX /= obj.scaleX;
    localY /= obj.scaleY;

    // 4. Check bounds in local space (centered on pivot)
    const left = -width * pivotX;
    const right = width * (1 - pivotX);
    const bottom = -height * pivotY;
    const top = height * (1 - pivotY);

    return localX >= left && localX <= right && localY >= bottom && localY <= top;
  }

  /**
   * Find object at world position
   */
  findObjectAtPoint(worldX: number, worldY: number): RuntimeObject | null {
    const visibleObjects = this.getVisibleObjects().reverse(); // Top to bottom

    for (const obj of visibleObjects) {
      if (this.isPointInObject(obj, worldX, worldY)) {
        return obj;
      }
    }

    return null;
  }

  private scheduleFrame(): void {
    this.rafId = requestAnimationFrame((timestamp) => this.gameLoop(timestamp));
  }

  private gameLoop(timestamp: number): void {
    if (this.state !== 'playing') return;

    // Calculate delta time
    const rawDeltaTime = timestamp - this.lastFrameTime;
    this.lastFrameTime = timestamp;

    // Apply time scale
    const deltaTime = rawDeltaTime * this.time.timeScale;

    // Cap delta time to prevent huge jumps
    const cappedDelta = Math.min(deltaTime, 100);

    // Update time
    this.time.deltaTime = cappedDelta;
    this.time.totalTime += cappedDelta;
    this.time.frame++;

    // Calculate FPS
    this.frameCount++;
    if (timestamp - this.fpsUpdateTime >= 1000) {
      this.actualFps = this.frameCount;
      this.time.fps = this.actualFps;
      this.frameCount = 0;
      this.fpsUpdateTime = timestamp;
    }

    // Apply simple physics
    this.applyPhysics(cappedDelta);

    // Update input
    this.input.update();

    // Call render callback
    this.config.onRender(this);

    // Schedule next frame
    this.scheduleFrame();
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stop();
    this.input.destroy();
  }
}
