import { Component, ComponentOptions } from '../base';
import './input.css';

export type InputSize = 'sm' | 'md' | 'lg';
export type InputType = 'text' | 'email' | 'password' | 'number' | 'search' | 'tel' | 'url';

export interface InputOptions extends ComponentOptions {
  type?: InputType;
  size?: InputSize;
  placeholder?: string;
  value?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  readonly?: boolean;
  label?: string;
  helper?: string;
  error?: string;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  autocomplete?: string;
  onChange?: (value: string, event: Event) => void;
  onInput?: (value: string, event: Event) => void;
  onBlur?: (event: FocusEvent) => void;
  onFocus?: (event: FocusEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
}

export class Input extends Component<HTMLDivElement> {
  private inputElement: HTMLInputElement;
  private labelElement?: HTMLLabelElement;
  private helperElement?: HTMLSpanElement;
  private errorElement?: HTMLSpanElement;
  private options: InputOptions;

  constructor(options: InputOptions = {}) {
    super('div', {
      className: 'input-wrapper',
      ...options,
    });

    this.options = {
      type: 'text',
      size: 'md',
      ...options,
    };

    // Create input element
    this.inputElement = document.createElement('input');
    this.inputElement.className = 'input';
    this.inputElement.type = this.options.type!;

    this.buildStructure();
    this.applyOptions();
    this.setupEventListeners();
  }

  private buildStructure(): void {
    const { label, helper, error } = this.options;

    // Label
    if (label) {
      this.labelElement = document.createElement('label');
      this.labelElement.className = 'input-label';
      this.labelElement.textContent = label;

      if (this.options.required) {
        this.labelElement.classList.add('input-label--required');
      }

      this.element.appendChild(this.labelElement);
    }

    // Input
    this.element.appendChild(this.inputElement);

    // Helper text
    if (helper) {
      this.helperElement = document.createElement('span');
      this.helperElement.className = 'input-helper';
      this.helperElement.textContent = helper;
      this.element.appendChild(this.helperElement);
    }

    // Error message
    if (error) {
      this.setError(error);
    }
  }

  private applyOptions(): void {
    const {
      size,
      placeholder,
      value,
      name,
      disabled,
      required,
      readonly,
      maxLength,
      minLength,
      pattern,
      autocomplete,
    } = this.options;

    if (size && size !== 'md') {
      this.inputElement.classList.add(`input--${size}`);
    }

    if (placeholder) this.inputElement.placeholder = placeholder;
    if (value) this.inputElement.value = value;
    if (name) this.inputElement.name = name;
    if (disabled) this.inputElement.disabled = true;
    if (required) this.inputElement.required = true;
    if (readonly) this.inputElement.readOnly = true;
    if (maxLength !== undefined) this.inputElement.maxLength = maxLength;
    if (minLength !== undefined) this.inputElement.minLength = minLength;
    if (pattern) this.inputElement.pattern = pattern;
    if (autocomplete) this.inputElement.autocomplete = autocomplete as AutoFill;

    // Link label to input
    if (this.labelElement) {
      const inputId = this.options.id || `input-${Math.random().toString(36).substr(2, 9)}`;
      this.inputElement.id = inputId;
      this.labelElement.htmlFor = inputId;
    }
  }

  private setupEventListeners(): void {
    const { onChange, onInput, onBlur, onFocus, onKeyDown } = this.options;

    if (onChange) {
      this.on(this.inputElement, 'change', (e) => {
        onChange(this.inputElement.value, e);
      });
    }

    if (onInput) {
      this.on(this.inputElement, 'input', (e) => {
        onInput(this.inputElement.value, e);
      });
    }

    if (onBlur) {
      this.on(this.inputElement, 'blur', (e) => onBlur(e as FocusEvent));
    }

    if (onFocus) {
      this.on(this.inputElement, 'focus', (e) => onFocus(e as FocusEvent));
    }

    if (onKeyDown) {
      this.on(this.inputElement, 'keydown', (e) => onKeyDown(e as KeyboardEvent));
    }
  }

  /**
   * Get the input value
   */
  getValue(): string {
    return this.inputElement.value;
  }

  /**
   * Set the input value
   */
  setValue(value: string): this {
    this.inputElement.value = value;
    return this;
  }

  /**
   * Clear the input value
   */
  clear(): this {
    this.inputElement.value = '';
    return this;
  }

  /**
   * Get the raw input element
   */
  getInputElement(): HTMLInputElement {
    return this.inputElement;
  }

  /**
   * Set disabled state
   */
  setDisabled(disabled: boolean): this {
    this.inputElement.disabled = disabled;
    return this;
  }

  /**
   * Check if disabled
   */
  isDisabled(): boolean {
    return this.inputElement.disabled;
  }

  /**
   * Set error message
   */
  setError(message: string | null): this {
    // Remove existing error
    if (this.errorElement) {
      this.errorElement.remove();
      this.errorElement = undefined;
    }

    this.inputElement.classList.remove('input--error');

    if (message) {
      this.inputElement.classList.add('input--error');
      this.errorElement = document.createElement('span');
      this.errorElement.className = 'input-error';
      this.errorElement.textContent = message;
      this.element.appendChild(this.errorElement);
    }

    return this;
  }

  /**
   * Clear error
   */
  clearError(): this {
    return this.setError(null);
  }

  /**
   * Check validity
   */
  isValid(): boolean {
    return this.inputElement.checkValidity();
  }

  /**
   * Report validity (shows browser validation message)
   */
  reportValidity(): boolean {
    return this.inputElement.reportValidity();
  }

  /**
   * Set custom validity message
   */
  setCustomValidity(message: string): this {
    this.inputElement.setCustomValidity(message);
    return this;
  }

  /**
   * Focus the input
   */
  focus(): this {
    this.inputElement.focus();
    return this;
  }

  /**
   * Blur the input
   */
  blur(): this {
    this.inputElement.blur();
    return this;
  }

  /**
   * Select all text in the input
   */
  select(): this {
    this.inputElement.select();
    return this;
  }
}

/**
 * TextArea Component
 */
export interface TextAreaOptions extends Omit<InputOptions, 'type'> {
  rows?: number;
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
}

export class TextArea extends Component<HTMLDivElement> {
  private textareaElement: HTMLTextAreaElement;
  private labelElement?: HTMLLabelElement;
  private helperElement?: HTMLSpanElement;
  private errorElement?: HTMLSpanElement;
  private options: TextAreaOptions;

  constructor(options: TextAreaOptions = {}) {
    super('div', {
      className: 'input-wrapper',
      ...options,
    });

    this.options = {
      size: 'md',
      rows: 4,
      resize: 'vertical',
      ...options,
    };

    this.textareaElement = document.createElement('textarea');
    this.textareaElement.className = 'input';

    this.buildStructure();
    this.applyOptions();
    this.setupEventListeners();
  }

  private buildStructure(): void {
    const { label, helper, error } = this.options;

    if (label) {
      this.labelElement = document.createElement('label');
      this.labelElement.className = 'input-label';
      this.labelElement.textContent = label;

      if (this.options.required) {
        this.labelElement.classList.add('input-label--required');
      }

      this.element.appendChild(this.labelElement);
    }

    this.element.appendChild(this.textareaElement);

    if (helper) {
      this.helperElement = document.createElement('span');
      this.helperElement.className = 'input-helper';
      this.helperElement.textContent = helper;
      this.element.appendChild(this.helperElement);
    }

    if (error) {
      this.setError(error);
    }
  }

  private applyOptions(): void {
    const {
      size,
      placeholder,
      value,
      name,
      disabled,
      required,
      readonly,
      maxLength,
      minLength,
      rows,
      resize,
    } = this.options;

    if (size && size !== 'md') {
      this.textareaElement.classList.add(`input--${size}`);
    }

    if (placeholder) this.textareaElement.placeholder = placeholder;
    if (value) this.textareaElement.value = value;
    if (name) this.textareaElement.name = name;
    if (disabled) this.textareaElement.disabled = true;
    if (required) this.textareaElement.required = true;
    if (readonly) this.textareaElement.readOnly = true;
    if (maxLength !== undefined) this.textareaElement.maxLength = maxLength;
    if (minLength !== undefined) this.textareaElement.minLength = minLength;
    if (rows !== undefined) this.textareaElement.rows = rows;
    if (resize) this.textareaElement.style.resize = resize;

    if (this.labelElement) {
      const textareaId = this.options.id || `textarea-${Math.random().toString(36).substr(2, 9)}`;
      this.textareaElement.id = textareaId;
      this.labelElement.htmlFor = textareaId;
    }
  }

  private setupEventListeners(): void {
    const { onChange, onInput, onBlur, onFocus, onKeyDown } = this.options;

    if (onChange) {
      this.on(this.textareaElement, 'change', (e) => {
        onChange(this.textareaElement.value, e);
      });
    }

    if (onInput) {
      this.on(this.textareaElement, 'input', (e) => {
        onInput(this.textareaElement.value, e);
      });
    }

    if (onBlur) {
      this.on(this.textareaElement, 'blur', (e) => onBlur(e as FocusEvent));
    }

    if (onFocus) {
      this.on(this.textareaElement, 'focus', (e) => onFocus(e as FocusEvent));
    }

    if (onKeyDown) {
      this.on(this.textareaElement, 'keydown', (e) => onKeyDown(e as KeyboardEvent));
    }
  }

  getValue(): string {
    return this.textareaElement.value;
  }

  setValue(value: string): this {
    this.textareaElement.value = value;
    return this;
  }

  clear(): this {
    this.textareaElement.value = '';
    return this;
  }

  getTextAreaElement(): HTMLTextAreaElement {
    return this.textareaElement;
  }

  setDisabled(disabled: boolean): this {
    this.textareaElement.disabled = disabled;
    return this;
  }

  setError(message: string | null): this {
    if (this.errorElement) {
      this.errorElement.remove();
      this.errorElement = undefined;
    }

    this.textareaElement.classList.remove('input--error');

    if (message) {
      this.textareaElement.classList.add('input--error');
      this.errorElement = document.createElement('span');
      this.errorElement.className = 'input-error';
      this.errorElement.textContent = message;
      this.element.appendChild(this.errorElement);
    }

    return this;
  }

  clearError(): this {
    return this.setError(null);
  }

  focus(): this {
    this.textareaElement.focus();
    return this;
  }

  blur(): this {
    this.textareaElement.blur();
    return this;
  }
}
