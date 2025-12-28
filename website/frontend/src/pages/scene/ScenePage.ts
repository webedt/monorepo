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
  pivotX: number; // 0 = left, 0.5 = center, 1 = right
  pivotY: number; // 0 = top, 0.5 = center, 1 = bottom
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
                  <div class="property-label">Pivot Point</div>
                  <div class="pivot-section">
                    <div class="pivot-grid-visual">
                      <button class="pivot-preset" data-pivot="0,0" title="Top Left" aria-label="Top Left">◸</button>
                      <button class="pivot-preset" data-pivot="0.5,0" title="Top Center" aria-label="Top Center">△</button>
                      <button class="pivot-preset" data-pivot="1,0" title="Top Right" aria-label="Top Right">◹</button>
                      <button class="pivot-preset" data-pivot="0,0.5" title="Middle Left" aria-label="Middle Left">◁</button>
                      <button class="pivot-preset" data-pivot="0.5,0.5" title="Center" aria-label="Center">◇</button>
                      <button class="pivot-preset" data-pivot="1,0.5" title="Middle Right" aria-label="Middle Right">▷</button>
                      <button class="pivot-preset" data-pivot="0,1" title="Bottom Left" aria-label="Bottom Left">◺</button>
                      <button class="pivot-preset" data-pivot="0.5,1" title="Bottom Center" aria-label="Bottom Center">▽</button>
                      <button class="pivot-preset" data-pivot="1,1" title="Bottom Right" aria-label="Bottom Right">◿</button>
                    </div>
                    <div class="pivot-inputs">
                      <div class="transform-row">
                        <label>X</label>
                        <input type="number" class="property-input pivot-x" value="0.5" min="0" max="1" step="0.1">
                        <label>Y</label>
                        <input type="number" class="property-input pivot-y" value="0.5" min="0" max="1" step="0.1">
                      </div>
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
          <span class="status-spacer"></span>
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

    // Setup property panel event handlers
    this.setupPropertyHandlers();

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
  }

  private setupCanvas(): void {
    this.sceneCanvas = this.$('.scene-canvas') as HTMLCanvasElement;
    if (this.sceneCanvas) {
      this.ctx = this.sceneCanvas.getContext('2d');

      // Mouse events for object selection and dragging
      this.sceneCanvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
      this.sceneCanvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
      this.sceneCanvas.addEventListener('mouseup', () => this.handleMouseUp());
      this.sceneCanvas.addEventListener('mouseleave', () => this.handleMouseUp());
    }
  }

  private setupPropertyHandlers(): void {
    // Pivot preset buttons
    const pivotPresets = this.$$('.pivot-preset');
    pivotPresets.forEach((btn) => {
      btn.addEventListener('click', () => {
        const pivotData = (btn as HTMLButtonElement).dataset.pivot;
        if (!pivotData || !this.selectedObjectId) return;

        const [px, py] = pivotData.split(',').map(Number);
        const obj = this.objects.find(o => o.id === this.selectedObjectId);
        if (obj) {
          obj.transform.pivotX = px;
          obj.transform.pivotY = py;
          this.hasUnsavedChanges = true;
          this.updatePropertiesPanel();
          this.renderScene();
        }
      });
    });

    // Pivot X input
    const pivotXInput = this.$('.pivot-x') as HTMLInputElement;
    if (pivotXInput) {
      pivotXInput.addEventListener('change', () => {
        if (!this.selectedObjectId) return;
        const obj = this.objects.find(o => o.id === this.selectedObjectId);
        if (obj) {
          obj.transform.pivotX = Math.max(0, Math.min(1, parseFloat(pivotXInput.value) || 0.5));
          this.hasUnsavedChanges = true;
          this.renderScene();
        }
      });
    }

    // Pivot Y input
    const pivotYInput = this.$('.pivot-y') as HTMLInputElement;
    if (pivotYInput) {
      pivotYInput.addEventListener('change', () => {
        if (!this.selectedObjectId) return;
        const obj = this.objects.find(o => o.id === this.selectedObjectId);
        if (obj) {
          obj.transform.pivotY = Math.max(0, Math.min(1, parseFloat(pivotYInput.value) || 0.5));
          this.hasUnsavedChanges = true;
          this.renderScene();
        }
      });
    }
  }

  private handleMouseDown(e: MouseEvent): void {
    if (!this.sceneCanvas) return;

    const rect = this.sceneCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Find clicked object (reverse order for top-most first)
    let clickedObject: SceneObject | null = null;
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const obj = this.objects[i];
      if (this.isPointInObject(x, y, obj)) {
        clickedObject = obj;
        break;
      }
    }

    if (clickedObject && !clickedObject.locked) {
      this.selectedObjectId = clickedObject.id;
      this.isDragging = true;
      this.dragStart = { x: x - clickedObject.transform.x, y: y - clickedObject.transform.y };
    } else {
      this.selectedObjectId = null;
    }

    this.updatePropertiesPanel();
    this.updateHierarchy();
    this.updateStatusBar();
    this.renderScene();
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isDragging || !this.selectedObjectId || !this.sceneCanvas) return;

    const rect = this.sceneCanvas.getBoundingClientRect();
    let x = e.clientX - rect.left - this.dragStart.x;
    let y = e.clientY - rect.top - this.dragStart.y;

    // Snap to grid
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
  }

  private isPointInObject(x: number, y: number, obj: SceneObject): boolean {
    // Get object dimensions
    const dims = this.getObjectDimensions(obj);

    // Get pivot offset
    const pivotX = obj.transform.pivotX ?? 0.5;
    const pivotY = obj.transform.pivotY ?? 0.5;
    const pivotOffsetX = dims.width * pivotX;
    const pivotOffsetY = dims.height * pivotY;

    // Transform point into object's local coordinate space
    // Reverse the transformation: translate -> rotate -> scale -> translate(-pivot)

    // 1. Translate point relative to object position
    let localX = x - obj.transform.x;
    let localY = y - obj.transform.y;

    // 2. Reverse rotation
    const angle = -(obj.transform.rotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotatedX = localX * cos - localY * sin;
    const rotatedY = localX * sin + localY * cos;
    localX = rotatedX;
    localY = rotatedY;

    // 3. Reverse scale (guard against division by zero)
    const scaleX = obj.transform.scaleX || 0.001;
    const scaleY = obj.transform.scaleY || 0.001;
    localX /= scaleX;
    localY /= scaleY;

    // 4. Add pivot offset (reverse the -pivotOffset translation)
    localX += pivotOffsetX;
    localY += pivotOffsetY;

    // Check if point is within local bounding box
    return localX >= 0 && localX <= dims.width &&
           localY >= 0 && localY <= dims.height;
  }

  private addSprite(): void {
    const obj: SceneObject = {
      id: `sprite-${Date.now()}`,
      name: `Sprite ${this.objects.length + 1}`,
      type: 'sprite',
      visible: true,
      locked: false,
      transform: { x: 100, y: 100, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0.5, pivotY: 0.5 },
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

    const obj: SceneObject = {
      id: `shape-${Date.now()}`,
      name: `${shapeType.charAt(0).toUpperCase() + shapeType.slice(1)} ${this.objects.length + 1}`,
      type: 'shape',
      shapeType,
      visible: true,
      locked: false,
      transform: { x: 150, y: 150, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0.5, pivotY: 0.5 },
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
    const obj: SceneObject = {
      id: `text-${Date.now()}`,
      name: `Text ${this.objects.length + 1}`,
      type: 'text',
      visible: true,
      locked: false,
      transform: { x: 200, y: 200, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0.5, pivotY: 0.5 },
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

  private getObjectDimensions(obj: SceneObject): { width: number; height: number } {
    switch (obj.type) {
      case 'sprite':
        return { width: 100, height: 100 };
      case 'shape':
        if (obj.shapeType === 'rectangle') {
          return { width: 100, height: 80 };
        } else if (obj.shapeType === 'circle') {
          return { width: 100, height: 100 };
        }
        return { width: 100, height: 100 };
      case 'text':
        const fontSize = obj.fontSize || 24;
        const textLength = (obj.text || 'Text').length;
        return { width: textLength * fontSize * 0.6, height: fontSize * 1.2 };
      default:
        return { width: 100, height: 100 };
    }
  }

  private renderScene(): void {
    if (!this.ctx || !this.sceneCanvas) return;

    const { width, height } = this.sceneCanvas;

    // Clear canvas
    this.ctx.fillStyle = '#f0f0f0';
    this.ctx.fillRect(0, 0, width, height);

    // Draw grid
    if (this.showGrid) {
      this.ctx.strokeStyle = '#ddd';
      this.ctx.lineWidth = 1;

      for (let x = 0; x <= width; x += this.gridSize) {
        this.ctx.beginPath();
        this.ctx.moveTo(x, 0);
        this.ctx.lineTo(x, height);
        this.ctx.stroke();
      }

      for (let y = 0; y <= height; y += this.gridSize) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, y);
        this.ctx.lineTo(width, y);
        this.ctx.stroke();
      }
    }

    // Draw objects
    for (const obj of this.objects) {
      if (!obj.visible) continue;

      const dims = this.getObjectDimensions(obj);
      const pivotX = obj.transform.pivotX ?? 0.5;
      const pivotY = obj.transform.pivotY ?? 0.5;
      const pivotOffsetX = dims.width * pivotX;
      const pivotOffsetY = dims.height * pivotY;

      this.ctx.save();
      this.ctx.globalAlpha = obj.opacity;

      // Apply pivot-aware transformation:
      // 1. Translate to object position
      // 2. Move to pivot point
      // 3. Apply rotation and scale around pivot
      // 4. Translate back to draw from top-left
      this.ctx.translate(obj.transform.x, obj.transform.y);
      this.ctx.rotate((obj.transform.rotation * Math.PI) / 180);
      this.ctx.scale(obj.transform.scaleX, obj.transform.scaleY);
      this.ctx.translate(-pivotOffsetX, -pivotOffsetY);

      switch (obj.type) {
        case 'sprite':
          this.ctx.fillStyle = obj.color || '#4a90d9';
          this.ctx.fillRect(0, 0, 100, 100);
          // Sprite icon
          this.ctx.fillStyle = 'white';
          this.ctx.font = '40px Arial';
          this.ctx.textAlign = 'center';
          this.ctx.textBaseline = 'middle';
          this.ctx.fillText('🖼', 50, 50);
          break;

        case 'shape':
          this.ctx.fillStyle = obj.color || '#e74c3c';
          if (obj.shapeType === 'rectangle') {
            this.ctx.fillRect(0, 0, 100, 80);
          } else if (obj.shapeType === 'circle') {
            this.ctx.beginPath();
            this.ctx.arc(50, 50, 50, 0, Math.PI * 2);
            this.ctx.fill();
          }
          break;

        case 'text':
          this.ctx.fillStyle = obj.color || '#333';
          this.ctx.font = `${obj.fontSize || 24}px ${obj.fontFamily || 'Arial'}`;
          this.ctx.textAlign = 'left';
          this.ctx.textBaseline = 'top';
          this.ctx.fillText(obj.text || 'Text', 0, 0);
          break;
      }

      this.ctx.restore();

      // Draw selection outline and pivot indicator
      if (obj.id === this.selectedObjectId) {
        this.drawSelectionOutline(obj, dims, pivotOffsetX, pivotOffsetY);
      }
    }
  }

  private drawSelectionOutline(
    obj: SceneObject,
    dims: { width: number; height: number },
    pivotOffsetX: number,
    pivotOffsetY: number
  ): void {
    if (!this.ctx) return;

    this.ctx.save();

    // Apply same transformation as object
    this.ctx.translate(obj.transform.x, obj.transform.y);
    this.ctx.rotate((obj.transform.rotation * Math.PI) / 180);
    this.ctx.scale(obj.transform.scaleX, obj.transform.scaleY);
    this.ctx.translate(-pivotOffsetX, -pivotOffsetY);

    // Calculate scale factor for UI elements (prevent division by zero)
    const maxScale = Math.max(Math.abs(obj.transform.scaleX), Math.abs(obj.transform.scaleY), 0.001);

    // Draw selection rectangle
    this.ctx.strokeStyle = '#0066ff';
    this.ctx.lineWidth = 2 / maxScale;
    this.ctx.setLineDash([5, 5]);
    this.ctx.strokeRect(-2, -2, dims.width + 4, dims.height + 4);
    this.ctx.setLineDash([]);

    // Draw corner handles
    const handleSize = 8 / maxScale;
    this.ctx.fillStyle = '#0066ff';
    this.ctx.fillRect(-handleSize / 2, -handleSize / 2, handleSize, handleSize);
    this.ctx.fillRect(dims.width - handleSize / 2, -handleSize / 2, handleSize, handleSize);
    this.ctx.fillRect(-handleSize / 2, dims.height - handleSize / 2, handleSize, handleSize);
    this.ctx.fillRect(dims.width - handleSize / 2, dims.height - handleSize / 2, handleSize, handleSize);

    // Draw pivot point indicator
    this.ctx.translate(pivotOffsetX, pivotOffsetY);
    const pivotSize = 6 / maxScale;

    // Pivot crosshair
    this.ctx.strokeStyle = '#ff6600';
    this.ctx.lineWidth = 2 / maxScale;
    this.ctx.beginPath();
    this.ctx.moveTo(-pivotSize, 0);
    this.ctx.lineTo(pivotSize, 0);
    this.ctx.moveTo(0, -pivotSize);
    this.ctx.lineTo(0, pivotSize);
    this.ctx.stroke();

    // Pivot center circle
    this.ctx.fillStyle = '#ff6600';
    this.ctx.beginPath();
    this.ctx.arc(0, 0, pivotSize / 2, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.restore();
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

    // Update pivot inputs
    const pivotXInput = this.$('.pivot-x') as HTMLInputElement;
    const pivotYInput = this.$('.pivot-y') as HTMLInputElement;
    if (pivotXInput) pivotXInput.value = String(obj.transform.pivotX ?? 0.5);
    if (pivotYInput) pivotYInput.value = String(obj.transform.pivotY ?? 0.5);

    // Highlight active pivot preset (use approximate comparison for floating-point)
    const pivotPresets = this.$$('.pivot-preset');
    const currentPivotX = obj.transform.pivotX ?? 0.5;
    const currentPivotY = obj.transform.pivotY ?? 0.5;
    const EPSILON = 0.001;
    pivotPresets.forEach((btn) => {
      const pivotData = (btn as HTMLButtonElement).dataset.pivot;
      if (!pivotData) {
        btn.classList.remove('active');
        return;
      }
      const [presetX, presetY] = pivotData.split(',').map(Number);
      const isActive = Math.abs(presetX - currentPivotX) < EPSILON &&
                       Math.abs(presetY - currentPivotY) < EPSILON;
      btn.classList.toggle('active', isActive);
    });
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
