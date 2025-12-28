/**
 * Scene Editor Page
 * 2D scene composition editor with offline support
 * Multi-scene editing support (e.g., UI + game scene)
 * AI features require connectivity
 */

import { Page, type PageOptions } from '../base/Page';
import { Button, Spinner, toast, OfflineIndicator, TransformEditor, SceneTabs } from '../../components';
import type { Transform } from '../../components';
import { sessionsApi } from '../../lib/api';
import { offlineManager, isOffline } from '../../lib/offline';
import { offlineStorage } from '../../lib/offlineStorage';
import { Viewport } from '../../lib/viewport';
import { sceneStore } from '../../stores/sceneStore';
import type { Session } from '../../types';
import type { SceneObject, ShapeType, Scene } from '../../stores/sceneStore';
import './scene.css';

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
  private unsubscribeStore: (() => void) | null = null;
  private isOfflineMode = false;
  private transformEditor: TransformEditor | null = null;
  private sceneTabs: SceneTabs | null = null;

  // Scene state - now using sceneStore for multi-scene support
  private sceneCanvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private selectedObjectId: string | null = null;
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };

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

  // Helper methods to access active scene data
  private get activeScene(): Scene | null {
    return sceneStore.getActiveScene();
  }

  private get objects(): SceneObject[] {
    return this.activeScene?.objects || [];
  }

  private get showGrid(): boolean {
    return this.activeScene?.settings.showGrid ?? true;
  }

  private get gridSize(): number {
    return this.activeScene?.settings.gridSize ?? 32;
  }

  private get snapToGrid(): boolean {
    return this.activeScene?.settings.snapToGrid ?? true;
  }

  private get hasUnsavedChanges(): boolean {
    return sceneStore.hasUnsavedScenes();
  }

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

        <!-- Multi-scene tabs -->
        <div class="scene-tabs-container-wrapper"></div>

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
            <button class="toolbar-btn" data-action="toggle-grid" title="Toggle Grid">⊞</button>
            <button class="toolbar-btn" data-action="toggle-snap" title="Toggle Snap">⊟</button>
            <button class="toolbar-btn" data-action="toggle-origin" title="Toggle Origin Crosshair">✛</button>
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
                  <div class="transform-editor-container"></div>
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
      const saveBtn = new Button('Save All Scenes', {
        variant: 'primary',
        size: 'sm',
        onClick: () => this.saveAllScenes(),
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

    // Setup scene tabs for multi-scene editing
    const sceneTabsContainer = this.$('.scene-tabs-container-wrapper') as HTMLElement;
    if (sceneTabsContainer) {
      this.sceneTabs = new SceneTabs({
        onSceneSelect: () => {
          this.selectedObjectId = null;
          this.updateHierarchy();
          this.updatePropertiesPanel();
          this.updateStatusBar();
          this.updateToolbarState();
          this.renderScene();
        },
        onSceneClose: () => {
          this.selectedObjectId = null;
          this.updateHierarchy();
          this.updatePropertiesPanel();
          this.updateStatusBar();
          this.renderScene();
        },
        onSceneCreate: () => {
          this.selectedObjectId = null;
          this.updateHierarchy();
          this.updatePropertiesPanel();
          this.updateStatusBar();
          this.renderScene();
        },
      });
      this.sceneTabs.mount(sceneTabsContainer);
    }

    // Subscribe to store changes
    this.unsubscribeStore = sceneStore.subscribe(() => {
      this.updateHierarchy();
      this.updateStatusBar();
      this.updateToolbarState();
      this.renderScene();
    });

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
        const activeScene = this.activeScene;
        if (!activeScene) return;
        sceneStore.updateSceneSettings(activeScene.id, { showGrid: !this.showGrid });
        toggleGridBtn.classList.toggle('active', this.showGrid);
        this.renderScene();
      });
    }

    if (toggleSnapBtn) {
      toggleSnapBtn.addEventListener('click', () => {
        const activeScene = this.activeScene;
        if (!activeScene) return;
        sceneStore.updateSceneSettings(activeScene.id, { snapToGrid: !this.snapToGrid });
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

  private setupPropertyHandlers(): void {
    // Pivot preset buttons
    const pivotPresets = this.$$('.pivot-preset');
    pivotPresets.forEach((btn) => {
      btn.addEventListener('click', () => {
        const activeScene = this.activeScene;
        const pivotData = (btn as HTMLButtonElement).dataset.pivot;
        if (!pivotData || !this.selectedObjectId || !activeScene) return;

        const [px, py] = pivotData.split(',').map(Number);
        const obj = this.objects.find(o => o.id === this.selectedObjectId);
        if (obj) {
          const updatedObjects = this.objects.map(o =>
            o.id === this.selectedObjectId
              ? { ...o, transform: { ...o.transform, pivotX: px, pivotY: py } }
              : o
          );
          sceneStore.updateSceneObjects(activeScene.id, updatedObjects);
          this.updatePropertiesPanel();
          this.renderScene();
        }
      });
    });

    // Pivot X input
    const pivotXInput = this.$('.pivot-x') as HTMLInputElement;
    if (pivotXInput) {
      pivotXInput.addEventListener('change', () => {
        const activeScene = this.activeScene;
        if (!this.selectedObjectId || !activeScene) return;
        const obj = this.objects.find(o => o.id === this.selectedObjectId);
        if (obj) {
          const pivotX = Math.max(0, Math.min(1, parseFloat(pivotXInput.value) || 0.5));
          const updatedObjects = this.objects.map(o =>
            o.id === this.selectedObjectId
              ? { ...o, transform: { ...o.transform, pivotX } }
              : o
          );
          sceneStore.updateSceneObjects(activeScene.id, updatedObjects);
          this.renderScene();
        }
      });
    }

    // Pivot Y input
    const pivotYInput = this.$('.pivot-y') as HTMLInputElement;
    if (pivotYInput) {
      pivotYInput.addEventListener('change', () => {
        const activeScene = this.activeScene;
        if (!this.selectedObjectId || !activeScene) return;
        const obj = this.objects.find(o => o.id === this.selectedObjectId);
        if (obj) {
          const pivotY = Math.max(0, Math.min(1, parseFloat(pivotYInput.value) || 0.5));
          const updatedObjects = this.objects.map(o =>
            o.id === this.selectedObjectId
              ? { ...o, transform: { ...o.transform, pivotY } }
              : o
          );
          sceneStore.updateSceneObjects(activeScene.id, updatedObjects);
          this.renderScene();
        }
      });
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

    const activeScene = this.activeScene;
    if (!activeScene) return;

    const obj = this.objects.find(o => o.id === this.selectedObjectId);
    if (obj) {
      const updatedObjects = this.objects.map(o =>
        o.id === this.selectedObjectId
          ? { ...o, transform: { ...o.transform, x, y } }
          : o
      );
      sceneStore.updateSceneObjects(activeScene.id, updatedObjects);
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
    const activeScene = this.activeScene;
    if (!activeScene) {
      toast.error('Please create or open a scene first');
      return;
    }

    // Place new objects near origin (0, 0) in center-origin coordinates
    const offset = this.objects.length * 20; // Offset each new object slightly
    const obj: SceneObject = {
      id: `sprite-${Date.now()}`,
      name: `Sprite ${this.objects.length + 1}`,
      type: 'sprite',
      visible: true,
      locked: false,
      transform: { x: -50 + offset, y: -50 + offset, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0.5, pivotY: 0.5 },
      zIndex: this.objects.length,
      opacity: 1,
      color: '#4a90d9',
    };
    sceneStore.updateSceneObjects(activeScene.id, [...this.objects, obj]);
    this.selectedObjectId = obj.id;
    this.updateHierarchy();
    this.updatePropertiesPanel();
    this.updateStatusBar();
    this.renderScene();
  }

  private addShape(shapeType: ShapeType): void {
    const activeScene = this.activeScene;
    if (!activeScene) {
      toast.error('Please create or open a scene first');
      return;
    }

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
      transform: { x: -50 + offset, y: -40 + offset, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0.5, pivotY: 0.5 },
      zIndex: this.objects.length,
      opacity: 1,
      color: colors[shapeType],
    };
    sceneStore.updateSceneObjects(activeScene.id, [...this.objects, obj]);
    this.selectedObjectId = obj.id;
    this.updateHierarchy();
    this.updatePropertiesPanel();
    this.updateStatusBar();
    this.renderScene();
  }

  private addText(): void {
    const activeScene = this.activeScene;
    if (!activeScene) {
      toast.error('Please create or open a scene first');
      return;
    }

    // Place new objects near origin (0, 0) in center-origin coordinates
    const offset = this.objects.length * 20;
    const obj: SceneObject = {
      id: `text-${Date.now()}`,
      name: `Text ${this.objects.length + 1}`,
      type: 'text',
      visible: true,
      locked: false,
      transform: { x: -50 + offset, y: offset, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0.5, pivotY: 0.5 },
      zIndex: this.objects.length,
      opacity: 1,
      text: 'Sample Text',
      fontSize: 24,
      fontFamily: 'Arial',
      color: '#333333',
    };
    sceneStore.updateSceneObjects(activeScene.id, [...this.objects, obj]);
    this.selectedObjectId = obj.id;
    this.updateHierarchy();
    this.updatePropertiesPanel();
    this.updateStatusBar();
    this.renderScene();
  }

  private moveSelectedUp(): void {
    const activeScene = this.activeScene;
    if (!this.selectedObjectId || !activeScene) return;

    const objects = [...this.objects];
    const idx = objects.findIndex(o => o.id === this.selectedObjectId);
    if (idx > 0) {
      [objects[idx - 1], objects[idx]] = [objects[idx], objects[idx - 1]];
      sceneStore.updateSceneObjects(activeScene.id, objects);
      this.updateHierarchy();
      this.renderScene();
    }
  }

  private moveSelectedDown(): void {
    const activeScene = this.activeScene;
    if (!this.selectedObjectId || !activeScene) return;

    const objects = [...this.objects];
    const idx = objects.findIndex(o => o.id === this.selectedObjectId);
    if (idx < objects.length - 1) {
      [objects[idx], objects[idx + 1]] = [objects[idx + 1], objects[idx]];
      sceneStore.updateSceneObjects(activeScene.id, objects);
      this.updateHierarchy();
      this.renderScene();
    }
  }

  private deleteSelected(): void {
    const activeScene = this.activeScene;
    if (!this.selectedObjectId || !activeScene) return;
    if (!confirm('Delete selected object?')) return;

    const newObjects = this.objects.filter(o => o.id !== this.selectedObjectId);
    sceneStore.updateSceneObjects(activeScene.id, newObjects);
    this.selectedObjectId = null;
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

      // Draw selection outline and pivot indicator
      if (obj.id === this.selectedObjectId) {
        this.drawPivotSelectionOutline(obj, dims, pivotOffsetX, pivotOffsetY);
      }
    }

    this.ctx.restore();
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

  private drawPivotSelectionOutline(
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
    const opacitySlider = this.$('.opacity-slider') as HTMLInputElement;
    const sliderValue = this.$('.slider-value') as HTMLElement;
    const visibleCheckbox = this.$('.visible-checkbox') as HTMLInputElement;
    const lockedCheckbox = this.$('.locked-checkbox') as HTMLInputElement;

    if (nameInput) nameInput.value = obj.name;
    if (opacitySlider) opacitySlider.value = String(obj.opacity * 100);
    if (sliderValue) sliderValue.textContent = `${Math.round(obj.opacity * 100)}%`;
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

    // Update or create TransformEditor
    this.updateTransformEditor(obj);
  }

  private updateTransformEditor(obj: SceneObject): void {
    const container = this.$('.transform-editor-container') as HTMLElement;
    if (!container) return;

    // Reuse existing editor if it exists, otherwise create a new one
    if (this.transformEditor) {
      // Update existing editor without triggering onChange callback
      this.transformEditor.updateTransformSilently(obj.transform);
    } else {
      // Create new transform editor
      this.transformEditor = new TransformEditor({
        transform: obj.transform,
        linkScale: true,
        showPosition: true,
        showRotation: true,
        showScale: true,
        compact: true,
        showLabels: false,
        onChange: (transform: Transform) => {
          this.handleTransformChange(transform);
        },
      });
      this.transformEditor.mount(container);
    }
  }

  private handleTransformChange(transform: Transform): void {
    const activeScene = this.activeScene;
    if (!this.selectedObjectId || !activeScene) return;

    const obj = this.objects.find(o => o.id === this.selectedObjectId);
    if (!obj) return;

    // Apply snapping if enabled
    let x = transform.x;
    let y = transform.y;

    if (this.snapToGrid) {
      x = Math.round(x / this.gridSize) * this.gridSize;
      y = Math.round(y / this.gridSize) * this.gridSize;
    }

    // Preserve pivot values when updating transform
    const updatedTransform = {
      x,
      y,
      rotation: transform.rotation,
      scaleX: transform.scaleX,
      scaleY: transform.scaleY,
      pivotX: obj.transform.pivotX ?? 0.5,
      pivotY: obj.transform.pivotY ?? 0.5,
    };

    const updatedObjects = this.objects.map(o =>
      o.id === this.selectedObjectId
        ? { ...o, transform: updatedTransform }
        : o
    );
    sceneStore.updateSceneObjects(activeScene.id, updatedObjects);
    this.renderScene();
  }

  private updateStatusBar(): void {
    const objectsStatus = this.$('.status-objects') as HTMLElement;
    const selectionStatus = this.$('.status-selection') as HTMLElement;
    const sceneInfo = this.$('.scene-subtitle') as HTMLElement;

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

    // Update scene count in subtitle if scenes are open
    const openScenes = sceneStore.getOpenScenes();
    if (sceneInfo && openScenes.length > 0) {
      const activeScene = this.activeScene;
      const sceneLabel = activeScene ? `Scene: ${activeScene.name}` : '';
      const countLabel = openScenes.length > 1 ? ` (${openScenes.length} scenes open)` : '';
      sceneInfo.textContent = sceneLabel + countLabel;
    }
  }

  private updateToolbarState(): void {
    const toggleGridBtn = this.$('[data-action="toggle-grid"]');
    const toggleSnapBtn = this.$('[data-action="toggle-snap"]');
    const toggleOriginBtn = this.$('[data-action="toggle-origin"]');

    if (toggleGridBtn) {
      toggleGridBtn.classList.toggle('active', this.showGrid);
    }
    if (toggleSnapBtn) {
      toggleSnapBtn.classList.toggle('active', this.snapToGrid);
    }
    if (toggleOriginBtn) {
      toggleOriginBtn.classList.toggle('active', this.showOriginCrosshair);
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
          await this.loadSavedScenes();
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
      await this.loadSavedScenes();
      this.showCanvas();
      this.renderScene();
    } catch (error) {
      const cachedSession = await offlineStorage.getCachedSession(sessionId);
      if (cachedSession) {
        this.session = cachedSession as unknown as Session;
        this.isOfflineMode = true;
        this.updateHeader();
        this.updateOfflineUI();
        await this.loadSavedScenes();
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

  private async loadSavedScenes(): Promise<void> {
    const sessionPath = this.getSessionPath();
    if (!sessionPath) return;

    try {
      const cachedFile = await offlineStorage.getCachedFile(sessionPath, 'scenes.json');
      if (cachedFile && cachedFile.content) {
        const scenesData = JSON.parse(cachedFile.content as string);

        if (scenesData.scenes && Array.isArray(scenesData.scenes)) {
          // Load scenes into store
          const scenes = scenesData.scenes.map((sceneData: Record<string, unknown>) => ({
            id: sceneData.id as string,
            name: sceneData.name as string,
            objects: sceneData.objects || [],
            settings: sceneData.settings || { showGrid: true, gridSize: 32, snapToGrid: true },
            isDirty: false,
            createdAt: sceneData.createdAt as number || Date.now(),
            updatedAt: sceneData.updatedAt as number || Date.now(),
          }));

          sceneStore.loadScenes(scenes);

          // Open all loaded scenes and set active scene
          for (const scene of scenes) {
            sceneStore.openScene(scene.id);
          }

          // Restore active scene if saved
          if (scenesData.activeSceneId) {
            sceneStore.setActiveScene(scenesData.activeSceneId);
          }
        }
      }
    } catch (error) {
      // No saved scenes or failed to parse - that's okay, start fresh
      console.debug('No saved scenes found or failed to load:', error);
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

  private async saveAllScenes(): Promise<void> {
    if (this.isSaving) return;

    this.isSaving = true;

    try {
      const openScenes = sceneStore.getOpenScenes();
      const sessionPath = this.getSessionPath();

      // Save all scenes data
      const scenesData = {
        scenes: openScenes.map(scene => ({
          id: scene.id,
          name: scene.name,
          objects: scene.objects,
          settings: scene.settings,
          createdAt: scene.createdAt,
          updatedAt: scene.updatedAt,
        })),
        activeSceneId: sceneStore.getState().activeSceneId,
      };

      const filePath = 'scenes.json';
      const content = JSON.stringify(scenesData, null, 2);

      if (this.isOfflineMode || isOffline()) {
        await offlineStorage.saveFileLocally(sessionPath, filePath, content, 'text');
        toast.success(`${openScenes.length} scene(s) saved locally (will sync when online)`);
      } else {
        await offlineStorage.cacheFile(sessionPath, filePath, content, 'text');
        toast.success(`${openScenes.length} scene(s) saved`);
      }

      // Mark all scenes as saved
      sceneStore.saveAllScenes();
    } catch (error) {
      console.error('Failed to save scenes:', error);
      toast.error('Failed to save scenes');
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

    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }

    if (this.offlineIndicator) {
      this.offlineIndicator.unmount();
      this.offlineIndicator = null;
    }

    if (this.transformEditor) {
      this.transformEditor.unmount();
      this.transformEditor = null;
    }

    if (this.sceneTabs) {
      this.sceneTabs.unmount();
      this.sceneTabs = null;
    }
  }
}
