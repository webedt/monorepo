/**
 * SceneViewport Component
 * Canvas-based 2D viewport with center-origin coordinate system
 * Handles rendering, mouse events, panning, and zooming
 */

import { Component } from '../base/Component';
import { Viewport } from '../../lib/viewport';
import { SpriteRenderer } from '../../lib/sprite';
import { sceneStore } from '../../stores/sceneStore';
import { editModeStore } from '../../stores/editModeStore';
import { customComponentsStore } from '../../stores';

import type { SceneObject, Scene } from '../../stores/sceneStore';
import type { EditMode } from '../../stores/editModeStore';
import type { CustomComponentChild } from '../../types';

export interface SceneViewportOptions {
  width?: number;
  height?: number;
  showGrid?: boolean;
  showOriginCrosshair?: boolean;
  onObjectSelect?: (objectId: string | null, multiSelect: boolean) => void;
  onObjectDrag?: (objectId: string, x: number, y: number) => void;
  onDrawModeClick?: (worldPos: { x: number; y: number }, mode: EditMode) => void;
  onZoomChange?: (zoom: number) => void;
  onMouseMove?: (worldPos: { x: number; y: number }) => void;
}

export class SceneViewport extends Component<HTMLDivElement> {
  private options: SceneViewportOptions;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private viewport: Viewport | null = null;
  private spriteRenderer: SpriteRenderer = new SpriteRenderer();

  // Interaction state
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private isPanning = false;
  private panStart = { x: 0, y: 0 };
  private selectedObjectId: string | null = null;
  private showOriginCrosshair = true;
  private showGrid = true;

  // Event handlers for cleanup
  private boundHandleMouseDown: ((e: MouseEvent) => void) | null = null;
  private boundHandleMouseMove: ((e: MouseEvent) => void) | null = null;
  private boundHandleMouseUp: (() => void) | null = null;
  private boundHandleWheel: ((e: WheelEvent) => void) | null = null;

  constructor(options: SceneViewportOptions = {}) {
    super('div', { className: 'scene-viewport' });
    this.options = {
      width: 1280,
      height: 720,
      showGrid: true,
      showOriginCrosshair: true,
      ...options,
    };
    this.showGrid = this.options.showGrid ?? true;
    this.showOriginCrosshair = this.options.showOriginCrosshair ?? true;
  }

  protected onMount(): void {
    this.render();
    this.setupCanvas();
  }

  protected onUnmount(): void {
    this.removeCanvasListeners();
  }

  render(): this {
    this.element.innerHTML = `
      <div class="scene-canvas-wrapper">
        <canvas class="scene-canvas" width="${this.options.width}" height="${this.options.height}"></canvas>
      </div>
    `;
    return this;
  }

  private setupCanvas(): void {
    this.canvas = this.element.querySelector('.scene-canvas') as HTMLCanvasElement;
    if (!this.canvas) return;

    this.ctx = this.canvas.getContext('2d');

    // Initialize viewport with center-origin coordinate system
    this.viewport = new Viewport({
      width: this.canvas.width,
      height: this.canvas.height,
      zoom: 1,
    });

    // Create bound handlers for cleanup
    this.boundHandleMouseDown = (e: MouseEvent) => this.handleMouseDown(e);
    this.boundHandleMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
    this.boundHandleMouseUp = () => this.handleMouseUp();
    this.boundHandleWheel = (e: WheelEvent) => this.handleWheel(e);

    // Mouse events
    this.canvas.addEventListener('mousedown', this.boundHandleMouseDown);
    this.canvas.addEventListener('mousemove', this.boundHandleMouseMove);
    this.canvas.addEventListener('mouseup', this.boundHandleMouseUp);
    this.canvas.addEventListener('mouseleave', this.boundHandleMouseUp);
    this.canvas.addEventListener('wheel', this.boundHandleWheel);
  }

  private removeCanvasListeners(): void {
    if (!this.canvas) return;

    if (this.boundHandleMouseDown) {
      this.canvas.removeEventListener('mousedown', this.boundHandleMouseDown);
    }
    if (this.boundHandleMouseMove) {
      this.canvas.removeEventListener('mousemove', this.boundHandleMouseMove);
    }
    if (this.boundHandleMouseUp) {
      this.canvas.removeEventListener('mouseup', this.boundHandleMouseUp);
      this.canvas.removeEventListener('mouseleave', this.boundHandleMouseUp);
    }
    if (this.boundHandleWheel) {
      this.canvas.removeEventListener('wheel', this.boundHandleWheel);
    }
  }

  private handleMouseDown(e: MouseEvent): void {
    if (!this.canvas || !this.viewport) return;

    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const worldPos = this.viewport.screenToWorld(screenX, screenY);
    const currentMode = editModeStore.getMode();

    // Middle mouse button or shift+click for panning, or pan mode
    if (e.button === 1 || (e.button === 0 && e.shiftKey) || currentMode === 'pan') {
      this.isPanning = true;
      this.panStart = { x: screenX, y: screenY };
      this.canvas.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }

    // Handle draw modes
    if (currentMode.startsWith('draw-') && e.button === 0) {
      this.options.onDrawModeClick?.(worldPos, currentMode);
      return;
    }

    // Select mode: find clicked object
    if (currentMode === 'select') {
      const activeScene = sceneStore.getActiveScene();
      const objects = activeScene?.objects || [];
      const sortedByZ = this.getObjectsSortedByZ(objects, false);

      let clickedObject: SceneObject | null = null;
      for (const obj of sortedByZ) {
        if (this.isPointInObject(worldPos.x, worldPos.y, obj)) {
          clickedObject = obj;
          break;
        }
      }

      const isMultiSelect = e.ctrlKey || e.metaKey;

      if (clickedObject && !clickedObject.locked) {
        this.selectedObjectId = clickedObject.id;
        this.isDragging = true;
        this.dragStart = {
          x: worldPos.x - clickedObject.transform.x,
          y: worldPos.y - clickedObject.transform.y,
        };
        this.options.onObjectSelect?.(clickedObject.id, isMultiSelect);
      } else {
        if (!isMultiSelect) {
          this.selectedObjectId = null;
          this.options.onObjectSelect?.(null, false);
        }
      }
    }

    this.renderScene();
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.canvas || !this.viewport) return;

    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPos = this.viewport.screenToWorld(screenX, screenY);

    this.options.onMouseMove?.(worldPos);

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

    const activeScene = sceneStore.getActiveScene();
    if (!activeScene) return;

    const snapToGrid = activeScene.settings.snapToGrid ?? true;
    const gridSize = activeScene.settings.gridSize ?? 32;

    let x = worldPos.x - this.dragStart.x;
    let y = worldPos.y - this.dragStart.y;

    if (snapToGrid) {
      x = Math.round(x / gridSize) * gridSize;
      y = Math.round(y / gridSize) * gridSize;
    }

    this.options.onObjectDrag?.(this.selectedObjectId, x, y);
  }

  private handleMouseUp(): void {
    this.isDragging = false;
    this.isPanning = false;
    this.updateCursor();
  }

  private handleWheel(e: WheelEvent): void {
    if (!this.viewport || !this.canvas) return;

    e.preventDefault();

    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const normalizedDelta = Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 100);
    const zoomDelta = -normalizedDelta * 0.002;
    this.viewport.zoomToPoint(screenX, screenY, zoomDelta);

    this.options.onZoomChange?.(this.viewport.zoom);
    this.renderScene();
  }

  private getObjectsSortedByZ(objects: SceneObject[], ascending: boolean): SceneObject[] {
    return [...objects].sort((a, b) => ascending ? a.zIndex - b.zIndex : b.zIndex - a.zIndex);
  }

  private isPointInObject(x: number, y: number, obj: SceneObject): boolean {
    const dims = this.getObjectDimensions(obj);
    const pivotX = obj.transform.pivotX ?? 0.5;
    const pivotY = obj.transform.pivotY ?? 0.5;
    const pivotOffsetX = dims.width * pivotX;
    const pivotOffsetY = dims.height * pivotY;

    let localX = x - obj.transform.x;
    let localY = y - obj.transform.y;

    const angle = -(obj.transform.rotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotatedX = localX * cos - localY * sin;
    const rotatedY = localX * sin + localY * cos;
    localX = rotatedX;
    localY = rotatedY;

    const scaleX = obj.transform.scaleX || 0.001;
    const scaleY = obj.transform.scaleY || 0.001;
    localX /= scaleX;
    localY /= scaleY;

    localX += pivotOffsetX;
    localY += pivotOffsetY;

    return localX >= 0 && localX <= dims.width && localY >= 0 && localY <= dims.height;
  }

  private getObjectDimensions(obj: SceneObject): { width: number; height: number } {
    switch (obj.type) {
      case 'sprite':
        if (obj.spriteUrl && this.spriteRenderer.isLoaded(obj.id)) {
          const info = this.spriteRenderer.getInfo(obj.id);
          if (info) {
            return { width: obj.spriteWidth ?? info.width, height: obj.spriteHeight ?? info.height };
          }
        }
        return { width: obj.spriteWidth ?? 100, height: obj.spriteHeight ?? 100 };
      case 'shape':
        if (obj.shapeType === 'rectangle') return { width: 100, height: 80 };
        if (obj.shapeType === 'circle') return { width: 100, height: 100 };
        return { width: 100, height: 100 };
      case 'text':
        const fontSize = obj.fontSize || 24;
        const textLength = (obj.text || 'Text').length;
        return { width: textLength * fontSize * 0.6, height: fontSize * 1.2 };
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

  private getCustomComponentBounds(children: CustomComponentChild[]): { width: number; height: number } {
    if (children.length === 0) return { width: 100, height: 100 };

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const child of children) {
      let childWidth = 100, childHeight = 100;
      if (child.type === 'shape' && child.shapeType === 'rectangle') {
        childWidth = 100;
        childHeight = 80;
      } else if (child.type === 'text') {
        const fontSize = child.fontSize || 24;
        childWidth = (child.text || 'Text').length * fontSize * 0.6;
        childHeight = fontSize * 1.2;
      }

      const pivotX = child.transform.pivotX ?? 0.5;
      const pivotY = child.transform.pivotY ?? 0.5;
      const left = child.transform.x - childWidth * pivotX;
      const right = left + childWidth;
      const top = child.transform.y - childHeight * pivotY;
      const bottom = top + childHeight;

      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
      maxX = Math.max(maxX, right);
      maxY = Math.max(maxY, bottom);
    }

    return { width: Math.max(maxX - minX, 50), height: Math.max(maxY - minY, 50) };
  }

  // Public API
  renderScene(): void {
    if (!this.ctx || !this.canvas || !this.viewport) return;

    const { width, height } = this.canvas;
    const activeScene = sceneStore.getActiveScene();
    const objects = activeScene?.objects || [];
    const showGridSetting = activeScene?.settings.showGrid ?? true;

    this.ctx.fillStyle = '#f0f0f0';
    this.ctx.fillRect(0, 0, width, height);

    if (this.showGrid && showGridSetting) {
      this.drawCenteredGrid(activeScene);
    }

    if (this.showOriginCrosshair) {
      this.drawOriginCrosshair();
    }

    this.ctx.save();
    this.viewport.applyTransform(this.ctx);
    this.ctx.scale(1, -1);

    const sortedObjects = this.getObjectsSortedByZ(objects, true);

    for (const obj of sortedObjects) {
      if (!obj.visible) continue;
      this.renderObject(obj);
    }

    this.ctx.restore();
  }

  private renderObject(obj: SceneObject): void {
    if (!this.ctx) return;

    const dims = this.getObjectDimensions(obj);
    const pivotX = obj.transform.pivotX ?? 0.5;
    const pivotY = obj.transform.pivotY ?? 0.5;
    const pivotOffsetX = dims.width * pivotX;
    const pivotOffsetY = dims.height * pivotY;

    this.ctx.save();
    this.ctx.globalAlpha = obj.opacity;
    this.ctx.translate(obj.transform.x, obj.transform.y);
    this.ctx.rotate((obj.transform.rotation * Math.PI) / 180);
    this.ctx.scale(obj.transform.scaleX, obj.transform.scaleY);
    this.ctx.translate(-pivotOffsetX, -pivotOffsetY);

    switch (obj.type) {
      case 'sprite':
        this.renderSprite(obj, dims);
        break;
      case 'shape':
        this.renderShape(obj);
        break;
      case 'text':
        this.renderText(obj);
        break;
      case 'ui-button':
        this.renderUIButton(obj, dims);
        break;
      case 'ui-panel':
        this.renderUIPanel(obj, dims);
        break;
      case 'ui-text':
        this.renderUIText(obj);
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

    if (obj.id === this.selectedObjectId) {
      this.drawSelectionOutline(obj, dims, pivotOffsetX, pivotOffsetY);
    }
  }

  private renderSprite(obj: SceneObject, _dims: { width: number; height: number }): void {
    if (!this.ctx) return;

    if (obj.spriteUrl && this.spriteRenderer.isLoaded(obj.id)) {
      const info = this.spriteRenderer.getInfo(obj.id);
      if (info?.image) {
        const w = obj.spriteWidth ?? info.width;
        const h = obj.spriteHeight ?? info.height;
        this.ctx.drawImage(info.image, 0, -h, w, h);
        return;
      }
    }

    // Placeholder
    const w = obj.spriteWidth ?? 100;
    const h = obj.spriteHeight ?? 100;
    const checkSize = 10;

    for (let cy = 0; cy < h; cy += checkSize) {
      for (let cx = 0; cx < w; cx += checkSize) {
        this.ctx.fillStyle = ((cx + cy) / checkSize) % 2 === 0 ? '#ccc' : '#fff';
        this.ctx.fillRect(cx, -h + cy, checkSize, checkSize);
      }
    }

    this.ctx.strokeStyle = '#999';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(0, -h, w, h);

    this.ctx.save();
    this.ctx.translate(w / 2, -h / 2);
    this.ctx.scale(1, -1);
    this.ctx.fillStyle = '#666';
    this.ctx.font = `${Math.min(w, h) * 0.4}px Arial`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('🖼', 0, 0);
    this.ctx.restore();
  }

  private renderShape(obj: SceneObject): void {
    if (!this.ctx) return;

    this.ctx.fillStyle = obj.color || '#e74c3c';
    if (obj.shapeType === 'rectangle') {
      this.ctx.fillRect(0, -80, 100, 80);
    } else if (obj.shapeType === 'circle') {
      this.ctx.beginPath();
      this.ctx.arc(50, -50, 50, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  private renderText(obj: SceneObject): void {
    if (!this.ctx) return;

    this.ctx.fillStyle = obj.color || '#333';
    this.ctx.font = `${obj.fontSize || 24}px ${obj.fontFamily || 'Arial'}`;
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'bottom';
    this.ctx.fillText(obj.text || 'Text', 0, 0);
  }

  private renderUIButton(obj: SceneObject, dims: { width: number; height: number }): void {
    if (!this.ctx) return;

    const { width, height } = dims;
    const radius = obj.uiCornerRadius || 6;

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
    }

    if (bgColor !== 'transparent') {
      this.ctx.fillStyle = bgColor;
      this.drawRoundedRect(0, -height, width, height, radius);
      this.ctx.fill();
    }

    if (borderWidth > 0) {
      this.ctx.strokeStyle = borderColor;
      this.ctx.lineWidth = borderWidth;
      this.drawRoundedRect(0, -height, width, height, radius);
      this.ctx.stroke();
    }

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
    const bgColor = obj.uiBackgroundColor || '#ffffff';
    const borderColor = obj.uiBorderColor || '#e5e7eb';
    const borderWidth = obj.uiBorderWidth || 1;

    this.ctx.fillStyle = bgColor;
    this.drawRoundedRect(0, -height, width, height, radius);
    this.ctx.fill();

    if (borderWidth > 0) {
      this.ctx.strokeStyle = borderColor;
      this.ctx.lineWidth = borderWidth;
      this.drawRoundedRect(0, -height, width, height, radius);
      this.ctx.stroke();
    }

    this.ctx.fillStyle = borderColor;
    this.ctx.fillRect(0, -height, width, 24);
    this.ctx.fillStyle = '#6b7280';
    this.ctx.font = '12px Arial';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(obj.name || 'Panel', 8, -height + 12);
  }

  private renderUIText(obj: SceneObject): void {
    if (!this.ctx) return;

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

    this.ctx.fillStyle = obj.uiBackgroundColor || '#f3f4f6';
    this.drawRoundedRect(0, -height, width, height, radius);
    this.ctx.fill();

    if (obj.uiBorderWidth && obj.uiBorderWidth > 0) {
      this.ctx.strokeStyle = obj.uiBorderColor || '#d1d5db';
      this.ctx.lineWidth = obj.uiBorderWidth;
      this.drawRoundedRect(0, -height, width, height, radius);
      this.ctx.stroke();
    }

    this.ctx.save();
    this.ctx.translate(width / 2, -height / 2);
    this.ctx.scale(1, -1);
    this.ctx.fillStyle = '#9ca3af';
    this.ctx.font = `${Math.min(width, height) * 0.4}px Arial`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('🖼', 0, 0);
    this.ctx.restore();
  }

  private renderUISlider(obj: SceneObject, dims: { width: number; height: number }): void {
    if (!this.ctx) return;

    const { width, height } = dims;
    const trackHeight = 6;
    const value = (obj.uiValue ?? 50) / 100;
    const trackY = -height / 2 - trackHeight / 2;

    this.ctx.fillStyle = '#e5e7eb';
    this.drawRoundedRect(0, trackY, width, trackHeight, trackHeight / 2);
    this.ctx.fill();

    this.ctx.fillStyle = obj.uiBackgroundColor || '#3b82f6';
    this.drawRoundedRect(0, trackY, width * value, trackHeight, trackHeight / 2);
    this.ctx.fill();

    const thumbX = width * value;
    const thumbRadius = height / 2 - 2;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.strokeStyle = obj.uiBorderColor || '#3b82f6';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(thumbX, -height / 2, thumbRadius, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();
  }

  private renderUIProgressBar(obj: SceneObject, dims: { width: number; height: number }): void {
    if (!this.ctx) return;

    const { width, height } = dims;
    const radius = obj.uiCornerRadius || 4;
    const value = (obj.uiValue ?? 50) / 100;

    this.ctx.fillStyle = obj.uiBackgroundColor || '#e5e7eb';
    this.drawRoundedRect(0, -height, width, height, radius);
    this.ctx.fill();

    this.ctx.fillStyle = obj.uiBorderColor || '#3b82f6';
    if (value > 0) {
      this.drawRoundedRect(0, -height, width * value, height, radius);
      this.ctx.fill();
    }
  }

  private renderUICheckbox(obj: SceneObject, dims: { width: number; height: number }): void {
    if (!this.ctx) return;

    const { height } = dims;
    const boxSize = Math.min(height, 20);
    const boxY = -height / 2 - boxSize / 2;
    const isChecked = obj.uiChecked ?? false;

    this.ctx.fillStyle = isChecked ? (obj.uiBackgroundColor || '#3b82f6') : '#ffffff';
    this.ctx.strokeStyle = isChecked ? 'transparent' : (obj.uiBorderColor || '#d1d5db');
    this.ctx.lineWidth = 2;
    this.drawRoundedRect(0, boxY, boxSize, boxSize, 4);
    this.ctx.fill();
    if (!isChecked) this.ctx.stroke();

    if (isChecked) {
      this.ctx.strokeStyle = '#ffffff';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(4, boxY + boxSize / 2);
      this.ctx.lineTo(boxSize / 2 - 1, boxY + boxSize - 4);
      this.ctx.lineTo(boxSize - 3, boxY + 4);
      this.ctx.stroke();
    }

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
      this.ctx.fillStyle = '#f0f0f0';
      this.ctx.strokeStyle = '#ff6666';
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([5, 5]);
      this.ctx.fillRect(0, -dims.height, dims.width, dims.height);
      this.ctx.strokeRect(0, -dims.height, dims.width, dims.height);
      this.ctx.setLineDash([]);

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

    this.ctx.fillStyle = '#e8f4e8';
    this.ctx.strokeStyle = '#4caf50';
    this.ctx.lineWidth = 1;
    this.ctx.fillRect(0, -dims.height, dims.width, dims.height);
    this.ctx.strokeRect(0, -dims.height, dims.width, dims.height);

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

  private drawSelectionOutline(
    obj: SceneObject,
    dims: { width: number; height: number },
    pivotOffsetX: number,
    pivotOffsetY: number
  ): void {
    if (!this.ctx) return;

    this.ctx.save();
    this.ctx.translate(obj.transform.x, obj.transform.y);
    this.ctx.rotate((obj.transform.rotation * Math.PI) / 180);
    this.ctx.scale(obj.transform.scaleX, obj.transform.scaleY);
    this.ctx.translate(-pivotOffsetX, -pivotOffsetY);

    const maxScale = Math.max(Math.abs(obj.transform.scaleX), Math.abs(obj.transform.scaleY), 0.001);

    this.ctx.strokeStyle = '#0066ff';
    this.ctx.lineWidth = 2 / maxScale;
    this.ctx.setLineDash([5, 5]);
    this.ctx.strokeRect(-2, -2, dims.width + 4, dims.height + 4);
    this.ctx.setLineDash([]);

    const handleSize = 8 / maxScale;
    this.ctx.fillStyle = '#0066ff';
    this.ctx.fillRect(-handleSize / 2, -handleSize / 2, handleSize, handleSize);
    this.ctx.fillRect(dims.width - handleSize / 2, -handleSize / 2, handleSize, handleSize);
    this.ctx.fillRect(-handleSize / 2, dims.height - handleSize / 2, handleSize, handleSize);
    this.ctx.fillRect(dims.width - handleSize / 2, dims.height - handleSize / 2, handleSize, handleSize);

    this.ctx.translate(pivotOffsetX, pivotOffsetY);
    const pivotSize = 6 / maxScale;

    this.ctx.strokeStyle = '#ff6600';
    this.ctx.lineWidth = 2 / maxScale;
    this.ctx.beginPath();
    this.ctx.moveTo(-pivotSize, 0);
    this.ctx.lineTo(pivotSize, 0);
    this.ctx.moveTo(0, -pivotSize);
    this.ctx.lineTo(0, pivotSize);
    this.ctx.stroke();

    this.ctx.fillStyle = '#ff6600';
    this.ctx.beginPath();
    this.ctx.arc(0, 0, pivotSize / 2, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.restore();
  }

  private drawCenteredGrid(scene: Scene | null): void {
    if (!this.ctx || !this.viewport) return;

    const gridSize = scene?.settings.gridSize ?? 32;
    const bounds = this.viewport.getVisibleBounds();

    const minPixelSpacing = 5;
    const screenGridSize = this.viewport.worldDistanceToScreen(gridSize);
    let effectiveGridSize = gridSize;
    if (screenGridSize < minPixelSpacing) {
      const scaleFactor = Math.ceil(minPixelSpacing / screenGridSize);
      effectiveGridSize = gridSize * scaleFactor;
    }

    const maxLines = 200;
    const horizontalLines = Math.ceil((bounds.maxX - bounds.minX) / effectiveGridSize);
    const verticalLines = Math.ceil((bounds.maxY - bounds.minY) / effectiveGridSize);
    if (horizontalLines > maxLines || verticalLines > maxLines) return;

    const startX = Math.floor(bounds.minX / effectiveGridSize) * effectiveGridSize;
    const endX = Math.ceil(bounds.maxX / effectiveGridSize) * effectiveGridSize;
    const startY = Math.floor(bounds.minY / effectiveGridSize) * effectiveGridSize;
    const endY = Math.ceil(bounds.maxY / effectiveGridSize) * effectiveGridSize;

    this.ctx.strokeStyle = '#ddd';
    this.ctx.lineWidth = 1;

    for (let x = startX; x <= endX; x += effectiveGridSize) {
      const screenStart = this.viewport.worldToScreen(x, bounds.minY);
      const screenEnd = this.viewport.worldToScreen(x, bounds.maxY);
      this.ctx.beginPath();
      this.ctx.moveTo(Math.round(screenStart.x) + 0.5, screenStart.y);
      this.ctx.lineTo(Math.round(screenEnd.x) + 0.5, screenEnd.y);
      this.ctx.stroke();
    }

    for (let y = startY; y <= endY; y += effectiveGridSize) {
      const screenStart = this.viewport.worldToScreen(bounds.minX, y);
      const screenEnd = this.viewport.worldToScreen(bounds.maxX, y);
      this.ctx.beginPath();
      this.ctx.moveTo(screenStart.x, Math.round(screenStart.y) + 0.5);
      this.ctx.lineTo(screenEnd.x, Math.round(screenEnd.y) + 0.5);
      this.ctx.stroke();
    }
  }

  private drawOriginCrosshair(): void {
    if (!this.ctx || !this.viewport || !this.canvas) return;

    const origin = this.viewport.worldToScreen(0, 0);
    const { width, height } = this.canvas;

    this.ctx.strokeStyle = '#ff4444';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(0, origin.y);
    this.ctx.lineTo(width, origin.y);
    this.ctx.stroke();

    this.ctx.strokeStyle = '#44ff44';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(origin.x, 0);
    this.ctx.lineTo(origin.x, height);
    this.ctx.stroke();

    this.ctx.fillStyle = '#ffffff';
    this.ctx.strokeStyle = '#333333';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(origin.x, origin.y, 6, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();

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

  private updateCursor(): void {
    if (!this.canvas) return;
    const mode = editModeStore.getMode();

    switch (mode) {
      case 'pan':
        this.canvas.style.cursor = 'grab';
        break;
      case 'draw-rectangle':
      case 'draw-circle':
      case 'draw-text':
        this.canvas.style.cursor = 'crosshair';
        break;
      default:
        this.canvas.style.cursor = 'default';
    }
  }

  // Public methods
  setSelectedObject(objectId: string | null): void {
    this.selectedObjectId = objectId;
    this.renderScene();
  }

  setShowGrid(show: boolean): void {
    this.showGrid = show;
    this.renderScene();
  }

  setShowOriginCrosshair(show: boolean): void {
    this.showOriginCrosshair = show;
    this.renderScene();
  }

  resetView(): void {
    if (this.viewport) {
      this.viewport.reset();
      this.options.onZoomChange?.(this.viewport.zoom);
      this.renderScene();
    }
  }

  getZoom(): number {
    return this.viewport?.zoom ?? 1;
  }

  getSpriteRenderer(): SpriteRenderer {
    return this.spriteRenderer;
  }

  loadSprite(objectId: string, url: string): Promise<void> {
    return this.spriteRenderer.load(objectId, url).then(() => {
      this.renderScene();
    });
  }
}
