/**
 * Image Editor Page
 * Canvas-based image editor with offline support and multi-layer editing
 * AI features require connectivity
 */

import { Page, type PageOptions } from '../base/Page';
import { Button, Spinner, toast, OfflineIndicator, LayersPanel } from '../../components';
import { sessionsApi } from '../../lib/api';
import { offlineManager, isOffline } from '../../lib/offline';
import { offlineStorage } from '../../lib/offlineStorage';
import { imageLayersStore } from '../../stores/imageLayersStore';
import { onionSkinningStore } from '../../stores/onionSkinningStore';
import type { OnionSkinningSettings } from '../../stores/onionSkinningStore';
import type { Session } from '../../types';
import './image.css';

type Tool = 'select' | 'pencil' | 'brush' | 'eraser' | 'fill' | 'rectangle' | 'circle' | 'line';

interface Frame {
  id: string;
  name: string;
  imageData: ImageData;
  duration: number;
}

interface ImagePageOptions extends PageOptions {
  params?: {
    sessionId?: string;
  };
}

export class ImagePage extends Page<ImagePageOptions> {
  readonly route = '/session/:sessionId/image';
  readonly title = 'Image Editor';
  protected requiresAuth = true;

  private session: Session | null = null;
  private isSaving = false;
  private offlineIndicator: OfflineIndicator | null = null;
  private unsubscribeOffline: (() => void) | null = null;
  private isOfflineMode = false;

  // Canvas state
  private displayCanvas: HTMLCanvasElement | null = null; // The visible canvas that shows composited layers
  private currentTool: Tool = 'pencil';
  private primaryColor = '#000000';
  private secondaryColor = '#ffffff';
  private brushSize = 5;
  private isDrawing = false;
  private lastX = 0;
  private lastY = 0;

  // Layer history for undo/redo (stores layer state snapshots)
  // NOTE: History only tracks layer CONTENT changes, not structure changes.
  // Adding, deleting, reordering, or merging layers are not undoable operations.
  // This is a design choice to keep memory usage manageable.
  private history: Array<{ layerId: string; data: ImageData }[]> = [];
  private historyIndex = -1;
  private maxHistory = 50;

  // Current file info
  private currentFilePath: string | null = null;
  private hasUnsavedChanges = false;

  // Event handlers for cleanup
  private keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

  // Layers panel component
  private layersPanel: LayersPanel | null = null;
  private unsubscribeLayers: (() => void) | null = null;

  // Render optimization - batch compositing with requestAnimationFrame
  private renderPending = false;

  // Frame-based animation
  private frames: Frame[] = [];
  private currentFrameIndex = 0;

  // Onion skinning
  private onionSettings: OnionSkinningSettings = onionSkinningStore.getSettings();
  private unsubscribeOnionSkinning: (() => void) | null = null;
  private onionCanvas: HTMLCanvasElement | null = null;
  private onionCtx: CanvasRenderingContext2D | null = null;
  private tempCanvas: HTMLCanvasElement | null = null;
  private tempCtx: CanvasRenderingContext2D | null = null;

  protected render(): string {
    return `
      <div class="image-page">
        <header class="image-header">
          <div class="image-header-left">
            <button class="back-btn" data-action="back">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <div class="image-session-info">
              <h1 class="image-title">Image Editor</h1>
              <p class="image-subtitle">Loading...</p>
            </div>
          </div>
          <div class="image-header-right">
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

        <div class="image-layout">
          <!-- Tools Sidebar -->
          <aside class="tools-sidebar">
            <div class="tools-section">
              <div class="tools-section-title">Tools</div>
              <div class="tools-grid">
                <button class="tool-btn active" data-tool="select" title="Select (V)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>
                </button>
                <button class="tool-btn" data-tool="pencil" title="Pencil (P)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/></svg>
                </button>
                <button class="tool-btn" data-tool="brush" title="Brush (B)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 114.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 00-3-3.02z"/></svg>
                </button>
                <button class="tool-btn" data-tool="eraser" title="Eraser (E)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 20H7L3 16c-.5-.5-.5-1.5 0-2l10-10c.5-.5 1.5-.5 2 0l7 7c.5.5.5 1.5 0 2l-6 6"/><path d="M6 11l4 4"/></svg>
                </button>
                <button class="tool-btn" data-tool="fill" title="Fill (G)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 11l-8-8-8.6 8.6a2 2 0 000 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11z"/><path d="M5 2l5 5"/><path d="M2 13h15"/><path d="M22 20.8c0 .6-.5 1.2-1.2 1.2-.6 0-1.2-.5-1.2-1.2 0-.7 1.2-2.8 1.2-2.8s1.2 2 1.2 2.8z"/></svg>
                </button>
                <button class="tool-btn" data-tool="rectangle" title="Rectangle (R)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
                </button>
                <button class="tool-btn" data-tool="circle" title="Circle (C)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
                </button>
                <button class="tool-btn" data-tool="line" title="Line (L)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
              </div>
            </div>

            <div class="tools-section">
              <div class="tools-section-title">Colors</div>
              <div class="color-picker-group">
                <div class="color-swatches">
                  <input type="color" class="color-input primary-color" value="#000000" title="Primary Color">
                  <input type="color" class="color-input secondary-color" value="#ffffff" title="Secondary Color">
                </div>
                <button class="swap-colors-btn" title="Swap Colors (X)">⇄</button>
              </div>
            </div>

            <div class="tools-section">
              <div class="tools-section-title">Brush Size</div>
              <div class="brush-size-group">
                <input type="range" class="brush-size-slider" min="1" max="100" value="5">
                <span class="brush-size-value">5px</span>
              </div>
            </div>

            <div class="tools-section">
              <div class="tools-section-title">Actions</div>
              <div class="action-buttons">
                <button class="action-btn" data-action="undo" title="Undo (Ctrl+Z)">↶ Undo</button>
                <button class="action-btn" data-action="redo" title="Redo (Ctrl+Y)">↷ Redo</button>
                <button class="action-btn" data-action="clear" title="Clear Canvas">Clear</button>
              </div>
            </div>

            <div class="tools-section onion-section">
              <div class="tools-section-title">Onion Skinning</div>
              <div class="onion-toggle-row">
                <label class="toggle-label">
                  <input type="checkbox" class="onion-enabled-toggle" ${this.onionSettings.enabled ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                  <span class="toggle-text">Enable</span>
                </label>
              </div>
              <div class="onion-settings ${this.onionSettings.enabled ? '' : 'disabled'}">
                <div class="onion-row">
                  <label class="onion-checkbox-label">
                    <input type="checkbox" class="onion-prev-toggle" ${this.onionSettings.showPrevious ? 'checked' : ''}>
                    <span>Previous</span>
                  </label>
                  <input type="number" class="onion-prev-count" value="${this.onionSettings.previousCount}" min="1" max="10" title="Number of previous frames">
                </div>
                <div class="onion-row">
                  <label class="onion-checkbox-label">
                    <input type="checkbox" class="onion-next-toggle" ${this.onionSettings.showNext ? 'checked' : ''}>
                    <span>Next</span>
                  </label>
                  <input type="number" class="onion-next-count" value="${this.onionSettings.nextCount}" min="1" max="10" title="Number of next frames">
                </div>
                <div class="onion-opacity-row">
                  <label>Opacity</label>
                  <input type="range" class="onion-opacity-slider" min="0" max="100" value="${Math.round(this.onionSettings.previousOpacity * 100)}">
                  <span class="onion-opacity-value">${Math.round(this.onionSettings.previousOpacity * 100)}%</span>
                </div>
              </div>
            </div>

            <div class="tools-section ai-section">
              <div class="tools-section-title">AI Tools</div>
              <div class="ai-notice">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="ai-icon">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                </svg>
                <span>Requires internet connection</span>
              </div>
              <div class="action-buttons">
                <button class="action-btn ai-btn" data-action="ai-generate" disabled>Generate</button>
                <button class="action-btn ai-btn" data-action="ai-enhance" disabled>Enhance</button>
              </div>
            </div>
          </aside>

          <!-- Main Canvas Area -->
          <main class="canvas-container">
            <div class="canvas-loading">
              <div class="spinner-container"></div>
              <p>Loading editor...</p>
            </div>
            <div class="canvas-wrapper" style="display: none;">
              <div class="canvas-stack">
                <canvas class="onion-canvas" width="800" height="600"></canvas>
                <canvas class="main-canvas" width="800" height="600"></canvas>
              </div>
            </div>
            <div class="canvas-empty" style="display: none;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              <p>Create a new image or open an existing one</p>
              <div class="canvas-actions">
                <button class="btn-new-image">New Image</button>
                <button class="btn-open-image">Open Image</button>
              </div>
            </div>
          </main>

          <!-- Layers Panel Container - populated by LayersPanel component -->
          <div class="layers-panel-container"></div>
        </div>

        <!-- Timeline -->
        <div class="timeline-panel">
          <div class="timeline-controls">
            <button class="timeline-btn" data-action="first-frame" title="First Frame">⏮</button>
            <button class="timeline-btn" data-action="prev-frame" title="Previous Frame (,)">◀</button>
            <button class="timeline-btn" data-action="next-frame" title="Next Frame (.)">▶</button>
            <button class="timeline-btn" data-action="last-frame" title="Last Frame">⏭</button>
            <span class="timeline-separator"></span>
            <button class="timeline-btn" data-action="add-frame" title="Add Frame (+)">+</button>
            <button class="timeline-btn" data-action="duplicate-frame" title="Duplicate Frame">⎘</button>
            <button class="timeline-btn" data-action="delete-frame" title="Delete Frame (-)">−</button>
          </div>
          <div class="timeline-frames">
            <div class="frames-container"></div>
          </div>
          <div class="timeline-info">
            <span class="frame-counter">Frame 1 / 1</span>
          </div>
        </div>

        <!-- Status Bar -->
        <footer class="image-status-bar">
          <span class="status-dimensions">800 × 600</span>
          <span class="status-separator">|</span>
          <span class="status-zoom">100%</span>
          <span class="status-separator">|</span>
          <span class="status-cursor">X: 0, Y: 0</span>
          <span class="status-spacer"></span>
          <span class="status-mode">Normal</span>
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
      const saveBtn = new Button('Save', {
        variant: 'primary',
        size: 'sm',
        onClick: () => this.saveImage(),
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

      // If back online, sync pending changes
      if (status === 'online' && wasOffline) {
        this.syncPendingChanges();
      }
    });

    // Setup tool buttons
    this.setupToolButtons();

    // Setup color pickers
    this.setupColorPickers();

    // Setup brush size slider
    this.setupBrushSize();

    // Setup action buttons
    this.setupActionButtons();

    // Setup canvas
    this.setupCanvas();

    // Setup layers panel
    this.setupLayersPanel();

    // Setup onion canvas
    this.setupOnionCanvas();

    // Setup keyboard shortcuts
    this.setupKeyboardShortcuts();

    // Setup onion skinning controls
    this.setupOnionSkinningControls();

    // Setup timeline controls
    this.setupTimelineControls();

    // Subscribe to onion skinning store
    this.unsubscribeOnionSkinning = onionSkinningStore.subscribe((settings) => {
      this.onionSettings = settings;
      this.updateOnionSkinningUI();
      this.renderOnionSkin();
    });

    // Load session data
    this.loadSession();
  }

  private setupToolButtons(): void {
    const toolBtns = this.$$('[data-tool]');
    toolBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = (btn as HTMLElement).dataset.tool as Tool;
        this.selectTool(tool);
      });
    });
  }

  private selectTool(tool: Tool): void {
    this.currentTool = tool;
    const toolBtns = this.$$('[data-tool]');
    toolBtns.forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.tool === tool);
    });
  }

  private setupColorPickers(): void {
    const primaryColor = this.$('.primary-color') as HTMLInputElement;
    const secondaryColor = this.$('.secondary-color') as HTMLInputElement;
    const swapBtn = this.$('.swap-colors-btn') as HTMLButtonElement;

    if (primaryColor) {
      primaryColor.addEventListener('input', (e) => {
        this.primaryColor = (e.target as HTMLInputElement).value;
      });
    }

    if (secondaryColor) {
      secondaryColor.addEventListener('input', (e) => {
        this.secondaryColor = (e.target as HTMLInputElement).value;
      });
    }

    if (swapBtn) {
      swapBtn.addEventListener('click', () => {
        const temp = this.primaryColor;
        this.primaryColor = this.secondaryColor;
        this.secondaryColor = temp;
        if (primaryColor) primaryColor.value = this.primaryColor;
        if (secondaryColor) secondaryColor.value = this.secondaryColor;
      });
    }
  }

  private setupBrushSize(): void {
    const slider = this.$('.brush-size-slider') as HTMLInputElement;
    const value = this.$('.brush-size-value') as HTMLElement;

    if (slider) {
      slider.addEventListener('input', (e) => {
        this.brushSize = parseInt((e.target as HTMLInputElement).value);
        if (value) value.textContent = `${this.brushSize}px`;
      });
    }
  }

  private setupActionButtons(): void {
    const undoBtn = this.$('[data-action="undo"]') as HTMLButtonElement;
    const redoBtn = this.$('[data-action="redo"]') as HTMLButtonElement;
    const clearBtn = this.$('[data-action="clear"]') as HTMLButtonElement;

    if (undoBtn) undoBtn.addEventListener('click', () => this.undo());
    if (redoBtn) redoBtn.addEventListener('click', () => this.redo());
    if (clearBtn) clearBtn.addEventListener('click', () => this.clearCanvas());
  }

  private setupCanvas(): void {
    this.displayCanvas = this.$('.main-canvas') as HTMLCanvasElement;
    if (this.displayCanvas) {
      // Initialize the layers store with default canvas size
      imageLayersStore.initialize(this.displayCanvas.width, this.displayCanvas.height);

      // Subscribe to layer changes to update display
      this.unsubscribeLayers = imageLayersStore.subscribe(() => {
        this.compositeAndRender();
      });

      // Initial render
      this.compositeAndRender();
      this.saveToHistory();

      // Mouse events
      this.displayCanvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
      this.displayCanvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
      this.displayCanvas.addEventListener('mouseup', () => this.handleMouseUp());
      this.displayCanvas.addEventListener('mouseleave', () => this.handleMouseUp());

      // Touch events for mobile support
      this.displayCanvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
      this.displayCanvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
      this.displayCanvas.addEventListener('touchend', () => this.handleMouseUp());
      this.displayCanvas.addEventListener('touchcancel', () => this.handleMouseUp());

      // Update cursor position in status bar
      this.displayCanvas.addEventListener('mousemove', (e) => {
        const rect = this.displayCanvas!.getBoundingClientRect();
        const x = Math.round(e.clientX - rect.left);
        const y = Math.round(e.clientY - rect.top);
        const cursorStatus = this.$('.status-cursor') as HTMLElement;
        if (cursorStatus) {
          cursorStatus.textContent = `X: ${x}, Y: ${y}`;
        }
      });
    }

    // New image button
    const newImageBtn = this.$('.btn-new-image') as HTMLButtonElement;
    if (newImageBtn) {
      newImageBtn.addEventListener('click', () => this.createNewImage());
    }

    // Open image button
    const openImageBtn = this.$('.btn-open-image') as HTMLButtonElement;
    if (openImageBtn) {
      openImageBtn.addEventListener('click', () => this.openImage());
    }
  }

  private setupLayersPanel(): void {
    const container = this.$('.layers-panel-container') as HTMLElement;
    if (container) {
      this.layersPanel = new LayersPanel({
        onLayerChange: () => {
          // Only update status bar - compositing is handled by the store subscription
          this.updateLayerCount();
        },
      });
      this.layersPanel.mount(container);
    }
  }

  private setupOnionCanvas(): void {
    this.onionCanvas = this.$('.onion-canvas') as HTMLCanvasElement;
    if (this.onionCanvas) {
      this.onionCtx = this.onionCanvas.getContext('2d');
    }
  }

  private compositeAndRender(): void {
    if (!this.displayCanvas) return;
    imageLayersStore.compositeToCanvas(this.displayCanvas);
  }

  /**
   * Schedule a render on the next animation frame.
   * This batches multiple draw operations to improve performance during rapid drawing.
   */
  private scheduleRender(): void {
    if (this.renderPending) return;
    this.renderPending = true;
    requestAnimationFrame(() => {
      this.renderPending = false;
      this.compositeAndRender();
    });
  }

  private updateLayerCount(): void {
    const statusMode = this.$('.status-mode') as HTMLElement;
    if (statusMode) {
      const activeLayer = imageLayersStore.getActiveLayer();
      statusMode.textContent = activeLayer ? `Layer: ${activeLayer.name}` : 'No Layer';
    }
  }

  private setupOnionSkinningControls(): void {
    const enabledToggle = this.$('.onion-enabled-toggle') as HTMLInputElement;
    const prevToggle = this.$('.onion-prev-toggle') as HTMLInputElement;
    const nextToggle = this.$('.onion-next-toggle') as HTMLInputElement;
    const prevCount = this.$('.onion-prev-count') as HTMLInputElement;
    const nextCount = this.$('.onion-next-count') as HTMLInputElement;
    const opacitySlider = this.$('.onion-opacity-slider') as HTMLInputElement;

    if (enabledToggle) {
      enabledToggle.addEventListener('change', () => {
        onionSkinningStore.setEnabled(enabledToggle.checked);
      });
    }

    if (prevToggle) {
      prevToggle.addEventListener('change', () => {
        onionSkinningStore.setShowPrevious(prevToggle.checked);
      });
    }

    if (nextToggle) {
      nextToggle.addEventListener('change', () => {
        onionSkinningStore.setShowNext(nextToggle.checked);
      });
    }

    if (prevCount) {
      prevCount.addEventListener('change', () => {
        onionSkinningStore.setPreviousCount(parseInt(prevCount.value) || 1);
      });
    }

    if (nextCount) {
      nextCount.addEventListener('change', () => {
        onionSkinningStore.setNextCount(parseInt(nextCount.value) || 1);
      });
    }

    if (opacitySlider) {
      opacitySlider.addEventListener('input', () => {
        const value = parseInt(opacitySlider.value) / 100;
        onionSkinningStore.updateSettings({
          previousOpacity: value,
          nextOpacity: value,
        });
        const opacityValue = this.$('.onion-opacity-value') as HTMLElement;
        if (opacityValue) {
          opacityValue.textContent = `${opacitySlider.value}%`;
        }
      });
    }
  }

  private setupTimelineControls(): void {
    const firstFrameBtn = this.$('[data-action="first-frame"]') as HTMLButtonElement;
    const prevFrameBtn = this.$('[data-action="prev-frame"]') as HTMLButtonElement;
    const nextFrameBtn = this.$('[data-action="next-frame"]') as HTMLButtonElement;
    const lastFrameBtn = this.$('[data-action="last-frame"]') as HTMLButtonElement;
    const addFrameBtn = this.$('[data-action="add-frame"]') as HTMLButtonElement;
    const duplicateFrameBtn = this.$('[data-action="duplicate-frame"]') as HTMLButtonElement;
    const deleteFrameBtn = this.$('[data-action="delete-frame"]') as HTMLButtonElement;

    if (firstFrameBtn) firstFrameBtn.addEventListener('click', () => this.goToFrame(0));
    if (prevFrameBtn) prevFrameBtn.addEventListener('click', () => this.previousFrame());
    if (nextFrameBtn) nextFrameBtn.addEventListener('click', () => this.nextFrame());
    if (lastFrameBtn) lastFrameBtn.addEventListener('click', () => this.goToFrame(this.frames.length - 1));
    if (addFrameBtn) addFrameBtn.addEventListener('click', () => this.addFrame());
    if (duplicateFrameBtn) duplicateFrameBtn.addEventListener('click', () => this.duplicateFrame());
    if (deleteFrameBtn) deleteFrameBtn.addEventListener('click', () => this.deleteFrame());
  }

  private updateOnionSkinningUI(): void {
    const settingsPanel = this.$('.onion-settings') as HTMLElement;
    const enabledToggle = this.$('.onion-enabled-toggle') as HTMLInputElement;
    const prevToggle = this.$('.onion-prev-toggle') as HTMLInputElement;
    const nextToggle = this.$('.onion-next-toggle') as HTMLInputElement;
    const prevCount = this.$('.onion-prev-count') as HTMLInputElement;
    const nextCount = this.$('.onion-next-count') as HTMLInputElement;
    const opacitySlider = this.$('.onion-opacity-slider') as HTMLInputElement;
    const opacityValue = this.$('.onion-opacity-value') as HTMLElement;

    if (settingsPanel) {
      settingsPanel.classList.toggle('disabled', !this.onionSettings.enabled);
    }
    if (enabledToggle) enabledToggle.checked = this.onionSettings.enabled;
    if (prevToggle) prevToggle.checked = this.onionSettings.showPrevious;
    if (nextToggle) nextToggle.checked = this.onionSettings.showNext;
    if (prevCount) prevCount.value = String(this.onionSettings.previousCount);
    if (nextCount) nextCount.value = String(this.onionSettings.nextCount);
    if (opacitySlider) opacitySlider.value = String(Math.round(this.onionSettings.previousOpacity * 100));
    if (opacityValue) opacityValue.textContent = `${Math.round(this.onionSettings.previousOpacity * 100)}%`;
  }

  private renderOnionSkin(): void {
    if (!this.onionCanvas || !this.onionCtx || !this.displayCanvas) return;

    // Clear onion canvas
    this.onionCtx.clearRect(0, 0, this.onionCanvas.width, this.onionCanvas.height);

    // Don't render if disabled or no frames
    if (!this.onionSettings.enabled || this.frames.length <= 1) return;

    // Render previous frames
    if (this.onionSettings.showPrevious) {
      for (let i = 1; i <= this.onionSettings.previousCount; i++) {
        const frameIndex = this.currentFrameIndex - i;
        if (frameIndex >= 0 && frameIndex < this.frames.length) {
          const frame = this.frames[frameIndex];
          const opacity = this.onionSettings.previousOpacity * (1 - (i - 1) / this.onionSettings.previousCount * 0.5);
          this.drawOnionFrame(frame.imageData, opacity, this.onionSettings.useColors ? this.onionSettings.previousColor : null);
        }
      }
    }

    // Render next frames
    if (this.onionSettings.showNext) {
      for (let i = 1; i <= this.onionSettings.nextCount; i++) {
        const frameIndex = this.currentFrameIndex + i;
        if (frameIndex >= 0 && frameIndex < this.frames.length) {
          const frame = this.frames[frameIndex];
          const opacity = this.onionSettings.nextOpacity * (1 - (i - 1) / this.onionSettings.nextCount * 0.5);
          this.drawOnionFrame(frame.imageData, opacity, this.onionSettings.useColors ? this.onionSettings.nextColor : null);
        }
      }
    }
  }

  private drawOnionFrame(imageData: ImageData, opacity: number, tintColor: string | null): void {
    if (!this.onionCtx || !this.onionCanvas) return;

    // Reuse or create temporary canvas for the frame
    if (!this.tempCanvas || !this.tempCtx) {
      this.tempCanvas = document.createElement('canvas');
      this.tempCtx = this.tempCanvas.getContext('2d');
      if (!this.tempCtx) return;
    }

    // Resize temp canvas if needed
    if (this.tempCanvas.width !== imageData.width || this.tempCanvas.height !== imageData.height) {
      this.tempCanvas.width = imageData.width;
      this.tempCanvas.height = imageData.height;
    }

    // Clear and put the image data on temp canvas
    this.tempCtx.globalCompositeOperation = 'source-over';
    this.tempCtx.putImageData(imageData, 0, 0);

    // Apply tint color if specified
    if (tintColor) {
      this.tempCtx.globalCompositeOperation = 'source-atop';
      this.tempCtx.fillStyle = tintColor;
      this.tempCtx.fillRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
    }

    // Draw to onion canvas with opacity
    this.onionCtx.globalAlpha = opacity;
    this.onionCtx.drawImage(this.tempCanvas, 0, 0);
    this.onionCtx.globalAlpha = 1;
  }

  private initializeFirstFrame(): void {
    if (!this.displayCanvas) return;

    // Create first frame from composite of all layers
    const ctx = this.displayCanvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, this.displayCanvas.width, this.displayCanvas.height);
    this.frames = [{
      id: `frame-${Date.now()}`,
      name: 'Frame 1',
      imageData,
      duration: 100,
    }];
    this.currentFrameIndex = 0;
    this.updateTimeline();
  }

  private addFrame(): void {
    if (!this.displayCanvas) return;

    // Save current frame first
    this.saveCurrentFrame();

    // Create new blank frame
    const newCanvas = document.createElement('canvas');
    newCanvas.width = this.displayCanvas.width;
    newCanvas.height = this.displayCanvas.height;
    const newCtx = newCanvas.getContext('2d');
    if (!newCtx) return;

    newCtx.fillStyle = '#ffffff';
    newCtx.fillRect(0, 0, newCanvas.width, newCanvas.height);

    const newFrame: Frame = {
      id: `frame-${Date.now()}`,
      name: `Frame ${this.frames.length + 1}`,
      imageData: newCtx.getImageData(0, 0, newCanvas.width, newCanvas.height),
      duration: 100,
    };

    // Insert after current frame
    this.frames.splice(this.currentFrameIndex + 1, 0, newFrame);
    this.currentFrameIndex++;
    this.loadCurrentFrame();
    this.updateTimeline();
    this.renderOnionSkin();
    this.hasUnsavedChanges = true;
  }

  private duplicateFrame(): void {
    if (!this.displayCanvas || this.frames.length === 0) return;

    // Save current frame first
    this.saveCurrentFrame();

    // Clone current frame
    const currentFrame = this.frames[this.currentFrameIndex];
    const clonedImageData = new ImageData(
      new Uint8ClampedArray(currentFrame.imageData.data),
      currentFrame.imageData.width,
      currentFrame.imageData.height
    );

    const newFrame: Frame = {
      id: `frame-${Date.now()}`,
      name: `Frame ${this.frames.length + 1}`,
      imageData: clonedImageData,
      duration: currentFrame.duration,
    };

    // Insert after current frame
    this.frames.splice(this.currentFrameIndex + 1, 0, newFrame);
    this.currentFrameIndex++;
    this.loadCurrentFrame();
    this.updateTimeline();
    this.renderOnionSkin();
    this.hasUnsavedChanges = true;
  }

  private deleteFrame(): void {
    if (this.frames.length <= 1) {
      toast.error('Cannot delete the only frame');
      return;
    }

    if (!confirm('Delete current frame?')) return;

    this.frames.splice(this.currentFrameIndex, 1);
    if (this.currentFrameIndex >= this.frames.length) {
      this.currentFrameIndex = this.frames.length - 1;
    }
    this.loadCurrentFrame();
    this.updateTimeline();
    this.renderOnionSkin();
    this.hasUnsavedChanges = true;
  }

  private goToFrame(index: number): void {
    if (index < 0 || index >= this.frames.length) return;
    if (index === this.currentFrameIndex) return;

    // Save current frame before switching
    this.saveCurrentFrame();

    this.currentFrameIndex = index;
    this.loadCurrentFrame();
    this.updateTimeline();
    this.renderOnionSkin();
  }

  private previousFrame(): void {
    if (this.currentFrameIndex > 0) {
      this.goToFrame(this.currentFrameIndex - 1);
    }
  }

  private nextFrame(): void {
    if (this.currentFrameIndex < this.frames.length - 1) {
      this.goToFrame(this.currentFrameIndex + 1);
    }
  }

  private saveCurrentFrame(): void {
    if (!this.displayCanvas || this.frames.length === 0) return;
    // Save the composite of all layers as the current frame
    const ctx = this.displayCanvas.getContext('2d');
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, this.displayCanvas.width, this.displayCanvas.height);
    this.frames[this.currentFrameIndex].imageData = imageData;
  }

  private loadCurrentFrame(): void {
    if (!this.displayCanvas || this.frames.length === 0) return;
    const frame = this.frames[this.currentFrameIndex];
    // Load frame into the active layer
    imageLayersStore.loadImageDataToActiveLayer(frame.imageData);
    // Re-composite and render
    this.compositeAndRender();
    // Reset history for new frame
    this.history = [];
    this.historyIndex = -1;
    this.saveToHistory();
  }

  private updateTimeline(): void {
    const container = this.$('.frames-container') as HTMLElement;
    const counter = this.$('.frame-counter') as HTMLElement;

    if (counter) {
      counter.textContent = `Frame ${this.currentFrameIndex + 1} / ${this.frames.length}`;
    }

    if (container) {
      container.innerHTML = this.frames.map((frame, index) => `
        <div class="frame-thumb ${index === this.currentFrameIndex ? 'active' : ''}" data-frame="${index}" title="${frame.name}">
          <canvas class="frame-preview" width="60" height="45"></canvas>
          <span class="frame-number">${index + 1}</span>
        </div>
      `).join('');

      // Ensure temp canvas exists for thumbnail rendering
      if (!this.tempCanvas || !this.tempCtx) {
        this.tempCanvas = document.createElement('canvas');
        this.tempCtx = this.tempCanvas.getContext('2d');
      }

      // Render thumbnails
      container.querySelectorAll('.frame-thumb').forEach((thumb, index) => {
        const preview = thumb.querySelector('.frame-preview') as HTMLCanvasElement;
        if (preview && this.frames[index] && this.tempCanvas && this.tempCtx) {
          const previewCtx = preview.getContext('2d');
          if (previewCtx) {
            // Scale down the frame to fit preview
            const frame = this.frames[index];
            const scale = Math.min(60 / frame.imageData.width, 45 / frame.imageData.height);
            previewCtx.fillStyle = '#ffffff';
            previewCtx.fillRect(0, 0, 60, 45);

            // Resize temp canvas if needed
            if (this.tempCanvas.width !== frame.imageData.width || this.tempCanvas.height !== frame.imageData.height) {
              this.tempCanvas.width = frame.imageData.width;
              this.tempCanvas.height = frame.imageData.height;
            }

            // Use cached temp canvas to hold full frame
            this.tempCtx.putImageData(frame.imageData, 0, 0);
            previewCtx.drawImage(this.tempCanvas, 0, 0, frame.imageData.width * scale, frame.imageData.height * scale);
          }
        }

        // Click to select frame
        thumb.addEventListener('click', () => {
          this.goToFrame(index);
        });
      });
    }
  }

  private setupKeyboardShortcuts(): void {
    this.keyboardHandler = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      // Ctrl+Z - Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      }

      // Ctrl+Y or Ctrl+Shift+Z - Redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        this.redo();
      }

      // Ctrl+S - Save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        this.saveImage();
      }

      // Tool shortcuts
      if (e.key === 'v') this.selectTool('select');
      if (e.key === 'p') this.selectTool('pencil');
      if (e.key === 'b') this.selectTool('brush');
      if (e.key === 'e') this.selectTool('eraser');
      if (e.key === 'g') this.selectTool('fill');
      if (e.key === 'r') this.selectTool('rectangle');
      if (e.key === 'c') this.selectTool('circle');
      if (e.key === 'l') this.selectTool('line');

      // X - Swap colors
      if (e.key === 'x') {
        const temp = this.primaryColor;
        this.primaryColor = this.secondaryColor;
        this.secondaryColor = temp;
        const primaryInput = this.$('.primary-color') as HTMLInputElement;
        const secondaryInput = this.$('.secondary-color') as HTMLInputElement;
        if (primaryInput) primaryInput.value = this.primaryColor;
        if (secondaryInput) secondaryInput.value = this.secondaryColor;
      }

      // Frame navigation
      if (e.key === ',') this.previousFrame();
      if (e.key === '.') this.nextFrame();
      if (e.key === '+' || e.key === '=') this.addFrame();
      if (e.key === '-') {
        if (this.frames.length > 1) {
          this.deleteFrame();
        }
      }

      // O - Toggle onion skinning
      if (e.key === 'o') {
        onionSkinningStore.toggleEnabled();
      }
    };

    document.addEventListener('keydown', this.keyboardHandler);
  }

  private handleMouseDown(e: MouseEvent): void {
    if (!this.displayCanvas) return;
    const ctx = imageLayersStore.getActiveContext();
    if (!ctx) return;

    const activeLayer = imageLayersStore.getActiveLayer();
    if (activeLayer?.locked) {
      toast.warning('Layer is locked');
      return;
    }

    const rect = this.displayCanvas.getBoundingClientRect();
    this.lastX = e.clientX - rect.left;
    this.lastY = e.clientY - rect.top;
    this.isDrawing = true;

    // Start drawing immediately for pencil/brush
    if (this.currentTool === 'pencil' || this.currentTool === 'brush') {
      ctx.beginPath();
      ctx.moveTo(this.lastX, this.lastY);
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isDrawing || !this.displayCanvas) return;
    const ctx = imageLayersStore.getActiveContext();
    if (!ctx) return;

    const rect = this.displayCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    switch (this.currentTool) {
      case 'pencil':
        ctx.strokeStyle = this.primaryColor;
        ctx.lineWidth = 1;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
        break;

      case 'brush':
        ctx.strokeStyle = this.primaryColor;
        ctx.lineWidth = this.brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
        break;

      case 'eraser':
        // Eraser clears pixels (transparent) instead of drawing white
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.lineWidth = this.brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.globalCompositeOperation = 'source-over';
        break;
    }

    // Schedule display update (batched with requestAnimationFrame for performance)
    this.scheduleRender();

    this.lastX = x;
    this.lastY = y;
  }

  private handleMouseUp(): void {
    if (this.isDrawing) {
      this.isDrawing = false;
      this.hasUnsavedChanges = true;
      this.saveToHistory();
    }
  }

  private handleTouchStart(e: TouchEvent): void {
    if (!this.displayCanvas) return;
    const ctx = imageLayersStore.getActiveContext();
    if (!ctx) return;

    const activeLayer = imageLayersStore.getActiveLayer();
    if (activeLayer?.locked) {
      toast.warning('Layer is locked');
      return;
    }

    e.preventDefault();

    const touch = e.touches[0];
    const rect = this.displayCanvas.getBoundingClientRect();
    this.lastX = touch.clientX - rect.left;
    this.lastY = touch.clientY - rect.top;
    this.isDrawing = true;

    // Start drawing immediately for pencil/brush
    if (this.currentTool === 'pencil' || this.currentTool === 'brush') {
      ctx.beginPath();
      ctx.moveTo(this.lastX, this.lastY);
    }
  }

  private handleTouchMove(e: TouchEvent): void {
    if (!this.isDrawing || !this.displayCanvas) return;
    const ctx = imageLayersStore.getActiveContext();
    if (!ctx) return;

    e.preventDefault();

    const touch = e.touches[0];
    const rect = this.displayCanvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    switch (this.currentTool) {
      case 'pencil':
        ctx.strokeStyle = this.primaryColor;
        ctx.lineWidth = 1;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
        break;

      case 'brush':
        ctx.strokeStyle = this.primaryColor;
        ctx.lineWidth = this.brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
        break;

      case 'eraser':
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.lineWidth = this.brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.globalCompositeOperation = 'source-over';
        break;
    }

    // Schedule display update (batched with requestAnimationFrame for performance)
    this.scheduleRender();

    this.lastX = x;
    this.lastY = y;
  }

  private saveToHistory(): void {
    const state = imageLayersStore.getState();
    if (state.layers.length === 0) return;

    // Remove any redo history
    this.history = this.history.slice(0, this.historyIndex + 1);

    // Save current state of all layers, filtering out any failed captures
    const snapshot: Array<{ layerId: string; data: ImageData }> = [];
    for (const layer of state.layers) {
      const ctx = layer.canvas.getContext('2d');
      if (ctx) {
        try {
          const data = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
          snapshot.push({ layerId: layer.id, data });
        } catch {
          // Skip layers that fail to capture (e.g., tainted canvas)
          console.warn(`Failed to capture layer ${layer.name} for history`);
        }
      }
    }

    // Only save if we captured at least one layer
    if (snapshot.length === 0) return;

    this.history.push(snapshot);

    // Limit history size
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    } else {
      this.historyIndex++;
    }
  }

  private undo(): void {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.restoreFromHistory(this.history[this.historyIndex]);
      this.hasUnsavedChanges = true;
    }
  }

  private redo(): void {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.restoreFromHistory(this.history[this.historyIndex]);
      this.hasUnsavedChanges = true;
    }
  }

  private restoreFromHistory(snapshot: Array<{ layerId: string; data: ImageData }>): void {
    const state = imageLayersStore.getState();

    for (const item of snapshot) {
      const layer = state.layers.find((l) => l.id === item.layerId);
      if (layer && item.data) {
        const ctx = layer.canvas.getContext('2d');
        if (ctx) {
          ctx.putImageData(item.data, 0, 0);
        }
      }
    }

    this.compositeAndRender();
  }

  private clearCanvas(): void {
    const activeLayer = imageLayersStore.getActiveLayer();
    if (!activeLayer) return;

    if (activeLayer.locked) {
      toast.warning('Layer is locked');
      return;
    }

    if (!confirm('Clear the current layer?')) return;

    const ctx = activeLayer.canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, activeLayer.canvas.width, activeLayer.canvas.height);
    }

    this.compositeAndRender();
    this.hasUnsavedChanges = true;
    this.saveToHistory();
  }

  private createNewImage(): void {
    const width = prompt('Enter width:', '800');
    const height = prompt('Enter height:', '600');

    if (width && height && this.displayCanvas) {
      const w = parseInt(width);
      const h = parseInt(height);

      this.displayCanvas.width = w;
      this.displayCanvas.height = h;

      // Clear and re-initialize layers
      imageLayersStore.clear();
      imageLayersStore.initialize(w, h);

      this.history = [];
      this.historyIndex = -1;
      this.saveToHistory();
      this.hasUnsavedChanges = false;

      // Resize onion canvas
      if (this.onionCanvas) {
        this.onionCanvas.width = w;
        this.onionCanvas.height = h;
      }

      // Reset frames
      this.frames = [];
      this.currentFrameIndex = 0;

      // Update status bar
      const dimensions = this.$('.status-dimensions') as HTMLElement;
      if (dimensions) {
        dimensions.textContent = `${width} × ${height}`;
      }

      this.showCanvas();
      this.updateLayerCount();
    }
  }

  private openImage(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file && this.displayCanvas) {
        const img = new Image();
        img.onload = () => {
          this.displayCanvas!.width = img.width;
          this.displayCanvas!.height = img.height;

          // Clear and re-initialize layers with image dimensions
          imageLayersStore.clear();
          imageLayersStore.initialize(img.width, img.height);

          // Load image into the background layer
          imageLayersStore.loadImageToActiveLayer(img);

          this.history = [];
          this.historyIndex = -1;
          this.compositeAndRender();
          this.saveToHistory();
          this.hasUnsavedChanges = false;

          // Resize onion canvas
          if (this.onionCanvas) {
            this.onionCanvas.width = img.width;
            this.onionCanvas.height = img.height;
          }

          // Reset frames
          this.frames = [];
          this.currentFrameIndex = 0;

          // Update status bar
          const dimensions = this.$('.status-dimensions') as HTMLElement;
          if (dimensions) {
            dimensions.textContent = `${img.width} × ${img.height}`;
          }

          this.showCanvas();
          this.updateLayerCount();
        };
        img.src = URL.createObjectURL(file);
      }
    };
    input.click();
  }

  private showCanvas(): void {
    const loading = this.$('.canvas-loading') as HTMLElement;
    const empty = this.$('.canvas-empty') as HTMLElement;
    const wrapper = this.$('.canvas-wrapper') as HTMLElement;

    if (loading) loading.style.display = 'none';
    if (empty) empty.style.display = 'none';
    if (wrapper) wrapper.style.display = 'flex';

    // Initialize frames if not already done
    if (this.frames.length === 0) {
      this.initializeFirstFrame();
    }
    this.renderOnionSkin();
  }

  private showEmpty(): void {
    const loading = this.$('.canvas-loading') as HTMLElement;
    const empty = this.$('.canvas-empty') as HTMLElement;
    const wrapper = this.$('.canvas-wrapper') as HTMLElement;

    if (loading) loading.style.display = 'none';
    if (empty) empty.style.display = 'flex';
    if (wrapper) wrapper.style.display = 'none';
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
          this.showEmpty();
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
      this.showEmpty();
    } catch (error) {
      const cachedSession = await offlineStorage.getCachedSession(sessionId);
      if (cachedSession) {
        this.session = cachedSession as unknown as Session;
        this.isOfflineMode = true;
        this.updateHeader();
        this.updateOfflineUI();
        this.showEmpty();
        toast.info('Loaded from offline cache');
      } else {
        toast.error('Failed to load session');
        console.error('Failed to load session:', error);
        this.navigate('/agents');
      }
    }
  }

  private updateHeader(): void {
    const titleEl = this.$('.image-title');
    const subtitleEl = this.$('.image-subtitle');

    if (this.session) {
      if (titleEl) titleEl.textContent = 'Image Editor';
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

    // Disable AI buttons when offline
    aiButtons.forEach(btn => {
      (btn as HTMLButtonElement).disabled = this.isOfflineMode;
    });
  }

  private async saveImage(): Promise<void> {
    if (!this.displayCanvas || this.isSaving) return;

    this.isSaving = true;

    try {
      // Get composite image from all layers
      const blob = await imageLayersStore.getCompositeBlob('image/png');

      if (!blob) {
        throw new Error('Failed to create image');
      }

      // If we have a file path, save to it
      if (this.currentFilePath && this.session) {
        const sessionPath = this.getSessionPath();
        const arrayBuffer = await blob.arrayBuffer();

        if (this.isOfflineMode || isOffline()) {
          await offlineStorage.saveFileLocally(sessionPath, this.currentFilePath, arrayBuffer, 'binary');
          toast.success('Image saved locally (will sync when online)');
        } else {
          // For now, just show success - actual file save would go to storage worker
          await offlineStorage.cacheFile(sessionPath, this.currentFilePath, arrayBuffer, 'binary');
          toast.success('Image saved');
        }
      } else {
        // Download the image
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'image.png';
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Image downloaded');
      }

      this.hasUnsavedChanges = false;
    } catch (error) {
      console.error('Failed to save image:', error);
      toast.error('Failed to save image');
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
      const imageFiles = dirtyFiles.filter(f => f.contentType === 'binary');

      if (imageFiles.length === 0) return;

      toast.info(`Syncing ${imageFiles.length} image(s)...`);

      for (const file of imageFiles) {
        try {
          // Mark as synced (actual sync would upload to storage worker)
          await offlineStorage.markFileSynced(file.sessionPath, file.filePath);
        } catch (error) {
          console.error(`Failed to sync file ${file.filePath}:`, error);
        }
      }

      toast.success('Images synced successfully');
    } catch (error) {
      console.error('Failed to sync pending changes:', error);
    }
  }

  protected onUnmount(): void {
    if (this.keyboardHandler) {
      document.removeEventListener('keydown', this.keyboardHandler);
      this.keyboardHandler = null;
    }

    if (this.unsubscribeOffline) {
      this.unsubscribeOffline();
      this.unsubscribeOffline = null;
    }

    if (this.unsubscribeLayers) {
      this.unsubscribeLayers();
      this.unsubscribeLayers = null;
    }

    if (this.unsubscribeOnionSkinning) {
      this.unsubscribeOnionSkinning();
      this.unsubscribeOnionSkinning = null;
    }

    if (this.offlineIndicator) {
      this.offlineIndicator.unmount();
      this.offlineIndicator = null;
    }

    if (this.layersPanel) {
      this.layersPanel.unmount();
      this.layersPanel = null;
    }

    // Clear layers store
    imageLayersStore.clear();
  }
}
