/**
 * Session Activity Widget
 * Displays active and recent editor sessions with real-time updates
 */

import { Widget } from './Widget';
import { Icon } from '../icon';
import { sessionsApi } from '../../lib/api';

import type { WidgetOptions } from './types';
import type { Session, SessionStatus } from '../../types';
import type { IconName } from '../icon';

export interface SessionActivityWidgetOptions extends WidgetOptions {
  maxItems?: number;
}

interface SessionItem {
  id: string;
  title: string;
  repo?: string;
  status: SessionStatus;
  timestamp: Date;
}

const STATUS_ICONS: Record<SessionStatus, IconName> = {
  running: 'code',
  pending: 'info',
  completed: 'checkCircle',
  failed: 'xCircle',
  cancelled: 'xCircle',
};

const STATUS_LABELS: Record<SessionStatus, string> = {
  running: 'Running',
  pending: 'Pending',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export class SessionActivityWidget extends Widget {
  private sessions: SessionItem[] = [];
  private maxItems: number;
  private loading = true;
  private eventSource: EventSource | null = null;
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;

  constructor(options: SessionActivityWidgetOptions) {
    super(options);
    this.addClass('widget--session-activity');

    this.maxItems = options.maxItems || 8;
  }

  renderContent(): void {
    const body = this.getBody();
    if (!body) return;

    body.innerHTML = '';

    if (this.loading) {
      const loadingEl = document.createElement('div');
      loadingEl.className = 'session-activity-loading';
      loadingEl.innerHTML = `
        <div class="session-activity-spinner"></div>
        <span>Loading sessions...</span>
      `;
      body.appendChild(loadingEl);
      return;
    }

    if (this.sessions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'session-activity-empty';
      empty.innerHTML = `
        <div class="session-activity-empty-icon"></div>
        <p>No recent sessions</p>
        <p class="session-activity-empty-hint">Start a new session to get going</p>
      `;
      const emptyIcon = empty.querySelector('.session-activity-empty-icon') as HTMLElement;
      if (emptyIcon) {
        const icon = new Icon('code', { size: 'lg' });
        icon.mount(emptyIcon);
      }
      body.appendChild(empty);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'session-activity-list';

    const displayItems = this.sessions.slice(0, this.maxItems);

    for (const item of displayItems) {
      const li = document.createElement('li');
      li.className = `session-activity-item session-activity-item--${item.status}`;
      li.setAttribute('data-session-id', item.id);

      // Status icon
      const iconWrapper = document.createElement('div');
      iconWrapper.className = 'session-activity-icon';
      const iconName = STATUS_ICONS[item.status];
      const icon = new Icon(iconName, { size: 'sm' });
      iconWrapper.appendChild(icon.getElement());

      // Add pulse animation for running status
      if (item.status === 'running') {
        iconWrapper.classList.add('session-activity-icon--running');
      }

      li.appendChild(iconWrapper);

      // Content
      const content = document.createElement('div');
      content.className = 'session-activity-content';

      const title = document.createElement('div');
      title.className = 'session-activity-title';
      title.textContent = item.title;
      title.title = item.title;
      content.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'session-activity-meta';

      if (item.repo) {
        const repo = document.createElement('span');
        repo.className = 'session-activity-repo';
        repo.textContent = item.repo;
        meta.appendChild(repo);
      }

      const status = document.createElement('span');
      status.className = `session-activity-status session-activity-status--${item.status}`;
      status.textContent = STATUS_LABELS[item.status];
      meta.appendChild(status);

      content.appendChild(meta);

      const time = document.createElement('time');
      time.className = 'session-activity-time';
      time.dateTime = item.timestamp.toISOString();
      time.textContent = this.formatTime(item.timestamp);
      content.appendChild(time);

      li.appendChild(content);

      // Click handler to open session
      li.addEventListener('click', () => {
        window.location.hash = `/session/${item.id}/chat`;
      });

      list.appendChild(li);
    }

    body.appendChild(list);

    // Add footer with view all link
    const footer = this.addFooter();
    footer.innerHTML = '';

    const viewAll = document.createElement('a');
    viewAll.className = 'session-activity-view-all';
    viewAll.href = '#/agents';
    viewAll.innerHTML = `View all sessions`;
    const arrowIcon = new Icon('arrowRight', { size: 'sm' });
    viewAll.appendChild(arrowIcon.getElement());
    footer.appendChild(viewAll);
  }

  private formatTime(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return date.toLocaleDateString();
  }

  private sessionToItem(session: Session): SessionItem {
    return {
      id: session.id,
      title: session.userRequest?.slice(0, 80) || 'Untitled Session',
      repo: session.repositoryOwner && session.repositoryName
        ? `${session.repositoryOwner}/${session.repositoryName}`
        : undefined,
      status: session.status,
      timestamp: new Date(session.createdAt),
    };
  }

  async loadSessions(): Promise<void> {
    this.loading = true;
    this.renderContent();

    try {
      const response = await sessionsApi.list();
      const sessions = (response.sessions || [])
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, this.maxItems * 2);

      this.sessions = sessions.map(s => this.sessionToItem(s));
    } catch (error) {
      console.error('[SessionActivityWidget] Failed to load sessions:', error);
      this.sessions = [];
    } finally {
      this.loading = false;
      this.renderContent();
    }
  }

  private subscribeToUpdates(): void {
    if (this.eventSource) {
      this.eventSource.close();
    }

    this.eventSource = new EventSource('/api/sessions/updates', { withCredentials: true });

    this.eventSource.addEventListener('created', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const session = data.session as Session;
        const item = this.sessionToItem(session);

        // Add to beginning
        this.sessions.unshift(item);

        // Keep max items
        if (this.sessions.length > this.maxItems * 2) {
          this.sessions = this.sessions.slice(0, this.maxItems * 2);
        }

        this.renderContent();
      } catch (error) {
        console.error('[SessionActivityWidget] Failed to parse created event:', error);
      }
    });

    this.eventSource.addEventListener('updated', (event: MessageEvent) => {
      this.handleSessionUpdate(event);
    });

    this.eventSource.addEventListener('status_changed', (event: MessageEvent) => {
      this.handleSessionUpdate(event);
    });

    this.eventSource.addEventListener('deleted', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const sessionId = data.session?.id;
        if (sessionId) {
          this.sessions = this.sessions.filter(s => s.id !== sessionId);
          this.renderContent();
        }
      } catch (error) {
        console.error('[SessionActivityWidget] Failed to parse deleted event:', error);
      }
    });

    this.eventSource.onerror = () => {
      console.error('[SessionActivityWidget] SSE error, attempting reconnect...');
      this.handleReconnect();
    };

    this.eventSource.onopen = () => {
      this.reconnectAttempts = 0;
    };
  }

  private handleSessionUpdate(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      const updatedSession = data.session as Partial<Session> & { id: string };

      const index = this.sessions.findIndex(s => s.id === updatedSession.id);
      if (index !== -1) {
        // Update existing session
        if (updatedSession.userRequest) {
          this.sessions[index].title = updatedSession.userRequest.slice(0, 80) || 'Untitled Session';
        }
        if (updatedSession.status) {
          this.sessions[index].status = updatedSession.status;
        }
        if (updatedSession.repositoryOwner && updatedSession.repositoryName) {
          this.sessions[index].repo = `${updatedSession.repositoryOwner}/${updatedSession.repositoryName}`;
        }

        this.renderContent();
      }
    } catch (error) {
      console.error('[SessionActivityWidget] Failed to parse update event:', error);
    }
  }

  private handleReconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.warn('[SessionActivityWidget] Max reconnect attempts reached');
      return;
    }

    const delay = Math.pow(2, this.reconnectAttempts) * 1000;
    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(() => {
      this.subscribeToUpdates();
    }, delay);
  }

  protected onMount(): void {
    super.onMount();
    this.loadSessions();
    this.subscribeToUpdates();
  }

  protected onUnmount(): void {
    super.onUnmount();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  /**
   * Refresh sessions manually
   */
  refresh(): void {
    this.loadSessions();
  }
}
