/**
 * AI Input Box Component
 * Text input for AI requests with auto-resizing textarea and send button.
 * Can be used standalone with custom onSubmit handler or with session integration.
 */

import { Component, ComponentOptions } from '../base';
import { Button } from '../button';
import { toast } from '../toast';
import { sessionsApi } from '../../lib/api';
import './ai-input-box.css';

export interface AIInputBoxOptions extends ComponentOptions {
  sessionId?: string;
  placeholder?: string;
  disabled?: boolean;
  showHint?: boolean;
  onSend?: (content: string) => void;
  onSubmit?: (content: string) => Promise<void> | void;
  onNavigateToChat?: () => void;
}

export class AIInputBox extends Component<HTMLDivElement> {
  private textareaElement: HTMLTextAreaElement;
  private sendButton: Button;
  private options: AIInputBoxOptions;
  private isSending = false;

  constructor(options: AIInputBoxOptions) {
    super('div', {
      className: 'ai-input-box',
      ...options,
    });

    this.options = {
      placeholder: 'Ask AI...',
      showHint: true,
      disabled: false,
      ...options,
    };

    this.textareaElement = document.createElement('textarea');
    this.textareaElement.className = 'ai-input-box-textarea';
    this.textareaElement.placeholder = this.options.placeholder || '';
    this.textareaElement.rows = 1;
    this.textareaElement.disabled = this.options.disabled || false;

    this.sendButton = new Button('Send', {
      variant: 'primary',
      size: 'sm',
      disabled: true,
      onClick: () => this.handleSend(),
    });

    this.buildStructure();
    this.setupEventListeners();
  }

  private buildStructure(): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'ai-input-box-wrapper';

    const inputContainer = document.createElement('div');
    inputContainer.className = 'ai-input-box-input-container';
    inputContainer.appendChild(this.textareaElement);

    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'ai-input-box-controls';
    this.sendButton.mount(controlsContainer);

    wrapper.appendChild(inputContainer);
    wrapper.appendChild(controlsContainer);

    this.element.appendChild(wrapper);

    if (this.options.showHint) {
      const hint = document.createElement('p');
      hint.className = 'ai-input-box-hint';
      hint.textContent = 'Press Enter to send, Shift+Enter for new line';
      this.element.appendChild(hint);
    }
  }

  private setupEventListeners(): void {
    this.on(this.textareaElement, 'input', () => this.handleInputChange());
    this.on(this.textareaElement, 'keydown', (e) => this.handleKeyDown(e as KeyboardEvent));
  }

  private handleInputChange(): void {
    const value = this.textareaElement.value.trim();
    this.sendButton.setDisabled(!value || this.isSending);

    // Auto-resize textarea
    this.textareaElement.style.height = 'auto';
    this.textareaElement.style.height = Math.min(this.textareaElement.scrollHeight, 120) + 'px';
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Enter without shift = send
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.handleSend();
    }
  }

  private async handleSend(): Promise<void> {
    const content = this.textareaElement.value.trim();
    if (!content || this.isSending) return;

    this.isSending = true;
    this.sendButton.setLoading(true);
    this.sendButton.setDisabled(true);

    try {
      // Call the onSend callback if provided (fires before submission)
      if (this.options.onSend) {
        this.options.onSend(content);
      }

      // If a custom onSubmit handler is provided, use it
      if (this.options.onSubmit) {
        await this.options.onSubmit(content);
      } else if (this.options.sessionId) {
        // Fall back to session-based API call if sessionId is provided
        const response = await sessionsApi.sendMessage(this.options.sessionId, content);

        if (!response.success) {
          throw new Error(response.error || 'Failed to send message');
        }

        toast.success('Message sent');

        // Navigate to chat view if callback provided
        if (this.options.onNavigateToChat) {
          this.options.onNavigateToChat();
        }
      }

      // Clear input
      this.textareaElement.value = '';
      this.textareaElement.style.height = 'auto';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send message';
      toast.error(message);
    } finally {
      this.isSending = false;
      this.sendButton.setLoading(false);
      this.handleInputChange(); // Update button state
    }
  }

  getValue(): string {
    return this.textareaElement.value;
  }

  setValue(value: string): this {
    this.textareaElement.value = value;
    this.handleInputChange();
    return this;
  }

  clear(): this {
    this.textareaElement.value = '';
    this.textareaElement.style.height = 'auto';
    this.handleInputChange();
    return this;
  }

  focus(): this {
    this.textareaElement.focus();
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.textareaElement.disabled = disabled;
    if (disabled) {
      this.sendButton.setDisabled(true);
    } else {
      this.handleInputChange();
    }
    return this;
  }

  setPlaceholder(placeholder: string): this {
    this.textareaElement.placeholder = placeholder;
    return this;
  }

  isEmpty(): boolean {
    return this.textareaElement.value.trim().length === 0;
  }

  isLoading(): boolean {
    return this.isSending;
  }

  protected onUnmount(): void {
    this.sendButton.unmount();
  }
}
