/**
 * AI Input Box Component
 * Text input for sending AI prompts from the code editor
 */

import { Component, ComponentOptions } from '../base';
import { Button } from '../button';
import { toast } from '../toast';
import { sessionsApi } from '../../lib/api';
import './ai-input-box.css';

export interface AIInputBoxOptions extends ComponentOptions {
  sessionId: string;
  placeholder?: string;
  onSend?: (content: string) => void;
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
      placeholder: 'Ask AI about this code...',
      ...options,
    };

    this.textareaElement = document.createElement('textarea');
    this.textareaElement.className = 'ai-input-box-textarea';
    this.textareaElement.placeholder = this.options.placeholder || '';
    this.textareaElement.rows = 1;

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

    const hint = document.createElement('p');
    hint.className = 'ai-input-box-hint';
    hint.textContent = 'Press Enter to send, Shift+Enter for new line';

    this.element.appendChild(wrapper);
    this.element.appendChild(hint);
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
      // Call the onSend callback if provided
      if (this.options.onSend) {
        this.options.onSend(content);
      }

      // Send message to the session
      const response = await sessionsApi.sendMessage(this.options.sessionId, content);

      if (!response.success) {
        throw new Error(response.error || 'Failed to send message');
      }

      // Clear input
      this.textareaElement.value = '';
      this.textareaElement.style.height = 'auto';

      toast.success('Message sent');

      // Navigate to chat view if callback provided
      if (this.options.onNavigateToChat) {
        this.options.onNavigateToChat();
      }
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

  protected onUnmount(): void {
    this.sendButton.unmount();
  }
}
