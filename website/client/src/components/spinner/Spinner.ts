import { Component, ComponentOptions } from '../base';
import './spinner.css';

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type SpinnerColor = 'primary' | 'secondary' | 'white';

export interface SpinnerOptions extends ComponentOptions {
  size?: SpinnerSize;
  color?: SpinnerColor;
  label?: string; // Accessibility label
}

export class Spinner extends Component<HTMLDivElement> {
  constructor(options: SpinnerOptions = {}) {
    super('div', {
      className: 'spinner',
      attributes: {
        role: 'status',
        'aria-label': options.label ?? 'Loading',
      },
      ...options,
    });

    const { size = 'md', color = 'primary' } = options;

    this.addClass(`spinner--${size}`);
    this.addClass(`spinner--${color}`);

    // Add visually hidden text for screen readers
    const srText = document.createElement('span');
    srText.className = 'sr-only';
    srText.textContent = options.label ?? 'Loading...';
    this.element.appendChild(srText);
  }
}

/**
 * Loading overlay component
 */
export interface LoadingOverlayOptions extends ComponentOptions {
  spinnerSize?: SpinnerSize;
  text?: string;
}

export class LoadingOverlay extends Component<HTMLDivElement> {
  private spinner: Spinner;
  private textElement?: HTMLSpanElement;

  constructor(options: LoadingOverlayOptions = {}) {
    super('div', {
      className: 'spinner-overlay',
      ...options,
    });

    this.spinner = new Spinner({
      size: options.spinnerSize ?? 'lg',
      color: 'primary',
    });

    const container = document.createElement('div');
    container.className = 'loading-container';
    container.appendChild(this.spinner.getElement());

    if (options.text) {
      this.textElement = document.createElement('span');
      this.textElement.className = 'loading-text';
      this.textElement.textContent = options.text;
      container.appendChild(this.textElement);
    }

    this.element.appendChild(container);
  }

  setText(text: string): this {
    if (this.textElement) {
      this.textElement.textContent = text;
    }
    return this;
  }
}

/**
 * Skeleton loading component
 */
export type SkeletonVariant = 'text' | 'title' | 'avatar' | 'button' | 'card';

export interface SkeletonOptions extends ComponentOptions {
  variant?: SkeletonVariant;
  width?: string;
  height?: string;
  count?: number;
}

export class Skeleton extends Component<HTMLDivElement> {
  constructor(options: SkeletonOptions = {}) {
    super('div', {
      className: 'skeleton',
      attributes: {
        'aria-hidden': 'true',
      },
      ...options,
    });

    const { variant, width, height, count = 1 } = options;

    if (variant) {
      this.addClass(`skeleton--${variant}`);
    }

    if (width) {
      this.element.style.width = width;
    }

    if (height) {
      this.element.style.height = height;
    }

    // If count > 1, create a container with multiple skeletons
    if (count > 1) {
      this.removeClass('skeleton');
      this.element.style.display = 'flex';
      this.element.style.flexDirection = 'column';
      this.element.style.gap = 'var(--spacing-2)';

      for (let i = 0; i < count; i++) {
        const skeleton = document.createElement('div');
        skeleton.className = 'skeleton';

        if (variant) {
          skeleton.classList.add(`skeleton--${variant}`);
        }

        this.element.appendChild(skeleton);
      }
    }
  }
}

/**
 * Helper to create skeleton text lines
 */
export function skeletonText(lines: number = 3): Skeleton {
  return new Skeleton({
    variant: 'text',
    count: lines,
  });
}
