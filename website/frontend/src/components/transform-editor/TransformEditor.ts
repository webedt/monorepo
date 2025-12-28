/**
 * TransformEditor Component
 * A reusable component for editing position, rotation, and scale properties
 */

import { Component } from '../base/Component.js';
import type { ComponentOptions } from '../base/Component.js';
import './transform-editor.css';

export interface Transform {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface TransformEditorOptions extends ComponentOptions {
  /** Initial transform values */
  transform?: Partial<Transform>;
  /** Whether to link scaleX and scaleY */
  linkScale?: boolean;
  /** Show position fields */
  showPosition?: boolean;
  /** Show rotation field */
  showRotation?: boolean;
  /** Show scale fields */
  showScale?: boolean;
  /** Step value for position inputs */
  positionStep?: number;
  /** Step value for rotation input */
  rotationStep?: number;
  /** Step value for scale inputs */
  scaleStep?: number;
  /** Callback when transform changes */
  onChange?: (transform: Transform) => void;
  /** Enable compact mode */
  compact?: boolean;
  /** Show labels */
  showLabels?: boolean;
}

const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
};

// SVG icon paths for link/unlink button
const LINK_ICON = '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>';
const UNLINK_ICON = '<path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-3 3a5 5 0 0 0 .54 7.54"/><path d="M5.16 11.75l-1.72 1.71a5 5 0 0 0 7.07 7.07l3-3a5 5 0 0 0-.54-7.54"/><line x1="2" y1="2" x2="22" y2="22"/>';

export class TransformEditor extends Component<HTMLDivElement> {
  private transform: Transform;
  private linkScale: boolean;
  private options: TransformEditorOptions;

  // Input references
  private xInput: HTMLInputElement | null = null;
  private yInput: HTMLInputElement | null = null;
  private rotationInput: HTMLInputElement | null = null;
  private scaleXInput: HTMLInputElement | null = null;
  private scaleYInput: HTMLInputElement | null = null;
  private linkButton: HTMLButtonElement | null = null;

  constructor(options: TransformEditorOptions = {}) {
    super('div', { className: 'transform-editor' });

    this.options = {
      showPosition: true,
      showRotation: true,
      showScale: true,
      positionStep: 1,
      rotationStep: 1,
      scaleStep: 0.1,
      linkScale: true,
      compact: false,
      showLabels: true,
      ...options,
    };

    this.transform = { ...DEFAULT_TRANSFORM, ...options.transform };
    this.linkScale = this.options.linkScale!;

    if (this.options.compact) {
      this.addClass('transform-editor--compact');
    }

    this.render();
  }

  render(): this {
    const html = this.buildHTML();
    this.setHTML(html);
    this.bindEvents();
    return this;
  }

  private buildHTML(): string {
    const { showPosition, showRotation, showScale, showLabels, compact } = this.options;
    const sections: string[] = [];

    // Position section
    if (showPosition) {
      sections.push(`
        <div class="transform-section transform-section--position">
          ${showLabels && !compact ? '<div class="transform-section-label">Position</div>' : ''}
          <div class="transform-row">
            <div class="transform-field">
              <label class="transform-field-label">X</label>
              <input type="number"
                class="transform-input transform-input--x"
                value="${this.transform.x}"
                step="${this.options.positionStep}"
                title="X Position">
            </div>
            <div class="transform-field">
              <label class="transform-field-label">Y</label>
              <input type="number"
                class="transform-input transform-input--y"
                value="${this.transform.y}"
                step="${this.options.positionStep}"
                title="Y Position">
            </div>
          </div>
        </div>
      `);
    }

    // Rotation section
    if (showRotation) {
      sections.push(`
        <div class="transform-section transform-section--rotation">
          ${showLabels && !compact ? '<div class="transform-section-label">Rotation</div>' : ''}
          <div class="transform-row">
            <div class="transform-field transform-field--full">
              <label class="transform-field-label">°</label>
              <input type="number"
                class="transform-input transform-input--rotation"
                value="${this.transform.rotation}"
                step="${this.options.rotationStep}"
                title="Rotation (degrees)">
            </div>
          </div>
        </div>
      `);
    }

    // Scale section
    if (showScale) {
      sections.push(`
        <div class="transform-section transform-section--scale">
          ${showLabels && !compact ? '<div class="transform-section-label">Scale</div>' : ''}
          <div class="transform-row transform-row--scale">
            <div class="transform-field">
              <label class="transform-field-label">X</label>
              <input type="number"
                class="transform-input transform-input--scale-x"
                value="${this.transform.scaleX}"
                step="${this.options.scaleStep}"
                title="Scale X">
            </div>
            <button type="button"
              class="transform-link-btn ${this.linkScale ? 'active' : ''}"
              title="Link scale values"
              aria-pressed="${this.linkScale}">
              <svg class="transform-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                ${this.linkScale ? LINK_ICON : UNLINK_ICON}
              </svg>
            </button>
            <div class="transform-field">
              <label class="transform-field-label">Y</label>
              <input type="number"
                class="transform-input transform-input--scale-y"
                value="${this.transform.scaleY}"
                step="${this.options.scaleStep}"
                title="Scale Y">
            </div>
          </div>
        </div>
      `);
    }

    // Quick actions
    sections.push(`
      <div class="transform-actions">
        <button type="button" class="transform-action-btn" data-action="reset" title="Reset Transform">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
        </button>
        <button type="button" class="transform-action-btn" data-action="flip-h" title="Flip Horizontal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 3v18"/>
            <path d="M16 7l4 5-4 5"/>
            <path d="M8 7l-4 5 4 5"/>
          </svg>
        </button>
        <button type="button" class="transform-action-btn" data-action="flip-v" title="Flip Vertical">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 12h18"/>
            <path d="M7 8l5-4 5 4"/>
            <path d="M7 16l5 4 5-4"/>
          </svg>
        </button>
        <button type="button" class="transform-action-btn" data-action="rotate-90" title="Rotate 90°">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            <polyline points="17 3 21 3 21 7"/>
          </svg>
        </button>
      </div>
    `);

    return sections.join('');
  }

  private bindEvents(): void {
    // Get input references
    this.xInput = this.element.querySelector('.transform-input--x');
    this.yInput = this.element.querySelector('.transform-input--y');
    this.rotationInput = this.element.querySelector('.transform-input--rotation');
    this.scaleXInput = this.element.querySelector('.transform-input--scale-x');
    this.scaleYInput = this.element.querySelector('.transform-input--scale-y');
    this.linkButton = this.element.querySelector('.transform-link-btn');

    // Position inputs - use 'input' for real-time updates
    if (this.xInput) {
      this.on(this.xInput, 'input', () => this.handlePositionChange('x'));
    }
    if (this.yInput) {
      this.on(this.yInput, 'input', () => this.handlePositionChange('y'));
    }

    // Rotation input
    if (this.rotationInput) {
      this.on(this.rotationInput, 'input', () => this.handleRotationChange());
    }

    // Scale inputs
    if (this.scaleXInput) {
      this.on(this.scaleXInput, 'input', () => this.handleScaleChange('x'));
    }
    if (this.scaleYInput) {
      this.on(this.scaleYInput, 'input', () => this.handleScaleChange('y'));
    }

    // Link button
    if (this.linkButton) {
      this.on(this.linkButton, 'click', () => this.toggleLinkScale());
    }

    // Action buttons
    const actionButtons = this.element.querySelectorAll('.transform-action-btn');
    actionButtons.forEach(btn => {
      const action = (btn as HTMLElement).dataset.action;
      if (action) {
        this.on(btn as HTMLElement, 'click', () => this.handleAction(action));
      }
    });
  }

  private handlePositionChange(axis: 'x' | 'y'): void {
    const input = axis === 'x' ? this.xInput : this.yInput;
    if (!input) return;

    const value = parseFloat(input.value);
    if (!isNaN(value)) {
      this.transform[axis] = value;
      this.notifyChange();
    }
  }

  private handleRotationChange(): void {
    if (!this.rotationInput) return;

    let value = parseFloat(this.rotationInput.value);
    if (!isNaN(value)) {
      // Normalize to 0-360 range
      value = ((value % 360) + 360) % 360;
      this.transform.rotation = value;
      this.notifyChange();
    }
  }

  private handleScaleChange(axis: 'x' | 'y'): void {
    const input = axis === 'x' ? this.scaleXInput : this.scaleYInput;
    const otherInput = axis === 'x' ? this.scaleYInput : this.scaleXInput;
    if (!input) return;

    const value = parseFloat(input.value);
    // Allow negative values for flipping, but prevent zero to avoid rendering issues
    if (!isNaN(value) && value !== 0) {
      if (axis === 'x') {
        this.transform.scaleX = value;
        if (this.linkScale && otherInput) {
          this.transform.scaleY = value;
          otherInput.value = String(value);
        }
      } else {
        this.transform.scaleY = value;
        if (this.linkScale && otherInput) {
          this.transform.scaleX = value;
          otherInput.value = String(value);
        }
      }
      this.notifyChange();
    }
  }

  private toggleLinkScale(): void {
    this.linkScale = !this.linkScale;
    if (this.linkButton) {
      this.linkButton.classList.toggle('active', this.linkScale);
      this.linkButton.setAttribute('aria-pressed', String(this.linkScale));

      // Update icon
      const svg = this.linkButton.querySelector('.transform-link-icon');
      if (svg) {
        svg.innerHTML = this.linkScale ? LINK_ICON : UNLINK_ICON;
      }
    }

    // Sync scale values if linking
    if (this.linkScale && this.scaleXInput && this.scaleYInput) {
      this.transform.scaleY = this.transform.scaleX;
      this.scaleYInput.value = String(this.transform.scaleX);
      this.notifyChange();
    }
  }

  private handleAction(action: string): void {
    switch (action) {
      case 'reset':
        this.resetTransform();
        break;
      case 'flip-h':
        this.flipHorizontal();
        break;
      case 'flip-v':
        this.flipVertical();
        break;
      case 'rotate-90':
        this.rotate90();
        break;
    }
  }

  private resetTransform(): void {
    this.setTransform({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    });
  }

  private flipHorizontal(): void {
    this.transform.scaleX *= -1;
    if (this.scaleXInput) {
      this.scaleXInput.value = String(this.transform.scaleX);
    }
    this.notifyChange();
  }

  private flipVertical(): void {
    this.transform.scaleY *= -1;
    if (this.scaleYInput) {
      this.scaleYInput.value = String(this.transform.scaleY);
    }
    this.notifyChange();
  }

  private rotate90(): void {
    this.transform.rotation = (this.transform.rotation + 90) % 360;
    if (this.rotationInput) {
      this.rotationInput.value = String(this.transform.rotation);
    }
    this.notifyChange();
  }

  private notifyChange(): void {
    if (this.options.onChange) {
      this.options.onChange({ ...this.transform });
    }
  }

  // Public API

  getTransform(): Transform {
    return { ...this.transform };
  }

  setTransform(transform: Partial<Transform>): void {
    this.transform = { ...this.transform, ...transform };
    this.updateInputs();
    this.notifyChange();
  }

  /**
   * Update transform values without triggering onChange callback.
   * Useful when syncing from external state to avoid feedback loops.
   */
  updateTransformSilently(transform: Partial<Transform>): void {
    this.transform = { ...this.transform, ...transform };
    this.updateInputs();
  }

  setPosition(x: number, y: number): void {
    this.transform.x = x;
    this.transform.y = y;
    this.updateInputs();
    this.notifyChange();
  }

  setRotation(rotation: number): void {
    this.transform.rotation = ((rotation % 360) + 360) % 360;
    this.updateInputs();
    this.notifyChange();
  }

  setScale(scaleX: number, scaleY?: number): void {
    this.transform.scaleX = scaleX;
    this.transform.scaleY = scaleY ?? scaleX;
    this.updateInputs();
    this.notifyChange();
  }

  isScaleLinked(): boolean {
    return this.linkScale;
  }

  setScaleLinked(linked: boolean): void {
    if (this.linkScale !== linked) {
      this.toggleLinkScale();
    }
  }

  private updateInputs(): void {
    if (this.xInput) this.xInput.value = String(this.transform.x);
    if (this.yInput) this.yInput.value = String(this.transform.y);
    if (this.rotationInput) this.rotationInput.value = String(this.transform.rotation);
    if (this.scaleXInput) this.scaleXInput.value = String(this.transform.scaleX);
    if (this.scaleYInput) this.scaleYInput.value = String(this.transform.scaleY);
  }

  setDisabled(disabled: boolean): void {
    const inputs = this.element.querySelectorAll('input, button');
    inputs.forEach(el => {
      (el as HTMLInputElement | HTMLButtonElement).disabled = disabled;
    });
    this.toggleClass('transform-editor--disabled', disabled);
  }
}
