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
  locked = false;
  touch = false;
  /** Set by the touch UI: analog stick values override keyboard axes. */
  stick: { x: number; y: number } | null = null;
  enabled = true;

  private cleanup: (() => void) | null = null;

  constructor(private element: HTMLElement) {}

  attach() {
    const onKey = (e: KeyboardEvent, down: boolean) => {
      if (down && (!this.enabled || (!this.locked && !this.touch))) return;
      const k = e.code;
      if (down) {
        if (!this.keys.has(k)) this.pressed.add(k);
        this.keys.add(k);
      } else {
        this.keys.delete(k);
      }
      if (["Space", "Tab", "KeyQ", "ControlLeft"].includes(k) && this.locked) e.preventDefault();
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
      if (!this.locked) return;
      this.pressed.add(e.deltaY > 0 ? "WheelDown" : "WheelUp");
    };
    const ctx = (e: Event) => e.preventDefault();
    const plc = () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) this.releaseAll();
    };
    const blur = () => this.releaseAll();
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("mousemove", mm);
    window.addEventListener("mousedown", md);
    window.addEventListener("mouseup", mu);
    window.addEventListener("wheel", wheel, { passive: true });
    window.addEventListener("blur", blur);
    this.element.addEventListener("contextmenu", ctx);
    document.addEventListener("pointerlockchange", plc);
    this.cleanup = () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mousedown", md);
      window.removeEventListener("mouseup", mu);
      window.removeEventListener("wheel", wheel);
      window.removeEventListener("blur", blur);
      this.element.removeEventListener("contextmenu", ctx);
      document.removeEventListener("pointerlockchange", plc);
    };
  }

  detach() {
    this.cleanup?.();
    this.cleanup = null;
    if (document.pointerLockElement === this.element) document.exitPointerLock();
  }

  requestLock() {
    if (this.touch) return;
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
    this.pressed.add(code);
  }

  hold(code: string, down: boolean) {
    if (down) { this.keys.add(code); this.pressed.add(code); }
    else this.keys.delete(code);
  }

  setStick(value: { x: number; y: number } | null) { this.stick = value; }
  setAction(action: "fire" | "ads" | "jump", down: boolean) { this[action] = down; }

  held(code: string) {
    return this.keys.has(code);
  }

  endFrame() {
    this.pressed.clear();
  }

  releaseAll() {
    this.keys.clear();
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
    this.jump = k.has("Space");
    this.sprint = k.has("ShiftLeft") || k.has("ShiftRight");
    this.crouch = k.has("ControlLeft") || k.has("KeyC");
  }

  /** Axes with the touch stick taking priority when active. */
  axes(): [number, number] {
    if (this.stick) return [this.stick.y, this.stick.x];
    return [this.forward, this.right];
  }
}
