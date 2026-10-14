"use client";

import { memo, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import type { Game } from "./core/game";
import { hud, useHud } from "./core/hud";
import { useMobileLayout, type MobileControlId, type MobileOrientation } from "./mobileLayout";
import styles from "./MobileControls.module.css";

type HeldAction = "fire" | "ads" | "jump" | "grenade";
type IconName = "fire" | "ads" | "jump" | "crouch" | "sprint" | "reload" | "switch" | "peekLeft" | "peekRight" | "grenade" | "camera" | "emote" | "scores" | "menu" | "layout";
type Gesture = { element: HTMLButtonElement; action?: HeldAction; look?: { x: number; y: number } };

const ICON_PATHS: Record<IconName, string> = {
    fire: "M10 20V8l2-4 2 4v12z M8 20h8 M10 15h4 M7 6l-2-2 M17 6l2-2",
    ads: "M12 2v4 M12 18v4 M2 12h4 M18 12h4 M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0 M4 12a8 8 0 1 0 16 0 8 8 0 1 0-16 0",
    jump: "M10 4a2 2 0 1 0 4 0 2 2 0 1 0-4 0 M12 8v6 M12 10l-5-3 M12 10l5-3 M12 14l-5 6 M12 14l5 6",
    crouch: "M12 4a2 2 0 1 0 4 0 2 2 0 1 0-4 0 M14 8l-4 5 6 2-3 5 M10 13l-5 4 5 3 M14 9l4 3h3",
    sprint: "M14 3a2 2 0 1 0 4 0 2 2 0 1 0-4 0 M16 7l-5 5 5 3-3 6 M12 11l-5 6H3 M15 8l5 3 M11 7H6 M7 4H3",
    reload: "M19 8a8 8 0 1 0 1 8 M19 3v5h-5 M10 8v8h4V8z",
    switch: "M3 7h17 M16 3l4 4-4 4 M21 17H4 M8 13l-4 4 4 4",
    peekLeft: "M18 3v18 M15 12H5 M9 8l-4 4 4 4",
    peekRight: "M6 3v18 M9 12h10 M15 8l4 4-4 4",
    grenade: "M8 5h8v4 M10 3h6l3 4 M8 10a7 7 0 1 0 8 0z M12 11v9 M6 15h12",
    camera: "M3 7h5l2-3h4l2 3h5v13H3z M8 13a4 4 0 1 0 8 0 4 4 0 1 0-8 0",
    emote: "M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0 M8 14c1 1.5 2.3 2.2 4 2.2s3-.7 4-2.2 M9 9.5h.01 M15 9.5h.01",
    scores: "M4 4h16v17H4z M8 8h1 M12 8h5 M8 12h1 M12 12h5 M8 16h1 M12 16h5",
    menu: "M6 5h4v14H6z M14 5h4v14h-4z",
    layout: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
};

function Icon({ name }: { name: IconName }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={ICON_PATHS[name]} /></svg>;
}

/** Independent pointer ownership lets both thumbs move/aim while other fingers fire. */
export const MobileControls = memo(function MobileControls({ game }: { game: Game }) {
  const input = game.input;
  const scoreboard = useHud((s) => s.scoreboard);
  const editing = useHud((s) => s.customizingControls);
  const peek = useHud((s) => s.peek);
  const emoteMenu = useHud((s) => s.emoteMenu);
  const layout = useMobileLayout();
  const [orientation, setOrientation] = useState<MobileOrientation>(() => window.innerWidth > window.innerHeight ? "landscape" : "portrait");
  const [selected, setSelected] = useState<MobileControlId>("joystick");
  const editDrag = useRef<{ id: MobileControlId; pointer: number; startX: number; startY: number; centerX: number; centerY: number; halfWidth: number; halfHeight: number } | null>(null);
  const [saveError, setSaveError] = useState("");
  const [editorCollapsed, setEditorCollapsed] = useState(false);
  const joystick = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const [stickOrigin, setStickOrigin] = useState<{ x: number; y: number; radius: number } | null>(null);
  const stick = useRef<{ id: number; x: number; y: number; radius: number } | null>(null);
  const sprintLock = useRef(false);
  const [sprintLocked, setSprintLocked] = useState(false);
  const look = useRef<{ id: number; x: number; y: number } | null>(null);
  const gestures = useRef(new Map<number, Gesture>());
  const [sprinting, setSprinting] = useState(false);
  const [crouching, setCrouching] = useState(false);

  useEffect(() => {
    const resize = () => { setOrientation(window.innerWidth > window.innerHeight ? "landscape" : "portrait"); editDrag.current = null; };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  function controlStyle(id: MobileControlId): CSSProperties {
    const control = layout.controls[orientation][id];
    const scale = Math.min(id === "joystick" ? 1.4 : 1.5, (control?.size ?? 1) * (id === "joystick" ? 1 : layout.buttonScale));
    const positioned = control?.x !== undefined && control?.y !== undefined;
    const half = `var(--control-size) * ${scale} / 2`;
    return {
      opacity: layout.opacity,
      width: `calc(var(--control-size) * ${scale})`, height: `calc(var(--control-size) * ${scale})`,
      ...(positioned ? {
        position: "fixed", transform: "translate(-50%, -50%)", right: "auto", bottom: "auto",
        left: `clamp(calc(${half} + env(safe-area-inset-left) + 4px), ${control.x! * 100}%, calc(100% - (${half}) - env(safe-area-inset-right) - 4px))`,
        top: `clamp(calc(${half} + env(safe-area-inset-top) + 4px), ${control.y! * 100}%, calc(100% - (${half}) - env(safe-area-inset-bottom) - 20px))`,
      } : {}),
    };
  }

  function beginEdit(e: PointerEvent<HTMLElement>, id: MobileControlId) {
    if (editDrag.current) return;
    capture(e);
    setSelected(id);
    const rect = e.currentTarget.getBoundingClientRect();
    editDrag.current = { id, pointer: e.pointerId, startX: e.clientX, startY: e.clientY, centerX: rect.left + rect.width / 2, centerY: rect.top + rect.height / 2, halfWidth: rect.width / 2, halfHeight: rect.height / 2 };
  }

  function moveEdit(e: PointerEvent<HTMLElement>) {
    const drag = editDrag.current;
    if (!drag || drag.pointer !== e.pointerId) return;
    const x = Math.max(drag.halfWidth, Math.min(window.innerWidth - drag.halfWidth, drag.centerX + e.clientX - drag.startX));
    const y = Math.max(drag.halfHeight, Math.min(window.innerHeight - drag.halfHeight, drag.centerY + e.clientY - drag.startY));
    layout.setControl(orientation, drag.id, { x: x / window.innerWidth, y: y / window.innerHeight });
  }

  function endEdit(e: PointerEvent<HTMLElement>) { if (editDrag.current?.pointer === e.pointerId) editDrag.current = null; }

  useEffect(() => {
    const reset = () => {
      input.releaseAll();
      gestures.current.forEach((gesture) => { gesture.element.dataset.pressed = "false"; });
      gestures.current.clear();
      stick.current = look.current = null;
      sprintLock.current = false;
      setSprintLocked(false);
      setStickOrigin(null);
      if (knob.current) knob.current.style.transform = "translate(-50%, -50%)";
      setSprinting(false); setCrouching(false);
    };
    const visibility = () => { if (document.hidden) reset(); };
    window.addEventListener("blur", reset);
    window.addEventListener("resize", reset);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", reset);
      window.removeEventListener("resize", reset);
      document.removeEventListener("visibilitychange", visibility);
      input.releaseAll();
    };
  }, [input]);

  const capture = (e: PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  function syncAction(action: HeldAction) {
    const down = [...gestures.current.values()].some((gesture) => gesture.action === action);
    if (action === "grenade") input.hold("KeyG", down);
    else input.setAction(action, down);
  }

  function endButton(e: PointerEvent<HTMLButtonElement>) {
    if (editing) { endEdit(e); return; }
    const gesture = gestures.current.get(e.pointerId);
    if (!gesture || gesture.element !== e.currentTarget) return;
    gestures.current.delete(e.pointerId);
    e.currentTarget.dataset.pressed = "false";
    if (gesture.action) syncAction(gesture.action);
  }

  function button(name: Exclude<IconName, "layout">, label: string, className: string, action?: HeldAction, press?: () => void, toggle?: boolean, aim = false, id: MobileControlId = name as MobileControlId) {
    const control = <button type="button" aria-label={label} title={label} className={`${styles.button} ${className}`} style={controlStyle(id)} aria-pressed={toggle} data-toggled={toggle || undefined} data-control-id={id} data-selected={editing && selected === id || undefined}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (editing) { beginEdit(e, id); return; }
        if (!input.enabled || [...gestures.current.values()].some((g) => g.element === e.currentTarget)) return;
        capture(e);
        gestures.current.set(e.pointerId, { element: e.currentTarget, action, look: aim ? { x: e.clientX, y: e.clientY } : undefined });
        e.currentTarget.dataset.pressed = "true";
        if (action) syncAction(action);
        press?.();
      }}
      onPointerMove={(e) => {
        if (editing) { moveEdit(e); return; }
        const gesture = gestures.current.get(e.pointerId);
        if (gesture?.look) {
          input.addLook(e.clientX - gesture.look.x, e.clientY - gesture.look.y);
          gesture.look.x = e.clientX; gesture.look.y = e.clientY;
        }
      }}
      onPointerUp={endButton} onPointerCancel={endButton} onLostPointerCapture={endButton}
      onClick={(e) => { if (e.detail === 0) { if (editing) setSelected(id); else if (!action) press?.(); } }}>
      <Icon name={name} /><span>{label}</span>
    </button>;
    return className === styles.tool || className === styles.utility ? <span className={className === styles.tool ? styles.toolSlot : styles.utilitySlot}>{control}</span> : control;
  }

  function moveStick(x: number, y: number) {
    const current = stick.current;
    if (!current || !input.enabled) return;
    const dx = x - current.x, dy = y - current.y;
    // Drag beyond ordinary forward movement to deliberately enter the lock target.
    const lockY = Math.max(40, current.y - current.radius * 2);
    if (!sprintLock.current && current.y - y >= current.radius && y <= lockY + 12 && Math.abs(dx) <= current.radius * 0.65) {
      sprintLock.current = true;
      setSprintLocked(true);
      setSprinting(true);
      setCrouching(false);
      input.setAction("crouch", false);
      input.setAction("sprint", true);
    } else if (sprintLock.current && (-dy < current.radius * 0.8 || Math.abs(dx) > current.radius)) {
      stopSprintLock();
    }
    const distance = Math.hypot(dx, dy);
    const scale = distance > current.radius ? current.radius / distance : 1;
    const nx = dx * scale / current.radius, ny = -dy * scale / current.radius;
    const magnitude = Math.hypot(nx, ny);
    const response = magnitude > 0.12 ? (magnitude - 0.12) / (0.88 * magnitude) : 0;
    input.setStick(sprintLock.current ? { x: 0, y: 1 } : { x: nx * response, y: ny * response });
    if (knob.current) knob.current.style.transform = `translate(calc(-50% + ${dx * scale}px), calc(-50% + ${dy * scale}px))`;
  }

  function stopSprintLock() {
    if (!sprintLock.current) return;
    sprintLock.current = false;
    setSprintLocked(false);
    setSprinting(false);
    input.setAction("sprint", false);
    input.setStick(null);
  }

  function beginStick(e: PointerEvent<HTMLDivElement>) {
    if (stick.current || !input.enabled || !joystick.current) return;
    capture(e);
    stopSprintLock();
    const radius = joystick.current.getBoundingClientRect().width * 0.34;
    stick.current = { id: e.pointerId, x: e.clientX, y: e.clientY, radius };
    setStickOrigin({ x: e.clientX, y: e.clientY, radius });
    // Touching down is neutral; only dragging moves the player.
    moveStick(e.clientX, e.clientY);
  }

  function endStick(e: PointerEvent<HTMLDivElement>) {
    if (stick.current?.id !== e.pointerId) return;
    stick.current = null;
    setStickOrigin(null);
    // Pointer cancellation must stop running; normal release preserves the lock.
    if (e.type !== "pointerup") stopSprintLock();
    input.setStick(sprintLock.current ? { x: 0, y: 1 } : null);
    if (knob.current) knob.current.style.transform = "translate(-50%, -50%)";
  }

  function toggleScores() {
    const open = !input.held("Tab");
    input.releaseAll();
    gestures.current.forEach((gesture) => { gesture.element.dataset.pressed = "false"; });
    gestures.current.clear();
    stick.current = look.current = null;
    sprintLock.current = false;
    setSprintLocked(false);
    setStickOrigin(null);
    if (knob.current) knob.current.style.transform = "translate(-50%, -50%)";
    input.hold("Tab", open);
    setSprinting(false); setCrouching(false);
  }

  function openEditor() {
    input.releaseAll();
    gestures.current.forEach((gesture) => { gesture.element.dataset.pressed = "false"; });
    gestures.current.clear();
    stick.current = look.current = null;
    sprintLock.current = false;
    setSprintLocked(false);
    setStickOrigin(null);
    if (knob.current) knob.current.style.transform = "translate(-50%, -50%)";
    setSprinting(false); setCrouching(false);
    setSaveError("");
    setEditorCollapsed(false);
    hud().set({ scoreboard: false, customizingControls: true });
  }

  // Captured game drags can suppress a subsequent synthesized touch click.
  // Activate editor commands from the pointer event, retaining keyboard clicks.
  function editorAction(action: () => void) {
    return {
      onPointerDown: (e: PointerEvent<HTMLButtonElement>) => { e.preventDefault(); e.stopPropagation(); action(); },
      onClick: (e: MouseEvent<HTMLButtonElement>) => { if (e.detail === 0) action(); },
    };
  }

  return <div className={`${styles.controls} ${editing ? styles.editing : ""}`} aria-label="Mobile game controls" data-scoreboard={scoreboard || undefined}>
    {!scoreboard && <>
      {!editing && <div className={styles.moveZone} aria-label="Touch left to move"
        onPointerDown={beginStick}
        onPointerMove={(e) => { if (stick.current?.id === e.pointerId) moveStick(e.clientX, e.clientY); }}
        onPointerUp={endStick} onPointerCancel={endStick} onLostPointerCapture={endStick} />}
      {!editing && <div className={styles.lookZone} aria-label="Drag to aim"
        onPointerDown={(e) => { if (look.current || !input.enabled) return; capture(e); look.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; }}
        onPointerMove={(e) => {
          if (look.current?.id !== e.pointerId) return;
          input.addLook(e.clientX - look.current.x, e.clientY - look.current.y);
          look.current.x = e.clientX; look.current.y = e.clientY;
        }}
        onPointerUp={(e) => { if (look.current?.id === e.pointerId) look.current = null; }}
        onPointerCancel={(e) => { if (look.current?.id === e.pointerId) look.current = null; }}
        onLostPointerCapture={(e) => { if (look.current?.id === e.pointerId) look.current = null; }} />}
      <div ref={joystick} className={styles.joystick} style={{ ...controlStyle("joystick"), ...(stickOrigin && !editing ? {
        position: "fixed", left: stickOrigin.x, top: stickOrigin.y, right: "auto", bottom: "auto", transform: "translate(-50%, -50%)",
      } : {}) }} aria-label="Movement joystick" data-control-id="joystick" data-active={!!stickOrigin} data-selected={editing && selected === "joystick" || undefined}
        onPointerDown={(e) => { if (editing) beginEdit(e, "joystick"); }}
        onPointerMove={(e) => { if (editing) moveEdit(e); }}
        onPointerUp={endEdit} onPointerCancel={endEdit} onLostPointerCapture={endEdit}>
        <div className={styles.stickGuides} /><div ref={knob} className={styles.knob} /><span>{sprintLocked ? "TOUCH TO STOP" : editing || stickOrigin ? "MOVE" : "TOUCH LEFT TO MOVE"}</span>
      </div>
      {!editing && (stickOrigin || sprintLocked) && <button type="button" className={styles.sprintLock} aria-label={sprintLocked ? "Stop auto sprint" : "Drag here to lock sprint"} aria-pressed={sprintLocked}
        style={stickOrigin ? { left: Math.max(24, Math.min(window.innerWidth - 24, stickOrigin.x)), top: Math.max(40, stickOrigin.y - stickOrigin.radius * 2) } : undefined}
        data-locked={sprintLocked} onPointerDown={(e) => { if (sprintLocked) { capture(e); stopSprintLock(); } }}
        onClick={(e) => { if (e.detail === 0) stopSprintLock(); }}>
        <Icon name="sprint" /><span role="status">{sprintLocked ? "AUTO SPRINT · TAP TO STOP" : "↑ LOCK SPRINT"}</span>
      </button>}
      {button("fire", "Fire", styles.leftFire, "fire", undefined, undefined, false, "leftFire")}
      {button("fire", "Fire / aim", styles.rightFire, "fire", undefined, undefined, true, "rightFire")}
      {button("ads", "Aim", styles.ads, "ads", undefined, undefined, true)}
      {button("jump", "Jump", styles.jump, "jump")}
      {button("crouch", "Crouch", styles.crouch, undefined, () => { const down = !crouching; if (down) stopSprintLock(); setCrouching(down); input.setAction("crouch", down); if (down) { setSprinting(false); input.setAction("sprint", false); } }, crouching)}
      {button("sprint", "Sprint", styles.sprint, undefined, () => { const down = !sprinting; stopSprintLock(); setSprinting(down); input.setAction("sprint", down); if (down) { setCrouching(false); input.setAction("crouch", false); } }, sprinting)}
      <div className={styles.utilities}>
        {button("grenade", "Grenade", styles.utility, "grenade")}
        {button("reload", "Reload", styles.utility, undefined, () => input.press("KeyR"))}
        {button("switch", "Switch", styles.utility, undefined, () => input.press("SwapWeapon"))}
      </div>
      {button("peekLeft", "Peek left", styles.peekLeft, undefined, () => input.press("PeekLeft"), peek === -1)}
      {button("peekRight", "Peek right", styles.peekRight, undefined, () => input.press("PeekRight"), peek === 1)}
    </>}
    <div className={styles.toolbar}>
      {!scoreboard && button("camera", "Camera", styles.tool, undefined, () => input.press("KeyV"))}
      {!scoreboard && button("emote", "Emote", styles.tool, undefined, () => input.press("EmoteMenu"), emoteMenu)}
      {button("scores", scoreboard ? "Close scores" : "Scores", styles.tool, undefined, toggleScores, scoreboard)}
      {button("menu", "Pause", styles.tool, undefined, () => { input.releaseAll(); hud().set({ menu: true }); }, undefined, false, "pause")}
      {!editing && <button type="button" aria-label="Customize controls" title="Customize controls" className={`${styles.button} ${styles.tool}`} {...editorAction(openEditor)}><Icon name="layout" /><span>Layout</span></button>}
    </div>
    {!scoreboard && !editing && <span className={styles.lookHint}>DRAG TO AIM</span>}
    {editing && <div className={`${styles.editor} ${editorCollapsed ? styles.collapsedEditor : ""}`} aria-label="Control layout editor">
      <div className={styles.editorTitle}><div><strong>YOUR CONTROLS</strong><button type="button" aria-label={editorCollapsed ? "Expand editor" : "Collapse editor"} title={editorCollapsed ? "Expand editor" : "Collapse editor"} {...editorAction(() => setEditorCollapsed((collapsed) => !collapsed))}>{editorCollapsed ? "+" : "−"}</button></div>{!editorCollapsed && <span>Drag a control · {orientation}</span>}</div>
      {!editorCollapsed && <>
        <label><span>{selected.replace(/([A-Z])/g, " $1").toUpperCase()} SIZE <b>{Math.round((layout.controls[orientation][selected]?.size ?? 1) * 100)}%</b></span><input aria-label="Selected control size" type="range" min={selected === "joystick" ? 0.75 : 0.65} max={selected === "joystick" ? 1.4 : 1.5} step="0.05" value={layout.controls[orientation][selected]?.size ?? 1} onChange={(e) => layout.setControl(orientation, selected, { size: Number(e.target.value) })} /></label>
        <label><span>OPACITY <b>{Math.round(layout.opacity * 100)}%</b></span><input aria-label="Control opacity" type="range" min="0.25" max="1" step="0.05" value={layout.opacity} onChange={(e) => layout.setOpacity(Number(e.target.value))} /></label>
      </>}
      <div className={styles.editorActions}>
        {!editorCollapsed && <button type="button" {...editorAction(() => { layout.reset(orientation); setSelected("joystick"); })}>Reset layout</button>}
        {!editorCollapsed && <button type="button" {...editorAction(() => { layout.restoreSaved(); hud().set({ customizingControls: false }); })}>Cancel changes</button>}
        <button type="button" className={styles.save} {...editorAction(() => { if (layout.save()) hud().set({ customizingControls: false }); else setSaveError("Storage unavailable. Your controls work for this session."); })}>Save &amp; play</button>
        {saveError && <button type="button" className={styles.save} {...editorAction(() => hud().set({ customizingControls: false }))}>Play without saving</button>}
      </div>
      {saveError && <span className={styles.saveError} role="status">{saveError}</span>}
    </div>}
  </div>;
});
