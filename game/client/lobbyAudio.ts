import { useEffect } from "react";
import { audio } from "./core/audio";
import { useSettings } from "./settings";

/** Controls that sound on hover and click: buttons, tabs, radios and map cards. */
const TARGETS = 'button, [role="tab"], [role="radio"], [data-map]';
/** Sweeping across a row of buttons ticks at most this often. */
const HOVER_GAP_MS = 70;

function control(e: Event): HTMLElement | null {
  const el = e.target instanceof Element ? e.target.closest<HTMLElement>(TARGETS) : null;
  if (!el || el.matches(":disabled") || el.getAttribute("aria-disabled") === "true") return null;
  return el;
}

/**
 * Menu sound while mounted: the lobby bed (it starts on the first pointer or key press if audio
 * is still locked, and stops on unmount) and hover / click sounds on menu controls, from one
 * delegated listener per event on the document.
 */
export function useLobbySounds() {
  useEffect(() => {
    audio.setVolume(useSettings.getState().volume);
    const unsubscribe = useSettings.subscribe((s) => audio.setVolume(s.volume));
    audio.lobby(true);

    let hovered: HTMLElement | null = null;
    let hoverAt = 0;
    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return; // a tap would tick and click at once
      const el = control(e);
      if (el === hovered) return;
      hovered = el;
      const now = performance.now();
      if (!el || now - hoverAt < HOVER_GAP_MS) return;
      hoverAt = now;
      audio.uiHover();
    };
    const click = (e: MouseEvent) => {
      const el = control(e);
      if (!el) return;
      if (el.getAttribute("role") === "tab") audio.uiTab();
      else audio.uiClick();
    };
    document.addEventListener("pointerover", over, { capture: true, passive: true });
    document.addEventListener("click", click, true);
    return () => {
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("click", click, true);
      unsubscribe();
      audio.lobby(false);
    };
  }, []);
}

/** Menu sound for whichever menu screen renders it (the home lobby or a room's waiting room). */
export function LobbySounds() {
  useLobbySounds();
  return null;
}
