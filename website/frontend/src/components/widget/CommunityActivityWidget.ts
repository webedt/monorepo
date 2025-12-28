/**
 * Community Activity Widget
 * Displays a feed of recent channel messages across the community
 */

import { Widget } from './Widget';
import { Icon } from '../icon';
import { channelsApi } from '../../lib/api';

import type { WidgetOptions } from './types';
import type { ChannelMessage } from '../../types';

export interface CommunityActivityWidgetOptions extends WidgetOptions {
  maxItems?: number;
  refreshInterval?: number; // in milliseconds, 0 to disable auto-refresh
}

export class CommunityActivityWidget extends Widget {
  private messages: ChannelMessage[] = [];
  private maxItems: number;
  private refreshInterval: number;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private loading = true;
  private error: string | null = null;

  constructor(options: CommunityActivityWidgetOptions) {
    super(options);
    this.addClass('widget--community-activity');

    this.maxItems = options.maxItems || 10;
    this.refreshInterval = options.refreshInterval ?? 60000; // Default: 1 minute
  }

  renderContent(): void {
    const body = this.getBody();
    if (!body) return;

    body.innerHTML = '';

    if (this.loading) {
      const loadingEl = document.createElement('div');
      loadingEl.className = 'community-activity-loading';
      loadingEl.innerHTML = '<div class="spinner"></div>';
      body.appendChild(loadingEl);
      return;
    }

    if (this.error) {
      const errorEl = document.createElement('div');
      errorEl.className = 'community-activity-error';
      errorEl.textContent = this.error;
      body.appendChild(errorEl);
      return;
    }

    if (this.messages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'community-activity-empty';

      const iconWrapper = document.createElement('div');
      iconWrapper.className = 'community-activity-empty-icon';
      const icon = new Icon('send', { size: 'lg' });
      iconWrapper.appendChild(icon.getElement());
      empty.appendChild(iconWrapper);

      const text = document.createElement('p');
      text.textContent = 'No recent messages';
      empty.appendChild(text);

      const subtext = document.createElement('p');
      subtext.className = 'community-activity-empty-subtext';
      subtext.textContent = 'Join a channel to start chatting';
      empty.appendChild(subtext);

      body.appendChild(empty);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'community-activity-list';

    const displayMessages = this.messages.slice(0, this.maxItems);

    for (const message of displayMessages) {
      const li = document.createElement('li');
      li.className = 'community-activity-item';
      li.setAttribute('data-message-id', message.id);

      // Channel badge
      if (message.channel) {
        const channelBadge = document.createElement('div');
        channelBadge.className = 'community-activity-channel';

        const hashSpan = document.createElement('span');
        hashSpan.textContent = '#';
        hashSpan.className = 'community-activity-channel-hash';
        channelBadge.appendChild(hashSpan);

        const channelName = document.createElement('span');
        channelName.textContent = message.channel.name;
        channelBadge.appendChild(channelName);

        li.appendChild(channelBadge);
      }

      // Message content wrapper
      const contentWrapper = document.createElement('div');
      contentWrapper.className = 'community-activity-content';

      // Author and message
      const header = document.createElement('div');
      header.className = 'community-activity-header';

      const authorIcon = new Icon('user', { size: 'sm' });
      const authorIconWrapper = document.createElement('span');
      authorIconWrapper.className = 'community-activity-author-icon';
      authorIconWrapper.appendChild(authorIcon.getElement());
      header.appendChild(authorIconWrapper);

      const author = document.createElement('span');
      author.className = 'community-activity-author';
      author.textContent = message.author?.displayName || 'Anonymous';
      header.appendChild(author);

      const time = document.createElement('time');
      time.className = 'community-activity-time';
      time.dateTime = message.createdAt;
      time.textContent = this.formatTime(new Date(message.createdAt));
      header.appendChild(time);

      contentWrapper.appendChild(header);

      // Message text
      const messageText = document.createElement('p');
      messageText.className = 'community-activity-message';
      messageText.textContent = this.truncateMessage(message.content, 120);
      contentWrapper.appendChild(messageText);

      li.appendChild(contentWrapper);
      list.appendChild(li);
    }

    body.appendChild(list);

    // Add footer with view all link
    const footer = this.addFooter();
    footer.innerHTML = '';

    const viewAllLink = document.createElement('a');
    viewAllLink.href = '#/community';
    viewAllLink.className = 'community-activity-view-all';
    viewAllLink.textContent = 'View all channels';

    const arrowIcon = new Icon('arrowRight', { size: 'xs' });
    viewAllLink.appendChild(arrowIcon.getElement());

    footer.appendChild(viewAllLink);
  }

  private formatTime(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return date.toLocaleDateString();
  }

  private truncateMessage(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
  }

  /**
   * Load recent activity from API
   */
  async loadActivity(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.renderContent();

    try {
      const result = await channelsApi.getRecentActivity(this.maxItems);
      this.messages = result.messages || [];
    } catch (err) {
      console.error('Failed to load community activity:', err);
      this.error = 'Failed to load activity';
      this.messages = [];
    } finally {
      this.loading = false;
      this.renderContent();
    }
  }

  /**
   * Set messages directly (for server-side or mock data)
   */
  setMessages(messages: ChannelMessage[]): void {
    this.messages = messages;
    this.loading = false;
    this.error = null;
    this.renderContent();
  }

  /**
   * Add a new message to the top of the list
   */
  addMessage(message: ChannelMessage): void {
    this.messages.unshift(message);
    if (this.messages.length > this.maxItems * 2) {
      this.messages = this.messages.slice(0, this.maxItems * 2);
    }
    this.renderContent();
  }

  /**
   * Clear all messages
   */
  clearMessages(): void {
    this.messages = [];
    this.renderContent();
  }

  /**
   * Start auto-refresh timer
   */
  startAutoRefresh(): void {
    if (this.refreshInterval > 0 && !this.refreshTimer) {
      this.refreshTimer = setInterval(() => {
        this.loadActivity();
      }, this.refreshInterval);
    }
  }

  /**
   * Stop auto-refresh timer
   */
  stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  protected onMount(): void {
    super.onMount();
    this.loadActivity();

    if (this.refreshInterval > 0) {
      this.startAutoRefresh();
    }
  }

  protected onUnmount(): void {
    super.onUnmount();
    this.stopAutoRefresh();
  }
}
