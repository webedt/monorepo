import { Component, ComponentOptions } from '../base';
import './select.css';

export type SelectSize = 'sm' | 'md' | 'lg';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectOptions extends ComponentOptions {
  size?: SelectSize;
  placeholder?: string;
  value?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  label?: string;
  options?: SelectOption[];
  onChange?: (value: string, event: Event) => void;
}

export class Select extends Component<HTMLDivElement> {
  private selectElement: HTMLSelectElement;
  private labelElement?: HTMLLabelElement;
  private options: SelectOptions;
  private selectOptions: SelectOption[] = [];

  constructor(options: SelectOptions = {}) {
    super('div', {
      className: 'select-wrapper',
      ...options,
    });

    this.options = {
      size: 'md',
      ...options,
    };

    this.selectOptions = options.options ?? [];

    this.selectElement = document.createElement('select');
    this.selectElement.className = 'select';

    this.buildStructure();
    this.applyOptions();
    this.setupEventListeners();
  }

  private buildStructure(): void {
    const { label } = this.options;

    if (label) {
      this.labelElement = document.createElement('label');
      this.labelElement.className = 'select-label';
      this.labelElement.textContent = label;

      if (this.options.required) {
        this.labelElement.classList.add('select-label--required');
      }

      this.element.appendChild(this.labelElement);
    }

    this.element.appendChild(this.selectElement);
    this.renderOptions();
  }

  private applyOptions(): void {
    const { size, name, disabled, required } = this.options;

    if (size && size !== 'md') {
      this.selectElement.classList.add(`select--${size}`);
    }

    if (name) this.selectElement.name = name;
    if (disabled) this.selectElement.disabled = true;
    if (required) this.selectElement.required = true;

    if (this.labelElement) {
      const selectId = this.options.id || `select-${Math.random().toString(36).substr(2, 9)}`;
      this.selectElement.id = selectId;
      this.labelElement.htmlFor = selectId;
    }
  }

  private setupEventListeners(): void {
    const { onChange } = this.options;

    if (onChange) {
      this.on(this.selectElement, 'change', (e) => {
        onChange(this.selectElement.value, e);
      });
    }
  }

  private renderOptions(): void {
    const { placeholder, value } = this.options;

    this.selectElement.innerHTML = '';

    if (placeholder) {
      const placeholderOption = document.createElement('option');
      placeholderOption.value = '';
      placeholderOption.textContent = placeholder;
      placeholderOption.disabled = true;
      if (!value) {
        placeholderOption.selected = true;
      }
      this.selectElement.appendChild(placeholderOption);
    }

    for (const opt of this.selectOptions) {
      const optionEl = document.createElement('option');
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      if (opt.disabled) optionEl.disabled = true;
      if (value && opt.value === value) optionEl.selected = true;
      this.selectElement.appendChild(optionEl);
    }
  }

  getValue(): string {
    return this.selectElement.value;
  }

  setValue(value: string): this {
    this.selectElement.value = value;
    return this;
  }

  getSelectElement(): HTMLSelectElement {
    return this.selectElement;
  }

  setDisabled(disabled: boolean): this {
    this.selectElement.disabled = disabled;
    return this;
  }

  isDisabled(): boolean {
    return this.selectElement.disabled;
  }

  setOptions(options: SelectOption[]): this {
    this.selectOptions = options;
    this.renderOptions();
    return this;
  }

  addOption(option: SelectOption): this {
    this.selectOptions.push(option);
    this.renderOptions();
    return this;
  }

  clearOptions(): this {
    this.selectOptions = [];
    this.renderOptions();
    return this;
  }

  setPlaceholder(placeholder: string): this {
    this.options.placeholder = placeholder;
    this.renderOptions();
    return this;
  }

  focus(): this {
    this.selectElement.focus();
    return this;
  }

  blur(): this {
    this.selectElement.blur();
    return this;
  }
}
