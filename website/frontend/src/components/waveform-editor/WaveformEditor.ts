/**
 * WaveformEditor Component
 * Canvas-based audio waveform visualization with selection, beat grid overlay, and playhead
 */

import { Component } from '../base/Component';
import { beatGridStore } from '../../stores/beatGridStore';

import './waveform-editor.css';

import type { BeatGridSettings } from '../../stores/beatGridStore';

export interface AudioSelection {
  start: number;
  end: number;
}

export interface WaveformEditorOptions {
  onSeek?: (time: number) => void;
  onSelectionChange?: (selection: AudioSelection | null) => void;
  onSelectionComplete?: () => void;
  snapToGrid?: boolean;
}

export class WaveformEditor extends Component<HTMLDivElement> {
  private options: WaveformEditorOptions;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // Audio data
  private audioBuffer: AudioBuffer | null = null;
  private duration = 0;
  private currentTime = 0;

  // Selection state
  private selection: AudioSelection | null = null;
  private isSelecting = false;
  private selectionStart = 0;

  // Beat grid
  private beatGridSettings: BeatGridSettings;
  private unsubscribeBeatGrid: (() => void) | null = null;
  private showBeatGrid = true;

  constructor(options: WaveformEditorOptions = {}) {
    super('div', { className: 'waveform-editor' });
    this.options = options;
    this.beatGridSettings = beatGridStore.getSettings();
  }

  protected onMount(): void {
    this.render();
    this.setupCanvas();

    // Subscribe to beat grid changes
    this.unsubscribeBeatGrid = beatGridStore.subscribe((settings) => {
      this.beatGridSettings = settings;
      this.renderWaveform();
    });
  }

  protected onUnmount(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.unsubscribeBeatGrid) {
      this.unsubscribeBeatGrid();
      this.unsubscribeBeatGrid = null;
    }
  }

  render(): this {
    this.element.innerHTML = `
      <div class="waveform-canvas-container">
        <canvas class="waveform-canvas"></canvas>
      </div>
    `;
    return this;
  }

  private setupCanvas(): void {
    this.canvas = this.element.querySelector('.waveform-canvas') as HTMLCanvasElement;
    if (!this.canvas) return;

    this.ctx = this.canvas.getContext('2d');

    // Handle resize
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas();
      this.renderWaveform();
    });

    const container = this.element.querySelector('.waveform-canvas-container') as HTMLElement;
    if (container) {
      this.resizeObserver.observe(container);
    }

    // Mouse events for selection
    this.on(this.canvas, 'mousedown', (e) => this.handleMouseDown(e as MouseEvent));
    this.on(this.canvas, 'mousemove', (e) => this.handleMouseMove(e as MouseEvent));
    this.on(this.canvas, 'mouseup', () => this.handleMouseUp());
    this.on(this.canvas, 'mouseleave', () => this.handleMouseUp());
  }

  private resizeCanvas(): void {
    if (!this.canvas) return;

    const container = this.element.querySelector('.waveform-canvas-container') as HTMLElement;
    if (container) {
      const rect = container.getBoundingClientRect();
      this.canvas.width = rect.width * window.devicePixelRatio;
      this.canvas.height = rect.height * window.devicePixelRatio;
      this.canvas.style.width = `${rect.width}px`;
      this.canvas.style.height = `${rect.height}px`;
      if (this.ctx) {
        this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      }
    }
  }

  private handleMouseDown(e: MouseEvent): void {
    if (!this.audioBuffer || !this.canvas) return;

    const rect = this.canvas.getBoundingClientRect();
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
      this.options.onSeek?.(clickTime);
      this.options.onSelectionChange?.(null);
      this.renderWaveform();
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isSelecting || !this.canvas || !this.audioBuffer) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    let currentTimePos = (x / rect.width) * this.duration;

    // Apply snap to grid
    currentTimePos = this.snapTimeToGrid(currentTimePos);

    this.selection = {
      start: Math.min(this.selectionStart, currentTimePos),
      end: Math.max(this.selectionStart, currentTimePos),
    };

    this.options.onSelectionChange?.(this.selection);
    this.renderWaveform();
  }

  private handleMouseUp(): void {
    if (this.isSelecting) {
      this.isSelecting = false;
      this.options.onSelectionComplete?.();
    }
  }

  private snapTimeToGrid(time: number): number {
    if (!this.options.snapToGrid || !this.beatGridSettings.snapEnabled) {
      return time;
    }
    return beatGridStore.snapToGrid(time);
  }

  renderWaveform(): void {
    if (!this.ctx || !this.canvas) return;

    const width = this.canvas.width / window.devicePixelRatio;
    const height = this.canvas.height / window.devicePixelRatio;

    // Guard against division by zero
    if (width === 0 || height === 0) return;

    // Clear
    this.ctx.fillStyle = '#0f1117';
    this.ctx.fillRect(0, 0, width, height);

    if (!this.audioBuffer || this.duration === 0) return;

    // Draw center line
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(0, height / 2);
    this.ctx.lineTo(width, height / 2);
    this.ctx.stroke();

    // Draw beat grid
    if (this.showBeatGrid && this.beatGridSettings.gridVisible) {
      this.drawBeatGrid(width, height);
    }

    // Draw selection
    if (this.selection) {
      const startX = (this.selection.start / this.duration) * width;
      const endX = (this.selection.end / this.duration) * width;
      this.ctx.fillStyle = 'rgba(99, 102, 241, 0.3)';
      this.ctx.fillRect(startX, 0, endX - startX, height);

      // Selection handles
      this.ctx.fillStyle = '#6366f1';
      this.ctx.fillRect(startX - 2, 0, 4, height);
      this.ctx.fillRect(endX - 2, 0, 4, height);
    }

    // Draw waveform
    const channelData = this.audioBuffer.getChannelData(0);
    const samplesPerPixel = Math.floor(channelData.length / width);

    this.ctx.strokeStyle = '#6366f1';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();

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
        this.ctx.moveTo(i, yMin);
      }
      this.ctx.lineTo(i, yMin);
      this.ctx.lineTo(i, yMax);
    }

    this.ctx.stroke();

    // Draw playhead
    const playheadX = (this.currentTime / this.duration) * width;
    this.ctx.strokeStyle = '#ef4444';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(playheadX, 0);
    this.ctx.lineTo(playheadX, height);
    this.ctx.stroke();
  }

  private drawBeatGrid(width: number, height: number): void {
    if (!this.ctx) return;

    const beatPositions = beatGridStore.getBeatPositions(0, this.duration);

    for (const pos of beatPositions) {
      const x = (pos.time / this.duration) * width;

      // Determine line style based on beat type
      if (pos.isDownbeat) {
        // Measure start - brightest and thickest
        this.ctx.strokeStyle = 'rgba(251, 191, 36, 0.6)';
        this.ctx.lineWidth = 2;
      } else if (pos.isMainBeat) {
        // Main beat (quarter note) - medium brightness
        this.ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)';
        this.ctx.lineWidth = 1;
      } else {
        // Subdivision (eighth/sixteenth note) - dimmest
        this.ctx.strokeStyle = 'rgba(251, 191, 36, 0.15)';
        this.ctx.lineWidth = 1;
      }

      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, height);
      this.ctx.stroke();

      // Draw measure number at top for downbeats
      if (pos.isDownbeat && width > 200) {
        this.ctx.fillStyle = 'rgba(251, 191, 36, 0.8)';
        this.ctx.font = '10px sans-serif';
        this.ctx.fillText(`${pos.measureNumber + 1}`, x + 3, 12);
      }
    }
  }

  // Public API
  setAudioBuffer(buffer: AudioBuffer | null): void {
    this.audioBuffer = buffer;
    this.duration = buffer?.duration || 0;
    this.currentTime = 0;
    this.selection = null;
    this.renderWaveform();
  }

  setCurrentTime(time: number): void {
    this.currentTime = time;
    this.renderWaveform();
  }

  getCurrentTime(): number {
    return this.currentTime;
  }

  setSelection(selection: AudioSelection | null): void {
    this.selection = selection;
    this.renderWaveform();
  }

  getSelection(): AudioSelection | null {
    return this.selection;
  }

  clearSelection(): void {
    this.selection = null;
    this.options.onSelectionChange?.(null);
    this.renderWaveform();
  }

  setShowBeatGrid(show: boolean): void {
    this.showBeatGrid = show;
    this.renderWaveform();
  }

  getDuration(): number {
    return this.duration;
  }

  getAudioBuffer(): AudioBuffer | null {
    return this.audioBuffer;
  }

  refresh(): void {
    this.resizeCanvas();
    this.renderWaveform();
  }
}
