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
import { SpriteRenderer } from '../../lib/sprite';
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
  // Sprite dimensions (auto-populated when image loads)
  spriteWidth?: number;
  spriteHeight?: number;
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

  // Sprite renderer for displaying images
  private spriteRenderer: SpriteRenderer = new SpriteRenderer();

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

  /**
   * Get the base dimensions of an object (before scale transform)
   */
  private getObjectDimensions(obj: SceneObject): { width: number; height: number } {
    let width = 100;
    let height = 100;

    switch (obj.type) {
      case 'sprite':
        width = obj.spriteWidth ?? 100;
        height = obj.spriteHeight ?? 100;
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

    return { width, height };
  }

  /**
   * Get the scaled dimensions of an object
   */
  private getScaledDimensions(obj: SceneObject): { width: number; height: number } {
    const { width, height } = this.getObjectDimensions(obj);
    return {
      width: width * obj.transform.scaleX,
      height: height * obj.transform.scaleY,
    };
  }

  private isPointInObject(x: number, y: number, obj: SceneObject): boolean {
    // Simple bounding box check (would be more complex for rotated objects)
    const { width, height } = this.getScaledDimensions(obj);

    return x >= obj.transform.x && x <= obj.transform.x + width &&
           y >= obj.transform.y && y <= obj.transform.y + height;
  }

  private addSprite(): void {
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
    const id = `sprite-${Date.now()}`;

    try {
      await this.spriteRenderer.load(id, url);
      const info = this.spriteRenderer.getInfo(id);

      const obj: SceneObject = {
        id,
        name: `Sprite ${this.objects.length + 1}`,
        type: 'sprite',
        visible: true,
        locked: false,
        transform: { x: 100, y: 100, rotation: 0, scaleX: 1, scaleY: 1 },
        zIndex: this.objects.length,
        opacity: 1,
        spriteUrl: url,
        spriteWidth: info?.width ?? 100,
        spriteHeight: info?.height ?? 100,
      };

      this.objects.push(obj);
      this.selectedObjectId = obj.id;
      this.hasUnsavedChanges = true;
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
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
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
      transform: { x: 150, y: 150, rotation: 0, scaleX: 1, scaleY: 1 },
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
      transform: { x: 200, y: 200, rotation: 0, scaleX: 1, scaleY: 1 },
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

      this.ctx.save();
      this.ctx.globalAlpha = obj.opacity;
      this.ctx.translate(obj.transform.x, obj.transform.y);
      this.ctx.rotate((obj.transform.rotation * Math.PI) / 180);
      this.ctx.scale(obj.transform.scaleX, obj.transform.scaleY);

      switch (obj.type) {
        case 'sprite':
          // Restore context for SpriteRenderer (it handles its own transforms)
          this.ctx.restore();

          // Use SpriteRenderer if image is loaded
          if (obj.spriteUrl && this.spriteRenderer.isLoaded(obj.id)) {
            this.spriteRenderer.draw(
              this.ctx,
              obj.id,
              {
                x: obj.transform.x,
                y: obj.transform.y,
                rotation: obj.transform.rotation,
                scaleX: obj.transform.scaleX,
                scaleY: obj.transform.scaleY,
                opacity: obj.opacity,
                anchorX: 0,
                anchorY: 0,
              }
            );
          } else {
            // Fallback placeholder for sprites without loaded images
            this.ctx.save();
            this.ctx.globalAlpha = obj.opacity;
            this.ctx.translate(obj.transform.x, obj.transform.y);
            this.ctx.rotate((obj.transform.rotation * Math.PI) / 180);
            this.ctx.scale(obj.transform.scaleX, obj.transform.scaleY);

            const w = obj.spriteWidth ?? 100;
            const h = obj.spriteHeight ?? 100;

            // Draw checkerboard pattern for transparency
            const checkSize = 10;
            for (let cy = 0; cy < h; cy += checkSize) {
              for (let cx = 0; cx < w; cx += checkSize) {
                this.ctx.fillStyle = ((cx + cy) / checkSize) % 2 === 0 ? '#ccc' : '#fff';
                this.ctx.fillRect(cx, cy, checkSize, checkSize);
              }
            }

            // Draw border
            this.ctx.strokeStyle = '#999';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(0, 0, w, h);

            // Draw sprite icon
            this.ctx.fillStyle = '#666';
            this.ctx.font = `${Math.min(w, h) * 0.4}px Arial`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText('🖼', w / 2, h / 2);

            this.ctx.restore();
          }

          // Re-save context since we restored it
          this.ctx.save();
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

      // Draw selection outline
      if (obj.id === this.selectedObjectId) {
        const { width: selWidth, height: selHeight } = this.getScaledDimensions(obj);

        this.ctx.strokeStyle = '#0066ff';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        this.ctx.strokeRect(
          obj.transform.x - 2,
          obj.transform.y - 2,
          selWidth + 4,
          selHeight + 4
        );
        this.ctx.setLineDash([]);
      }
    }
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
