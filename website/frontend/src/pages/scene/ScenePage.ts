/**
 * Scene Editor Page
 * 2D scene composition editor with offline support
 * AI features require connectivity
 */

import { Page, type PageOptions } from '../base/Page';
import { Button, Spinner, toast, OfflineIndicator } from '../../components';
import { sessionsApi } from '../../lib/api';
import { offlineManager, isOffline } from '../../lib/offline';
import { offlineStorage } from '../../lib/offlineStorage';
import { Viewport } from '../../lib/viewport';
import type { Session } from '../../types';
import './scene.css';

type SceneObjectType = 'sprite' | 'shape' | 'text' | 'group' | 'empty';
type ShapeType = 'rectangle' | 'circle' | 'ellipse' | 'polygon' | 'line';

interface Transform {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

interface SceneObject {
  id: string;
  name: string;
  type: SceneObjectType;
  visible: boolean;
  locked: boolean;
  transform: Transform;
  zIndex: number;
  opacity: number;
  children?: SceneObject[];
  // Type-specific properties
  shapeType?: ShapeType;
  color?: string;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  spriteUrl?: string;
}

interface ScenePageOptions extends PageOptions {
  params?: {
    sessionId?: string;
  };
}

export class ScenePage extends Page<ScenePageOptions> {
  readonly route = '/session/:sessionId/scene';
  readonly title = 'Scene Editor';
  protected requiresAuth = true;

  private session: Session | null = null;
  private isSaving = false;
  private offlineIndicator: OfflineIndicator | null = null;
  private unsubscribeOffline: (() => void) | null = null;
  private isOfflineMode = false;

  // Scene state
  private sceneCanvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private objects: SceneObject[] = [];
  private selectedObjectId: string | null = null;
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private hasUnsavedChanges = false;

  // Grid settings
  private showGrid = true;
  private gridSize = 32;
  private snapToGrid = true;

  // Viewport with center-origin coordinate system
  private viewport: Viewport | null = null;
  private isPanning = false;
  private panStart = { x: 0, y: 0 };
  private showOriginCrosshair = true;
  private mouseWorldPos = { x: 0, y: 0 };

  // Event listener references for cleanup
  private boundHandleMouseDown: ((e: MouseEvent) => void) | null = null;
  private boundHandleMouseMove: ((e: MouseEvent) => void) | null = null;
  private boundHandleMouseUp: (() => void) | null = null;
  private boundHandleWheel: ((e: WheelEvent) => void) | null = null;

  protected render(): string {
    return `
      <div class="scene-page">
        <header class="scene-header">
          <div class="scene-header-left">
            <button class="back-btn" data-action="back">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <div class="scene-session-info">
              <h1 class="scene-title">Scene Editor</h1>
              <p class="scene-subtitle">Loading...</p>
            </div>
          </div>
          <div class="scene-header-right">
            <div class="offline-status-badge" style="display: none;">
              <span class="offline-badge">Offline Mode</span>
            </div>
            <div class="ai-status-badge">
              <span class="ai-badge ai-badge--online">AI Ready</span>
            </div>
            <div class="save-btn-container"></div>
          </div>
        </header>
        <div class="offline-indicator-container"></div>

        <div class="scene-toolbar">
          <div class="toolbar-group">
            <button class="toolbar-btn" data-action="add-sprite" title="Add Sprite">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </button>
            <button class="toolbar-btn" data-action="add-rectangle" title="Add Rectangle">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
            </button>
            <button class="toolbar-btn" data-action="add-circle" title="Add Circle">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
            </button>
            <button class="toolbar-btn" data-action="add-text" title="Add Text">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
            </button>
          </div>

          <div class="toolbar-separator"></div>

          <div class="toolbar-group">
            <button class="toolbar-btn" data-action="move-up" title="Move Up">↑</button>
            <button class="toolbar-btn" data-action="move-down" title="Move Down">↓</button>
            <button class="toolbar-btn" data-action="delete" title="Delete">🗑</button>
          </div>

          <div class="toolbar-separator"></div>

          <div class="toolbar-group">
            <button class="toolbar-btn ${this.showGrid ? 'active' : ''}" data-action="toggle-grid" title="Toggle Grid">⊞</button>
            <button class="toolbar-btn ${this.snapToGrid ? 'active' : ''}" data-action="toggle-snap" title="Toggle Snap">⊟</button>
            <button class="toolbar-btn ${this.showOriginCrosshair ? 'active' : ''}" data-action="toggle-origin" title="Toggle Origin Crosshair">✛</button>
            <button class="toolbar-btn" data-action="reset-view" title="Reset View (Center on Origin)">⌂</button>
          </div>

          <div class="toolbar-spacer"></div>

          <div class="toolbar-group ai-group">
            <button class="toolbar-btn ai-btn" data-action="ai-suggest" title="AI Suggestions" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              AI Suggest
            </button>
          </div>
        </div>

        <div class="scene-layout">
          <!-- Hierarchy Panel -->
          <aside class="hierarchy-panel">
            <div class="panel-header">
              <span class="panel-title">Hierarchy</span>
              <button class="add-object-btn" title="Add Object">+</button>
            </div>
            <div class="hierarchy-tree">
              <div class="hierarchy-empty">
                <p>No objects in scene</p>
                <p class="hint">Add sprites, shapes, or text</p>
              </div>
            </div>
          </aside>

          <!-- Scene Canvas -->
          <main class="scene-canvas-container">
            <div class="scene-loading">
              <div class="spinner-container"></div>
              <p>Loading scene editor...</p>
            </div>
            <div class="scene-canvas-wrapper" style="display: none;">
              <canvas class="scene-canvas" width="1280" height="720"></canvas>
            </div>
          </main>

          <!-- Properties Panel -->
          <aside class="properties-panel">
            <div class="panel-header">
              <span class="panel-title">Properties</span>
            </div>
            <div class="properties-content">
              <div class="no-selection">
                <p>No object selected</p>
                <p class="hint">Click an object to edit properties</p>
              </div>
              <div class="object-properties" style="display: none;">
                <div class="property-section">
                  <div class="property-label">Name</div>
                  <input type="text" class="property-input object-name" placeholder="Object name">
                </div>

                <div class="property-section">
                  <div class="property-label">Transform</div>
                  <div class="transform-grid">
                    <div class="transform-row">
                      <label>X</label>
                      <input type="number" class="property-input transform-x" value="0">
                      <label>Y</label>
                      <input type="number" class="property-input transform-y" value="0">
                    </div>
                    <div class="transform-row">
                      <label>W</label>
                      <input type="number" class="property-input transform-w" value="100">
                      <label>H</label>
                      <input type="number" class="property-input transform-h" value="100">
                    </div>
                    <div class="transform-row">
                      <label>Rotation</label>
                      <input type="number" class="property-input transform-rotation" value="0" step="1">
                    </div>
                  </div>
                </div>

                <div class="property-section">
                  <div class="property-label">Appearance</div>
                  <div class="appearance-grid">
                    <div class="appearance-row">
                      <label>Opacity</label>
                      <input type="range" class="property-slider opacity-slider" min="0" max="100" value="100">
                      <span class="slider-value">100%</span>
                    </div>
                    <div class="appearance-row">
                      <label>Visible</label>
                      <input type="checkbox" class="property-checkbox visible-checkbox" checked>
                    </div>
                    <div class="appearance-row">
                      <label>Locked</label>
                      <input type="checkbox" class="property-checkbox locked-checkbox">
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>

        <!-- Status Bar -->
        <footer class="scene-status-bar">
          <span class="status-scene-size">1280 × 720</span>
          <span class="status-separator">|</span>
          <span class="status-objects">0 objects</span>
          <span class="status-separator">|</span>
          <span class="status-zoom">100%</span>
          <span class="status-separator">|</span>
          <span class="status-coords">X: 0, Y: 0</span>
          <span class="status-spacer"></span>
          <span class="status-origin-hint">Origin (0,0) at center</span>
          <span class="status-separator">|</span>
          <span class="status-selection">No selection</span>
        </footer>
      </div>
    `;
  }

  protected onMount(): void {
    super.onMount();

    // Setup back button
    const backBtn = this.$('[data-action="back"]') as HTMLButtonElement;
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        if (this.hasUnsavedChanges && !confirm('You have unsaved changes. Leave anyway?')) {
          return;
        }
        this.navigate(`/session/${this.options.params?.sessionId}/chat`);
      });
    }

    // Setup save button
    const saveBtnContainer = this.$('.save-btn-container') as HTMLElement;
    if (saveBtnContainer) {
      const saveBtn = new Button('Save Scene', {
        variant: 'primary',
        size: 'sm',
        onClick: () => this.saveScene(),
      });
      saveBtn.mount(saveBtnContainer);
    }

    // Show loading spinner
    const spinnerContainer = this.$('.spinner-container') as HTMLElement;
    if (spinnerContainer) {
      const spinner = new Spinner({ size: 'md' });
      spinner.mount(spinnerContainer);
    }

    // Setup offline indicator
    const offlineContainer = this.$('.offline-indicator-container') as HTMLElement;
    if (offlineContainer) {
      this.offlineIndicator = new OfflineIndicator({ position: 'bottom-right' });
      this.offlineIndicator.mount(offlineContainer);
    }

    // Subscribe to offline status changes
    this.unsubscribeOffline = offlineManager.subscribe((status, wasOffline) => {
      this.isOfflineMode = status === 'offline';
      this.updateOfflineUI();

      if (status === 'online' && wasOffline) {
        this.syncPendingChanges();
      }
    });

    // Setup toolbar buttons
    this.setupToolbar();

    // Setup canvas
    this.setupCanvas();

    // Load session data
    this.loadSession();
  }

  private setupToolbar(): void {
    // Add object buttons
    const addSpriteBtn = this.$('[data-action="add-sprite"]');
    const addRectBtn = this.$('[data-action="add-rectangle"]');
    const addCircleBtn = this.$('[data-action="add-circle"]');
    const addTextBtn = this.$('[data-action="add-text"]');

    if (addSpriteBtn) addSpriteBtn.addEventListener('click', () => this.addSprite());
    if (addRectBtn) addRectBtn.addEventListener('click', () => this.addShape('rectangle'));
    if (addCircleBtn) addCircleBtn.addEventListener('click', () => this.addShape('circle'));
    if (addTextBtn) addTextBtn.addEventListener('click', () => this.addText());

    // Object manipulation buttons
    const moveUpBtn = this.$('[data-action="move-up"]');
    const moveDownBtn = this.$('[data-action="move-down"]');
    const deleteBtn = this.$('[data-action="delete"]');

    if (moveUpBtn) moveUpBtn.addEventListener('click', () => this.moveSelectedUp());
    if (moveDownBtn) moveDownBtn.addEventListener('click', () => this.moveSelectedDown());
    if (deleteBtn) deleteBtn.addEventListener('click', () => this.deleteSelected());

    // View toggles
    const toggleGridBtn = this.$('[data-action="toggle-grid"]');
    const toggleSnapBtn = this.$('[data-action="toggle-snap"]');

    if (toggleGridBtn) {
      toggleGridBtn.addEventListener('click', () => {
        this.showGrid = !this.showGrid;
        toggleGridBtn.classList.toggle('active', this.showGrid);
        this.renderScene();
      });
    }

    if (toggleSnapBtn) {
      toggleSnapBtn.addEventListener('click', () => {
        this.snapToGrid = !this.snapToGrid;
        toggleSnapBtn.classList.toggle('active', this.snapToGrid);
      });
    }

    // Origin crosshair toggle
    const toggleOriginBtn = this.$('[data-action="toggle-origin"]');
    if (toggleOriginBtn) {
      toggleOriginBtn.addEventListener('click', () => {
        this.showOriginCrosshair = !this.showOriginCrosshair;
        toggleOriginBtn.classList.toggle('active', this.showOriginCrosshair);
        this.renderScene();
      });
    }

    // Reset view button
    const resetViewBtn = this.$('[data-action="reset-view"]');
    if (resetViewBtn) {
      resetViewBtn.addEventListener('click', () => {
        if (this.viewport) {
          this.viewport.reset();
          this.updateZoomDisplay();
          this.renderScene();
        }
      });
    }
  }

  private setupCanvas(): void {
    this.sceneCanvas = this.$('.scene-canvas') as HTMLCanvasElement;
    if (this.sceneCanvas) {
      this.ctx = this.sceneCanvas.getContext('2d');

      // Initialize viewport with center-origin coordinate system
      this.viewport = new Viewport({
        width: this.sceneCanvas.width,
        height: this.sceneCanvas.height,
        zoom: 1,
      });

      // Create bound handlers for cleanup
      this.boundHandleMouseDown = (e: MouseEvent) => this.handleMouseDown(e);
      this.boundHandleMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
      this.boundHandleMouseUp = () => this.handleMouseUp();
      this.boundHandleWheel = (e: WheelEvent) => this.handleWheel(e);

      // Mouse events for object selection and dragging
      this.sceneCanvas.addEventListener('mousedown', this.boundHandleMouseDown);
      this.sceneCanvas.addEventListener('mousemove', this.boundHandleMouseMove);
      this.sceneCanvas.addEventListener('mouseup', this.boundHandleMouseUp);
      this.sceneCanvas.addEventListener('mouseleave', this.boundHandleMouseUp);

      // Wheel event for zooming
      this.sceneCanvas.addEventListener('wheel', this.boundHandleWheel);
    }
  }

  private handleMouseDown(e: MouseEvent): void {
    if (!this.sceneCanvas || !this.viewport) return;

    const rect = this.sceneCanvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Convert to world coordinates (center-origin, Y+ up)
    const worldPos = this.viewport.screenToWorld(screenX, screenY);

    // Middle mouse button or shift+click for panning
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      this.isPanning = true;
      this.panStart = { x: screenX, y: screenY };
      e.preventDefault();
      return;
    }

    // Find clicked object (reverse order for top-most first)
    let clickedObject: SceneObject | null = null;
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const obj = this.objects[i];
      if (this.isPointInObject(worldPos.x, worldPos.y, obj)) {
        clickedObject = obj;
        break;
      }
    }

    if (clickedObject && !clickedObject.locked) {
      this.selectedObjectId = clickedObject.id;
      this.isDragging = true;
      this.dragStart = {
        x: worldPos.x - clickedObject.transform.x,
        y: worldPos.y - clickedObject.transform.y,
      };
    } else {
      this.selectedObjectId = null;
    }

    this.updatePropertiesPanel();
    this.updateHierarchy();
    this.updateStatusBar();
    this.renderScene();
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.sceneCanvas || !this.viewport) return;

    const rect = this.sceneCanvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Convert to world coordinates
    const worldPos = this.viewport.screenToWorld(screenX, screenY);

    // Update mouse world position for status bar
    this.mouseWorldPos = worldPos;
    this.updateCoordinateDisplay();

    // Handle panning
    if (this.isPanning) {
      const deltaX = screenX - this.panStart.x;
      const deltaY = screenY - this.panStart.y;
      this.viewport.panByScreen(deltaX, deltaY);
      this.panStart = { x: screenX, y: screenY };
      this.renderScene();
      return;
    }

    // Handle dragging objects
    if (!this.isDragging || !this.selectedObjectId) return;

    let x = worldPos.x - this.dragStart.x;
    let y = worldPos.y - this.dragStart.y;

    // Snap to grid (in world coordinates)
    if (this.snapToGrid) {
      x = Math.round(x / this.gridSize) * this.gridSize;
      y = Math.round(y / this.gridSize) * this.gridSize;
    }

    const obj = this.objects.find(o => o.id === this.selectedObjectId);
    if (obj) {
      obj.transform.x = x;
      obj.transform.y = y;
      this.hasUnsavedChanges = true;
      this.renderScene();
      this.updatePropertiesPanel();
    }
  }

  private handleMouseUp(): void {
    this.isDragging = false;
    this.isPanning = false;
  }

  private handleWheel(e: WheelEvent): void {
    if (!this.viewport || !this.sceneCanvas) return;

    e.preventDefault();

    const rect = this.sceneCanvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Scale zoom delta based on scroll amount for smoother trackpad experience
    // Clamp deltaY to reasonable range and scale it
    const normalizedDelta = Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 100);
    const zoomDelta = -normalizedDelta * 0.002;
    this.viewport.zoomToPoint(screenX, screenY, zoomDelta);

    this.updateZoomDisplay();
    this.renderScene();
  }

  private updateZoomDisplay(): void {
    const zoomStatus = this.$('.status-zoom') as HTMLElement;
    if (zoomStatus && this.viewport) {
      zoomStatus.textContent = `${Math.round(this.viewport.zoom * 100)}%`;
    }
  }

  private updateCoordinateDisplay(): void {
    const coordsStatus = this.$('.status-coords') as HTMLElement;
    if (coordsStatus) {
      coordsStatus.textContent = `X: ${Math.round(this.mouseWorldPos.x)}, Y: ${Math.round(this.mouseWorldPos.y)}`;
    }
  }

  private isPointInObject(x: number, y: number, obj: SceneObject): boolean {
    // Simple bounding box check in world coordinates (center-origin, Y+ up)
    // Objects are positioned by their bottom-left corner
    let width = 100;
    let height = 100;

    switch (obj.type) {
      case 'sprite':
        width = 100;
        height = 100;
        break;
      case 'shape':
        if (obj.shapeType === 'rectangle') {
          width = 100;
          height = 80;
        } else if (obj.shapeType === 'circle') {
          width = 100;
          height = 100;
        }
        break;
      case 'text':
        // Estimate text dimensions based on fontSize
        const fontSize = obj.fontSize || 24;
        const textLength = (obj.text || 'Text').length;
        width = textLength * fontSize * 0.6; // Approximate character width
        height = fontSize * 1.2;
        break;
    }

    // Apply scale transforms
    width *= obj.transform.scaleX;
    height *= obj.transform.scaleY;

    // In center-origin coordinates (Y+ up), check bounds
    // Object extends from (x, y) to (x + width, y + height)
    return x >= obj.transform.x && x <= obj.transform.x + width &&
           y >= obj.transform.y && y <= obj.transform.y + height;
  }

  private addSprite(): void {
    // Place new objects near origin (0, 0) in center-origin coordinates
    const offset = this.objects.length * 20; // Offset each new object slightly
    const obj: SceneObject = {
      id: `sprite-${Date.now()}`,
      name: `Sprite ${this.objects.length + 1}`,
      type: 'sprite',
      visible: true,
      locked: false,
      transform: { x: -50 + offset, y: -50 + offset, rotation: 0, scaleX: 1, scaleY: 1 },
      zIndex: this.objects.length,
      opacity: 1,
      color: '#4a90d9',
    };
    this.objects.push(obj);
    this.selectedObjectId = obj.id;
    this.hasUnsavedChanges = true;
    this.updateHierarchy();
    this.updatePropertiesPanel();
    this.updateStatusBar();
    this.renderScene();
  }

  private addShape(shapeType: ShapeType): void {
    const colors: Record<ShapeType, string> = {
      rectangle: '#e74c3c',
      circle: '#3498db',
      ellipse: '#9b59b6',
      polygon: '#2ecc71',
      line: '#f39c12',
    };

    // Place new objects near origin (0, 0) in center-origin coordinates
    const offset = this.objects.length * 20;
    const obj: SceneObject = {
      id: `shape-${Date.now()}`,
      name: `${shapeType.charAt(0).toUpperCase() + shapeType.slice(1)} ${this.objects.length + 1}`,
      type: 'shape',
      shapeType,
      visible: true,
      locked: false,
      transform: { x: -50 + offset, y: -40 + offset, rotation: 0, scaleX: 1, scaleY: 1 },
      zIndex: this.objects.length,
      opacity: 1,
      color: colors[shapeType],
    };
    this.objects.push(obj);
    this.selectedObjectId = obj.id;
    this.hasUnsavedChanges = true;
    this.updateHierarchy();
    this.updatePropertiesPanel();
    this.updateStatusBar();
    this.renderScene();
  }

  private addText(): void {
    // Place new objects near origin (0, 0) in center-origin coordinates
    const offset = this.objects.length * 20;
    const obj: SceneObject = {
      id: `text-${Date.now()}`,
      name: `Text ${this.objects.length + 1}`,
      type: 'text',
      visible: true,
      locked: false,
      transform: { x: -50 + offset, y: offset, rotation: 0, scaleX: 1, scaleY: 1 },
      zIndex: this.objects.length,
      opacity: 1,
      text: 'Sample Text',
      fontSize: 24,
      fontFamily: 'Arial',
      color: '#333333',
    };
    this.objects.push(obj);
    this.selectedObjectId = obj.id;
    this.hasUnsavedChanges = true;
    this.updateHierarchy();
    this.updatePropertiesPanel();
    this.updateStatusBar();
    this.renderScene();
  }

  private moveSelectedUp(): void {
    if (!this.selectedObjectId) return;
    const idx = this.objects.findIndex(o => o.id === this.selectedObjectId);
    if (idx > 0) {
      [this.objects[idx - 1], this.objects[idx]] = [this.objects[idx], this.objects[idx - 1]];
      this.hasUnsavedChanges = true;
      this.updateHierarchy();
      this.renderScene();
    }
  }

  private moveSelectedDown(): void {
    if (!this.selectedObjectId) return;
    const idx = this.objects.findIndex(o => o.id === this.selectedObjectId);
    if (idx < this.objects.length - 1) {
      [this.objects[idx], this.objects[idx + 1]] = [this.objects[idx + 1], this.objects[idx]];
      this.hasUnsavedChanges = true;
      this.updateHierarchy();
      this.renderScene();
    }
  }

  private deleteSelected(): void {
    if (!this.selectedObjectId) return;
    if (!confirm('Delete selected object?')) return;

    this.objects = this.objects.filter(o => o.id !== this.selectedObjectId);
    this.selectedObjectId = null;
    this.hasUnsavedChanges = true;
    this.updateHierarchy();
    this.updatePropertiesPanel();
    this.updateStatusBar();
    this.renderScene();
  }

  private renderScene(): void {
    if (!this.ctx || !this.sceneCanvas || !this.viewport) return;

    const { width, height } = this.sceneCanvas;

    // Clear canvas (in screen coordinates)
    this.ctx.fillStyle = '#f0f0f0';
    this.ctx.fillRect(0, 0, width, height);

    // Draw grid centered on origin (in world coordinates)
    if (this.showGrid) {
      this.drawCenteredGrid();
    }

    // Draw origin crosshair
    if (this.showOriginCrosshair) {
      this.drawOriginCrosshair();
    }

    // Draw objects in world coordinates
    this.ctx.save();
    this.viewport.applyTransform(this.ctx);

    // Apply Y-flip once for all objects (viewport has Y+ up, canvas draws Y+ down)
    this.ctx.scale(1, -1);

    for (const obj of this.objects) {
      if (!obj.visible) continue;

      this.ctx.save();
      this.ctx.globalAlpha = obj.opacity;
      this.ctx.translate(obj.transform.x, obj.transform.y);
      this.ctx.rotate((obj.transform.rotation * Math.PI) / 180);
      this.ctx.scale(obj.transform.scaleX, obj.transform.scaleY);

      switch (obj.type) {
        case 'sprite':
          this.ctx.fillStyle = obj.color || '#4a90d9';
          this.ctx.fillRect(0, -100, 100, 100);
          // Sprite icon
          this.ctx.fillStyle = 'white';
          this.ctx.font = '40px Arial';
          this.ctx.textAlign = 'center';
          this.ctx.textBaseline = 'middle';
          this.ctx.fillText('🖼', 50, -50);
          break;

        case 'shape':
          this.ctx.fillStyle = obj.color || '#e74c3c';
          if (obj.shapeType === 'rectangle') {
            this.ctx.fillRect(0, -80, 100, 80);
          } else if (obj.shapeType === 'circle') {
            this.ctx.beginPath();
            this.ctx.arc(50, -50, 50, 0, Math.PI * 2);
            this.ctx.fill();
          }
          break;

        case 'text':
          this.ctx.fillStyle = obj.color || '#333';
          this.ctx.font = `${obj.fontSize || 24}px ${obj.fontFamily || 'Arial'}`;
          this.ctx.textAlign = 'left';
          this.ctx.textBaseline = 'bottom';
          this.ctx.fillText(obj.text || 'Text', 0, 0);
          break;
      }

      this.ctx.restore();
    }

    this.ctx.restore();

    // Draw selection outline (in screen coordinates for crisp lines)
    this.drawSelectionOutline();
  }

  private drawCenteredGrid(): void {
    if (!this.ctx || !this.viewport) return;

    const bounds = this.viewport.getVisibleBounds();
    let gridSize = this.gridSize;

    // Skip grid if lines would be too dense (less than 5 pixels apart)
    const minPixelSpacing = 5;
    const screenGridSize = this.viewport.worldDistanceToScreen(gridSize);
    if (screenGridSize < minPixelSpacing) {
      // Increase grid size until it's visible
      const scaleFactor = Math.ceil(minPixelSpacing / screenGridSize);
      gridSize = this.gridSize * scaleFactor;
    }

    // Limit maximum number of grid lines to prevent performance issues
    const maxLines = 200;
    const horizontalLines = Math.ceil((bounds.maxX - bounds.minX) / gridSize);
    const verticalLines = Math.ceil((bounds.maxY - bounds.minY) / gridSize);
    if (horizontalLines > maxLines || verticalLines > maxLines) {
      return; // Skip grid entirely if too many lines
    }

    // Calculate grid lines that are visible
    const startX = Math.floor(bounds.minX / gridSize) * gridSize;
    const endX = Math.ceil(bounds.maxX / gridSize) * gridSize;
    const startY = Math.floor(bounds.minY / gridSize) * gridSize;
    const endY = Math.ceil(bounds.maxY / gridSize) * gridSize;

    this.ctx.strokeStyle = '#ddd';
    this.ctx.lineWidth = 1;

    // Draw vertical grid lines
    for (let x = startX; x <= endX; x += gridSize) {
      const screenStart = this.viewport.worldToScreen(x, bounds.minY);
      const screenEnd = this.viewport.worldToScreen(x, bounds.maxY);

      this.ctx.beginPath();
      this.ctx.moveTo(Math.round(screenStart.x) + 0.5, screenStart.y);
      this.ctx.lineTo(Math.round(screenEnd.x) + 0.5, screenEnd.y);
      this.ctx.stroke();
    }

    // Draw horizontal grid lines
    for (let y = startY; y <= endY; y += gridSize) {
      const screenStart = this.viewport.worldToScreen(bounds.minX, y);
      const screenEnd = this.viewport.worldToScreen(bounds.maxX, y);

      this.ctx.beginPath();
      this.ctx.moveTo(screenStart.x, Math.round(screenStart.y) + 0.5);
      this.ctx.lineTo(screenEnd.x, Math.round(screenEnd.y) + 0.5);
      this.ctx.stroke();
    }
  }

  private drawOriginCrosshair(): void {
    if (!this.ctx || !this.viewport) return;

    const origin = this.viewport.worldToScreen(0, 0);
    const { width, height } = this.sceneCanvas!;

    // Draw X axis (red)
    this.ctx.strokeStyle = '#ff4444';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(0, origin.y);
    this.ctx.lineTo(width, origin.y);
    this.ctx.stroke();

    // Draw Y axis (green)
    this.ctx.strokeStyle = '#44ff44';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(origin.x, 0);
    this.ctx.lineTo(origin.x, height);
    this.ctx.stroke();

    // Draw origin point
    this.ctx.fillStyle = '#ffffff';
    this.ctx.strokeStyle = '#333333';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(origin.x, origin.y, 6, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();

    // Draw axis labels
    this.ctx.fillStyle = '#ff4444';
    this.ctx.font = 'bold 12px Arial';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    this.ctx.fillText('+X', width - 25, origin.y + 5);

    this.ctx.fillStyle = '#44ff44';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'bottom';
    this.ctx.fillText('+Y', origin.x, 15);
  }

  private drawSelectionOutline(): void {
    if (!this.selectedObjectId || !this.ctx || !this.viewport) return;

    const obj = this.objects.find(o => o.id === this.selectedObjectId);
    if (!obj) return;

    // Get object bounds in world coordinates
    let width = 100;
    let height = 100;

    switch (obj.type) {
      case 'shape':
        if (obj.shapeType === 'rectangle') {
          width = 100;
          height = 80;
        }
        break;
      case 'text':
        const fontSize = obj.fontSize || 24;
        const textLength = (obj.text || 'Text').length;
        width = textLength * fontSize * 0.6;
        height = fontSize * 1.2;
        break;
    }

    width *= obj.transform.scaleX;
    height *= obj.transform.scaleY;

    // Convert corners to screen coordinates
    const topLeft = this.viewport.worldToScreen(obj.transform.x - 2, obj.transform.y + height + 2);
    const bottomRight = this.viewport.worldToScreen(obj.transform.x + width + 2, obj.transform.y - 2);

    const screenWidth = bottomRight.x - topLeft.x;
    const screenHeight = bottomRight.y - topLeft.y;

    this.ctx.strokeStyle = '#0066ff';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([5, 5]);
    this.ctx.strokeRect(topLeft.x, topLeft.y, screenWidth, screenHeight);
    this.ctx.setLineDash([]);
  }

  private updateHierarchy(): void {
    const treeContainer = this.$('.hierarchy-tree') as HTMLElement;
    if (!treeContainer) return;

    if (this.objects.length === 0) {
      treeContainer.innerHTML = `
        <div class="hierarchy-empty">
          <p>No objects in scene</p>
          <p class="hint">Add sprites, shapes, or text</p>
        </div>
      `;
      return;
    }

    const items = this.objects.map(obj => `
      <div class="hierarchy-item ${obj.id === this.selectedObjectId ? 'selected' : ''}" data-id="${obj.id}">
        <span class="hierarchy-visibility">${obj.visible ? '👁' : '👁‍🗨'}</span>
        <span class="hierarchy-icon">${this.getObjectIcon(obj)}</span>
        <span class="hierarchy-name">${obj.name}</span>
        ${obj.locked ? '<span class="hierarchy-locked">🔒</span>' : ''}
      </div>
    `).join('');

    treeContainer.innerHTML = items;

    // Add click handlers
    treeContainer.querySelectorAll('.hierarchy-item').forEach(item => {
      item.addEventListener('click', () => {
        this.selectedObjectId = (item as HTMLElement).dataset.id || null;
        this.updateHierarchy();
        this.updatePropertiesPanel();
        this.updateStatusBar();
        this.renderScene();
      });
    });
  }

  private getObjectIcon(obj: SceneObject): string {
    switch (obj.type) {
      case 'sprite': return '🖼';
      case 'shape':
        switch (obj.shapeType) {
          case 'rectangle': return '⬜';
          case 'circle': return '⭕';
          default: return '◆';
        }
      case 'text': return '📝';
      case 'group': return '📁';
      default: return '◻';
    }
  }

  private updatePropertiesPanel(): void {
    const noSelection = this.$('.no-selection') as HTMLElement;
    const properties = this.$('.object-properties') as HTMLElement;

    if (!this.selectedObjectId) {
      if (noSelection) noSelection.style.display = 'block';
      if (properties) properties.style.display = 'none';
      return;
    }

    const obj = this.objects.find(o => o.id === this.selectedObjectId);
    if (!obj) return;

    if (noSelection) noSelection.style.display = 'none';
    if (properties) properties.style.display = 'block';

    // Update form fields
    const nameInput = this.$('.object-name') as HTMLInputElement;
    const xInput = this.$('.transform-x') as HTMLInputElement;
    const yInput = this.$('.transform-y') as HTMLInputElement;
    const rotationInput = this.$('.transform-rotation') as HTMLInputElement;
    const opacitySlider = this.$('.opacity-slider') as HTMLInputElement;
    const visibleCheckbox = this.$('.visible-checkbox') as HTMLInputElement;
    const lockedCheckbox = this.$('.locked-checkbox') as HTMLInputElement;

    if (nameInput) nameInput.value = obj.name;
    if (xInput) xInput.value = String(Math.round(obj.transform.x));
    if (yInput) yInput.value = String(Math.round(obj.transform.y));
    if (rotationInput) rotationInput.value = String(obj.transform.rotation);
    if (opacitySlider) opacitySlider.value = String(obj.opacity * 100);
    if (visibleCheckbox) visibleCheckbox.checked = obj.visible;
    if (lockedCheckbox) lockedCheckbox.checked = obj.locked;
  }

  private updateStatusBar(): void {
    const objectsStatus = this.$('.status-objects') as HTMLElement;
    const selectionStatus = this.$('.status-selection') as HTMLElement;

    if (objectsStatus) {
      objectsStatus.textContent = `${this.objects.length} object${this.objects.length !== 1 ? 's' : ''}`;
    }

    if (selectionStatus) {
      if (this.selectedObjectId) {
        const obj = this.objects.find(o => o.id === this.selectedObjectId);
        selectionStatus.textContent = obj ? obj.name : 'No selection';
      } else {
        selectionStatus.textContent = 'No selection';
      }
    }
  }

  private showCanvas(): void {
    const loading = this.$('.scene-loading') as HTMLElement;
    const wrapper = this.$('.scene-canvas-wrapper') as HTMLElement;

    if (loading) loading.style.display = 'none';
    if (wrapper) wrapper.style.display = 'block';
  }

  private async loadSession(): Promise<void> {
    const sessionId = this.options.params?.sessionId;
    if (!sessionId) {
      toast.error('No session ID provided');
      this.navigate('/agents');
      return;
    }

    try {
      if (isOffline()) {
        const cachedSession = await offlineStorage.getCachedSession(sessionId);
        if (cachedSession) {
          this.session = cachedSession as unknown as Session;
          this.updateHeader();
          this.showCanvas();
          this.renderScene();
          toast.info('Loaded from offline cache');
        } else {
          toast.error('Session not available offline');
          this.navigate('/agents');
        }
        return;
      }

      const response = await sessionsApi.get(sessionId);
      this.session = response.session;
      await offlineStorage.cacheSession(sessionId, response.session as unknown as Record<string, unknown>);
      this.updateHeader();
      this.showCanvas();
      this.renderScene();
    } catch (error) {
      const cachedSession = await offlineStorage.getCachedSession(sessionId);
      if (cachedSession) {
        this.session = cachedSession as unknown as Session;
        this.isOfflineMode = true;
        this.updateHeader();
        this.updateOfflineUI();
        this.showCanvas();
        this.renderScene();
        toast.info('Loaded from offline cache');
      } else {
        toast.error('Failed to load session');
        console.error('Failed to load session:', error);
        this.navigate('/agents');
      }
    }
  }

  private updateHeader(): void {
    const subtitleEl = this.$('.scene-subtitle');

    if (this.session) {
      const repo = this.session.repositoryOwner && this.session.repositoryName
        ? `${this.session.repositoryOwner}/${this.session.repositoryName}`
        : '';
      const branch = this.session.branch || '';
      const subtitle = [repo, branch].filter(Boolean).join(' • ');
      if (subtitleEl) subtitleEl.textContent = subtitle || 'No repository';
    }
  }

  private updateOfflineUI(): void {
    const offlineBadge = this.$('.offline-status-badge') as HTMLElement;
    const aiBadge = this.$('.ai-badge') as HTMLElement;
    const aiButtons = this.$$('.ai-btn');

    if (offlineBadge) {
      offlineBadge.style.display = this.isOfflineMode ? 'block' : 'none';
    }

    if (aiBadge) {
      if (this.isOfflineMode) {
        aiBadge.textContent = 'AI Offline';
        aiBadge.classList.remove('ai-badge--online');
        aiBadge.classList.add('ai-badge--offline');
      } else {
        aiBadge.textContent = 'AI Ready';
        aiBadge.classList.remove('ai-badge--offline');
        aiBadge.classList.add('ai-badge--online');
      }
    }

    aiButtons.forEach(btn => {
      (btn as HTMLButtonElement).disabled = this.isOfflineMode;
    });
  }

  private async saveScene(): Promise<void> {
    if (this.isSaving) return;

    this.isSaving = true;

    try {
      const sceneData = {
        objects: this.objects,
        settings: {
          showGrid: this.showGrid,
          gridSize: this.gridSize,
          snapToGrid: this.snapToGrid,
        },
      };

      const sessionPath = this.getSessionPath();
      const filePath = 'scene.json';
      const content = JSON.stringify(sceneData, null, 2);

      if (this.isOfflineMode || isOffline()) {
        await offlineStorage.saveFileLocally(sessionPath, filePath, content, 'text');
        toast.success('Scene saved locally (will sync when online)');
      } else {
        await offlineStorage.cacheFile(sessionPath, filePath, content, 'text');
        toast.success('Scene saved');
      }

      this.hasUnsavedChanges = false;
    } catch (error) {
      console.error('Failed to save scene:', error);
      toast.error('Failed to save scene');
    } finally {
      this.isSaving = false;
    }
  }

  private getSessionPath(): string {
    if (!this.session) return '';
    const owner = this.session.repositoryOwner || '';
    const repo = this.session.repositoryName || '';
    const branch = this.session.branch || '';
    return `${owner}__${repo}__${branch}`;
  }

  private async syncPendingChanges(): Promise<void> {
    try {
      const dirtyFiles = await offlineStorage.getDirtyFiles();
      if (dirtyFiles.length === 0) return;

      toast.info(`Syncing ${dirtyFiles.length} file(s)...`);

      for (const file of dirtyFiles) {
        try {
          await offlineStorage.markFileSynced(file.sessionPath, file.filePath);
        } catch (error) {
          console.error(`Failed to sync file ${file.filePath}:`, error);
        }
      }

      toast.success('Changes synced successfully');
    } catch (error) {
      console.error('Failed to sync pending changes:', error);
    }
  }

  protected onUnmount(): void {
    // Remove canvas event listeners
    if (this.sceneCanvas) {
      if (this.boundHandleMouseDown) {
        this.sceneCanvas.removeEventListener('mousedown', this.boundHandleMouseDown);
      }
      if (this.boundHandleMouseMove) {
        this.sceneCanvas.removeEventListener('mousemove', this.boundHandleMouseMove);
      }
      if (this.boundHandleMouseUp) {
        this.sceneCanvas.removeEventListener('mouseup', this.boundHandleMouseUp);
        this.sceneCanvas.removeEventListener('mouseleave', this.boundHandleMouseUp);
      }
      if (this.boundHandleWheel) {
        this.sceneCanvas.removeEventListener('wheel', this.boundHandleWheel);
      }
    }

    // Clear bound handler references
    this.boundHandleMouseDown = null;
    this.boundHandleMouseMove = null;
    this.boundHandleMouseUp = null;
    this.boundHandleWheel = null;

    if (this.unsubscribeOffline) {
      this.unsubscribeOffline();
      this.unsubscribeOffline = null;
    }

    if (this.offlineIndicator) {
      this.offlineIndicator.unmount();
      this.offlineIndicator = null;
    }
  }
}
