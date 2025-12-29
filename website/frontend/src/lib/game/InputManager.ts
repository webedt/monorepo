/**
 * Input Manager
 * Handles keyboard, mouse, and gamepad input for play mode
 */

export type KeyState = 'up' | 'down' | 'pressed' | 'released';

export interface InputState {
  keys: Map<string, KeyState>;
  mouse: {
    x: number;
    y: number;
    worldX: number;
    worldY: number;
    buttons: Map<number, KeyState>;
    wheelDelta: number;
  };
  gamepad: {
    connected: boolean;
    axes: number[];
    buttons: Map<number, KeyState>;
  };
}

export interface InputManagerConfig {
  canvas: HTMLCanvasElement;
  screenToWorld?: (screenX: number, screenY: number) => { x: number; y: number };
}

export class InputManager {
  private canvas: HTMLCanvasElement;
  private screenToWorld: (screenX: number, screenY: number) => { x: number; y: number };
  private state: InputState;
  private previousKeys: Map<string, boolean> = new Map();
  private previousMouseButtons: Map<number, boolean> = new Map();
  private previousGamepadButtons: Map<number, boolean> = new Map();
  private enabled = false;

  // Event listener references for cleanup
  private boundHandleKeyDown: (e: KeyboardEvent) => void;
  private boundHandleKeyUp: (e: KeyboardEvent) => void;
  private boundHandleMouseMove: (e: MouseEvent) => void;
  private boundHandleMouseDown: (e: MouseEvent) => void;
  private boundHandleMouseUp: (e: MouseEvent) => void;
  private boundHandleWheel: (e: WheelEvent) => void;
  private boundHandleContextMenu: (e: Event) => void;

  constructor(config: InputManagerConfig) {
    this.canvas = config.canvas;
    this.screenToWorld = config.screenToWorld ?? ((x, y) => ({ x, y }));

    this.state = {
      keys: new Map(),
      mouse: {
        x: 0,
        y: 0,
        worldX: 0,
        worldY: 0,
        buttons: new Map(),
        wheelDelta: 0,
      },
      gamepad: {
        connected: false,
        axes: [0, 0, 0, 0],
        buttons: new Map(),
      },
    };

    // Bind event handlers
    this.boundHandleKeyDown = this.handleKeyDown.bind(this);
    this.boundHandleKeyUp = this.handleKeyUp.bind(this);
    this.boundHandleMouseMove = this.handleMouseMove.bind(this);
    this.boundHandleMouseDown = this.handleMouseDown.bind(this);
    this.boundHandleMouseUp = this.handleMouseUp.bind(this);
    this.boundHandleWheel = this.handleWheel.bind(this);
    this.boundHandleContextMenu = (e: Event) => e.preventDefault();
  }

  /**
   * Enable input handling
   */
  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    // Keyboard events on window
    window.addEventListener('keydown', this.boundHandleKeyDown);
    window.addEventListener('keyup', this.boundHandleKeyUp);

    // Mouse events on canvas
    this.canvas.addEventListener('mousemove', this.boundHandleMouseMove);
    this.canvas.addEventListener('mousedown', this.boundHandleMouseDown);
    this.canvas.addEventListener('mouseup', this.boundHandleMouseUp);
    this.canvas.addEventListener('wheel', this.boundHandleWheel);
    this.canvas.addEventListener('contextmenu', this.boundHandleContextMenu);
  }

  /**
   * Disable input handling
   */
  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;

    window.removeEventListener('keydown', this.boundHandleKeyDown);
    window.removeEventListener('keyup', this.boundHandleKeyUp);

    this.canvas.removeEventListener('mousemove', this.boundHandleMouseMove);
    this.canvas.removeEventListener('mousedown', this.boundHandleMouseDown);
    this.canvas.removeEventListener('mouseup', this.boundHandleMouseUp);
    this.canvas.removeEventListener('wheel', this.boundHandleWheel);
    this.canvas.removeEventListener('contextmenu', this.boundHandleContextMenu);

    // Clear state
    this.reset();
  }

  /**
   * Reset all input state
   */
  reset(): void {
    this.state.keys.clear();
    this.state.mouse.buttons.clear();
    this.state.mouse.wheelDelta = 0;
    this.state.gamepad.buttons.clear();
    this.previousKeys.clear();
    this.previousMouseButtons.clear();
    this.previousGamepadButtons.clear();
  }

  /**
   * Update input state (call once per frame at the end)
   * Converts 'pressed' to 'down' and 'released' to 'up'
   */
  update(): void {
    // Update key states
    for (const [key, state] of this.state.keys) {
      if (state === 'pressed') {
        this.state.keys.set(key, 'down');
      } else if (state === 'released') {
        this.state.keys.delete(key);
      }
    }

    // Update mouse button states
    for (const [button, state] of this.state.mouse.buttons) {
      if (state === 'pressed') {
        this.state.mouse.buttons.set(button, 'down');
      } else if (state === 'released') {
        this.state.mouse.buttons.delete(button);
      }
    }

    // Reset wheel delta each frame
    this.state.mouse.wheelDelta = 0;

    // Update gamepad
    this.pollGamepad();
  }

  /**
   * Check if a key is currently held down
   */
  isKeyDown(key: string): boolean {
    const state = this.state.keys.get(key.toLowerCase());
    return state === 'down' || state === 'pressed';
  }

  /**
   * Check if a key was just pressed this frame
   */
  isKeyPressed(key: string): boolean {
    return this.state.keys.get(key.toLowerCase()) === 'pressed';
  }

  /**
   * Check if a key was just released this frame
   */
  isKeyReleased(key: string): boolean {
    return this.state.keys.get(key.toLowerCase()) === 'released';
  }

  /**
   * Check if a mouse button is currently held down
   */
  isMouseButtonDown(button: number = 0): boolean {
    const state = this.state.mouse.buttons.get(button);
    return state === 'down' || state === 'pressed';
  }

  /**
   * Check if a mouse button was just pressed this frame
   */
  isMouseButtonPressed(button: number = 0): boolean {
    return this.state.mouse.buttons.get(button) === 'pressed';
  }

  /**
   * Check if a mouse button was just released this frame
   */
  isMouseButtonReleased(button: number = 0): boolean {
    return this.state.mouse.buttons.get(button) === 'released';
  }

  /**
   * Get mouse position in screen coordinates
   */
  getMousePosition(): { x: number; y: number } {
    return { x: this.state.mouse.x, y: this.state.mouse.y };
  }

  /**
   * Get mouse position in world coordinates
   */
  getMouseWorldPosition(): { x: number; y: number } {
    return { x: this.state.mouse.worldX, y: this.state.mouse.worldY };
  }

  /**
   * Get mouse wheel delta
   */
  getWheelDelta(): number {
    return this.state.mouse.wheelDelta;
  }

  /**
   * Get horizontal axis value (-1 to 1) from arrow keys or gamepad
   */
  getHorizontalAxis(): number {
    let value = 0;
    if (this.isKeyDown('arrowleft') || this.isKeyDown('a')) value -= 1;
    if (this.isKeyDown('arrowright') || this.isKeyDown('d')) value += 1;

    // Add gamepad left stick X axis
    if (this.state.gamepad.connected && Math.abs(this.state.gamepad.axes[0]) > 0.1) {
      value += this.state.gamepad.axes[0];
    }

    return Math.max(-1, Math.min(1, value));
  }

  /**
   * Get vertical axis value (-1 to 1) from arrow keys or gamepad
   */
  getVerticalAxis(): number {
    let value = 0;
    if (this.isKeyDown('arrowdown') || this.isKeyDown('s')) value -= 1;
    if (this.isKeyDown('arrowup') || this.isKeyDown('w')) value += 1;

    // Add gamepad left stick Y axis (inverted)
    if (this.state.gamepad.connected && Math.abs(this.state.gamepad.axes[1]) > 0.1) {
      value -= this.state.gamepad.axes[1];
    }

    return Math.max(-1, Math.min(1, value));
  }

  /**
   * Check if jump/action button is pressed (Space or gamepad A button)
   */
  isJumpPressed(): boolean {
    return this.isKeyPressed(' ') || this.isGamepadButtonPressed(0);
  }

  /**
   * Check if fire/action button is pressed (E key or gamepad X button)
   */
  isActionPressed(): boolean {
    return this.isKeyPressed('e') || this.isGamepadButtonPressed(2);
  }

  /**
   * Check if gamepad button is pressed
   */
  isGamepadButtonPressed(button: number): boolean {
    return this.state.gamepad.buttons.get(button) === 'pressed';
  }

  /**
   * Check if gamepad button is down
   */
  isGamepadButtonDown(button: number): boolean {
    const state = this.state.gamepad.buttons.get(button);
    return state === 'down' || state === 'pressed';
  }

  /**
   * Update screen to world conversion function
   */
  setScreenToWorld(fn: (screenX: number, screenY: number) => { x: number; y: number }): void {
    this.screenToWorld = fn;
  }

  // Private event handlers
  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.enabled) return;

    // Prevent default for game keys
    const gameKeys = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'w', 'a', 's', 'd'];
    if (gameKeys.includes(e.key.toLowerCase())) {
      e.preventDefault();
    }

    const key = e.key.toLowerCase();
    if (!this.state.keys.has(key) || this.state.keys.get(key) === 'up') {
      this.state.keys.set(key, 'pressed');
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (!this.enabled) return;

    const key = e.key.toLowerCase();
    const currentState = this.state.keys.get(key);
    if (currentState === 'down' || currentState === 'pressed') {
      this.state.keys.set(key, 'released');
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.enabled) return;

    const rect = this.canvas.getBoundingClientRect();
    this.state.mouse.x = e.clientX - rect.left;
    this.state.mouse.y = e.clientY - rect.top;

    const worldPos = this.screenToWorld(this.state.mouse.x, this.state.mouse.y);
    this.state.mouse.worldX = worldPos.x;
    this.state.mouse.worldY = worldPos.y;
  }

  private handleMouseDown(e: MouseEvent): void {
    if (!this.enabled) return;

    this.state.mouse.buttons.set(e.button, 'pressed');
  }

  private handleMouseUp(e: MouseEvent): void {
    if (!this.enabled) return;

    const currentState = this.state.mouse.buttons.get(e.button);
    if (currentState === 'down' || currentState === 'pressed') {
      this.state.mouse.buttons.set(e.button, 'released');
    }
  }

  private handleWheel(e: WheelEvent): void {
    if (!this.enabled) return;

    e.preventDefault();
    this.state.mouse.wheelDelta = e.deltaY;
  }

  private pollGamepad(): void {
    const gamepads = navigator.getGamepads();
    const gamepad = gamepads[0];

    if (!gamepad) {
      if (this.state.gamepad.connected) {
        this.state.gamepad.connected = false;
        this.state.gamepad.buttons.clear();
        this.previousGamepadButtons.clear();
      }
      return;
    }

    this.state.gamepad.connected = true;

    // Update axes
    this.state.gamepad.axes = [
      gamepad.axes[0] ?? 0,
      gamepad.axes[1] ?? 0,
      gamepad.axes[2] ?? 0,
      gamepad.axes[3] ?? 0,
    ];

    // Update buttons
    for (let i = 0; i < gamepad.buttons.length; i++) {
      const isPressed = gamepad.buttons[i].pressed;
      const wasPressed = this.previousGamepadButtons.get(i) ?? false;

      if (isPressed && !wasPressed) {
        this.state.gamepad.buttons.set(i, 'pressed');
      } else if (isPressed && wasPressed) {
        const current = this.state.gamepad.buttons.get(i);
        if (current === 'pressed') {
          this.state.gamepad.buttons.set(i, 'down');
        }
      } else if (!isPressed && wasPressed) {
        this.state.gamepad.buttons.set(i, 'released');
      } else {
        this.state.gamepad.buttons.delete(i);
      }

      this.previousGamepadButtons.set(i, isPressed);
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.disable();
  }
}
