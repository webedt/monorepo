/**
 * SynthesizerPanel Component
 * Audio synthesizer controls with waveform selection, ADSR envelope, and piano keyboard
 */

import { Component } from '../base/Component';
import { audioSourceStore } from '../../stores/audioSourceStore';
import { AUDIO_PRESETS } from '../../lib/audio';

import './synthesizer-panel.css';

import type { AudioSourceSettings } from '../../stores/audioSourceStore';
import type { WaveformType } from '../../lib/audio';

export interface SynthesizerPanelOptions {
  onClose?: () => void;
}

export class SynthesizerPanel extends Component<HTMLDivElement> {
  private options: SynthesizerPanelOptions;
  private audioSourceSettings: AudioSourceSettings;
  private unsubscribeAudioSource: (() => void) | null = null;

  // Key mapping for piano keyboard
  private static readonly KEY_TO_NOTE: Record<string, string> = {
    'z': 'C4', 'x': 'D4', 'c': 'E4', 'v': 'F4',
    'b': 'G4', 'n': 'A4', 'm': 'B4', ',': 'C5',
    'a': 'C#4', 's': 'D#4', 'f': 'F#4', 'g': 'G#4', 'h': 'A#4',
    'q': 'C5', 'w': 'D5', 'e': 'E5', 'r': 'F5',
    'y': 'A5', 'u': 'B5',
  };

  private boundKeyDownHandler: ((e: KeyboardEvent) => void) | null = null;
  private boundKeyUpHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(options: SynthesizerPanelOptions = {}) {
    super('div', { className: 'synth-panel' });
    this.options = options;
    this.audioSourceSettings = audioSourceStore.getSettings();
  }

  protected onMount(): void {
    this.render();
    this.setupEventListeners();

    // Subscribe to audio source settings changes
    this.unsubscribeAudioSource = audioSourceStore.subscribe((settings) => {
      this.audioSourceSettings = settings;
      this.updateUI();
    });

    // Setup keyboard handlers
    this.boundKeyDownHandler = (e: KeyboardEvent) => this.handleKeyDown(e);
    this.boundKeyUpHandler = (e: KeyboardEvent) => this.handleKeyUp(e);
    document.addEventListener('keydown', this.boundKeyDownHandler);
    document.addEventListener('keyup', this.boundKeyUpHandler);
  }

  protected onUnmount(): void {
    if (this.unsubscribeAudioSource) {
      this.unsubscribeAudioSource();
      this.unsubscribeAudioSource = null;
    }

    if (this.boundKeyDownHandler) {
      document.removeEventListener('keydown', this.boundKeyDownHandler);
    }
    if (this.boundKeyUpHandler) {
      document.removeEventListener('keyup', this.boundKeyUpHandler);
    }
  }

  render(): this {
    const presetOptions = AUDIO_PRESETS.map(p =>
      `<option value="${p.name}">${p.name}</option>`
    ).join('');

    this.element.innerHTML = `
      <div class="synth-panel-header">
        <span class="synth-panel-title">Audio Source</span>
        <button class="synth-close-btn" data-action="close" title="Close">×</button>
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
          <select class="synth-preset-select">${presetOptions}</select>
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
    `;

    return this;
  }

  private setupEventListeners(): void {
    // Close button
    const closeBtn = this.element.querySelector('[data-action="close"]');
    if (closeBtn) {
      this.on(closeBtn, 'click', () => this.options.onClose?.());
    }

    // Waveform buttons
    const waveformBtns = this.element.querySelectorAll('.synth-wave-btn');
    waveformBtns.forEach(btn => {
      this.on(btn, 'click', () => {
        const waveform = (btn as HTMLElement).dataset.waveform as WaveformType;
        if (waveform) {
          audioSourceStore.setWaveform(waveform);
        }
      });
    });

    // Preset selector
    const presetSelect = this.element.querySelector('.synth-preset-select') as HTMLSelectElement;
    if (presetSelect) {
      this.on(presetSelect, 'change', () => {
        audioSourceStore.applyPresetByName(presetSelect.value);
      });
    }

    // Frequency slider
    const freqSlider = this.element.querySelector('.synth-freq-slider') as HTMLInputElement;
    const freqValue = this.element.querySelector('.synth-freq-value') as HTMLElement;
    if (freqSlider) {
      this.on(freqSlider, 'input', () => {
        const freq = parseInt(freqSlider.value);
        audioSourceStore.setFrequency(freq);
        if (freqValue) freqValue.textContent = String(freq);
      });
    }

    // Volume slider
    const volSlider = this.element.querySelector('.synth-vol-slider') as HTMLInputElement;
    const volValue = this.element.querySelector('.synth-vol-value') as HTMLElement;
    if (volSlider) {
      this.on(volSlider, 'input', () => {
        const vol = parseInt(volSlider.value);
        audioSourceStore.setVolume(vol / 100);
        if (volValue) volValue.textContent = String(vol);
      });
    }

    // Envelope sliders
    const attackSlider = this.element.querySelector('.synth-env-attack') as HTMLInputElement;
    const decaySlider = this.element.querySelector('.synth-env-decay') as HTMLInputElement;
    const sustainSlider = this.element.querySelector('.synth-env-sustain') as HTMLInputElement;
    const releaseSlider = this.element.querySelector('.synth-env-release') as HTMLInputElement;

    if (attackSlider) {
      this.on(attackSlider, 'input', () => {
        audioSourceStore.setEnvelope({ attack: parseInt(attackSlider.value) / 1000 });
      });
    }

    if (decaySlider) {
      this.on(decaySlider, 'input', () => {
        audioSourceStore.setEnvelope({ decay: parseInt(decaySlider.value) / 1000 });
      });
    }

    if (sustainSlider) {
      this.on(sustainSlider, 'input', () => {
        audioSourceStore.setEnvelope({ sustain: parseInt(sustainSlider.value) / 100 });
      });
    }

    if (releaseSlider) {
      this.on(releaseSlider, 'input', () => {
        audioSourceStore.setEnvelope({ release: parseInt(releaseSlider.value) / 1000 });
      });
    }

    // Piano keys
    const pianoKeys = this.element.querySelectorAll('.piano-key');
    pianoKeys.forEach(key => {
      this.on(key, 'mousedown', () => {
        const note = (key as HTMLElement).dataset.note;
        if (note) {
          audioSourceStore.playNoteName(note);
          key.classList.add('active');
        }
      });

      this.on(key, 'mouseup', () => {
        audioSourceStore.stop();
        key.classList.remove('active');
      });

      this.on(key, 'mouseleave', () => {
        if (key.classList.contains('active')) {
          audioSourceStore.stop();
          key.classList.remove('active');
        }
      });
    });

    // Play/Stop buttons
    const playBtn = this.element.querySelector('[data-action="synth-play"]');
    const stopBtn = this.element.querySelector('[data-action="synth-stop"]');

    if (playBtn) {
      this.on(playBtn, 'click', () => audioSourceStore.play());
    }

    if (stopBtn) {
      this.on(stopBtn, 'click', () => audioSourceStore.stop());
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).tagName === 'INPUT' ||
        (e.target as HTMLElement).tagName === 'SELECT' ||
        (e.target as HTMLElement).tagName === 'TEXTAREA') {
      return;
    }

    // Check if this panel is visible
    if (!this.isVisible()) return;

    const note = SynthesizerPanel.KEY_TO_NOTE[e.key.toLowerCase()];
    if (note && !e.repeat) {
      e.preventDefault();
      audioSourceStore.playNoteName(note);

      // Highlight corresponding piano key
      const pianoKey = this.element.querySelector(`[data-note="${note}"]`);
      if (pianoKey) {
        pianoKey.classList.add('active');
      }
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (!this.isVisible()) return;

    const pianoKeys = Object.keys(SynthesizerPanel.KEY_TO_NOTE);
    if (pianoKeys.includes(e.key.toLowerCase())) {
      audioSourceStore.stop();

      // Remove highlight from all keys
      const allKeys = this.element.querySelectorAll('.piano-key');
      allKeys.forEach(key => key.classList.remove('active'));
    }
  }

  private updateUI(): void {
    // Update waveform buttons
    const waveformBtns = this.element.querySelectorAll('.synth-wave-btn');
    waveformBtns.forEach(btn => {
      const waveform = (btn as HTMLElement).dataset.waveform;
      btn.classList.toggle('active', waveform === this.audioSourceSettings.waveform);
    });

    // Update preset select
    const presetSelect = this.element.querySelector('.synth-preset-select') as HTMLSelectElement;
    if (presetSelect && presetSelect.value !== this.audioSourceSettings.presetName) {
      presetSelect.value = this.audioSourceSettings.presetName;
    }

    // Update frequency slider
    const freqSlider = this.element.querySelector('.synth-freq-slider') as HTMLInputElement;
    const freqValue = this.element.querySelector('.synth-freq-value') as HTMLElement;
    if (freqSlider) {
      freqSlider.value = String(this.audioSourceSettings.frequency);
    }
    if (freqValue) {
      freqValue.textContent = String(Math.round(this.audioSourceSettings.frequency));
    }

    // Update volume slider
    const volSlider = this.element.querySelector('.synth-vol-slider') as HTMLInputElement;
    const volValue = this.element.querySelector('.synth-vol-value') as HTMLElement;
    if (volSlider) {
      volSlider.value = String(Math.round(this.audioSourceSettings.volume * 100));
    }
    if (volValue) {
      volValue.textContent = String(Math.round(this.audioSourceSettings.volume * 100));
    }

    // Update envelope sliders
    const attackSlider = this.element.querySelector('.synth-env-attack') as HTMLInputElement;
    const decaySlider = this.element.querySelector('.synth-env-decay') as HTMLInputElement;
    const sustainSlider = this.element.querySelector('.synth-env-sustain') as HTMLInputElement;
    const releaseSlider = this.element.querySelector('.synth-env-release') as HTMLInputElement;

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

  // Public API
  initWithContext(audioContext: AudioContext): void {
    audioSourceStore.init(audioContext);
  }
}
