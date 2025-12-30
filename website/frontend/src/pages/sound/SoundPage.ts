/**
 * Sound Editor Page
 * Audio waveform editor with offline support
 * AI features require connectivity
 */

import { Page, type PageOptions } from '../base/Page';
import { Button, Spinner, toast, OfflineIndicator } from '../../components';
import { sessionsApi, storageWorkerApi } from '../../lib/api';
import { offlineManager, isOffline } from '../../lib/offline';
import { offlineStorage } from '../../lib/offlineStorage';
import { beatGridStore } from '../../stores/beatGridStore';
import { audioSourceStore } from '../../stores/audioSourceStore';
import type { BeatGridSettings } from '../../stores/beatGridStore';
import type { AudioSourceSettings } from '../../stores/audioSourceStore';
import type { WaveformType } from '../../lib/audio';
import { AUDIO_PRESETS } from '../../lib/audio';
import type { Session } from '../../types';
import './sound.css';

interface AudioSelection {
  start: number;
  end: number;
}

interface SoundPageOptions extends PageOptions {
  params?: {
    sessionId?: string;
  };
}

export class SoundPage extends Page<SoundPageOptions> {
  readonly route = '/session/:sessionId/sound';
  readonly title = 'Sound Editor';
  protected requiresAuth = true;

  private session: Session | null = null;
  private isSaving = false;
  private offlineIndicator: OfflineIndicator | null = null;
  private unsubscribeOffline: (() => void) | null = null;
  private isOfflineMode = false;

  // Audio state
  private audioContext: AudioContext | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private isPlaying = false;
  private currentTime = 0;
  private duration = 0;
  private volume = 70;
  private playbackRate = 1;

  // Waveform canvas
  private waveformCanvas: HTMLCanvasElement | null = null;
  private waveformCtx: CanvasRenderingContext2D | null = null;

  // Selection
  private selection: AudioSelection | null = null;
  private isSelecting = false;
  private selectionStart = 0;

  // History for undo/redo
  private history: AudioBuffer[] = [];
  private historyIndex = -1;
  private hasUnsavedChanges = false;

  // Animation
  private animationFrame: number | null = null;
  private playStartTime = 0;
  private playOffset = 0;

  // Current file
  private currentFilePath: string | null = null;

  // Event handlers for cleanup
  private keyboardHandler: ((e: KeyboardEvent) => void) | null = null;
  private keyUpHandler: ((e: KeyboardEvent) => void) | null = null;

  // ResizeObserver for canvas resizing
  private resizeObserver: ResizeObserver | null = null;

  // Beat grid state
  private beatGridSettings: BeatGridSettings = beatGridStore.getSettings();
  private unsubscribeBeatGrid: (() => void) | null = null;

  // Audio source state
  private audioSourceSettings: AudioSourceSettings = audioSourceStore.getSettings();
  private unsubscribeAudioSource: (() => void) | null = null;
  private synthPanelVisible = false;

  protected render(): string {
    return `
      <div class="sound-page">
        <header class="sound-header">
          <div class="sound-header-left">
            <button class="back-btn" data-action="back">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <div class="sound-session-info">
              <h1 class="sound-title">Sound Editor</h1>
              <p class="sound-subtitle">Loading...</p>
            </div>
          </div>
          <div class="sound-header-right">
            <div class="offline-status-badge" style="display: none;">
              <span class="offline-badge">Offline Mode</span>
            </div>
            <div class="ai-status-badge">
              <span class="ai-badge ai-badge--online">AI Ready</span>
            </div>
            <div class="save-btn-container"></div>
          </div>
        </header>
        <div class="offline-indicator-container"></div>

        <div class="sound-toolbar">
          <div class="toolbar-group">
            <button class="toolbar-btn" data-action="undo" title="Undo (Ctrl+Z)" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg>
            </button>
            <button class="toolbar-btn" data-action="redo" title="Redo (Ctrl+Y)" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6"/></svg>
            </button>
          </div>

          <div class="toolbar-separator"></div>

          <div class="toolbar-group">
            <button class="toolbar-btn" data-action="clip" title="Clip to selection" disabled>✂</button>
            <button class="toolbar-btn" data-action="delete" title="Delete selection" disabled>🗑</button>
          </div>

          <div class="toolbar-separator"></div>

          <div class="toolbar-group">
            <button class="toolbar-btn" data-action="fade-in" title="Fade In" disabled>◢</button>
            <button class="toolbar-btn" data-action="fade-out" title="Fade Out" disabled>◣</button>
            <button class="toolbar-btn" data-action="normalize" title="Normalize" disabled>📊</button>
            <button class="toolbar-btn" data-action="reverse" title="Reverse" disabled>⇄</button>
          </div>

          <div class="toolbar-separator"></div>

          <div class="toolbar-group">
            <button class="toolbar-btn" data-action="zoom-in" title="Zoom In">+</button>
            <button class="toolbar-btn" data-action="zoom-out" title="Zoom Out">-</button>
            <button class="toolbar-btn" data-action="zoom-fit" title="Fit to view">⊡</button>
          </div>

          <div class="toolbar-separator"></div>

          <div class="toolbar-group beat-grid-group">
            <button class="toolbar-btn" data-action="toggle-grid" title="Toggle beat grid (G)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="4" y1="4" x2="4" y2="20"></line>
                <line x1="8" y1="4" x2="8" y2="20"></line>
                <line x1="12" y1="4" x2="12" y2="20"></line>
                <line x1="16" y1="4" x2="16" y2="20"></line>
                <line x1="20" y1="4" x2="20" y2="20"></line>
              </svg>
            </button>
            <button class="toolbar-btn" data-action="toggle-snap" title="Snap to beat grid (S)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 3v18M3 12h18M7 7l10 10M17 7l-10 10"></path>
              </svg>
            </button>
            <button class="toolbar-btn" data-action="detect-bpm" title="Auto-detect BPM">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            </button>
            <div class="bpm-input-group">
              <label class="bpm-label">BPM:</label>
              <input type="number" class="bpm-input" min="20" max="300" value="120" step="1">
            </div>
            <select class="subdivision-select" title="Grid subdivision">
              <option value="1">1/4</option>
              <option value="2">1/8</option>
              <option value="4">1/16</option>
            </select>
          </div>

          <div class="toolbar-spacer"></div>

          <div class="toolbar-group volume-group">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            </svg>
            <input type="range" class="volume-slider" min="0" max="100" value="70">
            <span class="volume-value">70%</span>
          </div>

          <div class="toolbar-separator"></div>

          <div class="toolbar-group ai-group">
            <button class="toolbar-btn ai-btn" data-action="ai-enhance" title="AI Enhance" disabled>
              AI Enhance
            </button>
          </div>

          <div class="toolbar-separator"></div>

          <div class="toolbar-group synth-group">
            <button class="toolbar-btn synth-toggle-btn" data-action="toggle-synth" title="Toggle Synthesizer (T)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18V5l12-2v13M9 18c0 1.1-1.3 2-3 2s-3-.9-3-2 1.3-2 3-2 3 .9 3 2zm12-3c0 1.1-1.3 2-3 2s-3-.9-3-2 1.3-2 3-2 3 .9 3 2z"/>
              </svg>
              Synth
            </button>
          </div>
        </div>

        <!-- Synthesizer Panel -->
        <div class="synth-panel" style="display: none;">
          <div class="synth-panel-header">
            <span class="synth-panel-title">Audio Source</span>
            <button class="synth-close-btn" data-action="close-synth" title="Close">×</button>
          </div>
          <div class="synth-panel-content">
            <div class="synth-section">
              <label class="synth-label">Waveform</label>
              <div class="synth-waveform-buttons">
                <button class="synth-wave-btn active" data-waveform="sine" title="Sine">∿</button>
                <button class="synth-wave-btn" data-waveform="square" title="Square">⊓</button>
                <button class="synth-wave-btn" data-waveform="sawtooth" title="Sawtooth">⊿</button>
                <button class="synth-wave-btn" data-waveform="triangle" title="Triangle">△</button>
              </div>
            </div>
            <div class="synth-section">
              <label class="synth-label">Preset</label>
              <select class="synth-preset-select">
                ${AUDIO_PRESETS.map(p => `<option value="${p.name}">${p.name}</option>`).join('')}
              </select>
            </div>
            <div class="synth-section">
              <label class="synth-label">Frequency: <span class="synth-freq-value">440</span> Hz</label>
              <input type="range" class="synth-freq-slider" min="20" max="2000" value="440" step="1">
            </div>
            <div class="synth-section">
              <label class="synth-label">Volume: <span class="synth-vol-value">50</span>%</label>
              <input type="range" class="synth-vol-slider" min="0" max="100" value="50" step="1">
            </div>
            <div class="synth-section synth-envelope">
              <label class="synth-label">Envelope (ADSR)</label>
              <div class="synth-envelope-controls">
                <div class="synth-env-control">
                  <label>A</label>
                  <input type="range" class="synth-env-attack" min="0" max="1000" value="10" step="1">
                </div>
                <div class="synth-env-control">
                  <label>D</label>
                  <input type="range" class="synth-env-decay" min="0" max="1000" value="100" step="1">
                </div>
                <div class="synth-env-control">
                  <label>S</label>
                  <input type="range" class="synth-env-sustain" min="0" max="100" value="70" step="1">
                </div>
                <div class="synth-env-control">
                  <label>R</label>
                  <input type="range" class="synth-env-release" min="0" max="2000" value="200" step="1">
                </div>
              </div>
            </div>
            <div class="synth-section synth-keyboard">
              <label class="synth-label">Keyboard (Press keys Z-M for notes)</label>
              <div class="synth-piano">
                <div class="piano-keys">
                  <button class="piano-key white" data-note="C4">C</button>
                  <button class="piano-key black" data-note="C#4">C#</button>
                  <button class="piano-key white" data-note="D4">D</button>
                  <button class="piano-key black" data-note="D#4">D#</button>
                  <button class="piano-key white" data-note="E4">E</button>
                  <button class="piano-key white" data-note="F4">F</button>
                  <button class="piano-key black" data-note="F#4">F#</button>
                  <button class="piano-key white" data-note="G4">G</button>
                  <button class="piano-key black" data-note="G#4">G#</button>
                  <button class="piano-key white" data-note="A4">A</button>
                  <button class="piano-key black" data-note="A#4">A#</button>
                  <button class="piano-key white" data-note="B4">B</button>
                  <button class="piano-key white" data-note="C5">C</button>
                </div>
              </div>
            </div>
            <div class="synth-section synth-play-controls">
              <button class="synth-play-btn" data-action="synth-play">▶ Play</button>
              <button class="synth-stop-btn" data-action="synth-stop">◼ Stop</button>
            </div>
          </div>
        </div>

        <div class="sound-layout">
          <!-- File Explorer Sidebar -->
          <aside class="sound-explorer">
            <div class="panel-header">
              <span class="panel-title">Audio Files</span>
              <button class="refresh-btn" data-action="refresh" title="Refresh">↻</button>
            </div>
            <div class="file-list">
              <div class="file-list-loading">
                <div class="spinner-container"></div>
              </div>
              <div class="file-list-empty" style="display: none;">
                <p>No audio files found</p>
                <p class="hint">Upload WAV, MP3, or OGG files</p>
              </div>
              <div class="file-list-items" style="display: none;"></div>
            </div>
            <div class="upload-section">
              <button class="upload-btn" data-action="upload">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Upload Audio
              </button>
            </div>
          </aside>

          <!-- Main Waveform Area -->
          <main class="waveform-container">
            <div class="waveform-loading">
              <div class="waveform-spinner"></div>
              <p>Loading editor...</p>
            </div>
            <div class="waveform-empty" style="display: none;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
                <path d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
              </svg>
              <p>Select an audio file to edit</p>
              <p class="hint">Supports WAV, MP3, OGG, AAC, FLAC</p>
            </div>
            <div class="waveform-wrapper" style="display: none;">
              <div class="waveform-info-bar">
                <span class="waveform-filename">audio.wav</span>
                <span class="info-separator">|</span>
                <span class="waveform-channels">2 ch</span>
                <span class="info-separator">|</span>
                <span class="waveform-samplerate">44100 Hz</span>
                <span class="info-separator">|</span>
                <span class="waveform-duration">0:00</span>
                <span class="waveform-selection" style="display: none;">
                  <span class="info-separator">|</span>
                  Selection: <span class="selection-range">0:00 - 0:00</span>
                </span>
                <span class="unsaved-indicator" style="display: none;">● Unsaved</span>
              </div>
              <div class="waveform-canvas-container">
                <canvas class="waveform-canvas"></canvas>
              </div>
              <div class="waveform-time-bar">
                <span class="time-current">0:00.00</span>
                <span class="time-hint">Shift+Click and drag to select region</span>
                <span class="time-total">0:00.00</span>
              </div>
            </div>
          </main>
        </div>

        <!-- Transport Controls -->
        <footer class="transport-bar">
          <div class="transport-controls">
            <button class="transport-btn stop-btn" data-action="stop" title="Stop">
              <div class="stop-icon"></div>
            </button>
            <button class="transport-btn play-btn" data-action="play" title="Play/Pause">
              <svg class="play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              <svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor" style="display: none;"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
            </button>
            <button class="transport-btn loop-btn" data-action="loop" title="Loop selection">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>
            </button>
          </div>

          <div class="progress-container">
            <input type="range" class="progress-slider" min="0" max="100" value="0" step="0.01">
          </div>

          <div class="playback-rate-group">
            <label>Speed:</label>
            <select class="playback-rate-select">
              <option value="0.5">0.5x</option>
              <option value="0.75">0.75x</option>
              <option value="1" selected>1x</option>
              <option value="1.25">1.25x</option>
              <option value="1.5">1.5x</option>
              <option value="2">2x</option>
            </select>
          </div>
        </footer>
      </div>
    `;
  }

  protected onMount(): void {
    super.onMount();

    // Setup back button
    this.addListenerBySelector('[data-action="back"]', 'click', () => {
      if (this.hasUnsavedChanges && !confirm('You have unsaved changes. Leave anyway?')) {
        return;
      }
      this.navigate(`/session/${this.options.params?.sessionId}/chat`);
    });

    // Setup save button
    const saveBtnContainer = this.$('.save-btn-container') as HTMLElement;
    if (saveBtnContainer) {
      const saveBtn = new Button('Save', {
        variant: 'primary',
        size: 'sm',
        onClick: () => this.saveAudio(),
      });
      saveBtn.mount(saveBtnContainer);
    }

    // Show loading spinner
    const spinnerContainer = this.$('.spinner-container') as HTMLElement;
    if (spinnerContainer) {
      const spinner = new Spinner({ size: 'sm' });
      spinner.mount(spinnerContainer);
    }

    // Setup offline indicator
    const offlineContainer = this.$('.offline-indicator-container') as HTMLElement;
    if (offlineContainer) {
      this.offlineIndicator = new OfflineIndicator({ position: 'bottom-right' });
      this.offlineIndicator.mount(offlineContainer);
    }

    // Subscribe to offline status changes
    this.unsubscribeOffline = offlineManager.subscribe((status, wasOffline) => {
      this.isOfflineMode = status === 'offline';
      this.updateOfflineUI();

      if (status === 'online' && wasOffline) {
        this.syncPendingChanges();
      }
    });

    // Initialize audio context
    this.initAudioContext();

    // Setup toolbar
    this.setupToolbar();

    // Setup transport controls
    this.setupTransport();

    // Setup volume control
    this.setupVolumeControl();

    // Setup canvas
    this.setupCanvas();

    // Setup keyboard shortcuts
    this.setupKeyboardShortcuts();

    // Setup beat grid
    this.setupBeatGrid();

    // Setup audio source
    this.setupAudioSource();

    // Load session data
    this.loadSession();
  }

  private initAudioContext(): void {
    this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);
    this.gainNode.gain.value = this.volume / 100;
  }

  private setupToolbar(): void {
    // Toolbar action buttons - using addListenerBySelector for automatic cleanup
    this.addListenerBySelector('[data-action="undo"]', 'click', () => this.undo());
    this.addListenerBySelector('[data-action="redo"]', 'click', () => this.redo());
    this.addListenerBySelector('[data-action="clip"]', 'click', () => this.clipToSelection());
    this.addListenerBySelector('[data-action="delete"]', 'click', () => this.deleteSelection());
    this.addListenerBySelector('[data-action="fade-in"]', 'click', () => this.fadeIn());
    this.addListenerBySelector('[data-action="fade-out"]', 'click', () => this.fadeOut());
    this.addListenerBySelector('[data-action="normalize"]', 'click', () => this.normalize());
    this.addListenerBySelector('[data-action="reverse"]', 'click', () => this.reverse());
    this.addListenerBySelector('[data-action="zoom-in"]', 'click', () => toast.info('Zoom in'));
    this.addListenerBySelector('[data-action="zoom-out"]', 'click', () => toast.info('Zoom out'));
    this.addListenerBySelector('[data-action="zoom-fit"]', 'click', () => toast.info('Fit to view'));
    this.addListenerBySelector('[data-action="upload"]', 'click', () => this.uploadAudio());
    this.addListenerBySelector('[data-action="refresh"]', 'click', () => this.loadFiles());

    // Beat grid controls
    this.addListenerBySelector('[data-action="toggle-grid"]', 'click', () => this.toggleBeatGrid());
    this.addListenerBySelector('[data-action="toggle-snap"]', 'click', () => this.toggleSnapToBeat());
    this.addListenerBySelector('[data-action="detect-bpm"]', 'click', () => this.detectBpm());

    const bpmInput = this.$('.bpm-input') as HTMLInputElement;
    if (bpmInput) {
      bpmInput.value = String(this.beatGridSettings.bpm);
      this.addListener(bpmInput, 'change', (e) => {
        const value = parseInt((e.target as HTMLInputElement).value);
        if (value >= 20 && value <= 300) {
          beatGridStore.setBpm(value);
        }
      });
    }

    const subdivisionSelect = this.$('.subdivision-select') as HTMLSelectElement;
    if (subdivisionSelect) {
      subdivisionSelect.value = String(this.beatGridSettings.subdivisions);
      this.addListener(subdivisionSelect, 'change', (e) => {
        const value = parseInt((e.target as HTMLSelectElement).value);
        beatGridStore.setSubdivisions(value);
      });
    }
  }

  private setupTransport(): void {
    // Play/pause button
    this.addListenerBySelector('[data-action="play"]', 'click', () => {
      if (this.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    });

    // Stop button
    this.addListenerBySelector('[data-action="stop"]', 'click', () => this.stop());

    // Progress slider
    const progressSlider = this.$('.progress-slider') as HTMLInputElement;
    if (progressSlider) {
      this.addListener(progressSlider, 'input', (e) => {
        const value = parseFloat((e.target as HTMLInputElement).value);
        this.currentTime = (value / 100) * this.duration;
        this.updateTimeDisplay();
        if (!this.isPlaying) {
          this.renderWaveform();
        }
      });
    }

    // Playback rate select
    const rateSelect = this.$('.playback-rate-select') as HTMLSelectElement;
    if (rateSelect) {
      this.addListener(rateSelect, 'change', (e) => {
        this.playbackRate = parseFloat((e.target as HTMLSelectElement).value);
        if (this.sourceNode) {
          this.sourceNode.playbackRate.value = this.playbackRate;
        }
      });
    }
  }

  private setupVolumeControl(): void {
    const volumeSlider = this.$('.volume-slider') as HTMLInputElement;
    const volumeValue = this.$('.volume-value') as HTMLElement;

    if (volumeSlider) {
      this.addListener(volumeSlider, 'input', (e) => {
        this.volume = parseInt((e.target as HTMLInputElement).value);
        if (volumeValue) volumeValue.textContent = `${this.volume}%`;
        if (this.gainNode) {
          this.gainNode.gain.value = this.volume / 100;
        }
      });
    }
  }

  private setupCanvas(): void {
    this.waveformCanvas = this.$('.waveform-canvas') as HTMLCanvasElement;
    if (this.waveformCanvas) {
      this.waveformCtx = this.waveformCanvas.getContext('2d');

      // Handle resize
      this.resizeObserver = new ResizeObserver(() => {
        this.resizeCanvas();
        this.renderWaveform();
      });
      const container = this.$('.waveform-canvas-container') as HTMLElement;
      if (container) {
        this.resizeObserver.observe(container);
      }

      // Mouse events for selection - using addListener for automatic cleanup
      this.addListener(this.waveformCanvas, 'mousedown', (e) => this.handleWaveformMouseDown(e as MouseEvent));
      this.addListener(this.waveformCanvas, 'mousemove', (e) => this.handleWaveformMouseMove(e as MouseEvent));
      this.addListener(this.waveformCanvas, 'mouseup', () => this.handleWaveformMouseUp());
      this.addListener(this.waveformCanvas, 'mouseleave', () => this.handleWaveformMouseUp());
    }
  }

  private resizeCanvas(): void {
    if (!this.waveformCanvas) return;
    const container = this.$('.waveform-canvas-container') as HTMLElement;
    if (container) {
      const rect = container.getBoundingClientRect();
      this.waveformCanvas.width = rect.width * window.devicePixelRatio;
      this.waveformCanvas.height = rect.height * window.devicePixelRatio;
      this.waveformCanvas.style.width = `${rect.width}px`;
      this.waveformCanvas.style.height = `${rect.height}px`;
      if (this.waveformCtx) {
        this.waveformCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
      }
    }
  }

  private setupKeyboardShortcuts(): void {
    this.keyboardHandler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;

      // Space - Play/Pause
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.isPlaying) {
          this.pause();
        } else {
          this.play();
        }
      }

      // Ctrl+Z - Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      }

      // Ctrl+Y or Ctrl+Shift+Z - Redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        this.redo();
      }

      // Ctrl+S - Save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        this.saveAudio();
      }

      // Delete - Delete selection
      if (e.key === 'Delete' && this.selection) {
        e.preventDefault();
        this.deleteSelection();
      }

      // Escape - Clear selection
      if (e.key === 'Escape') {
        this.selection = null;
        this.updateSelectionUI();
        this.renderWaveform();
      }

      // G - Toggle beat grid visibility
      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        this.toggleBeatGrid();
      }

      // S - Toggle snap to beat
      if (e.key === 's' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        this.toggleSnapToBeat();
      }

      // T - Toggle synth panel (must return to prevent conflict with piano 'T' key)
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        this.toggleSynthPanel();
        return;
      }

      // Piano keyboard (when synth panel is visible)
      if (this.synthPanelVisible) {
        const keyToNote: Record<string, string> = {
          'z': 'C4', 'x': 'D4', 'c': 'E4', 'v': 'F4',
          'b': 'G4', 'n': 'A4', 'm': 'B4', ',': 'C5',
          'a': 'C#4', 's': 'D#4', 'f': 'F#4', 'g': 'G#4', 'h': 'A#4',
          'q': 'C5', 'w': 'D5', 'e': 'E5', 'r': 'F5',
          'y': 'A5', 'u': 'B5',
        };

        const note = keyToNote[e.key.toLowerCase()];
        if (note && e.type === 'keydown' && !e.repeat) {
          e.preventDefault();
          audioSourceStore.playNoteName(note);
        }
      }
    };

    // Handle key up for piano
    this.keyUpHandler = (e: KeyboardEvent) => {
      if (this.synthPanelVisible && !e.repeat) {
        const pianoKeys = ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', 'a', 's', 'f', 'g', 'h', 'q', 'w', 'e', 'r', 'y', 'u'];
        if (pianoKeys.includes(e.key.toLowerCase())) {
          audioSourceStore.stop();
        }
      }
    };

    // Use addListener for automatic cleanup
    this.addListener(document, 'keydown', this.keyboardHandler as EventListener);
    this.addListener(document, 'keyup', this.keyUpHandler as EventListener);
  }

  private setupBeatGrid(): void {
    // Subscribe to beat grid settings changes
    this.unsubscribeBeatGrid = beatGridStore.subscribe((settings) => {
      this.beatGridSettings = settings;
      this.updateBeatGridUI();
      this.renderWaveform();
    });

    // Initial UI update
    this.updateBeatGridUI();
  }

  private updateBeatGridUI(): void {
    const toggleGridBtn = this.$('[data-action="toggle-grid"]') as HTMLButtonElement;
    const toggleSnapBtn = this.$('[data-action="toggle-snap"]') as HTMLButtonElement;
    const bpmInput = this.$('.bpm-input') as HTMLInputElement;
    const subdivisionSelect = this.$('.subdivision-select') as HTMLSelectElement;

    if (toggleGridBtn) {
      toggleGridBtn.classList.toggle('active', this.beatGridSettings.gridVisible);
    }

    if (toggleSnapBtn) {
      toggleSnapBtn.classList.toggle('active', this.beatGridSettings.snapEnabled);
    }

    if (bpmInput && bpmInput.value !== String(this.beatGridSettings.bpm)) {
      bpmInput.value = String(this.beatGridSettings.bpm);
    }

    if (subdivisionSelect && subdivisionSelect.value !== String(this.beatGridSettings.subdivisions)) {
      subdivisionSelect.value = String(this.beatGridSettings.subdivisions);
    }
  }

  private toggleBeatGrid(): void {
    beatGridStore.toggleGridVisibility();
    // Use store getter for current value since local state updates asynchronously
    toast.info(beatGridStore.isGridVisible() ? 'Beat grid visible' : 'Beat grid hidden');
  }

  private toggleSnapToBeat(): void {
    beatGridStore.toggleSnap();
    // Use store getter for current value since local state updates asynchronously
    toast.info(beatGridStore.isSnapEnabled() ? 'Snap enabled' : 'Snap disabled');
  }

  private detectBpm(): void {
    if (!this.audioBuffer) {
      toast.error('Load an audio file first');
      return;
    }

    const detectedBpm = beatGridStore.detectBpm(this.audioBuffer);
    if (detectedBpm) {
      beatGridStore.setBpm(detectedBpm);
      toast.success(`Detected BPM: ${detectedBpm}`);
    } else {
      toast.error('Could not detect BPM');
    }
  }

  private snapTimeToGrid(time: number): number {
    if (!this.beatGridSettings.snapEnabled) {
      return time;
    }
    return beatGridStore.snapToGrid(time);
  }

  private setupAudioSource(): void {
    // Initialize audio source with shared context
    if (this.audioContext) {
      audioSourceStore.init(this.audioContext);
    }

    // Subscribe to audio source settings changes
    this.unsubscribeAudioSource = audioSourceStore.subscribe((settings) => {
      this.audioSourceSettings = settings;
      this.updateAudioSourceUI();
    });

    // Setup synth panel controls
    this.setupSynthPanel();

    // Initial UI update
    this.updateAudioSourceUI();
  }

  private setupSynthPanel(): void {
    // Toggle synth buttons - using addListenerBySelector for automatic cleanup
    this.addListenerBySelector('[data-action="toggle-synth"]', 'click', () => this.toggleSynthPanel());
    this.addListenerBySelector('[data-action="close-synth"]', 'click', () => this.toggleSynthPanel(false));

    // Waveform buttons
    const waveformBtns = this.$$('.synth-wave-btn');
    waveformBtns.forEach(btn => {
      this.addListener(btn, 'click', () => {
        const waveform = (btn as HTMLElement).dataset.waveform as WaveformType;
        if (waveform) {
          audioSourceStore.setWaveform(waveform);
        }
      });
    });

    // Preset selector
    const presetSelect = this.$('.synth-preset-select') as HTMLSelectElement;
    if (presetSelect) {
      this.addListener(presetSelect, 'change', () => {
        audioSourceStore.applyPresetByName(presetSelect.value);
      });
    }

    // Frequency slider
    const freqSlider = this.$('.synth-freq-slider') as HTMLInputElement;
    const freqValue = this.$('.synth-freq-value') as HTMLElement;
    if (freqSlider) {
      this.addListener(freqSlider, 'input', () => {
        const freq = parseInt(freqSlider.value);
        audioSourceStore.setFrequency(freq);
        if (freqValue) freqValue.textContent = String(freq);
      });
    }

    // Volume slider
    const volSlider = this.$('.synth-vol-slider') as HTMLInputElement;
    const volValue = this.$('.synth-vol-value') as HTMLElement;
    if (volSlider) {
      this.addListener(volSlider, 'input', () => {
        const vol = parseInt(volSlider.value);
        audioSourceStore.setVolume(vol / 100);
        if (volValue) volValue.textContent = String(vol);
      });
    }

    // Envelope sliders
    const attackSlider = this.$('.synth-env-attack') as HTMLInputElement;
    const decaySlider = this.$('.synth-env-decay') as HTMLInputElement;
    const sustainSlider = this.$('.synth-env-sustain') as HTMLInputElement;
    const releaseSlider = this.$('.synth-env-release') as HTMLInputElement;

    if (attackSlider) {
      this.addListener(attackSlider, 'input', () => {
        audioSourceStore.setEnvelope({ attack: parseInt(attackSlider.value) / 1000 });
      });
    }

    if (decaySlider) {
      this.addListener(decaySlider, 'input', () => {
        audioSourceStore.setEnvelope({ decay: parseInt(decaySlider.value) / 1000 });
      });
    }

    if (sustainSlider) {
      this.addListener(sustainSlider, 'input', () => {
        audioSourceStore.setEnvelope({ sustain: parseInt(sustainSlider.value) / 100 });
      });
    }

    if (releaseSlider) {
      this.addListener(releaseSlider, 'input', () => {
        audioSourceStore.setEnvelope({ release: parseInt(releaseSlider.value) / 1000 });
      });
    }

    // Piano keys
    const pianoKeys = this.$$('.piano-key');
    pianoKeys.forEach(key => {
      this.addListener(key, 'mousedown', () => {
        const note = (key as HTMLElement).dataset.note;
        if (note) {
          audioSourceStore.playNoteName(note);
          key.classList.add('active');
        }
      });

      this.addListener(key, 'mouseup', () => {
        audioSourceStore.stop();
        key.classList.remove('active');
      });

      this.addListener(key, 'mouseleave', () => {
        if (key.classList.contains('active')) {
          audioSourceStore.stop();
          key.classList.remove('active');
        }
      });
    });

    // Play/Stop buttons
    this.addListenerBySelector('[data-action="synth-play"]', 'click', () => audioSourceStore.play());
    this.addListenerBySelector('[data-action="synth-stop"]', 'click', () => audioSourceStore.stop());
  }

  private toggleSynthPanel(show?: boolean): void {
    const panel = this.$('.synth-panel') as HTMLElement;
    const toggleBtn = this.$('[data-action="toggle-synth"]') as HTMLButtonElement;

    if (show === undefined) {
      this.synthPanelVisible = !this.synthPanelVisible;
    } else {
      this.synthPanelVisible = show;
    }

    if (panel) {
      panel.style.display = this.synthPanelVisible ? 'block' : 'none';
    }

    if (toggleBtn) {
      toggleBtn.classList.toggle('active', this.synthPanelVisible);
    }
  }

  private updateAudioSourceUI(): void {
    // Update waveform buttons
    const waveformBtns = this.$$('.synth-wave-btn');
    waveformBtns.forEach(btn => {
      const waveform = (btn as HTMLElement).dataset.waveform;
      btn.classList.toggle('active', waveform === this.audioSourceSettings.waveform);
    });

    // Update preset select
    const presetSelect = this.$('.synth-preset-select') as HTMLSelectElement;
    if (presetSelect && presetSelect.value !== this.audioSourceSettings.presetName) {
      presetSelect.value = this.audioSourceSettings.presetName;
    }

    // Update frequency slider
    const freqSlider = this.$('.synth-freq-slider') as HTMLInputElement;
    const freqValue = this.$('.synth-freq-value') as HTMLElement;
    if (freqSlider) {
      freqSlider.value = String(this.audioSourceSettings.frequency);
    }
    if (freqValue) {
      freqValue.textContent = String(Math.round(this.audioSourceSettings.frequency));
    }

    // Update volume slider
    const volSlider = this.$('.synth-vol-slider') as HTMLInputElement;
    const volValue = this.$('.synth-vol-value') as HTMLElement;
    if (volSlider) {
      volSlider.value = String(Math.round(this.audioSourceSettings.volume * 100));
    }
    if (volValue) {
      volValue.textContent = String(Math.round(this.audioSourceSettings.volume * 100));
    }

    // Update envelope sliders
    const attackSlider = this.$('.synth-env-attack') as HTMLInputElement;
    const decaySlider = this.$('.synth-env-decay') as HTMLInputElement;
    const sustainSlider = this.$('.synth-env-sustain') as HTMLInputElement;
    const releaseSlider = this.$('.synth-env-release') as HTMLInputElement;

    if (attackSlider) {
      attackSlider.value = String(this.audioSourceSettings.envelope.attack * 1000);
    }
    if (decaySlider) {
      decaySlider.value = String(this.audioSourceSettings.envelope.decay * 1000);
    }
    if (sustainSlider) {
      sustainSlider.value = String(this.audioSourceSettings.envelope.sustain * 100);
    }
    if (releaseSlider) {
      releaseSlider.value = String(this.audioSourceSettings.envelope.release * 1000);
    }
  }

  private handleWaveformMouseDown(e: MouseEvent): void {
    if (!this.audioBuffer || !this.waveformCanvas) return;

    const rect = this.waveformCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let clickTime = (x / rect.width) * this.duration;

    // Apply snap to grid
    clickTime = this.snapTimeToGrid(clickTime);

    if (e.shiftKey) {
      // Start selection
      this.isSelecting = true;
      this.selectionStart = clickTime;
      this.selection = { start: clickTime, end: clickTime };
    } else {
      // Seek to position
      this.selection = null;
      this.currentTime = clickTime;
      this.updateTimeDisplay();
      this.renderWaveform();
    }
  }

  private handleWaveformMouseMove(e: MouseEvent): void {
    if (!this.isSelecting || !this.waveformCanvas || !this.audioBuffer) return;

    const rect = this.waveformCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    let currentTimePos = (x / rect.width) * this.duration;

    // Apply snap to grid
    currentTimePos = this.snapTimeToGrid(currentTimePos);

    this.selection = {
      start: Math.min(this.selectionStart, currentTimePos),
      end: Math.max(this.selectionStart, currentTimePos),
    };

    this.updateSelectionUI();
    this.renderWaveform();
  }

  private handleWaveformMouseUp(): void {
    this.isSelecting = false;
    this.updateToolbarState();
  }

  private renderWaveform(): void {
    if (!this.waveformCtx || !this.waveformCanvas) return;

    const canvas = this.waveformCanvas;
    const ctx = this.waveformCtx;
    const width = canvas.width / window.devicePixelRatio;
    const height = canvas.height / window.devicePixelRatio;

    // Clear
    ctx.fillStyle = '#0f1117';
    ctx.fillRect(0, 0, width, height);

    if (!this.audioBuffer) return;

    // Draw center line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Draw beat grid
    if (this.beatGridSettings.gridVisible) {
      this.drawBeatGrid(ctx, width, height);
    }

    // Draw selection
    if (this.selection) {
      const startX = (this.selection.start / this.duration) * width;
      const endX = (this.selection.end / this.duration) * width;
      ctx.fillStyle = 'rgba(99, 102, 241, 0.3)';
      ctx.fillRect(startX, 0, endX - startX, height);

      // Selection handles
      ctx.fillStyle = '#6366f1';
      ctx.fillRect(startX - 2, 0, 4, height);
      ctx.fillRect(endX - 2, 0, 4, height);
    }

    // Draw waveform
    const channelData = this.audioBuffer.getChannelData(0);
    const samplesPerPixel = Math.floor(channelData.length / width);

    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let i = 0; i < width; i++) {
      const sampleIndex = i * samplesPerPixel;
      let min = 1;
      let max = -1;

      for (let j = 0; j < samplesPerPixel && sampleIndex + j < channelData.length; j++) {
        const sample = channelData[sampleIndex + j];
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }

      const yMin = ((1 - max) / 2) * height;
      const yMax = ((1 - min) / 2) * height;

      if (i === 0) {
        ctx.moveTo(i, yMin);
      }
      ctx.lineTo(i, yMin);
      ctx.lineTo(i, yMax);
    }

    ctx.stroke();

    // Draw playhead
    const playheadX = (this.currentTime / this.duration) * width;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();
  }

  private drawBeatGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const beatPositions = beatGridStore.getBeatPositions(0, this.duration);

    for (const pos of beatPositions) {
      const x = (pos.time / this.duration) * width;

      // Determine line style based on beat type
      if (pos.isDownbeat) {
        // Measure start - brightest and thickest
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.6)'; // amber
        ctx.lineWidth = 2;
      } else if (pos.isMainBeat) {
        // Main beat (quarter note) - medium brightness
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)';
        ctx.lineWidth = 1;
      } else {
        // Subdivision (eighth/sixteenth note) - dimmest
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.15)';
        ctx.lineWidth = 1;
      }

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      // Draw measure number at top for downbeats
      if (pos.isDownbeat && width > 200) {
        ctx.fillStyle = 'rgba(251, 191, 36, 0.8)';
        ctx.font = '10px sans-serif';
        ctx.fillText(`${pos.measureNumber + 1}`, x + 3, 12);
      }
    }
  }

  private play(): void {
    if (!this.audioBuffer || !this.audioContext || !this.gainNode) return;

    // Resume context if suspended
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    // Stop any current playback
    if (this.sourceNode) {
      this.sourceNode.stop();
      this.sourceNode.disconnect();
    }

    // Create new source
    this.sourceNode = this.audioContext.createBufferSource();
    this.sourceNode.buffer = this.audioBuffer;
    this.sourceNode.playbackRate.value = this.playbackRate;
    this.sourceNode.connect(this.gainNode);

    // Determine start position
    let startOffset = this.currentTime;
    let playDuration: number | undefined;

    if (this.selection) {
      startOffset = this.selection.start;
      playDuration = this.selection.end - this.selection.start;
    }

    this.sourceNode.start(0, startOffset, playDuration);
    this.playStartTime = this.audioContext.currentTime;
    this.playOffset = startOffset;

    this.sourceNode.onended = () => {
      this.isPlaying = false;
      this.updatePlayButton();
      if (this.selection) {
        this.currentTime = this.selection.start;
      }
    };

    this.isPlaying = true;
    this.updatePlayButton();
    this.startAnimation();
  }

  private pause(): void {
    if (this.sourceNode) {
      this.sourceNode.stop();
      this.sourceNode.disconnect();
    }
    this.isPlaying = false;
    this.stopAnimation();
    this.updatePlayButton();
  }

  private stop(): void {
    if (this.sourceNode) {
      this.sourceNode.stop();
      this.sourceNode.disconnect();
    }
    this.isPlaying = false;
    this.currentTime = this.selection?.start || 0;
    this.stopAnimation();
    this.updatePlayButton();
    this.updateTimeDisplay();
    this.renderWaveform();
  }

  private startAnimation(): void {
    const animate = () => {
      if (!this.isPlaying || !this.audioContext) return;

      const elapsed = this.audioContext.currentTime - this.playStartTime;
      this.currentTime = this.playOffset + elapsed * this.playbackRate;

      if (this.currentTime >= this.duration) {
        this.stop();
        return;
      }

      this.updateTimeDisplay();
      this.renderWaveform();
      this.animationFrame = requestAnimationFrame(animate);
    };

    this.animationFrame = requestAnimationFrame(animate);
  }

  private stopAnimation(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  private updatePlayButton(): void {
    const playIcon = this.$('.play-icon') as HTMLElement;
    const pauseIcon = this.$('.pause-icon') as HTMLElement;

    if (playIcon) playIcon.style.display = this.isPlaying ? 'none' : 'block';
    if (pauseIcon) pauseIcon.style.display = this.isPlaying ? 'block' : 'none';
  }

  private updateTimeDisplay(): void {
    const currentTimeEl = this.$('.time-current') as HTMLElement;
    const totalTimeEl = this.$('.time-total') as HTMLElement;
    const progressSlider = this.$('.progress-slider') as HTMLInputElement;

    if (currentTimeEl) {
      currentTimeEl.textContent = this.formatTime(this.currentTime);
    }

    if (totalTimeEl) {
      totalTimeEl.textContent = this.formatTime(this.duration);
    }

    if (progressSlider && this.duration > 0) {
      progressSlider.value = String((this.currentTime / this.duration) * 100);
    }
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toFixed(2).padStart(5, '0')}`;
  }

  private updateSelectionUI(): void {
    const selectionEl = this.$('.waveform-selection') as HTMLElement;
    const selectionRange = this.$('.selection-range') as HTMLElement;

    if (this.selection && selectionEl && selectionRange) {
      selectionEl.style.display = 'inline';
      selectionRange.textContent = `${this.formatTime(this.selection.start)} - ${this.formatTime(this.selection.end)}`;
    } else if (selectionEl) {
      selectionEl.style.display = 'none';
    }
  }

  private updateToolbarState(): void {
    const hasBuffer = !!this.audioBuffer;
    const hasSelection = !!this.selection;
    const canUndo = this.historyIndex > 0;
    const canRedo = this.historyIndex < this.history.length - 1;

    const undoBtn = this.$('[data-action="undo"]') as HTMLButtonElement;
    const redoBtn = this.$('[data-action="redo"]') as HTMLButtonElement;
    const clipBtn = this.$('[data-action="clip"]') as HTMLButtonElement;
    const deleteBtn = this.$('[data-action="delete"]') as HTMLButtonElement;
    const fadeInBtn = this.$('[data-action="fade-in"]') as HTMLButtonElement;
    const fadeOutBtn = this.$('[data-action="fade-out"]') as HTMLButtonElement;
    const normalizeBtn = this.$('[data-action="normalize"]') as HTMLButtonElement;
    const reverseBtn = this.$('[data-action="reverse"]') as HTMLButtonElement;

    if (undoBtn) undoBtn.disabled = !canUndo;
    if (redoBtn) redoBtn.disabled = !canRedo;
    if (clipBtn) clipBtn.disabled = !hasSelection;
    if (deleteBtn) deleteBtn.disabled = !hasSelection;
    if (fadeInBtn) fadeInBtn.disabled = !hasBuffer;
    if (fadeOutBtn) fadeOutBtn.disabled = !hasBuffer;
    if (normalizeBtn) normalizeBtn.disabled = !hasBuffer;
    if (reverseBtn) reverseBtn.disabled = !hasBuffer;
  }

  private saveToHistory(): void {
    if (!this.audioBuffer) return;

    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(this.audioBuffer);

    if (this.history.length > 20) {
      this.history.shift();
    } else {
      this.historyIndex++;
    }

    this.hasUnsavedChanges = true;
    this.updateUnsavedIndicator();
    this.updateToolbarState();
  }

  private undo(): void {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.audioBuffer = this.history[this.historyIndex];
      this.duration = this.audioBuffer?.duration || 0;
      this.renderWaveform();
      this.updateToolbarState();
    }
  }

  private redo(): void {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.audioBuffer = this.history[this.historyIndex];
      this.duration = this.audioBuffer?.duration || 0;
      this.renderWaveform();
      this.updateToolbarState();
    }
  }

  private clipToSelection(): void {
    if (!this.audioBuffer || !this.selection || !this.audioContext) return;

    const sampleRate = this.audioBuffer.sampleRate;
    const startSample = Math.floor(this.selection.start * sampleRate);
    const endSample = Math.floor(this.selection.end * sampleRate);
    const newLength = endSample - startSample;

    if (newLength <= 0) return;

    const newBuffer = this.audioContext.createBuffer(
      this.audioBuffer.numberOfChannels,
      newLength,
      sampleRate
    );

    for (let channel = 0; channel < this.audioBuffer.numberOfChannels; channel++) {
      const sourceData = this.audioBuffer.getChannelData(channel);
      const targetData = newBuffer.getChannelData(channel);

      for (let i = 0; i < newLength; i++) {
        targetData[i] = sourceData[startSample + i];
      }
    }

    this.audioBuffer = newBuffer;
    this.duration = newBuffer.duration;
    this.currentTime = 0;
    this.selection = null;
    this.saveToHistory();
    this.updateSelectionUI();
    this.updateTimeDisplay();
    this.renderWaveform();
    toast.success('Clipped to selection');
  }

  private deleteSelection(): void {
    if (!this.audioBuffer || !this.selection || !this.audioContext) return;

    const sampleRate = this.audioBuffer.sampleRate;
    const startSample = Math.floor(this.selection.start * sampleRate);
    const endSample = Math.floor(this.selection.end * sampleRate);
    const deleteLength = endSample - startSample;
    const newLength = this.audioBuffer.length - deleteLength;

    if (newLength <= 0) return;

    const newBuffer = this.audioContext.createBuffer(
      this.audioBuffer.numberOfChannels,
      newLength,
      sampleRate
    );

    for (let channel = 0; channel < this.audioBuffer.numberOfChannels; channel++) {
      const sourceData = this.audioBuffer.getChannelData(channel);
      const targetData = newBuffer.getChannelData(channel);

      for (let i = 0; i < startSample; i++) {
        targetData[i] = sourceData[i];
      }

      for (let i = endSample; i < this.audioBuffer.length; i++) {
        targetData[i - deleteLength] = sourceData[i];
      }
    }

    this.audioBuffer = newBuffer;
    this.duration = newBuffer.duration;
    this.currentTime = this.selection.start;
    this.selection = null;
    this.saveToHistory();
    this.updateSelectionUI();
    this.updateTimeDisplay();
    this.renderWaveform();
    toast.success('Selection deleted');
  }

  private fadeIn(): void {
    if (!this.audioBuffer || !this.audioContext) return;

    const startSample = this.selection ? Math.floor(this.selection.start * this.audioBuffer.sampleRate) : 0;
    const endSample = this.selection ? Math.floor(this.selection.end * this.audioBuffer.sampleRate) : this.audioBuffer.length;
    const fadeLength = endSample - startSample;

    const newBuffer = this.audioContext.createBuffer(
      this.audioBuffer.numberOfChannels,
      this.audioBuffer.length,
      this.audioBuffer.sampleRate
    );

    for (let channel = 0; channel < this.audioBuffer.numberOfChannels; channel++) {
      const sourceData = this.audioBuffer.getChannelData(channel);
      const targetData = newBuffer.getChannelData(channel);

      for (let i = 0; i < sourceData.length; i++) {
        if (i >= startSample && i < endSample) {
          const fadePosition = (i - startSample) / fadeLength;
          targetData[i] = sourceData[i] * fadePosition;
        } else {
          targetData[i] = sourceData[i];
        }
      }
    }

    this.audioBuffer = newBuffer;
    this.saveToHistory();
    this.renderWaveform();
    toast.success('Fade in applied');
  }

  private fadeOut(): void {
    if (!this.audioBuffer || !this.audioContext) return;

    const startSample = this.selection ? Math.floor(this.selection.start * this.audioBuffer.sampleRate) : 0;
    const endSample = this.selection ? Math.floor(this.selection.end * this.audioBuffer.sampleRate) : this.audioBuffer.length;
    const fadeLength = endSample - startSample;

    const newBuffer = this.audioContext.createBuffer(
      this.audioBuffer.numberOfChannels,
      this.audioBuffer.length,
      this.audioBuffer.sampleRate
    );

    for (let channel = 0; channel < this.audioBuffer.numberOfChannels; channel++) {
      const sourceData = this.audioBuffer.getChannelData(channel);
      const targetData = newBuffer.getChannelData(channel);

      for (let i = 0; i < sourceData.length; i++) {
        if (i >= startSample && i < endSample) {
          const fadePosition = 1 - (i - startSample) / fadeLength;
          targetData[i] = sourceData[i] * fadePosition;
        } else {
          targetData[i] = sourceData[i];
        }
      }
    }

    this.audioBuffer = newBuffer;
    this.saveToHistory();
    this.renderWaveform();
    toast.success('Fade out applied');
  }

  private normalize(): void {
    if (!this.audioBuffer || !this.audioContext) return;

    let peak = 0;
    for (let channel = 0; channel < this.audioBuffer.numberOfChannels; channel++) {
      const data = this.audioBuffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
    }

    if (peak === 0) return;

    const gain = 1 / peak;

    const newBuffer = this.audioContext.createBuffer(
      this.audioBuffer.numberOfChannels,
      this.audioBuffer.length,
      this.audioBuffer.sampleRate
    );

    for (let channel = 0; channel < this.audioBuffer.numberOfChannels; channel++) {
      const sourceData = this.audioBuffer.getChannelData(channel);
      const targetData = newBuffer.getChannelData(channel);

      for (let i = 0; i < sourceData.length; i++) {
        targetData[i] = sourceData[i] * gain;
      }
    }

    this.audioBuffer = newBuffer;
    this.saveToHistory();
    this.renderWaveform();
    toast.success('Audio normalized');
  }

  private reverse(): void {
    if (!this.audioBuffer || !this.audioContext) return;

    const startSample = this.selection ? Math.floor(this.selection.start * this.audioBuffer.sampleRate) : 0;
    const endSample = this.selection ? Math.floor(this.selection.end * this.audioBuffer.sampleRate) : this.audioBuffer.length;

    const newBuffer = this.audioContext.createBuffer(
      this.audioBuffer.numberOfChannels,
      this.audioBuffer.length,
      this.audioBuffer.sampleRate
    );

    for (let channel = 0; channel < this.audioBuffer.numberOfChannels; channel++) {
      const sourceData = this.audioBuffer.getChannelData(channel);
      const targetData = newBuffer.getChannelData(channel);

      for (let i = 0; i < sourceData.length; i++) {
        if (i >= startSample && i < endSample) {
          const reverseIndex = endSample - 1 - (i - startSample);
          targetData[i] = sourceData[reverseIndex];
        } else {
          targetData[i] = sourceData[i];
        }
      }
    }

    this.audioBuffer = newBuffer;
    this.saveToHistory();
    this.renderWaveform();
    toast.success('Audio reversed');
  }

  private uploadAudio(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        await this.loadAudioFile(file);
      }
    };
    input.click();
  }

  private async loadAudioFile(file: File): Promise<void> {
    if (!this.audioContext) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.duration = this.audioBuffer.duration;
      this.currentTime = 0;
      this.selection = null;
      this.history = [this.audioBuffer];
      this.historyIndex = 0;
      this.hasUnsavedChanges = false;
      this.currentFilePath = file.name;

      this.showWaveform();
      this.updateAudioInfo();
      this.updateTimeDisplay();
      this.updateToolbarState();
      this.resizeCanvas();
      this.renderWaveform();
      toast.success(`Loaded ${file.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to load audio file:', { error: message, fileName: file.name });
      toast.error(`Failed to load audio: ${message}`);
    }
  }

  private showWaveform(): void {
    const loading = this.$('.waveform-loading') as HTMLElement;
    const empty = this.$('.waveform-empty') as HTMLElement;
    const wrapper = this.$('.waveform-wrapper') as HTMLElement;

    if (loading) loading.style.display = 'none';
    if (empty) empty.style.display = 'none';
    if (wrapper) wrapper.style.display = 'flex';
  }

  private showEmpty(): void {
    const loading = this.$('.waveform-loading') as HTMLElement;
    const empty = this.$('.waveform-empty') as HTMLElement;
    const wrapper = this.$('.waveform-wrapper') as HTMLElement;

    if (loading) loading.style.display = 'none';
    if (empty) empty.style.display = 'flex';
    if (wrapper) wrapper.style.display = 'none';
  }

  private updateAudioInfo(): void {
    if (!this.audioBuffer) return;

    const filenameEl = this.$('.waveform-filename') as HTMLElement;
    const channelsEl = this.$('.waveform-channels') as HTMLElement;
    const samplerateEl = this.$('.waveform-samplerate') as HTMLElement;
    const durationEl = this.$('.waveform-duration') as HTMLElement;

    if (filenameEl) filenameEl.textContent = this.currentFilePath || 'audio.wav';
    if (channelsEl) channelsEl.textContent = `${this.audioBuffer.numberOfChannels} ch`;
    if (samplerateEl) samplerateEl.textContent = `${this.audioBuffer.sampleRate} Hz`;
    if (durationEl) durationEl.textContent = this.formatTime(this.duration);
  }

  private updateUnsavedIndicator(): void {
    const indicator = this.$('.unsaved-indicator') as HTMLElement;
    if (indicator) {
      indicator.style.display = this.hasUnsavedChanges ? 'inline' : 'none';
    }
  }

  private async loadSession(): Promise<void> {
    const sessionId = this.options.params?.sessionId;
    if (!sessionId) {
      toast.error('No session ID provided');
      this.navigate('/agents');
      return;
    }

    try {
      if (isOffline()) {
        const cachedSession = await offlineStorage.getCachedSession(sessionId);
        if (cachedSession) {
          this.session = cachedSession as unknown as Session;
          this.updateHeader();
          this.showEmpty();
          await this.loadFiles();
          toast.info('Loaded from offline cache');
        } else {
          toast.error('Session not available offline');
          this.navigate('/agents');
        }
        return;
      }

      const response = await sessionsApi.get(sessionId);
      this.session = response.session;
      await offlineStorage.cacheSession(sessionId, response.session as unknown as Record<string, unknown>);
      this.updateHeader();
      this.showEmpty();
      await this.loadFiles();
    } catch (error) {
      const cachedSession = await offlineStorage.getCachedSession(sessionId);
      if (cachedSession) {
        this.session = cachedSession as unknown as Session;
        this.isOfflineMode = true;
        this.updateHeader();
        this.updateOfflineUI();
        this.showEmpty();
        await this.loadFiles();
        toast.info('Loaded from offline cache');
      } else {
        toast.error('Failed to load session');
        console.error('Failed to load session:', error);
        this.navigate('/agents');
      }
    }
  }

  private async loadFiles(): Promise<void> {
    if (!this.session) return;

    const listItems = this.$('.file-list-items') as HTMLElement;
    const listLoading = this.$('.file-list-loading') as HTMLElement;
    const listEmpty = this.$('.file-list-empty') as HTMLElement;

    if (listLoading) listLoading.style.display = 'flex';
    if (listItems) listItems.style.display = 'none';
    if (listEmpty) listEmpty.style.display = 'none';

    try {
      const sessionPath = this.getSessionPath();
      const response = await storageWorkerApi.listFiles(sessionPath);
      const files = (response.files || []).filter((f: string) =>
        /\.(wav|mp3|ogg|aac|flac|m4a|webm|aiff|aif)$/i.test(f)
      );

      if (listLoading) listLoading.style.display = 'none';

      if (files.length === 0) {
        if (listEmpty) listEmpty.style.display = 'flex';
      } else {
        if (listItems) {
          listItems.style.display = 'block';
          listItems.innerHTML = files.map((file: string) => {
            const name = file.split('/').pop() || file;
            return `
              <div class="file-item" data-path="${file}">
                <span class="file-icon">🎵</span>
                <span class="file-name">${name}</span>
              </div>
            `;
          }).join('');

          // Add click handlers
          listItems.querySelectorAll('.file-item').forEach(item => {
            item.addEventListener('click', async () => {
              const path = (item as HTMLElement).dataset.path;
              if (path) {
                await this.loadAudioFromStorage(path);
              }
            });
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to load audio files list:', { error: message, sessionPath: this.getSessionPath() });
      if (listLoading) listLoading.style.display = 'none';
      if (listEmpty) {
        listEmpty.style.display = 'flex';
        listEmpty.textContent = `Failed to load files: ${message}`;
      }
    }
  }

  private async loadAudioFromStorage(filePath: string): Promise<void> {
    if (!this.session || !this.audioContext) return;

    try {
      const sessionPath = this.getSessionPath();

      // Try cache first if offline
      if (this.isOfflineMode || isOffline()) {
        const cached = await offlineStorage.getCachedFile(sessionPath, filePath);
        if (cached && cached.contentType === 'binary') {
          const arrayBuffer = cached.content as ArrayBuffer;
          this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));
          this.setupLoadedAudio(filePath);
          return;
        } else {
          throw new Error('File not available offline');
        }
      }

      const blob = await storageWorkerApi.getFileBlob(sessionPath, filePath);
      const arrayBuffer = await blob.arrayBuffer();

      // Cache for offline use
      await offlineStorage.cacheFile(sessionPath, filePath, arrayBuffer, 'binary');

      // Use slice(0) to create a copy since decodeAudioData detaches the buffer
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));
      this.setupLoadedAudio(filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to load audio from storage:', { error: message, filePath });
      toast.error(`Failed to load audio: ${message}`);
    }
  }

  private setupLoadedAudio(filePath: string): void {
    if (!this.audioBuffer) return;

    this.duration = this.audioBuffer.duration;
    this.currentTime = 0;
    this.selection = null;
    this.history = [this.audioBuffer];
    this.historyIndex = 0;
    this.hasUnsavedChanges = false;
    this.currentFilePath = filePath;

    this.showWaveform();
    this.updateAudioInfo();
    this.updateTimeDisplay();
    this.updateToolbarState();
    this.resizeCanvas();
    this.renderWaveform();
    toast.success(`Loaded ${filePath.split('/').pop()}`);
  }

  private updateHeader(): void {
    const subtitleEl = this.$('.sound-subtitle');

    if (this.session) {
      const repo = this.session.repositoryOwner && this.session.repositoryName
        ? `${this.session.repositoryOwner}/${this.session.repositoryName}`
        : '';
      const branch = this.session.branch || '';
      const subtitle = [repo, branch].filter(Boolean).join(' • ');
      if (subtitleEl) subtitleEl.textContent = subtitle || 'No repository';
    }
  }

  private updateOfflineUI(): void {
    const offlineBadge = this.$('.offline-status-badge') as HTMLElement;
    const aiBadge = this.$('.ai-badge') as HTMLElement;
    const aiButtons = this.$$('.ai-btn');

    if (offlineBadge) {
      offlineBadge.style.display = this.isOfflineMode ? 'block' : 'none';
    }

    if (aiBadge) {
      if (this.isOfflineMode) {
        aiBadge.textContent = 'AI Offline';
        aiBadge.classList.remove('ai-badge--online');
        aiBadge.classList.add('ai-badge--offline');
      } else {
        aiBadge.textContent = 'AI Ready';
        aiBadge.classList.remove('ai-badge--offline');
        aiBadge.classList.add('ai-badge--online');
      }
    }

    aiButtons.forEach(btn => {
      (btn as HTMLButtonElement).disabled = this.isOfflineMode;
    });
  }

  private async saveAudio(): Promise<void> {
    if (!this.audioBuffer || this.isSaving) return;

    this.isSaving = true;

    try {
      // Convert to WAV
      const wavBlob = this.audioBufferToWav(this.audioBuffer);
      const arrayBuffer = await wavBlob.arrayBuffer();

      const sessionPath = this.getSessionPath();
      const filePath = this.currentFilePath || 'audio.wav';

      if (this.isOfflineMode || isOffline()) {
        await offlineStorage.saveFileLocally(sessionPath, filePath, arrayBuffer, 'binary');
        toast.success('Audio saved locally (will sync when online)');
      } else {
        await offlineStorage.cacheFile(sessionPath, filePath, arrayBuffer, 'binary');
        toast.success('Audio saved');
      }

      this.hasUnsavedChanges = false;
      this.updateUnsavedIndicator();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to save audio:', { error: message, filePath: this.currentFilePath });
      toast.error(`Failed to save audio: ${message}`);
    } finally {
      this.isSaving = false;
    }
  }

  private audioBufferToWav(buffer: AudioBuffer): Blob {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataLength = buffer.length * blockAlign;
    const bufferLength = 44 + dataLength;

    const arrayBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(arrayBuffer);

    // RIFF header
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    this.writeString(view, 8, 'WAVE');

    // fmt chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);

    // data chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    // Write audio data
    const channels: Float32Array[] = [];
    for (let i = 0; i < numChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, intSample, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  private writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  private getSessionPath(): string {
    if (!this.session) return '';
    const owner = this.session.repositoryOwner || '';
    const repo = this.session.repositoryName || '';
    const branch = this.session.branch || '';
    return `${owner}__${repo}__${branch}`;
  }

  private async syncPendingChanges(): Promise<void> {
    try {
      const dirtyFiles = await offlineStorage.getDirtyFiles();
      const audioFiles = dirtyFiles.filter(f => f.contentType === 'binary');

      if (audioFiles.length === 0) return;

      toast.info(`Syncing ${audioFiles.length} audio file(s)...`);

      const failedFiles: string[] = [];
      for (const file of audioFiles) {
        try {
          await offlineStorage.markFileSynced(file.sessionPath, file.filePath);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('Failed to sync audio file:', { error: message, filePath: file.filePath });
          failedFiles.push(file.filePath);
        }
      }

      if (failedFiles.length > 0) {
        toast.error(`Failed to sync ${failedFiles.length} file(s)`);
      } else {
        toast.success('Audio files synced successfully');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to sync pending changes:', { error: message });
      toast.error(`Sync failed: ${message}`);
    }
  }

  protected onUnmount(): void {
    this.stopAnimation();

    // Note: keyboard handlers are now cleaned up automatically by the ListenerRegistry
    // Clear references to avoid memory leaks from closures
    this.keyboardHandler = null;
    this.keyUpHandler = null;

    // Disconnect ResizeObserver to prevent memory leaks
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.sourceNode) {
      this.sourceNode.stop();
      this.sourceNode.disconnect();
    }

    if (this.audioContext) {
      this.audioContext.close();
    }

    if (this.unsubscribeOffline) {
      this.unsubscribeOffline();
      this.unsubscribeOffline = null;
    }

    if (this.unsubscribeBeatGrid) {
      this.unsubscribeBeatGrid();
      this.unsubscribeBeatGrid = null;
    }

    if (this.unsubscribeAudioSource) {
      this.unsubscribeAudioSource();
      this.unsubscribeAudioSource = null;
    }

    // Dispose audio source store
    audioSourceStore.dispose();

    if (this.offlineIndicator) {
      this.offlineIndicator.unmount();
      this.offlineIndicator = null;
    }
  }
}
