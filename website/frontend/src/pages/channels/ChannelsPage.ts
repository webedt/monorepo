/**
 * Channels Page
 * Discord-like community channels for real-time discussions
 */

import { Page } from '../base/Page';
import { channelsApi } from '../../lib/api';
import { authStore } from '../../stores/authStore';
import type { CommunityChannel, ChannelMessage } from '../../types';
import './channels.css';

export class ChannelsPage extends Page {
  readonly route = '/channels';
  readonly title = 'Channels';
  protected requiresAuth = false;

  private channels: CommunityChannel[] = [];
  private selectedChannel: CommunityChannel | null = null;
  private messages: ChannelMessage[] = [];
  private loading = true;
  private loadingMessages = false;
  private messageOffset = 0;
  private messageLimit = 50;
  private hasMoreMessages = false;
  private messageInputValue = '';

  protected render(): string {
    if (this.loading) {
      return `
        <div class="channels-page">
          <div class="loading-state">
            <div class="spinner"></div>
            <p>Loading channels...</p>
          </div>
        </div>
      `;
    }

    return `
      <div class="channels-page">
        <aside class="channels-sidebar">
          <div class="channels-sidebar-header">
            <h2>Channels</h2>
          </div>
          <nav class="channels-list">
            ${this.channels.length === 0 ? `
              <div class="channels-empty">No channels available</div>
            ` : this.channels.map((channel) => this.renderChannelItem(channel)).join('')}
          </nav>
        </aside>
        <main class="channels-main">
          ${this.selectedChannel ? this.renderChannelContent() : this.renderNoChannelSelected()}
        </main>
      </div>
    `;
  }

  private renderChannelItem(channel: CommunityChannel): string {
    const isSelected = this.selectedChannel?.id === channel.id;
    const isDefault = channel.isDefault;

    return `
      <button
        class="channel-item ${isSelected ? 'selected' : ''} ${isDefault ? 'default' : ''}"
        data-channel-id="${channel.id}"
        data-channel-slug="${channel.slug}"
      >
        <span class="channel-hash">#</span>
        <span class="channel-name">${this.escapeHtml(channel.name)}</span>
        ${channel.isReadOnly ? '<span class="channel-readonly" title="Read only">🔒</span>' : ''}
      </button>
    `;
  }

  private renderNoChannelSelected(): string {
    return `
      <div class="no-channel-selected">
        <div class="no-channel-icon">💬</div>
        <h2>Welcome to Channels</h2>
        <p>Select a channel from the sidebar to start chatting</p>
      </div>
    `;
  }

  private renderChannelContent(): string {
    if (!this.selectedChannel) return '';

    return `
      <div class="channel-content">
        <header class="channel-header">
          <span class="channel-header-hash">#</span>
          <h1 class="channel-header-name">${this.escapeHtml(this.selectedChannel.name)}</h1>
          ${this.selectedChannel.description ? `
            <span class="channel-header-divider">|</span>
            <span class="channel-header-description">${this.escapeHtml(this.selectedChannel.description)}</span>
          ` : ''}
        </header>

        <div class="channel-messages" id="channel-messages">
          ${this.loadingMessages ? `
            <div class="messages-loading">
              <div class="spinner small"></div>
              <span>Loading messages...</span>
            </div>
          ` : this.messages.length === 0 ? `
            <div class="messages-empty">
              <div class="messages-empty-icon">✨</div>
              <h3>No messages yet</h3>
              <p>Be the first to start the conversation in #${this.escapeHtml(this.selectedChannel.name)}!</p>
            </div>
          ` : `
            ${this.hasMoreMessages ? `
              <button class="load-more-messages" id="load-more-messages">
                Load older messages
              </button>
            ` : ''}
            <div class="messages-list">
              ${this.messages.map((msg) => this.renderMessage(msg)).join('')}
            </div>
          `}
        </div>

        ${this.renderMessageInput()}
      </div>
    `;
  }

  private renderMessage(message: ChannelMessage): string {
    const authorName = message.author?.displayName || 'Unknown User';
    const time = this.formatMessageTime(message.createdAt);
    const isOwn = message.userId === authStore.getUser()?.id;

    return `
      <div class="message ${isOwn ? 'own' : ''}" data-message-id="${message.id}">
        <div class="message-avatar">
          ${authorName.charAt(0).toUpperCase()}
        </div>
        <div class="message-body">
          <div class="message-header">
            <span class="message-author">${this.escapeHtml(authorName)}</span>
            <span class="message-time">${time}</span>
            ${message.edited ? '<span class="message-edited">(edited)</span>' : ''}
          </div>
          <div class="message-content">${this.escapeHtml(message.content)}</div>
        </div>
      </div>
    `;
  }

  private renderMessageInput(): string {
    const isAuthenticated = authStore.isAuthenticated();
    const isReadOnly = this.selectedChannel?.isReadOnly && !authStore.getUser()?.isAdmin;

    if (!isAuthenticated) {
      return `
        <div class="message-input-container disabled">
          <div class="message-input-login">
            <a href="#/login">Sign in</a> to send messages
          </div>
        </div>
      `;
    }

    if (isReadOnly) {
      return `
        <div class="message-input-container disabled">
          <div class="message-input-readonly">
            This channel is read-only
          </div>
        </div>
      `;
    }

    return `
      <form class="message-input-container" id="message-form">
        <input
          type="text"
          id="message-input"
          class="message-input"
          placeholder="Message #${this.escapeHtml(this.selectedChannel?.name || '')}"
          maxlength="4000"
          autocomplete="off"
          value="${this.escapeHtml(this.messageInputValue)}"
        />
        <button type="submit" class="message-send-btn" title="Send message">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </form>
    `;
  }

  async load(): Promise<void> {
    this.loading = true;
    this.element.innerHTML = this.render();

    try {
      // Load channels
      const result = await channelsApi.getChannels();
      this.channels = result.channels || [];

      // Check for slug in URL params
      const slug = this.getParams().slug;
      if (slug) {
        const channel = this.channels.find((c) => c.slug === slug);
        if (channel) {
          this.selectedChannel = channel;
        }
      }

      // If no channel selected, try to select #general or first default channel
      if (!this.selectedChannel && this.channels.length > 0) {
        const generalChannel = this.channels.find((c) => c.slug === 'general');
        const defaultChannel = this.channels.find((c) => c.isDefault);
        this.selectedChannel = generalChannel || defaultChannel || this.channels[0];
      }

      this.loading = false;
      this.element.innerHTML = this.render();
      this.setupEventListeners();

      // Load messages for selected channel
      if (this.selectedChannel) {
        await this.loadMessages();
      }
    } catch (error) {
      console.error('Failed to load channels:', error);
      this.loading = false;
      this.element.innerHTML = `
        <div class="channels-page">
          <div class="error-state">
            <h2>Failed to load channels</h2>
            <p>Please try again later</p>
            <button onclick="location.reload()">Retry</button>
          </div>
        </div>
      `;
    }
  }

  private async loadMessages(append = false): Promise<void> {
    if (!this.selectedChannel) return;

    this.loadingMessages = !append;
    if (!append) {
      this.messages = [];
      this.messageOffset = 0;
    }
    this.element.innerHTML = this.render();
    this.setupEventListeners();

    try {
      const result = await channelsApi.getMessages(this.selectedChannel.id, {
        limit: this.messageLimit,
        offset: this.messageOffset,
      });

      if (append) {
        // Prepend older messages
        this.messages = [...(result.messages || []), ...this.messages];
      } else {
        this.messages = result.messages || [];
      }
      this.hasMoreMessages = result.hasMore || false;

      this.loadingMessages = false;
      this.element.innerHTML = this.render();
      this.setupEventListeners();

      // Scroll to bottom if not loading more
      if (!append) {
        this.scrollMessagesToBottom();
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
      this.loadingMessages = false;
      this.element.innerHTML = this.render();
      this.setupEventListeners();
    }
  }

  private setupEventListeners(): void {
    // Channel selection
    const channelItems = this.$$('.channel-item');
    channelItems.forEach((item) => {
      item.addEventListener('click', async () => {
        const channelId = (item as HTMLElement).dataset.channelId;
        const channel = this.channels.find((c) => c.id === channelId);
        if (channel && channel.id !== this.selectedChannel?.id) {
          this.selectedChannel = channel;
          this.messageInputValue = '';
          this.element.innerHTML = this.render();
          this.setupEventListeners();
          await this.loadMessages();

          // Update URL without full navigation
          const newUrl = `#/channels/${channel.slug}`;
          history.replaceState(null, '', newUrl);
        }
      });
    });

    // Message form
    const messageForm = this.$('#message-form') as HTMLFormElement;
    if (messageForm) {
      messageForm.addEventListener('submit', (e) => this.handleSendMessage(e));
    }

    // Message input - save value on input
    const messageInput = this.$('#message-input') as HTMLInputElement;
    if (messageInput) {
      messageInput.addEventListener('input', () => {
        this.messageInputValue = messageInput.value;
      });
      // Focus input
      messageInput.focus();
    }

    // Load more messages
    const loadMoreBtn = this.$('#load-more-messages');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', async () => {
        this.messageOffset += this.messageLimit;
        await this.loadMessages(true);
      });
    }
  }

  private async handleSendMessage(e: Event): Promise<void> {
    e.preventDefault();

    if (!this.selectedChannel || !authStore.isAuthenticated()) return;

    const input = this.$('#message-input') as HTMLInputElement;
    const content = input?.value.trim();

    if (!content) return;

    try {
      const result = await channelsApi.postMessage(this.selectedChannel.id, { content });

      // Add new message to the list
      if (result.message) {
        this.messages.push(result.message);
      }

      // Clear input
      this.messageInputValue = '';
      this.element.innerHTML = this.render();
      this.setupEventListeners();
      this.scrollMessagesToBottom();
    } catch (error) {
      console.error('Failed to send message:', error);
      alert('Failed to send message. Please try again.');
    }
  }

  private scrollMessagesToBottom(): void {
    const messagesContainer = this.$('#channel-messages');
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  private formatMessageTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  }
}
