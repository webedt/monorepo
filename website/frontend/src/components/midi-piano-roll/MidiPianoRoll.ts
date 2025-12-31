/**
 * MidiPianoRoll Component
 * Visual piano roll display for MIDI notes
 */

import { Component } from '../base';
import { midiStore } from '../../lib/midi';
import './midi-piano-roll.css';

import type { MidiNoteEvent } from '@webedt/shared';
import type { MidiStoreState } from '../../lib/midi';

export interface MidiPianoRollOptions {
  /** Minimum note to display (MIDI note number) */
  minNote?: number;
  /** Maximum note to display (MIDI note number) */
  maxNote?: number;
  /** Pixels per second for horizontal scale */
  pixelsPerSecond?: number;
  /** Height of each note lane in pixels */
  noteHeight?: number;
  /** Show piano keys on the left */
  showPiano?: boolean;
  /** Enable click-to-seek */
  clickToSeek?: boolean;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK_KEYS = [1, 3, 6, 8, 10]; // C#, D#, F#, G#, A#

export class MidiPianoRoll extends Component {
  private options: Required<MidiPianoRollOptions>;
  private unsubscribe: (() => void) | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private scrollContainer: HTMLElement | null = null;
  private playheadEl: HTMLElement | null = null;
  private animationFrameId: number | null = null;
  private notes: { note: MidiNoteEvent; trackIndex: number; color: string }[] = [];
  private clickListener: ((e: MouseEvent) => void) | null = null;

  // Colors for different tracks
  private trackColors = [
    '#4285f4', '#ea4335', '#fbbc04', '#34a853',
    '#ff6d01', '#46bdc6', '#7baaf7', '#f07b72',
    '#fcd04f', '#5bb974', '#ff9e40', '#78d9df',
  ];

  constructor(options: MidiPianoRollOptions = {}) {
    super('div', { className: 'midi-piano-roll' });
    this.options = {
      minNote: options.minNote ?? 21, // A0
      maxNote: options.maxNote ?? 108, // C8
      pixelsPerSecond: options.pixelsPerSecond ?? 100,
      noteHeight: options.noteHeight ?? 10,
      showPiano: options.showPiano ?? true,
      clickToSeek: options.clickToSeek ?? true,
    };

    this.render();
  }

  render(): this {
    const state = midiStore.getState();

    this.element.innerHTML = `
      <div class="midi-piano-roll-container">
        ${this.options.showPiano ? '<div class="midi-piano-roll-keys"></div>' : ''}
        <div class="midi-piano-roll-scroll">
          <canvas class="midi-piano-roll-canvas"></canvas>
          <div class="midi-piano-roll-playhead"></div>
        </div>
      </div>
    `;

    // Get elements
    this.scrollContainer = this.element.querySelector('.midi-piano-roll-scroll');
    this.canvas = this.element.querySelector('.midi-piano-roll-canvas');
    this.playheadEl = this.element.querySelector('.midi-piano-roll-playhead');

    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d');
    }

    // Render piano keys
    if (this.options.showPiano) {
      this.renderPianoKeys();
    }

    // Process notes
    if (state.isLoaded && state.fileInfo) {
      this.processNotes(state);
      this.updateCanvasSize(state);
      this.renderNotes();
    }

    // Setup event listeners
    this.setupEventListeners();

    return this;
  }

  private processNotes(state: MidiStoreState): void {
    this.notes = [];
    const player = midiStore.getPlayer();
    const fileInfo = state.fileInfo;

    if (!fileInfo) return;

    // Get notes from all tracks via public API
    const midiFile = player.getMidiFile();
    if (!midiFile) return;

    for (let trackIndex = 0; trackIndex < midiFile.tracks.length; trackIndex++) {
      if (state.settings.mutedTracks.includes(trackIndex)) continue;

      const track = midiFile.tracks[trackIndex];
      const color = this.trackColors[trackIndex % this.trackColors.length];

      for (const note of track.notes) {
        if (state.settings.mutedChannels.includes(note.channel)) continue;
        if (note.note < this.options.minNote || note.note > this.options.maxNote) continue;

        this.notes.push({ note, trackIndex, color });
      }
    }

    // Auto-adjust note range based on actual notes
    if (this.notes.length > 0) {
      let minNote = 127;
      let maxNote = 0;
      for (const { note } of this.notes) {
        if (note.note < minNote) minNote = note.note;
        if (note.note > maxNote) maxNote = note.note;
      }
      // Add some padding
      this.options.minNote = Math.max(0, minNote - 2);
      this.options.maxNote = Math.min(127, maxNote + 2);
    }
  }

  private renderPianoKeys(): void {
    const keysContainer = this.element.querySelector('.midi-piano-roll-keys');
    if (!keysContainer) return;

    const keysHtml: string[] = [];

    for (let i = this.options.maxNote; i >= this.options.minNote; i--) {
      const noteName = NOTE_NAMES[i % 12];
      const octave = Math.floor(i / 12) - 1;
      const isBlack = BLACK_KEYS.includes(i % 12);
      const isC = i % 12 === 0;

      keysHtml.push(`
        <div class="midi-piano-key ${isBlack ? 'midi-piano-key--black' : 'midi-piano-key--white'}"
             style="height: ${this.options.noteHeight}px"
             data-note="${i}"
             title="${noteName}${octave}">
          ${isC ? `<span class="midi-piano-key-label">C${octave}</span>` : ''}
        </div>
      `);
    }

    keysContainer.innerHTML = keysHtml.join('');
  }

  private updateCanvasSize(state: MidiStoreState): void {
    if (!this.canvas || !this.ctx) return;

    const noteRange = this.options.maxNote - this.options.minNote + 1;
    const height = noteRange * this.options.noteHeight;
    const width = state.duration * this.options.pixelsPerSecond;

    // Set canvas size
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.scale(dpr, dpr);
  }

  private renderNotes(): void {
    if (!this.ctx || !this.canvas) return;

    const { pixelsPerSecond, noteHeight, minNote, maxNote } = this.options;
    const noteRange = maxNote - minNote + 1;
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = noteRange * noteHeight;

    // Clear canvas
    this.ctx.clearRect(0, 0, width, height);

    // Draw grid lines
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    this.ctx.lineWidth = 1;

    // Horizontal lines (note lanes)
    for (let i = 0; i <= noteRange; i++) {
      const y = i * noteHeight;
      const noteIndex = maxNote - i;
      const isBlack = BLACK_KEYS.includes(noteIndex % 12);

      if (isBlack) {
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        this.ctx.fillRect(0, y, width, noteHeight);
      }

      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(width, y);
      this.ctx.stroke();
    }

    // Vertical lines (time markers every second)
    const duration = width / pixelsPerSecond;
    for (let t = 0; t <= duration; t++) {
      const x = t * pixelsPerSecond;
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, height);
      this.ctx.stroke();
    }

    // Draw notes
    for (const { note, color } of this.notes) {
      const x = note.startTimeSeconds * pixelsPerSecond;
      const y = (maxNote - note.note) * noteHeight;
      const noteWidth = Math.max(2, note.durationSeconds * pixelsPerSecond);
      const velocity = note.velocity / 127;

      // Note rectangle
      this.ctx.fillStyle = color;
      this.ctx.globalAlpha = 0.5 + velocity * 0.5;
      this.ctx.fillRect(x, y + 1, noteWidth, noteHeight - 2);

      // Note border
      this.ctx.globalAlpha = 1;
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(x, y + 1, noteWidth, noteHeight - 2);
    }

    this.ctx.globalAlpha = 1;
  }

  private setupEventListeners(): void {
    // Click to seek
    if (this.options.clickToSeek && this.scrollContainer) {
      this.clickListener = (e: MouseEvent) => {
        const rect = this.scrollContainer!.getBoundingClientRect();
        const x = e.clientX - rect.left + this.scrollContainer!.scrollLeft;
        const time = x / this.options.pixelsPerSecond;
        midiStore.seek(time);
      };
      this.scrollContainer.addEventListener('click', this.clickListener);
    }
  }

  private updatePlayhead(): void {
    if (!this.playheadEl || !this.scrollContainer) return;

    const state = midiStore.getState();
    const x = state.currentTime * this.options.pixelsPerSecond;

    this.playheadEl.style.transform = `translateX(${x}px)`;

    // Auto-scroll to keep playhead visible
    if (state.isPlaying && !state.isPaused) {
      const scrollLeft = this.scrollContainer.scrollLeft;
      const containerWidth = this.scrollContainer.clientWidth;
      const margin = containerWidth * 0.2;

      if (x > scrollLeft + containerWidth - margin) {
        this.scrollContainer.scrollLeft = x - margin;
      } else if (x < scrollLeft + margin) {
        this.scrollContainer.scrollLeft = Math.max(0, x - margin);
      }
    }
  }

  private startPlayheadAnimation(): void {
    const animate = () => {
      this.updatePlayhead();
      this.animationFrameId = requestAnimationFrame(animate);
    };
    this.animationFrameId = requestAnimationFrame(animate);
  }

  private stopPlayheadAnimation(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Set horizontal zoom (pixels per second)
   */
  setZoom(pixelsPerSecond: number): void {
    this.options.pixelsPerSecond = Math.max(20, Math.min(500, pixelsPerSecond));
    const state = midiStore.getState();
    if (state.isLoaded) {
      this.updateCanvasSize(state);
      this.renderNotes();
      this.updatePlayhead();
    }
  }

  /**
   * Zoom in
   */
  zoomIn(): void {
    this.setZoom(this.options.pixelsPerSecond * 1.25);
  }

  /**
   * Zoom out
   */
  zoomOut(): void {
    this.setZoom(this.options.pixelsPerSecond * 0.8);
  }

  /**
   * Scroll to a specific time
   */
  scrollToTime(time: number): void {
    if (!this.scrollContainer) return;
    const x = time * this.options.pixelsPerSecond;
    this.scrollContainer.scrollLeft = Math.max(0, x - this.scrollContainer.clientWidth / 2);
  }

  protected onMount(): void {
    this.unsubscribe = midiStore.subscribe((state) => {
      // Re-render when file changes
      if (state.isLoaded && this.notes.length === 0) {
        this.processNotes(state);
        this.updateCanvasSize(state);
        this.renderNotes();
      }

      // Update playhead
      this.updatePlayhead();

      // Handle playback state changes
      if (state.isPlaying && !state.isPaused) {
        this.startPlayheadAnimation();
      } else {
        this.stopPlayheadAnimation();
        this.updatePlayhead();
      }
    });
  }

  protected onUnmount(): void {
    this.stopPlayheadAnimation();
    if (this.clickListener && this.scrollContainer) {
      this.scrollContainer.removeEventListener('click', this.clickListener);
      this.clickListener = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}
