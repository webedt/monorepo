import { Component, ComponentOptions } from '../base';
import './button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonOptions extends ComponentOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: boolean;
  fullWidth?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: (event: MouseEvent) => void;
}

export class Button extends Component<HTMLButtonElement> {
  private options: ButtonOptions;

  constructor(text: string, options: ButtonOptions = {}) {
    super('button', {
      className: 'btn',
      ...options,
    });

    this.options = {
      variant: 'primary',
      size: 'md',
      type: 'button',
      ...options,
    };

    this.element.type = this.options.type!;
    this.element.textContent = text;

    this.applyModifiers();
    this.setupEventListeners();
  }

  private applyModifiers(): void {
    const { variant, size, disabled, loading, icon, fullWidth } = this.options;

    // Variant
    if (variant) {
      this.addClass(`btn--${variant}`);
    }

    // Size (only add class if not default 'md')
    if (size && size !== 'md') {
      this.addClass(`btn--${size}`);
    }

    // States
    if (disabled) {
      this.setDisabled(true);
    }

    if (loading) {
      this.setLoading(true);
    }

    if (icon) {
      this.addClass('btn--icon');
    }

    if (fullWidth) {
      this.addClass('btn--full');
    }
  }

  private setupEventListeners(): void {
    if (this.options.onClick) {
      this.on('click', this.options.onClick);
    }
  }

  /**
   * Set the button's disabled state
   */
  setDisabled(disabled: boolean): this {
    this.element.disabled = disabled;
    if (disabled) {
      this.setAttribute('aria-disabled', 'true');
    } else {
      this.removeAttribute('aria-disabled');
    }
    return this;
  }

  /**
   * Check if the button is disabled
   */
  isDisabled(): boolean {
    return this.element.disabled;
  }

  /**
   * Set the button's loading state
   */
  setLoading(loading: boolean): this {
    this.options.loading = loading;
    this.toggleClass('btn--loading', loading);
    this.setDisabled(loading);
    return this;
  }

  /**
   * Check if the button is in loading state
   */
  isLoading(): boolean {
    return this.options.loading ?? false;
  }

  /**
   * Set the button's text content
   */
  setLabel(text: string): this {
    this.element.textContent = text;
    return this;
  }

  /**
   * Set the button's variant
   */
  setVariant(variant: ButtonVariant): this {
    // Remove old variant class
    if (this.options.variant) {
      this.removeClass(`btn--${this.options.variant}`);
    }
    // Add new variant class
    this.addClass(`btn--${variant}`);
    this.options.variant = variant;
    return this;
  }

  /**
   * Set click handler
   */
  onClick(handler: (event: MouseEvent) => void): this {
    this.on('click', handler);
    return this;
  }

  /**
   * Programmatically click the button
   */
  click(): this {
    this.element.click();
    return this;
  }
}
