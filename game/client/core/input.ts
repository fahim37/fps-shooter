interface KeyboardCapture {
  lock(codes: string[]): Promise<void>;
  unlock(): void;
}

// Capture browser shortcuts in API fullscreen, while leaving Esc available to exit.
const SHORTCUT_CODES = [
  ...Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ", (letter) => `Key${letter}`),
  ...Array.from("0123456789", (digit) => `Digit${digit}`),
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
  "Tab", "Enter", "Space", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Minus", "Equal", "BracketLeft", "BracketRight",
  "Backslash", "Semicolon", "Quote", "Backquote", "Comma", "Period", "Slash", "NumpadAdd", "NumpadSubtract",
];

/**
 * Unified input state. Keyboard/mouse fill it from DOM events; the touch UI writes the same
 * fields, so gameplay code never cares where input came from.
 */
export class Input {
  forward = 0;
  right = 0;
  jump = false;
  sprint = false;
  crouch = false;
  fire = false;
  ads = false;
  /** Accumulated look delta in radians since the last `consumeLook()`. */
  private lookX = 0;
  private lookY = 0;

  // Edge-triggered actions, cleared by `consume*`.
  private pressed = new Set<string>();
  private keys = new Set<string>();
  private touchActions = new Set<"jump" | "sprint" | "crouch">();
  locked = false;
  touch = false;
  /** Set by the touch UI: analog stick values override keyboard axes. */
  stick: { x: number; y: number } | null = null;
  private _enabled = true;
  get enabled() { return this._enabled; }
  set enabled(value: boolean) {
    if (value === this._enabled) return;
    this._enabled = value;
    this.syncKeyboardCapture();
  }

  private cleanup: (() => void) | null = null;
  private keyboardCapture: KeyboardCapture | null = null;
  private captureRequested = false;

  constructor(private element: HTMLElement) {}

  attach() {
    this.keyboardCapture = (navigator as Navigator & { keyboard?: KeyboardCapture }).keyboard ?? null;
    const onKey = (e: KeyboardEvent, down: boolean) => {
      const active = this.enabled && (this.locked || this.touch);
      // Keep the game's Ctrl+crouch combinations, but cancel browser actions.
      if (active && e.ctrlKey) e.preventDefault();
      if (down && !active) return;
      const k = e.code;
      if (down) {
        if (!this.keys.has(k)) this.pressed.add(k);
        this.keys.add(k);
      } else {
        this.keys.delete(k);
      }
      if (["Space", "Tab", "KeyQ", "ControlLeft", "ControlRight"].includes(k) && active) e.preventDefault();
      this.updateAxes();
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    const mm = (e: MouseEvent) => {
      if (!this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    };
    const md = (e: MouseEvent) => {
      if (!this.locked) return;
      if (e.button === 0) this.fire = true;
      if (e.button === 2) this.ads = true;
      if (e.button === 1) this.pressed.add("Mouse3");
    };
    const mu = (e: MouseEvent) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.ads = false;
    };
    const wheel = (e: WheelEvent) => {
      if (!this.enabled || (!this.locked && !this.touch)) return;
      if (e.ctrlKey) e.preventDefault(); // Browser zoom must not interrupt crouched play.
      if (!this.locked) return;
      this.pressed.add(e.deltaY > 0 ? "WheelDown" : "WheelUp");
    };
    const ctx = (e: Event) => e.preventDefault();
    const plc = () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) this.releaseAll();
      this.syncKeyboardCapture();
    };
    const fullscreen = () => this.syncKeyboardCapture();
    const blur = () => this.releaseAll();
    window.addEventListener("keydown", kd, { capture: true });
    window.addEventListener("keyup", ku, { capture: true });
    window.addEventListener("mousemove", mm);
    window.addEventListener("mousedown", md);
    window.addEventListener("mouseup", mu);
    window.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("blur", blur);
    this.element.addEventListener("contextmenu", ctx);
    document.addEventListener("pointerlockchange", plc);
    document.addEventListener("fullscreenchange", fullscreen);
    this.cleanup = () => {
      window.removeEventListener("keydown", kd, { capture: true });
      window.removeEventListener("keyup", ku, { capture: true });
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mousedown", md);
      window.removeEventListener("mouseup", mu);
      window.removeEventListener("wheel", wheel);
      window.removeEventListener("blur", blur);
      this.element.removeEventListener("contextmenu", ctx);
      document.removeEventListener("pointerlockchange", plc);
      document.removeEventListener("fullscreenchange", fullscreen);
    };
  }

  detach() {
    this.cleanup?.();
    this.cleanup = null;
    if (this.captureRequested) this.keyboardCapture?.unlock();
    this.captureRequested = false;
    this.keyboardCapture = null;
    if (document.pointerLockElement === this.element) document.exitPointerLock();
  }

  private syncKeyboardCapture() {
    if (!this.keyboardCapture) return;
    const capture = this.keyboardCapture;
    const active = this.enabled && (this.locked || this.touch) && !!document.fullscreenElement?.contains(this.element);
    if (!active) {
      if (this.captureRequested) capture.unlock();
      this.captureRequested = false;
    } else if (!this.captureRequested) {
      this.captureRequested = true;
      void capture.lock(SHORTCUT_CODES).then(() => {
        if (!this.captureRequested || this.keyboardCapture !== capture) capture.unlock();
      }).catch(() => { this.captureRequested = false; });
    }
  }

  requestLock(fullscreen = false) {
    if (this.touch) return;
    if (fullscreen && !document.fullscreenElement) {
      const container = this.element.closest<HTMLElement>(".game-view");
      if (container?.requestFullscreen) {
        // Fullscreen must begin inside this click; keyboard capture activates once
        // both fullscreen and pointer lock have been granted by the browser.
        try { void container.requestFullscreen().then(() => this.requestLock()).catch(() => this.requestLock()); }
        catch { this.requestLock(); }
        return;
      }
    }
    const el = this.element as HTMLElement & { requestPointerLock(opts?: { unadjustedMovement?: boolean }): Promise<void> | void };
    try {
      const r = el.requestPointerLock({ unadjustedMovement: true });
      if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => el.requestPointerLock());
    } catch {
      el.requestPointerLock();
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Touch look input (pixels). */
  addLook(dx: number, dy: number) {
    if (!this.enabled) return;
    this.lookX += dx;
    this.lookY += dy;
  }

  consumeLook(): [number, number] {
    const r: [number, number] = [this.lookX, this.lookY];
    this.lookX = this.lookY = 0;
    return r;
  }

  /** True once per press of `code` (KeyboardEvent.code, or Mouse3/WheelUp/WheelDown). */
  consume(code: string) {
    if (this.pressed.has(code)) {
      this.pressed.delete(code);
      return true;
    }
    return false;
  }

  press(code: string) {
    if (!this.enabled) return;
    this.pressed.add(code);
  }

  hold(code: string, down: boolean) {
    if (down && !this.enabled) return;
    if (down) { if (!this.keys.has(code)) this.pressed.add(code); this.keys.add(code); }
    else this.keys.delete(code);
    this.updateAxes();
  }

  setStick(value: { x: number; y: number } | null) { if (value && !this.enabled) return; this.stick = value; }
  setAction(action: "fire" | "ads" | "jump" | "sprint" | "crouch", down: boolean) {
    if (down && !this.enabled) return;
    if (action === "fire" || action === "ads") this[action] = down;
    else {
      if (down) this.touchActions.add(action); else this.touchActions.delete(action);
      this.updateAxes();
    }
  }

  held(code: string) {
    return this.keys.has(code);
  }

  endFrame() {
    this.pressed.clear();
  }

  releaseAll() {
    this.keys.clear();
    this.touchActions.clear();
    this.pressed.clear();
    this.fire = this.ads = false;
    this.stick = null;
    this.lookX = this.lookY = 0;
    this.updateAxes();
  }

  private updateAxes() {
    const k = this.keys;
    this.forward = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    this.right = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    this.jump = k.has("Space") || this.touchActions.has("jump");
    this.sprint = k.has("ShiftLeft") || k.has("ShiftRight") || this.touchActions.has("sprint");
    this.crouch = k.has("ControlLeft") || k.has("ControlRight") || k.has("KeyC") || this.touchActions.has("crouch");
  }

  /** Axes with the touch stick taking priority when active. */
  axes(): [number, number] {
    if (this.stick) return [this.stick.y, this.stick.x];
    return [this.forward, this.right];
  }
}
