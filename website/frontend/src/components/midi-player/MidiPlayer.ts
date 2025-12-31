/**
 * MidiPlayer Component
 * Full-featured MIDI player with transport controls and track display
 */

import { Component } from '../base';
import { Button } from '../button';
import { midiStore } from '../../lib/midi';
import { MidiImportDialog } from '../midi-import-dialog';
import './midi-player.css';

import type { MidiStoreState } from '../../lib/midi';

export interface MidiPlayerOptions {
  /** Whether to show track list */
  showTracks?: boolean;
  /** Whether to show channel list */
  showChannels?: boolean;
  /** Whether to show file info */
  showFileInfo?: boolean;
  /** Compact mode */
  compact?: boolean;
}

export class MidiPlayer extends Component {
  private options: Required<MidiPlayerOptions>;
  private unsubscribe: (() => void) | null = null;
  private importDialog: MidiImportDialog | null = null;
  private progressBar: HTMLElement | null = null;
  private isDragging = false;
  private lastRenderedFileInfo: string | null = null;
  private timeCurrentEl: HTMLElement | null = null;
  private progressFillEl: HTMLElement | null = null;
  private progressHandleEl: HTMLElement | null = null;
  private documentMouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private documentMouseUpHandler: (() => void) | null = null;

  constructor(options: MidiPlayerOptions = {}) {
    super('div', { className: 'midi-player' });
    this.options = {
      showTracks: options.showTracks ?? true,
      showChannels: options.showChannels ?? false,
      showFileInfo: options.showFileInfo ?? true,
      compact: options.compact ?? false,
    };

    if (this.options.compact) {
      this.element.classList.add('midi-player--compact');
    }

    this.render();
  }

  render(): this {
    const state = midiStore.getState();

    this.element.innerHTML = `
      <div class="midi-player-header">
        <div class="midi-player-title">
          <svg class="midi-player-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18V5l12-2v13"/>
            <circle cx="6" cy="18" r="3"/>
            <circle cx="18" cy="16" r="3"/>
          </svg>
          <span class="midi-player-title-text">MIDI Player</span>
        </div>
        <div class="midi-player-actions"></div>
      </div>

      ${state.isLoaded ? this.renderPlayer(state) : this.renderEmpty()}
    `;

    // Add import button
    const actionsContainer = this.element.querySelector('.midi-player-actions');
    if (actionsContainer) {
      const importBtn = new Button(state.isLoaded ? 'Load New' : 'Import MIDI', {
        variant: 'secondary',
        size: 'sm',
        onClick: () => this.openImportDialog(),
      });
      importBtn.mount(actionsContainer as HTMLElement);

      if (state.isLoaded) {
        const closeBtn = new Button('Close', {
          variant: 'ghost',
          size: 'sm',
          onClick: () => midiStore.unload(),
        });
        closeBtn.mount(actionsContainer as HTMLElement);
      }
    }

    // Setup event listeners
    this.setupEventListeners();

    return this;
  }

  private renderEmpty(): string {
    return `
      <div class="midi-player-empty">
        <p class="midi-player-empty-text">No MIDI file loaded</p>
        <p class="midi-player-empty-hint">Click "Import MIDI" to load a file</p>
      </div>
    `;
  }

  private renderPlayer(state: MidiStoreState): string {
    const { fileInfo } = state;
    if (!fileInfo) return this.renderEmpty();

    return `
      ${this.options.showFileInfo ? this.renderFileInfo(state) : ''}
      ${this.renderTransportControls(state)}
      ${this.renderProgressBar(state)}
      ${this.options.showTracks && fileInfo.tracks.length > 1 ? this.renderTracks(state) : ''}
      ${this.options.showChannels ? this.renderChannels(state) : ''}
    `;
  }

  private renderFileInfo(state: MidiStoreState): string {
    const { fileInfo } = state;
    if (!fileInfo) return '';

    return `
      <div class="midi-player-file-info">
        <div class="midi-player-file-name">${this.escapeHtml(fileInfo.fileName)}</div>
        <div class="midi-player-file-meta">
          <span class="midi-player-file-meta-item">
            <span class="midi-player-file-meta-label">Duration:</span>
            <span class="midi-player-file-meta-value">${fileInfo.durationFormatted}</span>
          </span>
          <span class="midi-player-file-meta-item">
            <span class="midi-player-file-meta-label">Tempo:</span>
            <span class="midi-player-file-meta-value">${Math.round(fileInfo.tempo)} BPM</span>
          </span>
          <span class="midi-player-file-meta-item">
            <span class="midi-player-file-meta-label">Tracks:</span>
            <span class="midi-player-file-meta-value">${fileInfo.trackCount}</span>
          </span>
          <span class="midi-player-file-meta-item">
            <span class="midi-player-file-meta-label">Notes:</span>
            <span class="midi-player-file-meta-value">${fileInfo.noteCount.toLocaleString()}</span>
          </span>
        </div>
      </div>
    `;
  }

  private renderTransportControls(state: MidiStoreState): string {
    const isPlaying = state.isPlaying && !state.isPaused;
    const playPauseIcon = isPlaying
      ? '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>'
      : '<polygon points="5 3 19 12 5 21 5 3"/>';

    return `
      <div class="midi-player-transport">
        <button class="midi-player-transport-btn" data-action="stop" title="Stop" ${!state.isLoaded ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"/></svg>
        </button>
        <button class="midi-player-transport-btn midi-player-transport-btn--primary" data-action="play-pause" title="${isPlaying ? 'Pause' : 'Play'}" ${!state.isLoaded ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="currentColor">${playPauseIcon}</svg>
        </button>
        <div class="midi-player-time">
          <span class="midi-player-time-current">${this.formatTime(state.currentTime)}</span>
          <span class="midi-player-time-separator">/</span>
          <span class="midi-player-time-duration">${this.formatTime(state.duration)}</span>
        </div>
        <div class="midi-player-transport-spacer"></div>
        <button class="midi-player-transport-btn ${state.settings.loop ? 'midi-player-transport-btn--active' : ''}" data-action="loop" title="Loop">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="17 1 21 5 17 9"/>
            <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
            <polyline points="7 23 3 19 7 15"/>
            <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
          </svg>
        </button>
        <div class="midi-player-volume">
          <button class="midi-player-transport-btn" data-action="volume-toggle" title="Volume">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
          </button>
          <input type="range" class="midi-player-volume-slider" min="0" max="100" value="${Math.round(state.settings.volume * 100)}" />
        </div>
        <div class="midi-player-speed">
          <select class="midi-player-speed-select">
            <option value="0.5" ${state.settings.speed === 0.5 ? 'selected' : ''}>0.5x</option>
            <option value="0.75" ${state.settings.speed === 0.75 ? 'selected' : ''}>0.75x</option>
            <option value="1" ${state.settings.speed === 1.0 ? 'selected' : ''}>1x</option>
            <option value="1.25" ${state.settings.speed === 1.25 ? 'selected' : ''}>1.25x</option>
            <option value="1.5" ${state.settings.speed === 1.5 ? 'selected' : ''}>1.5x</option>
            <option value="2" ${state.settings.speed === 2.0 ? 'selected' : ''}>2x</option>
          </select>
        </div>
      </div>
    `;
  }

  private renderProgressBar(state: MidiStoreState): string {
    const progress = state.progress * 100;
    return `
      <div class="midi-player-progress" tabindex="0" role="slider" aria-label="Playback progress" aria-valuenow="${Math.round(progress)}" aria-valuemin="0" aria-valuemax="100">
        <div class="midi-player-progress-track">
          <div class="midi-player-progress-fill" style="width: ${progress}%"></div>
          <div class="midi-player-progress-handle" style="left: ${progress}%"></div>
        </div>
      </div>
    `;
  }

  private renderTracks(state: MidiStoreState): string {
    const { fileInfo } = state;
    if (!fileInfo || fileInfo.tracks.length <= 1) return '';

    const trackItems = fileInfo.tracks
      .filter((track) => track.noteCount > 0)
      .map((track) => `
        <div class="midi-player-track ${track.isMuted ? 'midi-player-track--muted' : ''}" data-track="${track.index}">
          <button class="midi-player-track-mute" data-action="toggle-track" data-track="${track.index}" title="${track.isMuted ? 'Unmute' : 'Mute'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              ${track.isMuted
                ? '<path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'
                : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>'
              }
            </svg>
          </button>
          <span class="midi-player-track-name">${this.escapeHtml(track.name)}</span>
          <span class="midi-player-track-notes">${track.noteCount} notes</span>
        </div>
      `)
      .join('');

    return `
      <div class="midi-player-tracks">
        <div class="midi-player-section-header">Tracks</div>
        <div class="midi-player-tracks-list">${trackItems}</div>
      </div>
    `;
  }

  private renderChannels(state: MidiStoreState): string {
    const { fileInfo } = state;
    if (!fileInfo || fileInfo.channels.length === 0) return '';

    const channelItems = fileInfo.channels
      .map((channel) => `
        <div class="midi-player-channel ${channel.isMuted ? 'midi-player-channel--muted' : ''}" data-channel="${channel.channel}">
          <button class="midi-player-channel-mute" data-action="toggle-channel" data-channel="${channel.channel}" title="${channel.isMuted ? 'Unmute' : 'Mute'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              ${channel.isMuted
                ? '<path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'
                : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>'
              }
            </svg>
          </button>
          <span class="midi-player-channel-name">Channel ${channel.channel + 1}</span>
          <span class="midi-player-channel-notes">${channel.noteCount} notes</span>
        </div>
      `)
      .join('');

    return `
      <div class="midi-player-channels">
        <div class="midi-player-section-header">Channels</div>
        <div class="midi-player-channels-list">${channelItems}</div>
      </div>
    `;
  }

  private setupEventListeners(): void {
    // Transport controls
    this.element.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const action = (e.currentTarget as HTMLElement).dataset.action;
        this.handleAction(action!);
      });
    });

    // Progress bar
    this.progressBar = this.element.querySelector('.midi-player-progress');
    if (this.progressBar) {
      this.progressBar.addEventListener('mousedown', (e) => this.handleProgressMouseDown(e as MouseEvent));
      this.progressBar.addEventListener('keydown', (e) => this.handleProgressKeyDown(e as KeyboardEvent));
    }

    // Cache element references for efficient updates
    this.timeCurrentEl = this.element.querySelector('.midi-player-time-current');
    this.progressFillEl = this.element.querySelector('.midi-player-progress-fill');
    this.progressHandleEl = this.element.querySelector('.midi-player-progress-handle');

    // Volume slider
    const volumeSlider = this.element.querySelector('.midi-player-volume-slider') as HTMLInputElement;
    if (volumeSlider) {
      volumeSlider.addEventListener('input', () => {
        midiStore.setVolume(parseInt(volumeSlider.value, 10) / 100);
      });
    }

    // Speed select
    const speedSelect = this.element.querySelector('.midi-player-speed-select') as HTMLSelectElement;
    if (speedSelect) {
      speedSelect.addEventListener('change', () => {
        midiStore.setSpeed(parseFloat(speedSelect.value));
      });
    }

    // Track mute buttons
    this.element.querySelectorAll('[data-action="toggle-track"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const trackIndex = parseInt((e.currentTarget as HTMLElement).dataset.track!, 10);
        midiStore.toggleTrackMute(trackIndex);
      });
    });

    // Channel mute buttons
    this.element.querySelectorAll('[data-action="toggle-channel"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const channel = parseInt((e.currentTarget as HTMLElement).dataset.channel!, 10);
        midiStore.toggleChannelMute(channel);
      });
    });
  }

  private handleAction(action: string): void {
    switch (action) {
      case 'play-pause':
        midiStore.togglePlay();
        break;
      case 'stop':
        midiStore.stop();
        break;
      case 'loop':
        midiStore.toggleLoop();
        break;
    }
  }

  private handleProgressMouseDown(e: MouseEvent): void {
    if (!this.progressBar) return;

    this.isDragging = true;
    this.updateProgressFromMouse(e);

    // Clean up any existing handlers first
    this.cleanupDocumentListeners();

    this.documentMouseMoveHandler = (moveEvent: MouseEvent) => {
      if (this.isDragging) {
        this.updateProgressFromMouse(moveEvent);
      }
    };

    this.documentMouseUpHandler = () => {
      this.isDragging = false;
      this.cleanupDocumentListeners();
    };

    document.addEventListener('mousemove', this.documentMouseMoveHandler);
    document.addEventListener('mouseup', this.documentMouseUpHandler);
  }

  private cleanupDocumentListeners(): void {
    if (this.documentMouseMoveHandler) {
      document.removeEventListener('mousemove', this.documentMouseMoveHandler);
      this.documentMouseMoveHandler = null;
    }
    if (this.documentMouseUpHandler) {
      document.removeEventListener('mouseup', this.documentMouseUpHandler);
      this.documentMouseUpHandler = null;
    }
  }

  private updateProgressFromMouse(e: MouseEvent): void {
    if (!this.progressBar) return;

    const rect = this.progressBar.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const progress = x / rect.width;
    const state = midiStore.getState();
    midiStore.seek(progress * state.duration);
  }

  private handleProgressKeyDown(e: KeyboardEvent): void {
    const state = midiStore.getState();
    const step = state.duration * 0.05; // 5% of duration

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        midiStore.seek(Math.max(0, state.currentTime - step));
        break;
      case 'ArrowRight':
        e.preventDefault();
        midiStore.seek(Math.min(state.duration, state.currentTime + step));
        break;
      case 'Home':
        e.preventDefault();
        midiStore.seek(0);
        break;
      case 'End':
        e.preventDefault();
        midiStore.seek(state.duration);
        break;
    }
  }

  private openImportDialog(): void {
    if (!this.importDialog) {
      this.importDialog = new MidiImportDialog({
        onImportSuccess: () => {
          this.render();
        },
      });
    }
    this.importDialog.open();
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Update only the time-sensitive elements (progress bar and time display)
   */
  private updateTimeDisplay(state: MidiStoreState): void {
    if (this.timeCurrentEl) {
      this.timeCurrentEl.textContent = this.formatTime(state.currentTime);
    }

    const progress = state.progress * 100;
    if (this.progressFillEl) {
      this.progressFillEl.style.width = `${progress}%`;
    }
    if (this.progressHandleEl) {
      this.progressHandleEl.style.left = `${progress}%`;
    }
    if (this.progressBar) {
      this.progressBar.setAttribute('aria-valuenow', String(Math.round(progress)));
    }
  }

  /**
   * Check if a full re-render is needed
   */
  private needsFullRender(state: MidiStoreState): boolean {
    const fileKey = state.fileInfo
      ? `${state.fileInfo.fileName}-${state.isLoaded}-${state.isPlaying}-${state.isPaused}-${state.settings.loop}-${JSON.stringify(state.fileInfo.tracks.map((t) => t.isMuted))}`
      : 'empty';

    if (fileKey !== this.lastRenderedFileInfo) {
      this.lastRenderedFileInfo = fileKey;
      return true;
    }
    return false;
  }

  protected onMount(): void {
    this.unsubscribe = midiStore.subscribe((state) => {
      if (this.needsFullRender(state)) {
        this.render();
      } else {
        // Only update time-sensitive elements
        this.updateTimeDisplay(state);
      }
    });
  }

  protected onUnmount(): void {
    this.cleanupDocumentListeners();
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.importDialog) {
      this.importDialog.unmount();
      this.importDialog = null;
    }
  }
}
