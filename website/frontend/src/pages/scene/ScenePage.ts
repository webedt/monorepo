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
import { SpriteRenderer } from '../../lib/sprite';
import { Viewport } from '../../lib/viewport';
import { sceneStore } from '../../stores/sceneStore';
import { customComponentsStore } from '../../stores';
import type {
  Session,
  CustomComponentDefinition,
  CustomComponentChild,
  CustomComponentPropertyValues,
} from '../../types';
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
  private isOfflineMode = false;
  private transformEditor: TransformEditor | null = null;
  private sceneTabs: SceneTabs | null = null;

  // Scene state - now using sceneStore for multi-scene support
  private sceneCanvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private selectedObjectId: string | null = null;
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };

  // Sprite renderer for displaying images
  private spriteRenderer: SpriteRenderer = new SpriteRenderer();

  // Viewport with center-origin coordinate system
  private viewport: Viewport | null = null;
  private isPanning = false;
  private panStart = { x: 0, y: 0 };
  private showOriginCrosshair = true;
  private mouseWorldPos = { x: 0, y: 0 };

  // Custom components library
  private showComponentsLibrary = false;
  private componentIdCounter = 0;
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Event listener references for cleanup
  private boundHandleMouseDown: ((e: MouseEvent) => void) | null = null;
  private boundHandleMouseMove: ((e: MouseEvent) => void) | null = null;
  private boundHandleMouseUp: (() => void) | null = null;
  private boundHandleWheel: ((e: WheelEvent) => void) | null = null;

  // Store subscriptions
  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeComponents: (() => void) | null = null;

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

  private markDirty(): void {
    const scene = this.activeScene;
    if (scene) {
      sceneStore.markSceneDirty(scene.id);
    }
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

          <div class="toolbar-group ui-group">
            <span class="toolbar-label">UI:</span>
            <button class="toolbar-btn" data-action="add-ui-button" title="Add UI Button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="18" height="8" rx="2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            </button>
            <button class="toolbar-btn" data-action="add-ui-panel" title="Add UI Panel">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
            </button>
            <button class="toolbar-btn" data-action="add-ui-text" title="Add UI Text">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>
            </button>
            <button class="toolbar-btn" data-action="add-ui-image" title="Add UI Image">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
            </button>
            <button class="toolbar-btn" data-action="add-ui-slider" title="Add UI Slider">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="12" x2="20" y2="12"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button class="toolbar-btn" data-action="add-ui-progress" title="Add Progress Bar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="10" width="12" height="4" rx="1" fill="currentColor"/></svg>
            </button>
            <button class="toolbar-btn" data-action="add-ui-checkbox" title="Add UI Checkbox">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="9 11 12 14 16 10"/></svg>
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

          <div class="toolbar-separator"></div>

          <div class="toolbar-group mode-toggle-group">
            <button class="toolbar-btn mode-toggle-btn" data-action="toggle-mode" title="Toggle Edit/Play Mode">
              <svg class="play-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <svg class="stop-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="display: none;"><rect x="6" y="6" width="12" height="12"/></svg>
              <span class="mode-label">Play</span>
            </button>
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

                <div class="property-section ui-properties" style="display: none;">
                  <div class="property-label">UI Properties</div>
                  <div class="ui-properties-grid">
                    <div class="ui-prop-row ui-size-row">
                      <label>Width</label>
                      <input type="number" class="property-input ui-width" min="10" step="1">
                      <label>Height</label>
                      <input type="number" class="property-input ui-height" min="10" step="1">
                    </div>
                    <div class="ui-prop-row ui-value-row" style="display: none;">
                      <label>Value</label>
                      <input type="range" class="property-slider ui-value-slider" min="0" max="100" value="50">
                      <span class="ui-value-display">50</span>
                    </div>
                    <div class="ui-prop-row ui-checked-row" style="display: none;">
                      <label>Checked</label>
                      <input type="checkbox" class="property-checkbox ui-checked">
                    </div>
                    <div class="ui-prop-row ui-text-row" style="display: none;">
                      <label>Text</label>
                      <input type="text" class="property-input ui-text" placeholder="Button text">
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

    // UI Component buttons
    const addUIButtonBtn = this.$('[data-action="add-ui-button"]');
    const addUIPanelBtn = this.$('[data-action="add-ui-panel"]');
    const addUITextBtn = this.$('[data-action="add-ui-text"]');
    const addUIImageBtn = this.$('[data-action="add-ui-image"]');
    const addUISliderBtn = this.$('[data-action="add-ui-slider"]');
    const addUIProgressBtn = this.$('[data-action="add-ui-progress"]');
    const addUICheckboxBtn = this.$('[data-action="add-ui-checkbox"]');

    if (addUIButtonBtn) addUIButtonBtn.addEventListener('click', () => this.addUIButton());
    if (addUIPanelBtn) addUIPanelBtn.addEventListener('click', () => this.addUIPanel());
    if (addUITextBtn) addUITextBtn.addEventListener('click', () => this.addUIText());
    if (addUIImageBtn) addUIImageBtn.addEventListener('click', () => this.addUIImage());
    if (addUISliderBtn) addUISliderBtn.addEventListener('click', () => this.addUISlider());
    if (addUIProgressBtn) addUIProgressBtn.addEventListener('click', () => this.addUIProgressBar());
    if (addUICheckboxBtn) addUICheckboxBtn.addEventListener('click', () => this.addUICheckbox());

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

    // Mode toggle (Edit/Play)
    const toggleModeBtn = this.$('[data-action="toggle-mode"]');
    if (toggleModeBtn) {
      toggleModeBtn.addEventListener('click', () => this.toggleEditorMode());
    }

    // Custom components library
    const toggleComponentsBtn = this.$('[data-action="toggle-components"]');
    if (toggleComponentsBtn) {
      toggleComponentsBtn.addEventListener('click', () => this.toggleComponentsLibrary());
    }

    const closeComponentsBtn = this.$('.close-panel-btn');
    if (closeComponentsBtn) {
      closeComponentsBtn.addEventListener('click', () => this.toggleComponentsLibrary(false));
    }

    const saveAsComponentBtn = this.$('[data-action="save-as-component"]');
    if (saveAsComponentBtn) {
      saveAsComponentBtn.addEventListener('click', () => this.saveSelectionAsComponent());
    }

    // Components library search
    const searchInput = this.$('.components-search-input') as HTMLInputElement;
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = setTimeout(() => {
          this.updateComponentsLibrary(searchInput.value.trim());
        }, 300);
      });
    }

    // Category buttons
    const componentsPanel = this.$('.components-library-panel');
    if (componentsPanel) {
      const categoryBtns = componentsPanel.querySelectorAll('.category-btn');
      categoryBtns.forEach((btn: Element) => {
        btn.addEventListener('click', () => {
          categoryBtns.forEach((b: Element) => b.classList.remove('active'));
          btn.classList.add('active');
          const category = (btn as HTMLElement).dataset.category || 'all';
          this.filterComponentsByCategory(category);
        });
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

    // UI Property handlers
    const uiWidthInput = this.$('.ui-width') as HTMLInputElement;
    const uiHeightInput = this.$('.ui-height') as HTMLInputElement;
    const uiValueSlider = this.$('.ui-value-slider') as HTMLInputElement;
    const uiCheckedInput = this.$('.ui-checked') as HTMLInputElement;
    const uiTextInput = this.$('.ui-text') as HTMLInputElement;

    if (uiWidthInput) {
      uiWidthInput.addEventListener('change', () => {
        if (!this.selectedObjectId) return;
        const obj = this.objects.find(o => o.id === this.selectedObjectId);
        if (obj) {
          obj.uiWidth = Math.max(10, parseInt(uiWidthInput.value) || 100);
          this.markDirty();
          this.renderScene();
        }
      });
    }

    if (uiHeightInput) {
      uiHeightInput.addEventListener('change', () => {
        if (!this.selectedObjectId) return;
        const obj = this.objects.find(o => o.id === this.selectedObjectId);
        if (obj) {
          obj.uiHeight = Math.max(10, parseInt(uiHeightInput.value) || 40);
          this.markDirty();
          this.renderScene();
        }
      });
    }

    if (uiValueSlider) {
      uiValueSlider.addEventListener('input', () => {
        if (!this.selectedObjectId) return;
        const obj = this.objects.find(o => o.id === this.selectedObjectId);
        if (obj) {
          obj.uiValue = parseInt(uiValueSlider.value) || 0;
          const display = this.$('.ui-value-display') as HTMLElement;
          if (display) display.textContent = String(obj.uiValue);
          this.markDirty();
          this.renderScene();
        }
      });
    }

    if (uiCheckedInput) {
      uiCheckedInput.addEventListener('change', () => {
        if (!this.selectedObjectId) return;
        const obj = this.objects.find(o => o.id === this.selectedObjectId);
        if (obj) {
          obj.uiChecked = uiCheckedInput.checked;
          this.markDirty();
          this.renderScene();
        }
      });
    }

    if (uiTextInput) {
      uiTextInput.addEventListener('input', () => {
        if (!this.selectedObjectId) return;
        const obj = this.objects.find(o => o.id === this.selectedObjectId);
        if (obj) {
          obj.text = uiTextInput.value;
          this.markDirty();
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
    // Show dialog to get sprite URL
    this.showSpriteDialog();
  }

  /**
   * Create the HTML content for the sprite dialog
   */
  private createSpriteDialogHTML(): string {
    return `
      <div class="sprite-dialog">
        <div class="sprite-dialog-header">
          <h3>Add Sprite</h3>
          <button class="sprite-dialog-close">&times;</button>
        </div>
        <div class="sprite-dialog-content">
          <div class="sprite-dialog-tabs">
            <button class="sprite-tab active" data-tab="url">URL</button>
            <button class="sprite-tab" data-tab="file">File</button>
          </div>
          <div class="sprite-tab-content" data-content="url">
            <label for="sprite-url">Image URL</label>
            <input type="url" id="sprite-url" class="sprite-dialog-input" placeholder="https://example.com/image.png">
            <p class="sprite-dialog-hint">Enter a URL to an image (PNG, JPG, GIF, WebP, SVG)</p>
          </div>
          <div class="sprite-tab-content" data-content="file" style="display: none;">
            <label for="sprite-file">Select Image</label>
            <input type="file" id="sprite-file" class="sprite-dialog-file" accept="image/*">
            <div class="sprite-drop-zone">
              <p>Drop image here or click to browse</p>
            </div>
          </div>
          <div class="sprite-preview-container" style="display: none;">
            <label>Preview</label>
            <div class="sprite-preview"></div>
          </div>
        </div>
        <div class="sprite-dialog-footer">
          <button class="sprite-dialog-btn sprite-dialog-cancel">Cancel</button>
          <button class="sprite-dialog-btn sprite-dialog-add" disabled>Add Sprite</button>
        </div>
      </div>
    `;
  }

  /**
   * Update the preview element with an image URL (safe, no XSS)
   */
  private updateSpritePreview(
    preview: HTMLElement,
    previewContainer: HTMLElement,
    addBtn: HTMLButtonElement,
    url: string
  ): void {
    if (url) {
      previewContainer.style.display = 'block';
      while (preview.firstChild) {
        preview.removeChild(preview.firstChild);
      }
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Preview';
      img.style.maxWidth = '200px';
      img.style.maxHeight = '150px';
      preview.appendChild(img);
      addBtn.disabled = false;
    } else {
      previewContainer.style.display = 'none';
      while (preview.firstChild) {
        preview.removeChild(preview.firstChild);
      }
      addBtn.disabled = true;
    }
  }

  /**
   * Create a sprite object from a loaded image URL
   */
  private async createSpriteFromUrl(url: string): Promise<void> {
    const activeScene = this.activeScene;
    if (!activeScene) {
      toast.error('Please create or open a scene first');
      return;
    }

    const id = `sprite-${Date.now()}`;

    try {
      await this.spriteRenderer.load(id, url);
      const info = this.spriteRenderer.getInfo(id);

      // Place new objects near origin (0, 0) in center-origin coordinates
      const offset = this.objects.length * 20;
      const obj: SceneObject = {
        id,
        name: `Sprite ${this.objects.length + 1}`,
        type: 'sprite',
        visible: true,
        locked: false,
        transform: { x: -50 + offset, y: -50 + offset, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0.5, pivotY: 0.5 },
        zIndex: this.objects.length,
        opacity: 1,
        spriteUrl: url,
        spriteWidth: info?.width ?? 100,
        spriteHeight: info?.height ?? 100,
      };

      sceneStore.updateSceneObjects(activeScene.id, [...this.objects, obj]);
      this.selectedObjectId = obj.id;
      this.updateHierarchy();
      this.updatePropertiesPanel();
      this.updateStatusBar();
      this.renderScene();

      toast.success('Sprite added successfully');
    } catch (error) {
      console.error('Failed to load sprite:', error);
      toast.error('Failed to load sprite image');
    }
  }

  /**
   * Convert a File to a data URL
   */
  private fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  private showSpriteDialog(): void {
    const overlay = document.createElement('div');
    overlay.className = 'sprite-dialog-overlay';
    overlay.innerHTML = this.createSpriteDialogHTML();
    document.body.appendChild(overlay);

    // Get elements
    const closeBtn = overlay.querySelector('.sprite-dialog-close') as HTMLButtonElement;
    const cancelBtn = overlay.querySelector('.sprite-dialog-cancel') as HTMLButtonElement;
    const addBtn = overlay.querySelector('.sprite-dialog-add') as HTMLButtonElement;
    const urlInput = overlay.querySelector('#sprite-url') as HTMLInputElement;
    const fileInput = overlay.querySelector('#sprite-file') as HTMLInputElement;
    const dropZone = overlay.querySelector('.sprite-drop-zone') as HTMLElement;
    const previewContainer = overlay.querySelector('.sprite-preview-container') as HTMLElement;
    const preview = overlay.querySelector('.sprite-preview') as HTMLElement;
    const tabs = overlay.querySelectorAll('.sprite-tab');
    const tabContents = overlay.querySelectorAll('.sprite-tab-content');

    let selectedUrl = '';
    let selectedFile: File | null = null;

    const closeDialog = () => document.body.removeChild(overlay);

    const updatePreview = (url: string) => {
      this.updateSpritePreview(preview, previewContainer, addBtn, url);
    };

    const handleFile = (file: File) => {
      if (!file.type.startsWith('image/')) {
        toast.error('Please select an image file');
        return;
      }
      selectedFile = file;
      selectedUrl = '';
      this.fileToDataUrl(file).then(updatePreview);
    };

    // Close handlers
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDialog();
    });
    closeBtn.addEventListener('click', closeDialog);
    cancelBtn.addEventListener('click', closeDialog);

    // Tab switching
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = (tab as HTMLElement).dataset.tab;
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        tabContents.forEach(content => {
          (content as HTMLElement).style.display =
            (content as HTMLElement).dataset.content === tabName ? 'block' : 'none';
        });
      });
    });

    // URL input handler
    urlInput.addEventListener('input', () => {
      selectedUrl = urlInput.value.trim();
      selectedFile = null;
      const isValidUrl = selectedUrl && (
        selectedUrl.startsWith('http://') ||
        selectedUrl.startsWith('https://') ||
        selectedUrl.startsWith('data:')
      );
      updatePreview(isValidUrl ? selectedUrl : '');
    });

    // File input handler
    fileInput.addEventListener('change', () => {
      if (fileInput.files?.[0]) handleFile(fileInput.files[0]);
    });

    // Drop zone handlers
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer?.files?.[0]) handleFile(e.dataTransfer.files[0]);
    });

    // Add sprite handler
    addBtn.addEventListener('click', async () => {
      let url = selectedUrl;
      if (selectedFile) {
        url = await this.fileToDataUrl(selectedFile);
      }
      if (!url) {
        toast.error('Please provide an image URL or file');
        return;
      }
      closeDialog();
      await this.createSpriteFromUrl(url);
    });

    urlInput.focus();
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

  // UI Component factory methods
  private addUIButton(): void {
    const offset = this.objects.length * 20;
    const obj: SceneObject = {
      id: `ui-button-${Date.now()}`,
      name: `Button ${this.objects.length + 1}`,
      type: 'ui-button',
      visible: true,
      locked: false,
      transform: { x: -60 + offset, y: -20 + offset, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0.5, pivotY: 0.5 },
      zIndex: this.objects.length,
      opacity: 1,
      text: 'Button',
      uiButtonStyle: 'primary',
      uiWidth: 120,
      uiHeight: 40,
      uiCornerRadius: 6,
      uiBackgroundColor: '#3b82f6',
      uiTextColor: '#ffffff',
      fontSize: 14,
      fontFamily: 'Arial',
    };
    this.objects.push(obj);
    this.selectedObjectId = obj.id;
    this.markDirty();
    this.updateHierarchy();
    this.updatePropertiesPanel();
    this.updateStatusBar();
    this.renderScene();
  }

  private addUIPanel(): void {
    const offset = this.objects.length * 20;
    const obj: SceneObject = {
      id: `ui-panel-${Date.now()}`,
      name: `Panel ${this.objects.length + 1}`,
      type: 'ui-panel',
      visible: true,
      locked: false,
      transform: { x: -100 + offset, y: -75 + offset, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0.5, pivotY: 0.5 },
      zIndex: this.objects.length,
      opacity: 1,
      uiPanelStyle: 'solid',
      uiWidth: 200,
      uiHeight: 150,
      uiCornerRadius: 8,
      uiBackgroundColor: '#ffffff',
      uiBorderColor: '#e5e7eb',
      uiBorderWidth: 1,
      uiPadding: 16,
    };
    this.objects.push(obj);
    this.selectedObjectId = obj.id;
    this.markDirty();
    this.updateHierarchy();
    this.updatePropertiesPanel();
    this.updateStatusBar();
    this.renderScene();
  }

  private addUIText(): void {
    const offset = this.objects.length * 20;
    const obj: SceneObject = {
      id: `ui-text-${Date.now()}`,
      name: `UI Text ${this.objects.length + 1}`,
      type: 'ui-text',
      visible: true,
      locked: false,
      transform: { x: -50 + offset, y: offset, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0.5, pivotY: 0.5 },
      zIndex: this.objects.length,
      opacity: 1,
      text: 'UI Text',
      uiTextStyle: 'body',
      uiTextColor: '#1f2937',
      fontSize: 16,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    this.objects.push(obj);
    this.selectedObjectId = obj.id;
    this.markDirty();
    this.updateHierarchy();
    this.updatePropertiesPanel();
    this.updateStatusBar();
    this.renderScene();
  }

  private addUIImage(): void {
    const offset = this.objects.length * 20;
    const obj: SceneObject = {
      id: `ui-image-${Date.now()}`,
      name: `Image ${this.objects.length + 1}`,
      type: 'ui-image',
      visible: true,
      locked: false,
      transform: { x: -50 + offset, y: -50 + offset, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0.5, pivotY: 0.5 },
      zIndex: this.objects.length,
      opacity: 1,
      uiWidth: 100,
      uiHeight: 100,
      uiCornerRadius: 4,
      uiBackgroundColor: '#f3f4f6',
      uiBorderColor: '#d1d5db',
      uiBorderWidth: 1,
    };
    this.objects.push(obj);
    this.selectedObjectId = obj.id;
    this.markDirty();
    this.updateHierarchy();
    this.updatePropertiesPanel();
    this.updateStatusBar();
    this.renderScene();
  }

  private addUISlider(): void {
    const offset = this.objects.length * 20;
    const obj: SceneObject = {
      id: `ui-slider-${Date.now()}`,
      name: `Slider ${this.objects.length + 1}`,
      type: 'ui-slider',
      visible: true,
      locked: false,
      transform: { x: -80 + offset, y: -10 + offset, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0.5, pivotY: 0.5 },
      zIndex: this.objects.length,
      opacity: 1,
      uiWidth: 160,
      uiHeight: 20,
      uiValue: 50,
      uiMinValue: 0,
      uiMaxValue: 100,
      uiBackgroundColor: '#e5e7eb',
      color: '#3b82f6',
      uiCornerRadius: 10,
    };
    this.objects.push(obj);
    this.selectedObjectId = obj.id;
    this.markDirty();
    this.updateHierarchy();
    this.updatePropertiesPanel();
    this.updateStatusBar();
    this.renderScene();
  }

  private addUIProgressBar(): void {
    const offset = this.objects.length * 20;
    const obj: SceneObject = {
      id: `ui-progress-${Date.now()}`,
      name: `Progress ${this.objects.length + 1}`,
      type: 'ui-progress-bar',
      visible: true,
      locked: false,
      transform: { x: -80 + offset, y: -8 + offset, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0.5, pivotY: 0.5 },
      zIndex: this.objects.length,
      opacity: 1,
      uiWidth: 160,
      uiHeight: 16,
      uiValue: 65,
      uiMinValue: 0,
      uiMaxValue: 100,
      uiBackgroundColor: '#e5e7eb',
      color: '#22c55e',
      uiCornerRadius: 8,
    };
    this.objects.push(obj);
    this.selectedObjectId = obj.id;
    this.markDirty();
    this.updateHierarchy();
    this.updatePropertiesPanel();
    this.updateStatusBar();
    this.renderScene();
  }

  private addUICheckbox(): void {
    const offset = this.objects.length * 20;
    const obj: SceneObject = {
      id: `ui-checkbox-${Date.now()}`,
      name: `Checkbox ${this.objects.length + 1}`,
      type: 'ui-checkbox',
      visible: true,
      locked: false,
      transform: { x: -60 + offset, y: -10 + offset, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0.5, pivotY: 0.5 },
      zIndex: this.objects.length,
      opacity: 1,
      text: 'Checkbox label',
      uiChecked: false,
      uiWidth: 120,
      uiHeight: 20,
      uiBackgroundColor: '#ffffff',
      uiBorderColor: '#d1d5db',
      color: '#3b82f6',
      uiTextColor: '#1f2937',
      fontSize: 14,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    this.objects.push(obj);
    this.selectedObjectId = obj.id;
    this.markDirty();
    this.updateHierarchy();
    this.updatePropertiesPanel();
    this.updateStatusBar();
    this.renderScene();
  }

  // Custom Component Methods
  private addCustomComponent(definition: CustomComponentDefinition): void {
    const offset = this.objects.length * 20;
    const obj: SceneObject = {
      id: this.generateUniqueId('custom'),
      name: definition.name,
      type: 'custom',
      visible: true,
      locked: false,
      transform: {
        x: offset,
        y: offset,
        rotation: definition.defaultTransform.rotation,
        scaleX: definition.defaultTransform.scaleX,
        scaleY: definition.defaultTransform.scaleY,
        pivotX: definition.defaultTransform.pivotX,
        pivotY: definition.defaultTransform.pivotY,
      },
      zIndex: this.objects.length,
      opacity: 1,
      customComponentId: definition.id,
      customPropertyValues: this.getDefaultPropertyValues(definition),
    };
    this.objects.push(obj);
    this.selectedObjectId = obj.id;
    this.markDirty();
    customComponentsStore.recordUsage(definition.id);
    this.updateHierarchy();
    this.updatePropertiesPanel();
    this.updateStatusBar();
    this.renderScene();
    toast.success(`Added ${definition.name} to scene`);
  }

  private generateUniqueId(prefix: string): string {
    return `${prefix}-${Date.now()}-${++this.componentIdCounter}`;
  }

  private getDefaultPropertyValues(definition: CustomComponentDefinition): CustomComponentPropertyValues {
    const values: CustomComponentPropertyValues = {};
    for (const prop of definition.properties) {
      values[prop.name] = prop.defaultValue;
    }
    return values;
  }

  private toggleComponentsLibrary(show?: boolean): void {
    this.showComponentsLibrary = show !== undefined ? show : !this.showComponentsLibrary;
    const panel = this.$('.components-library-panel') as HTMLElement;
    const toggleBtn = this.$('[data-action="toggle-components"]');
    if (panel) panel.style.display = this.showComponentsLibrary ? 'flex' : 'none';
    if (toggleBtn) toggleBtn.classList.toggle('active', this.showComponentsLibrary);
    if (this.showComponentsLibrary) this.updateComponentsLibrary();
  }

  private toggleEditorMode(): void {
    sceneStore.toggleEditorMode();
    this.updateModeToggleUI();
    this.updateEditingState();
    this.renderScene();
  }

  private updateModeToggleUI(): void {
    const toggleBtn = this.$('[data-action="toggle-mode"]');
    const playIcon = this.$('.mode-toggle-btn .play-icon') as HTMLElement;
    const stopIcon = this.$('.mode-toggle-btn .stop-icon') as HTMLElement;
    const modeLabel = this.$('.mode-toggle-btn .mode-label') as HTMLElement;
    const scenePage = this.$('.scene-page');

    const isPlayMode = sceneStore.isPlayMode();

    if (toggleBtn) {
      toggleBtn.classList.toggle('active', isPlayMode);
      toggleBtn.classList.toggle('playing', isPlayMode);
    }
    if (playIcon) playIcon.style.display = isPlayMode ? 'none' : 'inline';
    if (stopIcon) stopIcon.style.display = isPlayMode ? 'inline' : 'none';
    if (modeLabel) modeLabel.textContent = isPlayMode ? 'Stop' : 'Play';
    if (scenePage) scenePage.classList.toggle('play-mode', isPlayMode);
  }

  private updateEditingState(): void {
    const isPlayMode = sceneStore.isPlayMode();
    const toolbar = this.$('.scene-toolbar') as HTMLElement;
    const hierarchyPanel = this.$('.hierarchy-panel') as HTMLElement;
    const propertiesPanel = this.$('.properties-panel') as HTMLElement;

    // Disable editing controls in play mode
    if (toolbar) {
      const editingBtns = toolbar.querySelectorAll('.toolbar-btn:not(.mode-toggle-btn):not([data-action="toggle-mode"])');
      editingBtns.forEach(btn => {
        (btn as HTMLButtonElement).disabled = isPlayMode;
      });
    }

    // Dim panels in play mode
    if (hierarchyPanel) hierarchyPanel.classList.toggle('disabled', isPlayMode);
    if (propertiesPanel) propertiesPanel.classList.toggle('disabled', isPlayMode);

    // Deselect objects when entering play mode
    if (isPlayMode && this.selectedObjectId) {
      this.selectedObjectId = null;
      this.updatePropertiesPanel();
    }
  }

  private escapeHtmlForComponent(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  private renderComponentItemHtml(comp: CustomComponentDefinition): string {
    const escapedName = this.escapeHtmlForComponent(comp.name);
    const escapedDesc = comp.description ? this.escapeHtmlForComponent(comp.description) : '';
    const title = escapedName + (escapedDesc ? ': ' + escapedDesc : '');
    const icon = this.escapeHtmlForComponent(comp.icon || '📦');
    return `<div class="component-item" data-component-id="${comp.id}" title="${title}"><div class="component-icon">${icon}</div><div class="component-name">${escapedName}</div><div class="component-actions"><button class="component-action-btn" data-action="add" title="Add to scene">+</button><button class="component-action-btn" data-action="delete" title="Delete">×</button></div></div>`;
  }

  private updateComponentsLibrary(searchQuery?: string): void {
    const grid = this.$('.components-grid') as HTMLElement;
    if (!grid) return;
    const components = searchQuery ? customComponentsStore.search(searchQuery) : customComponentsStore.getAll('name');
    if (components.length === 0) {
      grid.innerHTML = '<div class="components-empty"><p>No custom components</p><p class="hint">Select objects and save as component</p></div>';
      return;
    }
    grid.innerHTML = components.map(comp => this.renderComponentItemHtml(comp)).join('');
    this.bindComponentItemHandlers(grid);
  }

  private filterComponentsByCategory(category: string): void {
    const grid = this.$('.components-grid') as HTMLElement;
    if (!grid) return;
    let components: CustomComponentDefinition[];
    if (category === 'all') components = customComponentsStore.getAll('name');
    else if (category === 'recent') components = customComponentsStore.getRecentlyUsed(10);
    else components = customComponentsStore.getByCategory(category);
    if (components.length === 0) {
      grid.innerHTML = '<div class="components-empty"><p>No components in this category</p></div>';
      return;
    }
    grid.innerHTML = components.map(comp => this.renderComponentItemHtml(comp)).join('');
    this.bindComponentItemHandlers(grid);
  }

  private bindComponentItemHandlers(grid: HTMLElement): void {
    grid.querySelectorAll('.component-item').forEach(item => {
      const id = (item as HTMLElement).dataset.componentId;
      if (!id) return;
      item.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.component-action-btn')) return;
        const definition = customComponentsStore.getComponent(id);
        if (definition) this.addCustomComponent(definition);
      });
      const addBtn = item.querySelector('[data-action="add"]');
      if (addBtn) addBtn.addEventListener('click', () => {
        const definition = customComponentsStore.getComponent(id);
        if (definition) this.addCustomComponent(definition);
      });
      const deleteBtn = item.querySelector('[data-action="delete"]');
      if (deleteBtn) deleteBtn.addEventListener('click', () => {
        if (confirm('Delete this component? This cannot be undone.')) {
          customComponentsStore.deleteComponent(id);
          toast.success('Component deleted');
        }
      });
    });
  }

  private saveSelectionAsComponent(): void {
    if (!this.selectedObjectId) { toast.error('Select an object first'); return; }
    const selectedObj = this.objects.find(o => o.id === this.selectedObjectId);
    if (!selectedObj) { toast.error('Selected object not found'); return; }
    if (selectedObj.type === 'custom') { toast.error('Cannot save a custom component instance as a new component'); return; }
    if (selectedObj.type === 'group' || selectedObj.type === 'empty') { toast.error('Cannot save group or empty objects as components'); return; }
    const name = prompt('Enter component name:', selectedObj.name);
    if (!name) return;
    const description = prompt('Enter description (optional):', '');
    const component = customComponentsStore.createFromSelection(name, [{
      id: selectedObj.id, name: selectedObj.name, type: selectedObj.type as 'sprite' | 'shape' | 'text',
      shapeType: selectedObj.shapeType, transform: { x: selectedObj.transform.x, y: selectedObj.transform.y, rotation: selectedObj.transform.rotation,
        scaleX: selectedObj.transform.scaleX, scaleY: selectedObj.transform.scaleY, pivotX: selectedObj.transform.pivotX ?? 0.5, pivotY: selectedObj.transform.pivotY ?? 0.5 },
      opacity: selectedObj.opacity, color: selectedObj.color, text: selectedObj.text, fontSize: selectedObj.fontSize, fontFamily: selectedObj.fontFamily, zIndex: selectedObj.zIndex
    }], { description: description || undefined });
    if (component) { toast.success(`Saved "${name}" as custom component`); this.updateComponentsLibrary(); }
    else toast.error('Failed to create component');
  }

  private getCustomComponentBounds(children: CustomComponentChild[]): { width: number; height: number } {
    if (children.length === 0) return { width: 100, height: 100 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const child of children) {
      let childWidth = 100, childHeight = 100;
      if (child.type === 'shape' && child.shapeType === 'rectangle') { childWidth = 100; childHeight = 80; }
      else if (child.type === 'text') { const fontSize = child.fontSize || 24; childWidth = (child.text || 'Text').length * fontSize * 0.6; childHeight = fontSize * 1.2; }
      const pivotX = child.transform.pivotX ?? 0.5;
      const pivotY = child.transform.pivotY ?? 0.5;
      const left = child.transform.x - childWidth * pivotX;
      const right = left + childWidth;
      const top = child.transform.y - childHeight * pivotY;
      const bottom = top + childHeight;
      minX = Math.min(minX, left); minY = Math.min(minY, top);
      maxX = Math.max(maxX, right); maxY = Math.max(maxY, bottom);
    }
    return { width: Math.max(maxX - minX, 50), height: Math.max(maxY - minY, 50) };
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

    // Clean up sprite from renderer cache if it's a sprite object
    const obj = this.objects.find(o => o.id === this.selectedObjectId);
    if (obj?.type === 'sprite') {
      this.spriteRenderer.unload(obj.id);
    }

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
        return { width: obj.spriteWidth || 100, height: obj.spriteHeight || 100 };
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
      // UI Components use explicit dimensions
      case 'ui-button':
      case 'ui-panel':
      case 'ui-image':
      case 'ui-slider':
      case 'ui-progress-bar':
        return { width: obj.uiWidth || 100, height: obj.uiHeight || 40 };
      case 'ui-text': {
        const uiFontSize = obj.fontSize || 16;
        const uiTextLength = (obj.text || 'Text').length;
        return { width: Math.max(uiTextLength * uiFontSize * 0.6, obj.uiWidth || 0), height: uiFontSize * 1.4 };
      }
      case 'ui-checkbox':
        return { width: obj.uiWidth || 120, height: obj.uiHeight || 20 };
      case 'custom':
        if (obj.customComponentId) {
          const definition = customComponentsStore.getComponent(obj.customComponentId);
          if (definition && definition.children.length > 0) {
            return this.getCustomComponentBounds(definition.children);
          }
        }
        return { width: 100, height: 100 };
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
          // Use SpriteRenderer if image is loaded
          if (obj.spriteUrl && this.spriteRenderer.isLoaded(obj.id)) {
            const spriteInfo = this.spriteRenderer.getInfo(obj.id);
            if (spriteInfo?.image) {
              const w = obj.spriteWidth ?? spriteInfo.width;
              const h = obj.spriteHeight ?? spriteInfo.height;
              // Draw image at (0, -h) to account for Y-flip
              this.ctx.drawImage(spriteInfo.image, 0, -h, w, h);
            }
          } else {
            // Fallback placeholder for sprites without loaded images
            const w = obj.spriteWidth ?? 100;
            const h = obj.spriteHeight ?? 100;

            // Draw checkerboard pattern for transparency (accounting for Y-flip)
            const checkSize = 10;
            for (let cy = 0; cy < h; cy += checkSize) {
              for (let cx = 0; cx < w; cx += checkSize) {
                this.ctx.fillStyle = ((cx + cy) / checkSize) % 2 === 0 ? '#ccc' : '#fff';
                this.ctx.fillRect(cx, -h + cy, checkSize, checkSize);
              }
            }

            // Draw border
            this.ctx.strokeStyle = '#999';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(0, -h, w, h);

            // Draw sprite icon (flip text to render correctly)
            this.ctx.save();
            this.ctx.translate(w / 2, -h / 2);
            this.ctx.scale(1, -1); // Flip text back
            this.ctx.fillStyle = '#666';
            this.ctx.font = `${Math.min(w, h) * 0.4}px Arial`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText('🖼', 0, 0);
            this.ctx.restore();
          }
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

        // UI Components
        case 'ui-button':
          this.renderUIButton(obj, dims);
          break;

        case 'ui-panel':
          this.renderUIPanel(obj, dims);
          break;

        case 'ui-text':
          this.renderUIText(obj, dims);
          break;

        case 'ui-image':
          this.renderUIImage(obj, dims);
          break;

        case 'ui-slider':
          this.renderUISlider(obj, dims);
          break;

        case 'ui-progress-bar':
          this.renderUIProgressBar(obj, dims);
          break;

        case 'ui-checkbox':
          this.renderUICheckbox(obj, dims);
          break;

        case 'custom':
          this.renderCustomComponent(obj, dims);
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

  // UI Component rendering methods
  private renderUIButton(obj: SceneObject, dims: { width: number; height: number }): void {
    if (!this.ctx) return;
    const { width, height } = dims;
    const radius = obj.uiCornerRadius || 6;

    // Get style-based colors
    let bgColor = obj.uiBackgroundColor || '#3b82f6';
    let textColor = obj.uiTextColor || '#ffffff';
    let borderColor = '';
    let borderWidth = 0;

    switch (obj.uiButtonStyle) {
      case 'secondary':
        bgColor = obj.uiBackgroundColor || '#6b7280';
        break;
      case 'outline':
        bgColor = 'transparent';
        textColor = obj.uiTextColor || '#3b82f6';
        borderColor = obj.uiBorderColor || '#3b82f6';
        borderWidth = obj.uiBorderWidth || 2;
        break;
      case 'ghost':
        bgColor = 'transparent';
        textColor = obj.uiTextColor || '#3b82f6';
        break;
      // 'primary' uses defaults
    }

    // Draw button background (Y-flipped for canvas coordinate system)
    if (bgColor !== 'transparent') {
      this.ctx.fillStyle = bgColor;
      this.drawRoundedRect(0, -height, width, height, radius);
      this.ctx.fill();
    }

    // Draw border for outline style
    if (borderWidth > 0) {
      this.ctx.strokeStyle = borderColor;
      this.ctx.lineWidth = borderWidth;
      this.drawRoundedRect(0, -height, width, height, radius);
      this.ctx.stroke();
    }

    // Draw button text
    this.ctx.fillStyle = textColor;
    this.ctx.font = `${obj.fontSize || 14}px ${obj.fontFamily || 'Arial'}`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(obj.text || 'Button', width / 2, -height / 2);
  }

  private renderUIPanel(obj: SceneObject, dims: { width: number; height: number }): void {
    if (!this.ctx) return;
    const { width, height } = dims;
    const radius = obj.uiCornerRadius || 8;

    // Get style-based appearance
    let bgColor = obj.uiBackgroundColor || '#ffffff';
    let borderColor = obj.uiBorderColor || '#e5e7eb';
    let borderWidth = obj.uiBorderWidth || 1;
    let bgOpacity = 1;
    let showHeader = true;

    switch (obj.uiPanelStyle) {
      case 'bordered':
        borderWidth = obj.uiBorderWidth || 2;
        showHeader = false;
        break;
      case 'glass':
        bgOpacity = 0.8;
        borderColor = 'rgba(255, 255, 255, 0.3)';
        borderWidth = 1;
        break;
      // 'solid' uses defaults
    }

    // Draw panel background
    this.ctx.globalAlpha = bgOpacity * (obj.opacity ?? 1);
    this.ctx.fillStyle = bgColor;
    this.drawRoundedRect(0, -height, width, height, radius);
    this.ctx.fill();
    this.ctx.globalAlpha = obj.opacity ?? 1;

    // Draw panel border
    if (borderWidth > 0) {
      this.ctx.strokeStyle = borderColor;
      this.ctx.lineWidth = borderWidth;
      this.drawRoundedRect(0, -height, width, height, radius);
      this.ctx.stroke();
    }

    // Draw panel header bar (for solid style)
    if (showHeader) {
      this.ctx.fillStyle = obj.uiBorderColor || '#e5e7eb';
      this.ctx.fillRect(0, -height, width, 24);

      // Draw header text
      this.ctx.fillStyle = '#6b7280';
      this.ctx.font = '12px Arial';
      this.ctx.textAlign = 'left';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(obj.name || 'Panel', 8, -height + 12);
    }
  }

  private renderUIText(obj: SceneObject, _dims: { width: number; height: number }): void {
    if (!this.ctx) return;

    // Apply text style
    let fontWeight = 'normal';
    let fontSize = obj.fontSize || 16;

    switch (obj.uiTextStyle) {
      case 'heading':
        fontWeight = 'bold';
        fontSize = obj.fontSize || 24;
        break;
      case 'caption':
        fontSize = obj.fontSize || 12;
        break;
      case 'label':
        fontWeight = '500';
        fontSize = obj.fontSize || 14;
        break;
    }

    this.ctx.fillStyle = obj.uiTextColor || '#1f2937';
    this.ctx.font = `${fontWeight} ${fontSize}px ${obj.fontFamily || 'system-ui, sans-serif'}`;
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'bottom';
    this.ctx.fillText(obj.text || 'Text', 0, 0);
  }

  private renderUIImage(obj: SceneObject, dims: { width: number; height: number }): void {
    if (!this.ctx) return;
    const { width, height } = dims;
    const radius = obj.uiCornerRadius || 4;

    // Draw image placeholder background
    this.ctx.fillStyle = obj.uiBackgroundColor || '#f3f4f6';
    this.drawRoundedRect(0, -height, width, height, radius);
    this.ctx.fill();

    // Draw border
    if (obj.uiBorderWidth && obj.uiBorderWidth > 0) {
      this.ctx.strokeStyle = obj.uiBorderColor || '#d1d5db';
      this.ctx.lineWidth = obj.uiBorderWidth;
      this.drawRoundedRect(0, -height, width, height, radius);
      this.ctx.stroke();
    }

    // Draw placeholder icon
    this.ctx.fillStyle = '#9ca3af';
    this.ctx.font = `${Math.min(width, height) * 0.4}px Arial`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('🖼', width / 2, -height / 2);
  }

  private renderUISlider(obj: SceneObject, dims: { width: number; height: number }): void {
    if (!this.ctx) return;
    const { width, height } = dims;
    const value = obj.uiValue ?? 50;
    const minValue = obj.uiMinValue ?? 0;
    const maxValue = obj.uiMaxValue ?? 100;
    const progress = maxValue !== minValue ? (value - minValue) / (maxValue - minValue) : 0;
    const trackHeight = 6;
    const trackY = -height / 2 - trackHeight / 2;

    // Draw track background
    this.ctx.fillStyle = obj.uiBackgroundColor || '#e5e7eb';
    this.drawRoundedRect(0, trackY, width, trackHeight, trackHeight / 2);
    this.ctx.fill();

    // Draw filled portion
    const filledWidth = width * progress;
    if (filledWidth > 0) {
      this.ctx.fillStyle = obj.color || '#3b82f6';
      this.drawRoundedRect(0, trackY, filledWidth, trackHeight, trackHeight / 2);
      this.ctx.fill();
    }

    // Draw thumb
    const thumbRadius = 8;
    const thumbX = filledWidth;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.strokeStyle = obj.color || '#3b82f6';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(thumbX, -height / 2, thumbRadius, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();
  }

  private renderUIProgressBar(obj: SceneObject, dims: { width: number; height: number }): void {
    if (!this.ctx) return;
    const { width, height } = dims;
    const value = obj.uiValue ?? 50;
    const minValue = obj.uiMinValue ?? 0;
    const maxValue = obj.uiMaxValue ?? 100;
    const progress = maxValue !== minValue ? (value - minValue) / (maxValue - minValue) : 0;
    const radius = obj.uiCornerRadius || 8;

    // Draw track background
    this.ctx.fillStyle = obj.uiBackgroundColor || '#e5e7eb';
    this.drawRoundedRect(0, -height, width, height, radius);
    this.ctx.fill();

    // Draw filled portion
    const filledWidth = width * progress;
    if (filledWidth > 0) {
      this.ctx.fillStyle = obj.color || '#22c55e';
      this.drawRoundedRect(0, -height, filledWidth, height, radius);
      this.ctx.fill();
    }

    // Draw percentage text
    this.ctx.fillStyle = progress > 0.5 ? '#ffffff' : '#374151';
    this.ctx.font = `bold ${Math.min(height * 0.7, 12)}px Arial`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(`${Math.round(value)}%`, width / 2, -height / 2);
  }

  private renderUICheckbox(obj: SceneObject, dims: { width: number; height: number }): void {
    if (!this.ctx) return;
    const { height } = dims;
    const boxSize = Math.min(height, 18);
    const isChecked = obj.uiChecked ?? false;

    // Draw checkbox box
    const boxY = -height / 2 - boxSize / 2;
    this.ctx.fillStyle = isChecked ? (obj.color || '#3b82f6') : (obj.uiBackgroundColor || '#ffffff');
    this.ctx.strokeStyle = isChecked ? (obj.color || '#3b82f6') : (obj.uiBorderColor || '#d1d5db');
    this.ctx.lineWidth = 1.5;
    this.drawRoundedRect(0, boxY, boxSize, boxSize, 3);
    this.ctx.fill();
    this.ctx.stroke();

    // Draw checkmark
    if (isChecked) {
      this.ctx.strokeStyle = '#ffffff';
      this.ctx.lineWidth = 2;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.beginPath();
      this.ctx.moveTo(4, boxY + boxSize / 2);
      this.ctx.lineTo(boxSize / 2 - 1, boxY + boxSize - 4);
      this.ctx.lineTo(boxSize - 3, boxY + 4);
      this.ctx.stroke();
    }

    // Draw label
    this.ctx.fillStyle = obj.uiTextColor || '#1f2937';
    this.ctx.font = `${obj.fontSize || 14}px ${obj.fontFamily || 'system-ui, sans-serif'}`;
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(obj.text || '', boxSize + 8, -height / 2);
  }

  private renderCustomComponent(obj: SceneObject, dims: { width: number; height: number }): void {
    if (!this.ctx || !obj.customComponentId) return;

    const definition = customComponentsStore.getComponent(obj.customComponentId);
    if (!definition) {
      // Draw placeholder for missing component
      this.ctx.fillStyle = '#f0f0f0';
      this.ctx.strokeStyle = '#ff6666';
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([5, 5]);
      this.ctx.fillRect(0, -dims.height, dims.width, dims.height);
      this.ctx.strokeRect(0, -dims.height, dims.width, dims.height);
      this.ctx.setLineDash([]);

      // Draw missing icon
      this.ctx.save();
      this.ctx.translate(dims.width / 2, -dims.height / 2);
      this.ctx.scale(1, -1);
      this.ctx.fillStyle = '#ff6666';
      this.ctx.font = '24px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText('❌', 0, 0);
      this.ctx.restore();
      return;
    }

    // Draw custom component bounding box
    this.ctx.fillStyle = '#e8f4e8';
    this.ctx.strokeStyle = '#4caf50';
    this.ctx.lineWidth = 1;
    this.ctx.fillRect(0, -dims.height, dims.width, dims.height);
    this.ctx.strokeRect(0, -dims.height, dims.width, dims.height);

    // Draw component icon and name
    this.ctx.save();
    this.ctx.translate(dims.width / 2, -dims.height / 2);
    this.ctx.scale(1, -1);

    const icon = definition.icon || '📦';
    this.ctx.font = '20px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(icon, 0, -10);

    this.ctx.fillStyle = '#2e7d32';
    this.ctx.font = 'bold 12px Arial';
    this.ctx.fillText(definition.name, 0, 10);

    this.ctx.restore();
  }

  // Helper method for drawing rounded rectangles
  private drawRoundedRect(x: number, y: number, width: number, height: number, radius: number): void {
    if (!this.ctx) return;
    const r = Math.min(radius, width / 2, height / 2);
    this.ctx.beginPath();
    this.ctx.moveTo(x + r, y);
    this.ctx.lineTo(x + width - r, y);
    this.ctx.arcTo(x + width, y, x + width, y + r, r);
    this.ctx.lineTo(x + width, y + height - r);
    this.ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
    this.ctx.lineTo(x + r, y + height);
    this.ctx.arcTo(x, y + height, x, y + height - r, r);
    this.ctx.lineTo(x, y + r);
    this.ctx.arcTo(x, y, x + r, y, r);
    this.ctx.closePath();
  }

  private updateHierarchy(): void {
    const treeContainer = this.$('.hierarchy-tree') as HTMLElement;
    if (!treeContainer) return;

    if (this.objects.length === 0) {
      treeContainer.innerHTML = `
        <div class="hierarchy-empty">
          <p>No objects in scene</p>
          <p class="hint">Add sprites, shapes, text, or UI components</p>
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
      // UI Components
      case 'ui-button': return '🔘';
      case 'ui-panel': return '🪟';
      case 'ui-text': return '🔤';
      case 'ui-image': return '🖼️';
      case 'ui-slider': return '🎚️';
      case 'ui-progress-bar': return '📊';
      case 'ui-checkbox': return '☑️';
      case 'custom': return '📦';
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

    // Update UI-specific properties
    this.updateUIPropertiesPanel(obj);

    // Update or create TransformEditor
    this.updateTransformEditor(obj);
  }

  private updateUIPropertiesPanel(obj: SceneObject): void {
    const uiPropsSection = this.$('.ui-properties') as HTMLElement;
    const isUIComponent = obj.type.startsWith('ui-');

    if (!uiPropsSection) return;

    // Show/hide UI properties section based on object type
    uiPropsSection.style.display = isUIComponent ? 'block' : 'none';

    if (!isUIComponent) return;

    // Update size fields
    const uiWidthInput = this.$('.ui-width') as HTMLInputElement;
    const uiHeightInput = this.$('.ui-height') as HTMLInputElement;
    if (uiWidthInput) uiWidthInput.value = String(obj.uiWidth || 100);
    if (uiHeightInput) uiHeightInput.value = String(obj.uiHeight || 40);

    // Show/hide value slider for sliders and progress bars
    const valueRow = this.$('.ui-value-row') as HTMLElement;
    const hasValue = obj.type === 'ui-slider' || obj.type === 'ui-progress-bar';
    if (valueRow) {
      valueRow.style.display = hasValue ? 'flex' : 'none';
      if (hasValue) {
        const uiValueSlider = this.$('.ui-value-slider') as HTMLInputElement;
        const uiValueDisplay = this.$('.ui-value-display') as HTMLElement;
        if (uiValueSlider) uiValueSlider.value = String(obj.uiValue ?? 50);
        if (uiValueDisplay) uiValueDisplay.textContent = String(obj.uiValue ?? 50);
      }
    }

    // Show/hide checkbox field for checkboxes
    const checkedRow = this.$('.ui-checked-row') as HTMLElement;
    const hasChecked = obj.type === 'ui-checkbox';
    if (checkedRow) {
      checkedRow.style.display = hasChecked ? 'flex' : 'none';
      if (hasChecked) {
        const uiCheckedInput = this.$('.ui-checked') as HTMLInputElement;
        if (uiCheckedInput) uiCheckedInput.checked = obj.uiChecked ?? false;
      }
    }

    // Show/hide text field for buttons and text
    const textRow = this.$('.ui-text-row') as HTMLElement;
    const hasText = obj.type === 'ui-button' || obj.type === 'ui-text';
    if (textRow) {
      textRow.style.display = hasText ? 'flex' : 'none';
      if (hasText) {
        const uiTextInput = this.$('.ui-text') as HTMLInputElement;
        if (uiTextInput) uiTextInput.value = obj.text || '';
      }
    }
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

    if (this.unsubscribeComponents) {
      this.unsubscribeComponents();
      this.unsubscribeComponents = null;
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
