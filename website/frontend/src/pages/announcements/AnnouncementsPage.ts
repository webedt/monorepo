/**
 * Announcements Page
 * View official platform announcements (list and detail views)
 */

import { Page } from '../base/Page';
import { announcementsApi } from '../../lib/api';
import type { Announcement, AnnouncementType } from '../../types';
import './announcements.css';

export class AnnouncementsPage extends Page {
  readonly route = '/announcements';
  readonly title = 'Announcements';
  protected requiresAuth = false;

  private announcements: Announcement[] = [];
  private singleAnnouncement: Announcement | null = null;
  private isDetailView = false;
  private loading = true;
  private activeTab: AnnouncementType | 'all' = 'all';
  private total = 0;
  private offset = 0;
  private limit = 20;

  protected render(): string {
    if (this.loading) {
      return `
        <div class="announcements-page">
          <div class="loading-state">
            <div class="spinner"></div>
            <p>Loading ${this.isDetailView ? 'announcement' : 'announcements'}...</p>
          </div>
        </div>
      `;
    }

    // Detail view
    if (this.isDetailView) {
      return this.renderDetail();
    }

    // List view
    return this.renderList();
  }

  private renderList(): string {
    return `
      <div class="announcements-page">
        <header class="announcements-header">
          <div class="header-content">
            <h1>Announcements</h1>
            <p>Official platform updates and news</p>
          </div>
        </header>

        <div class="announcements-tabs">
          <button class="tab ${this.activeTab === 'all' ? 'active' : ''}" data-tab="all">All</button>
          <button class="tab ${this.activeTab === 'feature' ? 'active' : ''}" data-tab="feature">Features</button>
          <button class="tab ${this.activeTab === 'maintenance' ? 'active' : ''}" data-tab="maintenance">Maintenance</button>
          <button class="tab ${this.activeTab === 'alert' ? 'active' : ''}" data-tab="alert">Alerts</button>
          <button class="tab ${this.activeTab === 'general' ? 'active' : ''}" data-tab="general">General</button>
        </div>

        <div class="announcements-content">
          ${this.announcements.length === 0 ? `
            <div class="empty-state">
              <h2>No announcements</h2>
              <p>Check back later for updates!</p>
            </div>
          ` : `
            <div class="announcements-list">
              ${this.announcements.map((announcement) => this.renderAnnouncementCard(announcement)).join('')}
            </div>
          `}

          ${this.total > this.offset + this.limit ? `
            <div class="load-more">
              <button id="load-more-btn" class="btn btn-secondary">
                Load More
              </button>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  private renderDetail(): string {
    if (!this.singleAnnouncement) {
      return `
        <div class="announcements-page">
          <div class="error-state">
            <h2>Announcement not found</h2>
            <p>This announcement may have been removed or is no longer available.</p>
            <a href="#/announcements" class="btn btn-primary">Back to Announcements</a>
          </div>
        </div>
      `;
    }

    const announcement = this.singleAnnouncement;
    const typeLabels: Record<AnnouncementType, string> = {
      maintenance: 'Maintenance',
      feature: 'New Feature',
      alert: 'Alert',
      general: 'General',
    };

    const typeIcons: Record<AnnouncementType, string> = {
      maintenance: '🔧',
      feature: '✨',
      alert: '⚠️',
      general: '📢',
    };

    const priorityClass = announcement.priority === 'critical' ? 'priority-critical' :
                         announcement.priority === 'high' ? 'priority-high' : '';

    return `
      <div class="announcements-page">
        <div class="announcement-detail">
          <a href="#/announcements" class="back-link">← Back to Announcements</a>

          <article class="announcement-detail-card ${priorityClass}">
            <div class="announcement-header">
              <span class="announcement-type announcement-type--${announcement.type}">
                ${typeIcons[announcement.type]} ${typeLabels[announcement.type]}
              </span>
              ${announcement.pinned ? '<span class="announcement-pinned">📌 Pinned</span>' : ''}
              ${announcement.priority === 'critical' ? '<span class="announcement-priority-badge">Critical</span>' : ''}
              ${announcement.priority === 'high' ? '<span class="announcement-priority-badge high">Important</span>' : ''}
            </div>

            <h1 class="announcement-detail-title">${this.escapeHtml(announcement.title)}</h1>

            <div class="announcement-meta">
              <span class="announcement-author">Posted by ${announcement.author?.displayName || 'Admin'}</span>
              <span class="announcement-date">${this.formatFullDate(announcement.publishedAt || announcement.createdAt)}</span>
            </div>

            <div class="announcement-detail-content">
              ${this.formatContent(announcement.content)}
            </div>
          </article>
        </div>
      </div>
    `;
  }

  private renderAnnouncementCard(announcement: Announcement): string {
    const typeLabels: Record<AnnouncementType, string> = {
      maintenance: 'Maintenance',
      feature: 'New Feature',
      alert: 'Alert',
      general: 'General',
    };

    const typeIcons: Record<AnnouncementType, string> = {
      maintenance: '🔧',
      feature: '✨',
      alert: '⚠️',
      general: '📢',
    };

    const priorityClass = announcement.priority === 'critical' ? 'priority-critical' :
                         announcement.priority === 'high' ? 'priority-high' : '';

    return `
      <article class="announcement-card ${priorityClass}" data-announcement-id="${announcement.id}">
        <div class="announcement-header">
          <span class="announcement-type announcement-type--${announcement.type}">
            ${typeIcons[announcement.type]} ${typeLabels[announcement.type]}
          </span>
          ${announcement.pinned ? '<span class="announcement-pinned">📌 Pinned</span>' : ''}
          ${announcement.priority === 'critical' ? '<span class="announcement-priority-badge">Critical</span>' : ''}
          ${announcement.priority === 'high' ? '<span class="announcement-priority-badge high">Important</span>' : ''}
        </div>
        <h3 class="announcement-title">
          <a href="#/announcements/${announcement.id}">${this.escapeHtml(announcement.title)}</a>
        </h3>
        <div class="announcement-meta">
          <span class="announcement-author">Posted by ${announcement.author?.displayName || 'Admin'}</span>
          <span class="announcement-date">${this.formatDate(announcement.publishedAt || announcement.createdAt)}</span>
        </div>
        <p class="announcement-excerpt">
          ${this.escapeHtml(announcement.content.substring(0, 300))}${announcement.content.length > 300 ? '...' : ''}
        </p>
        <div class="announcement-footer">
          <a href="#/announcements/${announcement.id}" class="read-more-link">Read more →</a>
        </div>
      </article>
    `;
  }

  async load(): Promise<void> {
    this.loading = true;

    // Check if we're viewing a specific announcement
    const announcementId = this.getParams().id;
    this.isDetailView = !!announcementId;

    this.element.innerHTML = this.render();

    if (this.isDetailView && announcementId) {
      await this.loadSingleAnnouncement(announcementId);
    } else {
      // Check for query params for list view
      const type = this.getQuery().get('type');
      if (type && ['maintenance', 'feature', 'alert', 'general'].includes(type)) {
        this.activeTab = type as AnnouncementType;
      }
      await this.loadAnnouncements();
    }
  }

  private async loadSingleAnnouncement(id: string): Promise<void> {
    try {
      this.singleAnnouncement = await announcementsApi.get(id);
      this.loading = false;
      this.element.innerHTML = this.render();
    } catch (error) {
      console.error('Failed to load announcement:', error);
      this.singleAnnouncement = null;
      this.loading = false;
      this.element.innerHTML = this.render();
    }
  }

  private async loadAnnouncements(append = false): Promise<void> {
    try {
      const result = await announcementsApi.list({
        type: this.activeTab !== 'all' ? this.activeTab : undefined,
        limit: this.limit,
        offset: this.offset,
      });

      if (append) {
        this.announcements = [...this.announcements, ...(result.announcements || [])];
      } else {
        this.announcements = result.announcements || [];
      }
      this.total = result.total || 0;

      this.loading = false;
      this.element.innerHTML = this.render();
      this.setupEventListeners();
    } catch (error) {
      console.error('Failed to load announcements:', error);
      this.loading = false;
      this.element.innerHTML = `
        <div class="announcements-page">
          <div class="error-state">
            <h2>Failed to load announcements</h2>
            <p>Please try again later</p>
            <button onclick="location.reload()">Retry</button>
          </div>
        </div>
      `;
    }
  }

  private setupEventListeners(): void {
    // Tab buttons
    const tabs = this.$$('.tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const tabValue = (tab as HTMLElement).dataset.tab as AnnouncementType | 'all';
        if (tabValue !== this.activeTab) {
          this.activeTab = tabValue;
          this.offset = 0;
          this.loadAnnouncements();
        }
      });
    });

    // Load more button
    const loadMoreBtn = this.$('#load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        this.offset += this.limit;
        this.loadAnnouncements(true);
      });
    }
  }

  private formatDate(dateString: string): string {
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
    return date.toLocaleDateString();
  }

  private formatFullDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  private formatContent(content: string): string {
    // Convert newlines to paragraphs and escape HTML
    const escaped = this.escapeHtml(content);
    const paragraphs = escaped.split('\n\n').filter(p => p.trim());
    if (paragraphs.length > 1) {
      return paragraphs.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    }
    return `<p>${escaped.replace(/\n/g, '<br>')}</p>`;
  }
}
