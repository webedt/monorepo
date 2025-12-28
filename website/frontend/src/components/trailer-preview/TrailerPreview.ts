import { Component } from '../base';
import type { ComponentOptions } from '../base';
import './trailer-preview.css';

export interface TrailerPreviewOptions extends ComponentOptions {
  src: string;
  muted?: boolean;
  loop?: boolean;
  preload?: 'none' | 'metadata' | 'auto';
  hoverDelay?: number;
  onPlay?: () => void;
  onPause?: () => void;
  onError?: (error: Error) => void;
}

export class TrailerPreview extends Component<HTMLDivElement> {
  private video: HTMLVideoElement;
  private playButton: HTMLDivElement;
  private loadingSpinner: HTMLDivElement;
  private options: TrailerPreviewOptions;
  private hoverTimeout: ReturnType<typeof setTimeout> | null = null;
  private isPlaying = false;
  private hasError = false;

  constructor(options: TrailerPreviewOptions) {
    super('div', {
      className: 'trailer-preview',
      ...options,
    });

    this.options = {
      muted: true,
      loop: true,
      preload: 'metadata',
      hoverDelay: 500,
      ...options,
    };

    this.video = this.createVideo();
    this.playButton = this.createPlayButton();
    this.loadingSpinner = this.createLoadingSpinner();

    this.element.appendChild(this.video);
    this.element.appendChild(this.playButton);
    this.element.appendChild(this.loadingSpinner);

    this.setupEventListeners();
  }

  private createVideo(): HTMLVideoElement {
    const video = document.createElement('video');
    video.className = 'trailer-preview__video';
    video.src = this.options.src;
    video.muted = this.options.muted ?? true;
    video.loop = this.options.loop ?? true;
    video.preload = this.options.preload ?? 'metadata';
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    return video;
  }

  private createPlayButton(): HTMLDivElement {
    const button = document.createElement('div');
    button.className = 'trailer-preview__play-button';
    button.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
        <path d="M8 5v14l11-7z"/>
      </svg>
    `;
    return button;
  }

  private createLoadingSpinner(): HTMLDivElement {
    const spinner = document.createElement('div');
    spinner.className = 'trailer-preview__loading';
    spinner.innerHTML = `
      <div class="trailer-preview__spinner"></div>
    `;
    return spinner;
  }

  private setupEventListeners(): void {
    this.on(this.video, 'playing', () => {
      this.isPlaying = true;
      this.addClass('trailer-preview--playing');
      this.removeClass('trailer-preview--loading');
      this.options.onPlay?.();
    });

    this.on(this.video, 'pause', () => {
      this.isPlaying = false;
      this.removeClass('trailer-preview--playing');
      this.options.onPause?.();
    });

    this.on(this.video, 'waiting', () => {
      this.addClass('trailer-preview--loading');
    });

    this.on(this.video, 'canplay', () => {
      this.removeClass('trailer-preview--loading');
    });

    this.on(this.video, 'error', () => {
      this.hasError = true;
      this.addClass('trailer-preview--error');
      this.removeClass('trailer-preview--loading');
      this.options.onError?.(new Error('Failed to load trailer video'));
    });

    this.on(this.playButton, 'click', (e: Event) => {
      e.stopPropagation();
      if (this.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    });
  }

  startHoverPreview(): void {
    if (this.hasError) return;

    this.addClass('trailer-preview--loading');

    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
    }

    this.hoverTimeout = setTimeout(() => {
      this.play();
    }, this.options.hoverDelay);
  }

  stopHoverPreview(): void {
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = null;
    }

    this.pause();
    this.removeClass('trailer-preview--loading');
  }

  async play(): Promise<void> {
    if (this.hasError) return;

    try {
      await this.video.play();
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        this.hasError = true;
        this.addClass('trailer-preview--error');
        this.options.onError?.(error as Error);
      }
    }
  }

  pause(): void {
    this.video.pause();
    this.video.currentTime = 0;
  }

  setMuted(muted: boolean): void {
    this.video.muted = muted;
  }

  isMuted(): boolean {
    return this.video.muted;
  }

  getVideoElement(): HTMLVideoElement {
    return this.video;
  }

  protected override onUnmount(): void {
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
    }
    this.video.pause();
    this.video.src = '';
    this.video.load();
  }
}
