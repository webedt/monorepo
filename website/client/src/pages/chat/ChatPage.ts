/**
 * Chat Page
 * Main chat interface for agent sessions
 */

import { Page, type PageOptions } from '../base/Page';
import { Spinner, toast } from '../../components';
import { sessionsApi } from '../../lib/api';
import { authStore } from '../../stores/authStore';
import { workerStore } from '../../stores/workerStore';
import type { Session } from '../../types';
import './chat.css';

interface ChatMessage {
  id: string;
  type: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  timestamp: Date;
  model?: string;
}

interface ChatPageOptions extends PageOptions {
  params?: {
    sessionId?: string;
  };
}

export class ChatPage extends Page<ChatPageOptions> {
  readonly route = '/session/:sessionId/chat';
  readonly title = 'Chat';
  protected requiresAuth = true;

  private session: Session | null = null;
  private messages: ChatMessage[] = [];
  private inputValue = '';
  private isLoading = true;
  private isSending = false;
  private eventSource: { close: () => void } | null = null;
  private messagesContainer: HTMLElement | null = null;
  private inputElement: HTMLTextAreaElement | null = null;

  protected render(): string {
    return `
      <div class="chat-page">
        <header class="chat-header">
          <div class="chat-header-left">
            <button class="back-btn" data-action="back">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <div class="chat-session-info">
              <h1 class="chat-title">Loading...</h1>
              <p class="chat-subtitle"></p>
            </div>
          </div>
          <div class="chat-header-right">
            <div class="chat-status"></div>
          </div>
        </header>

        <div class="chat-messages" id="chat-messages">
          <div class="chat-loading">
            <div class="spinner-container"></div>
          </div>
          <div class="messages-list" style="display: none;"></div>
          <div class="chat-empty" style="display: none;">
            <h3>No messages yet</h3>
            <p>Send a message to start the conversation</p>
          </div>
        </div>

        <div class="chat-input-container">
          <div class="chat-input-wrapper">
            <textarea
              class="chat-input"
              placeholder="Type your message..."
              rows="1"
            ></textarea>
            <button class="send-btn" data-action="send" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
          </div>
          <p class="chat-input-hint">Press Enter to send, Shift+Enter for new line</p>
        </div>
      </div>
    `;
  }

  protected onMount(): void {
    super.onMount();

    // Setup back button
    const backBtn = this.$('[data-action="back"]') as HTMLButtonElement;
    if (backBtn) {
      backBtn.addEventListener('click', () => this.navigate('/agents'));
    }

    // Setup send button
    const sendBtn = this.$('[data-action="send"]') as HTMLButtonElement;
    if (sendBtn) {
      sendBtn.addEventListener('click', () => this.handleSend());
    }

    // Setup textarea
    this.inputElement = this.$('.chat-input') as HTMLTextAreaElement;
    if (this.inputElement) {
      this.inputElement.addEventListener('input', () => this.handleInputChange());
      this.inputElement.addEventListener('keydown', (e) => this.handleKeyDown(e));
    }

    // Get messages container
    this.messagesContainer = this.$('.messages-list') as HTMLElement;

    // Show loading spinner
    const spinnerContainer = this.$('.spinner-container') as HTMLElement;
    if (spinnerContainer) {
      const spinner = new Spinner({ size: 'lg' });
      spinner.mount(spinnerContainer);
    }

    // Load session data
    this.loadSession();
  }

  private async loadSession(): Promise<void> {
    const sessionId = this.options.params?.sessionId;
    if (!sessionId) {
      toast.error('No session ID provided');
      this.navigate('/agents');
      return;
    }

    this.isLoading = true;
    this.updateLoadingState();

    try {
      // Load session details
      const response = await sessionsApi.get(sessionId);
      this.session = response.session;

      // Update header
      this.updateHeader();

      // Load events/messages
      await this.loadMessages();

      // Connect to live stream if session is active
      if (this.session?.status === 'running') {
        this.connectToStream();
      }
    } catch (error) {
      toast.error('Failed to load session');
      console.error('Failed to load session:', error);
      this.navigate('/agents');
    } finally {
      this.isLoading = false;
      this.updateLoadingState();
    }
  }

  private updateHeader(): void {
    const titleEl = this.$('.chat-title');
    const subtitleEl = this.$('.chat-subtitle');
    const statusEl = this.$('.chat-status');

    if (this.session) {
      const title = this.session.userRequest?.slice(0, 60) || 'Untitled Session';
      if (titleEl) titleEl.textContent = title;

      const repo = this.session.repositoryOwner && this.session.repositoryName
        ? `${this.session.repositoryOwner}/${this.session.repositoryName}`
        : '';
      const branch = this.session.branch || '';
      const subtitle = [repo, branch].filter(Boolean).join(' • ');
      if (subtitleEl) subtitleEl.textContent = subtitle;

      if (statusEl) {
        const status = this.session.status || 'unknown';
        statusEl.className = `chat-status status-${status}`;
        statusEl.textContent = status;
      }
    }
  }

  private async loadMessages(): Promise<void> {
    if (!this.session) return;

    try {
      const response = await sessionsApi.getEvents(this.session.id) as { events?: any[] };
      const events = response.events || [];

      // Convert events to messages
      this.messages = events
        .map((event: any) => this.convertEventToMessage(event))
        .filter((msg: ChatMessage | null): msg is ChatMessage => msg !== null);

      this.renderMessages();
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  }

  private convertEventToMessage(event: any): ChatMessage | null {
    const data = event.eventData || event;
    const eventType = data?.type;

    if (!data) return null;

    // Skip control events
    if (['connected', 'completed', 'heartbeat', 'env_manager_log', 'system'].includes(eventType)) {
      return null;
    }

    // Handle different event types
    switch (eventType) {
      case 'user':
        return {
          id: event.id || `user-${Date.now()}`,
          type: 'user',
          content: data.content || data.message || '',
          timestamp: new Date(event.timestamp || Date.now()),
        };

      case 'assistant':
      case 'assistant_message':
        return {
          id: event.id || `assistant-${Date.now()}`,
          type: 'assistant',
          content: this.extractAssistantContent(data),
          timestamp: new Date(event.timestamp || Date.now()),
          model: data.model,
        };

      case 'error':
        return {
          id: event.id || `error-${Date.now()}`,
          type: 'error',
          content: data.message || data.error || 'An error occurred',
          timestamp: new Date(event.timestamp || Date.now()),
        };

      case 'message':
        return {
          id: event.id || `system-${Date.now()}`,
          type: 'system',
          content: data.message || '',
          timestamp: new Date(event.timestamp || Date.now()),
        };

      default:
        return null;
    }
  }

  private extractAssistantContent(data: any): string {
    // Handle content blocks array
    if (Array.isArray(data.content)) {
      return data.content
        .map((block: any) => {
          if (block.type === 'text') return block.text;
          if (block.type === 'tool_use') return `[Using tool: ${block.name}]`;
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }

    // Handle message field (from SSE)
    if (data.message) return data.message;

    // Handle direct content string
    if (typeof data.content === 'string') return data.content;

    return '';
  }

  private connectToStream(): void {
    if (!this.session) return;

    const streamUrl = sessionsApi.getStreamUrl(this.session.id);

    // Use EventSource for SSE
    const es = new EventSource(streamUrl, { withCredentials: true });

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleStreamEvent(data);
      } catch (error) {
        console.error('Failed to parse stream event:', error);
      }
    };

    es.onerror = () => {
      console.error('Stream connection error');
      es.close();
    };

    this.eventSource = { close: () => es.close() };

    // Update worker store
    workerStore.startExecution(this.session.id);
  }

  private handleStreamEvent(event: any): void {
    const eventType = event.type;

    // Update heartbeat
    workerStore.heartbeat();

    switch (eventType) {
      case 'assistant':
      case 'assistant_message':
        this.addMessage({
          id: `assistant-${Date.now()}`,
          type: 'assistant',
          content: this.extractAssistantContent(event),
          timestamp: new Date(),
          model: event.model,
        });
        break;

      case 'error':
        this.addMessage({
          id: `error-${Date.now()}`,
          type: 'error',
          content: event.message || event.error || 'An error occurred',
          timestamp: new Date(),
        });
        break;

      case 'completed':
        workerStore.stopExecution();
        this.updateSessionStatus('completed');
        break;

      case 'session_name':
        if (event.sessionName && this.session) {
          this.session.userRequest = event.sessionName;
          this.updateHeader();
        }
        break;
    }
  }

  private updateSessionStatus(status: string): void {
    if (this.session) {
      this.session.status = status as any;
      this.updateHeader();
    }
  }

  private addMessage(message: ChatMessage): void {
    this.messages.push(message);
    this.renderMessages();
    this.scrollToBottom();
  }

  private renderMessages(): void {
    if (!this.messagesContainer) return;

    const empty = this.$('.chat-empty') as HTMLElement;
    const list = this.$('.messages-list') as HTMLElement;

    if (this.messages.length === 0) {
      empty?.style.setProperty('display', 'flex');
      list?.style.setProperty('display', 'none');
    } else {
      empty?.style.setProperty('display', 'none');
      list?.style.setProperty('display', 'flex');

      this.messagesContainer.innerHTML = this.messages
        .map((msg) => this.renderMessage(msg))
        .join('');
    }
  }

  private renderMessage(message: ChatMessage): string {
    const typeClass = `message-${message.type}`;
    const user = authStore.getUser();
    const senderName = message.type === 'user'
      ? (user?.displayName || user?.email || 'You')
      : message.type === 'assistant'
        ? (message.model ? `Claude (${message.model})` : 'Claude')
        : message.type === 'error'
          ? 'Error'
          : 'System';

    const time = message.timestamp.toLocaleTimeString();
    const escapedContent = this.escapeHtml(message.content);
    const formattedContent = this.formatMarkdown(escapedContent);

    return `
      <div class="chat-message ${typeClass}">
        <div class="message-bubble">
          <div class="message-content">${formattedContent}</div>
          <div class="message-meta">
            <span class="message-sender">${senderName}</span>
            <span class="message-time">${time}</span>
          </div>
        </div>
      </div>
    `;
  }

  private formatMarkdown(text: string): string {
    // Basic markdown formatting
    let formatted = text
      // Code blocks
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Line breaks
      .replace(/\n/g, '<br>');

    return formatted;
  }

  private updateLoadingState(): void {
    const loading = this.$('.chat-loading') as HTMLElement;
    const empty = this.$('.chat-empty') as HTMLElement;
    const list = this.$('.messages-list') as HTMLElement;

    if (this.isLoading) {
      loading?.style.setProperty('display', 'flex');
      empty?.style.setProperty('display', 'none');
      list?.style.setProperty('display', 'none');
    } else {
      loading?.style.setProperty('display', 'none');
    }
  }

  private handleInputChange(): void {
    if (!this.inputElement) return;

    this.inputValue = this.inputElement.value;

    // Enable/disable send button
    const sendBtn = this.$('[data-action="send"]') as HTMLButtonElement;
    if (sendBtn) {
      sendBtn.disabled = !this.inputValue.trim() || this.isSending;
    }

    // Auto-resize textarea
    this.inputElement.style.height = 'auto';
    this.inputElement.style.height = Math.min(this.inputElement.scrollHeight, 200) + 'px';
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Enter without shift = send
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.handleSend();
    }
  }

  private async handleSend(): Promise<void> {
    if (!this.inputValue.trim() || this.isSending || !this.session) return;

    const content = this.inputValue.trim();
    this.inputValue = '';
    if (this.inputElement) {
      this.inputElement.value = '';
      this.inputElement.style.height = 'auto';
    }

    // Add user message
    this.addMessage({
      id: `user-${Date.now()}`,
      type: 'user',
      content,
      timestamp: new Date(),
    });

    this.isSending = true;
    this.updateSendButton();

    try {
      // Send message to execute endpoint
      const response = await sessionsApi.sendMessage(this.session.id, content);

      if (!response.success) {
        throw new Error(response.error || 'Failed to send message');
      }

      // Connect to stream for response
      this.connectToStream();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send message';
      toast.error(message);

      this.addMessage({
        id: `error-${Date.now()}`,
        type: 'error',
        content: message,
        timestamp: new Date(),
      });
    } finally {
      this.isSending = false;
      this.updateSendButton();
    }
  }

  private updateSendButton(): void {
    const sendBtn = this.$('[data-action="send"]') as HTMLButtonElement;
    if (sendBtn) {
      sendBtn.disabled = !this.inputValue.trim() || this.isSending;
      sendBtn.classList.toggle('loading', this.isSending);
    }
  }

  private scrollToBottom(): void {
    const container = this.$('.chat-messages') as HTMLElement;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  protected onUnmount(): void {
    // Close event source
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Stop execution tracking
    workerStore.stopExecution();
  }
}
