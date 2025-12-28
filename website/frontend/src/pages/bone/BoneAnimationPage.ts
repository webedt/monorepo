/**
 * Bone Animation Editor Page
 * Skeletal/bone-based animation with bone transforms only (no mesh deformation)
 */

import { Page, type PageOptions } from '../base/Page';
import { Button, Spinner, toast } from '../../components';
import { sessionsApi } from '../../lib/api';
import { offlineStorage } from '../../lib/offlineStorage';
import type { Session, Bone, BoneTransform, BoneKeyframe, BoneAnimation, Vector2 } from '../../types';
import './bone.css';

interface BoneAnimationPageOptions extends PageOptions {
  params?: {
    sessionId?: string;
  };
}

/**
 * Create a default bone transform
 */
function createDefaultTransform(): BoneTransform {
  return {
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
  };
}

/**
 * Create a default bone
 */
function createBone(name: string, parent: string | null, length: number): Bone {
  return {
    name,
    parent,
    length,
    localTransform: createDefaultTransform(),
  };
}

/**
 * Lerp between two numbers
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Lerp between two Vector2
 */
function lerpVector2(a: Vector2, b: Vector2, t: number): Vector2 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
  };
}

/**
 * Lerp angle with shortest path (handles wrapping around 360 degrees)
 */
function lerpAngle(a: number, b: number, t: number): number {
  // Normalize angles to [-180, 180] for shortest path interpolation
  let diff = b - a;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return a + diff * t;
}

/**
 * Lerp between two BoneTransforms
 */
function lerpTransform(a: BoneTransform, b: BoneTransform, t: number): BoneTransform {
  return {
    position: lerpVector2(a.position, b.position, t),
    rotation: lerpAngle(a.rotation, b.rotation, t),
    scale: lerpVector2(a.scale, b.scale, t),
  };
}

/**
 * Deep copy a BoneTransform
 */
function cloneTransform(transform: BoneTransform): BoneTransform {
  return {
    position: { x: transform.position.x, y: transform.position.y },
    rotation: transform.rotation,
    scale: { x: transform.scale.x, y: transform.scale.y },
  };
}

/**
 * Escape HTML entities to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 2D transformation matrix for bone transforms
 */
class Matrix2D {
  private m: number[] = [1, 0, 0, 1, 0, 0]; // [a, b, c, d, tx, ty]

  static identity(): Matrix2D {
    return new Matrix2D();
  }

  static fromTransform(transform: BoneTransform): Matrix2D {
    const m = new Matrix2D();
    m.translate(transform.position.x, transform.position.y);
    m.rotate(transform.rotation * Math.PI / 180);
    m.scale(transform.scale.x, transform.scale.y);
    return m;
  }

  translate(tx: number, ty: number): this {
    this.m[4] += this.m[0] * tx + this.m[2] * ty;
    this.m[5] += this.m[1] * tx + this.m[3] * ty;
    return this;
  }

  rotate(angle: number): this {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const a = this.m[0], b = this.m[1], c = this.m[2], d = this.m[3];
    this.m[0] = a * cos + c * sin;
    this.m[1] = b * cos + d * sin;
    this.m[2] = c * cos - a * sin;
    this.m[3] = d * cos - b * sin;
    return this;
  }

  scale(sx: number, sy: number): this {
    this.m[0] *= sx;
    this.m[1] *= sx;
    this.m[2] *= sy;
    this.m[3] *= sy;
    return this;
  }

  multiply(other: Matrix2D): Matrix2D {
    const result = new Matrix2D();
    const a = this.m, b = other.m;
    result.m[0] = a[0] * b[0] + a[2] * b[1];
    result.m[1] = a[1] * b[0] + a[3] * b[1];
    result.m[2] = a[0] * b[2] + a[2] * b[3];
    result.m[3] = a[1] * b[2] + a[3] * b[3];
    result.m[4] = a[0] * b[4] + a[2] * b[5] + a[4];
    result.m[5] = a[1] * b[4] + a[3] * b[5] + a[5];
    return result;
  }

  transformPoint(x: number, y: number): Vector2 {
    return {
      x: this.m[0] * x + this.m[2] * y + this.m[4],
      y: this.m[1] * x + this.m[3] * y + this.m[5],
    };
  }
}

export class BoneAnimationPage extends Page<BoneAnimationPageOptions> {
  readonly route = '/session/:sessionId/bone-animation';
  readonly title = 'Bone Animation Editor';
  protected requiresAuth = true;

  private session: Session | null = null;
  private isSaving = false;
  private hasUnsavedChanges = false;

  // Canvas and rendering
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private canvasWidth = 800;
  private canvasHeight = 600;

  // Animation data
  private animation: BoneAnimation = {
    name: 'New Animation',
    type: 'bone',
    fps: 30,
    duration: 1,
    bones: [],
    keyframes: [],
    loop: true,
  };

  // Bone hierarchy and selection
  private selectedBoneName: string | null = null;
  private worldTransforms: Map<string, Matrix2D> = new Map();

  // Timeline state
  private currentTime = 0;
  private isPlaying = false;
  private playbackSpeed = 1;
  private animationFrame: number | null = null;
  private lastFrameTime = 0;

  // Interaction state
  private isDragging = false;
  private dragStart: Vector2 = { x: 0, y: 0 };
  private dragMode: 'translate' | 'rotate' | 'none' = 'none';

  // View state
  private viewOffset: Vector2 = { x: 0, y: 0 };
  private viewScale = 1;

  // Event handlers (for cleanup)
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  protected render(): string {
    return `
      <div class="bone-animation-page">
        <header class="bone-header">
          <div class="bone-header-left">
            <button class="back-btn" data-action="back">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <div class="bone-info">
              <h1 class="bone-title">Bone Animation Editor</h1>
              <p class="bone-subtitle">Loading...</p>
            </div>
          </div>
          <div class="bone-header-right">
            <div class="animation-name-container">
              <input type="text" class="animation-name-input" value="New Animation" placeholder="Animation name">
            </div>
            <div class="save-btn-container"></div>
          </div>
        </header>

        <div class="bone-layout">
          <!-- Bone Hierarchy Panel -->
          <aside class="bone-hierarchy-panel">
            <div class="panel-header">
              <span class="panel-title">Bones</span>
              <button class="add-bone-btn" title="Add Bone">+</button>
            </div>
            <div class="bone-tree">
              <div class="bone-tree-empty">
                <p>No bones defined</p>
                <p class="hint">Add bones to create skeleton</p>
              </div>
            </div>
          </aside>

          <!-- Main Content Area -->
          <main class="bone-main">
            <!-- Canvas Viewport -->
            <div class="bone-viewport">
              <div class="bone-loading">
                <div class="spinner-container"></div>
                <p>Loading bone animation editor...</p>
              </div>
              <div class="bone-canvas-wrapper" style="display: none;">
                <canvas class="bone-canvas" width="800" height="600"></canvas>
              </div>
            </div>

            <!-- Timeline -->
            <div class="bone-timeline">
              <div class="timeline-controls">
                <button class="timeline-btn" data-action="first-frame" title="First Frame">|&lt;</button>
                <button class="timeline-btn" data-action="prev-frame" title="Previous Frame">&lt;</button>
                <button class="timeline-btn play-btn" data-action="play" title="Play/Pause">
                  <span class="play-icon">&#9654;</span>
                  <span class="pause-icon" style="display: none;">&#10074;&#10074;</span>
                </button>
                <button class="timeline-btn" data-action="next-frame" title="Next Frame">&gt;</button>
                <button class="timeline-btn" data-action="last-frame" title="Last Frame">&gt;|</button>
                <span class="timeline-time">0.00s / 1.00s</span>
                <button class="timeline-btn" data-action="add-keyframe" title="Add Keyframe">+ Key</button>
                <button class="timeline-btn" data-action="delete-keyframe" title="Delete Keyframe">- Key</button>
              </div>
              <div class="timeline-track-container">
                <div class="timeline-ruler"></div>
                <div class="timeline-tracks">
                  <div class="timeline-track-empty">
                    <p>Add bones to see tracks</p>
                  </div>
                </div>
                <div class="timeline-playhead" style="left: 0;"></div>
              </div>
              <div class="timeline-settings">
                <label>
                  FPS: <input type="number" class="fps-input" value="30" min="1" max="120" step="1">
                </label>
                <label>
                  Duration: <input type="number" class="duration-input" value="1" min="0.1" max="60" step="0.1">s
                </label>
                <label>
                  <input type="checkbox" class="loop-checkbox" checked> Loop
                </label>
                <label>
                  Speed: <input type="range" class="speed-slider" min="0.1" max="2" step="0.1" value="1">
                  <span class="speed-value">1x</span>
                </label>
              </div>
            </div>
          </main>

          <!-- Properties Panel -->
          <aside class="bone-properties-panel">
            <div class="panel-header">
              <span class="panel-title">Properties</span>
            </div>
            <div class="bone-properties-content">
              <div class="no-bone-selection">
                <p>No bone selected</p>
                <p class="hint">Click a bone to edit</p>
              </div>
              <div class="bone-properties" style="display: none;">
                <div class="property-section">
                  <div class="property-label">Bone Name</div>
                  <input type="text" class="property-input bone-name-input" placeholder="Bone name">
                </div>

                <div class="property-section">
                  <div class="property-label">Length</div>
                  <input type="number" class="property-input bone-length-input" value="50" min="1" step="1">
                </div>

                <div class="property-section">
                  <div class="property-label">Parent</div>
                  <select class="property-input bone-parent-select">
                    <option value="">(None - Root)</option>
                  </select>
                </div>

                <div class="property-section transform-section">
                  <div class="property-label">Transform (at current keyframe)</div>
                  <div class="transform-grid">
                    <div class="transform-row">
                      <label>X</label>
                      <input type="number" class="property-input transform-x" value="0" step="1">
                      <label>Y</label>
                      <input type="number" class="property-input transform-y" value="0" step="1">
                    </div>
                    <div class="transform-row">
                      <label>Rotation</label>
                      <input type="number" class="property-input transform-rotation" value="0" step="1">
                      <label>deg</label>
                    </div>
                    <div class="transform-row">
                      <label>Scale X</label>
                      <input type="number" class="property-input transform-scale-x" value="1" step="0.1" min="0.1">
                      <label>Scale Y</label>
                      <input type="number" class="property-input transform-scale-y" value="1" step="0.1" min="0.1">
                    </div>
                  </div>
                </div>

                <div class="property-section">
                  <button class="delete-bone-btn">Delete Bone</button>
                </div>
              </div>
            </div>
          </aside>
        </div>

        <!-- Status Bar -->
        <footer class="bone-status-bar">
          <span class="status-bones">0 bones</span>
          <span class="status-separator">|</span>
          <span class="status-keyframes">0 keyframes</span>
          <span class="status-separator">|</span>
          <span class="status-selection">No selection</span>
          <span class="status-spacer"></span>
          <span class="status-fps">30 FPS</span>
        </footer>
      </div>
    `;
  }

  protected onMount(): void {
    super.onMount();

    this.setupBackButton();
    this.setupSaveButton();
    this.setupCanvas();
    this.setupBoneHierarchy();
    this.setupTimeline();
    this.setupProperties();
    this.setupKeyboardShortcuts();

    // Show loading spinner
    const spinnerContainer = this.$('.spinner-container') as HTMLElement;
    if (spinnerContainer) {
      const spinner = new Spinner({ size: 'md' });
      spinner.mount(spinnerContainer);
    }

    // Create a default skeleton for demo
    this.createDefaultSkeleton();

    // Load session data
    this.loadSession();
  }

  private setupBackButton(): void {
    const backBtn = this.$('[data-action="back"]') as HTMLButtonElement;
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        if (this.hasUnsavedChanges && !confirm('You have unsaved changes. Leave anyway?')) {
          return;
        }
        this.stopPlayback();
        this.navigate(`/session/${this.options.params?.sessionId}/chat`);
      });
    }
  }

  private setupSaveButton(): void {
    const saveBtnContainer = this.$('.save-btn-container') as HTMLElement;
    if (saveBtnContainer) {
      const saveBtn = new Button('Save Animation', {
        variant: 'primary',
        size: 'sm',
        onClick: () => this.saveAnimation(),
      });
      saveBtn.mount(saveBtnContainer);
    }

    // Animation name input
    const nameInput = this.$('.animation-name-input') as HTMLInputElement;
    if (nameInput) {
      nameInput.addEventListener('change', () => {
        this.animation.name = nameInput.value;
        this.hasUnsavedChanges = true;
      });
    }
  }

  private setupCanvas(): void {
    this.canvas = this.$('.bone-canvas') as HTMLCanvasElement;
    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d');
      this.canvasWidth = this.canvas.width;
      this.canvasHeight = this.canvas.height;

      // Center the view
      this.viewOffset = { x: this.canvasWidth / 2, y: this.canvasHeight / 2 };

      // Mouse events
      this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
      this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
      this.canvas.addEventListener('mouseup', () => this.handleMouseUp());
      this.canvas.addEventListener('mouseleave', () => this.handleMouseUp());
      this.canvas.addEventListener('wheel', (e) => this.handleWheel(e));
    }
  }

  private setupBoneHierarchy(): void {
    const addBoneBtn = this.$('.add-bone-btn') as HTMLButtonElement;
    if (addBoneBtn) {
      addBoneBtn.addEventListener('click', () => this.addBone());
    }
  }

  private setupTimeline(): void {
    // Playback controls
    const playBtn = this.$('[data-action="play"]');
    const firstFrameBtn = this.$('[data-action="first-frame"]');
    const prevFrameBtn = this.$('[data-action="prev-frame"]');
    const nextFrameBtn = this.$('[data-action="next-frame"]');
    const lastFrameBtn = this.$('[data-action="last-frame"]');
    const addKeyframeBtn = this.$('[data-action="add-keyframe"]');
    const deleteKeyframeBtn = this.$('[data-action="delete-keyframe"]');

    if (playBtn) playBtn.addEventListener('click', () => this.togglePlayback());
    if (firstFrameBtn) firstFrameBtn.addEventListener('click', () => this.goToFirstFrame());
    if (prevFrameBtn) prevFrameBtn.addEventListener('click', () => this.goToPrevFrame());
    if (nextFrameBtn) nextFrameBtn.addEventListener('click', () => this.goToNextFrame());
    if (lastFrameBtn) lastFrameBtn.addEventListener('click', () => this.goToLastFrame());
    if (addKeyframeBtn) addKeyframeBtn.addEventListener('click', () => this.addKeyframe());
    if (deleteKeyframeBtn) deleteKeyframeBtn.addEventListener('click', () => this.deleteKeyframe());

    // Settings
    const fpsInput = this.$('.fps-input') as HTMLInputElement;
    const durationInput = this.$('.duration-input') as HTMLInputElement;
    const loopCheckbox = this.$('.loop-checkbox') as HTMLInputElement;
    const speedSlider = this.$('.speed-slider') as HTMLInputElement;

    if (fpsInput) {
      fpsInput.addEventListener('change', () => {
        this.animation.fps = parseInt(fpsInput.value, 10) || 30;
        this.hasUnsavedChanges = true;
        this.updateStatusBar();
      });
    }

    if (durationInput) {
      durationInput.addEventListener('change', () => {
        this.animation.duration = parseFloat(durationInput.value) || 1;
        this.hasUnsavedChanges = true;
        this.updateTimeline();
      });
    }

    if (loopCheckbox) {
      loopCheckbox.addEventListener('change', () => {
        this.animation.loop = loopCheckbox.checked;
        this.hasUnsavedChanges = true;
      });
    }

    if (speedSlider) {
      speedSlider.addEventListener('input', () => {
        this.playbackSpeed = parseFloat(speedSlider.value);
        const speedValue = this.$('.speed-value');
        if (speedValue) speedValue.textContent = `${this.playbackSpeed}x`;
      });
    }

    // Timeline track click
    const trackContainer = this.$('.timeline-track-container') as HTMLElement;
    if (trackContainer) {
      trackContainer.addEventListener('click', (e) => this.handleTimelineClick(e));
    }
  }

  private setupProperties(): void {
    // Bone name
    const nameInput = this.$('.bone-name-input') as HTMLInputElement;
    if (nameInput) {
      nameInput.addEventListener('change', () => this.updateSelectedBoneName(nameInput.value));
    }

    // Bone length
    const lengthInput = this.$('.bone-length-input') as HTMLInputElement;
    if (lengthInput) {
      lengthInput.addEventListener('change', () => this.updateSelectedBoneLength(parseFloat(lengthInput.value)));
    }

    // Parent select
    const parentSelect = this.$('.bone-parent-select') as HTMLSelectElement;
    if (parentSelect) {
      parentSelect.addEventListener('change', () => this.updateSelectedBoneParent(parentSelect.value || null));
    }

    // Transform inputs
    const transformX = this.$('.transform-x') as HTMLInputElement;
    const transformY = this.$('.transform-y') as HTMLInputElement;
    const transformRotation = this.$('.transform-rotation') as HTMLInputElement;
    const transformScaleX = this.$('.transform-scale-x') as HTMLInputElement;
    const transformScaleY = this.$('.transform-scale-y') as HTMLInputElement;

    const updateTransform = () => {
      if (!this.selectedBoneName) return;
      this.updateSelectedBoneTransform({
        position: {
          x: parseFloat(transformX?.value || '0'),
          y: parseFloat(transformY?.value || '0'),
        },
        rotation: parseFloat(transformRotation?.value || '0'),
        scale: {
          x: parseFloat(transformScaleX?.value || '1'),
          y: parseFloat(transformScaleY?.value || '1'),
        },
      });
    };

    if (transformX) transformX.addEventListener('change', updateTransform);
    if (transformY) transformY.addEventListener('change', updateTransform);
    if (transformRotation) transformRotation.addEventListener('change', updateTransform);
    if (transformScaleX) transformScaleX.addEventListener('change', updateTransform);
    if (transformScaleY) transformScaleY.addEventListener('change', updateTransform);

    // Delete bone button
    const deleteBtn = this.$('.delete-bone-btn') as HTMLButtonElement;
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => this.deleteSelectedBone());
    }
  }

  private setupKeyboardShortcuts(): void {
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          this.togglePlayback();
          break;
        case 'ArrowLeft':
          this.goToPrevFrame();
          break;
        case 'ArrowRight':
          this.goToNextFrame();
          break;
        case 'Home':
          this.goToFirstFrame();
          break;
        case 'End':
          this.goToLastFrame();
          break;
        case 'k':
        case 'K':
          this.addKeyframe();
          break;
        case 'Delete':
        case 'Backspace':
          if (this.selectedBoneName) {
            this.deleteSelectedBone();
          }
          break;
      }
    };

    document.addEventListener('keydown', this.keydownHandler);
  }

  private createDefaultSkeleton(): void {
    // Create a simple humanoid skeleton for demonstration
    this.animation.bones = [
      createBone('root', null, 30),
      createBone('spine', 'root', 40),
      createBone('head', 'spine', 25),
      createBone('arm_l', 'spine', 35),
      createBone('arm_r', 'spine', 35),
      createBone('leg_l', 'root', 45),
      createBone('leg_r', 'root', 45),
    ];

    // Set initial transforms for bones
    const findBone = (name: string) => this.animation.bones.find(b => b.name === name);

    const spine = findBone('spine');
    if (spine) spine.localTransform.rotation = -90;

    const head = findBone('head');
    if (head) head.localTransform.rotation = 0;

    const armL = findBone('arm_l');
    if (armL) armL.localTransform.rotation = -135;

    const armR = findBone('arm_r');
    if (armR) armR.localTransform.rotation = 135;

    const legL = findBone('leg_l');
    if (legL) legL.localTransform.rotation = 100;

    const legR = findBone('leg_r');
    if (legR) legR.localTransform.rotation = 80;

    // Create initial keyframe
    this.animation.keyframes = [{
      time: 0,
      transforms: {},
    }];

    // Copy bone transforms to keyframe (deep copy to avoid mutation)
    for (const bone of this.animation.bones) {
      this.animation.keyframes[0].transforms[bone.name] = cloneTransform(bone.localTransform);
    }
  }

  private addBone(): void {
    const name = `bone_${this.animation.bones.length + 1}`;
    const bone = createBone(name, this.selectedBoneName, 50);
    this.animation.bones.push(bone);

    // Add transform to all keyframes
    for (const keyframe of this.animation.keyframes) {
      keyframe.transforms[name] = createDefaultTransform();
    }

    this.selectedBoneName = name;
    this.hasUnsavedChanges = true;

    this.updateBoneTree();
    this.updatePropertiesPanel();
    this.updateStatusBar();
    this.updateWorldTransforms();
    this.renderCanvas();
  }

  private deleteSelectedBone(): void {
    if (!this.selectedBoneName) return;
    if (!confirm(`Delete bone "${this.selectedBoneName}" and all its children?`)) return;

    // Get all bones to delete (selected + children)
    const bonesToDelete = new Set<string>();
    const addChildren = (name: string) => {
      bonesToDelete.add(name);
      for (const bone of this.animation.bones) {
        if (bone.parent === name) {
          addChildren(bone.name);
        }
      }
    };
    addChildren(this.selectedBoneName);

    // Remove bones
    this.animation.bones = this.animation.bones.filter(b => !bonesToDelete.has(b.name));

    // Remove from keyframes
    for (const keyframe of this.animation.keyframes) {
      for (const name of bonesToDelete) {
        delete keyframe.transforms[name];
      }
    }

    this.selectedBoneName = null;
    this.hasUnsavedChanges = true;

    this.updateBoneTree();
    this.updatePropertiesPanel();
    this.updateStatusBar();
    this.updateWorldTransforms();
    this.renderCanvas();
  }

  private updateSelectedBoneName(newName: string): void {
    if (!this.selectedBoneName || !newName) return;

    const bone = this.animation.bones.find(b => b.name === this.selectedBoneName);
    if (!bone) return;

    // Validate: check for duplicate bone names
    const isDuplicate = this.animation.bones.some(
      b => b.name === newName && b.name !== this.selectedBoneName
    );
    if (isDuplicate) {
      toast.error(`Bone name "${newName}" already exists`);
      // Reset the input to the original name
      const nameInput = this.$('.bone-name-input') as HTMLInputElement;
      if (nameInput) nameInput.value = bone.name;
      return;
    }

    const oldName = bone.name;

    // Update parent references
    for (const b of this.animation.bones) {
      if (b.parent === oldName) {
        b.parent = newName;
      }
    }

    // Update keyframe references
    for (const keyframe of this.animation.keyframes) {
      if (keyframe.transforms[oldName]) {
        keyframe.transforms[newName] = keyframe.transforms[oldName];
        delete keyframe.transforms[oldName];
      }
    }

    bone.name = newName;
    this.selectedBoneName = newName;
    this.hasUnsavedChanges = true;

    this.updateBoneTree();
  }

  private updateSelectedBoneLength(length: number): void {
    if (!this.selectedBoneName) return;

    const bone = this.animation.bones.find(b => b.name === this.selectedBoneName);
    if (bone) {
      bone.length = Math.max(1, length);
      this.hasUnsavedChanges = true;
      this.updateWorldTransforms();
      this.renderCanvas();
    }
  }

  private updateSelectedBoneParent(parent: string | null): void {
    if (!this.selectedBoneName) return;

    const bone = this.animation.bones.find(b => b.name === this.selectedBoneName);
    if (bone) {
      // Prevent circular references
      if (parent && this.wouldCreateCycle(this.selectedBoneName, parent)) {
        toast.error('Cannot set parent: would create circular reference');
        return;
      }
      bone.parent = parent;
      this.hasUnsavedChanges = true;
      this.updateBoneTree();
      this.updateWorldTransforms();
      this.renderCanvas();
    }
  }

  private wouldCreateCycle(boneName: string, parentName: string): boolean {
    let current: string | null = parentName;
    while (current) {
      if (current === boneName) return true;
      const bone = this.animation.bones.find(b => b.name === current);
      current = bone?.parent || null;
    }
    return false;
  }

  private updateSelectedBoneTransform(transform: BoneTransform): void {
    if (!this.selectedBoneName) return;

    // Update the current keyframe (or create one if needed)
    let keyframe = this.getKeyframeAtTime(this.currentTime);
    if (!keyframe) {
      keyframe = {
        time: this.currentTime,
        transforms: {},
      };
      // Copy transforms from nearest keyframe (deep copy to avoid mutation)
      const nearestKeyframe = this.getNearestKeyframe(this.currentTime);
      if (nearestKeyframe) {
        for (const name in nearestKeyframe.transforms) {
          keyframe.transforms[name] = cloneTransform(nearestKeyframe.transforms[name]);
        }
      }
      this.animation.keyframes.push(keyframe);
      this.animation.keyframes.sort((a, b) => a.time - b.time);
    }

    keyframe.transforms[this.selectedBoneName] = transform;
    this.hasUnsavedChanges = true;

    this.updateTimeline();
    this.updateWorldTransforms();
    this.renderCanvas();
  }

  private getKeyframeAtTime(time: number): BoneKeyframe | undefined {
    const epsilon = 0.001;
    return this.animation.keyframes.find(k => Math.abs(k.time - time) < epsilon);
  }

  private getNearestKeyframe(time: number): BoneKeyframe | undefined {
    if (this.animation.keyframes.length === 0) return undefined;

    let nearest = this.animation.keyframes[0];
    let minDiff = Math.abs(time - nearest.time);

    for (const keyframe of this.animation.keyframes) {
      const diff = Math.abs(time - keyframe.time);
      if (diff < minDiff) {
        minDiff = diff;
        nearest = keyframe;
      }
    }

    return nearest;
  }

  private addKeyframe(): void {
    const existing = this.getKeyframeAtTime(this.currentTime);
    if (existing) {
      toast.info('Keyframe already exists at this time');
      return;
    }

    const keyframe: BoneKeyframe = {
      time: this.currentTime,
      transforms: {},
    };

    // Interpolate transforms from surrounding keyframes
    for (const bone of this.animation.bones) {
      keyframe.transforms[bone.name] = this.getInterpolatedTransform(bone.name, this.currentTime);
    }

    this.animation.keyframes.push(keyframe);
    this.animation.keyframes.sort((a, b) => a.time - b.time);
    this.hasUnsavedChanges = true;

    this.updateTimeline();
    this.updateStatusBar();
    toast.success('Keyframe added');
  }

  private deleteKeyframe(): void {
    const index = this.animation.keyframes.findIndex(k => Math.abs(k.time - this.currentTime) < 0.001);
    if (index === -1) {
      toast.info('No keyframe at current time');
      return;
    }

    if (this.animation.keyframes.length <= 1) {
      toast.error('Cannot delete the only keyframe');
      return;
    }

    this.animation.keyframes.splice(index, 1);
    this.hasUnsavedChanges = true;

    this.updateTimeline();
    this.updateStatusBar();
    this.updateWorldTransforms();
    this.renderCanvas();
    toast.success('Keyframe deleted');
  }

  private getInterpolatedTransform(boneName: string, time: number): BoneTransform {
    const keyframes = this.animation.keyframes;
    if (keyframes.length === 0) {
      const bone = this.animation.bones.find(b => b.name === boneName);
      return bone?.localTransform || createDefaultTransform();
    }

    if (keyframes.length === 1) {
      return keyframes[0].transforms[boneName] || createDefaultTransform();
    }

    // Find surrounding keyframes
    let prevKeyframe = keyframes[0];
    let nextKeyframe = keyframes[keyframes.length - 1];

    for (let i = 0; i < keyframes.length; i++) {
      if (keyframes[i].time <= time) {
        prevKeyframe = keyframes[i];
      }
      if (keyframes[i].time >= time && (i === 0 || keyframes[i - 1].time < time)) {
        nextKeyframe = keyframes[i];
        break;
      }
    }

    if (prevKeyframe === nextKeyframe) {
      return prevKeyframe.transforms[boneName] || createDefaultTransform();
    }

    const t = (time - prevKeyframe.time) / (nextKeyframe.time - prevKeyframe.time);
    const prevTransform = prevKeyframe.transforms[boneName] || createDefaultTransform();
    const nextTransform = nextKeyframe.transforms[boneName] || createDefaultTransform();

    return lerpTransform(prevTransform, nextTransform, t);
  }

  private updateWorldTransforms(): void {
    this.worldTransforms.clear();

    // Build transforms in hierarchy order
    const processed = new Set<string>();
    const processQueue = [...this.animation.bones];

    while (processQueue.length > 0) {
      let madeProgress = false;

      for (let i = processQueue.length - 1; i >= 0; i--) {
        const bone = processQueue[i];

        // Can only process if parent is processed (or no parent)
        if (bone.parent && !processed.has(bone.parent)) {
          continue;
        }

        const localTransform = this.getInterpolatedTransform(bone.name, this.currentTime);
        const localMatrix = Matrix2D.fromTransform(localTransform);

        let worldMatrix: Matrix2D;
        if (bone.parent) {
          const parentBone = this.animation.bones.find(b => b.name === bone.parent);
          const parentMatrix = this.worldTransforms.get(bone.parent)!;
          // Parent world * local transform, offset by parent bone length
          const parentLength = parentBone?.length || 0;
          const offsetMatrix = Matrix2D.identity().translate(parentLength, 0);
          worldMatrix = parentMatrix.multiply(offsetMatrix).multiply(localMatrix);
        } else {
          worldMatrix = localMatrix;
        }

        this.worldTransforms.set(bone.name, worldMatrix);
        processed.add(bone.name);
        processQueue.splice(i, 1);
        madeProgress = true;
      }

      if (!madeProgress && processQueue.length > 0) {
        console.error('Cycle detected in bone hierarchy');
        break;
      }
    }
  }

  private togglePlayback(): void {
    if (this.isPlaying) {
      this.stopPlayback();
    } else {
      this.startPlayback();
    }
  }

  private startPlayback(): void {
    this.isPlaying = true;
    this.lastFrameTime = performance.now();
    this.updatePlayButton();
    this.animate();
  }

  private stopPlayback(): void {
    this.isPlaying = false;
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.updatePlayButton();
  }

  private animate(): void {
    if (!this.isPlaying) return;

    const now = performance.now();
    const deltaTime = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    this.currentTime += deltaTime * this.playbackSpeed;

    if (this.currentTime >= this.animation.duration) {
      if (this.animation.loop) {
        this.currentTime = this.currentTime % this.animation.duration;
      } else {
        this.currentTime = this.animation.duration;
        this.stopPlayback();
      }
    }

    this.updateTimeDisplay();
    this.updatePlayhead();
    this.updateWorldTransforms();
    this.renderCanvas();

    if (this.isPlaying) {
      this.animationFrame = requestAnimationFrame(() => this.animate());
    }
  }

  private updatePlayButton(): void {
    const playIcon = this.$('.play-icon') as HTMLElement;
    const pauseIcon = this.$('.pause-icon') as HTMLElement;

    if (playIcon && pauseIcon) {
      playIcon.style.display = this.isPlaying ? 'none' : 'inline';
      pauseIcon.style.display = this.isPlaying ? 'inline' : 'none';
    }
  }

  private goToFirstFrame(): void {
    this.currentTime = 0;
    this.updateAfterTimeChange();
  }

  private goToLastFrame(): void {
    this.currentTime = this.animation.duration;
    this.updateAfterTimeChange();
  }

  private goToPrevFrame(): void {
    const frameTime = 1 / this.animation.fps;
    this.currentTime = Math.max(0, this.currentTime - frameTime);
    this.updateAfterTimeChange();
  }

  private goToNextFrame(): void {
    const frameTime = 1 / this.animation.fps;
    this.currentTime = Math.min(this.animation.duration, this.currentTime + frameTime);
    this.updateAfterTimeChange();
  }

  private updateAfterTimeChange(): void {
    this.updateTimeDisplay();
    this.updatePlayhead();
    this.updatePropertiesPanel();
    this.updateWorldTransforms();
    this.renderCanvas();
  }

  private updateTimeDisplay(): void {
    const timeDisplay = this.$('.timeline-time');
    if (timeDisplay) {
      timeDisplay.textContent = `${this.currentTime.toFixed(2)}s / ${this.animation.duration.toFixed(2)}s`;
    }
  }

  private updatePlayhead(): void {
    const playhead = this.$('.timeline-playhead') as HTMLElement;
    const trackContainer = this.$('.timeline-track-container') as HTMLElement;

    if (playhead && trackContainer) {
      const progress = this.currentTime / this.animation.duration;
      const containerWidth = trackContainer.clientWidth - 20; // Account for padding
      playhead.style.left = `${10 + progress * containerWidth}px`;
    }
  }

  private handleTimelineClick(e: MouseEvent): void {
    const trackContainer = this.$('.timeline-track-container') as HTMLElement;
    if (!trackContainer) return;

    const rect = trackContainer.getBoundingClientRect();
    const x = e.clientX - rect.left - 10; // Account for padding
    const containerWidth = rect.width - 20;
    const progress = Math.max(0, Math.min(1, x / containerWidth));

    this.currentTime = progress * this.animation.duration;
    this.updateAfterTimeChange();
  }

  private handleMouseDown(e: MouseEvent): void {
    if (!this.canvas) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if clicking on a bone
    const clickedBone = this.getBoneAtPosition(x, y);

    if (clickedBone) {
      this.selectedBoneName = clickedBone;
      this.isDragging = true;
      this.dragStart = { x, y };
      this.dragMode = e.shiftKey ? 'rotate' : 'translate';
      this.updateBoneTree();
      this.updatePropertiesPanel();
      this.updateStatusBar();
    } else {
      this.selectedBoneName = null;
      this.updateBoneTree();
      this.updatePropertiesPanel();
      this.updateStatusBar();
    }

    this.renderCanvas();
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isDragging || !this.selectedBoneName || !this.canvas) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const dx = x - this.dragStart.x;
    const dy = y - this.dragStart.y;

    const bone = this.animation.bones.find(b => b.name === this.selectedBoneName);
    if (!bone) return;

    const currentTransform = this.getInterpolatedTransform(this.selectedBoneName, this.currentTime);

    if (this.dragMode === 'rotate') {
      // Rotate based on mouse movement
      const rotationDelta = dx * 0.5;
      this.updateSelectedBoneTransform({
        ...currentTransform,
        rotation: currentTransform.rotation + rotationDelta,
      });
    } else {
      // Translate
      this.updateSelectedBoneTransform({
        ...currentTransform,
        position: {
          x: currentTransform.position.x + dx / this.viewScale,
          y: currentTransform.position.y + dy / this.viewScale,
        },
      });
    }

    this.dragStart = { x, y };
    this.updatePropertiesPanel();
  }

  private handleMouseUp(): void {
    this.isDragging = false;
    this.dragMode = 'none';
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    this.viewScale = Math.max(0.25, Math.min(4, this.viewScale * zoomFactor));
    this.renderCanvas();
  }

  private getBoneAtPosition(x: number, y: number): string | null {
    // Transform screen position to world position
    const worldX = (x - this.viewOffset.x) / this.viewScale;
    const worldY = (y - this.viewOffset.y) / this.viewScale;

    // Check each bone
    for (const bone of this.animation.bones) {
      const worldMatrix = this.worldTransforms.get(bone.name);
      if (!worldMatrix) continue;

      // Get bone start and end positions
      const start = worldMatrix.transformPoint(0, 0);
      const end = worldMatrix.transformPoint(bone.length, 0);

      // Check distance to bone line
      const dist = this.pointToLineDistance(worldX, worldY, start.x, start.y, end.x, end.y);
      if (dist < 10) {
        return bone.name;
      }
    }

    return null;
  }

  private pointToLineDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
      return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    }

    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
    const nearestX = x1 + t * dx;
    const nearestY = y1 + t * dy;

    return Math.sqrt((px - nearestX) ** 2 + (py - nearestY) ** 2);
  }

  private renderCanvas(): void {
    if (!this.ctx || !this.canvas) return;

    const ctx = this.ctx;
    const { width, height } = this.canvas;

    // Clear canvas
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    this.drawGrid(ctx);

    // Apply view transform
    ctx.save();
    ctx.translate(this.viewOffset.x, this.viewOffset.y);
    ctx.scale(this.viewScale, this.viewScale);

    // Draw bones
    for (const bone of this.animation.bones) {
      this.drawBone(ctx, bone);
    }

    ctx.restore();

    // Draw origin marker
    ctx.fillStyle = '#ff4444';
    ctx.beginPath();
    ctx.arc(this.viewOffset.x, this.viewOffset.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const gridSize = 50 * this.viewScale;
    const offsetX = this.viewOffset.x % gridSize;
    const offsetY = this.viewOffset.y % gridSize;

    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 1;

    // Vertical lines
    for (let x = offsetX; x < this.canvas!.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.canvas!.height);
      ctx.stroke();
    }

    // Horizontal lines
    for (let y = offsetY; y < this.canvas!.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.canvas!.width, y);
      ctx.stroke();
    }
  }

  private drawBone(ctx: CanvasRenderingContext2D, bone: Bone): void {
    const worldMatrix = this.worldTransforms.get(bone.name);
    if (!worldMatrix) return;

    const start = worldMatrix.transformPoint(0, 0);
    const end = worldMatrix.transformPoint(bone.length, 0);

    const isSelected = bone.name === this.selectedBoneName;

    // Draw bone line
    ctx.strokeStyle = isSelected ? '#00ff88' : '#ffffff';
    ctx.lineWidth = isSelected ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    // Draw bone joint (start point)
    ctx.fillStyle = isSelected ? '#00ff88' : '#ffaa00';
    ctx.beginPath();
    ctx.arc(start.x, start.y, isSelected ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();

    // Draw bone tip
    ctx.fillStyle = isSelected ? '#88ff00' : '#ff6600';
    ctx.beginPath();
    ctx.arc(end.x, end.y, isSelected ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();

    // Draw bone name
    if (isSelected) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(bone.name, (start.x + end.x) / 2, (start.y + end.y) / 2 - 10);
    }
  }

  private updateBoneTree(): void {
    const treeContainer = this.$('.bone-tree') as HTMLElement;
    if (!treeContainer) return;

    if (this.animation.bones.length === 0) {
      treeContainer.innerHTML = `
        <div class="bone-tree-empty">
          <p>No bones defined</p>
          <p class="hint">Add bones to create skeleton</p>
        </div>
      `;
      return;
    }

    // Build hierarchical tree
    const buildTree = (parentName: string | null, depth: number): string => {
      const children = this.animation.bones.filter(b => b.parent === parentName);
      return children.map(bone => {
        const escapedName = escapeHtml(bone.name);
        return `
        <div class="bone-tree-item ${bone.name === this.selectedBoneName ? 'selected' : ''}"
             style="padding-left: ${depth * 16}px"
             data-bone="${escapedName}">
          <span class="bone-icon">&#128469;</span>
          <span class="bone-name">${escapedName}</span>
        </div>
        ${buildTree(bone.name, depth + 1)}
      `;
      }).join('');
    };

    treeContainer.innerHTML = buildTree(null, 0);

    // Add click handlers
    treeContainer.querySelectorAll('.bone-tree-item').forEach(item => {
      item.addEventListener('click', () => {
        this.selectedBoneName = (item as HTMLElement).dataset.bone || null;
        this.updateBoneTree();
        this.updatePropertiesPanel();
        this.updateStatusBar();
        this.renderCanvas();
      });
    });
  }

  private updatePropertiesPanel(): void {
    const noSelection = this.$('.no-bone-selection') as HTMLElement;
    const properties = this.$('.bone-properties') as HTMLElement;

    if (!this.selectedBoneName) {
      if (noSelection) noSelection.style.display = 'block';
      if (properties) properties.style.display = 'none';
      return;
    }

    const bone = this.animation.bones.find(b => b.name === this.selectedBoneName);
    if (!bone) return;

    if (noSelection) noSelection.style.display = 'none';
    if (properties) properties.style.display = 'block';

    // Update bone properties
    const nameInput = this.$('.bone-name-input') as HTMLInputElement;
    const lengthInput = this.$('.bone-length-input') as HTMLInputElement;
    const parentSelect = this.$('.bone-parent-select') as HTMLSelectElement;

    if (nameInput) nameInput.value = bone.name;
    if (lengthInput) lengthInput.value = String(bone.length);

    // Update parent select options
    if (parentSelect) {
      parentSelect.innerHTML = '<option value="">(None - Root)</option>';
      for (const b of this.animation.bones) {
        if (b.name !== this.selectedBoneName && !this.wouldCreateCycle(b.name, this.selectedBoneName)) {
          const option = document.createElement('option');
          option.value = b.name;
          option.textContent = b.name;
          option.selected = b.name === bone.parent;
          parentSelect.appendChild(option);
        }
      }
    }

    // Update transform values
    const transform = this.getInterpolatedTransform(this.selectedBoneName, this.currentTime);

    const transformX = this.$('.transform-x') as HTMLInputElement;
    const transformY = this.$('.transform-y') as HTMLInputElement;
    const transformRotation = this.$('.transform-rotation') as HTMLInputElement;
    const transformScaleX = this.$('.transform-scale-x') as HTMLInputElement;
    const transformScaleY = this.$('.transform-scale-y') as HTMLInputElement;

    if (transformX) transformX.value = String(Math.round(transform.position.x * 100) / 100);
    if (transformY) transformY.value = String(Math.round(transform.position.y * 100) / 100);
    if (transformRotation) transformRotation.value = String(Math.round(transform.rotation * 100) / 100);
    if (transformScaleX) transformScaleX.value = String(Math.round(transform.scale.x * 100) / 100);
    if (transformScaleY) transformScaleY.value = String(Math.round(transform.scale.y * 100) / 100);
  }

  private updateTimeline(): void {
    const ruler = this.$('.timeline-ruler') as HTMLElement;
    const tracks = this.$('.timeline-tracks') as HTMLElement;

    if (!ruler || !tracks) return;

    // Update ruler
    const tickCount = Math.ceil(this.animation.duration * 10);
    let rulerHtml = '';
    for (let i = 0; i <= tickCount; i++) {
      const time = i / 10;
      const percent = (time / this.animation.duration) * 100;
      if (i % 10 === 0) {
        rulerHtml += `<div class="ruler-tick major" style="left: ${percent}%"><span>${time.toFixed(1)}s</span></div>`;
      } else {
        rulerHtml += `<div class="ruler-tick" style="left: ${percent}%"></div>`;
      }
    }
    ruler.innerHTML = rulerHtml;

    // Update tracks
    if (this.animation.bones.length === 0) {
      tracks.innerHTML = `
        <div class="timeline-track-empty">
          <p>Add bones to see tracks</p>
        </div>
      `;
      return;
    }

    let tracksHtml = '';
    for (const bone of this.animation.bones) {
      const escapedName = escapeHtml(bone.name);
      tracksHtml += `
        <div class="timeline-track" data-bone="${escapedName}">
          <div class="track-label">${escapedName}</div>
          <div class="track-keyframes">
      `;

      for (const keyframe of this.animation.keyframes) {
        if (keyframe.transforms[bone.name]) {
          const percent = (keyframe.time / this.animation.duration) * 100;
          tracksHtml += `<div class="keyframe-marker" style="left: ${percent}%" data-time="${keyframe.time}"></div>`;
        }
      }

      tracksHtml += `
          </div>
        </div>
      `;
    }
    tracks.innerHTML = tracksHtml;

    // Update playhead
    this.updatePlayhead();
  }

  private updateStatusBar(): void {
    const bonesStatus = this.$('.status-bones') as HTMLElement;
    const keyframesStatus = this.$('.status-keyframes') as HTMLElement;
    const selectionStatus = this.$('.status-selection') as HTMLElement;
    const fpsStatus = this.$('.status-fps') as HTMLElement;

    if (bonesStatus) {
      bonesStatus.textContent = `${this.animation.bones.length} bone${this.animation.bones.length !== 1 ? 's' : ''}`;
    }

    if (keyframesStatus) {
      keyframesStatus.textContent = `${this.animation.keyframes.length} keyframe${this.animation.keyframes.length !== 1 ? 's' : ''}`;
    }

    if (selectionStatus) {
      selectionStatus.textContent = this.selectedBoneName || 'No selection';
    }

    if (fpsStatus) {
      fpsStatus.textContent = `${this.animation.fps} FPS`;
    }
  }

  private showCanvas(): void {
    const loading = this.$('.bone-loading') as HTMLElement;
    const wrapper = this.$('.bone-canvas-wrapper') as HTMLElement;

    if (loading) loading.style.display = 'none';
    if (wrapper) wrapper.style.display = 'block';

    this.updateBoneTree();
    this.updateTimeline();
    this.updateStatusBar();
    this.updateWorldTransforms();
    this.renderCanvas();
  }

  private async loadSession(): Promise<void> {
    const sessionId = this.options.params?.sessionId;
    if (!sessionId) {
      toast.error('No session ID provided');
      this.navigate('/agents');
      return;
    }

    try {
      const response = await sessionsApi.get(sessionId);
      this.session = response.session;
      this.updateHeader();
      this.showCanvas();
    } catch (error) {
      console.error('Failed to load session:', error);
      toast.error('Failed to load session');
      this.navigate('/agents');
    }
  }

  private updateHeader(): void {
    const subtitleEl = this.$('.bone-subtitle');

    if (this.session) {
      const repo = this.session.repositoryOwner && this.session.repositoryName
        ? `${this.session.repositoryOwner}/${this.session.repositoryName}`
        : '';
      const branch = this.session.branch || '';
      const subtitle = [repo, branch].filter(Boolean).join(' - ');
      if (subtitleEl) subtitleEl.textContent = subtitle || 'No repository';
    }
  }

  private async saveAnimation(): Promise<void> {
    if (this.isSaving) return;

    this.isSaving = true;

    try {
      const animationData = {
        name: this.animation.name,
        type: this.animation.type,
        fps: this.animation.fps,
        duration: this.animation.duration,
        loop: this.animation.loop,
        bones: this.animation.bones.map(b => ({
          name: b.name,
          parent: b.parent,
          length: b.length,
        })),
        keyframes: this.animation.keyframes.map(k => ({
          time: k.time,
          transforms: Object.fromEntries(
            Object.entries(k.transforms).map(([name, t]) => [
              name,
              {
                position: [t.position.x, t.position.y],
                rotation: t.rotation,
                scale: [t.scale.x, t.scale.y],
              },
            ])
          ),
        })),
      };

      const sessionPath = this.getSessionPath();
      const filePath = `animations/${this.animation.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
      const content = JSON.stringify(animationData, null, 2);

      await offlineStorage.cacheFile(sessionPath, filePath, content, 'text');

      this.hasUnsavedChanges = false;
      toast.success('Animation saved');
    } catch (error) {
      console.error('Failed to save animation:', error);
      toast.error('Failed to save animation');
    } finally {
      this.isSaving = false;
    }
  }

  private getSessionPath(): string {
    if (!this.session) return '';
    const owner = this.session.repositoryOwner || '';
    const repo = this.session.repositoryName || '';
    const branch = this.session.branch || '';
    return `${owner}__${repo}__${branch}`;
  }

  protected onUnmount(): void {
    this.stopPlayback();

    // Clean up keyboard event listener to prevent memory leak
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
  }
}
