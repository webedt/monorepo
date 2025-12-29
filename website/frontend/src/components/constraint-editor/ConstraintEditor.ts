/**
 * ConstraintEditor Component
 * UI for viewing and editing layout constraints on scene objects
 */

import { Component } from '../base/Component.js';

import type { ComponentOptions } from '../base/Component.js';
import type {
  Constraint,
  ConstraintType,
  AnchorPoint,
  SizeMode,
  ConstraintPreset,
  PinConstraint,
  SizeConstraint,
  MarginConstraint,
  DistanceConstraint,
  AlignConstraint,
  AspectRatioConstraint,
} from '../../lib/constraints/types.js';
import {
  createPinConstraint,
  createSizeConstraint,
  createMarginConstraint,
  createDistanceConstraint,
  createAlignConstraint,
  createAspectRatioConstraint,
} from '../../lib/constraints/types.js';
import { constraintStore } from '../../stores/constraintStore.js';

import './constraint-editor.css';

export interface ConstraintEditorOptions extends ComponentOptions {
  objectId: string;
  objectIds?: string[];
  compact?: boolean;
  showPresets?: boolean;
  onChange?: (constraints: Constraint[]) => void;
}

const ANCHOR_POINTS: AnchorPoint[] = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

const SIZE_MODES: { value: SizeMode; label: string }[] = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'fill', label: 'Fill' },
  { value: 'hug', label: 'Hug Content' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'aspect', label: 'Aspect Ratio' },
];

const CONSTRAINT_PRESETS: { value: ConstraintPreset; label: string; icon: string }[] = [
  { value: 'pin-top-left', label: 'Pin Top Left', icon: '↖' },
  { value: 'pin-top-right', label: 'Pin Top Right', icon: '↗' },
  { value: 'pin-bottom-left', label: 'Pin Bottom Left', icon: '↙' },
  { value: 'pin-bottom-right', label: 'Pin Bottom Right', icon: '↘' },
  { value: 'pin-center', label: 'Pin Center', icon: '⊙' },
  { value: 'fill-parent', label: 'Fill Parent', icon: '□' },
  { value: 'fill-width', label: 'Fill Width', icon: '↔' },
  { value: 'fill-height', label: 'Fill Height', icon: '↕' },
  { value: 'center-horizontal', label: 'Center H', icon: '⊖' },
  { value: 'center-vertical', label: 'Center V', icon: '⊕' },
  { value: 'center-both', label: 'Center Both', icon: '⊛' },
];

export class ConstraintEditor extends Component<HTMLDivElement> {
  private objectId: string;
  private options: ConstraintEditorOptions;
  private unsubscribe: (() => void) | null = null;

  constructor(options: ConstraintEditorOptions) {
    super('div', { className: 'constraint-editor' });

    this.objectId = options.objectId;
    this.options = {
      compact: false,
      showPresets: true,
      ...options,
    };

    if (this.options.compact) {
      this.addClass('constraint-editor--compact');
    }

    this.render();
    this.subscribeToStore();
  }

  private subscribeToStore(): void {
    this.unsubscribe = constraintStore.subscribe(() => {
      this.render();
      this.notifyChange();
    });
  }

  protected onUnmount(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  render(): this {
    const constraints = constraintStore.getConstraintsForObject(this.objectId);
    const showConstraints = constraintStore.getState().showConstraints;

    this.setHTML(`
      <div class="constraint-editor__header">
        <h4 class="constraint-editor__title">Constraints</h4>
        <div class="constraint-editor__header-actions">
          <button class="constraint-editor__toggle-btn ${showConstraints ? 'active' : ''}"
                  data-action="toggle-visibility"
                  title="Toggle constraint visibility">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              ${showConstraints
                ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
                : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
              }
            </svg>
          </button>
        </div>
      </div>

      ${this.options.showPresets ? this.renderPresets() : ''}

      <div class="constraint-editor__list">
        ${constraints.length > 0
          ? constraints.map(c => this.renderConstraint(c)).join('')
          : '<div class="constraint-editor__empty">No constraints</div>'
        }
      </div>

      <div class="constraint-editor__add">
        <select class="constraint-editor__add-select">
          <option value="">Add constraint...</option>
          <option value="pin">Pin</option>
          <option value="size">Size</option>
          <option value="margin">Margin</option>
          <option value="distance">Distance</option>
          <option value="align">Align</option>
          <option value="aspectRatio">Aspect Ratio</option>
        </select>
      </div>
    `);

    this.bindEvents();
    return this;
  }

  private renderPresets(): string {
    return `
      <div class="constraint-editor__presets">
        <div class="constraint-editor__presets-label">Quick presets:</div>
        <div class="constraint-editor__presets-grid">
          ${CONSTRAINT_PRESETS.map(
            preset => `
            <button class="constraint-editor__preset-btn"
                    data-preset="${preset.value}"
                    title="${preset.label}">
              ${preset.icon}
            </button>
          `
          ).join('')}
        </div>
      </div>
    `;
  }

  private renderConstraint(constraint: Constraint): string {
    const isSelected = constraintStore.getState().selectedConstraintId === constraint.id;

    return `
      <div class="constraint-editor__item ${isSelected ? 'selected' : ''}"
           data-constraint-id="${constraint.id}">
        <div class="constraint-editor__item-header">
          <button class="constraint-editor__enable-btn ${constraint.enabled ? 'active' : ''}"
                  data-action="toggle-enable"
                  data-id="${constraint.id}"
                  title="${constraint.enabled ? 'Disable' : 'Enable'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              ${constraint.enabled
                ? '<polyline points="20 6 9 17 4 12"/>'
                : '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
              }
            </svg>
          </button>
          <span class="constraint-editor__item-type">${this.getConstraintLabel(constraint)}</span>
          <button class="constraint-editor__delete-btn"
                  data-action="delete"
                  data-id="${constraint.id}"
                  title="Delete constraint">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
        <div class="constraint-editor__item-body">
          ${this.renderConstraintFields(constraint)}
        </div>
      </div>
    `;
  }

  private getConstraintLabel(constraint: Constraint): string {
    switch (constraint.type) {
      case 'pin':
        return `Pin (${constraint.sourceAnchor} → ${constraint.targetAnchor})`;
      case 'size':
        return `Size (${constraint.axis}: ${constraint.mode})`;
      case 'margin':
        return 'Margin';
      case 'distance':
        return `Distance (${constraint.axis})`;
      case 'align':
        return `Align (${constraint.alignment})`;
      case 'aspectRatio':
        return `Aspect Ratio (${constraint.ratio.toFixed(2)})`;
      case 'chain':
        return `Chain (${constraint.axis}, ${constraint.objectIds.length} items)`;
      default:
        return 'Unknown';
    }
  }

  private renderConstraintFields(constraint: Constraint): string {
    switch (constraint.type) {
      case 'pin':
        return this.renderPinFields(constraint);
      case 'size':
        return this.renderSizeFields(constraint);
      case 'margin':
        return this.renderMarginFields(constraint);
      case 'distance':
        return this.renderDistanceFields(constraint);
      case 'align':
        return this.renderAlignFields(constraint);
      case 'aspectRatio':
        return this.renderAspectRatioFields(constraint);
      default:
        return '';
    }
  }

  private renderPinFields(constraint: PinConstraint): string {
    return `
      <div class="constraint-editor__field-group">
        <div class="constraint-editor__field">
          <label>Source</label>
          <select data-field="sourceAnchor" data-id="${constraint.id}">
            ${ANCHOR_POINTS.map(
              a => `<option value="${a}" ${a === constraint.sourceAnchor ? 'selected' : ''}>${a}</option>`
            ).join('')}
          </select>
        </div>
        <div class="constraint-editor__field">
          <label>Target</label>
          <select data-field="targetAnchor" data-id="${constraint.id}">
            ${ANCHOR_POINTS.map(
              a => `<option value="${a}" ${a === constraint.targetAnchor ? 'selected' : ''}>${a}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div class="constraint-editor__field-group">
        <div class="constraint-editor__field">
          <label>Offset X</label>
          <input type="number" value="${constraint.offsetX}" data-field="offsetX" data-id="${constraint.id}" step="1">
        </div>
        <div class="constraint-editor__field">
          <label>Offset Y</label>
          <input type="number" value="${constraint.offsetY}" data-field="offsetY" data-id="${constraint.id}" step="1">
        </div>
      </div>
    `;
  }

  private renderSizeFields(constraint: SizeConstraint): string {
    return `
      <div class="constraint-editor__field-group">
        <div class="constraint-editor__field">
          <label>Axis</label>
          <select data-field="axis" data-id="${constraint.id}">
            <option value="width" ${constraint.axis === 'width' ? 'selected' : ''}>Width</option>
            <option value="height" ${constraint.axis === 'height' ? 'selected' : ''}>Height</option>
            <option value="both" ${constraint.axis === 'both' ? 'selected' : ''}>Both</option>
          </select>
        </div>
        <div class="constraint-editor__field">
          <label>Mode</label>
          <select data-field="mode" data-id="${constraint.id}">
            ${SIZE_MODES.map(
              m => `<option value="${m.value}" ${m.value === constraint.mode ? 'selected' : ''}>${m.label}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div class="constraint-editor__field-group">
        <div class="constraint-editor__field">
          <label>Value</label>
          <input type="number" value="${constraint.value}" data-field="value" data-id="${constraint.id}" step="1" min="0">
        </div>
      </div>
      <div class="constraint-editor__field-group">
        <div class="constraint-editor__field">
          <label>Min</label>
          <input type="number" value="${constraint.minValue ?? ''}" data-field="minValue" data-id="${constraint.id}" step="1" min="0" placeholder="None">
        </div>
        <div class="constraint-editor__field">
          <label>Max</label>
          <input type="number" value="${constraint.maxValue ?? ''}" data-field="maxValue" data-id="${constraint.id}" step="1" min="0" placeholder="None">
        </div>
      </div>
    `;
  }

  private renderMarginFields(constraint: MarginConstraint): string {
    return `
      <div class="constraint-editor__margin-grid">
        <div class="constraint-editor__margin-top">
          <input type="number" value="${constraint.top ?? ''}" data-field="top" data-id="${constraint.id}" placeholder="—" step="1">
        </div>
        <div class="constraint-editor__margin-left">
          <input type="number" value="${constraint.left ?? ''}" data-field="left" data-id="${constraint.id}" placeholder="—" step="1">
        </div>
        <div class="constraint-editor__margin-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
            <rect x="4" y="4" width="16" height="16" rx="2"/>
          </svg>
        </div>
        <div class="constraint-editor__margin-right">
          <input type="number" value="${constraint.right ?? ''}" data-field="right" data-id="${constraint.id}" placeholder="—" step="1">
        </div>
        <div class="constraint-editor__margin-bottom">
          <input type="number" value="${constraint.bottom ?? ''}" data-field="bottom" data-id="${constraint.id}" placeholder="—" step="1">
        </div>
      </div>
    `;
  }

  private renderDistanceFields(constraint: DistanceConstraint): string {
    return `
      <div class="constraint-editor__field-group">
        <div class="constraint-editor__field">
          <label>Axis</label>
          <select data-field="axis" data-id="${constraint.id}">
            <option value="horizontal" ${constraint.axis === 'horizontal' ? 'selected' : ''}>Horizontal</option>
            <option value="vertical" ${constraint.axis === 'vertical' ? 'selected' : ''}>Vertical</option>
            <option value="both" ${constraint.axis === 'both' ? 'selected' : ''}>Both</option>
          </select>
        </div>
        <div class="constraint-editor__field">
          <label>Distance</label>
          <input type="number" value="${constraint.distance}" data-field="distance" data-id="${constraint.id}" step="1">
        </div>
      </div>
      <div class="constraint-editor__field-group">
        <div class="constraint-editor__field">
          <label>Min</label>
          <input type="number" value="${constraint.minDistance ?? ''}" data-field="minDistance" data-id="${constraint.id}" step="1" placeholder="None">
        </div>
        <div class="constraint-editor__field">
          <label>Max</label>
          <input type="number" value="${constraint.maxDistance ?? ''}" data-field="maxDistance" data-id="${constraint.id}" step="1" placeholder="None">
        </div>
      </div>
    `;
  }

  private renderAlignFields(constraint: AlignConstraint): string {
    return `
      <div class="constraint-editor__field-group">
        <div class="constraint-editor__field constraint-editor__field--full">
          <label>Alignment</label>
          <select data-field="alignment" data-id="${constraint.id}">
            <option value="left" ${constraint.alignment === 'left' ? 'selected' : ''}>Left</option>
            <option value="center" ${constraint.alignment === 'center' ? 'selected' : ''}>Center</option>
            <option value="right" ${constraint.alignment === 'right' ? 'selected' : ''}>Right</option>
            <option value="top" ${constraint.alignment === 'top' ? 'selected' : ''}>Top</option>
            <option value="middle" ${constraint.alignment === 'middle' ? 'selected' : ''}>Middle</option>
            <option value="bottom" ${constraint.alignment === 'bottom' ? 'selected' : ''}>Bottom</option>
            <option value="distribute" ${constraint.alignment === 'distribute' ? 'selected' : ''}>Distribute</option>
          </select>
        </div>
      </div>
    `;
  }

  private renderAspectRatioFields(constraint: AspectRatioConstraint): string {
    return `
      <div class="constraint-editor__field-group">
        <div class="constraint-editor__field">
          <label>Ratio (W/H)</label>
          <input type="number" value="${constraint.ratio}" data-field="ratio" data-id="${constraint.id}" step="0.01" min="0.01">
        </div>
        <div class="constraint-editor__field constraint-editor__field--checkbox">
          <label>
            <input type="checkbox" ${constraint.lockToSource ? 'checked' : ''} data-field="lockToSource" data-id="${constraint.id}">
            Lock to source
          </label>
        </div>
      </div>
      <div class="constraint-editor__ratio-presets">
        <button data-ratio="1" data-id="${constraint.id}">1:1</button>
        <button data-ratio="1.333" data-id="${constraint.id}">4:3</button>
        <button data-ratio="1.778" data-id="${constraint.id}">16:9</button>
        <button data-ratio="0.5625" data-id="${constraint.id}">9:16</button>
      </div>
    `;
  }

  private bindEvents(): void {
    // Toggle visibility
    const toggleBtn = this.element.querySelector('[data-action="toggle-visibility"]');
    if (toggleBtn) {
      this.on(toggleBtn as HTMLElement, 'click', () => {
        constraintStore.toggleShowConstraints();
      });
    }

    // Presets
    const presetBtns = this.element.querySelectorAll('[data-preset]');
    presetBtns.forEach(btn => {
      this.on(btn as HTMLElement, 'click', () => {
        const preset = (btn as HTMLElement).dataset.preset as ConstraintPreset;
        constraintStore.applyPreset(this.objectId, preset);
      });
    });

    // Add constraint select
    const addSelect = this.element.querySelector('.constraint-editor__add-select') as HTMLSelectElement;
    if (addSelect) {
      this.on(addSelect, 'change', () => {
        const type = addSelect.value as ConstraintType;
        if (type) {
          this.addConstraint(type);
          addSelect.value = '';
        }
      });
    }

    // Enable/disable toggle
    const enableBtns = this.element.querySelectorAll('[data-action="toggle-enable"]');
    enableBtns.forEach(btn => {
      this.on(btn as HTMLElement, 'click', e => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id!;
        const constraint = constraintStore.getState().constraints[id];
        if (constraint) {
          constraintStore.updateConstraint(id, { enabled: !constraint.enabled });
        }
      });
    });

    // Delete buttons
    const deleteBtns = this.element.querySelectorAll('[data-action="delete"]');
    deleteBtns.forEach(btn => {
      this.on(btn as HTMLElement, 'click', e => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id!;
        constraintStore.removeConstraint(id);
      });
    });

    // Field inputs
    const inputs = this.element.querySelectorAll('[data-field]');
    inputs.forEach(input => {
      const element = input as HTMLInputElement | HTMLSelectElement;
      const eventType = element.type === 'checkbox' ? 'change' : 'input';

      this.on(element, eventType, () => {
        const id = element.dataset.id!;
        const field = element.dataset.field!;
        let value: string | number | boolean | undefined;

        if (element.type === 'checkbox') {
          value = (element as HTMLInputElement).checked;
        } else if (element.type === 'number') {
          value = element.value === '' ? undefined : parseFloat(element.value);
        } else {
          value = element.value;
        }

        constraintStore.updateConstraint(id, { [field]: value });
      });
    });

    // Ratio preset buttons
    const ratioBtns = this.element.querySelectorAll('[data-ratio]');
    ratioBtns.forEach(btn => {
      this.on(btn as HTMLElement, 'click', () => {
        const id = (btn as HTMLElement).dataset.id!;
        const ratio = parseFloat((btn as HTMLElement).dataset.ratio!);
        constraintStore.updateConstraint(id, { ratio });
      });
    });

    // Item selection
    const items = this.element.querySelectorAll('.constraint-editor__item');
    items.forEach(item => {
      this.on(item as HTMLElement, 'click', () => {
        const id = (item as HTMLElement).dataset.constraintId!;
        constraintStore.selectConstraint(id);
      });
    });
  }

  private addConstraint(type: ConstraintType): void {
    const parent = { type: 'parent' as const };

    switch (type) {
      case 'pin':
        constraintStore.addConstraint(
          createPinConstraint(this.objectId, 'center', parent, 'center', 0, 0)
        );
        break;
      case 'size':
        constraintStore.addConstraint(
          createSizeConstraint(this.objectId, 'both', 'fixed', 100)
        );
        break;
      case 'margin':
        constraintStore.addConstraint(
          createMarginConstraint(this.objectId, parent, {})
        );
        break;
      case 'distance':
        constraintStore.addConstraint(
          createDistanceConstraint(this.objectId, parent, 'both', 50)
        );
        break;
      case 'align':
        constraintStore.addConstraint(
          createAlignConstraint(this.objectId, [parent], 'center')
        );
        break;
      case 'aspectRatio':
        constraintStore.addConstraint(
          createAspectRatioConstraint(this.objectId, 1, false)
        );
        break;
    }
  }

  private notifyChange(): void {
    if (this.options.onChange) {
      const constraints = constraintStore.getConstraintsForObject(this.objectId);
      this.options.onChange(constraints);
    }
  }

  // Public API

  setObjectId(objectId: string): void {
    this.objectId = objectId;
    this.render();
  }

  getConstraints(): Constraint[] {
    return constraintStore.getConstraintsForObject(this.objectId);
  }

  clearConstraints(): void {
    constraintStore.removeObjectConstraints(this.objectId);
  }
}
