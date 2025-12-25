import { Component, ComponentOptions } from '../base';
import { Button } from '../button';
import './composite-input.css';

export interface CompositeInputOptions extends ComponentOptions {
  placeholder?: string;
  value?: string;
  rows?: number;
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
  submitText?: string;
  submitVariant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  onSubmit?: (value: string) => void | Promise<void>;
  onChange?: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
}

export class CompositeInput extends Component<HTMLDivElement> {
  private textareaElement: HTMLTextAreaElement;
  private controlsElement: HTMLDivElement;
  private submitButton: Button | null = null;
  private options: CompositeInputOptions;
  private childComponents: Component[] = [];

  constructor(options: CompositeInputOptions = {}) {
    super('div', {
      className: 'composite-input',
      ...options,
    });

    this.options = {
      rows: 3,
      resize: 'vertical',
      submitText: 'Submit',
      submitVariant: 'primary',
      ...options,
    };

    this.textareaElement = document.createElement('textarea');
    this.textareaElement.className = 'composite-input-textarea';

    this.controlsElement = document.createElement('div');
    this.controlsElement.className = 'composite-input-controls';

    this.buildStructure();
    this.applyOptions();
    this.setupEventListeners();
  }

  private buildStructure(): void {
    this.element.appendChild(this.textareaElement);
    this.element.appendChild(this.controlsElement);
  }

  private applyOptions(): void {
    const { placeholder, value, rows, resize, disabled } = this.options;

    if (placeholder) this.textareaElement.placeholder = placeholder;
    if (value) this.textareaElement.value = value;
    if (rows) this.textareaElement.rows = rows;
    if (resize) this.textareaElement.style.resize = resize;
    if (disabled) this.textareaElement.disabled = true;
  }

  private setupEventListeners(): void {
    const { onChange, onKeyDown, onSubmit } = this.options;

    if (onChange) {
      this.on(this.textareaElement, 'input', () => {
        onChange(this.textareaElement.value);
      });
    }

    if (onKeyDown) {
      this.on(this.textareaElement, 'keydown', (e) => {
        onKeyDown(e as KeyboardEvent);
      });
    }

    // Cmd/Ctrl+Enter to submit
    this.on(this.textareaElement, 'keydown', (e) => {
      const keyEvent = e as KeyboardEvent;
      if (keyEvent.key === 'Enter' && (keyEvent.metaKey || keyEvent.ctrlKey)) {
        keyEvent.preventDefault();
        if (onSubmit) {
          onSubmit(this.textareaElement.value);
        }
      }
    });
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

  getControlsElement(): HTMLDivElement {
    return this.controlsElement;
  }

  setDisabled(disabled: boolean): this {
    this.textareaElement.disabled = disabled;
    return this;
  }

  addControl(component: Component | HTMLElement): this {
    if (component instanceof Component) {
      this.childComponents.push(component);
      component.mount(this.controlsElement);
    } else {
      this.controlsElement.appendChild(component);
    }
    return this;
  }

  addSubmitButton(text?: string, onClick?: () => void | Promise<void>): this {
    const buttonText = text ?? this.options.submitText ?? 'Submit';
    const handler = onClick ?? this.options.onSubmit;

    this.submitButton = new Button(buttonText, {
      variant: this.options.submitVariant,
      onClick: async () => {
        if (handler) {
          await handler(this.textareaElement.value);
        }
      },
    });

    this.submitButton.mount(this.controlsElement);
    this.childComponents.push(this.submitButton);
    return this;
  }

  getSubmitButton(): Button | null {
    return this.submitButton;
  }

  setSubmitLoading(loading: boolean): this {
    if (this.submitButton) {
      this.submitButton.setLoading(loading);
      this.submitButton.setDisabled(loading);
    }
    return this;
  }

  focus(): this {
    this.textareaElement.focus();
    return this;
  }

  blur(): this {
    this.textareaElement.blur();
    return this;
  }

  protected onUnmount(): void {
    for (const component of this.childComponents) {
      component.unmount();
    }
    this.childComponents = [];
  }
}
